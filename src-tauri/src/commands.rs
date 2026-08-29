use crate::models::{
    DocumentData, EntityInput, EntityRecord, ExportInput, HistoryItem, NodeInput, NodeRecord,
    ProjectData, ProjectInput, ProjectMetadata, RecoveryItem, SaveDocumentInput, SearchInput,
    SearchResult, Stats, TrashItem,
};
use crate::storage_impl as storage;
use chrono::{Duration, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Deserialize;

use std::fs;
use std::io::{Cursor, Write};
use std::path::{Path, PathBuf};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};

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

fn default_status() -> &'static str {
    "not-started"
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
    fs::create_dir_all(storage::safe_relative(&root, &volume_path)?)
        .map_err(|error| format!("无法创建初始卷：{}", error))?;
    insert_node(
        &connection,
        &NodeRecord {
            id: volume_id.clone(),
            kind: "volume".to_string(),
            parent_id: None,
            title: "第一卷".to_string(),
            order_index: 0,
            status: default_status().to_string(),
            file_path: volume_path,
            created_at: timestamp.clone(),
            updated_at: timestamp.clone(),
            deleted_at: None,
            deleted_path: None,
        },
    )?;

    let chapter_id = storage::new_id();
    let chapter_path = "manuscript/volume_001/chapter_001.md".to_string();
    let starter = "# 第一章\n\n从这里开始你的故事。\n";
    storage::atomic_write(&storage::safe_relative(&root, &chapter_path)?, starter.as_bytes())?;
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
    insert_node(&connection, &chapter)?;
    storage::index_record(&connection, &chapter.id, &chapter.kind, &chapter.title, starter, &chapter.file_path)?;
    project_data(&root, &connection)
}

