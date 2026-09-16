use super::*;

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
    let node_id = input
        .recovery_id
        .split("--")
        .next()
        .unwrap_or_default()
        .to_string();
    if node_id.is_empty() {
        return Err("恢复文件关联的章节无效".to_string());
    }
    let recovery_file = recovery_path(&root, &input.recovery_id)?;
    let content = fs::read_to_string(&recovery_file)
        .map_err(|error| format!("无法读取恢复内容：{}", error))?;
    manuscript::ensure_body_unlocked(&connection, &node_id)?;
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
pub struct HistoryPageInput {
    pub project_path: String,
    pub node_id: String,
    pub before: Option<String>,
    pub filter: Option<String>,
}
#[tauri::command]
pub fn list_history_page(input: HistoryPageInput) -> Result<Vec<HistoryItem>, String> {
    let (_, connection) = project_connection(&input.project_path)?;
    storage::history::history_page(
        &connection,
        &input.node_id,
        input.before.as_deref(),
        input.filter.as_deref().unwrap_or("all"),
    )
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
        .query_row(
            "SELECT file_path FROM revisions WHERE id = ?1",
            params![input.revision_id],
            |row| row.get(0),
        )
        .map_err(|error| format!("版本不存在：{}", error))?;
    let content = fs::read_to_string(storage::safe_relative(&root, &path)?)
        .map_err(|error| format!("无法读取历史内容：{}", error))?;
    Ok(storage::strip_markdown_frontmatter(&content))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreRevisionInput {
    pub project_path: String,
    pub revision_id: String,
    pub expected_node_id: String,
}

#[tauri::command]
pub fn restore_history(input: RestoreRevisionInput) -> Result<ProjectData, String> {
    let (root, mut connection) = project_connection(&input.project_path)?;
    let (node_id, path): (String, String) = connection
        .query_row(
            "SELECT node_id, file_path FROM revisions WHERE id = ?1",
            params![input.revision_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|error| format!("版本不存在：{}", error))?;
    if node_id != input.expected_node_id {
        return Err("历史版本不属于当前章节，已取消恢复".to_string());
    }
    let content = fs::read_to_string(storage::safe_relative(&root, &path)?)
        .map_err(|error| format!("无法读取历史内容：{}", error))?;
    manuscript::ensure_body_unlocked(&connection, &node_id)?;
    preserve_current_revision(&root, &connection, &node_id, "恢复前自动快照")?;
    save_document_internal(&root, &mut connection, &node_id, &content, "恢复历史版本")?;
    project_data(&root, &connection)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotInput {
    pub project_path: String,
    pub node_id: String,
    pub content: String,
    pub kind: SnapshotKind,
    pub name: Option<String>,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SnapshotKind {
    Automatic,
    Checkpoint,
    Named,
    Protected,
}
#[tauri::command]
pub fn create_history_snapshot(input: SnapshotInput) -> Result<(), String> {
    let (root, connection) = project_connection(&input.project_path)?;
    let name = input.name.as_deref().unwrap_or("").trim();
    if name.chars().count() > 100 {
        return Err("版本名称不能超过100字".into());
    }
    let reason = match input.kind {
        SnapshotKind::Automatic => "自动保存".to_string(),
        SnapshotKind::Checkpoint => "离开前保存".to_string(),
        SnapshotKind::Named if name.is_empty() => return Err("请输入版本名称".into()),
        SnapshotKind::Named => format!("命名版本：{}", name),
        SnapshotKind::Protected => format!("操作前保护：{}", name),
    };
    manuscript::create_content_snapshot(&root, &connection, &input.node_id, &input.content, &reason)
}

#[derive(Debug, Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryChapterInput {
    pub project_path: String,
    pub recovery_id: String,
    pub expected_content: String,
    pub parent_id: String,
    pub title: String,
    pub request_id: String,
}
#[tauri::command]
pub fn recovery_as_chapter(input: RecoveryChapterInput) -> Result<ProjectData, String> {
    let _serial = guard::SAVES.lock().map_err(|_| "正文保存锁不可用")?;
    let (root, mut db) = project_connection(&input.project_path)?;
    uuid::Uuid::parse_str(&input.request_id).map_err(|_| "请求标识无效")?;
    let content =
        fs::read_to_string(recovery_path(&root, &input.recovery_id)?).map_err(|e| e.to_string())?;
    if content != input.expected_content {
        return Err("恢复稿已变化，请重新查看后另存".into());
    }
    if input.title.trim().is_empty() {
        return Err("请输入新章节名称".into());
    }
    let tx = db
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    let request = serde_json::to_string(&input).map_err(|e| e.to_string())?;
    let existing: Option<(String, String)> = tx
        .query_row(
            "SELECT label,changes_json FROM batch_operations WHERE id=?1",
            [&input.request_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if let Some((label, previous)) = existing {
        if label != "恢复稿另存章节" || previous != request {
            return Err("请求标识已用于其他操作".into());
        }
        drop(tx);
        return project_data(&root, &db);
    }
    let parent = storage::node_from_id(&tx, &input.parent_id)?.ok_or("目标卷不存在")?;
    if parent.kind != "volume" || parent.deleted_at.is_some() {
        return Err("请选择可用的卷".into());
    }
    manuscript::ensure_body_unlocked(&tx, &parent.id)?;
    let nodes = storage::all_nodes(&tx, true)?;
    if nodes.iter().any(|node| {
        node.deleted_at.is_none()
            && node.parent_id.as_deref() == Some(&parent.id)
            && node.title.trim() == input.title.trim()
    }) {
        return Err("目标卷已有同名章节，请修改名称".into());
    }
    let (file_path, order_index) = next_node_location(&root, &nodes, "chapter", Some(&parent))?;
    let now = storage::now();
    let node = NodeRecord {
        id: storage::new_id(),
        kind: "chapter".into(),
        parent_id: Some(parent.id),
        title: input.title.trim().into(),
        order_index,
        status: "draft".into(),
        file_path,
        created_at: now.clone(),
        updated_at: now.clone(),
        deleted_at: None,
        deleted_path: None,
    };
    let raw = storage::markdown_node(
        &node.id,
        &node.kind,
        node.parent_id.as_deref(),
        &node.status,
        &now,
        &now,
        &content,
    );
    let journal = storage::batch::Journal {
        id: input.request_id,
        files: vec![storage::batch::FileChange {
            path: node.file_path.clone(),
            before: None,
            after: raw,
        }],
    };
    storage::batch::prepare(&root, &journal)?;
    let result = (|| -> Result<(), String> {
        insert_node(&tx, &node)?;
        storage::index_record(
            &tx,
            &node.id,
            &node.kind,
            &node.title,
            &content,
            &node.file_path,
        )?;
        tx.execute("INSERT INTO batch_operations(id,target_id,label,created_at,changes_json) VALUES(?1,?2,'恢复稿另存章节',?3,?4)",params![journal.id,node.id,now,request]).map_err(|e|e.to_string())?;
        storage::atomic_write(
            &storage::safe_relative(&root, &node.file_path)?,
            journal.files[0].after.as_bytes(),
        )?;
        Ok(())
    })();
    if let Err(error) = result {
        let restored = storage::batch::rollback(&root, &journal);
        if restored.is_ok() {
            let _ =
                storage::remove_file_if_exists(&storage::batch::journal_path(&root, &journal.id)?);
        }
        return Err(match restored {
            Ok(()) => error,
            Err(rollback) => format!("{error}；{rollback}"),
        });
    }
    tx.commit()
        .map_err(|e| format!("另存事务失败，已保留恢复日志：{e}"))?;
    let _ = storage::remove_file_if_exists(&storage::batch::journal_path(&root, &journal.id)?);
    touch_project_best_effort(&root, "project_metadata_touch_failed");
    project_data(&root, &db)
}
#[cfg(test)]
mod orphan_tests {
    use super::*;
    #[test]
    fn orphan_recovery_remains_readable_and_save_as_is_idempotent() {
        let root = std::env::temp_dir().join(format!("novelforge-orphan-{}", storage::new_id()));
        fs::create_dir_all(&root).unwrap();
        let path = root.to_string_lossy().into_owned();
        let data = create_project(ProjectInput {
            path: path.clone(),
            title: "恢复稿测试".into(),
            author: "".into(),
            description: "".into(),
            genre: "".into(),
            target_words: 1,
        })
        .unwrap();
        let (_, recovery) =
            storage::write_recovery(&root, "missing-chapter", "孤立正文内容").unwrap();
        let recovery_id = Path::new(&recovery)
            .file_name()
            .unwrap()
            .to_string_lossy()
            .into_owned();
        let items = list_recovery(path.clone()).unwrap();
        assert!(items.iter().any(|item| item.node_id == "missing-chapter"));
        let request_id = storage::new_id();
        let input = || RecoveryChapterInput {
            project_path: path.clone(),
            recovery_id: recovery_id.clone(),
            expected_content: "孤立正文内容".into(),
            parent_id: data
                .nodes
                .iter()
                .find(|n| n.kind == "volume")
                .unwrap()
                .id
                .clone(),
            title: "恢复的新章节".into(),
            request_id: request_id.clone(),
        };
        let mut stale = input();
        stale.expected_content = "过期".into();
        assert!(recovery_as_chapter(stale).is_err());
        let result = recovery_as_chapter(input()).unwrap();
        let retry = recovery_as_chapter(input()).unwrap();
        assert_eq!(retry.nodes.len(), result.nodes.len());
        let node = result
            .nodes
            .iter()
            .find(|n| n.title == "恢复的新章节")
            .unwrap();
        assert_eq!(
            get_document(crate::models::NodeActionInput {
                project_path: path.clone(),
                node_id: node.id.clone()
            })
            .unwrap()
            .content,
            "孤立正文内容"
        );
        assert!(Path::new(&recovery).exists());
        guard::release_project(path).unwrap();
        fs::remove_dir_all(root).unwrap();
    }
}
