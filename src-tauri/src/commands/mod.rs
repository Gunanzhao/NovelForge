use crate::models::{
    CopyNodeInput, DocumentData, EntityInput, EntityRecord, ExportInput, HistoryItem, MoveNodeInput,
    NodeInput, NodeRecord, ProjectData, ProjectInput, ProjectMetadata, RecoveryItem,
    SaveDocumentInput, TrashItem,
};
use crate::storage_impl as storage;
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Deserialize;

use printpdf::{
    Mm, Op, ParsedFont, PdfDocument, PdfFontHandle, PdfPage, PdfSaveOptions, Point, Pt, RawImage,
    TextItem, XObjectTransform,
};
use std::fs;
use std::io::{Cursor, Write};
use std::path::{Path, PathBuf};
use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};
use uuid::Uuid;

pub(crate) mod ai;
pub(crate) mod consistency;
pub(crate) mod entities;
pub(crate) mod export;
pub(crate) mod manuscript;
pub(crate) mod project;
pub(crate) mod recovery;
pub(crate) mod search;
pub(crate) mod statistics;
pub(crate) mod trash;

#[allow(unused_imports)]
pub(crate) use ai::{ai_complete, normalize_ai_endpoint};
#[allow(unused_imports)]
pub(crate) use search::search_project;
#[allow(unused_imports)]
pub(crate) use statistics::get_statistics;

fn project_connection(path: &str) -> Result<(PathBuf, Connection), String> {
    let root = storage::existing_project_root(path)?;
    let connection = storage::open_db(&root)?;
    Ok((root, connection))
}

fn project_data(root: &Path, connection: &Connection) -> Result<ProjectData, String> {
    Ok(ProjectData {
        project: storage::read_project_json(root)?,
        nodes: storage::all_nodes(connection, false)?,
        entities: storage::all_entities(connection, false)?,
        recovery: storage::recovery_items(root, connection)?,
    })
}

fn insert_node(
    connection: &Connection,
    node: &NodeRecord,
) -> Result<(), String> {
    connection
        .execute(
            "INSERT INTO nodes (id, kind, parent_id, title, order_index, status, file_path, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                node.id,
                node.kind,
                node.parent_id,
                node.title,
                node.order_index,
                node.status,
                node.file_path,
                node.created_at,
                node.updated_at
            ],
        )
        .map_err(|error| format!("写入项目树失败：{}", error))?;
    Ok(())
}

fn node_children<'a>(nodes: &'a [NodeRecord], parent_id: Option<&str>) -> Vec<&'a NodeRecord> {
    let mut children: Vec<&NodeRecord> = nodes
        .iter()
        .filter(|node| node.parent_id.as_deref() == parent_id && node.deleted_at.is_none())
        .collect();
    children.sort_by_key(|node| node.order_index);
    children
}

fn descendant_ids(nodes: &[NodeRecord], root_id: &str) -> Vec<String> {
    let mut result = vec![root_id.to_string()];
    let mut index = 0;
    while index < result.len() {
        let current = result[index].clone();
        for node in nodes.iter().filter(|node| node.parent_id.as_deref() == Some(current.as_str())) {
            if !result.iter().any(|id| id == &node.id) {
                result.push(node.id.clone());
            }
        }
        index += 1;
    }
    result
}

fn directory_entries(path: &Path) -> Result<Vec<PathBuf>, String> {
    let mut entries = fs::read_dir(path)
        .map_err(|error| format!("读取正文目录失败：{}", error))?
        .map(|entry| entry.map(|item| item.path()).map_err(|error| format!("读取正文目录项失败：{}", error)))
        .collect::<Result<Vec<_>, _>>()?;
    entries.sort_by_key(|entry| entry.file_name().map(|name| name.to_string_lossy().to_ascii_lowercase()));
    Ok(entries)
}

fn relative_path(root: &Path, path: &Path) -> Result<String, String> {
    path.strip_prefix(root)
        .map(|value| value.to_string_lossy().replace('\\', "/"))
        .map_err(|_| format!("正文路径不在项目目录内：{}", path.display()))
}

fn markdown_title(path: &Path, fallback: &str) -> String {
    fs::read_to_string(path).ok()
        .map(|content| storage::strip_markdown_frontmatter(&content))
        .and_then(|content| content.lines().find_map(|line| line.strip_prefix("# ").map(str::trim).filter(|value| !value.is_empty()).map(str::to_string)))
        .unwrap_or_else(|| fallback.to_string())
}

fn recovered_id(
    metadata: Option<&storage::MirrorMetadata>,
    expected_kind: &str,
    used_ids: &mut HashSet<String>,
) -> (String, bool) {
    if let Some(metadata) = metadata {
        if metadata.kind.as_deref().is_none_or(|kind| kind == expected_kind) {
            if let Some(candidate) = metadata.id.as_deref().filter(|value| Uuid::parse_str(value).is_ok()) {
                if used_ids.insert(candidate.to_string()) {
                    return (candidate.to_string(), false);
                }
            }
        }
    }
    let id = loop {
        let candidate = storage::new_id();
        if used_ids.insert(candidate.clone()) {
            break candidate;
        }
    };
    (id, true)
}

fn metadata_timestamp(value: Option<&String>, fallback: &str) -> String {
    value.cloned().filter(|value| !value.trim().is_empty()).unwrap_or_else(|| fallback.to_string())
}

fn metadata_parent_id(metadata: Option<&storage::MirrorMetadata>) -> Option<String> {
    metadata.and_then(|value| value.parent_id.clone()).filter(|value| !value.trim().is_empty())
}

fn should_skip_mirror(path: &Path) -> bool {
    path.file_name().and_then(|value| value.to_str()) == Some(".novelforge.md")
}

fn rebuild_nodes_from_markdown(root: &Path, connection: &Connection) -> Result<usize, String> {
    let manuscript = storage::safe_relative(root, "manuscript")?;
    if !manuscript.is_dir() {
        return Ok(0);
    }
    let mut volume_order = 0_i64;
    let mut legacy_count = 0_usize;
    let mut used_ids = HashSet::new();
    let mut id_map = HashMap::new();
    for volume_path in directory_entries(&manuscript)?.into_iter().filter(|path| path.is_dir()) {
        let volume_meta_path = volume_path.join(".novelforge.md");
        let (volume_metadata, _volume_body) = if volume_meta_path.is_file() {
            let raw = fs::read_to_string(&volume_meta_path)
                .map_err(|error| format!("读取卷元数据失败：{}", error))?;
            storage::parse_markdown_mirror(&raw)
        } else {
            (None, String::new())
        };
        let (volume_id, volume_legacy) = recovered_id(volume_metadata.as_ref(), "volume", &mut used_ids);
        if volume_legacy {
            legacy_count += 1;
        }
        if let Some(old_id) = volume_metadata.as_ref().and_then(|metadata| metadata.id.as_ref()) {
            id_map.insert(old_id.clone(), volume_id.clone());
        }
        let volume_name = volume_metadata
            .as_ref()
            .and_then(|metadata| metadata.title.clone())
            .filter(|title| !title.trim().is_empty())
            .or_else(|| volume_meta_path.is_file().then(|| markdown_title(&volume_meta_path, "")))
            .filter(|title| !title.trim().is_empty())
            .unwrap_or_else(|| volume_path.file_name().and_then(|name| name.to_str()).unwrap_or("Recovered Volume").to_string());
        let timestamp = storage::now();
        let volume_status = volume_metadata
            .as_ref()
            .and_then(|metadata| metadata.status.as_deref())
            .unwrap_or(default_status())
            .to_string();
        let volume_created = metadata_timestamp(volume_metadata.as_ref().and_then(|metadata| metadata.created_at.as_ref()), &timestamp);
        let volume_updated = metadata_timestamp(volume_metadata.as_ref().and_then(|metadata| metadata.updated_at.as_ref()), &timestamp);
        let volume_mirror = storage::markdown_volume(&volume_id, &volume_name, &volume_status, &volume_created, &volume_updated);
        if !volume_meta_path.is_file() || volume_metadata.is_none() {
            let _ = storage::atomic_write(&volume_meta_path, volume_mirror.as_bytes());
        }
        let volume_relative = relative_path(root, &volume_path)?;
        insert_node(connection, &NodeRecord {
            id: volume_id.clone(), kind: "volume".to_string(), parent_id: None,
            title: volume_name, order_index: volume_order, status: volume_status,
            file_path: volume_relative, created_at: volume_created, updated_at: volume_updated,
            deleted_at: None, deleted_path: None,
        })?;
        volume_order += 1;
        let chapter_files = directory_entries(&volume_path)?
            .into_iter()
            .filter(|path| path.is_file() && !should_skip_mirror(path) && path.extension().and_then(|value| value.to_str()) == Some("md"))
            .collect::<Vec<_>>();
        for (chapter_order, chapter_path) in chapter_files.into_iter().enumerate() {
            let raw = fs::read_to_string(&chapter_path)
                .map_err(|error| format!("读取章节正文失败：{}", error))?;
            let (metadata, body) = storage::parse_markdown_mirror(&raw);
            let (chapter_id, chapter_legacy) = recovered_id(metadata.as_ref(), "chapter", &mut used_ids);
            if chapter_legacy {
                legacy_count += 1;
            }
            if let Some(old_id) = metadata.as_ref().and_then(|value| value.id.as_ref()) {
                id_map.insert(old_id.clone(), chapter_id.clone());
            }
            let parent_id = metadata_parent_id(metadata.as_ref())
                .and_then(|old_id| id_map.get(&old_id).cloned())
                .or_else(|| Some(volume_id.clone()));
            let fallback_title = chapter_path.file_stem().and_then(|name| name.to_str()).unwrap_or("Recovered Chapter");
            let chapter_title = metadata
                .as_ref()
                .and_then(|value| value.title.clone())
                .filter(|title| !title.trim().is_empty())
                .unwrap_or_else(|| markdown_title(&chapter_path, fallback_title));
            let timestamp = storage::now();
            let chapter_status = metadata
                .as_ref()
                .and_then(|value| value.status.as_deref())
                .unwrap_or("draft")
                .to_string();
            let chapter_created = metadata_timestamp(metadata.as_ref().and_then(|value| value.created_at.as_ref()), &timestamp);
            let chapter_updated = metadata_timestamp(metadata.as_ref().and_then(|value| value.updated_at.as_ref()), &timestamp);
            let chapter_body = replace_markdown_title(&body, &chapter_title);
            let canonical = storage::markdown_node(
                &chapter_id,
                "chapter",
                parent_id.as_deref(),
                &chapter_status,
                &chapter_created,
                &chapter_updated,
                &chapter_body,
            );
            if canonical != raw {
                let _ = storage::atomic_write(&chapter_path, canonical.as_bytes());
            }
            let chapter_relative = relative_path(root, &chapter_path)?;
            insert_node(connection, &NodeRecord {
                id: chapter_id.clone(), kind: "chapter".to_string(), parent_id,
                title: chapter_title.clone(), order_index: chapter_order as i64, status: chapter_status,
                file_path: chapter_relative.clone(), created_at: chapter_created, updated_at: chapter_updated,
                deleted_at: None, deleted_path: None,
            })?;
            storage::index_record(&connection, &chapter_id, "chapter", &chapter_title, &chapter_body, &chapter_relative)?;
            let section_directory = chapter_path.with_extension("");
            if !section_directory.is_dir() {
                continue;
            }
            for (section_order, section_path) in directory_entries(&section_directory)?
                .into_iter()
                .filter(|path| path.is_file() && !should_skip_mirror(path) && path.extension().and_then(|value| value.to_str()) == Some("md"))
                .enumerate()
            {
                let raw = fs::read_to_string(&section_path)
                    .map_err(|error| format!("读取小节正文失败：{}", error))?;
                let (metadata, body) = storage::parse_markdown_mirror(&raw);
                let (section_id, section_legacy) = recovered_id(metadata.as_ref(), "section", &mut used_ids);
                if section_legacy {
                    legacy_count += 1;
                }
                if let Some(old_id) = metadata.as_ref().and_then(|value| value.id.as_ref()) {
                    id_map.insert(old_id.clone(), section_id.clone());
                }
                let parent_id = metadata_parent_id(metadata.as_ref())
                    .and_then(|old_id| id_map.get(&old_id).cloned())
                    .or_else(|| Some(chapter_id.clone()));
                let fallback_title = section_path.file_stem().and_then(|name| name.to_str()).unwrap_or("Recovered Section");
                let section_title = metadata
                    .as_ref()
                    .and_then(|value| value.title.clone())
                    .filter(|title| !title.trim().is_empty())
                    .unwrap_or_else(|| markdown_title(&section_path, fallback_title));
                let timestamp = storage::now();
                let section_status = metadata
                    .as_ref()
                    .and_then(|value| value.status.as_deref())
                    .unwrap_or("draft")
                    .to_string();
                let section_created = metadata_timestamp(metadata.as_ref().and_then(|value| value.created_at.as_ref()), &timestamp);
                let section_updated = metadata_timestamp(metadata.as_ref().and_then(|value| value.updated_at.as_ref()), &timestamp);
                let section_body = replace_markdown_title(&body, &section_title);
                let canonical = storage::markdown_node(
                    &section_id,
                    "section",
                    parent_id.as_deref(),
                    &section_status,
                    &section_created,
                    &section_updated,
                    &section_body,
                );
                if canonical != raw {
                    let _ = storage::atomic_write(&section_path, canonical.as_bytes());
                }
                let section_relative = relative_path(root, &section_path)?;
                insert_node(connection, &NodeRecord {
                    id: section_id.clone(), kind: "section".to_string(), parent_id,
                    title: section_title.clone(), order_index: section_order as i64, status: section_status,
                    file_path: section_relative.clone(), created_at: section_created, updated_at: section_updated,
                    deleted_at: None, deleted_path: None,
                })?;
                storage::index_record(&connection, &section_id, "section", &section_title, &section_body, &section_relative)?;
            }
        }
    }
    Ok(legacy_count)
}

fn parse_entity_value(value: String) -> serde_json::Value {
    let trimmed = value.trim();
    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(trimmed) {
        if !matches!(parsed, serde_json::Value::String(_)) {
            return parsed;
        }
    }
    serde_json::Value::String(value)
}

fn parse_entity_mirror(path: &Path, fallback_title: &str) -> Option<(String, Vec<String>, serde_json::Value, Option<storage::MirrorMetadata>)> {
    let raw = fs::read_to_string(path).ok()?;
    let (metadata, body) = storage::parse_markdown_mirror(&raw);
    let mut title = fallback_title.to_string();
    let mut tags = Vec::new();
    let mut fields = serde_json::Map::new();
    let mut section_key: Option<String> = None;
    let mut section_lines: Vec<String> = Vec::new();
    let mut trailing_lines = Vec::new();
    let mut flush_section = |key: &mut Option<String>, lines: &mut Vec<String>| {
        if let Some(name) = key.take() {
            let value = lines.join("\n").trim().to_string();
            if !value.is_empty() { fields.insert(name, parse_entity_value(value)); }
        }
        lines.clear();
    };
    for line in body.lines() {
        if let Some(value) = line.strip_prefix("# ").map(str::trim).filter(|value| !value.is_empty()) {
            title = value.to_string();
        } else if let Some(value) = line.strip_prefix("标签：") {
            tags = value.split(['、', ',', '，']).map(str::trim).filter(|value| !value.is_empty()).map(str::to_string).collect();
        } else if let Some(value) = line.strip_prefix("## ").map(str::trim).filter(|value| !value.is_empty()) {
            flush_section(&mut section_key, &mut section_lines);
            section_key = Some(value.to_string());
        } else if line.trim().is_empty() && section_key.is_some() && section_lines.iter().any(|value| !value.trim().is_empty()) {
            flush_section(&mut section_key, &mut section_lines);
        } else if section_key.is_some() {
            section_lines.push(line.to_string());
        } else if !line.trim().is_empty() {
            trailing_lines.push(line.to_string());
        }
    }
    flush_section(&mut section_key, &mut section_lines);
    if !trailing_lines.is_empty() && !fields.contains_key("description") {
        fields.insert("description".to_string(), serde_json::Value::String(trailing_lines.join("\n").trim().to_string()));
    }
    Some((title, tags, serde_json::Value::Object(fields), metadata))
}

fn rebuild_entities_from_markdown(root: &Path, connection: &Connection) -> Result<usize, String> {
    let mut legacy_count = 0_usize;
    let mut used_ids = HashSet::new();
    for (kind, directory) in [
        ("character", "characters"), ("location", "locations"), ("world", "world"),
        ("timeline", "timeline"), ("outline", "outlines"), ("scene", "scenes"),
        ("foreshadowing", "foreshadowing"), ("relationship", "relationships"), ("note", "notes"),
    ] {
        let directory_path = storage::safe_relative(root, directory)?;
        if !directory_path.is_dir() {
            continue;
        }
        for path in directory_entries(&directory_path)?.into_iter().filter(|path| path.is_file() && path.extension().and_then(|value| value.to_str()) == Some("md")) {
            let fallback = path.file_stem().and_then(|name| name.to_str()).unwrap_or("Recovered Entry");
            let Some((title, tags, content, metadata)) = parse_entity_mirror(&path, fallback) else { continue };
            let (id, legacy) = recovered_id(metadata.as_ref(), kind, &mut used_ids);
            if legacy {
                legacy_count += 1;
            }
            let relative = relative_path(root, &path)?;
            let timestamp = storage::now();
            let created_at = metadata_timestamp(metadata.as_ref().and_then(|value| value.created_at.as_ref()), &timestamp);
            let updated_at = metadata_timestamp(metadata.as_ref().and_then(|value| value.updated_at.as_ref()), &timestamp);
            let canonical = storage::markdown_entity_with_metadata(
                &id,
                kind,
                &created_at,
                &updated_at,
                &title,
                &content,
                &tags,
            );
            let raw = fs::read_to_string(&path).map_err(|error| format!("读取资料镜像失败：{}", error))?;
            if canonical != raw {
                let _ = storage::atomic_write(&path, canonical.as_bytes());
            }
            connection.execute(
                "INSERT INTO entities (id, kind, title, content_json, tags_json, file_path, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                rusqlite::params![id, kind, title, content.to_string(), serde_json::to_string(&tags).map_err(|error| format!("恢复资料标签失败：{}", error))?, relative, created_at, updated_at],
            ).map_err(|error| format!("恢复资料条目失败：{}", error))?;
            storage::index_record(connection, &id, kind, &title, &content.to_string(), &relative)?;
        }
    }
    Ok(legacy_count)
}

fn rebuild_history_from_files(root: &Path, connection: &Connection) -> Result<usize, String> {
    let history_root = storage::safe_relative(root, ".novelforge/history")?;
    if !history_root.is_dir() {
        return Ok(0);
    }
    let nodes = storage::all_nodes(connection, false)?;
    let mut restored = 0_usize;
    for node_directory in directory_entries(&history_root)?.into_iter().filter(|path| path.is_dir()) {
        let node_id = node_directory.file_name().and_then(|value| value.to_str()).unwrap_or_default();
        let Some(node) = nodes.iter().find(|candidate| candidate.id == node_id && candidate.kind != "volume") else {
            continue;
        };
        for path in directory_entries(&node_directory)?.into_iter().filter(|path| path.is_file() && path.extension().and_then(|value| value.to_str()) == Some("md")) {
            let revision_id = path.file_stem().and_then(|value| value.to_str()).unwrap_or_default();
            if Uuid::parse_str(revision_id).is_err() {
                continue;
            }
            let raw = fs::read_to_string(&path)
                .map_err(|error| format!("读取历史快照失败：{}", error))?;
            let content = storage::strip_markdown_frontmatter(&raw);
            let relative = relative_path(root, &path)?;
            let created_at = storage::now();
            let changed = connection.execute(
                "INSERT OR IGNORE INTO revisions (id, node_id, node_title, reason, word_count, created_at, file_path) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    revision_id,
                    node.id,
                    node.title,
                    "恢复的历史快照",
                    storage::word_count(&content) as i64,
                    created_at,
                    relative,
                ],
            ).map_err(|error| format!("恢复历史快照索引失败：{}", error))?;
            restored += changed as usize;
        }
    }
    Ok(restored)
}

fn recovered_project_connection(root: &Path) -> Result<Connection, String> {
    let backup = storage::quarantine_database(root)?;
    let connection = storage::open_db(root)?;
    let legacy_nodes = rebuild_nodes_from_markdown(root, &connection)?;
    let legacy_entities = rebuild_entities_from_markdown(root, &connection)?;
    let _ = rebuild_history_from_files(root, &connection)?;
    if backup.is_some() { let _ = storage::append_log(root, "WARN", "database_recovered"); }
    if legacy_nodes > 0 || legacy_entities > 0 {
        let _ = storage::append_log(root, "WARN", "database_recovery_legacy_metadata");
    }
    Ok(connection)
}

