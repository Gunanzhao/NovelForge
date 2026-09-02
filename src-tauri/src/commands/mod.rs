#![allow(unused_imports)]

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
pub(crate) use project::{create_project, list_documents, open_project, read_logs, update_project};
pub(crate) use manuscript::{copy_node, create_node, delete_node, get_document, move_node, rename_node, reorder_node, save_document, set_node_status, NodeStatusInput};
pub(crate) use manuscript::{preserve_current_revision, restore_document_after_save_failure, save_document_internal};
pub(crate) use recovery::{discard_recovery, list_history, list_recovery, read_history, read_recovery, restore_history, restore_recovery, RecoveryActionInput, RevisionActionInput};
pub(crate) use entities::{delete_entity, import_attachment, list_entities, open_attachment, upsert_entity};
pub(crate) use entities::safe_filename;
pub(crate) use trash::{empty_trash, list_trash, permanent_delete, restore_trash};
pub(crate) use consistency::{check_consistency, ExportRenderOptions};
pub(crate) use export::export_project;

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