#[tauri::command]
pub fn open_project(path: String) -> Result<ProjectData, String> {
    let (root, connection) = project_connection(&path)?;
    storage::refresh_search_index(&root, &connection)?;
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
    let (root, connection) = project_connection(&input.project_path)?;
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
    let order_index: i64 = connection
        .query_row(
            "SELECT COALESCE(MAX(order_index), -1) + 1 FROM nodes WHERE parent_id IS ?1 AND deleted_at IS NULL",
            params![input.parent_id],
            |row| row.get(0),
        )
        .map_err(|error| format!("计算节点顺序失败：{}", error))?;
    let node_id = storage::new_id();
    let timestamp = storage::now();
    let file_path = match input.kind.as_str() {
        "volume" => format!("manuscript/volume_{:03}", order_index + 1),
        "chapter" => format!("{}/chapter_{:03}.md", parent.file_path, order_index + 1),
        "section" => {
            let chapter_directory = Path::new(&parent.file_path)
                .with_extension("")
                .to_string_lossy()
                .replace('\\', "/");
            format!("{}/section_{:03}.md", chapter_directory, order_index + 1)
        }
        _ => return Err("节点类型无效".to_string()),
    };
    let absolute_path = storage::safe_relative(&root, &file_path)?;
    if input.kind == "volume" {
        fs::create_dir_all(&absolute_path).map_err(|error| format!("创建卷目录失败：{}", error))?;
    } else {
        let content = format!("# {}\n\n", input.title.trim());
        storage::atomic_write(&absolute_path, content.as_bytes())?;
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
    insert_node(&connection, &node)?;
    if node.kind != "volume" {
        let content = fs::read_to_string(&absolute_path).unwrap_or_default();
        storage::index_record(&connection, &node.id, &node.kind, &node.title, &content, &node.file_path)?;
    }
    storage::touch_project(&root)?;
    project_data(&root, &connection)
}

#[tauri::command]
pub fn rename_node(input: crate::models::RenameNodeInput) -> Result<ProjectData, String> {
    if input.title.trim().is_empty() {
        return Err("名称不能为空".to_string());
    }
    let (root, connection) = project_connection(&input.project_path)?;
    let timestamp = storage::now();
    let changed = connection
        .execute(
            "UPDATE nodes SET title = ?1, updated_at = ?2 WHERE id = ?3 AND deleted_at IS NULL",
            params![input.title.trim(), timestamp, input.node_id],
        )
        .map_err(|error| format!("重命名节点失败：{}", error))?;
    if changed == 0 {
        return Err("节点不存在或已在回收站".to_string());
    }
    if let Some(node) = storage::node_from_id(&connection, &input.node_id)? {
        if node.kind != "volume" {
            let content = fs::read_to_string(storage::safe_relative(&root, &node.file_path)?).unwrap_or_default();
            storage::index_record(&connection, &node.id, &node.kind, &node.title, &content, &node.file_path)?;
        }
    }
    storage::touch_project(&root)?;
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
    let allowed = ["not-started", "draft", "editing", "done", "locked"];
    if !allowed.contains(&input.status.as_str()) {
        return Err("状态无效".to_string());
    }
    let (root, connection) = project_connection(&input.project_path)?;
    connection
        .execute(
            "UPDATE nodes SET status = ?1, updated_at = ?2 WHERE id = ?3 AND deleted_at IS NULL",
            params![input.status, storage::now(), input.node_id],
        )
        .map_err(|error| format!("更新章节状态失败：{}", error))?;
    storage::touch_project(&root)?;
    project_data(&root, &connection)
}

#[tauri::command]
pub fn reorder_node(input: crate::models::ReorderNodeInput) -> Result<ProjectData, String> {
    if input.direction != "up" && input.direction != "down" {
        return Err("排序方向无效".to_string());
    }
    let (root, connection) = project_connection(&input.project_path)?;
    let current = storage::node_from_id(&connection, &input.node_id)?
        .ok_or_else(|| "节点不存在".to_string())?;
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
        connection
            .execute("UPDATE nodes SET order_index = ?1 WHERE id = ?2", params![neighbour_order, current.id])
            .map_err(|error| format!("更新节点顺序失败：{}", error))?;
        connection
            .execute("UPDATE nodes SET order_index = ?1 WHERE id = ?2", params![current.order_index, neighbour_id])
            .map_err(|error| format!("更新节点顺序失败：{}", error))?;
    }
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
    let trash_path = storage::move_to_trash(&root, &original_absolute, &node.id)?;
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
        return match fs::rename(Path::new(&trash_path), &original_absolute) {
            Ok(()) => Err(format!("{}；文件已恢复到原位置", error)),
            Err(rollback_error) => Err(format!("{}；文件回滚失败：{}", error, rollback_error)),
        };
    }
    storage::touch_project(&root)?;
    project_data(&root, &connection)
}

fn save_document_internal(
    root: &Path,
    connection: &Connection,
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
    let old_content = fs::read_to_string(&target).unwrap_or_default();
    let (_recovery_id, recovery_path) = storage::write_recovery(root, node_id, content)?;
    storage::atomic_write(&target, content.as_bytes())?;
    let revision_id = storage::new_id();
    let revision_path = storage::copy_history(root, node_id, &revision_id, content)?;
    let created_at = storage::now();
    connection
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
    connection
        .execute(
            "INSERT INTO activity (id, node_id, created_at, delta_words, word_count) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![storage::new_id(), node.id, storage::now(), delta, storage::word_count(content) as i64],
        )
        .map_err(|error| format!("记录写作统计失败：{}", error))?;
    connection
        .execute(
            "UPDATE nodes SET updated_at = ?1 WHERE id = ?2",
            params![storage::now(), node.id],
        )
        .map_err(|error| format!("更新章节时间失败：{}", error))?;
    storage::index_record(connection, &node.id, &node.kind, &node.title, content, &node.file_path)?;
    storage::touch_project(root)?;
    storage::remove_file_if_exists(Path::new(&recovery_path))?;
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
    let content = fs::read_to_string(storage::safe_relative(&root, &node.file_path)?).unwrap_or_default();
    Ok(DocumentData { node, content })
}