fn validate_target_parent(
    nodes: &[NodeRecord],
    node_kind: &str,
    target_parent_id: Option<&str>,
) -> Result<Option<NodeRecord>, String> {
    let parent = target_parent_id
        .map(|id| {
            nodes
                .iter()
                .find(|node| node.id == id)
                .cloned()
                .ok_or_else(|| "目标父节点不存在".to_string())
        })
        .transpose()?;
    match node_kind {
        "volume" if parent.is_some() => Err("卷不能移动到其他节点下面".to_string()),
        "volume" => Ok(parent),
        "chapter" if parent.as_ref().is_some_and(|node| node.kind == "volume") => Ok(parent),
        "section" if parent.as_ref().is_some_and(|node| node.kind == "chapter") => Ok(parent),
        "chapter" => Err("章节只能放在卷下面".to_string()),
        "section" => Err("小节只能放在章节下面".to_string()),
        _ => Err("节点类型无效".to_string()),
    }
}

fn node_path_available(
    root: &Path,
    nodes: &[NodeRecord],
    relative: &str,
    kind: &str,
    ignored_ids: &HashSet<String>,
) -> Result<bool, String> {
    if nodes.iter().any(|node| !ignored_ids.contains(&node.id) && node.file_path == relative) {
        return Ok(false);
    }
    let absolute = storage::safe_relative(root, relative)?;
    let sidecar_occupied = kind == "chapter" && absolute.with_extension("").exists();
    Ok(!absolute.exists() && !sidecar_occupied)
}

fn next_node_location_excluding(
    root: &Path,
    nodes: &[NodeRecord],
    kind: &str,
    parent: Option<&NodeRecord>,
    ignored_ids: &HashSet<String>,
) -> Result<(String, i64), String> {
    let prefix = match kind {
        "volume" => "manuscript/volume_".to_string(),
        "chapter" => format!("{}/chapter_", parent.ok_or_else(|| "章节缺少目标卷".to_string())?.file_path),
        "section" => {
            let chapter_dir = Path::new(&parent.ok_or_else(|| "小节缺少目标章节".to_string())?.file_path)
                .with_extension("")
                .to_string_lossy()
                .replace('\\', "/");
            format!("{}/section_", chapter_dir)
        }
        _ => return Err("节点类型无效".to_string()),
    };
    for index in 1_i64..100_000 {
        let relative = if kind == "volume" {
            format!("{}{:03}", prefix, index)
        } else {
            format!("{}{:03}.md", prefix, index)
        };
        if node_path_available(root, nodes, &relative, kind, ignored_ids)? {
            let sibling_order = nodes
                .iter()
                .filter(|node| node.deleted_at.is_none() && !ignored_ids.contains(&node.id) && node.parent_id.as_deref() == parent.map(|item| item.id.as_str()))
                .map(|node| node.order_index)
                .max()
                .unwrap_or(-1)
                + 1;
            return Ok((relative, sibling_order));
        }
    }
    Err("无法为节点分配新的文件路径".to_string())
}

fn next_node_location(
    root: &Path,
    nodes: &[NodeRecord],
    kind: &str,
    parent: Option<&NodeRecord>,
) -> Result<(String, i64), String> {
    next_node_location_excluding(root, nodes, kind, parent, &HashSet::new())
}

fn replace_path_prefix(path: &str, old_prefix: &str, new_prefix: &str) -> String {
    if path == old_prefix {
        return new_prefix.to_string();
    }
    let boundary = format!("{}/", old_prefix.trim_end_matches('/'));
    if let Some(rest) = path.strip_prefix(&boundary) {
        format!("{}/{}", new_prefix.trim_end_matches('/'), rest)
    } else {
        path.to_string()
    }
}

fn node_path_prefix(node: &NodeRecord) -> String {
    if node.kind == "chapter" {
        Path::new(&node.file_path)
            .with_extension("")
            .to_string_lossy()
            .replace('\\', "/")
    } else {
        node.file_path.clone()
    }
}

fn copy_path_recursive(source: &Path, target: &Path) -> Result<(), String> {
    let metadata = fs::symlink_metadata(source)
        .map_err(|error| format!("读取节点文件失败：{}", error))?;
    if metadata.file_type().is_symlink() {
        return Err("不支持复制符号链接节点".to_string());
    }
    if metadata.is_dir() {
        fs::create_dir_all(target).map_err(|error| format!("创建复制目录失败：{}", error))?;
        for entry in fs::read_dir(source).map_err(|error| format!("读取复制目录失败：{}", error))? {
            let entry = entry.map_err(|error| format!("读取复制目录项失败：{}", error))?;
            copy_path_recursive(&entry.path(), &target.join(entry.file_name()))?;
        }
    } else {
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|error| format!("创建复制父目录失败：{}", error))?;
        }
        fs::copy(source, target).map_err(|error| format!("复制节点文件失败：{}", error))?;
    }
    Ok(())
}

fn remove_path_if_exists(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    if path.is_dir() {
        fs::remove_dir_all(path).map_err(|error| format!("清理复制节点失败：{}", error))
    } else {
        fs::remove_file(path).map_err(|error| format!("清理复制节点失败：{}", error))
    }
}

fn move_node_files(source: &Path, target: &Path, kind: &str) -> Result<bool, String> {
    if !source.exists() {
        return Err(format!("节点文件不存在：{}", source.display()));
    }
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("创建目标目录失败：{}", error))?;
    }
    fs::rename(source, target).map_err(|error| format!("移动节点文件失败：{}", error))?;
    if kind == "chapter" {
        let source_sidecar = source.with_extension("");
        let target_sidecar = target.with_extension("");
        if source_sidecar.exists() {
            if let Err(error) = fs::rename(&source_sidecar, &target_sidecar) {
                let _ = fs::rename(target, source);
                return Err(format!("移动章节小节目录失败：{}", error));
            }
            return Ok(true);
        }
    }
    Ok(false)
}

fn rollback_node_move(source: &Path, target: &Path, kind: &str, sidecar_moved: bool) {
    if sidecar_moved {
        let _ = fs::rename(target.with_extension(""), source.with_extension(""));
    }
    let _ = fs::rename(target, source);
    if kind == "chapter" {
        let _ = fs::create_dir_all(source.parent().unwrap_or_else(|| Path::new(".")));
    }
}

fn move_node_to_trash(
    root: &Path,
    original: &Path,
    kind: &str,
    ref_id: &str,
) -> Result<(String, bool), String> {
    let trash_path = storage::move_to_trash(root, original, ref_id)?;
    if kind != "chapter" {
        return Ok((trash_path, false));
    }
    let sidecar_source = original.with_extension("");
    if !sidecar_source.exists() {
        return Ok((trash_path, false));
    }
    let sidecar_target = PathBuf::from(&trash_path).with_extension("");
    if let Err(error) = fs::rename(&sidecar_source, &sidecar_target) {
        let _ = fs::rename(Path::new(&trash_path), original);
        return Err(format!("移动章节小节目录到回收站失败：{}", error));
    }
    Ok((trash_path, true))
}

fn restore_node_from_trash(
    original: &Path,
    trash_path: &Path,
    kind: &str,
    sidecar_moved: bool,
) -> Result<(), String> {
    fs::rename(trash_path, original)
        .map_err(|error| format!("恢复节点文件失败：{}", error))?;
    if kind == "chapter" && sidecar_moved {
        let trash_sidecar = trash_path.with_extension("");
        let original_sidecar = original.with_extension("");
        if let Err(error) = fs::rename(&trash_sidecar, &original_sidecar) {
            let _ = fs::rename(original, trash_path);
            return Err(format!("恢复章节小节目录失败：{}", error));
        }
    }
    Ok(())
}

fn default_status() -> &'static str {
    "not-started"
}

fn touch_project_best_effort(root: &Path, event: &str) {
    if storage::touch_project(root).is_err() {
        let _ = storage::append_log(root, "WARN", event);
    }
}

fn replace_markdown_title(content: &str, title: &str) -> String {
    let content = storage::strip_markdown_frontmatter(content);
    if content.starts_with("# ") {
        let end = content.find('\n').unwrap_or(content.len());
        return format!("# {}{}", title, &content[end..]);
    }
    format!("# {}\n\n{}", title, content)
}

fn rewrite_node_mirror(
    root: &Path,
    node: &NodeRecord,
    file_path: &str,
    parent_id: Option<&str>,
    title: &str,
    updated_at: &str,
) -> Result<(), String> {
    let path = storage::safe_relative(root, file_path)?;
    if node.kind == "volume" {
        let mirror = storage::markdown_volume(
            &node.id,
            title,
            &node.status,
            &node.created_at,
            updated_at,
        );
        return storage::atomic_write(&path.join(".novelforge.md"), mirror.as_bytes());
    }
    let raw = fs::read_to_string(&path)
        .map_err(|error| format!("读取节点正文失败：{}", error))?;
    let body = replace_markdown_title(&raw, title);
    let mirror = storage::markdown_node(
        &node.id,
        &node.kind,
        parent_id,
        &node.status,
        &node.created_at,
        updated_at,
        &body,
    );
    storage::atomic_write(&path, mirror.as_bytes())
}

#[tauri::command]
pub fn create_project(input: ProjectInput) -> Result<ProjectData, String> {
    if input.title.trim().is_empty() {
        return Err("作品名不能为空".to_string());
    }
    let root = storage::new_project_root(&input.path)?;
    storage::create_project_directories(&root)?;
    let timestamp = storage::now();
    let metadata = ProjectMetadata {
        format_version: 1,
        id: storage::new_id(),
        title: input.title.trim().to_string(),
        author: input.author.trim().to_string(),
        description: input.description.trim().to_string(),
        genre: input.genre.trim().to_string(),
        target_words: input.target_words,
        created_at: timestamp.clone(),
        updated_at: timestamp.clone(),
    };
    storage::write_project_json(&root, &metadata)?;
    let connection = storage::open_db(&root)?;

    let volume_id = storage::new_id();
    let volume_path = "manuscript/volume_001".to_string();
    let volume_absolute = storage::safe_relative(&root, &volume_path)?;
    fs::create_dir_all(&volume_absolute)
        .map_err(|error| format!("无法创建初始卷：{}", error))?;
    let volume_status = default_status().to_string();
    let volume_mirror = storage::markdown_volume(
        &volume_id,
        "第一卷",
        &volume_status,
        &timestamp,
        &timestamp,
    );
    storage::atomic_write(&volume_absolute.join(".novelforge.md"), volume_mirror.as_bytes())?;
    insert_node(
        &connection,
        &NodeRecord {
            id: volume_id.clone(),
            kind: "volume".to_string(),
            parent_id: None,
            title: "第一卷".to_string(),
            order_index: 0,
            status: volume_status,
            file_path: volume_path,
            created_at: timestamp.clone(),
            updated_at: timestamp.clone(),
            deleted_at: None,
            deleted_path: None,
        },
    )?;

    let chapter_id = storage::new_id();
    let chapter_path = "manuscript/volume_001/chapter_001.md".to_string();
    let chapter = NodeRecord {
        id: chapter_id.clone(),
        kind: "chapter".to_string(),
        parent_id: Some(volume_id),
        title: "第一章".to_string(),
        order_index: 0,
        status: "draft".to_string(),
        file_path: chapter_path.clone(),
        created_at: timestamp.clone(),
        updated_at: timestamp,
        deleted_at: None,
        deleted_path: None,
    };
    let starter_body = "# 第一章\n\n从这里开始你的故事。\n";
    let starter = storage::markdown_node(
        &chapter.id,
        &chapter.kind,
        chapter.parent_id.as_deref(),
        &chapter.status,
        &chapter.created_at,
        &chapter.updated_at,
        starter_body,
    );
    storage::atomic_write(&storage::safe_relative(&root, &chapter_path)?, starter.as_bytes())?;
    insert_node(&connection, &chapter)?;
    storage::index_record(&connection, &chapter.id, &chapter.kind, &chapter.title, starter_body, &chapter.file_path)?;
    let _ = storage::append_log(&root, "INFO", "project_created");
    project_data(&root, &connection)
}

#[tauri::command]
pub fn open_project(path: String) -> Result<ProjectData, String> {
    let root = storage::existing_project_root(&path)?;
    let connection = match storage::open_db(&root) {
        Ok(connection) if storage::all_nodes(&connection, false).is_ok() && storage::all_entities(&connection, false).is_ok() => connection,
        Ok(connection) => {
            drop(connection);
            recovered_project_connection(&root)?
        }
        Err(_) => recovered_project_connection(&root)?,
    };
    if storage::all_nodes(&connection, false)?.is_empty() {
        rebuild_nodes_from_markdown(&root, &connection)?;
        rebuild_history_from_files(&root, &connection)?;
    }
    if storage::all_entities(&connection, false)?.is_empty() {
        rebuild_entities_from_markdown(&root, &connection)?;
    }
    storage::refresh_search_index(&root, &connection)?;
    let _ = storage::append_log(&root, "INFO", "project_opened");
    project_data(&root, &connection)
}

#[tauri::command]
pub fn list_documents(path: String) -> Result<Vec<NodeRecord>, String> {
    let (_root, connection) = project_connection(&path)?;
    storage::all_nodes(&connection, false)
}

#[tauri::command]
pub fn create_node(input: NodeInput) -> Result<ProjectData, String> {
    if input.title.trim().is_empty() {
        return Err("名称不能为空".to_string());
    }
    if input.kind != "volume" && input.kind != "chapter" && input.kind != "section" {
        return Err("只能创建卷、章或节".to_string());
    }
    if input.kind == "volume" && input.parent_id.is_some() {
        return Err("卷不能放在其他节点下".to_string());
    }
    if input.kind != "volume" && input.parent_id.is_none() {
        return Err("章节和小节需要选择父节点".to_string());
    }
    let (root, mut connection) = project_connection(&input.project_path)?;
    let parent = match input.parent_id.as_deref() {
        Some(parent_id) => storage::node_from_id(&connection, parent_id)?
            .ok_or_else(|| "父节点不存在".to_string())?,
        None => NodeRecord {
            id: String::new(),
            kind: String::new(),
            parent_id: None,
            title: String::new(),
            order_index: 0,
            status: String::new(),
            file_path: String::new(),
            created_at: String::new(),
            updated_at: String::new(),
            deleted_at: None,
            deleted_path: None,
        },
    };
    let expected_parent_kind = match input.kind.as_str() {
        "chapter" => "volume",
        "section" => "chapter",
        _ => "",
    };
    if !expected_parent_kind.is_empty() && parent.kind != expected_parent_kind {
        return Err(format!("{}只能创建在{}下面", input.kind, expected_parent_kind));
    }
    if parent.deleted_at.is_some() {
        return Err("父节点不存在或已在回收站".to_string());
    }
    let allocation_nodes = storage::all_nodes(&connection, true)?;
    let node_id = storage::new_id();
    let timestamp = storage::now();
    let (file_path, order_index) = next_node_location(
        &root,
        &allocation_nodes,
        &input.kind,
        input.parent_id.as_ref().map(|_| &parent),
    )?;
    let absolute_path = storage::safe_relative(&root, &file_path)?;
    if input.kind == "volume" {
        fs::create_dir_all(&absolute_path).map_err(|error| format!("创建卷目录失败：{}", error))?;
    }
    let node = NodeRecord {
        id: node_id,
        kind: input.kind,
        parent_id: input.parent_id,
        title: input.title.trim().to_string(),
        order_index,
        status: default_status().to_string(),
        file_path,
        created_at: timestamp.clone(),
        updated_at: timestamp,
        deleted_at: None,
        deleted_path: None,
    };
    if node.kind == "volume" {
        let metadata = storage::markdown_volume(
            &node.id,
            &node.title,
            &node.status,
            &node.created_at,
            &node.updated_at,
        );
        storage::atomic_write(&absolute_path.join(".novelforge.md"), metadata.as_bytes())?;
    } else {
        let content = format!("# {}\n\n", node.title);
        let markdown = storage::markdown_node(
            &node.id,
            &node.kind,
            node.parent_id.as_deref(),
            &node.status,
            &node.created_at,
            &node.updated_at,
            &content,
        );
        storage::atomic_write(&absolute_path, markdown.as_bytes())?;
    }
    let database_result = (|| -> Result<(), String> {
        let transaction = connection
            .transaction()
            .map_err(|error| format!("无法开始创建节点事务：{}", error))?;
        insert_node(&transaction, &node)?;
        if node.kind != "volume" {
            let content = fs::read_to_string(&absolute_path)
                .map_err(|error| format!("读取新建正文失败：{}", error))?;
            let content = storage::strip_markdown_frontmatter(&content);
            storage::index_record(&transaction, &node.id, &node.kind, &node.title, &content, &node.file_path)?;
        }
        transaction.commit().map_err(|error| format!("提交创建节点失败：{}", error))
    })();
    if let Err(error) = database_result {
        let _ = remove_path_if_exists(&absolute_path);
        return Err(error);
    }
    touch_project_best_effort(&root, "project_metadata_touch_failed");
    project_data(&root, &connection)
}

