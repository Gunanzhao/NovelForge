use super::*;

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

pub fn open_db(root: &Path) -> Result<Connection, String> {
    let database_path = safe_relative(root, ".novelforge/database.sqlite")?;
    fs::create_dir_all(database_path.parent().ok_or_else(|| "无法确定数据库目录".to_string())?)
        .map_err(|error| format!("无法创建数据库目录：{}", error))?;
    let connection = Connection::open(&database_path)
        .map_err(|error| format!("无法打开项目数据库 {}：{}", database_path.display(), error))?;
    connection.execute_batch(SCHEMA).map_err(|error| format!("无法初始化项目数据库：{}", error))?;
    Ok(connection)
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
