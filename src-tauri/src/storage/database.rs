use super::errors::StorageError;
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
CREATE TABLE IF NOT EXISTS entity_revisions (
  id TEXT PRIMARY KEY NOT NULL,
  entity_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  label TEXT NOT NULL,
  created_at TEXT NOT NULL,
  state_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_entity_revisions ON entity_revisions(entity_id, created_at DESC, id DESC);
CREATE TABLE IF NOT EXISTS batch_operations (
  id TEXT PRIMARY KEY NOT NULL,
  target_id TEXT NOT NULL,
  label TEXT NOT NULL,
  created_at TEXT NOT NULL,
  changes_json TEXT NOT NULL,
  undone_by TEXT
);
CREATE TABLE IF NOT EXISTS annotation_tracking (
 node_id TEXT PRIMARY KEY NOT NULL, content TEXT NOT NULL, anchors_json TEXT NOT NULL
);
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
    open_db_typed(root).map_err(|e| e.to_string())
}
pub fn open_db_typed(root: &Path) -> Result<Connection, StorageError> {
    errors::check_compatibility(root)?;
    let pending = safe_relative(root, ".novelforge/recovery-state.json")?;
    if pending.exists() {
        return Err(StorageError::Journal(
            "存在未解决的批量日志，项目保持只读救援状态".into(),
        ));
    }
    let database_path = safe_relative(root, ".novelforge/database.sqlite")?;
    fs::create_dir_all(
        database_path
            .parent()
            .ok_or_else(|| "STORAGE_IO:数据库目录无效".to_string())?,
    )?;
    let mut connection = Connection::open(database_path)?;
    // Explicit policy, same as rusqlite 0.32.1's existing default; not a 0ms fix.
    connection.busy_timeout(std::time::Duration::from_millis(5000))?;
    connection.execute_batch(SCHEMA)?;
    let schema: i64 = connection.pragma_query_value(None, "user_version", |row| row.get(0))?;
    if schema != errors::SCHEMA_VERSION {
        connection.pragma_update(None, "user_version", errors::SCHEMA_VERSION)?;
    }
    history_cleanup::recover(root, &mut connection).map_err(StorageError::Journal)?;
    batch::recover(root, &mut connection)?;
    Ok(connection)
}
pub fn node_from_id(connection: &Connection, node_id: &str) -> Result<Option<NodeRecord>, String> {
    let mut statement = connection.prepare(
        "SELECT id, kind, parent_id, title, order_index, status, file_path, created_at, updated_at, deleted_at, deleted_path FROM nodes WHERE id = ?1",
    ).map_err(|error| format!("读取节点失败：{}", error))?;
    statement
        .query_row(params![node_id], |row| {
            Ok(NodeRecord {
                id: row.get(0)?,
                kind: row.get(1)?,
                parent_id: row.get(2)?,
                title: row.get(3)?,
                order_index: row.get(4)?,
                status: row.get(5)?,
                file_path: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
                deleted_at: row.get(9)?,
                deleted_path: row.get(10)?,
            })
        })
        .optional()
        .map_err(|error| format!("读取节点失败：{}", error))
}

pub fn all_nodes(
    connection: &Connection,
    include_deleted: bool,
) -> Result<Vec<NodeRecord>, String> {
    all_nodes_typed(connection, include_deleted).map_err(|e| e.to_string())
}

pub fn all_nodes_typed(
    connection: &Connection,
    include_deleted: bool,
) -> Result<Vec<NodeRecord>, StorageError> {
    let query = if include_deleted {
        "SELECT id, kind, parent_id, title, order_index, status, file_path, created_at, updated_at, deleted_at, deleted_path FROM nodes ORDER BY parent_id, order_index"
    } else {
        "SELECT id, kind, parent_id, title, order_index, status, file_path, created_at, updated_at, deleted_at, deleted_path FROM nodes WHERE deleted_at IS NULL ORDER BY parent_id, order_index"
    };
    let mut statement = connection.prepare(query).map_err(StorageError::from)?;
    let rows = statement
        .query_map([], |row| {
            Ok(NodeRecord {
                id: row.get(0)?,
                kind: row.get(1)?,
                parent_id: row.get(2)?,
                title: row.get(3)?,
                order_index: row.get(4)?,
                status: row.get(5)?,
                file_path: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
                deleted_at: row.get(9)?,
                deleted_path: row.get(10)?,
            })
        })
        .map_err(StorageError::from)?;
    let mut nodes = Vec::new();
    for row in rows {
        nodes.push(row.map_err(StorageError::from)?);
    }
    Ok(nodes)
}

