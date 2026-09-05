use super::*;

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
        return Err(format!(
            "{}只能创建在{}下面",
            input.kind, expected_parent_kind
        ));
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
            storage::index_record(
                &transaction,
                &node.id,
                &node.kind,
                &node.title,
                &content,
                &node.file_path,
            )?;
        }
        transaction
            .commit()
            .map_err(|error| format!("提交创建节点失败：{}", error))
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
            storage::index_record(
                &transaction,
                &current.id,
                &current.kind,
                &next_title,
                &content,
                &current.file_path,
            )?;
        }
        transaction
            .commit()
            .map_err(|error| format!("提交重命名事务失败：{}", error))
    })();
    if let Err(error) = database_result {
        if let (Some(target), Some(content)) = (mirror_path.as_ref(), old_raw_content.as_deref()) {
            if let Err(rollback_error) = restore_document_after_save_failure(target, true, content)
            {
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
    let allowed = [
        "not-started",
        "draft",
        "first-draft",
        "editing",
        "done",
        "locked",
    ];
    if !allowed.contains(&input.status.as_str()) {
        return Err("状态无效".to_string());
    }
    let (root, mut connection) = project_connection(&input.project_path)?;
    let node = storage::node_from_id(&connection, &input.node_id)?
        .filter(|node| node.deleted_at.is_none())
        .ok_or_else(|| "节点不存在或已在回收站".to_string())?;
    let relative = if node.kind == "volume" {
        format!("{}/.novelforge.md", node.file_path)
    } else {
        node.file_path.clone()
    };
    let target = storage::safe_relative(&root, &relative)?;
    let old_raw = match fs::read_to_string(&target) {
        Ok(raw) => Some(raw),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound && node.kind == "volume" => None,
        Err(error) => return Err(format!("读取状态镜像失败：{}", error)),
    };
    let timestamp = storage::now();
    let mirror = if node.kind == "volume" {
        storage::markdown_volume(
            &node.id,
            &node.title,
            &input.status,
            &node.created_at,
            &timestamp,
        )
    } else {
        storage::markdown_node(
            &node.id,
            &node.kind,
            node.parent_id.as_deref(),
            &input.status,
            &node.created_at,
            &timestamp,
            old_raw.as_deref().unwrap_or_default(),
        )
    };
    let transaction = connection
        .transaction()
        .map_err(|error| format!("无法开始状态事务：{}", error))?;
    let changed = transaction
        .execute(
            "UPDATE nodes SET status = ?1, updated_at = ?2 WHERE id = ?3 AND deleted_at IS NULL",
            params![input.status, timestamp, input.node_id],
        )
        .map_err(|error| format!("更新章节状态失败：{}", error))?;
    if changed == 0 {
        return Err("节点不存在或已在回收站".to_string());
    }
    storage::atomic_write(&target, mirror.as_bytes())?;
    if let Err(error) = transaction.commit() {
        let rollback = restore_document_after_save_failure(
            &target,
            old_raw.is_some(),
            old_raw.as_deref().unwrap_or_default(),
        );
        return match rollback {
            Ok(()) => Err(format!("提交状态事务失败：{}；镜像已回滚", error)),
            Err(rollback_error) => Err(format!(
                "提交状态事务失败：{}；镜像回滚失败：{}",
                error, rollback_error
            )),
        };
    }
    touch_project_best_effort(&root, "project_metadata_touch_failed");
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
            .execute(
                "UPDATE nodes SET order_index = ?1 WHERE id = ?2 AND deleted_at IS NULL",
                params![neighbour_order, current.id],
            )
            .map_err(|error| format!("更新节点顺序失败：{}", error))?;
        transaction
            .execute(
                "UPDATE nodes SET order_index = ?1 WHERE id = ?2 AND deleted_at IS NULL",
                params![current.order_index, neighbour_id],
            )
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

    let (target_path, _) = next_node_location(
        &root,
        &allocation_nodes,
        &current.kind,
        target_parent.as_ref(),
    )?;
    let original_mirror = read_move_mirror(&root, &current.file_path, &current.kind)?;
    let sidecar_moved = move_node_files(&root, &current.file_path, &target_path, &current.kind)?;
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
        let rollback = rollback_node_move(
            &root,
            &current.file_path,
            &target_path,
            &current.kind,
            sidecar_moved,
            original_mirror.as_deref(),
        );
        return Err(move_rollback_error(error, rollback));
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
        for node in nodes
            .iter()
            .filter(|node| node.id != current.id && descendants.iter().any(|id| id == &node.id))
        {
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
        let rollback = rollback_node_move(
            &root,
            &current.file_path,
            &target_path,
            &current.kind,
            sidecar_moved,
            original_mirror.as_deref(),
        );
        return Err(move_rollback_error(error, rollback));
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
    let target_parent =
        validate_target_parent(&nodes, &current.kind, input.target_parent_id.as_deref())?;
    let descendants = descendant_ids(&nodes, &current.id);
    let target_parent_id = input.target_parent_id.as_deref();
    if target_parent_id.is_some_and(|id| descendants.iter().any(|item| item == id)) {
        return Err("不能将节点复制到自己的后代下面".to_string());
    }
    let (target_path, target_order) = next_node_location(
        &root,
        &allocation_nodes,
        &current.kind,
        target_parent.as_ref(),
    )?;
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
    for node in nodes
        .iter()
        .filter(|node| descendants.iter().any(|id| id == &node.id))
    {
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
    for node in nodes
        .iter()
        .filter(|node| descendants.iter().any(|id| id == &node.id))
    {
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
            order_index: if node.id == current.id {
                target_order
            } else {
                node.order_index
            },
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
        for node in nodes
            .iter()
            .filter(|node| descendants.iter().any(|id| id == &node.id))
        {
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
            let new_order = if node.id == current.id {
                target_order
            } else {
                node.order_index
            };
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
    let (trash_path, sidecar_moved) =
        move_node_to_trash(&root, &original_absolute, &node.kind, &node.id)?;
    let deleted_at = storage::now();
    let database_result = (|| -> Result<(), String> {
        let transaction = connection
            .transaction()
            .map_err(|error| format!("无法开始删除事务：{}", error))?;
        for id in &ids {
            transaction
                .execute(
                    "UPDATE nodes SET deleted_at = ?1, deleted_path = ?2 WHERE id = ?3",
                    params![
                        deleted_at,
                        if id == &node.id {
                            Some(trash_path.clone())
                        } else {
                            None::<String>
                        },
                        id
                    ],
                )
                .map_err(|error| format!("移入回收站失败：{}", error))?;
            transaction
                .execute("DELETE FROM search_index WHERE ref_id = ?1", params![id])
                .map_err(|error| format!("删除搜索索引失败：{}", error))?;
        }
        transaction
            .execute(
                "INSERT INTO trash_items (id, ref_id, ref_kind, title, original_path, trash_path, deleted_at) VALUES (?1, ?2, 'node', ?3, ?4, ?5, ?6)",
                params![storage::new_id(), node.id, node.title, original_path, trash_path, deleted_at],
            )
            .map_err(|error| format!("记录回收站失败：{}", error))?;
        transaction
            .commit()
            .map_err(|error| format!("提交删除事务失败：{}", error))
    })();
    if let Err(error) = database_result {
        return match restore_node_from_trash(
            &original_absolute,
            Path::new(&trash_path),
            &node.kind,
            sidecar_moved,
        ) {
            Ok(()) => Err(format!("{}；文件已恢复到原位置", error)),
            Err(rollback_error) => Err(format!("{}；文件回滚失败：{}", error, rollback_error)),
        };
    }
    storage::touch_project(&root)?;
    project_data(&root, &connection)
}

pub(crate) fn restore_document_after_save_failure(
    target: &Path,
    target_existed: bool,
    old_content: &str,
) -> Result<(), String> {
    if target_existed {
        storage::atomic_write(target, old_content.as_bytes())
    } else {
        storage::remove_file_if_exists(target)
    }
}

pub(crate) fn save_document_internal(
    root: &Path,
    connection: &mut Connection,
    node_id: &str,
    content: &str,
    reason: &str,
) -> Result<DocumentData, String> {
    let node =
        storage::node_from_id(connection, node_id)?.ok_or_else(|| "章节不存在".to_string())?;
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
            let rollback =
                restore_document_after_save_failure(&target, target_existed, &old_raw_content);
            return match rollback {
                Ok(()) => Err(format!("{}；原正文已恢复，恢复文件已保留", error)),
                Err(rollback_error) => Err(format!(
                    "{}；原正文恢复失败：{}；恢复文件已保留",
                    error, rollback_error
                )),
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
        storage::index_record(
            &transaction,
            &node.id,
            &node.kind,
            &node.title,
            content,
            &node.file_path,
        )?;
        transaction
            .commit()
            .map_err(|error| format!("提交保存事务失败：{}", error))
    })();
    if let Err(error) = database_result {
        let _ = storage::append_log(root, "ERROR", "document_save_failed");
        let cleanup =
            storage::remove_file_if_exists(&storage::safe_relative(root, &revision_path)?);
        let rollback =
            restore_document_after_save_failure(&target, target_existed, &old_raw_content);
        let mut detail = error;
        if let Err(cleanup_error) = cleanup {
            detail.push_str(&format!("；历史快照清理失败：{}", cleanup_error));
        }
        return match rollback {
            Ok(()) => Err(format!("{}；原正文已恢复，恢复文件已保留", detail)),
            Err(rollback_error) => Err(format!(
                "{}；原正文恢复失败：{}；恢复文件已保留",
                detail, rollback_error
            )),
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
    Ok(DocumentData {
        node: updated,
        content: content.to_string(),
    })
}

pub(crate) fn preserve_current_revision(
    root: &Path,
    connection: &Connection,
    node_id: &str,
    reason: &str,
) -> Result<(), String> {
    let node =
        storage::node_from_id(connection, node_id)?.ok_or_else(|| "章节不存在".to_string())?;
    if node.deleted_at.is_some() || node.kind == "volume" {
        return Err("只有未删除的章节或小节可以创建历史快照".to_string());
    }
    let target = storage::safe_relative(root, &node.file_path)?;
    let current_content =
        fs::read_to_string(&target).map_err(|error| format!("无法读取恢复前的正文：{}", error))?;
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
    Ok(DocumentData {
        node,
        content: storage::strip_markdown_frontmatter(&content),
    })
}

#[tauri::command]
pub fn save_document(input: SaveDocumentInput) -> Result<DocumentData, String> {
    let (root, mut connection) = project_connection(&input.project_path)?;
    save_document_internal(
        &root,
        &mut connection,
        &input.node_id,
        &input.content,
        &input.reason,
    )
}
