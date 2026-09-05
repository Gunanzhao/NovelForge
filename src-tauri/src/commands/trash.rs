use super::*;

#[tauri::command]
pub fn list_trash(path: String) -> Result<Vec<TrashItem>, String> {
    let (_root, connection) = project_connection(&path)?;
    storage::trash_items(&connection)
}

#[tauri::command]
pub fn empty_trash(path: String) -> Result<ProjectData, String> {
    let items = list_trash(path.clone())?;
    for item in items {
        permanent_delete(crate::models::NodeActionInput {
            project_path: path.clone(),
            node_id: item.id,
        })?;
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
        fs::create_dir_all(
            destination
                .parent()
                .ok_or_else(|| "无法确定恢复目录".to_string())?,
        )
        .map_err(|error| format!("无法创建恢复目录：{}", error))?;
        fs::rename(&trash_path, &destination)
            .map_err(|error| format!("恢复文件失败：{}", error))?;
        let database_result = (|| -> Result<(), String> {
            let transaction = connection
                .transaction()
                .map_err(|error| format!("无法开始恢复事务：{}", error))?;
            transaction
                .execute(
                    "UPDATE entities SET deleted_at = NULL, deleted_path = NULL WHERE id = ?1",
                    params![item.ref_id],
                )
                .map_err(|error| format!("更新恢复资料失败：{}", error))?;
            transaction
                .execute("DELETE FROM trash_items WHERE id = ?1", params![item.id])
                .map_err(|error| format!("清理回收站记录失败：{}", error))?;
            transaction
                .commit()
                .map_err(|error| format!("提交恢复事务失败：{}", error))
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
        fs::create_dir_all(
            destination
                .parent()
                .ok_or_else(|| "无法确定恢复目录".to_string())?,
        )
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
            let transaction = connection
                .transaction()
                .map_err(|error| format!("无法开始恢复事务：{}", error))?;
            transaction.execute(
                "UPDATE nodes SET order_index = order_index + 1, updated_at = ?1 WHERE parent_id IS ?2 AND order_index >= ?3 AND deleted_at IS NULL",
                params![timestamp, node.parent_id, target_order],
            ).map_err(|error| format!("整理恢复节点顺序失败：{}", error))?;
            transaction.execute(
                "UPDATE nodes SET parent_id = ?1, order_index = ?2, file_path = ?3, updated_at = ?4, deleted_at = NULL, deleted_path = NULL WHERE id = ?5",
                params![node.parent_id, target_order, target_path, timestamp, node.id],
            ).map_err(|error| format!("更新恢复节点失败：{}", error))?;
            for child in all_nodes.iter().filter(|candidate| {
                candidate.id != node.id && node_ids.iter().any(|id| id == &candidate.id)
            }) {
                let next_path =
                    replace_path_prefix(&child.file_path, &current_prefix, &target_prefix);
                transaction.execute(
                    "UPDATE nodes SET file_path = ?1, updated_at = ?2, deleted_at = NULL, deleted_path = NULL WHERE id = ?3",
                    params![next_path, timestamp, child.id],
                ).map_err(|error| format!("更新恢复子节点失败：{}", error))?;
            }
            transaction
                .execute("DELETE FROM trash_items WHERE id = ?1", params![item.id])
                .map_err(|error| format!("清理回收站记录失败：{}", error))?;
            transaction
                .commit()
                .map_err(|error| format!("提交恢复事务失败：{}", error))
        })();
        if let Err(error) = database_result {
            return match restore_node_from_trash(
                &trash_path,
                &destination,
                &node.kind,
                sidecar_moved,
            ) {
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
    fs::rename(&trash_path, &quarantine)
        .map_err(|error| format!("隔离待永久删除内容失败：{}", error))?;
    if let (Some(sidecar), Some(quarantine_sidecar)) =
        (trash_sidecar.as_ref(), quarantine_sidecar.as_ref())
    {
        if let Err(error) = fs::rename(sidecar, quarantine_sidecar) {
            let _ = fs::rename(&quarantine, &trash_path);
            return Err(format!("隔离章节小节目录失败：{}", error));
        }
    }
    let node_ids = if item.ref_kind == "node" {
        Some(descendant_ids(
            &storage::all_nodes(&connection, true)?,
            &item.ref_id,
        ))
    } else {
        None
    };
    let database_result = (|| -> Result<(), String> {
        let transaction = connection
            .transaction()
            .map_err(|error| format!("无法开始永久删除事务：{}", error))?;
        if let Some(ids) = &node_ids {
            for id in ids {
                transaction
                    .execute("DELETE FROM nodes WHERE id = ?1", params![id])
                    .map_err(|error| format!("删除节点记录失败：{}", error))?;
                transaction
                    .execute("DELETE FROM search_index WHERE ref_id = ?1", params![id])
                    .map_err(|error| format!("删除搜索索引失败：{}", error))?;
            }
        } else {
            transaction
                .execute("DELETE FROM entities WHERE id = ?1", params![item.ref_id])
                .map_err(|error| format!("删除资料记录失败：{}", error))?;
        }
        transaction
            .execute(
                "DELETE FROM search_index WHERE ref_id = ?1",
                params![item.ref_id],
            )
            .map_err(|error| format!("删除搜索索引失败：{}", error))?;
        transaction
            .execute("DELETE FROM trash_items WHERE id = ?1", params![item.id])
            .map_err(|error| format!("清理回收站记录失败：{}", error))?;
        transaction
            .commit()
            .map_err(|error| format!("提交永久删除事务失败：{}", error))
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
            (Err(sidecar_error), _) => Err(format!(
                "{}；{}；回收站文件可能已恢复",
                error, sidecar_error
            )),
            (_, Err(file_error)) => Err(format!("{}；{}", error, file_error)),
        };
    }
    if quarantine.is_dir() {
        fs::remove_dir_all(&quarantine)
            .map_err(|error| format!("清理永久删除目录失败：{}", error))?;
    } else {
        fs::remove_file(&quarantine).map_err(|error| format!("清理永久删除文件失败：{}", error))?;
    }
    if let Some(quarantine_sidecar) = quarantine_sidecar.filter(|path| path.exists()) {
        fs::remove_dir_all(&quarantine_sidecar)
            .map_err(|error| format!("清理永久删除小节目录失败：{}", error))?;
    }
    storage::touch_project(&root)?;
    project_data(&root, &connection)
}
