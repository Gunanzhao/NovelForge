use crate::models::{EntityRecord, HistoryItem, NodeRecord, ProjectMetadata, RecoveryItem, TrashItem};
use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use uuid::Uuid;

pub const PROJECT_FILE: &str = "project.json";

const DIRECTORIES: &[&str] = &[
    "manuscript", "characters", "locations", "world", "timeline", "outlines",
    "scenes", "foreshadowing", "relationships", "notes", "research", "attachments", "trash",
    ".novelforge/history", ".novelforge/recovery", ".novelforge/cache",
    ".novelforge/index", ".novelforge/exports", ".novelforge/logs",
];

const SCHEMA: &str = r#"
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL,
  parent_id TEXT,
  title TEXT NOT NULL,
  order_index INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'not-started',
  file_path TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  deleted_path TEXT
);
CREATE INDEX IF NOT EXISTS idx_nodes_parent_order ON nodes(parent_id, order_index);
CREATE INDEX IF NOT EXISTS idx_nodes_kind ON nodes(kind);
CREATE TABLE IF NOT EXISTS entities (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  content_json TEXT NOT NULL,
  tags_json TEXT NOT NULL DEFAULT '[]',
  file_path TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  deleted_path TEXT
);
CREATE INDEX IF NOT EXISTS idx_entities_kind_title ON entities(kind, title);
CREATE TABLE IF NOT EXISTS revisions (
  id TEXT PRIMARY KEY NOT NULL,
  node_id TEXT NOT NULL,
  node_title TEXT NOT NULL,
  reason TEXT NOT NULL,
  word_count INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  file_path TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_revisions_node_time ON revisions(node_id, created_at DESC);
CREATE TABLE IF NOT EXISTS activity (
  id TEXT PRIMARY KEY NOT NULL,
  node_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  delta_words INTEGER NOT NULL DEFAULT 0,
  word_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_activity_time ON activity(created_at);
CREATE TABLE IF NOT EXISTS trash_items (
  id TEXT PRIMARY KEY NOT NULL,
  ref_id TEXT NOT NULL,
  ref_kind TEXT NOT NULL,
  title TEXT NOT NULL,
  original_path TEXT NOT NULL,
  trash_path TEXT NOT NULL,
  deleted_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trash_deleted ON trash_items(deleted_at DESC);
CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
  ref_id UNINDEXED, kind UNINDEXED, title, content, path UNINDEXED,
  tokenize = 'unicode61 remove_diacritics 0'
);
"#;

pub fn now() -> String {
    Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

pub fn new_id() -> String {
    Uuid::new_v4().to_string()
}

pub fn word_count(content: &str) -> u64 {
    content.chars().filter(|character| !character.is_whitespace()).count() as u64
}

#[derive(Debug, Clone, Default)]
pub struct MirrorMetadata {
    pub id: Option<String>,
    pub kind: Option<String>,
    pub parent_id: Option<String>,
    pub title: Option<String>,
    pub status: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

fn clean_metadata_value(value: &str) -> String {
    value
        .replace('\r', " ")
        .replace('\n', " ")
        .trim()
        .to_string()
}

fn parse_metadata_line(line: &str, metadata: &mut MirrorMetadata) -> bool {
    let Some((key, value)) = line.split_once(':') else {
        return false;
    };
    let key = key.trim();
    let value = value.trim().trim_matches('"').trim_matches('\'');
    let value = (!value.is_empty() && value != "null").then(|| value.to_string());
    match key {
        "novelforgeId" => metadata.id = value,
        "novelforgeKind" => metadata.kind = value,
        "novelforgeParentId" | "parentId" => metadata.parent_id = value,
        "novelforgeTitle" | "title" => metadata.title = value,
        "novelforgeStatus" | "status" => metadata.status = value,
        "novelforgeCreatedAt" | "createdAt" => metadata.created_at = value,
        "novelforgeUpdatedAt" | "updatedAt" => metadata.updated_at = value,
        _ => return false,
    }
    true
}

/// Parse NovelForge metadata while leaving ordinary user-authored
/// frontmatter untouched when no NovelForge key is present.
pub fn parse_markdown_mirror(raw: &str) -> (Option<MirrorMetadata>, String) {
    let mut lines = raw.split_inclusive('\n');
    let Some(first) = lines.next() else {
        return (None, raw.to_string());
    };
    let first_line = first
        .trim_end_matches(|character| character == '\r' || character == '\n')
        .trim_start_matches('\u{feff}')
        .trim();
    if first_line != "---" {
        return (None, raw.to_string());
    }
    let mut metadata = MirrorMetadata::default();
    let mut recognized = false;
    let mut body_start = first.len();
    let mut closed = false;
    for line in lines {
        body_start += line.len();
        let trimmed = line
            .trim_end_matches(|character| character == '\r' || character == '\n')
            .trim();
        if trimmed == "---" {
            closed = true;
            break;
        }
        recognized |= parse_metadata_line(trimmed, &mut metadata);
    }
    if !closed || !recognized {
        return (None, raw.to_string());
    }
    (Some(metadata), raw[body_start..].to_string())
}

pub fn strip_markdown_frontmatter(raw: &str) -> String {
    parse_markdown_mirror(raw).1
}

fn metadata_block(fields: &[(&str, Option<&str>)]) -> String {
    let mut output = String::from("---\n");
    for (key, value) in fields {
        if let Some(value) = value.filter(|value| !value.trim().is_empty()) {
            output.push_str(key);
            output.push_str(": ");
            output.push_str(&clean_metadata_value(value));
            output.push('\n');
        }
    }
    output.push_str("---\n");
    output
}

pub fn markdown_node(
    id: &str,
    kind: &str,
    parent_id: Option<&str>,
    status: &str,
    created_at: &str,
    updated_at: &str,
    content: &str,
) -> String {
    let mut output = metadata_block(&[
        ("novelforgeId", Some(id)),
        ("novelforgeKind", Some(kind)),
        ("novelforgeParentId", parent_id),
        ("novelforgeStatus", Some(status)),
        ("novelforgeCreatedAt", Some(created_at)),
        ("novelforgeUpdatedAt", Some(updated_at)),
    ]);
    output.push_str(&strip_markdown_frontmatter(content));
    output
}

pub fn markdown_volume(id: &str, title: &str, status: &str, created_at: &str, updated_at: &str) -> String {
    let mut output = metadata_block(&[
        ("novelforgeId", Some(id)),
        ("novelforgeKind", Some("volume")),
        ("novelforgeTitle", Some(title)),
        ("novelforgeStatus", Some(status)),
        ("novelforgeCreatedAt", Some(created_at)),
        ("novelforgeUpdatedAt", Some(updated_at)),
    ]);
    output.push_str("# ");
    output.push_str(&clean_metadata_value(title));
    output.push('\n');
    output
}

pub fn markdown_entity_with_metadata(
    id: &str,
    kind: &str,
    created_at: &str,
    updated_at: &str,
    title: &str,
    content: &Value,
    tags: &[String],
) -> String {
    let mut output = metadata_block(&[
        ("novelforgeId", Some(id)),
        ("novelforgeKind", Some(kind)),
        ("novelforgeCreatedAt", Some(created_at)),
        ("novelforgeUpdatedAt", Some(updated_at)),
    ]);
    output.push_str(&markdown_entity(title, content, tags));
    output
}

fn canonical_root(root: &Path) -> Result<PathBuf, String> {
    fs::canonicalize(root).map_err(|error| format!("无法规范化项目根目录：{}", error))
}

fn canonical_existing_ancestor(path: &Path) -> Result<PathBuf, String> {
    let mut current = Some(path);
    while let Some(candidate) = current {
        if candidate.exists() {
            return fs::canonicalize(candidate)
                .map_err(|error| format!("无法规范化项目路径 {}：{}", candidate.display(), error));
        }
        current = candidate.parent();
    }
    Err("无法找到项目路径的现有父目录".to_string())
}

fn ensure_within_root(root: &Path, candidate: &Path) -> Result<(), String> {
    let canonical_root = canonical_root(root)?;
    let boundary = if candidate.exists() {
        let canonical_candidate = fs::canonicalize(candidate)
            .map_err(|error| format!("无法规范化项目路径 {}：{}", candidate.display(), error))?;
        if canonical_candidate == canonical_root {
            return Err("项目路径不能指向项目根目录本身".to_string());
        }
        canonical_candidate
    } else {
        canonical_existing_ancestor(candidate)?
    };
    if !boundary.starts_with(&canonical_root) {
        return Err(format!("项目路径越界：{}", candidate.display()));
    }
    Ok(())
}

pub fn create_project_directories(root: &Path) -> Result<(), String> {
    for directory in DIRECTORIES {
        let path = safe_relative(root, directory)?;
        fs::create_dir_all(&path).map_err(|error| {
            format!("无法创建项目目录 {}：{}", path.display(), error)
        })?;
    }
    Ok(())
}

pub fn new_project_root(input: &str) -> Result<PathBuf, String> {
    if input.trim().is_empty() {
        return Err("项目路径不能为空".to_string());
    }
    let root = PathBuf::from(input);
    if root.exists() && !root.is_dir() {
        return Err("项目路径不是文件夹".to_string());
    }
    fs::create_dir_all(&root).map_err(|error| format!("无法创建项目文件夹：{}", error))?;
    let canonical = fs::canonicalize(&root).map_err(|error| format!("无法访问项目文件夹：{}", error))?;
    if canonical.join(PROJECT_FILE).exists() {
        return Err("该文件夹已经是 NovelForge 项目".to_string());
    }
    Ok(canonical)
}

pub fn existing_project_root(input: &str) -> Result<PathBuf, String> {
    if input.trim().is_empty() {
        return Err("项目路径不能为空".to_string());
    }
    let root = fs::canonicalize(PathBuf::from(input))
        .map_err(|error| format!("无法访问项目文件夹：{}", error))?;
    if !root.is_dir() {
        return Err("项目路径不是文件夹".to_string());
    }
    let project_file = safe_relative(&root, PROJECT_FILE)?;
    if !project_file.is_file() {
        return Err("这里没有找到 project.json，不是有效的 NovelForge 项目".to_string());
    }
    Ok(root)
}

pub fn open_db(root: &Path) -> Result<Connection, String> {
    let database_path = safe_relative(root, ".novelforge/database.sqlite")?;
    fs::create_dir_all(database_path.parent().ok_or_else(|| "无法确定数据库目录".to_string())?)
        .map_err(|error| format!("无法创建数据库目录：{}", error))?;
    let connection = Connection::open(&database_path)
        .map_err(|error| format!("无法打开项目数据库 {}：{}", database_path.display(), error))?;
    connection.execute_batch(SCHEMA).map_err(|error| format!("无法初始化项目数据库：{}", error))?;
    Ok(connection)
}

pub fn quarantine_database(root: &Path) -> Result<Option<String>, String> {
    let database = safe_relative(root, ".novelforge/database.sqlite")?;
    if !database.exists() {
        return Ok(None);
    }
    let stamp = Utc::now().format("%Y%m%dT%H%M%S%.3fZ");
    let backup_relative = format!(".novelforge/database.sqlite.corrupt-{}.bak", stamp);
    let backup = safe_relative(root, &backup_relative)?;
    fs::rename(&database, &backup).map_err(|error| format!("隔离损坏数据库失败：{}", error))?;
    for suffix in ["-wal", "-shm"] {
        let sidecar = PathBuf::from(format!("{}{}", database.to_string_lossy(), suffix));
        if sidecar.exists() {
            let sidecar_backup = PathBuf::from(format!("{}{}", backup.to_string_lossy(), suffix));
            let _ = fs::rename(sidecar, sidecar_backup);
        }
    }
    Ok(Some(backup_relative))
}

pub fn write_project_json(root: &Path, metadata: &ProjectMetadata) -> Result<(), String> {
    let data = serde_json::to_vec_pretty(metadata)
        .map_err(|error| format!("项目元数据序列化失败：{}", error))?;
    atomic_write(&safe_relative(root, PROJECT_FILE)?, &data)
}

pub fn read_project_json(root: &Path) -> Result<ProjectMetadata, String> {
    let data = fs::read(safe_relative(root, PROJECT_FILE)?)
        .map_err(|error| format!("无法读取 project.json：{}", error))?;
    serde_json::from_slice(&data).map_err(|error| format!("project.json 格式无效：{}", error))
}

pub fn touch_project(root: &Path) -> Result<(), String> {
    let mut metadata = read_project_json(root)?;
    metadata.updated_at = now();
    write_project_json(root, &metadata)
}

pub fn safe_relative(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let candidate = Path::new(relative);
    if candidate.is_absolute() || relative.trim().is_empty() {
        return Err("项目相对路径无效".to_string());
    }
    if candidate.components().any(|component| !matches!(component, Component::Normal(_))) {
        return Err("项目路径只能包含普通相对路径段".to_string());
    }
    let joined = root.join(candidate);
    ensure_within_root(root, &joined)?;
    Ok(joined)
}

pub fn safe_trash_path(root: &Path, stored_path: &str) -> Result<PathBuf, String> {
    let candidate = PathBuf::from(stored_path);
    if !candidate.is_absolute() {
        return Err("回收站路径必须是绝对路径".to_string());
    }
    let trash_root = safe_relative(root, "trash/items")?;
    if !trash_root.is_dir() {
        return Err("项目回收站目录不存在".to_string());
    }
    let canonical_trash_root = fs::canonicalize(&trash_root)
        .map_err(|error| format!("无法规范化回收站目录：{}", error))?;
    let canonical_candidate = fs::canonicalize(&candidate)
        .map_err(|error| format!("无法访问回收站内容 {}：{}", candidate.display(), error))?;
    if canonical_candidate == canonical_trash_root || !canonical_candidate.starts_with(&canonical_trash_root) {
        return Err(format!("拒绝访问项目回收站外的路径：{}", candidate.display()));
    }
    Ok(canonical_candidate)
}

pub fn atomic_write(target: &Path, content: &[u8]) -> Result<(), String> {
    let parent = target.parent().ok_or_else(|| "无法确定文件目录".to_string())?;
    fs::create_dir_all(parent).map_err(|error| format!("无法创建文件目录：{}", error))?;
    let filename = target.file_name().and_then(|name| name.to_str())
        .ok_or_else(|| "文件名无效".to_string())?;
    let temp = parent.join(format!(".{}.tmp-{}", filename, new_id()));
    let result = (|| -> Result<(), String> {
        let mut file = OpenOptions::new().write(true).create_new(true).open(&temp)
            .map_err(|error| format!("无法创建临时文件：{}", error))?;
        file.write_all(content).map_err(|error| format!("写入临时文件失败：{}", error))?;
        file.sync_all().map_err(|error| format!("刷新临时文件失败：{}", error))?;
        drop(file);
        replace_file(&temp, target)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}

fn replace_file(source: &Path, target: &Path) -> Result<(), String> {
    // Windows std::fs::rename 不覆盖现有文件；失败时会恢复旧文件。
    if target.exists() {
        let backup = target.with_file_name(format!(
            ".{}.backup-{}",
            target.file_name().and_then(|name| name.to_str()).unwrap_or("file"),
            new_id()
        ));
        fs::rename(target, &backup).map_err(|error| format!("准备替换文件失败：{}", error))?;
        match fs::rename(source, target) {
            Ok(()) => {
                let _ = fs::remove_file(backup);
                Ok(())
            }
            Err(error) => {
                let _ = fs::rename(&backup, target);
                Err(format!("原子替换文件失败：{}", error))
            }
        }
    } else {
        fs::rename(source, target).map_err(|error| format!("原子替换文件失败：{}", error))
    }
}

pub fn node_from_id(connection: &Connection, node_id: &str) -> Result<Option<NodeRecord>, String> {
    let mut statement = connection.prepare(
        "SELECT id, kind, parent_id, title, order_index, status, file_path, created_at, updated_at, deleted_at, deleted_path FROM nodes WHERE id = ?1",
    ).map_err(|error| format!("读取节点失败：{}", error))?;
    statement.query_row(params![node_id], |row| {
        Ok(NodeRecord {
            id: row.get(0)?, kind: row.get(1)?, parent_id: row.get(2)?, title: row.get(3)?,
            order_index: row.get(4)?, status: row.get(5)?, file_path: row.get(6)?,
            created_at: row.get(7)?, updated_at: row.get(8)?, deleted_at: row.get(9)?,
            deleted_path: row.get(10)?,
        })
    }).optional().map_err(|error| format!("读取节点失败：{}", error))
}

pub fn all_nodes(connection: &Connection, include_deleted: bool) -> Result<Vec<NodeRecord>, String> {
    let query = if include_deleted {
        "SELECT id, kind, parent_id, title, order_index, status, file_path, created_at, updated_at, deleted_at, deleted_path FROM nodes ORDER BY parent_id, order_index"
    } else {
        "SELECT id, kind, parent_id, title, order_index, status, file_path, created_at, updated_at, deleted_at, deleted_path FROM nodes WHERE deleted_at IS NULL ORDER BY parent_id, order_index"
    };
    let mut statement = connection.prepare(query).map_err(|error| format!("读取节点失败：{}", error))?;
    let rows = statement.query_map([], |row| {
        Ok(NodeRecord {
            id: row.get(0)?, kind: row.get(1)?, parent_id: row.get(2)?, title: row.get(3)?,
            order_index: row.get(4)?, status: row.get(5)?, file_path: row.get(6)?,
            created_at: row.get(7)?, updated_at: row.get(8)?, deleted_at: row.get(9)?,
            deleted_path: row.get(10)?,
        })
    }).map_err(|error| format!("读取节点失败：{}", error))?;
    let mut nodes = Vec::new();
    for row in rows {
        nodes.push(row.map_err(|error| format!("读取节点失败：{}", error))?);
    }
    Ok(nodes)
}

fn entity_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<EntityRecord> {
    let content_json: String = row.get(3)?;
    let tags_json: String = row.get(4)?;
    Ok(EntityRecord {
        id: row.get(0)?, kind: row.get(1)?, title: row.get(2)?,
        content: serde_json::from_str(&content_json).unwrap_or(Value::Null),
        tags: serde_json::from_str(&tags_json).unwrap_or_default(),
        file_path: row.get(5)?, created_at: row.get(6)?, updated_at: row.get(7)?,
        deleted_at: row.get(8)?, deleted_path: row.get(9)?,
    })
}

pub fn entity_from_id(connection: &Connection, entity_id: &str) -> Result<Option<EntityRecord>, String> {
    let mut statement = connection.prepare(
        "SELECT id, kind, title, content_json, tags_json, file_path, created_at, updated_at, deleted_at, deleted_path FROM entities WHERE id = ?1",
    ).map_err(|error| format!("读取资料条目失败：{}", error))?;
    statement.query_row(params![entity_id], entity_from_row).optional()
        .map_err(|error| format!("读取资料条目失败：{}", error))
}

pub fn all_entities(connection: &Connection, include_deleted: bool) -> Result<Vec<EntityRecord>, String> {
    let query = if include_deleted {
        "SELECT id, kind, title, content_json, tags_json, file_path, created_at, updated_at, deleted_at, deleted_path FROM entities ORDER BY kind, title COLLATE NOCASE"
    } else {
        "SELECT id, kind, title, content_json, tags_json, file_path, created_at, updated_at, deleted_at, deleted_path FROM entities WHERE deleted_at IS NULL ORDER BY kind, title COLLATE NOCASE"
    };
    let mut statement = connection.prepare(query).map_err(|error| format!("读取资料条目失败：{}", error))?;
    let rows = statement.query_map([], entity_from_row).map_err(|error| format!("读取资料条目失败：{}", error))?;
    let mut entities = Vec::new();
    for row in rows {
        entities.push(row.map_err(|error| format!("读取资料条目失败：{}", error))?);
    }
    Ok(entities)
}

pub fn index_record(connection: &Connection, ref_id: &str, kind: &str, title: &str, content: &str, path: &str) -> Result<(), String> {
    connection.execute("DELETE FROM search_index WHERE ref_id = ?1", params![ref_id])
        .map_err(|error| format!("更新搜索索引失败：{}", error))?;
    connection.execute(
        "INSERT INTO search_index (ref_id, kind, title, content, path) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![ref_id, kind, title, content, path],
    ).map_err(|error| format!("写入搜索索引失败：{}", error))?;
    Ok(())
}

pub fn refresh_search_index(root: &Path, connection: &Connection) -> Result<(), String> {
    connection.execute("DELETE FROM search_index", [])
        .map_err(|error| format!("清理搜索索引失败：{}", error))?;
    let nodes = all_nodes(connection, false)?;
    for node in nodes.iter().filter(|node| node.kind != "volume") {
        let path = safe_relative(root, &node.file_path)?;
        let content = fs::read_to_string(&path).unwrap_or_default();
        let content = strip_markdown_frontmatter(&content);
        index_record(connection, &node.id, &node.kind, &node.title, &content, &node.file_path)?;
    }
    for entity in all_entities(connection, false)? {
        index_record(connection, &entity.id, &entity.kind, &entity.title, &entity.content.to_string(), &entity.file_path)?;
    }
    Ok(())
}

pub fn recovery_items(root: &Path, connection: &Connection) -> Result<Vec<RecoveryItem>, String> {
    let recovery_dir = safe_relative(root, ".novelforge/recovery")?;
    if !recovery_dir.is_dir() {
        return Ok(Vec::new());
    }
    let nodes = all_nodes(connection, false)?;
    let mut items = Vec::new();
    let entries = fs::read_dir(&recovery_dir).map_err(|error| format!("无法读取恢复目录：{}", error))?;
    for entry in entries {
        let path = entry.map_err(|error| format!("读取恢复文件失败：{}", error))?.path();
        if !path.is_file() {
            continue;
        }
        let filename = match path.file_name().and_then(|name| name.to_str()) {
            Some(value) => value,
            None => continue,
        };
        let node_id = match filename.split("--").next() {
            Some(value) if !value.is_empty() => value,
            _ => continue,
        };
        let node = match nodes.iter().find(|candidate| candidate.id == node_id) {
            Some(value) => value,
            None => continue,
        };
        let created_at = filename.split("--").nth(1).unwrap_or("unknown")
            .trim_end_matches(".md").to_string();
        items.push(RecoveryItem {
            id: filename.to_string(), node_id: node.id.clone(), node_title: node.title.clone(),
            path: path.to_string_lossy().to_string(), created_at,
        });
    }
    items.sort_by(|left, right| right.created_at.cmp(&left.created_at));
    Ok(items)
}

pub fn history_items(connection: &Connection, node_id: &str) -> Result<Vec<HistoryItem>, String> {
    let mut statement = connection.prepare(
        "SELECT id, node_id, node_title, reason, word_count, created_at, file_path FROM revisions WHERE node_id = ?1 ORDER BY created_at DESC LIMIT 100",
    ).map_err(|error| format!("读取版本历史失败：{}", error))?;
    let rows = statement.query_map(params![node_id], |row| Ok(HistoryItem {
        id: row.get(0)?, node_id: row.get(1)?, node_title: row.get(2)?, reason: row.get(3)?,
        word_count: row.get::<_, i64>(4)? as u64, created_at: row.get(5)?, path: row.get(6)?,
    })).map_err(|error| format!("读取版本历史失败：{}", error))?;
    let mut history = Vec::new();
    for row in rows {
        history.push(row.map_err(|error| format!("读取版本历史失败：{}", error))?);
    }
    Ok(history)
}

pub fn trash_items(connection: &Connection) -> Result<Vec<TrashItem>, String> {
    let mut statement = connection.prepare(
        "SELECT id, ref_id, ref_kind, title, original_path, trash_path, deleted_at FROM trash_items ORDER BY deleted_at DESC",
    ).map_err(|error| format!("读取回收站失败：{}", error))?;
    let rows = statement.query_map([], |row| Ok(TrashItem {
        id: row.get(0)?, ref_id: row.get(1)?, ref_kind: row.get(2)?, title: row.get(3)?,
        original_path: row.get(4)?, trash_path: row.get(5)?, deleted_at: row.get(6)?,
    })).map_err(|error| format!("读取回收站失败：{}", error))?;
    let mut items = Vec::new();
    for row in rows {
        items.push(row.map_err(|error| format!("读取回收站失败：{}", error))?);
    }
    Ok(items)
}

pub fn kind_directory(kind: &str) -> Result<&'static str, String> {
    match kind {
        "character" => Ok("characters"), "location" => Ok("locations"), "world" => Ok("world"),
        "timeline" => Ok("timeline"), "foreshadowing" => Ok("foreshadowing"), "relationship" => Ok("relationships"), "attachment" => Ok("attachments"),
        "outline" => Ok("outlines"), "scene" => Ok("scenes"), "note" => Ok("notes"),
        _ => Err(format!("不支持的资料类型：{}", kind)),
    }
}

pub fn markdown_entity(title: &str, content: &Value, tags: &[String]) -> String {
    let mut output = format!("# {}\n\n", title);
    if !tags.is_empty() {
        output.push_str(&format!("标签：{}\n\n", tags.join("、")));
    }
    if let Some(object) = content.as_object() {
        for (key, value) in object {
            if key == "description" || key == "notes" || key == "summary" {
                continue;
            }
            let display = match value { Value::String(text) => text.clone(), _ => value.to_string() };
            if !display.is_empty() {
                output.push_str(&format!("## {}\n\n{}\n\n", key, display));
            }
        }
        for key in ["description", "summary", "notes"] {
            if let Some(Value::String(text)) = object.get(key) {
                if !text.trim().is_empty() {
                    output.push_str(&format!("{}\n\n", text));
                }
            }
        }
    } else if !content.is_null() {
        output.push_str(&format!("{}\n", content));
    }
    output
}

pub fn parse_timestamp(value: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value).ok().map(|date| date.with_timezone(&Utc))
}

pub fn copy_history(root: &Path, node_id: &str, revision_id: &str, content: &str) -> Result<String, String> {
    let relative = format!(".novelforge/history/{}/{}.md", node_id, revision_id);
    let path = safe_relative(root, &relative)?;
    atomic_write(&path, content.as_bytes())?;
    Ok(relative)
}

pub fn write_recovery(root: &Path, node_id: &str, content: &str) -> Result<(String, String), String> {
    let timestamp = Utc::now().format("%Y%m%dT%H%M%S%.3fZ").to_string();
    let filename = format!("{}--{}.md", node_id, timestamp);
    let relative = format!(".novelforge/recovery/{}", filename);
    let path = safe_relative(root, &relative)?;
    atomic_write(&path, content.as_bytes())?;
    Ok((filename, path.to_string_lossy().to_string()))
}

pub fn remove_file_if_exists(path: &Path) -> Result<(), String> {
    if path.exists() {
        fs::remove_file(path).map_err(|error| format!("删除临时文件失败：{}", error))?;
    }
    Ok(())
}

pub fn redact_log_text(value: &str) -> String {
    let mut output = value.replace('\r', " ").replace('\n', " ");
    for marker in ["api_key", "api-key", "authorization", "bearer "] {
        let lower = output.to_ascii_lowercase();
        if let Some(index) = lower.find(marker) {
            output.replace_range(index.., "[REDACTED]");
        }
    }
    output.chars().take(240).collect()
}

pub fn append_log(root: &Path, level: &str, event: &str) -> Result<(), String> {
    if !["DEBUG", "INFO", "WARN", "ERROR"].contains(&level) {
        return Err("日志级别无效".to_string());
    }
    let path = safe_relative(root, ".novelforge/logs/app.log")?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("无法创建日志目录：{}", error))?;
    }
    let line = format!("{} [{}] {}\n", now(), level, redact_log_text(event));
    let mut file = OpenOptions::new().create(true).append(true).open(&path)
        .map_err(|error| format!("无法打开应用日志：{}", error))?;
    file.write_all(line.as_bytes()).map_err(|error| format!("写入应用日志失败：{}", error))?;
    file.sync_data().map_err(|error| format!("刷新应用日志失败：{}", error))?;
    Ok(())
}

pub fn read_logs(root: &Path) -> Result<String, String> {
    let path = safe_relative(root, ".novelforge/logs/app.log")?;
    if !path.is_file() {
        return Ok(String::new());
    }
    let content = fs::read_to_string(&path).map_err(|error| format!("读取应用日志失败：{}", error))?;
    let tail: String = content.chars().rev().take(8000).collect();
    Ok(tail.chars().rev().collect())
}

pub fn move_to_trash(root: &Path, original: &Path, ref_id: &str) -> Result<String, String> {
    ensure_within_root(root, original)?;
    if !original.exists() {
        return Err(format!("待删除内容不存在：{}", original.display()));
    }
    let trash_directory = safe_relative(root, "trash/items")?;
    fs::create_dir_all(&trash_directory).map_err(|error| format!("无法创建回收站目录：{}", error))?;
    let filename = original.file_name().and_then(|name| name.to_str()).unwrap_or("item");
    let trash_path = trash_directory.join(format!("{}_{}_{}", ref_id, Utc::now().timestamp_millis(), filename));
    ensure_within_root(root, &trash_path)?;
    fs::rename(original, &trash_path).map_err(|error| format!("移动到回收站失败：{}", error))?;
    Ok(trash_path.to_string_lossy().to_string())
}