#[tauri::command]
pub fn rename_node(input: crate::models::RenameNodeInput) -> Result<ProjectData, String> {
    if input.title.trim().is_empty() {
        return Err("名称不能为空".to_string());
    }
    let (root, mut connection) = project_connection(&input.project_path)?;
    let current = storage::node_from_id(&connection, &input.node_id)?
        .ok_or_else(|| "节点不存在".to_string())?;
    if current.deleted_at.is_some() {
        return Err("节点不存在或已在回收站".to_string());
    }
    let next_title = input.title.trim().to_string();
    let mirror_path = if current.kind == "volume" {
        Some(storage::safe_relative(&root, &current.file_path)?.join(".novelforge.md"))
    } else {
        Some(storage::safe_relative(&root, &current.file_path)?)
    };
    let old_raw_content = mirror_path
        .as_ref()
        .filter(|path| path.is_file())
        .map(|path| fs::read_to_string(path).map_err(|error| format!("读取正文失败：{}", error)))
        .transpose()?;
    let old_body_content = old_raw_content
        .as_deref()
        .map(storage::strip_markdown_frontmatter);
    let next_timestamp = storage::now();
    let next_raw_content = if current.kind == "volume" {
        Some(storage::markdown_volume(
            &current.id,
            &next_title,
            &current.status,
            &current.created_at,
            &next_timestamp,
        ))
    } else {
        old_body_content.as_ref().map(|content| {
            let body = replace_markdown_title(content, &next_title);
            storage::markdown_node(
                &current.id,
                &current.kind,
                current.parent_id.as_deref(),
                &current.status,
                &current.created_at,
                &next_timestamp,
                &body,
            )
        })
    };
    if let (Some(path), Some(content)) = (mirror_path.as_ref(), next_raw_content.as_deref()) {
        if old_raw_content.as_deref() != Some(content) {
            storage::atomic_write(path, content.as_bytes())?;
        }
    }
    let database_result = (|| -> Result<(), String> {
        let transaction = connection
            .transaction()
            .map_err(|error| format!("无法开始重命名事务：{}", error))?;
        let changed = transaction
            .execute(
                "UPDATE nodes SET title = ?1, updated_at = ?2 WHERE id = ?3 AND deleted_at IS NULL",
                params![next_title, next_timestamp, input.node_id],
            )
            .map_err(|error| format!("重命名节点失败：{}", error))?;
        if changed == 0 {
            return Err("节点不存在或已在回收站".to_string());
        }
        if let Some(content) = old_body_content
            .as_ref()
            .map(|content| replace_markdown_title(content, &next_title))
        {
            storage::index_record(&transaction, &current.id, &current.kind, &next_title, &content, &current.file_path)?;
        }
        transaction.commit().map_err(|error| format!("提交重命名事务失败：{}", error))
    })();
    if let Err(error) = database_result {
        if let (Some(target), Some(content)) = (mirror_path.as_ref(), old_raw_content.as_deref()) {
            if let Err(rollback_error) = restore_document_after_save_failure(target, true, content) {
                return Err(format!("{}；正文回滚失败：{}", error, rollback_error));
            }
        }
        return Err(error);
    }
    touch_project_best_effort(&root, "project_metadata_touch_failed");
    project_data(&root, &connection)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeStatusInput {
    pub project_path: String,
    pub node_id: String,
    pub status: String,
}

#[tauri::command]
pub fn set_node_status(input: NodeStatusInput) -> Result<ProjectData, String> {
    let allowed = ["not-started", "draft", "first-draft", "editing", "done", "locked"];
    if !allowed.contains(&input.status.as_str()) {
        return Err("状态无效".to_string());
    }
    let (root, connection) = project_connection(&input.project_path)?;
    let changed = connection
        .execute(
            "UPDATE nodes SET status = ?1, updated_at = ?2 WHERE id = ?3 AND deleted_at IS NULL",
            params![input.status, storage::now(), input.node_id],
        )
        .map_err(|error| format!("更新章节状态失败：{}", error))?;
    if changed == 0 {
        return Err("节点不存在或已在回收站".to_string());
    }
    storage::touch_project(&root)?;
    project_data(&root, &connection)
}

#[tauri::command]
pub fn reorder_node(input: crate::models::ReorderNodeInput) -> Result<ProjectData, String> {
    if input.direction != "up" && input.direction != "down" {
        return Err("排序方向无效".to_string());
    }
    let (root, mut connection) = project_connection(&input.project_path)?;
    let current = storage::node_from_id(&connection, &input.node_id)?
        .ok_or_else(|| "节点不存在".to_string())?;
    if current.deleted_at.is_some() {
        return Err("节点不存在或已在回收站".to_string());
    }
    let neighbour_order = if input.direction == "up" {
        current.order_index - 1
    } else {
        current.order_index + 1
    };
    let neighbour_id: Option<String> = connection
        .query_row(
            "SELECT id FROM nodes WHERE parent_id IS ?1 AND order_index = ?2 AND deleted_at IS NULL",
            params![current.parent_id, neighbour_order],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| format!("查找相邻节点失败：{}", error))?;
    if let Some(neighbour_id) = neighbour_id {
        let transaction = connection
            .transaction()
            .map_err(|error| format!("无法开始排序事务：{}", error))?;
        transaction
            .execute("UPDATE nodes SET order_index = ?1 WHERE id = ?2 AND deleted_at IS NULL", params![neighbour_order, current.id])
            .map_err(|error| format!("更新节点顺序失败：{}", error))?;
        transaction
            .execute("UPDATE nodes SET order_index = ?1 WHERE id = ?2 AND deleted_at IS NULL", params![current.order_index, neighbour_id])
            .map_err(|error| format!("更新节点顺序失败：{}", error))?;
        transaction
            .commit()
            .map_err(|error| format!("提交节点排序失败：{}", error))?;
    }
    storage::touch_project(&root)?;
    project_data(&root, &connection)
}

#[tauri::command]
pub fn move_node(input: MoveNodeInput) -> Result<ProjectData, String> {
    let (root, mut connection) = project_connection(&input.project_path)?;
    let nodes = storage::all_nodes(&connection, false)?;
    let allocation_nodes = storage::all_nodes(&connection, true)?;
    let current = nodes
        .iter()
        .find(|node| node.id == input.node_id)
        .cloned()
        .ok_or_else(|| "节点不存在或已在回收站".to_string())?;
    let target_parent_id = input.target_parent_id.as_deref();
    let target_parent = validate_target_parent(&nodes, &current.kind, target_parent_id)?;
    let descendants = descendant_ids(&nodes, &current.id);
    if target_parent_id.is_some_and(|id| descendants.iter().any(|item| item == id)) {
        return Err("不能将节点移动到自己的后代下面".to_string());
    }

    let sibling_count: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM nodes WHERE parent_id IS ?1 AND deleted_at IS NULL",
            params![target_parent_id],
            |row| row.get(0),
        )
        .map_err(|error| format!("读取目标顺序失败：{}", error))?;
    let requested_order = input.target_order_index.unwrap_or(sibling_count);
    let max_order = if current.parent_id.as_deref() == target_parent_id {
        sibling_count.saturating_sub(1)
    } else {
        sibling_count
    };
    let target_order = requested_order.clamp(0, max_order);

    if current.parent_id.as_deref() == target_parent_id {
        if target_order != current.order_index {
            let transaction = connection
                .transaction()
                .map_err(|error| format!("无法开始排序事务：{}", error))?;
            if target_order < current.order_index {
                transaction
                    .execute(
                        "UPDATE nodes SET order_index = order_index + 1 WHERE parent_id IS ?1 AND order_index >= ?2 AND order_index < ?3 AND deleted_at IS NULL",
                        params![current.parent_id.clone(), target_order, current.order_index],
                    )
                    .map_err(|error| format!("更新节点顺序失败：{}", error))?;
            } else {
                transaction
                    .execute(
                        "UPDATE nodes SET order_index = order_index - 1 WHERE parent_id IS ?1 AND order_index > ?2 AND order_index <= ?3 AND deleted_at IS NULL",
                        params![current.parent_id.clone(), current.order_index, target_order],
                    )
                    .map_err(|error| format!("更新节点顺序失败：{}", error))?;
            }
            transaction
                .execute(
                    "UPDATE nodes SET order_index = ?1, updated_at = ?2 WHERE id = ?3",
                    params![target_order, storage::now(), current.id],
                )
                .map_err(|error| format!("更新节点顺序失败：{}", error))?;
            transaction
                .commit()
                .map_err(|error| format!("提交节点排序失败：{}", error))?;
            storage::touch_project(&root)?;
        }
        return project_data(&root, &connection);
    }

    let (target_path, _) = next_node_location(&root, &allocation_nodes, &current.kind, target_parent.as_ref())?;
    let source_absolute = storage::safe_relative(&root, &current.file_path)?;
    let target_absolute = storage::safe_relative(&root, &target_path)?;
    let sidecar_moved = move_node_files(&source_absolute, &target_absolute, &current.kind)?;
    let timestamp = storage::now();
    let current_prefix = node_path_prefix(&current);
    let target_prefix = node_path_prefix(&NodeRecord {
        file_path: target_path.clone(),
        kind: current.kind.clone(),
        id: current.id.clone(),
        parent_id: current.parent_id.clone(),
        title: current.title.clone(),
        order_index: current.order_index,
        status: current.status.clone(),
        created_at: current.created_at.clone(),
        updated_at: current.updated_at.clone(),
        deleted_at: None,
        deleted_path: None,
    });
    if let Err(error) = rewrite_node_mirror(
        &root,
        &current,
        &target_path,
        target_parent_id,
        &current.title,
        &timestamp,
    ) {
        rollback_node_move(&source_absolute, &target_absolute, &current.kind, sidecar_moved);
        return Err(error);
    }
    let database_result = (|| -> Result<(), String> {
        let transaction = connection
            .transaction()
            .map_err(|error| format!("无法开始移动事务：{}", error))?;
        transaction
            .execute(
                "UPDATE nodes SET order_index = order_index - 1 WHERE parent_id IS ?1 AND order_index > ?2 AND deleted_at IS NULL",
                params![current.parent_id.clone(), current.order_index],
            )
            .map_err(|error| format!("整理原父节点顺序失败：{}", error))?;
        transaction
            .execute(
                "UPDATE nodes SET order_index = order_index + 1 WHERE parent_id IS ?1 AND order_index >= ?2 AND deleted_at IS NULL",
                params![target_parent_id, target_order],
            )
            .map_err(|error| format!("整理目标父节点顺序失败：{}", error))?;
        transaction
            .execute(
                "UPDATE nodes SET parent_id = ?1, order_index = ?2, file_path = ?3, updated_at = ?4 WHERE id = ?5",
                params![target_parent_id, target_order, target_path, timestamp, current.id],
            )
            .map_err(|error| format!("更新移动节点失败：{}", error))?;
        for node in nodes.iter().filter(|node| node.id != current.id && descendants.iter().any(|id| id == &node.id)) {
            let next_path = replace_path_prefix(&node.file_path, &current_prefix, &target_prefix);
            transaction
                .execute(
                    "UPDATE nodes SET file_path = ?1, updated_at = ?2 WHERE id = ?3",
                    params![next_path, timestamp, node.id],
                )
                .map_err(|error| format!("更新子节点路径失败：{}", error))?;
        }
        transaction
            .commit()
            .map_err(|error| format!("提交节点移动失败：{}", error))?;
        Ok(())
    })();
    if let Err(error) = database_result {
        rollback_node_move(&source_absolute, &target_absolute, &current.kind, sidecar_moved);
        return Err(error);
    }
    storage::refresh_search_index(&root, &connection)?;
    storage::touch_project(&root)?;
    project_data(&root, &connection)
}

#[tauri::command]
pub fn copy_node(input: CopyNodeInput) -> Result<ProjectData, String> {
    let (root, mut connection) = project_connection(&input.project_path)?;
    let nodes = storage::all_nodes(&connection, false)?;
    let allocation_nodes = storage::all_nodes(&connection, true)?;
    let current = nodes
        .iter()
        .find(|node| node.id == input.node_id)
        .cloned()
        .ok_or_else(|| "节点不存在或已在回收站".to_string())?;
    let target_parent = validate_target_parent(&nodes, &current.kind, input.target_parent_id.as_deref())?;
    let descendants = descendant_ids(&nodes, &current.id);
    let target_parent_id = input.target_parent_id.as_deref();
    if target_parent_id.is_some_and(|id| descendants.iter().any(|item| item == id)) {
        return Err("不能将节点复制到自己的后代下面".to_string());
    }
    let (target_path, target_order) = next_node_location(&root, &allocation_nodes, &current.kind, target_parent.as_ref())?;
    let source_absolute = storage::safe_relative(&root, &current.file_path)?;
    let target_absolute = storage::safe_relative(&root, &target_path)?;
    copy_path_recursive(&source_absolute, &target_absolute)?;
    if current.kind == "chapter" {
        let source_sidecar = source_absolute.with_extension("");
        let target_sidecar = target_absolute.with_extension("");
        if source_sidecar.exists() {
            if let Err(error) = copy_path_recursive(&source_sidecar, &target_sidecar) {
                let _ = remove_path_if_exists(&target_absolute);
                return Err(error);
            }
        }
    }

    let timestamp = storage::now();
    let mut id_map = HashMap::new();
    for node in nodes.iter().filter(|node| descendants.iter().any(|id| id == &node.id)) {
        id_map.insert(node.id.clone(), storage::new_id());
    }
    let copied_root_title = input
        .title
        .as_deref()
        .map(str::trim)
        .filter(|title| !title.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| format!("{} 副本", current.title));
    let current_prefix = node_path_prefix(&current);
    let target_prefix = node_path_prefix(&NodeRecord {
        file_path: target_path.clone(),
        kind: current.kind.clone(),
        id: current.id.clone(),
        parent_id: target_parent_id.map(str::to_string),
        title: copied_root_title.clone(),
        order_index: target_order,
        status: current.status.clone(),
        created_at: timestamp.clone(),
        updated_at: timestamp.clone(),
        deleted_at: None,
        deleted_path: None,
    });
    for node in nodes.iter().filter(|node| descendants.iter().any(|id| id == &node.id)) {
        let new_id = id_map
            .get(&node.id)
            .ok_or_else(|| "复制节点 ID 映射失败".to_string())?;
        let new_parent_id = if node.id == current.id {
            target_parent_id.map(str::to_string)
        } else {
            node.parent_id
                .as_ref()
                .and_then(|id| id_map.get(id))
                .cloned()
        };
        let new_title = if node.id == current.id {
            copied_root_title.clone()
        } else {
            node.title.clone()
        };
        let new_path = if node.id == current.id {
            target_path.clone()
        } else {
            replace_path_prefix(&node.file_path, &current_prefix, &target_prefix)
        };
        let copied_node = NodeRecord {
            id: new_id.clone(),
            kind: node.kind.clone(),
            parent_id: new_parent_id.clone(),
            title: new_title.clone(),
            order_index: if node.id == current.id { target_order } else { node.order_index },
            status: node.status.clone(),
            file_path: new_path.clone(),
            created_at: timestamp.clone(),
            updated_at: timestamp.clone(),
            deleted_at: None,
            deleted_path: None,
        };
        if let Err(error) = rewrite_node_mirror(
            &root,
            &copied_node,
            &new_path,
            new_parent_id.as_deref(),
            &new_title,
            &timestamp,
        ) {
            let _ = remove_path_if_exists(&target_absolute);
            if current.kind == "chapter" {
                let _ = remove_path_if_exists(&target_absolute.with_extension(""));
            }
            return Err(error);
        }
    }
    let database_result = (|| -> Result<(), String> {
        let transaction = connection
            .transaction()
            .map_err(|error| format!("无法开始复制事务：{}", error))?;
        for node in nodes.iter().filter(|node| descendants.iter().any(|id| id == &node.id)) {
            let new_id = id_map
                .get(&node.id)
                .ok_or_else(|| "复制节点 ID 映射失败".to_string())?;
            let new_parent_id = if node.id == current.id {
                target_parent_id.map(str::to_string)
            } else {
                node.parent_id
                    .as_ref()
                    .and_then(|id| id_map.get(id))
                    .cloned()
            };
            let new_title = if node.id == current.id {
                copied_root_title.clone()
            } else {
                node.title.clone()
            };
            let new_path = if node.id == current.id {
                target_path.clone()
            } else {
                replace_path_prefix(&node.file_path, &current_prefix, &target_prefix)
            };
            let new_order = if node.id == current.id { target_order } else { node.order_index };
            transaction
                .execute(
                    "INSERT INTO nodes (id, kind, parent_id, title, order_index, status, file_path, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                    params![new_id, node.kind, new_parent_id, new_title, new_order, node.status, new_path, timestamp, timestamp],
                )
                .map_err(|error| format!("写入复制节点失败：{}", error))?;
        }
        transaction
            .execute(
                "UPDATE nodes SET order_index = order_index + 1 WHERE parent_id IS ?1 AND order_index >= ?2 AND id NOT IN (SELECT id FROM nodes WHERE id = ?3)",
                params![target_parent_id, target_order, id_map.get(&current.id)],
            )
            .map_err(|error| format!("整理复制节点顺序失败：{}", error))?;
        transaction
            .commit()
            .map_err(|error| format!("提交节点复制失败：{}", error))?;
        Ok(())
    })();
    if let Err(error) = database_result {
        let _ = remove_path_if_exists(&target_absolute);
        if current.kind == "chapter" {
            let _ = remove_path_if_exists(&target_absolute.with_extension(""));
        }
        return Err(error);
    }
    storage::refresh_search_index(&root, &connection)?;
    storage::touch_project(&root)?;
    project_data(&root, &connection)
}

#[tauri::command]
pub fn delete_node(input: crate::models::NodeActionInput) -> Result<ProjectData, String> {
    let (root, mut connection) = project_connection(&input.project_path)?;
    let node = storage::node_from_id(&connection, &input.node_id)?
        .ok_or_else(|| "节点不存在".to_string())?;
    if node.deleted_at.is_some() {
        return Err("节点已经在回收站".to_string());
    }
    let nodes = storage::all_nodes(&connection, false)?;
    let ids = descendant_ids(&nodes, &node.id);
    let original_path = node.file_path.clone();
    let original_absolute = storage::safe_relative(&root, &original_path)?;
    let (trash_path, sidecar_moved) = move_node_to_trash(&root, &original_absolute, &node.kind, &node.id)?;
    let deleted_at = storage::now();
    let database_result = (|| -> Result<(), String> {
        let transaction = connection.transaction()
            .map_err(|error| format!("无法开始删除事务：{}", error))?;
        for id in &ids {
            transaction
                .execute(
                    "UPDATE nodes SET deleted_at = ?1, deleted_path = ?2 WHERE id = ?3",
                    params![deleted_at, if id == &node.id { Some(trash_path.clone()) } else { None::<String> }, id],
                )
                .map_err(|error| format!("移入回收站失败：{}", error))?;
            transaction.execute("DELETE FROM search_index WHERE ref_id = ?1", params![id])
                .map_err(|error| format!("删除搜索索引失败：{}", error))?;
        }
        transaction
            .execute(
                "INSERT INTO trash_items (id, ref_id, ref_kind, title, original_path, trash_path, deleted_at) VALUES (?1, ?2, 'node', ?3, ?4, ?5, ?6)",
                params![storage::new_id(), node.id, node.title, original_path, trash_path, deleted_at],
            )
            .map_err(|error| format!("记录回收站失败：{}", error))?;
        transaction.commit().map_err(|error| format!("提交删除事务失败：{}", error))
    })();
    if let Err(error) = database_result {
        return match restore_node_from_trash(&original_absolute, Path::new(&trash_path), &node.kind, sidecar_moved) {
            Ok(()) => Err(format!("{}；文件已恢复到原位置", error)),
            Err(rollback_error) => Err(format!("{}；文件回滚失败：{}", error, rollback_error)),
        };
    }
    storage::touch_project(&root)?;
    project_data(&root, &connection)
}

fn restore_document_after_save_failure(target: &Path, target_existed: bool, old_content: &str) -> Result<(), String> {
    if target_existed {
        storage::atomic_write(target, old_content.as_bytes())
    } else {
        storage::remove_file_if_exists(target)
    }
}

fn save_document_internal(
    root: &Path,
    connection: &mut Connection,
    node_id: &str,
    content: &str,
    reason: &str,
) -> Result<DocumentData, String> {
    let node = storage::node_from_id(connection, node_id)?
        .ok_or_else(|| "章节不存在".to_string())?;
    if node.deleted_at.is_some() || node.kind == "volume" {
        return Err("只有未删除的章节或小节可以编辑".to_string());
    }
    let target = storage::safe_relative(root, &node.file_path)?;
    let target_existed = target.exists();
    let old_raw_content = if target_existed {
        fs::read_to_string(&target).map_err(|error| format!("读取原正文失败：{}", error))?
    } else {
        String::new()
    };
    let old_content = storage::strip_markdown_frontmatter(&old_raw_content);
    let (_recovery_id, recovery_path) = storage::write_recovery(root, node_id, content)?;
    let persisted_timestamp = storage::now();
    let persisted_content = storage::markdown_node(
        &node.id,
        &node.kind,
        node.parent_id.as_deref(),
        &node.status,
        &node.created_at,
        &persisted_timestamp,
        content,
    );
    storage::atomic_write(&target, persisted_content.as_bytes())?;
    let revision_id = storage::new_id();
    let revision_path = match storage::copy_history(root, node_id, &revision_id, content) {
        Ok(path) => path,
        Err(error) => {
            let _ = storage::append_log(root, "ERROR", "document_save_failed");
            let rollback = restore_document_after_save_failure(&target, target_existed, &old_raw_content);
            return match rollback {
                Ok(()) => Err(format!("{}；原正文已恢复，恢复文件已保留", error)),
                Err(rollback_error) => Err(format!("{}；原正文恢复失败：{}；恢复文件已保留", error, rollback_error)),
            };
        }
    };
    let database_result = (|| -> Result<(), String> {
        let transaction = connection
            .transaction()
            .map_err(|error| format!("无法开始保存事务：{}", error))?;
        let created_at = storage::now();
        transaction
            .execute(
                "INSERT INTO revisions (id, node_id, node_title, reason, word_count, created_at, file_path) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    revision_id,
                    node.id,
                    node.title,
                    if reason.trim().is_empty() { "自动保存" } else { reason },
                    storage::word_count(content) as i64,
                    created_at,
                    revision_path
                ],
            )
            .map_err(|error| format!("记录历史快照失败：{}", error))?;
        let delta = storage::word_count(content) as i64 - storage::word_count(&old_content) as i64;
        transaction
            .execute(
                "INSERT INTO activity (id, node_id, created_at, delta_words, word_count) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![storage::new_id(), node.id, storage::now(), delta, storage::word_count(content) as i64],
            )
            .map_err(|error| format!("记录写作统计失败：{}", error))?;
        transaction
            .execute(
                "UPDATE nodes SET updated_at = ?1 WHERE id = ?2",
                params![persisted_timestamp, node.id],
            )
            .map_err(|error| format!("更新章节时间失败：{}", error))?;
        storage::index_record(&transaction, &node.id, &node.kind, &node.title, content, &node.file_path)?;
        transaction.commit().map_err(|error| format!("提交保存事务失败：{}", error))
    })();
    if let Err(error) = database_result {
        let _ = storage::append_log(root, "ERROR", "document_save_failed");
        let cleanup = storage::remove_file_if_exists(&storage::safe_relative(root, &revision_path)?);
        let rollback = restore_document_after_save_failure(&target, target_existed, &old_raw_content);
        let mut detail = error;
        if let Err(cleanup_error) = cleanup { detail.push_str(&format!("；历史快照清理失败：{}", cleanup_error)); }
        return match rollback {
            Ok(()) => Err(format!("{}；原正文已恢复，恢复文件已保留", detail)),
            Err(rollback_error) => Err(format!("{}；原正文恢复失败：{}；恢复文件已保留", detail, rollback_error)),
        };
    }
    if storage::touch_project(root).is_err() {
        let _ = storage::append_log(root, "WARN", "project_metadata_touch_failed");
    }
    if storage::remove_file_if_exists(Path::new(&recovery_path)).is_err() {
        let _ = storage::append_log(root, "WARN", "recovery_cleanup_failed");
    }
    let _ = storage::append_log(root, "INFO", "document_saved");
    let updated = storage::node_from_id(connection, node_id)?
        .ok_or_else(|| "保存后无法读取章节".to_string())?;
    Ok(DocumentData { node: updated, content: content.to_string() })
}