#[tauri::command]
pub fn save_document(input: SaveDocumentInput) -> Result<DocumentData, String> {
    let (root, connection) = project_connection(&input.project_path)?;
    save_document_internal(&root, &connection, &input.node_id, &input.content, &input.reason)
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
    let (root, connection) = project_connection(&input.project_path)?;
    let node_id = input.recovery_id.split("--").next().unwrap_or_default().to_string();
    if node_id.is_empty() {
        return Err("恢复文件关联的章节无效".to_string());
    }
    let recovery_file = recovery_path(&root, &input.recovery_id)?;
    let content = fs::read_to_string(&recovery_file)
        .map_err(|error| format!("无法读取恢复内容：{}", error))?;
    preserve_current_revision(&root, &connection, &node_id, "恢复前自动快照")?;
    save_document_internal(&root, &connection, &node_id, &content, "崩溃恢复")?;
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
    fs::read_to_string(storage::safe_relative(&root, &path)?)
        .map_err(|error| format!("无法读取历史内容：{}", error))
}

#[tauri::command]
pub fn restore_history(input: RevisionActionInput) -> Result<ProjectData, String> {
    let (root, connection) = project_connection(&input.project_path)?;
    let (node_id, path): (String, String) = connection
        .query_row("SELECT node_id, file_path FROM revisions WHERE id = ?1", params![input.revision_id], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(|error| format!("版本不存在：{}", error))?;
    let content = fs::read_to_string(storage::safe_relative(&root, &path)?)
        .map_err(|error| format!("无法读取历史内容：{}", error))?;
    preserve_current_revision(&root, &connection, &node_id, "恢复前自动快照")?;
    save_document_internal(&root, &connection, &node_id, &content, "恢复历史版本")?;
    project_data(&root, &connection)
}

#[tauri::command]
pub fn upsert_entity(input: EntityInput) -> Result<ProjectData, String> {
    if input.title.trim().is_empty() {
        return Err("条目名称不能为空".to_string());
    }
    let (root, connection) = project_connection(&input.project_path)?;
    let timestamp = storage::now();
    let entity_id = input.id.clone().unwrap_or_else(storage::new_id);
    let existing = storage::entity_from_id(&connection, &entity_id)?;
    let file_path = if let Some(entity) = existing.as_ref() {
        entity.file_path.clone()
    } else {
        let directory = storage::kind_directory(&input.kind)?;
        format!("{}/{}-{}.md", directory, safe_filename(&input.title), entity_id)
    };
    let content_json = serde_json::to_string(&input.content).map_err(|error| format!("资料内容序列化失败：{}", error))?;
    let tags_json = serde_json::to_string(&input.tags).map_err(|error| format!("标签序列化失败：{}", error))?;
    if input.kind != "attachment" {
        let markdown = storage::markdown_entity(&input.title, &input.content, &input.tags);
        storage::atomic_write(&storage::safe_relative(&root, &file_path)?, markdown.as_bytes())?;
    }
    connection
        .execute(
            "INSERT INTO entities (id, kind, title, content_json, tags_json, file_path, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8) ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, title = excluded.title, content_json = excluded.content_json, tags_json = excluded.tags_json, file_path = excluded.file_path, updated_at = excluded.updated_at, deleted_at = NULL, deleted_path = NULL",
            params![entity_id, input.kind, input.title.trim(), content_json, tags_json, file_path, existing.as_ref().map(|value| value.created_at.clone()).unwrap_or(timestamp.clone()), timestamp],
        )
        .map_err(|error| format!("保存资料条目失败：{}", error))?;
    let index_content = if input.kind == "attachment" { input.content.to_string() } else { storage::markdown_entity(&input.title, &input.content, &input.tags) };
    storage::index_record(&connection, &entity_id, &input.kind, input.title.trim(), &index_content, &file_path)?;
    storage::touch_project(&root)?;
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
pub fn restore_trash(input: crate::models::NodeActionInput) -> Result<ProjectData, String> {
    let (root, mut connection) = project_connection(&input.project_path)?;
    let item = trash_item(&connection, &input.node_id)?;
    if item.ref_kind != "node" && item.ref_kind != "entity" {
        return Err("回收站项目类型无效".to_string());
    }
    let trash_path = storage::safe_trash_path(&root, &item.trash_path)?;
    let destination = storage::safe_relative(&root, &item.original_path)?;
    if destination.exists() {
        return Err("原位置已有同名内容，请先处理后再恢复".to_string());
    }
    let node_ids = if item.ref_kind == "node" {
        Some(descendant_ids(&storage::all_nodes(&connection, true)?, &item.ref_id))
    } else {
        None
    };
    fs::create_dir_all(destination.parent().ok_or_else(|| "无法确定恢复目录".to_string())?)
        .map_err(|error| format!("无法创建恢复目录：{}", error))?;
    fs::rename(&trash_path, &destination).map_err(|error| format!("恢复文件失败：{}", error))?;
    let database_result = (|| -> Result<(), String> {
        let transaction = connection.transaction()
            .map_err(|error| format!("无法开始恢复事务：{}", error))?;
        if let Some(ids) = &node_ids {
            for id in ids {
                transaction.execute("UPDATE nodes SET deleted_at = NULL, deleted_path = NULL WHERE id = ?1", params![id])
                    .map_err(|error| format!("更新恢复节点失败：{}", error))?;
            }
        } else {
            transaction.execute("UPDATE entities SET deleted_at = NULL, deleted_path = NULL WHERE id = ?1", params![item.ref_id])
                .map_err(|error| format!("更新恢复资料失败：{}", error))?;
        }
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
    let quarantine = trash_path.with_file_name(format!(".purge-{}", storage::new_id()));
    fs::rename(&trash_path, &quarantine).map_err(|error| format!("隔离待永久删除内容失败：{}", error))?;
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
        return match fs::rename(&quarantine, &trash_path) {
            Ok(()) => Err(format!("{}；回收站内容已恢复", error)),
            Err(rollback_error) => Err(format!("{}；回收站内容回滚失败：{}", error, rollback_error)),
        };
    }
    if quarantine.is_dir() {
        fs::remove_dir_all(&quarantine).map_err(|error| format!("清理永久删除目录失败：{}", error))?;
    } else {
        fs::remove_file(&quarantine).map_err(|error| format!("清理永久删除文件失败：{}", error))?;
    }
    storage::touch_project(&root)?;
    project_data(&root, &connection)
}

fn clean_query(query: &str) -> String {
    query.split_whitespace()
        .map(|term| format!("\"{}\"", term.replace('"', "")))
        .filter(|term| term != "\"\"")
        .collect::<Vec<String>>()
        .join(" AND ")
}

fn snippet(content: &str, query: &str) -> String {
    let lower = content.to_lowercase();
    let needle = query.trim().to_lowercase();
    let position = lower.find(&needle).unwrap_or(0);
    let start = position.saturating_sub(45);
    let end = (position + needle.chars().count() + 90).min(content.len());
    let mut value = content.get(start..end).unwrap_or(content).replace('\n', " ");
    if start > 0 { value = format!("…{}", value); }
    if end < content.len() { value.push('…'); }
    value
}

#[tauri::command]
pub fn search_project(input: SearchInput) -> Result<Vec<SearchResult>, String> {
    let (_root, connection) = project_connection(&input.project_path)?;
    let mut results = Vec::new();
    let fts_query = clean_query(&input.query);
    if !fts_query.is_empty() {
        if let Ok(mut statement) = connection.prepare(
            "SELECT ref_id, kind, title, path, snippet(search_index, 3, '<mark>', '</mark>', '…', 24) FROM search_index WHERE search_index MATCH ?1 LIMIT 100",
        ) {
            if let Ok(rows) = statement.query_map(params![fts_query], |row| {
                Ok(SearchResult {
                    id: row.get(0)?, kind: row.get(1)?, title: row.get(2)?, path: row.get(3)?, snippet: row.get(4)?,
                })
            }) {
                for row in rows.flatten() {
                    if input.kind.as_deref().is_none_or(|kind| kind == row.kind || (kind == "manuscript" && (row.kind == "chapter" || row.kind == "section"))) {
                        results.push(row);
                    }
                }
            }
        }
    }
    let like = format!("%{}%", input.query.trim());
    let mut fallback = connection.prepare(
        "SELECT ref_id, kind, title, path, content FROM search_index WHERE title LIKE ?1 OR content LIKE ?1 LIMIT 100",
    ).map_err(|error| format!("执行全文搜索失败：{}", error))?;
    let rows = fallback.query_map(params![like], |row| {
        let content: String = row.get(4)?;
        Ok(SearchResult {
            id: row.get(0)?, kind: row.get(1)?, title: row.get(2)?, path: row.get(3)?,
            snippet: snippet(&content, &input.query),
        })
    }).map_err(|error| format!("执行全文搜索失败：{}", error))?;
    for row in rows.flatten() {
        let matches_kind = input.kind.as_deref().is_none_or(|kind| kind == row.kind || (kind == "manuscript" && (row.kind == "chapter" || row.kind == "section")));
        if matches_kind && !results.iter().any(|existing: &SearchResult| existing.id == row.id) {
            results.push(row);
        }
    }
    results.truncate(100);
    Ok(results)
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
    let mut rest = content;
    while let Some(start) = rest.find("[[") {
        let after_start = &rest[start + 2..];
        let Some(end) = after_start.find("]]" ) else { break };
        let target = after_start[..end].trim();
        if !target.is_empty() { targets.push(target.to_string()); }
        rest = &after_start[end + 2..];
    }
    targets
}

fn chapter_reference_tokens(value: &str) -> Vec<String> {
    value.split(|character: char| ",，、;；\t\r\n ".contains(character))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .collect()
}

fn chapter_reference_exists(chapters: &[NodeRecord], reference: &str) -> bool {
    let normalized = reference.trim();
    if normalized.is_empty() { return false; }
    if chapters.iter().any(|chapter| chapter.title.trim() == normalized) { return true; }
    let digits: String = normalized.chars().filter(|character| character.is_ascii_digit()).collect();
    let Ok(number) = digits.parse::<usize>() else { return false };
    number > 0 && chapters.iter().min_by_key(|chapter| chapter.order_index)
        .map(|first| first.order_index).is_some_and(|_| {
            let mut ordered = chapters.to_vec();
            ordered.sort_by_key(|chapter| chapter.order_index);
            ordered.get(number - 1).is_some()
        })
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
    let chapters: Vec<NodeRecord> = nodes.iter().filter(|node| node.kind == "chapter").cloned().collect();
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
                if !chapter_reference_exists(&chapters, &reference) {
                    issues.push(consistency_issue("warning", "missing-chapter-reference", &format!("{}不存在", label), format!("“{}”无法匹配当前正文中的章节。", reference), &entity.id, &entity.kind, &entity.file_path));
                }
            }
        }
        if entity.kind == "foreshadowing" {
            let status = json_text(&entity.content, "status").trim().to_lowercase();
            if !json_text(&entity.content, "actualPayoff").trim().is_empty() && status != "paid-off" && status != "已回收" {
                issues.push(consistency_issue("warning", "foreshadowing-status", "伏笔状态未标记为已回收", "已经填写实际回收章节，但当前状态仍未标记为“已回收”。".to_string(), &entity.id, &entity.kind, &entity.file_path));
            }
        }
    }
    let errors = issues.iter().filter(|issue| issue.severity == "error").count() as u64;
    let warnings = issues.iter().filter(|issue| issue.severity == "warning").count() as u64;
    Ok(crate::models::ConsistencyReport { checked_at: storage::now(), issue_count: issues.len() as u64, errors, warnings, issues })
}