fn entity_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<EntityRecord> {
    let content_json: String = row.get(3)?;
    let tags_json: String = row.get(4)?;
    Ok(EntityRecord {
        id: row.get(0)?,
        kind: row.get(1)?,
        title: row.get(2)?,
        content: serde_json::from_str(&content_json).unwrap_or(Value::Null),
        tags: serde_json::from_str(&tags_json).unwrap_or_default(),
        file_path: row.get(5)?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
        deleted_at: row.get(8)?,
        deleted_path: row.get(9)?,
    })
}

pub fn entity_from_id(
    connection: &Connection,
    entity_id: &str,
) -> Result<Option<EntityRecord>, String> {
    let mut statement = connection.prepare(
        "SELECT id, kind, title, content_json, tags_json, file_path, created_at, updated_at, deleted_at, deleted_path FROM entities WHERE id = ?1",
    ).map_err(|error| format!("读取资料条目失败：{}", error))?;
    statement
        .query_row(params![entity_id], entity_from_row)
        .optional()
        .map_err(|error| format!("读取资料条目失败：{}", error))
}

pub fn all_entities(
    connection: &Connection,
    include_deleted: bool,
) -> Result<Vec<EntityRecord>, String> {
    all_entities_typed(connection, include_deleted).map_err(|e| e.to_string())
}

pub fn all_entities_typed(
    connection: &Connection,
    include_deleted: bool,
) -> Result<Vec<EntityRecord>, StorageError> {
    let query = if include_deleted {
        "SELECT id, kind, title, content_json, tags_json, file_path, created_at, updated_at, deleted_at, deleted_path FROM entities ORDER BY kind, title COLLATE NOCASE"
    } else {
        "SELECT id, kind, title, content_json, tags_json, file_path, created_at, updated_at, deleted_at, deleted_path FROM entities WHERE deleted_at IS NULL ORDER BY kind, title COLLATE NOCASE"
    };
    let mut statement = connection.prepare(query).map_err(StorageError::from)?;
    let rows = statement
        .query_map([], entity_from_row)
        .map_err(StorageError::from)?;
    let mut entities = Vec::new();
    for row in rows {
        entities.push(row.map_err(StorageError::from)?);
    }
    Ok(entities)
}

pub fn trash_items(connection: &Connection) -> Result<Vec<TrashItem>, String> {
    let mut statement = connection.prepare(
        "SELECT id, ref_id, ref_kind, title, original_path, trash_path, deleted_at FROM trash_items ORDER BY deleted_at DESC",
    ).map_err(|error| format!("读取回收站失败：{}", error))?;
    let rows = statement
        .query_map([], |row| {
            Ok(TrashItem {
                id: row.get(0)?,
                ref_id: row.get(1)?,
                ref_kind: row.get(2)?,
                title: row.get(3)?,
                original_path: row.get(4)?,
                trash_path: row.get(5)?,
                deleted_at: row.get(6)?,
            })
        })
        .map_err(|error| format!("读取回收站失败：{}", error))?;
    let mut items = Vec::new();
    for row in rows {
        items.push(row.map_err(|error| format!("读取回收站失败：{}", error))?);
    }
    Ok(items)
}

pub fn read_annotation_tracking(
    db: &Connection,
    node_id: &str,
) -> Result<Option<crate::models::AnnotationTracking>, String> {
    let row: Option<(String, String)> = db
        .query_row(
            "SELECT content,anchors_json FROM annotation_tracking WHERE node_id=?1",
            [node_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    row.map(|(content, json)| {
        Ok(crate::models::AnnotationTracking {
            content,
            anchors: serde_json::from_str(&json).map_err(|e| format!("批注定位记录损坏：{e}"))?,
        })
    })
    .transpose()
}
pub fn write_annotation_tracking(
    db: &Connection,
    node_id: &str,
    content: &str,
    anchors: &[crate::models::AnnotationAnchor],
) -> Result<(), String> {
    let length = content.encode_utf16().count();
    let mut ids = std::collections::HashSet::new();
    for anchor in anchors {
        if !ids.insert(&anchor.id)
            || anchor.from > anchor.to
            || anchor.to > length
            || (!anchor.orphaned && anchor.from == anchor.to)
        {
            return Err("批注定位范围无效".into());
        }
        let entity = entity_from_id(db, &anchor.id)?.ok_or("批注已删除，请刷新后保存")?;
        if entity.deleted_at.is_some()
            || entity.kind != "annotation"
            || entity.content["chapterId"].as_str() != Some(node_id)
            || entity.content["anchorRevision"].as_str() != Some(&anchor.revision)
        {
            return Err("批注锚点已变化，请刷新后保存正文".into());
        }
    }
    db.execute("INSERT INTO annotation_tracking(node_id,content,anchors_json) VALUES(?1,?2,?3) ON CONFLICT(node_id) DO UPDATE SET content=excluded.content,anchors_json=excluded.anchors_json",params![node_id,content,serde_json::to_string(anchors).map_err(|e|e.to_string())?]).map_err(|e|e.to_string())?;
    Ok(())
}