fn preserve_current_revision(
    root: &Path,
    connection: &Connection,
    node_id: &str,
    reason: &str,
) -> Result<(), String> {
    let node = storage::node_from_id(connection, node_id)?
        .ok_or_else(|| "章节不存在".to_string())?;
    if node.deleted_at.is_some() || node.kind == "volume" {
        return Err("只有未删除的章节或小节可以创建历史快照".to_string());
    }
    let target = storage::safe_relative(root, &node.file_path)?;
    let current_content = fs::read_to_string(&target)
        .map_err(|error| format!("无法读取恢复前的正文：{}", error))?;
    let current_content = storage::strip_markdown_frontmatter(&current_content);
    let revision_id = storage::new_id();
    let revision_path = storage::copy_history(root, node_id, &revision_id, &current_content)?;
    let created_at = storage::now();
    let insert_result = connection.execute(
        "INSERT INTO revisions (id, node_id, node_title, reason, word_count, created_at, file_path) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            revision_id,
            node.id,
            node.title,
            reason,
            storage::word_count(&current_content) as i64,
            created_at,
            revision_path
        ],
    );
    if let Err(error) = insert_result {
        storage::remove_file_if_exists(&storage::safe_relative(root, &revision_path)?)?;
        return Err(format!("记录恢复前历史快照失败：{}", error));
    }
    Ok(())
}

#[tauri::command]
pub fn get_document(input: crate::models::NodeActionInput) -> Result<DocumentData, String> {
    let (root, connection) = project_connection(&input.project_path)?;
    let node = storage::node_from_id(&connection, &input.node_id)?
        .ok_or_else(|| "章节不存在".to_string())?;
    if node.kind == "volume" {
        return Err("卷没有正文文件".to_string());
    }
    if node.deleted_at.is_some() {
        return Err("已删除的正文不能读取".to_string());
    }
    let content = fs::read_to_string(storage::safe_relative(&root, &node.file_path)?)
        .map_err(|error| format!("读取正文失败：{}", error))?;
    Ok(DocumentData { node, content: storage::strip_markdown_frontmatter(&content) })
}

#[tauri::command]
pub fn save_document(input: SaveDocumentInput) -> Result<DocumentData, String> {
    let (root, mut connection) = project_connection(&input.project_path)?;
    save_document_internal(&root, &mut connection, &input.node_id, &input.content, &input.reason)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryActionInput {
    pub project_path: String,
    pub recovery_id: String,
}

fn recovery_path(root: &Path, recovery_id: &str) -> Result<PathBuf, String> {
    if recovery_id.contains('/') || recovery_id.contains('\\') || !recovery_id.ends_with(".md") {
        return Err("恢复文件名无效".to_string());
    }
    storage::safe_relative(root, &format!(".novelforge/recovery/{}", recovery_id))
}

#[tauri::command]
pub fn list_recovery(path: String) -> Result<Vec<RecoveryItem>, String> {
    let (root, connection) = project_connection(&path)?;
    storage::recovery_items(&root, &connection)
}

#[tauri::command]
pub fn read_recovery(input: RecoveryActionInput) -> Result<String, String> {
    let (root, _connection) = project_connection(&input.project_path)?;
    fs::read_to_string(recovery_path(&root, &input.recovery_id)?)
        .map_err(|error| format!("无法读取恢复内容：{}", error))
}

#[tauri::command]
pub fn restore_recovery(input: RecoveryActionInput) -> Result<ProjectData, String> {
    let (root, mut connection) = project_connection(&input.project_path)?;
    let node_id = input.recovery_id.split("--").next().unwrap_or_default().to_string();
    if node_id.is_empty() {
        return Err("恢复文件关联的章节无效".to_string());
    }
    let recovery_file = recovery_path(&root, &input.recovery_id)?;
    let content = fs::read_to_string(&recovery_file)
        .map_err(|error| format!("无法读取恢复内容：{}", error))?;
    preserve_current_revision(&root, &connection, &node_id, "恢复前自动快照")?;
    save_document_internal(&root, &mut connection, &node_id, &content, "崩溃恢复")?;
    storage::remove_file_if_exists(&recovery_file)?;
    project_data(&root, &connection)
}

#[tauri::command]
pub fn discard_recovery(input: RecoveryActionInput) -> Result<Vec<RecoveryItem>, String> {
    let (root, connection) = project_connection(&input.project_path)?;
    storage::remove_file_if_exists(&recovery_path(&root, &input.recovery_id)?)?;
    storage::recovery_items(&root, &connection)
}

#[tauri::command]
pub fn list_history(input: crate::models::NodeActionInput) -> Result<Vec<HistoryItem>, String> {
    let (_root, connection) = project_connection(&input.project_path)?;
    storage::history_items(&connection, &input.node_id)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RevisionActionInput {
    pub project_path: String,
    pub revision_id: String,
}

#[tauri::command]
pub fn read_history(input: RevisionActionInput) -> Result<String, String> {
    let (root, connection) = project_connection(&input.project_path)?;
    let path: String = connection
        .query_row("SELECT file_path FROM revisions WHERE id = ?1", params![input.revision_id], |row| row.get(0))
        .map_err(|error| format!("版本不存在：{}", error))?;
    let content = fs::read_to_string(storage::safe_relative(&root, &path)?)
        .map_err(|error| format!("无法读取历史内容：{}", error))?;
    Ok(storage::strip_markdown_frontmatter(&content))
}

#[tauri::command]
pub fn restore_history(input: RevisionActionInput) -> Result<ProjectData, String> {
    let (root, mut connection) = project_connection(&input.project_path)?;
    let (node_id, path): (String, String) = connection
        .query_row("SELECT node_id, file_path FROM revisions WHERE id = ?1", params![input.revision_id], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(|error| format!("版本不存在：{}", error))?;
    let content = fs::read_to_string(storage::safe_relative(&root, &path)?)
        .map_err(|error| format!("无法读取历史内容：{}", error))?;
    preserve_current_revision(&root, &connection, &node_id, "恢复前自动快照")?;
    save_document_internal(&root, &mut connection, &node_id, &content, "恢复历史版本")?;
    project_data(&root, &connection)
}

#[tauri::command]
pub fn upsert_entity(input: EntityInput) -> Result<ProjectData, String> {
    if input.title.trim().is_empty() {
        return Err("条目名称不能为空".to_string());
    }
    let (root, mut connection) = project_connection(&input.project_path)?;
    let timestamp = storage::now();
    let entity_id = input.id.clone().unwrap_or_else(storage::new_id);
    let existing = storage::entity_from_id(&connection, &entity_id)?;
    if let Some(entity) = existing.as_ref() {
        if entity.deleted_at.is_some() {
            return Err("回收站中的资料不能直接编辑，请先恢复".to_string());
        }
        if entity.kind != input.kind {
            return Err("资料类型不能在编辑时修改".to_string());
        }
    }
    let file_path = if let Some(entity) = existing.as_ref() {
        entity.file_path.clone()
    } else {
        let directory = storage::kind_directory(&input.kind)?;
        format!("{}/{}-{}.md", directory, safe_filename(&input.title), entity_id)
    };
    let content_json = serde_json::to_string(&input.content).map_err(|error| format!("资料内容序列化失败：{}", error))?;
    let tags_json = serde_json::to_string(&input.tags).map_err(|error| format!("标签序列化失败：{}", error))?;
    let target = if input.kind == "attachment" {
        None
    } else {
        Some(storage::safe_relative(&root, &file_path)?)
    };
    let old_existed = target.as_ref().is_some_and(|path| path.is_file());
    let old_content = if let Some(target) = target.as_ref().filter(|path| path.is_file()) {
        Some(fs::read_to_string(target)
            .map_err(|error| format!("读取原资料镜像失败：{}", error))?)
    } else {
        None
    };
    if let Some(target) = target.as_ref() {
        let created_at = existing
            .as_ref()
            .map(|entity| entity.created_at.as_str())
            .unwrap_or(timestamp.as_str());
        let markdown = storage::markdown_entity_with_metadata(
            &entity_id,
            &input.kind,
            created_at,
            &timestamp,
            input.title.trim(),
            &input.content,
            &input.tags,
        );
        storage::atomic_write(target, markdown.as_bytes())?;
    }
    let index_content = if input.kind == "attachment" {
        input.content.to_string()
    } else {
        storage::markdown_entity(&input.title, &input.content, &input.tags)
    };
    let entity_created_at = existing
        .as_ref()
        .map(|entity| entity.created_at.clone())
        .unwrap_or_else(|| timestamp.clone());
    let database_result = (|| -> Result<(), String> {
        let transaction = connection
            .transaction()
            .map_err(|error| format!("无法开始保存资料事务：{}", error))?;
        transaction
            .execute(
                "INSERT INTO entities (id, kind, title, content_json, tags_json, file_path, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8) ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, title = excluded.title, content_json = excluded.content_json, tags_json = excluded.tags_json, file_path = excluded.file_path, updated_at = excluded.updated_at, deleted_at = NULL, deleted_path = NULL",
                params![entity_id, input.kind, input.title.trim(), content_json, tags_json, file_path, entity_created_at, timestamp],
            )
            .map_err(|error| format!("保存资料条目失败：{}", error))?;
        storage::index_record(&transaction, &entity_id, &input.kind, input.title.trim(), &index_content, &file_path)?;
        transaction.commit().map_err(|error| format!("提交资料保存事务失败：{}", error))
    })();
    if let Err(error) = database_result {
        if let Some(target) = target.as_ref() {
            let previous = old_content.as_deref().unwrap_or("");
            if let Err(rollback_error) = restore_document_after_save_failure(target, old_existed, previous) {
                return Err(format!("{}；资料镜像回滚失败：{}", error, rollback_error));
            }
        }
        return Err(error);
    }
    touch_project_best_effort(&root, "project_metadata_touch_failed");
    let _ = storage::append_log(&root, "INFO", "entity_saved");
    project_data(&root, &connection)
}

fn attachment_extension(name: &str) -> String {
    Path::new(name).extension().and_then(|extension| extension.to_str()).unwrap_or("")
        .chars().filter(|character| character.is_ascii_alphanumeric()).take(12).collect()
}

fn attachment_filename(name: &str, id: &str) -> String {
    let stem = Path::new(name).file_stem().and_then(|value| value.to_str()).unwrap_or("attachment");
    let stem = safe_filename(stem);
    let extension = attachment_extension(name);
    if extension.is_empty() { format!("{}-{}", stem, id) } else { format!("{}-{}.{}", stem, id, extension) }
}

fn attachment_mime(name: &str) -> &'static str {
    match attachment_extension(name).to_lowercase().as_str() {
        "md" | "markdown" => "text/markdown", "txt" => "text/plain", "json" => "application/json",
        "pdf" => "application/pdf", "doc" => "application/msword", "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "epub" => "application/epub+zip", "png" => "image/png", "jpg" | "jpeg" => "image/jpeg", "gif" => "image/gif",
        "webp" => "image/webp", "mp3" => "audio/mpeg", "wav" => "audio/wav", "mp4" => "video/mp4", _ => "application/octet-stream",
    }
}

#[tauri::command]
pub fn import_attachment(input: crate::models::AttachmentInput) -> Result<ProjectData, String> {
    if input.source_path.trim().is_empty() { return Err("附件路径不能为空".to_string()); }
    let source = PathBuf::from(&input.source_path);
    let source_metadata = fs::metadata(&source).map_err(|error| format!("无法读取附件：{}", error))?;
    if !source_metadata.is_file() { return Err("只能导入文件，不能导入文件夹".to_string()); }
    let (root, connection) = project_connection(&input.project_path)?;
    let id = storage::new_id();
    let original_name = source.file_name().and_then(|value| value.to_str()).unwrap_or("附件").to_string();
    let relative_path = format!("attachments/{}", attachment_filename(&original_name, &id));
    let destination = storage::safe_relative(&root, &relative_path)?;
    fs::copy(&source, &destination).map_err(|error| format!("复制附件失败：{}", error))?;
    let timestamp = storage::now();
    let content = serde_json::json!({
        "originalName": original_name,
        "mimeType": attachment_mime(&original_name),
        "sizeBytes": source_metadata.len(),
        "description": input.description.trim(),
    });
    let content_json = serde_json::to_string(&content).map_err(|error| format!("附件信息序列化失败：{}", error))?;
    let database_result = (|| -> Result<(), String> {
        connection.execute(
            "INSERT INTO entities (id, kind, title, content_json, tags_json, file_path, created_at, updated_at) VALUES (?1, 'attachment', ?2, ?3, ?4, ?5, ?6, ?7)",
            params![id, original_name, content_json, serde_json::json!(["附件"]).to_string(), relative_path, timestamp, timestamp],
        ).map_err(|error| format!("保存附件资料失败：{}", error))?;
        storage::index_record(&connection, &id, "attachment", &original_name, &content.to_string(), &relative_path)?;
        storage::touch_project(&root)?;
        Ok(())
    })();
    if let Err(error) = database_result {
        let _ = fs::remove_file(&destination);
        let _ = connection.execute("DELETE FROM entities WHERE id = ?1", params![id]);
        let _ = connection.execute("DELETE FROM search_index WHERE ref_id = ?1", params![id]);
        return Err(error);
    }
    project_data(&root, &connection)
}

#[tauri::command]
pub fn open_attachment(input: crate::models::NodeActionInput) -> Result<String, String> {
    let (root, connection) = project_connection(&input.project_path)?;
    let entity = storage::entity_from_id(&connection, &input.node_id)?
        .ok_or_else(|| "附件不存在".to_string())?;
    if entity.kind != "attachment" {
        return Err("只能打开附件条目".to_string());
    }
    let absolute = storage::safe_relative(&root, &entity.file_path)?;
    if !absolute.is_file() {
        return Err("附件文件不存在，可能已被外部程序移动".to_string());
    }
    #[cfg(target_os = "windows")]
    std::process::Command::new("explorer.exe").arg(&absolute).spawn()
        .map_err(|error| format!("无法打开附件：{}", error))?;
    #[cfg(target_os = "macos")]
    std::process::Command::new("open").arg(&absolute).spawn()
        .map_err(|error| format!("无法打开附件：{}", error))?;
    #[cfg(target_os = "linux")]
    std::process::Command::new("xdg-open").arg(&absolute).spawn()
        .map_err(|error| format!("无法打开附件：{}", error))?;
    Ok(absolute.to_string_lossy().to_string())
}

fn safe_filename(title: &str) -> String {
    let cleaned: String = title
        .chars()
        .filter(|character| character.is_alphanumeric() || *character == '-' || *character == '_')
        .take(48)
        .collect();
    if cleaned.is_empty() { "entry".to_string() } else { cleaned }
}

#[tauri::command]
pub fn delete_entity(input: crate::models::NodeActionInput) -> Result<ProjectData, String> {
    let (root, mut connection) = project_connection(&input.project_path)?;
    let entity = storage::entity_from_id(&connection, &input.node_id)?
        .ok_or_else(|| "资料条目不存在".to_string())?;
    if entity.deleted_at.is_some() {
        return Err("条目已经在回收站".to_string());
    }
    let original_absolute = storage::safe_relative(&root, &entity.file_path)?;
    let trash_path = storage::move_to_trash(&root, &original_absolute, &entity.id)?;
    let deleted_at = storage::now();
    let database_result = (|| -> Result<(), String> {
        let transaction = connection.transaction()
            .map_err(|error| format!("无法开始资料删除事务：{}", error))?;
        transaction
            .execute("UPDATE entities SET deleted_at = ?1, deleted_path = ?2 WHERE id = ?3", params![deleted_at, trash_path, entity.id])
            .map_err(|error| format!("移入回收站失败：{}", error))?;
        transaction.execute("DELETE FROM search_index WHERE ref_id = ?1", params![entity.id])
            .map_err(|error| format!("删除搜索索引失败：{}", error))?;
        transaction
            .execute(
                "INSERT INTO trash_items (id, ref_id, ref_kind, title, original_path, trash_path, deleted_at) VALUES (?1, ?2, 'entity', ?3, ?4, ?5, ?6)",
                params![storage::new_id(), entity.id, entity.title, entity.file_path, trash_path, deleted_at],
            )
            .map_err(|error| format!("记录回收站失败：{}", error))?;
        transaction.commit().map_err(|error| format!("提交资料删除事务失败：{}", error))
    })();
    if let Err(error) = database_result {
        return match fs::rename(Path::new(&trash_path), &original_absolute) {
            Ok(()) => Err(format!("{}；资料文件已恢复到原位置", error)),
            Err(rollback_error) => Err(format!("{}；资料文件回滚失败：{}", error, rollback_error)),
        };
    }
    storage::touch_project(&root)?;
    project_data(&root, &connection)
}

#[tauri::command]
pub fn list_entities(path: String, kind: Option<String>) -> Result<Vec<EntityRecord>, String> {
    let (_root, connection) = project_connection(&path)?;
    let entities = storage::all_entities(&connection, false)?;
    Ok(match kind {
        Some(kind) => entities.into_iter().filter(|entity| entity.kind == kind).collect(),
        None => entities,
    })
}

#[tauri::command]
pub fn list_trash(path: String) -> Result<Vec<TrashItem>, String> {
    let (_root, connection) = project_connection(&path)?;
    storage::trash_items(&connection)
}

#[tauri::command]
pub fn empty_trash(path: String) -> Result<ProjectData, String> {
    let items = list_trash(path.clone())?;
    for item in items {
        permanent_delete(crate::models::NodeActionInput { project_path: path.clone(), node_id: item.id })?;
    }
    let (root, connection) = project_connection(&path)?;
    project_data(&root, &connection)
}

#[tauri::command]
pub fn restore_trash(input: crate::models::NodeActionInput) -> Result<ProjectData, String> {
    let (root, mut connection) = project_connection(&input.project_path)?;
    let item = trash_item(&connection, &input.node_id)?;
    if item.ref_kind != "node" && item.ref_kind != "entity" {
        return Err("回收站项目类型无效".to_string());
    }
    let trash_path = storage::safe_trash_path(&root, &item.trash_path)?;
    if item.ref_kind == "entity" {
        let destination = storage::safe_relative(&root, &item.original_path)?;
        if destination.exists() {
            return Err("原位置已有同名内容，请先处理后再恢复".to_string());
        }
        fs::create_dir_all(destination.parent().ok_or_else(|| "无法确定恢复目录".to_string())?)
            .map_err(|error| format!("无法创建恢复目录：{}", error))?;
        fs::rename(&trash_path, &destination).map_err(|error| format!("恢复文件失败：{}", error))?;
        let database_result = (|| -> Result<(), String> {
            let transaction = connection.transaction()
                .map_err(|error| format!("无法开始恢复事务：{}", error))?;
            transaction.execute("UPDATE entities SET deleted_at = NULL, deleted_path = NULL WHERE id = ?1", params![item.ref_id])
                .map_err(|error| format!("更新恢复资料失败：{}", error))?;
            transaction.execute("DELETE FROM trash_items WHERE id = ?1", params![item.id])
                .map_err(|error| format!("清理回收站记录失败：{}", error))?;
            transaction.commit().map_err(|error| format!("提交恢复事务失败：{}", error))
        })();
        if let Err(error) = database_result {
            return match fs::rename(&destination, &trash_path) {
                Ok(()) => Err(format!("{}；文件已移回回收站", error)),
                Err(rollback_error) => Err(format!("{}；文件回滚失败：{}", error, rollback_error)),
            };
        }
    } else {
        let all_nodes = storage::all_nodes(&connection, true)?;
        let node = all_nodes
            .iter()
            .find(|candidate| candidate.id == item.ref_id)
            .cloned()
            .ok_or_else(|| "待恢复节点不存在".to_string())?;
        if node.deleted_at.is_none() {
            return Err("节点不在回收站".to_string());
        }
        let active_nodes = storage::all_nodes(&connection, false)?;
        let parent = node
            .parent_id
            .as_deref()
            .and_then(|id| active_nodes.iter().find(|candidate| candidate.id == id))
            .cloned();
        if node.kind != "volume" && parent.is_none() {
            return Err("恢复节点的父节点不存在或仍在回收站".to_string());
        }
        let mut ignored_ids = HashSet::new();
        ignored_ids.insert(node.id.clone());
        let preferred_available = node_path_available(
            &root,
            &all_nodes,
            &item.original_path,
            &node.kind,
            &ignored_ids,
        )?;
        let sibling_count = active_nodes
            .iter()
            .filter(|candidate| candidate.parent_id == node.parent_id)
            .count() as i64;
        let (target_path, target_order) = if preferred_available {
            (
                item.original_path.clone(),
                node.order_index.clamp(0, sibling_count),
            )
        } else {
            next_node_location_excluding(
                &root,
                &all_nodes,
                &node.kind,
                parent.as_ref(),
                &ignored_ids,
            )?
        };
        let destination = storage::safe_relative(&root, &target_path)?;
        fs::create_dir_all(destination.parent().ok_or_else(|| "无法确定恢复目录".to_string())?)
            .map_err(|error| format!("无法创建恢复目录：{}", error))?;
        let sidecar_moved = node.kind == "chapter" && trash_path.with_extension("").is_dir();
        restore_node_from_trash(&destination, &trash_path, &node.kind, sidecar_moved)?;
        let timestamp = storage::now();
        let current_prefix = node_path_prefix(&node);
        let target_node = NodeRecord {
            id: node.id.clone(),
            kind: node.kind.clone(),
            parent_id: node.parent_id.clone(),
            title: node.title.clone(),
            order_index: target_order,
            status: node.status.clone(),
            file_path: target_path.clone(),
            created_at: node.created_at.clone(),
            updated_at: timestamp.clone(),
            deleted_at: None,
            deleted_path: None,
        };
        let target_prefix = node_path_prefix(&target_node);
        if let Err(error) = rewrite_node_mirror(
            &root,
            &node,
            &target_path,
            node.parent_id.as_deref(),
            &node.title,
            &timestamp,
        ) {
            let _ = restore_node_from_trash(&trash_path, &destination, &node.kind, sidecar_moved);
            return Err(error);
        }
        let node_ids = descendant_ids(&all_nodes, &node.id);
        let database_result = (|| -> Result<(), String> {
            let transaction = connection.transaction()
                .map_err(|error| format!("无法开始恢复事务：{}", error))?;
            transaction.execute(
                "UPDATE nodes SET order_index = order_index + 1, updated_at = ?1 WHERE parent_id IS ?2 AND order_index >= ?3 AND deleted_at IS NULL",
                params![timestamp, node.parent_id, target_order],
            ).map_err(|error| format!("整理恢复节点顺序失败：{}", error))?;
            transaction.execute(
                "UPDATE nodes SET parent_id = ?1, order_index = ?2, file_path = ?3, updated_at = ?4, deleted_at = NULL, deleted_path = NULL WHERE id = ?5",
                params![node.parent_id, target_order, target_path, timestamp, node.id],
            ).map_err(|error| format!("更新恢复节点失败：{}", error))?;
            for child in all_nodes.iter().filter(|candidate| candidate.id != node.id && node_ids.iter().any(|id| id == &candidate.id)) {
                let next_path = replace_path_prefix(&child.file_path, &current_prefix, &target_prefix);
                transaction.execute(
                    "UPDATE nodes SET file_path = ?1, updated_at = ?2, deleted_at = NULL, deleted_path = NULL WHERE id = ?3",
                    params![next_path, timestamp, child.id],
                ).map_err(|error| format!("更新恢复子节点失败：{}", error))?;
            }
            transaction.execute("DELETE FROM trash_items WHERE id = ?1", params![item.id])
                .map_err(|error| format!("清理回收站记录失败：{}", error))?;
            transaction.commit().map_err(|error| format!("提交恢复事务失败：{}", error))
        })();
        if let Err(error) = database_result {
            return match restore_node_from_trash(&trash_path, &destination, &node.kind, sidecar_moved) {
                Ok(()) => Err(format!("{}；文件已移回回收站", error)),
                Err(rollback_error) => Err(format!("{}；文件回滚失败：{}", error, rollback_error)),
            };
        }
    }
    storage::touch_project(&root)?;
    storage::refresh_search_index(&root, &connection)?;
    project_data(&root, &connection)
}

fn trash_item(connection: &Connection, id: &str) -> Result<TrashItem, String> {
    connection.query_row(
        "SELECT id, ref_id, ref_kind, title, original_path, trash_path, deleted_at FROM trash_items WHERE id = ?1",
        params![id],
        |row| Ok(TrashItem {
            id: row.get(0)?, ref_id: row.get(1)?, ref_kind: row.get(2)?, title: row.get(3)?,
            original_path: row.get(4)?, trash_path: row.get(5)?, deleted_at: row.get(6)?,
        }),
    ).map_err(|error| format!("回收站项目不存在：{}", error))
}

#[tauri::command]
pub fn permanent_delete(input: crate::models::NodeActionInput) -> Result<ProjectData, String> {
    let (root, mut connection) = project_connection(&input.project_path)?;
    let item = trash_item(&connection, &input.node_id)?;
    if item.ref_kind != "node" && item.ref_kind != "entity" {
        return Err("回收站项目类型无效".to_string());
    }
    let trash_path = storage::safe_trash_path(&root, &item.trash_path)?;
    let purge_id = storage::new_id();
    let quarantine = trash_path.with_file_name(format!(".purge-{}", purge_id));
    let node_kind = if item.ref_kind == "node" {
        storage::all_nodes(&connection, true)?
            .into_iter()
            .find(|node| node.id == item.ref_id)
            .map(|node| node.kind)
    } else {
        None
    };
    let trash_sidecar = node_kind
        .as_deref()
        .filter(|kind| *kind == "chapter")
        .map(|_| trash_path.with_extension(""))
        .filter(|path| path.is_dir());
    let quarantine_sidecar = trash_sidecar
        .as_ref()
        .map(|_| trash_path.with_file_name(format!(".purge-{}-sidecar", purge_id)));
    fs::rename(&trash_path, &quarantine).map_err(|error| format!("隔离待永久删除内容失败：{}", error))?;
    if let (Some(sidecar), Some(quarantine_sidecar)) = (trash_sidecar.as_ref(), quarantine_sidecar.as_ref()) {
        if let Err(error) = fs::rename(sidecar, quarantine_sidecar) {
            let _ = fs::rename(&quarantine, &trash_path);
            return Err(format!("隔离章节小节目录失败：{}", error));
        }
    }
    let node_ids = if item.ref_kind == "node" {
        Some(descendant_ids(&storage::all_nodes(&connection, true)?, &item.ref_id))
    } else {
        None
    };
    let database_result = (|| -> Result<(), String> {
        let transaction = connection.transaction()
            .map_err(|error| format!("无法开始永久删除事务：{}", error))?;
        if let Some(ids) = &node_ids {
            for id in ids {
                transaction.execute("DELETE FROM nodes WHERE id = ?1", params![id])
                    .map_err(|error| format!("删除节点记录失败：{}", error))?;
                transaction.execute("DELETE FROM search_index WHERE ref_id = ?1", params![id])
                    .map_err(|error| format!("删除搜索索引失败：{}", error))?;
            }
        } else {
            transaction.execute("DELETE FROM entities WHERE id = ?1", params![item.ref_id])
                .map_err(|error| format!("删除资料记录失败：{}", error))?;
        }
        transaction.execute("DELETE FROM search_index WHERE ref_id = ?1", params![item.ref_id])
            .map_err(|error| format!("删除搜索索引失败：{}", error))?;
        transaction.execute("DELETE FROM trash_items WHERE id = ?1", params![item.id])
            .map_err(|error| format!("清理回收站记录失败：{}", error))?;
        transaction.commit().map_err(|error| format!("提交永久删除事务失败：{}", error))
    })();
    if let Err(error) = database_result {
        let sidecar_result = match (quarantine_sidecar.as_ref(), trash_sidecar.as_ref()) {
            (Some(source), Some(target)) if source.exists() => fs::rename(source, target)
                .map_err(|error| format!("章节小节目录回滚失败：{}", error)),
            _ => Ok(()),
        };
        let file_result = fs::rename(&quarantine, &trash_path)
            .map_err(|error| format!("回收站内容回滚失败：{}", error));
        return match (sidecar_result, file_result) {
            (Ok(()), Ok(())) => Err(format!("{}；回收站内容已恢复", error)),
            (Err(sidecar_error), _) => Err(format!("{}；{}；回收站文件可能已恢复", error, sidecar_error)),
            (_, Err(file_error)) => Err(format!("{}；{}", error, file_error)),
        };
    }
    if quarantine.is_dir() {
        fs::remove_dir_all(&quarantine).map_err(|error| format!("清理永久删除目录失败：{}", error))?;
    } else {
        fs::remove_file(&quarantine).map_err(|error| format!("清理永久删除文件失败：{}", error))?;
    }
    if let Some(quarantine_sidecar) = quarantine_sidecar.filter(|path| path.exists()) {
        fs::remove_dir_all(&quarantine_sidecar).map_err(|error| format!("清理永久删除小节目录失败：{}", error))?;
    }
    storage::touch_project(&root)?;
    project_data(&root, &connection)
}

fn json_text(value: &serde_json::Value, key: &str) -> String {
    match value.get(key) {
        Some(serde_json::Value::String(text)) => text.clone(),
        Some(serde_json::Value::Number(number)) => number.to_string(),
        Some(serde_json::Value::Bool(flag)) => flag.to_string(),
        _ => String::new(),
    }
}

fn wiki_targets(content: &str) -> Vec<String> {
    let mut targets = Vec::new();
    let mut fenced = false;
    let mut fence_character = 0u8;
    for line in content.lines() {
        let trimmed = line.trim_start();
        let bytes = trimmed.as_bytes();
        let marker = if bytes.starts_with(&[96, 96, 96]) {
            Some(96u8)
        } else if bytes.starts_with(b"~~~") {
            Some(b'~')
        } else {
            None
        };
        if let Some(character) = marker {
            if !fenced {
                fenced = true;
                fence_character = character;
            } else if character == fence_character {
                fenced = false;
                fence_character = 0;
            }
            continue;
        }
        if fenced { continue; }
        let mut rest = line;
        while let Some(start) = rest.find("[[") {
            let after_start = &rest[start + 2..];
            let Some(end) = after_start.find("]]") else { break };
            let target = after_start[..end].trim();
            if !target.is_empty() { targets.push(target.to_string()); }
            rest = &after_start[end + 2..];
        }
    }
    targets
}

fn consistency_normalized_key(value: &str) -> String {
    value.chars().filter(|character| !character.is_whitespace() && *character != '_' && *character != '-').collect::<String>().to_lowercase()
}

fn consistency_field_values<'a>(entity: &'a crate::models::EntityRecord, keys: &[&str]) -> Vec<&'a serde_json::Value> {
    let expected: std::collections::HashSet<String> = keys.iter().map(|key| consistency_normalized_key(key)).collect();
    entity.content.as_object().map(|object| object.iter()
        .filter(|(key, _)| expected.contains(&consistency_normalized_key(key)))
        .map(|(_, value)| value)
        .collect()).unwrap_or_default()
}