#[tauri::command]
pub fn get_statistics(path: String) -> Result<Stats, String> {
    let (root, connection) = project_connection(&path)?;
    let nodes = storage::all_nodes(&connection, false)?;
    let mut total_words = 0;
    let mut chapter_count = 0;
    let mut chapter_stats = Vec::new();
    for node in nodes.iter().filter(|node| node.kind != "volume") {
        if node.kind == "chapter" { chapter_count += 1; }
        if let Ok(content) = fs::read_to_string(storage::safe_relative(&root, &node.file_path)?) {
            let words = storage::word_count(&content);
            total_words += words;
            if node.kind == "chapter" {
                chapter_stats.push(crate::models::ChapterStats {
                    id: node.id.clone(), title: node.title.clone(), words, updated_at: node.updated_at.clone(),
                });
            }
        }
    }
    let now = Utc::now();
    let today = now.format("%Y-%m-%d").to_string();
    let yesterday = (now - Duration::days(1)).format("%Y-%m-%d").to_string();
    let week_start = (now - Duration::days(6)).date_naive();
    let month_start = (now - Duration::days(30)).date_naive();
    let mut today_words = 0_u64;
    let mut yesterday_words = 0_u64;
    let mut week_words = 0_u64;
    let mut month_words = 0_u64;
    let mut dates = std::collections::BTreeSet::new();
    let mut daily_totals = std::collections::BTreeMap::<String, u64>::new();
    let mut statement = connection.prepare("SELECT created_at, delta_words FROM activity")
        .map_err(|error| format!("读取写作统计失败：{}", error))?;
    let rows = statement.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)))
        .map_err(|error| format!("读取写作统计失败：{}", error))?;
    for row in rows.flatten() {
        let (created_at, delta) = row;
        let positive = delta.max(0) as u64;
        if let Some(date) = storage::parse_timestamp(&created_at) {
            let date_key = date.format("%Y-%m-%d").to_string();
            if positive > 0 { dates.insert(date_key.clone()); }
            *daily_totals.entry(date_key.clone()).or_default() += positive;
            if date_key == today { today_words += positive; }
            if date_key == yesterday { yesterday_words += positive; }
            if date.date_naive() >= week_start { week_words += positive; }
            if date.date_naive() >= month_start { month_words += positive; }
        }
    }
    let mut streak = 0;
    let mut cursor = now.date_naive();
    loop {
        let key = cursor.format("%Y-%m-%d").to_string();
        if dates.contains(&key) {
            streak += 1;
            cursor = cursor - Duration::days(1);
        } else {
            break;
        }
    }
    let metadata = storage::read_project_json(&root)?;
    let daily = (0..30).rev().map(|offset| {
        let date = (now - Duration::days(offset)).format("%Y-%m-%d").to_string();
        let words = daily_totals.get(&date).copied().unwrap_or(0);
        crate::models::DailyStats { date, words }
    }).collect();
    chapter_stats.sort_by(|left, right| right.words.cmp(&left.words).then_with(|| left.title.cmp(&right.title)));
    Ok(Stats {
        total_words, today_words, yesterday_words, week_words, month_words,
        chapter_count, target_words: metadata.target_words, writing_streak: streak, daily, chapter_stats,
    })
}