fn consistency_value_text(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::String(text) => text.clone(),
        serde_json::Value::Number(number) => number.to_string(),
        serde_json::Value::Bool(flag) => flag.to_string(),
        serde_json::Value::Array(items) => items.iter().map(consistency_value_text).filter(|text| !text.is_empty()).collect::<Vec<_>>().join("、"),
        serde_json::Value::Object(object) => object.values().map(consistency_value_text).filter(|text| !text.is_empty()).collect::<Vec<_>>().join("、"),
        serde_json::Value::Null => String::new(),
    }
}

fn consistency_nested_values<'a>(value: &'a serde_json::Value, output: &mut Vec<&'a serde_json::Value>) {
    match value {
        serde_json::Value::Array(items) => items.iter().for_each(|item| consistency_nested_values(item, output)),
        serde_json::Value::Object(object) => object.values().for_each(|item| consistency_nested_values(item, output)),
        _ => output.push(value),
    }
}

fn consistency_numeric_values(values: &[&serde_json::Value]) -> Vec<f64> {
    let mut leaves = Vec::new();
    values.iter().for_each(|value| consistency_nested_values(value, &mut leaves));
    let mut numbers = Vec::new();
    for value in leaves {
        match value {
            serde_json::Value::Number(number) => if let Some(number) = number.as_f64() { numbers.push(number); },
            serde_json::Value::String(text) => {
                let mut token = String::new();
                for character in text.chars() {
                    if character.is_ascii_digit() || character == '-' || character == '.' {
                        token.push(character);
                    } else if !token.is_empty() {
                        if let Ok(number) = token.parse::<f64>() { numbers.push(number); }
                        token.clear();
                    }
                }
                if !token.is_empty() {
                    if let Ok(number) = token.parse::<f64>() { numbers.push(number); }
                }
            },
            _ => {},
        }
    }
    numbers
}

fn consistency_entity_aliases(entity: &crate::models::EntityRecord) -> Vec<String> {
    let mut aliases = vec![entity.id.clone(), entity.title.clone()];
    for value in consistency_field_values(entity, &["alias", "aliases"]) {
        aliases.extend(consistency_value_text(value).split(|character: char| ",，、;；/|".contains(character)).map(str::trim).filter(|item| !item.is_empty()).map(ToString::to_string));
    }
    aliases.into_iter().map(|value| value.trim().to_lowercase()).filter(|value| !value.is_empty()).collect()
}

fn consistency_mentions_entity(values: &[&serde_json::Value], entity: &crate::models::EntityRecord) -> bool {
    let text = values.iter().map(|value| consistency_value_text(value)).collect::<Vec<_>>().join("、").trim().to_lowercase();
    if text.is_empty() { return false; }
    consistency_entity_aliases(entity).iter().any(|alias| text == *alias || text.contains(alias))
}

fn consistency_parse_chronology(value: &serde_json::Value) -> Option<i64> {
    let text = consistency_value_text(value).trim().to_string();
    if text.is_empty() { return None; }
    let mut numbers = Vec::new();
    let mut token = String::new();
    for character in text.chars() {
        if character.is_ascii_digit() {
            token.push(character);
        } else if !token.is_empty() {
            if let Ok(number) = token.parse::<i64>() { numbers.push(number); }
            token.clear();
        }
    }
    if !token.is_empty() {
        if let Ok(number) = token.parse::<i64>() { numbers.push(number); }
    }
    if numbers.len() >= 3 && numbers[0] >= 1000 && (1..=12).contains(&numbers[1]) && (1..=31).contains(&numbers[2]) {
        return Some(numbers[0] * 1_000_000 + numbers[1] * 1_000 + numbers[2]);
    }
    numbers.first().copied()
}

fn consistency_field_date(entity: &crate::models::EntityRecord, keys: &[&str]) -> Option<i64> {
    consistency_field_values(entity, keys).iter().find_map(|value| consistency_parse_chronology(value))
}

fn consistency_timeline_date(entity: &crate::models::EntityRecord) -> Option<i64> {
    consistency_field_date(entity, &["date", "startDate", "time"])
}

fn consistency_timeline_range(entity: &crate::models::EntityRecord) -> (Option<i64>, Option<i64>) {
    (consistency_field_date(entity, &["startDate", "startTime", "beginDate"]), consistency_field_date(entity, &["endDate", "endTime", "finishDate"]))
}

fn consistency_timeline_age_values(event: &crate::models::EntityRecord, character: &crate::models::EntityRecord) -> Vec<f64> {
    let participants = consistency_field_values(event, &["character", "characterId", "characters", "participants"]);
    let mut values = Vec::new();
    if consistency_mentions_entity(&participants, character) {
        values.extend(consistency_numeric_values(&consistency_field_values(event, &["age", "characterAge"])));
    }
    for value in consistency_field_values(event, &["ages", "ageAt", "ageHistory", "ageTimeline", "ageByChapter", "characterAges"]) {
        match value {
            serde_json::Value::Object(object) => {
                for (key, nested) in object {
                    if consistency_entity_aliases(character).iter().any(|alias| alias == &key.trim().to_lowercase()) {
                        values.extend(consistency_numeric_values(&[nested]));
                    }
                }
            },
            serde_json::Value::Array(items) => {
                for item in items {
                    let Some(object) = item.as_object() else { continue };
                    let person = object.get("character").or_else(|| object.get("characterId")).or_else(|| object.get("name")).or_else(|| object.get("person"));
                    if person.map(|person| consistency_mentions_entity(&[person], character)).unwrap_or(false) {
                        if let Some(age) = object.get("age").or_else(|| object.get("value")) {
                            values.extend(consistency_numeric_values(&[age]));
                        }
                    }
                }
            },
            _ => {},
        }
    }
    values
}

fn consistency_character_age_values(character: &crate::models::EntityRecord, timelines: &[&crate::models::EntityRecord]) -> Vec<f64> {
    let mut values = consistency_numeric_values(&consistency_field_values(character, &["age", "currentAge", "ages", "ageAt", "ageAtChapter", "ageHistory", "ageTimeline", "ageByChapter"]));
    for event in timelines { values.extend(consistency_timeline_age_values(event, character)); }
    values.sort_by(|left, right| left.partial_cmp(right).unwrap_or(std::cmp::Ordering::Equal));
    values.dedup_by(|left, right| (*left - *right).abs() < 0.01);
    values
}

fn consistency_normalize_birthday(value: &str) -> String {
    value.trim().chars().map(|character| if " ./年月日".contains(character) { '-' } else { character }).collect::<String>().trim_matches('-').replace("--", "-").to_lowercase()
}

fn consistency_character_birthday_values(character: &crate::models::EntityRecord, timelines: &[&crate::models::EntityRecord]) -> Vec<String> {
    let mut values = Vec::new();
    for value in consistency_field_values(character, &["birthday", "birthDate", "dateOfBirth", "birthDay", "birthdays", "birthdayHistory"]) {
        let mut leaves = Vec::new();
        consistency_nested_values(value, &mut leaves);
        values.extend(leaves.iter().map(|item| consistency_normalize_birthday(&consistency_value_text(item))).filter(|item| !item.is_empty()));
    }
    for event in timelines {
        let participants = consistency_field_values(event, &["character", "characterId", "characters", "participants"]);
        if !consistency_mentions_entity(&participants, character) { continue; }
        for value in consistency_field_values(event, &["birthday", "birthDate", "dateOfBirth"]) {
            let mut leaves = Vec::new();
            consistency_nested_values(value, &mut leaves);
            values.extend(leaves.iter().map(|item| consistency_normalize_birthday(&consistency_value_text(item))).filter(|item| !item.is_empty()));
        }
    }
    values.sort();
    values.dedup();
    values
}

fn consistency_normalize_gender(value: &str) -> String {
    let text = value.trim().to_lowercase();
    match text.as_str() {
        "男" | "男性" | "male" | "man" | "m" => "male".to_string(),
        "女" | "女性" | "female" | "woman" | "f" => "female".to_string(),
        "非二元" | "非二元性别" | "nonbinary" | "non-binary" | "other" | "其他" => "other".to_string(),
        _ => text,
    }
}

fn consistency_character_gender_values(character: &crate::models::EntityRecord) -> Vec<String> {
    let mut leaves = Vec::new();
    for value in consistency_field_values(character, &["gender", "sex", "genderIdentity", "genderHistory"]) {
        consistency_nested_values(value, &mut leaves);
    }
    let mut values: Vec<String> = leaves.iter().map(|value| consistency_normalize_gender(&consistency_value_text(value))).filter(|value| !value.is_empty()).collect();
    values.sort();
    values.dedup();
    values
}

fn consistency_is_dead_status(value: &serde_json::Value) -> bool {
    matches!(consistency_value_text(value).trim().to_lowercase().as_str(), "死亡" | "已死亡" | "dead" | "deceased")
}

fn consistency_is_death_event(event: &crate::models::EntityRecord) -> bool {
    consistency_field_values(event, &["status", "state", "activity", "eventType", "type"]).iter().any(|value| {
        let text = consistency_value_text(value).trim().to_lowercase();
        consistency_is_dead_status(value) || matches!(text.as_str(), "死亡" | "death" | "dead")
    })
}

fn consistency_is_similar_name(left: &str, right: &str) -> bool {
    let normalize = |value: &str| value.chars().filter(|character| !character.is_whitespace() && !"·。、“”\"'’‘-—_".contains(*character)).collect::<String>().to_lowercase();
    let left = normalize(left).chars().collect::<Vec<_>>();
    let right = normalize(right).chars().collect::<Vec<_>>();
    if left.len() < 2 || right.len() < 2 || left == right || left.len().abs_diff(right.len()) > 1 { return false; }
    let mut previous: Vec<usize> = (0..=right.len()).collect();
    for row in 1..=left.len() {
        let mut diagonal = previous[0];
        previous[0] = row;
        for column in 1..=right.len() {
            let next = previous[column];
            previous[column] = if left[row - 1] == right[column - 1] {
                diagonal
            } else {
                (diagonal + 1).min(previous[column] + 1).min(previous[column - 1] + 1)
            };
            diagonal = next;
        }
    }
    previous[right.len()] <= 1
}