fn export_nodes(
    root: &Path,
    nodes: &[NodeRecord],
    parent_id: Option<&str>,
    level: usize,
    format: &str,
    output: &mut String,
) {
    for node in node_children(nodes, parent_id) {
        if format == "markdown" {
            output.push_str(&format!("\n{} {}\n\n", "#".repeat(level.max(1)), node.title));
        } else {
            output.push_str(&format!("\n{}\n{}\n\n", node.title, "=".repeat(node.title.chars().count().max(3))));
        }
        if node.kind != "volume" {
            if let Ok(content) = fs::read_to_string(storage::safe_relative(root, &node.file_path).unwrap_or_else(|_| PathBuf::new())) {
                let clean = content.lines().filter(|line| !line.trim_start().starts_with("# ")).collect::<Vec<_>>().join("\n");
                output.push_str(clean.trim());
                output.push_str("\n\n");
            }
        }
        export_nodes(root, nodes, Some(&node.id), level + 1, format, output);
    }
}

fn xml_escape(value: &str) -> String {
    value.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
        .replace('"', "&quot;").replace('\'', "&apos;")
}

fn heading_level(line: &str) -> Option<usize> {
    let level = line.chars().take_while(|character| *character == '#').count();
    (level > 0 && line.chars().nth(level) == Some(' ')).then_some(level)
}