fn chapter_reference_tokens(value: &str) -> Vec<String> {
    value.split(|character: char| ",，、;；\r\n".contains(character))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .collect()
}

fn ordered_chapters(nodes: &[NodeRecord]) -> Vec<NodeRecord> {
    let volume_order: HashMap<&str, i64> = nodes
        .iter()
        .filter(|node| node.kind == "volume")
        .map(|node| (node.id.as_str(), node.order_index))
        .collect();
    let mut chapters: Vec<NodeRecord> = nodes
        .iter()
        .filter(|node| node.kind == "chapter")
        .cloned()
        .collect();
    chapters.sort_by(|left, right| {
        let left_volume_order = left
            .parent_id
            .as_deref()
            .and_then(|id| volume_order.get(id))
            .copied()
            .unwrap_or(i64::MAX);
        let right_volume_order = right
            .parent_id
            .as_deref()
            .and_then(|id| volume_order.get(id))
            .copied()
            .unwrap_or(i64::MAX);
        left_volume_order
            .cmp(&right_volume_order)
            .then_with(|| left.order_index.cmp(&right.order_index))
            .then_with(|| left.created_at.cmp(&right.created_at))
            .then_with(|| left.id.cmp(&right.id))
    });
    chapters
}

fn chapter_reference_exists(nodes: &[NodeRecord], reference: &str) -> bool {
    let normalized = reference.trim();
    if normalized.is_empty() { return false; }
    let chapters = ordered_chapters(nodes);
    if chapters.iter().any(|chapter| chapter.title.trim() == normalized) { return true; }
    let digits: String = normalized.chars().filter(|character| character.is_ascii_digit()).collect();
    let Ok(number) = digits.parse::<usize>() else { return false };
    number > 0 && chapters.get(number - 1).is_some()
}

fn is_paid_off_foreshadowing_status(value: &str) -> bool {
    matches!(
        value.trim().to_lowercase().as_str(),
        "paid-off" | "paid_off" | "paidoff" | "resolved" | "已回收" | "已解决" | "回收"
    )
}

fn consistency_issue(
    severity: &str, code: &str, title: &str, detail: String,
    ref_id: &str, ref_kind: &str, path: &str,
) -> crate::models::ConsistencyIssue {
    crate::models::ConsistencyIssue {
        id: format!("{}:{}:{}", code, ref_id, title), severity: severity.to_string(), code: code.to_string(),
        title: title.to_string(), detail, ref_id: ref_id.to_string(), ref_kind: ref_kind.to_string(), path: path.to_string(),
    }
}

#[tauri::command]
pub fn check_consistency(path: String) -> Result<crate::models::ConsistencyReport, String> {
    let (root, connection) = project_connection(&path)?;
    let nodes = storage::all_nodes(&connection, false)?;
    let entities = storage::all_entities(&connection, false)?;
    let mut issues = Vec::new();
    let mut known_titles = std::collections::HashSet::new();
    let mut duplicate_titles = std::collections::HashSet::new();
    for entity in &entities {
        let title = entity.title.trim();
        if title.is_empty() {
            issues.push(consistency_issue("error", "empty-title", "资料条目没有名称", "请为资料条目补充名称，避免 Wiki 链接和搜索结果无法定位。".to_string(), &entity.id, "entity", &entity.file_path));
            continue;
        }
        let duplicate_key = format!("{}:{}", entity.kind, title.to_lowercase());
        if !duplicate_titles.insert(duplicate_key) {
            issues.push(consistency_issue("warning", "duplicate-title", "资料条目名称重复", format!("“{}”在同一资料类型中出现多次，Wiki 链接可能指向不明确。", title), &entity.id, "entity", &entity.file_path));
        }
        known_titles.insert(title.to_string());
    }
    for node in nodes.iter().filter(|node| node.kind != "volume") {
        let file = storage::safe_relative(&root, &node.file_path)?;
        let content = fs::read_to_string(file).unwrap_or_default();
        for target in wiki_targets(&content) {
            if !known_titles.contains(&target) {
                issues.push(consistency_issue("warning", "missing-wiki", "Wiki 链接没有对应资料", format!("正文引用了“{}”，但资料库中没有同名条目。", target), &node.id, &node.kind, &node.file_path));
            }
        }
    }
    let character_ids: std::collections::HashSet<String> = entities.iter().filter(|entity| entity.kind == "character").map(|entity| entity.id.clone()).collect();
    for entity in entities.iter().filter(|entity| entity.kind == "relationship") {
        let from_id = json_text(&entity.content, "fromId");
        let to_id = json_text(&entity.content, "toId");
        if !character_ids.contains(&from_id) || !character_ids.contains(&to_id) {
            issues.push(consistency_issue("error", "broken-relationship", "人物关系引用失效", "关系两端必须指向仍存在的人物资料。".to_string(), &entity.id, "relationship", &entity.file_path));
        }
        if !from_id.is_empty() && from_id == to_id {
            issues.push(consistency_issue("warning", "self-relationship", "人物关系连接到自身", "请确认这是否是有意记录的自我关系。".to_string(), &entity.id, "relationship", &entity.file_path));
        }
    }
    for entity in &entities {
        let fields: &[(&str, &str)] = match entity.kind.as_str() {
            "timeline" => &[("chapters", "关联章节")],
            "foreshadowing" => &[("plantedIn", "首次埋设章节"), ("plannedPayoff", "计划回收章节"), ("actualPayoff", "实际回收章节")],
            _ => &[],
        };
        for (key, label) in fields {
            for reference in chapter_reference_tokens(&json_text(&entity.content, key)) {
                if !chapter_reference_exists(&nodes, &reference) {
                    issues.push(consistency_issue("warning", "missing-chapter-reference", &format!("{}不存在", label), format!("“{}”无法匹配当前正文中的章节。", reference), &entity.id, &entity.kind, &entity.file_path));
                }
            }
        }
        if entity.kind == "foreshadowing" {
            if !json_text(&entity.content, "actualPayoff").trim().is_empty()
                && !is_paid_off_foreshadowing_status(&json_text(&entity.content, "status"))
            {
                issues.push(consistency_issue("warning", "foreshadowing-status", "伏笔状态未标记为已回收", "已经填写实际回收章节，但当前状态仍未标记为“已回收”。".to_string(), &entity.id, &entity.kind, &entity.file_path));
            }
        }
    }

    let characters: Vec<&crate::models::EntityRecord> = entities.iter().filter(|entity| entity.kind == "character").collect();
    let timelines: Vec<&crate::models::EntityRecord> = entities.iter().filter(|entity| entity.kind == "timeline").collect();
    for character in &characters {
        let ages = consistency_character_age_values(character, &timelines);
        let age_difference = ages.last().zip(ages.first()).map(|(last, first)| last - first).unwrap_or(0.0);
        if ages.len() > 1 && age_difference >= 2.0 {
            issues.push(consistency_issue("warning", "character-age-conflict", "可能存在年龄冲突", format!("人物“{}”的结构化年龄记录为 {}，差异较大，请确认时间线或年龄设定。", character.title, ages.iter().map(|age| age.to_string()).collect::<Vec<_>>().join("、")), &character.id, &character.kind, &character.file_path));
        }
        let birthdays = consistency_character_birthday_values(character, &timelines);
        if birthdays.len() > 1 {
            issues.push(consistency_issue("warning", "character-birthday-conflict", "生日描述可能冲突", format!("人物“{}”存在多个结构化生日记录：{}。", character.title, birthdays.join("、")), &character.id, &character.kind, &character.file_path));
        }
        let genders = consistency_character_gender_values(character);
        if genders.len() > 1 {
            issues.push(consistency_issue("warning", "character-gender-conflict", "性别描述可能冲突", format!("人物“{}”的结构化性别字段出现不一致值：{}。", character.title, genders.join("、")), &character.id, &character.kind, &character.file_path));
        }

        let dead = consistency_field_values(character, &["status", "state", "lifeStatus"]).iter().any(|value| {
            let mut leaves = Vec::new();
            consistency_nested_values(value, &mut leaves);
            leaves.iter().any(|item| consistency_is_dead_status(item))
        });
        let mut death_at = consistency_field_date(character, &["deathDate", "dateOfDeath", "deceasedAt", "deathTime"]);
        if death_at.is_none() {
            for event in &timelines {
                let participants = consistency_field_values(event, &["character", "characterId", "characters", "participants"]);
                if !consistency_mentions_entity(&participants, character) || !consistency_is_death_event(event) { continue; }
                if let Some(date) = consistency_timeline_date(event) {
                    if death_at.map(|current| date < current).unwrap_or(true) { death_at = Some(date); }
                }
            }
        }
        if dead {
            if let Some(death_date) = death_at {
                if let Some(later) = timelines.iter().find(|event| {
                    let date = consistency_timeline_date(event);
                    let participants = consistency_field_values(event, &["character", "characterId", "characters", "participants"]);
                    date.map(|date| date > death_date).unwrap_or(false) && consistency_mentions_entity(&participants, character) && !consistency_is_death_event(event)
                }) {
                    issues.push(consistency_issue("warning", "posthumous-appearance", "人物可能在死亡事件之后继续出现", format!("人物“{}”在结构化死亡时间之后仍出现在时间线事件“{}”中，请确认是否为回忆、幻象或时间线误记。", character.title, later.title), &character.id, &character.kind, &character.file_path));
                }
            }
        }
    }

    let mut character_groups: std::collections::HashMap<String, Vec<&crate::models::EntityRecord>> = std::collections::HashMap::new();
    for character in &characters {
        character_groups.entry(character.title.trim().to_lowercase()).or_default().push(character);
    }
    for group in character_groups.values() {
        if group.len() < 2 { continue; }
        let mut genders = group.iter().flat_map(|character| consistency_character_gender_values(character)).collect::<Vec<_>>();
        genders.sort();
        genders.dedup();
        if genders.len() > 1 {
            issues.push(consistency_issue("warning", "character-gender-conflict", "性别描述可能冲突", format!("同名人物资料的结构化性别字段出现不一致值：{}。", genders.join("、")), &group[0].id, &group[0].kind, &group[0].file_path));
        }
    }

    for left in 0..characters.len() {
        for right in (left + 1)..characters.len() {
            if !consistency_is_similar_name(&characters[left].title, &characters[right].title) { continue; }
            issues.push(consistency_issue("warning", "similar-character-name", "名称可能相似", format!("人物“{}”与“{}”名称相似，请确认是否为不同人物或同一人物的拼写变化。", characters[left].title, characters[right].title), &characters[right].id, &characters[right].kind, &characters[right].file_path));
        }
    }

    let locations: Vec<&crate::models::EntityRecord> = entities.iter().filter(|entity| entity.kind == "location").collect();
    for left in 0..locations.len() {
        for right in (left + 1)..locations.len() {
            if !consistency_is_similar_name(&locations[left].title, &locations[right].title) { continue; }
            issues.push(consistency_issue("warning", "similar-location-name", "地点名称可能相似", format!("地点“{}”与“{}”名称相似，请确认层级或拼写。", locations[left].title, locations[right].title), &locations[right].id, &locations[right].kind, &locations[right].file_path));
        }
    }

    let mut previous_timeline: Option<(String, i64)> = None;
    for event in &timelines {
        let (start, end) = consistency_timeline_range(event);
        if let (Some(start), Some(end)) = (start, end) {
            if end < start {
                issues.push(consistency_issue("warning", "timeline-range", "时间线结束时间早于开始时间", format!("事件“{}”的结束时间早于开始时间，请确认时间范围。", event.title), &event.id, &event.kind, &event.file_path));
            }
        }
        let Some(date) = consistency_timeline_date(event) else { continue };
        if let Some((previous_title, previous_date)) = &previous_timeline {
            if date < *previous_date {
                issues.push(consistency_issue("warning", "timeline-order", "时间线日期可能逆序", format!("事件“{}”的日期早于前一个结构化事件“{}”，请确认时间线顺序。", event.title, previous_title), &event.id, &event.kind, &event.file_path));
            }
        }
        previous_timeline = Some((event.title.clone(), date));
    }

    let errors = issues.iter().filter(|issue| issue.severity == "error").count() as u64;
    let warnings = issues.iter().filter(|issue| issue.severity == "warning").count() as u64;
    Ok(crate::models::ConsistencyReport { checked_at: storage::now(), issue_count: issues.len() as u64, errors, warnings, issues })
}


struct ExportRenderOptions {
    include_volume_titles: bool,
    include_chapter_titles: bool,
}

fn export_nodes(
    root: &Path,
    nodes: &[NodeRecord],
    parent_id: Option<&str>,
    level: usize,
    format: &str,
    output: &mut String,
    options: &ExportRenderOptions,
) {
    for node in node_children(nodes, parent_id) {
        let include_title = if node.kind == "volume" {
            options.include_volume_titles
        } else {
            options.include_chapter_titles
        };
        if include_title {
            if format == "markdown" {
                output.push_str(&format!("\n{} {}\n\n", "#".repeat(level.max(1)), node.title));
            } else {
                output.push_str(&format!("\n{}\n{}\n\n", node.title, "=".repeat(node.title.chars().count().max(3))));
            }
        }
        if node.kind != "volume" {
            if let Ok(content) = fs::read_to_string(storage::safe_relative(root, &node.file_path).unwrap_or_else(|_| PathBuf::new())) {
                let content = storage::strip_markdown_frontmatter(&content);
                let clean = if format == "txt" {
                    export_plain_text(&parse_export_document(&content))
                } else {
                    content.lines().filter(|line| !line.trim_start().starts_with("# ")).collect::<Vec<_>>().join("\n")
                };
                output.push_str(clean.trim());
                output.push_str("\n\n");
            }
        }
        export_nodes(root, nodes, Some(&node.id), level + 1, format, output, options);
    }
}

#[derive(Debug, Clone)]
enum ExportInline {
    Text(String),
    Strong(Vec<ExportInline>),
    Emphasis(Vec<ExportInline>),
    Strike(Vec<ExportInline>),
    Code(String),
    Link { label: Vec<ExportInline>, href: String },
    Image { alt: String, src: String },
    Wiki(String),
}

#[derive(Debug, Clone)]
struct ExportListItem {
    content: Vec<ExportInline>,
    checked: Option<bool>,
}

#[derive(Debug, Clone)]
enum ExportBlock {
    Heading { level: usize, content: Vec<ExportInline> },
    Paragraph(Vec<ExportInline>),
    Quote(Vec<ExportInline>),
    List { ordered: bool, items: Vec<ExportListItem> },
    CodeBlock(String),
    HorizontalRule,
    Table { headers: Vec<Vec<ExportInline>>, rows: Vec<Vec<Vec<ExportInline>>> },
}

#[derive(Debug, Clone, Default)]
struct ExportDocument {
    blocks: Vec<ExportBlock>,
}

fn export_fence_character(line: &str) -> Option<char> {
    let trimmed = line.trim_start();
    if trimmed.as_bytes().starts_with(&[96, 96, 96]) { Some(char::from(96)) }
    else if trimmed.starts_with("~~~") { Some('~') }
    else { None }
}

fn export_list_marker(line: &str) -> Option<(bool, Option<bool>, String)> {
    let trimmed = line.trim_start();
    for (marker, checked) in [("- [ ] ", Some(false)), ("- [x] ", Some(true)), ("- [X] ", Some(true))] {
        if let Some(content) = trimmed.strip_prefix(marker) {
            return Some((false, checked, content.to_string()));
        }
    }
    for marker in ["- ", "* ", "+ "] {
        if let Some(content) = trimmed.strip_prefix(marker) {
            return Some((false, None, content.to_string()));
        }
    }
    let digits = trimmed.char_indices().take_while(|(_, character)| character.is_ascii_digit()).collect::<Vec<_>>();
    if let Some((end, _)) = digits.last() {
        let marker_end = end + 1;
        if let Some(marker) = trimmed[marker_end..].chars().next() {
            if (marker == '.' || marker == ')') && trimmed[marker_end + marker.len_utf8()..].starts_with(' ') {
                return Some((true, None, trimmed[marker_end + marker.len_utf8() + 1..].to_string()));
            }
        }
    }
    None
}

fn export_table_cells(line: &str) -> Option<Vec<String>> {
    let trimmed = line.trim();
    if !trimmed.contains('|') { return None; }
    let value = trimmed.strip_prefix('|').unwrap_or(trimmed);
    let value = value.strip_suffix('|').unwrap_or(value);
    Some(value.split('|').map(|cell| cell.trim().to_string()).collect())
}

fn export_is_table_separator(line: &str) -> bool {
    export_table_cells(line).map(|cells| !cells.is_empty() && cells.iter().all(|cell| {
        let value = cell.trim_matches(':').trim();
        value.len() >= 3 && value.chars().all(|character| character == '-')
    })).unwrap_or(false)
}

fn export_is_horizontal_rule(line: &str) -> bool {
    matches!(line.trim(), "---" | "***" | "___")
}

fn export_is_block_start(line: &str) -> bool {
    let trimmed = line.trim();
    !trimmed.is_empty()
        && (heading_level(trimmed).is_some() || export_fence_character(trimmed).is_some()
            || export_list_marker(trimmed).is_some() || trimmed.starts_with('>')
            || export_is_horizontal_rule(trimmed))
}

fn parse_export_link(source: &str, image: bool) -> Option<(usize, String, String)> {
    let prefix = if image { "![" } else { "[" };
    if !source.starts_with(prefix) { return None; }
    let label_start = prefix.len();
    let close = source[label_start..].find("](")?;
    let url_start = label_start + close + 2;
    let url_end = source[url_start..].find(')')?;
    let consumed = url_start + url_end + 1;
    Some((consumed, source[label_start..label_start + close].to_string(), source[url_start..url_start + url_end].to_string()))
}

fn parse_export_inline(source: &str) -> Vec<ExportInline> {
    let mut result = Vec::new();
    let mut offset = 0;
    while offset < source.len() {
        let rest = &source[offset..];
        if rest.starts_with("[[") {
            if let Some(end) = rest[2..].find("]]") {
                let target = rest[2..2 + end].trim().to_string();
                if !target.is_empty() {
                    result.push(ExportInline::Wiki(target));
                    offset += 2 + end + 2;
                    continue;
                }
            }
        }
        if let Some((consumed, label, href)) = parse_export_link(rest, true) {
            result.push(ExportInline::Image { alt: label, src: href });
            offset += consumed;
            continue;
        }
        if let Some((consumed, label, href)) = parse_export_link(rest, false) {
            result.push(ExportInline::Link { label: parse_export_inline(&label), href });
            offset += consumed;
            continue;
        }
        let mut consumed_pair = None;
        for (marker, kind) in [("**", 0_u8), ("__", 0_u8), ("~~", 1_u8), ("*", 2_u8), ("_", 2_u8)] {
            if !rest.starts_with(marker) { continue; }
            if let Some(end) = rest[marker.len()..].find(marker) {
                let inner = &rest[marker.len()..marker.len() + end];
                if !inner.is_empty() {
                    let inline = match kind {
                        0 => ExportInline::Strong(parse_export_inline(inner)),
                        1 => ExportInline::Strike(parse_export_inline(inner)),
                        _ => ExportInline::Emphasis(parse_export_inline(inner)),
                    };
                    consumed_pair = Some((marker.len() + end + marker.len(), inline));
                    break;
                }
            }
        }
        if let Some((consumed, inline)) = consumed_pair {
            result.push(inline);
            offset += consumed;
            continue;
        }
        let code_marker = char::from(96).to_string();
        if rest.starts_with(&code_marker) {
            if let Some(end) = rest[1..].find(char::from(96)) {
                result.push(ExportInline::Code(rest[1..1 + end].to_string()));
                offset += end + 2;
                continue;
            }
        }
        let next = rest.char_indices().skip(1).find(|(_, character)| {
            *character == '[' || *character == '*' || *character == '_' || *character == '~' || *character == char::from(96)
        }).map(|(index, _)| index).unwrap_or(rest.len());
        if next == 0 {
            let character = rest.chars().next().unwrap();
            let size = character.len_utf8();
            result.push(ExportInline::Text(rest[..size].to_string()));
            offset += size;
        } else {
            result.push(ExportInline::Text(rest[..next].to_string()));
            offset += next;
        }
    }
    result
}

fn parse_export_document(markdown: &str) -> ExportDocument {
    let lines = markdown.lines().collect::<Vec<_>>();
    let mut blocks = Vec::new();
    let mut index = 0;
    while index < lines.len() {
        let line = lines[index];
        let trimmed = line.trim();
        if trimmed.is_empty() { index += 1; continue; }
        if let Some(fence) = export_fence_character(trimmed) {
            index += 1;
            let mut code = Vec::new();
            while index < lines.len() {
                if export_fence_character(lines[index]).is_some_and(|character| character == fence) {
                    index += 1;
                    break;
                }
                code.push(lines[index]);
                index += 1;
            }
            blocks.push(ExportBlock::CodeBlock(code.join("\n")));
            continue;
        }
        if let Some(level) = heading_level(trimmed) {
            blocks.push(ExportBlock::Heading { level: level.min(6), content: parse_export_inline(trimmed[level + 1..].trim()) });
            index += 1;
            continue;
        }
        if export_is_horizontal_rule(trimmed) {
            blocks.push(ExportBlock::HorizontalRule);
            index += 1;
            continue;
        }
        if trimmed.starts_with('>') {
            let mut quote = Vec::new();
            while index < lines.len() && lines[index].trim_start().starts_with('>') {
                let value = lines[index].trim_start().strip_prefix('>').unwrap_or("").trim_start();
                quote.push(value);
                index += 1;
            }
            blocks.push(ExportBlock::Quote(parse_export_inline(&quote.join("\n"))));
            continue;
        }
        if let Some((ordered, checked, content)) = export_list_marker(line) {
            let mut items = vec![ExportListItem { content: parse_export_inline(&content), checked }];
            index += 1;
            while index < lines.len() {
                let Some((next_ordered, next_checked, next_content)) = export_list_marker(lines[index]) else { break };
                if next_ordered != ordered { break; }
                items.push(ExportListItem { content: parse_export_inline(&next_content), checked: next_checked });
                index += 1;
            }
            blocks.push(ExportBlock::List { ordered, items });
            continue;
        }
        if index + 1 < lines.len() && export_table_cells(line).is_some() && export_is_table_separator(lines[index + 1]) {
            let headers = export_table_cells(line).unwrap_or_default().into_iter().map(|cell| parse_export_inline(&cell)).collect::<Vec<_>>();
            index += 2;
            let mut rows = Vec::new();
            while index < lines.len() {
                let Some(cells) = export_table_cells(lines[index]) else { break };
                rows.push(cells.into_iter().map(|cell| parse_export_inline(&cell)).collect());
                index += 1;
            }
            blocks.push(ExportBlock::Table { headers, rows });
            continue;
        }
        let mut paragraph = vec![line];
        index += 1;
        while index < lines.len() && !lines[index].trim().is_empty() && !export_is_block_start(lines[index]) {
            if index + 1 < lines.len() && export_table_cells(lines[index]).is_some() && export_is_table_separator(lines[index + 1]) { break; }
            paragraph.push(lines[index]);
            index += 1;
        }
        blocks.push(ExportBlock::Paragraph(parse_export_inline(&paragraph.join("\n"))));
    }
    ExportDocument { blocks }
}

fn export_plain_code(value: &str) -> String {
    let mut result = value.replace("**", "").replace("__", "").replace("~~", "").replace(char::from(96), "");
    while let Some(start) = result.find("[[") {
        let Some(end_offset) = result[start + 2..].find("]]") else { break };
        let end = start + 2 + end_offset;
        let target = result[start + 2..end].trim().to_string();
        result.replace_range(start..end + 2, &target);
    }
    result
}

fn export_plain_inlines(inlines: &[ExportInline]) -> String {
    inlines.iter().map(|inline| match inline {
        ExportInline::Text(text) | ExportInline::Wiki(text) => text.clone(),
        ExportInline::Code(text) => export_plain_code(text),
        ExportInline::Strong(children) | ExportInline::Emphasis(children) | ExportInline::Strike(children) => export_plain_inlines(children),
        ExportInline::Link { label, .. } => export_plain_inlines(label),
        ExportInline::Image { alt, .. } => alt.clone(),
    }).collect()
}

fn export_plain_text(document: &ExportDocument) -> String {
    let mut lines = Vec::new();
    for block in &document.blocks {
        match block {
            ExportBlock::Heading { content, .. } | ExportBlock::Paragraph(content) | ExportBlock::Quote(content) => lines.push(export_plain_inlines(content)),
            ExportBlock::List { items, .. } => lines.extend(items.iter().map(|item| export_plain_inlines(&item.content))),
            ExportBlock::CodeBlock(content) => lines.push(export_plain_code(content)),
            ExportBlock::HorizontalRule => {},
            ExportBlock::Table { headers, rows } => {
                lines.push(headers.iter().map(|cell| export_plain_inlines(cell)).collect::<Vec<_>>().join("\t"));
                lines.extend(rows.iter().map(|row| row.iter().map(|cell| export_plain_inlines(cell)).collect::<Vec<_>>().join("\t")));
            }
        }
    }
    lines.into_iter().filter(|line| !line.trim().is_empty()).collect::<Vec<_>>().join("\n")
}

fn export_scope_nodes(nodes: &[NodeRecord], input: &ExportInput) -> Result<Vec<NodeRecord>, String> {
    let scope = input.scope.as_deref().unwrap_or("project");
    let mut selected_ids = HashSet::new();
    match scope {
        "project" => {
            selected_ids.extend(nodes.iter().map(|node| node.id.clone()));
        }
        "volume" => {
            let volume_path = input.volume_path.as_deref().ok_or_else(|| "指定卷导出需要卷路径".to_string())?;
            let volume = nodes.iter().find(|node| node.kind == "volume" && node.file_path == volume_path)
                .ok_or_else(|| "指定导出卷不存在".to_string())?;
            selected_ids.extend(descendant_ids(nodes, &volume.id));
        }
        "chapters" => {
            let ids = input.node_ids.as_deref().ok_or_else(|| "指定章节导出需要章节 ID".to_string())?;
            for id in ids {
                let node = nodes.iter().find(|node| node.id == *id)
                    .ok_or_else(|| format!("指定章节不存在：{}", id))?;
                selected_ids.extend(descendant_ids(nodes, &node.id));
            }
        }
        _ => return Err(format!("不支持的导出范围：{}", scope)),
    }
    let mut filtered: Vec<NodeRecord> = nodes
        .iter()
        .filter(|node| selected_ids.contains(&node.id))
        .cloned()
        .collect();
    for node in &mut filtered {
        if node.parent_id.as_ref().map(|id| !selected_ids.contains(id)).unwrap_or(false) {
            node.parent_id = None;
        }
    }
    Ok(filtered)
}

fn xml_escape(value: &str) -> String {
    value.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
        .replace('"', "&quot;").replace('\'', "&apos;")
}

fn heading_level(line: &str) -> Option<usize> {
    let level = line.chars().take_while(|character| *character == '#').count();
    (level > 0 && line.chars().nth(level) == Some(' ')).then_some(level)
}

fn export_html_inlines(inlines: &[ExportInline]) -> String {
    inlines.iter().map(|inline| match inline {
        ExportInline::Text(text) => xml_escape(text).replace('\n', "<br/>"),
        ExportInline::Strong(children) => format!("<strong>{}</strong>", export_html_inlines(children)),
        ExportInline::Emphasis(children) => format!("<em>{}</em>", export_html_inlines(children)),
        ExportInline::Strike(children) => format!("<del>{}</del>", export_html_inlines(children)),
        ExportInline::Code(text) => format!("<code>{}</code>", xml_escape(text)),
        ExportInline::Link { label, href } => format!("<a href=\"{}\">{}</a>", xml_escape(href), export_html_inlines(label)),
        ExportInline::Image { alt, src } => format!("<img src=\"{}\" alt=\"{}\" />", xml_escape(src), xml_escape(alt)),
        ExportInline::Wiki(target) => format!("<a class=\"wiki-link\" data-wiki-target=\"{}\" href=\"#wiki-{}\">{}</a>", xml_escape(target), xml_escape(&target.replace(' ', "-")), xml_escape(target)),
    }).collect()
}

fn export_html_fragment(document: &ExportDocument, include_toc: bool) -> (String, String) {
    let mut body = String::new();
    let mut toc = String::new();
    let mut heading_index = 0_usize;
    for block in &document.blocks {
        match block {
            ExportBlock::Heading { level, content } => {
                heading_index += 1;
                let id = format!("heading-{}", heading_index);
                let text = export_html_inlines(content);
                body.push_str(&format!("<h{} id=\"{}\">{}</h{}>", level, id, text, level));
                if include_toc {
                    toc.push_str(&format!("<li class=\"toc-level-{}\"><a href=\"#{}\">{}</a></li>", level, id, text));
                }
            },
            ExportBlock::Paragraph(content) => body.push_str(&format!("<p>{}</p>", export_html_inlines(content))),
            ExportBlock::Quote(content) => body.push_str(&format!("<blockquote>{}</blockquote>", export_html_inlines(content))),
            ExportBlock::List { ordered, items } => {
                let tag = if *ordered { "ol" } else { "ul" };
                body.push_str(&format!("<{}>", tag));
                for item in items {
                    let checkbox = item.checked.map(|checked| format!("<input type=\"checkbox\" disabled{} /> ", if checked { " checked" } else { "" })).unwrap_or_default();
                    body.push_str(&format!("<li>{}{}</li>", checkbox, export_html_inlines(&item.content)));
                }
                body.push_str(&format!("</{}>", tag));
            },
            ExportBlock::CodeBlock(content) => body.push_str(&format!("<pre><code>{}</code></pre>", xml_escape(content))),
            ExportBlock::HorizontalRule => body.push_str("<hr/>"),
            ExportBlock::Table { headers, rows } => {
                body.push_str("<table><thead><tr>");
                for cell in headers { body.push_str(&format!("<th>{}</th>", export_html_inlines(cell))); }
                body.push_str("</tr></thead><tbody>");
                for row in rows {
                    body.push_str("<tr>");
                    for cell in row { body.push_str(&format!("<td>{}</td>", export_html_inlines(cell))); }
                    body.push_str("</tr>");
                }
                body.push_str("</tbody></table>");
            },
        }
    }
    (body, toc)
}

fn docx_run(text: &str, run_properties: &str) -> String {
    let mut value = String::new();
    for (index, line) in text.split('\n').enumerate() {
        if index > 0 { value.push_str("<w:br/>"); }
        value.push_str(&format!("<w:r>{}<w:t xml:space=\"preserve\">{}</w:t></w:r>", if run_properties.is_empty() { String::new() } else { format!("<w:rPr>{}</w:rPr>", run_properties) }, xml_escape(line)));
    }
    value
}

fn export_docx_inlines_with_properties(inlines: &[ExportInline], inherited: &str) -> String {
    let mut result = String::new();
    for inline in inlines {
        match inline {
            ExportInline::Text(text) => result.push_str(&docx_run(text, inherited)),
            ExportInline::Strong(children) => result.push_str(&export_docx_inlines_with_properties(children, &(inherited.to_string() + "<w:b/>"))),
            ExportInline::Emphasis(children) => result.push_str(&export_docx_inlines_with_properties(children, &(inherited.to_string() + "<w:i/>"))),
            ExportInline::Strike(children) => result.push_str(&export_docx_inlines_with_properties(children, &(inherited.to_string() + "<w:strike/>"))),
            ExportInline::Code(text) => result.push_str(&docx_run(text, &(inherited.to_string() + "<w:rStyle w:val=\"CodeChar\"/>"))),
            ExportInline::Link { label, .. } => result.push_str(&export_docx_inlines_with_properties(label, &(inherited.to_string() + "<w:color w:val=\"0563C1\"/><w:u w:val=\"single\"/>"))),
            ExportInline::Image { alt, .. } => result.push_str(&docx_run(alt, &(inherited.to_string() + "<w:color w:val=\"666666\"/>"))),
            ExportInline::Wiki(target) => result.push_str(&docx_run(target, &(inherited.to_string() + "<w:color w:val=\"7030A0\"/><w:u w:val=\"single\"/>"))),
        }
    }
    result
}

fn export_docx_table(table: &ExportBlock) -> String {
    let ExportBlock::Table { headers, rows } = table else { return String::new() };
    let mut result = String::from("<w:tbl><w:tblPr><w:tblBorders><w:top w:val=\"single\"/><w:left w:val=\"single\"/><w:bottom w:val=\"single\"/><w:right w:val=\"single\"/><w:insideH w:val=\"single\"/><w:insideV w:val=\"single\"/></w:tblBorders></w:tblPr>");
    result.push_str("<w:tr>");
    for cell in headers { result.push_str(&format!("<w:tc><w:p>{}</w:p></w:tc>", export_docx_inlines_with_properties(cell, "<w:b/>"))); }
    result.push_str("</w:tr>");
    for row in rows {
        result.push_str("<w:tr>");
        for cell in row { result.push_str(&format!("<w:tc><w:p>{}</w:p></w:tc>", export_docx_inlines_with_properties(cell, ""))); }
        result.push_str("</w:tr>");
    }
    result.push_str("</w:tbl>");
    result
}

fn docx_cover_drawing() -> String {
    "<w:p><w:r><w:drawing><wp:inline distT=\"0\" distB=\"0\" distL=\"0\" distR=\"0\"><wp:extent cx=\"4572000\" cy=\"6096000\"/><wp:docPr id=\"1\" name=\"封面\"/><a:graphic><a:graphicData uri=\"http://schemas.openxmlformats.org/drawingml/2006/picture\"><pic:pic><pic:nvPicPr><pic:cNvPr id=\"0\" name=\"cover\"/><pic:cNvPrPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed=\"rIdCover\"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x=\"0\" y=\"0\"/><a:ext cx=\"4572000\" cy=\"6096000\"/></a:xfrm><a:prstGeom prst=\"rect\"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>".to_string()
}

fn export_docx_xml_from_document(document: &ExportDocument, cover: Option<&ExportCover>) -> String {
    let mut body = String::new();
    if cover.is_some() { body.push_str(&docx_cover_drawing()); }
    for block in &document.blocks {
        match block {
            ExportBlock::Heading { level, content } => body.push_str(&format!("<w:p><w:pPr><w:pStyle w:val=\"Heading{}\"/></w:pPr>{}</w:p>", level, export_docx_inlines_with_properties(content, ""))),
            ExportBlock::Paragraph(content) => body.push_str(&format!("<w:p>{}</w:p>", export_docx_inlines_with_properties(content, ""))),
            ExportBlock::Quote(content) => body.push_str(&format!("<w:p><w:pPr><w:pStyle w:val=\"Quote\"/></w:pPr>{}</w:p>", export_docx_inlines_with_properties(content, "<w:i/>"))),
            ExportBlock::List { ordered, items } => {
                let number_id = if *ordered { 2 } else { 1 };
                for item in items {
                    let checkbox = item.checked.map(|checked| if checked { "☑ " } else { "☐ " }).unwrap_or("");
                    let prefix = if checkbox.is_empty() { String::new() } else { checkbox.to_string() };
                    body.push_str(&format!("<w:p><w:pPr><w:numPr><w:ilvl w:val=\"0\"/><w:numId w:val=\"{}\"/></w:numPr></w:pPr>{}{}</w:p>", number_id, docx_run(&prefix, ""), export_docx_inlines_with_properties(&item.content, "")));
                }
            },
            ExportBlock::CodeBlock(content) => body.push_str(&format!("<w:p><w:pPr><w:pStyle w:val=\"IntenseQuote\"/></w:pPr>{}</w:p>", docx_run(content, "<w:rStyle w:val=\"CodeChar\"/>"))),
            ExportBlock::HorizontalRule => body.push_str("<w:p><w:pPr><w:pBdr><w:bottom w:val=\"single\" w:sz=\"6\"/></w:pBdr></w:pPr></w:p>"),
            ExportBlock::Table { .. } => body.push_str(&export_docx_table(block)),
        }
    }
    format!(r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>{}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>"#, body)
}

fn docx_xml(markdown: &str, cover: Option<&ExportCover>) -> String {
    export_docx_xml_from_document(&parse_export_document(markdown), cover)
}

fn zip_document_with_binary(files: &[(&str, &str)], binary: &[(&str, &[u8])], stored: &[&str]) -> Result<Vec<u8>, String> {
    let cursor = Cursor::new(Vec::new());
    let mut writer = ZipWriter::new(cursor);
    for (name, content) in files {
        let method = if stored.iter().any(|item| item == name) { CompressionMethod::Stored } else { CompressionMethod::Deflated };
        let options = SimpleFileOptions::default().compression_method(method);
        writer.start_file(*name, options).map_err(|error| format!("创建压缩文件失败：{}", error))?;
        writer.write_all(content.as_bytes()).map_err(|error| format!("写入压缩文件失败：{}", error))?;
    }
    for (name, content) in binary {
        let method = if stored.iter().any(|item| item == name) { CompressionMethod::Stored } else { CompressionMethod::Deflated };
        let options = SimpleFileOptions::default().compression_method(method);
        writer.start_file(*name, options).map_err(|error| format!("创建压缩文件失败：{}", error))?;
        writer.write_all(content).map_err(|error| format!("写入压缩文件失败：{}", error))?;
    }
    writer.finish().map(|cursor| cursor.into_inner()).map_err(|error| format!("完成压缩文件失败：{}", error))
}

#[derive(Debug, Clone)]
struct ExportCover {
    file_name: String,
    mime_type: String,
    bytes: Vec<u8>,
    data_uri: String,
}

fn export_base64(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = String::new();
    let mut index = 0;
    while index < bytes.len() {
        let first = bytes[index] as u32;
        let second = bytes.get(index + 1).copied().unwrap_or(0) as u32;
        let third = bytes.get(index + 2).copied().unwrap_or(0) as u32;
        let combined = (first << 16) | (second << 8) | third;
        result.push(ALPHABET[((combined >> 18) & 63) as usize] as char);
        result.push(ALPHABET[((combined >> 12) & 63) as usize] as char);
        result.push(if index + 1 < bytes.len() { ALPHABET[((combined >> 6) & 63) as usize] as char } else { '=' });
        result.push(if index + 2 < bytes.len() { ALPHABET[(combined & 63) as usize] as char } else { '=' });
        index += 3;
    }
    result
}

fn export_cover(root: &Path, path: Option<&str>) -> Result<Option<ExportCover>, String> {
    let Some(path) = path else { return Ok(None); };
    let absolute = storage::safe_relative(root, path)?;
    if !absolute.is_file() { return Err("封面文件不存在".to_string()); }
    let extension = absolute.extension().and_then(|value| value.to_str()).unwrap_or("").to_lowercase();
    let mime_type = match extension.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        _ => return Err("封面必须是 jpg、png、gif、webp 或 svg 图片".to_string()),
    }.to_string();
    let bytes = fs::read(&absolute).map_err(|error| format!("读取封面失败：{}", error))?;
    let file_name = format!("cover.{}", if extension.is_empty() { "bin" } else { extension.as_str() });
    let data_uri = format!("data:{};base64,{}", mime_type, export_base64(&bytes));
    Ok(Some(ExportCover { file_name, mime_type, bytes, data_uri }))
}