fn docx_xml(markdown: &str) -> String {
    let mut body = String::new();
    for line in markdown.lines() {
        let (text, style) = if let Some(level) = heading_level(line) {
            (&line[level + 1..], Some(format!("Heading{}", level.min(6))))
        } else {
            (line, None)
        };
        let paragraph_style = style.map(|value| format!("<w:pPr><w:pStyle w:val=\"{}\"/></w:pPr>", value)).unwrap_or_default();
        body.push_str(&format!("<w:p>{}<w:r><w:t xml:space=\"preserve\">{}</w:t></w:r></w:p>", paragraph_style, xml_escape(text)));
    }
    format!(r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>{}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>"#, body)
}

fn zip_document(files: &[(&str, &str)], stored: &[&str]) -> Result<Vec<u8>, String> {
    let cursor = Cursor::new(Vec::new());
    let mut writer = ZipWriter::new(cursor);
    for (name, content) in files {
        let method = if stored.iter().any(|item| item == name) { CompressionMethod::Stored } else { CompressionMethod::Deflated };
        let options = SimpleFileOptions::default().compression_method(method);
        writer.start_file(*name, options).map_err(|error| format!("创建压缩文件失败：{}", error))?;
        writer.write_all(content.as_bytes()).map_err(|error| format!("写入压缩文件失败：{}", error))?;
    }
    writer.finish().map(|cursor| cursor.into_inner()).map_err(|error| format!("完成压缩文件失败：{}", error))
}

fn docx_bytes(markdown: &str) -> Result<Vec<u8>, String> {
    let document = docx_xml(markdown);
    let content_types = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>"#;
    let rels = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>"#;
    let files = [("[Content_Types].xml", content_types), ("_rels/.rels", rels), ("word/document.xml", document.as_str())];
    zip_document(&files, &[])
}

fn epub_xhtml(markdown: &str) -> String {
    let mut body = String::new();
    for line in markdown.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() { continue; }
        if let Some(level) = heading_level(trimmed) {
            body.push_str(&format!("<h{}>{}</h{}>", level.min(6), xml_escape(&trimmed[level + 1..]), level.min(6)));
        } else {
            body.push_str(&format!("<p>{}</p>", xml_escape(trimmed)));
        }
    }
    format!(r#"<?xml version="1.0" encoding="utf-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml"><head><meta charset="utf-8"/><title>NovelForge</title><style>body{{font-family:serif;line-height:1.8;margin:5%;}}h1,h2,h3{{line-height:1.3;}}</style></head><body>{}</body></html>"#, body)
}

fn epub_bytes(markdown: &str, title: &str, author: &str) -> Result<Vec<u8>, String> {
    let xhtml = epub_xhtml(markdown);
    let nav = format!(r#"<?xml version="1.0" encoding="utf-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>{}</title></head><body><nav epub:type="toc" id="toc"><h1>目录</h1><ol><li><a href="content.xhtml">{}</a></li></ol></nav></body></html>"#, xml_escape(title), xml_escape(title));
    let container = r#"<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>"#;
    let opf = format!(r#"<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book-id">novelforge-{}</dc:identifier><dc:title>{}</dc:title><dc:creator>{}</dc:creator><dc:language>zh</dc:language></metadata><manifest><item id="content" href="content.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest><spine toc="nav"><itemref idref="nav"/><itemref idref="content"/></spine></package>"#, storage::new_id(), xml_escape(title), xml_escape(author));
    let files = [("mimetype", "application/epub+zip"), ("META-INF/container.xml", container), ("OEBPS/content.opf", opf.as_str()), ("OEBPS/nav.xhtml", nav.as_str()), ("OEBPS/content.xhtml", xhtml.as_str())];
    zip_document(&files, &["mimetype"])
}

fn pdf_hex_text(value: &str) -> String {
    value.encode_utf16().map(|unit| format!("{:04X}", unit)).collect()
}

fn pdf_bytes(text: &str) -> Vec<u8> {
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
    for chunk in page_lines {
        let page_number = objects.len() + 1;
        let content_number = page_number + 1;
        let mut stream = String::from("BT\n/F1 11 Tf\n50 790 Td\n");
        for (index, line) in chunk.iter().enumerate() {
            if index > 0 { stream.push_str("0 -15 Td\n"); }
            stream.push_str(&format!("<{}> Tj\n", pdf_hex_text(line)));
        }
        stream.push_str("ET\n");
        objects.push(format!("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 FONTREF >> >> /Contents {} 0 R >>", content_number));
        objects.push(format!("<< /Length {} >>\nstream\n{}endstream", stream.as_bytes().len(), stream));
        page_refs.push(format!("{} 0 R", page_number));
    }
    let font_number = objects.len() + 1;
    let descendant_number = font_number + 1;
    objects.push("<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [DESCREF] >>".to_string());
    objects.push("<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 4 >> /DW 1000 >>".to_string());
    objects[0] = "<< /Type /Catalog /Pages 2 0 R >>".to_string();
    objects[1] = format!("<< /Type /Pages /Kids [{}] /Count {} >>", page_refs.join(" "), page_refs.len());
    let mut pdf = b"%PDF-1.4\n%\xE2\xE3\xCF\xD3\n".to_vec();
    let mut offsets = Vec::new();
    for (index, object) in objects.iter().enumerate() {
        offsets.push(pdf.len());
        let number = index + 1;
        pdf.extend_from_slice(format!("{} 0 obj\n{}\nendobj\n", number, object.replace("FONTREF", &format!("{} 0 R", font_number)).replace("DESCREF", &format!("{} 0 R", descendant_number))).as_bytes());
    }
    let xref = pdf.len();
    pdf.extend_from_slice(format!("xref\n0 {}\n0000000000 65535 f \n", objects.len() + 1).as_bytes());
    for offset in offsets { pdf.extend_from_slice(format!("{:010} 00000 n \n", offset).as_bytes()); }
    pdf.extend_from_slice(format!("trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{}\n%%EOF\n", objects.len() + 1, xref).as_bytes());
    pdf
}

#[tauri::command]
pub fn export_project(input: ExportInput) -> Result<String, String> {
    let (root, connection) = project_connection(&input.project_path)?;
    let format = match input.format.as_str() {
        "markdown" | "txt" | "docx" | "epub" | "pdf" => input.format.as_str(),
        _ => return Err(format!("不支持的导出格式：{}", input.format)),
    };
    let metadata = storage::read_project_json(&root)?;
    let nodes = storage::all_nodes(&connection, false)?;
    let mut markdown = String::new();
    export_nodes(&root, &nodes, None, 1, "markdown", &mut markdown);
    let mut output = if format == "markdown" {
        format!("# {}\n\n作者：{}\n\n", metadata.title, metadata.author)
    } else if format == "txt" {
        format!("{}\n作者：{}\n\n", metadata.title, metadata.author)
    } else {
        String::new()
    };
    if format == "markdown" { output.push_str(&markdown); }
    if format == "txt" { export_nodes(&root, &nodes, None, 1, "txt", &mut output); }
    let (extension, bytes) = match format {
        "markdown" | "txt" => (format.to_string(), output.into_bytes()),
        "docx" => ("docx".to_string(), docx_bytes(&format!("# {}\n\n作者：{}\n\n{}", metadata.title, metadata.author, markdown))?),
        "epub" => ("epub".to_string(), epub_bytes(&format!("# {}\n\n{}", metadata.title, markdown), &metadata.title, &metadata.author)?),
        "pdf" => ("pdf".to_string(), pdf_bytes(&format!("{}\n作者：{}\n\n{}", metadata.title, metadata.author, markdown))),
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
    Ok(target.to_string_lossy().to_string())
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
    project_data(&root, &connection)
}