fn docx_bytes(markdown: &str, cover: Option<&ExportCover>) -> Result<Vec<u8>, String> {
    let document = docx_xml(markdown, cover);
    let numbering = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/></w:lvl></w:abstractNum><w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>"#;
    let cover_default = cover.map(|asset| {
        let extension = asset.file_name.rsplit('.').next().unwrap_or("bin");
        format!("<Default Extension=\"{}\" ContentType=\"{}\"/>", xml_escape(extension), xml_escape(&asset.mime_type))
    }).unwrap_or_default();
    let content_types = format!(r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>{}<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>"#, cover_default);
    let rels = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>"#;
    let document_rels = cover.map(|asset| format!(r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdCover" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/{}"/></Relationships>"#, xml_escape(&asset.file_name)));
    let mut files = vec![("[Content_Types].xml", content_types.as_str()), ("_rels/.rels", rels), ("word/document.xml", document.as_str()), ("word/numbering.xml", numbering)];
    if let Some(document_rels) = document_rels.as_ref() {
        files.push(("word/_rels/document.xml.rels", document_rels.as_str()));
    }
    let cover_name = cover.map(|asset| format!("word/media/{}", asset.file_name));
    let binary = cover.map(|asset| vec![(cover_name.as_deref().unwrap_or("word/media/cover.bin"), asset.bytes.as_slice())]).unwrap_or_default();
    zip_document_with_binary(&files, &binary, &[])
}

fn export_epub_parts(document: &ExportDocument) -> Vec<(String, ExportDocument, String)> {
    let mut groups: Vec<Vec<ExportBlock>> = Vec::new();
    let mut current = Vec::new();
    for block in &document.blocks {
        let split = matches!(block, ExportBlock::Heading { level: 1, .. }) && !current.is_empty();
        if split {
            groups.push(std::mem::take(&mut current));
        }
        current.push(block.clone());
    }
    if !current.is_empty() { groups.push(current); }
    if groups.is_empty() { groups.push(Vec::new()); }
    groups.into_iter().enumerate().map(|(index, blocks)| {
        let label = blocks.iter().find_map(|block| {
            if let ExportBlock::Heading { content, .. } = block { Some(export_plain_inlines(content)) } else { None }
        }).filter(|value| !value.trim().is_empty()).unwrap_or_else(|| format!("第{}章", index + 1));
        (format!("chapter-{:03}.xhtml", index + 1), ExportDocument { blocks }, label)
    }).collect()
}

fn epub_xhtml_document(document: &ExportDocument, cover: Option<&ExportCover>, title: &str) -> String {
    let (body, _) = export_html_fragment(&document, false);
    let cover_markup = cover.map(|asset| format!("<p class=\"cover\"><img src=\"images/{}\" alt=\"封面\" /></p>", xml_escape(&asset.file_name))).unwrap_or_default();
    format!(r#"<?xml version="1.0" encoding="utf-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml"><head><meta charset="utf-8"/><title>{}</title><style>body{{font-family:serif;line-height:1.8;margin:5%;}}h1,h2,h3{{line-height:1.3;}}.cover{{text-align:center}}.cover img{{max-width:100%;max-height:520px}}</style></head><body>{}{}</body></html>"#, xml_escape(title), cover_markup, body)
}

fn epub_bytes(markdown: &str, title: &str, author: &str, cover: Option<&ExportCover>) -> Result<Vec<u8>, String> {
    let document = parse_export_document(markdown);
    let xhtml = epub_xhtml_document(&document, cover, title);
    let parts = export_epub_parts(&document);
    let mut nav_entries = String::new();
    for (file_name, part, label) in &parts {
        let level = part.blocks.iter().find_map(|block| if let ExportBlock::Heading { level, .. } = block { Some(*level) } else { None }).unwrap_or(1);
        nav_entries.push_str(&format!("<li class=\"toc-level-{}\"><a href=\"{}#heading-1\">{}</a></li>", level, xml_escape(file_name), xml_escape(label)));
    }
    if nav_entries.is_empty() {
        nav_entries.push_str(&format!("<li><a href=\"content.xhtml\">{}</a></li>", xml_escape(title)));
    }
    let nav = format!(r#"<?xml version="1.0" encoding="utf-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>{}</title></head><body><nav epub:type="toc" id="toc"><h1>目录</h1><ol>{}</ol></nav></body></html>"#, xml_escape(title), nav_entries);
    let container = r#"<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>"#;
    let cover_manifest = cover.map(|asset| format!("<item id=\"cover-image\" href=\"images/{}\" media-type=\"{}\" properties=\"cover-image\"/>", xml_escape(&asset.file_name), xml_escape(&asset.mime_type))).unwrap_or_default();
    let cover_metadata = cover.map(|_| "<meta name=\"cover\" content=\"cover-image\"/>").unwrap_or_default();
    let part_manifest = parts.iter().enumerate().map(|(index, (file_name, _, _))| format!("<item id=\"chapter-{}\" href=\"{}\" media-type=\"application/xhtml+xml\"/>", index + 1, xml_escape(file_name))).collect::<String>();
    let part_spine = parts.iter().enumerate().map(|(index, _)| format!("<itemref idref=\"chapter-{}\"/>", index + 1)).collect::<String>();
    let opf = format!(r#"<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book-id">novelforge-{}</dc:identifier><dc:title>{}</dc:title><dc:creator>{}</dc:creator><dc:language>zh</dc:language>{}</metadata><manifest><item id="content" href="content.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>{}{}</manifest><spine toc="nav"><itemref idref="nav"/>{}</spine></package>"#, storage::new_id(), xml_escape(title), xml_escape(author), cover_metadata, cover_manifest, part_manifest, part_spine);
    let mut file_storage = vec![
        ("mimetype".to_string(), "application/epub+zip".to_string()),
        ("META-INF/container.xml".to_string(), container.to_string()),
        ("OEBPS/content.opf".to_string(), opf),
        ("OEBPS/nav.xhtml".to_string(), nav),
        ("OEBPS/content.xhtml".to_string(), xhtml),
    ];
    for (file_name, part, _) in &parts {
        file_storage.push(("OEBPS/".to_string() + file_name, epub_xhtml_document(part, cover, title)));
    }
    let files = file_storage.iter().map(|(name, content)| (name.as_str(), content.as_str())).collect::<Vec<_>>();
    let cover_name = cover.map(|asset| format!("OEBPS/images/{}", asset.file_name));
    let binary = cover.map(|asset| vec![(cover_name.as_deref().unwrap_or("OEBPS/images/cover.bin"), asset.bytes.as_slice())]).unwrap_or_default();
    zip_document_with_binary(&files, &binary, &["mimetype"])
}

fn html_bytes(markdown: &str, title: &str, author: &str, include_toc: bool, cover: Option<&ExportCover>) -> Vec<u8> {
    let document = parse_export_document(markdown);
    let (body, toc) = export_html_fragment(&document, include_toc);
    let cover = cover
        .map(|asset| format!("<p class=\"cover\"><img src=\"{}\" alt=\"封面\" /></p>", xml_escape(&asset.data_uri)))
        .unwrap_or_default();
    let toc_html = if include_toc {
        format!("<nav class=\"toc\"><h2>目录</h2><ol>{}</ol></nav>", toc)
    } else {
        String::new()
    };
    format!(
        "<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\"><meta name=\"author\" content=\"{}\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>{}</title><style>body{{font-family:serif;line-height:1.9;max-width:860px;margin:40px auto;padding:0 24px;color:#27211e}}h1{{margin-bottom:4px}}.author{{color:#756b64}}.toc{{padding:16px 20px;background:#f7f3ef;border-radius:8px}}.toc-level-2{{margin-left:16px}}.toc-level-3{{margin-left:32px}}.cover{{text-align:center}}.cover img{{max-width:100%;max-height:520px}}</style></head><body><header><h1>{}</h1><p class=\"author\">作者：{}</p></header>{}{}<main>{}</main></body></html>",
        xml_escape(author), xml_escape(title), xml_escape(title), xml_escape(author), cover, toc_html, body
    ).into_bytes()
}

fn pdf_hex_text(value: &str) -> String {
    value.encode_utf16().map(|unit| format!("{:04X}", unit)).collect()
}

fn pdf_plain_text(markdown: &str) -> String {
    export_plain_text(&parse_export_document(markdown))
}

fn pdf_jpeg_dimensions(bytes: &[u8]) -> Option<(u16, u16)> {
    if bytes.len() < 4 || bytes[0] != 0xFF || bytes[1] != 0xD8 { return None; }
    let mut index = 2;
    while index + 9 < bytes.len() {
        if bytes[index] != 0xFF { index += 1; continue; }
        while index < bytes.len() && bytes[index] == 0xFF { index += 1; }
        if index >= bytes.len() { break; }
        let marker = bytes[index];
        index += 1;
        if marker == 0xD9 || marker == 0xDA { break; }
        if index + 1 >= bytes.len() { break; }
        let length = u16::from_be_bytes([bytes[index], bytes[index + 1]]) as usize;
        if length < 2 || index + length > bytes.len() { break; }
        if (0xC0..=0xC3).contains(&marker) || (0xC5..=0xC7).contains(&marker) || (0xC9..=0xCB).contains(&marker) || (0xCD..=0xCF).contains(&marker) {
            if length >= 7 {
                let height = u16::from_be_bytes([bytes[index + 3], bytes[index + 4]]);
                let width = u16::from_be_bytes([bytes[index + 5], bytes[index + 6]]);
                return Some((width, height));
            }
        }
        index += length;
    }
    None
}

fn pdf_hex_bytes(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{:02X}", byte)).collect()
}

fn pdf_bytes_legacy(text: &str, cover: Option<&ExportCover>) -> Vec<u8> {
    let jpeg = cover.and_then(|asset| pdf_jpeg_dimensions(&asset.bytes).map(|dimensions| (dimensions, asset)));
    let mut lines = Vec::new();
    for source in text.lines() {
        let mut current = String::new();
        for character in source.chars() {
            current.push(character);
            if current.chars().count() >= 92 { lines.push(std::mem::take(&mut current)); }
        }
        lines.push(current);
    }
    let mut page_lines = Vec::new();
    for chunk in lines.chunks(48) { page_lines.push(chunk.to_vec()); }
    if page_lines.is_empty() { page_lines.push(Vec::new()); }
    let mut objects = vec![String::new(), String::new()];
    let mut page_refs = Vec::new();
    for (page_index, chunk) in page_lines.into_iter().enumerate() {
        let page_number = objects.len() + 1;
        let content_number = page_number + 1;
        let mut stream = if page_index == 0 && jpeg.is_some() {
            String::from("q\n400 0 0 500 100 220 cm\n/Im1 Do\nQ\nBT\n/F1 11 Tf\n50 790 Td\n")
        } else {
            String::from("BT\n/F1 11 Tf\n50 790 Td\n")
        };
        for (index, line) in chunk.iter().enumerate() {
            if index > 0 { stream.push_str("0 -15 Td\n"); }
            stream.push_str(&format!("<{}> Tj\n", pdf_hex_text(line)));
        }
        stream.push_str("ET\n");
        let image_resources = if jpeg.is_some() { " /XObject << /Im1 IMGREF >>" } else { "" };
        objects.push(format!("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 FONTREF >>{} >> /Contents {} 0 R >>", image_resources, content_number));
        objects.push(format!("<< /Length {} >>\nstream\n{}endstream", stream.as_bytes().len(), stream));
        page_refs.push(format!("{} 0 R", page_number));
    }
    let font_number = objects.len() + 1;
    let descendant_number = font_number + 1;
    let image_number = jpeg.as_ref().map(|_| descendant_number + 1);
    objects.push("<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [DESCREF] >>".to_string());
    objects.push("<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 4 >> /DW 1000 >>".to_string());
    if let Some((dimensions, asset)) = jpeg {
        let encoded = pdf_hex_bytes(&asset.bytes);
        objects.push(format!("<< /Type /XObject /Subtype /Image /Width {} /Height {} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter [/ASCIIHexDecode /DCTDecode] /Length {} >>\nstream\n{}>\nendstream", dimensions.0, dimensions.1, encoded.len() + 1, encoded));
    }
    objects[0] = "<< /Type /Catalog /Pages 2 0 R >>".to_string();
    objects[1] = format!("<< /Type /Pages /Kids [{}] /Count {} >>", page_refs.join(" "), page_refs.len());
    let mut pdf = b"%PDF-1.4\n%\xE2\xE3\xCF\xD3\n".to_vec();
    let mut offsets = Vec::new();
    for (index, object) in objects.iter().enumerate() {
        offsets.push(pdf.len());
        let number = index + 1;
        let image_reference = image_number.map(|number| format!("{} 0 R", number)).unwrap_or_default();
        pdf.extend_from_slice(format!("{} 0 obj\n{}\nendobj\n", number, object.replace("FONTREF", &format!("{} 0 R", font_number)).replace("DESCREF", &format!("{} 0 R", descendant_number)).replace("IMGREF", &image_reference)).as_bytes());
    }
    let xref = pdf.len();
    pdf.extend_from_slice(format!("xref\n0 {}\n0000000000 65535 f \n", objects.len() + 1).as_bytes());
    for offset in offsets { pdf.extend_from_slice(format!("{:010} 00000 n \n", offset).as_bytes()); }
    pdf.extend_from_slice(format!("trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{}\n%%EOF\n", objects.len() + 1, xref).as_bytes());
    pdf
}

static PDF_FONT: OnceLock<Option<ParsedFont>> = OnceLock::new();

fn pdf_font_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(path) = std::env::var_os("NOVELFORGE_PDF_FONT") {
        candidates.push(PathBuf::from(path));
    }
    #[cfg(windows)]
    {
        candidates.extend([
            PathBuf::from(r"C:\Windows\Fonts\simhei.ttf"),
            PathBuf::from(r"C:\Windows\Fonts\Deng.ttf"),
            PathBuf::from(r"C:\Windows\Fonts\NotoSansSC-VF.ttf"),
            PathBuf::from(r"C:\Windows\Fonts\NotoSerifSC-VF.ttf"),
            PathBuf::from(r"C:\Windows\Fonts\simsun.ttc"),
        ]);
    }
    #[cfg(not(windows))]
    {
        candidates.extend([
            PathBuf::from("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"),
            PathBuf::from("/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc"),
            PathBuf::from("/usr/share/fonts/opentype/noto/NotoSansSC-Regular.otf"),
        ]);
    }
    candidates
}

fn load_pdf_font() -> Option<ParsedFont> {
    for path in pdf_font_candidates() {
        let Ok(bytes) = fs::read(&path) else { continue };
        let mut warnings = Vec::new();
        let Some(font) = ParsedFont::from_bytes(&bytes, 0, &mut warnings) else { continue };
        let has_cjk = font.lookup_glyph_index('中' as u32).is_some()
            || font.lookup_glyph_index('雾' as u32).is_some()
            || font.lookup_glyph_index('测' as u32).is_some();
        if has_cjk {
            return Some(font);
        }
    }
    None
}

fn shared_pdf_font() -> Option<&'static ParsedFont> {
    PDF_FONT.get_or_init(load_pdf_font).as_ref()
}

fn pdf_text_lines(text: &str) -> Vec<String> {
    let mut lines = Vec::new();
    for source in text.lines() {
        let mut current = String::new();
        for character in source.chars() {
            current.push(character);
            if current.chars().count() >= 92 {
                lines.push(std::mem::take(&mut current));
            }
        }
        lines.push(current);
    }
    if lines.is_empty() {
        lines.push(String::new());
    }
    lines
}

fn pdf_bytes_embedded(text: &str, cover: Option<&ExportCover>, font: &ParsedFont) -> Vec<u8> {
    let mut document = PdfDocument::new("NovelForge");
    let font_id = document.add_font(font);
    let mut image_warnings = Vec::new();
    let cover_image = cover.and_then(|asset| RawImage::decode_from_bytes(&asset.bytes, &mut image_warnings).ok());
    let cover_id = cover_image.as_ref().map(|image| document.add_image(image));
    let lines = pdf_text_lines(text);
    let chunks: Vec<Vec<String>> = lines.chunks(48).map(|chunk| chunk.to_vec()).collect();
    let mut pages = Vec::new();
    for (page_index, chunk) in chunks.iter().enumerate() {
        let mut operations = Vec::new();
        if page_index == 0 {
            if let (Some(image), Some(image_id)) = (cover_image.as_ref(), cover_id.as_ref()) {
                let width_pt = image.width.max(1) as f32 * 72.0 / 96.0;
                let height_pt = image.height.max(1) as f32 * 72.0 / 96.0;
                let scale = (120.0 / width_pt).min(180.0 / height_pt);
                operations.push(Op::UseXobject {
                    id: image_id.clone(),
                    transform: XObjectTransform {
                        translate_x: Some(Pt(400.0)),
                        translate_y: Some(Pt((842.0 - 60.0 - height_pt * scale).max(20.0))),
                        scale_x: Some(scale),
                        scale_y: Some(scale),
                        dpi: Some(96.0),
                        ..Default::default()
                    },
                });
            }
        }
        operations.push(Op::StartTextSection);
        operations.push(Op::SetFont { font: PdfFontHandle::External(font_id.clone()), size: Pt(11.0) });
        operations.push(Op::SetLineHeight { lh: Pt(15.0) });
        operations.push(Op::SetTextCursor { pos: Point::new(Pt(50.0).into(), Pt(790.0).into()) });
        for (line_index, line) in chunk.iter().enumerate() {
            if line_index > 0 {
                operations.push(Op::AddLineBreak);
            }
            operations.push(Op::ShowText { items: vec![TextItem::Text(line.clone())] });
        }
        operations.push(Op::EndTextSection);
        pages.push(PdfPage::new(Mm(210.0), Mm(297.0), operations));
    }
    let mut save_warnings = Vec::new();
    let mut bytes = document.with_pages(pages).save(&PdfSaveOptions::default(), &mut save_warnings);
    if bytes.starts_with(b"%PDF-1.3") {
        bytes[7] = b'4';
    }
    bytes
}

fn pdf_bytes(text: &str, cover: Option<&ExportCover>) -> Vec<u8> {
    shared_pdf_font()
        .map(|font| pdf_bytes_embedded(text, cover, font))
        .unwrap_or_else(|| pdf_bytes_legacy(text, cover))
}

#[tauri::command]
pub fn export_project(input: ExportInput) -> Result<String, String> {
    let (root, connection) = project_connection(&input.project_path)?;
    let format = match input.format.as_str() {
        "markdown" | "txt" | "html" | "docx" | "epub" | "pdf" => input.format.as_str(),
        _ => return Err(format!("不支持的导出格式：{}", input.format)),
    };
    let metadata = storage::read_project_json(&root)?;
    let nodes = storage::all_nodes(&connection, false)?;
    let nodes = export_scope_nodes(&nodes, &input)?;
    let title = input
        .title
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(metadata.title.as_str())
        .to_string();
    let author = input
        .author
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(metadata.author.as_str())
        .to_string();
    let options = ExportRenderOptions {
        include_volume_titles: input.include_volume_titles.unwrap_or(true),
        include_chapter_titles: input.include_chapter_titles.unwrap_or(true),
    };
    let cover = export_cover(&root, input.cover_path.as_deref())?;
    let mut markdown = String::new();
    export_nodes(&root, &nodes, None, 1, "markdown", &mut markdown, &options);
    let toc = if input.include_toc.unwrap_or(true) {
        let entries = nodes
            .iter()
            .filter(|node| node.kind != "section" || options.include_chapter_titles)
            .map(|node| format!("- {}", node.title))
            .collect::<Vec<_>>();
        if entries.is_empty() { String::new() } else { format!("## 目录\n\n{}\n\n", entries.join("\n")) }
    } else {
        String::new()
    };
    let markdown_document = format!("# {}\n\n作者：{}\n\n{}{}", title, author, toc, markdown);
    let txt_document = parse_export_document(&format!("# {}\n\n作者：{}\n\n{}", title, author, markdown));
    let output = if format == "markdown" {
        markdown_document.clone()
    } else if format == "txt" {
        export_plain_text(&txt_document)
    } else {
        String::new()
    };
    let (extension, bytes) = match format {
        "markdown" | "txt" => (format.to_string(), output.into_bytes()),
        "html" => ("html".to_string(), html_bytes(&markdown, &title, &author, input.include_toc.unwrap_or(true), cover.as_ref())),
        "docx" => ("docx".to_string(), docx_bytes(&markdown_document, cover.as_ref())?),
        "epub" => ("epub".to_string(), epub_bytes(&markdown_document, &title, &author, cover.as_ref())?),
        "pdf" => ("pdf".to_string(), pdf_bytes(&pdf_plain_text(&format!("{}\n作者：{}\n\n{}", title, author, markdown)), cover.as_ref())),
        _ => unreachable!(),
    };
    let filename = format!(
        "{}-{}.{}",
        safe_filename(&metadata.title),
        Utc::now().format("%Y%m%d%H%M%S%3f"),
        extension
    );
    let relative = format!(".novelforge/exports/{}", filename);
    let target = storage::safe_relative(&root, &relative)?;
    storage::atomic_write(&target, &bytes)?;
    let _ = storage::append_log(&root, "INFO", "export_created");
    Ok(target.to_string_lossy().to_string())
}

#[tauri::command]
pub fn read_logs(path: String) -> Result<String, String> {
    let (root, _connection) = project_connection(&path)?;
    storage::read_logs(&root)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSettingsInput {
    pub project_path: String,
    pub title: String,
    pub author: String,
    pub description: String,
    pub genre: String,
    pub target_words: u64,
}

#[tauri::command]
pub fn update_project(input: ProjectSettingsInput) -> Result<ProjectData, String> {
    if input.title.trim().is_empty() {
        return Err("作品名不能为空".to_string());
    }
    let (root, connection) = project_connection(&input.project_path)?;
    let mut metadata = storage::read_project_json(&root)?;
    metadata.title = input.title.trim().to_string();
    metadata.author = input.author.trim().to_string();
    metadata.description = input.description.trim().to_string();
    metadata.genre = input.genre.trim().to_string();
    metadata.target_words = input.target_words;
    metadata.updated_at = storage::now();
    storage::write_project_json(&root, &metadata)?;
    let _ = storage::append_log(&root, "INFO", "project_settings_updated");
    project_data(&root, &connection)
}
