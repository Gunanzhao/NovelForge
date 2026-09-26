use super::*;
use sha2::{Digest, Sha256};

#[derive(Clone, Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedChapter {
    pub title: String,
    pub content: String,
}
#[derive(Clone, Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportManuscript {
    pub project_path: String,
    pub parent_id: String,
    pub request_id: String,
    pub chapters: Vec<ImportedChapter>,
}

/// Only creates new chapters. Files and search rows share the durable batch journal.
#[tauri::command]
pub fn import_manuscript(input: ImportManuscript) -> Result<ProjectData, String> {
    let _serial = guard::SAVES.lock().map_err(|_| "正文保存锁不可用")?;
    Uuid::parse_str(&input.request_id).map_err(|_| "导入请求标识无效")?;
    if input.chapters.is_empty() || input.chapters.len() > 2000 {
        return Err("每次请导入1至2000个章节".into());
    }
    let mut total = 0usize;
    for chapter in &input.chapters {
        if chapter.title.trim().is_empty() || chapter.title.trim().encode_utf16().count() > 200 {
            return Err("章节名称须为1至200个字符".into());
        }
        total = total
            .checked_add(chapter.content.len())
            .ok_or("导入正文过大")?;
        if total > 32 * 1024 * 1024 {
            return Err("导入正文总量不能超过32 MiB".into());
        }
        if chapter
            .content
            .chars()
            .any(|c| c < ' ' && !matches!(c, '\t' | '\n' | '\r'))
        {
            return Err("正文包含二进制控制字符".into());
        }
    }
    let fingerprint = format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&input).map_err(|e| e.to_string())?)
    );
    let (root, mut db) = project_connection(&input.project_path)?;
    let tx = db
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    let previous: Option<(String, String)> = tx
        .query_row(
            "SELECT label,changes_json FROM batch_operations WHERE id=?1",
            [&input.request_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if let Some((label, value)) = previous {
        if label != "稿件导入" || value != fingerprint {
            return Err("请求标识已用于其他操作，请重新预览".into());
        }
        drop(tx);
        return project_data(&root, &db);
    }
    let parent = storage::node_from_id(&tx, &input.parent_id)?.ok_or("目标卷不存在")?;
    if parent.kind != "volume" || parent.deleted_at.is_some() {
        return Err("请选择可用的目标卷".into());
    }
    manuscript::ensure_body_unlocked(&tx, &parent.id)?;
    let mut nodes = storage::all_nodes(&tx, true)?;
    let mut titles: HashSet<String> = nodes
        .iter()
        .filter(|node| node.deleted_at.is_none() && node.parent_id.as_deref() == Some(&parent.id))
        .map(|node| node.title.trim().to_string())
        .collect();
    let now = storage::now();
    let mut created = Vec::new();
    let mut journal = storage::batch::Journal {
        id: input.request_id.clone(),
        files: Vec::new(),
    };
    for chapter in &input.chapters {
        if !titles.insert(chapter.title.trim().to_string()) {
            return Err(format!(
                "目标卷或导入预览存在同名章节：{}",
                chapter.title.trim()
            ));
        }
        let (file_path, order_index) = next_node_location(&root, &nodes, "chapter", Some(&parent))?;
        let node = NodeRecord {
            id: storage::new_id(),
            kind: "chapter".into(),
            parent_id: Some(parent.id.clone()),
            title: chapter.title.trim().into(),
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
            &chapter.content,
        );
        journal.files.push(storage::batch::FileChange {
            path: node.file_path.clone(),
            before: None,
            after: raw,
        });
        nodes.push(node.clone());
        created.push(node);
    }
    storage::batch::prepare(&root, &journal)?;
    let result = (|| -> Result<(), String> {
        for ((node, chapter), change) in created.iter().zip(&input.chapters).zip(&journal.files) {
            insert_node(&tx, node)?;
            storage::index_record(
                &tx,
                &node.id,
                &node.kind,
                &node.title,
                &chapter.content,
                &node.file_path,
            )?;
            storage::atomic_write(
                &storage::safe_relative(&root, &change.path)?,
                change.after.as_bytes(),
            )?;
        }
        tx.execute("INSERT INTO batch_operations(id,target_id,label,created_at,changes_json) VALUES(?1,?2,'稿件导入',?3,?4)", params![journal.id,parent.id,now,fingerprint]).map_err(|e| e.to_string())?;
        Ok(())
    })();
    if let Err(error) = result {
        let rollback = storage::batch::rollback(&root, &journal);
        if rollback.is_ok() {
            let _ =
                storage::remove_file_if_exists(&storage::batch::journal_path(&root, &journal.id)?);
        }
        return Err(match rollback {
            Ok(()) => error,
            Err(why) => format!("{error}；{why}"),
        });
    }
    tx.commit()
        .map_err(|e| format!("导入事务失败，已保留恢复日志：{e}"))?;
    let _ = storage::remove_file_if_exists(&storage::batch::journal_path(&root, &journal.id)?);
    touch_project_best_effort(&root, "project_metadata_touch_failed");
    project_data(&root, &db)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> (PathBuf, ImportManuscript) {
        let root = std::env::temp_dir().join(format!("novelforge-import-{}", storage::new_id()));
        fs::create_dir_all(&root).unwrap();
        let path = root.to_string_lossy().into_owned();
        let data = create_project(ProjectInput {
            path: path.clone(),
            title: "导入测试".into(),
            author: "".into(),
            description: "".into(),
            genre: "".into(),
            target_words: 1,
        })
        .unwrap();
        let parent_id = data
            .nodes
            .iter()
            .find(|node| node.kind == "volume")
            .unwrap()
            .id
            .clone();
        (
            root,
            ImportManuscript {
                project_path: path,
                parent_id,
                request_id: storage::new_id(),
                chapters: vec![
                    ImportedChapter {
                        title: "导入甲".into(),
                        content: "# 第一章\r\n明月升起🌙\r\n".into(),
                    },
                    ImportedChapter {
                        title: "导入乙".into(),
                        content: "第二章\n旅程开始\n".into(),
                    },
                ],
            },
        )
    }
    #[test]
    fn imports_exact_bodies_and_retries_without_duplicates() {
        let (root, input) = fixture();
        let result = import_manuscript(input.clone()).unwrap();
        let retry = import_manuscript(input.clone()).unwrap();
        assert_eq!(retry.nodes.len(), result.nodes.len());
        let (_, mut db) = project_connection(&input.project_path).unwrap();
        for chapter in &input.chapters {
            let node = result
                .nodes
                .iter()
                .find(|n| n.title == chapter.title)
                .unwrap();
            let doc = get_document(crate::models::NodeActionInput {
                project_path: input.project_path.clone(),
                node_id: node.id.clone(),
            })
            .unwrap();
            assert_eq!(doc.content, chapter.content);
            let indexed: String = db
                .query_row(
                    "SELECT content FROM search_index WHERE ref_id=?1",
                    [&node.id],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(indexed, chapter.content);
            save_document_internal(
                &root,
                &mut db,
                &node.id,
                &(chapter.content.clone() + "可继续编辑"),
                "测试",
            )
            .unwrap();
        }
        let mut changed = input.clone();
        changed.chapters[0].content.push('变');
        assert!(import_manuscript(changed).unwrap_err().contains("请求标识"));
        let mut collision = input.clone();
        collision.request_id = storage::new_id();
        assert!(import_manuscript(collision).unwrap_err().contains("同名"));
        drop(db);
        guard::release_project(input.project_path).unwrap();
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn imported_chapters_survive_backup_restore_and_reopen() {
        let (root, input) = fixture();
        let imported = import_manuscript(input.clone()).unwrap();
        let backups =
            std::env::temp_dir().join(format!("novelforge-import-backups-{}", storage::new_id()));
        fs::create_dir_all(&backups).unwrap();
        let report = backup::create(
            input.project_path.clone(),
            backups.to_string_lossy().into_owned(),
        )
        .unwrap();
        let restored = tauri::async_runtime::block_on(backup::restore_backup(
            report.path,
            backups.to_string_lossy().into_owned(),
        ))
        .unwrap();
        let reopened = open_project(restored.path.clone()).unwrap();
        for chapter in &input.chapters {
            let original = imported
                .nodes
                .iter()
                .find(|node| node.title == chapter.title)
                .unwrap();
            let node = reopened
                .nodes
                .iter()
                .find(|node| node.id == original.id)
                .unwrap();
            let document = get_document(crate::models::NodeActionInput {
                project_path: restored.path.clone(),
                node_id: node.id.clone(),
            })
            .unwrap();
            assert_eq!(document.content, chapter.content);
        }
        guard::release_project(restored.path).unwrap();
        guard::release_project(input.project_path).unwrap();
        fs::remove_dir_all(backups).unwrap();
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn second_insert_failure_rolls_back_first_file_and_all_rows() {
        let (root, input) = fixture();
        let (_, db) = project_connection(&input.project_path).unwrap();
        let before = storage::all_nodes(&db, true).unwrap();
        db.execute_batch("CREATE TRIGGER fail_import BEFORE INSERT ON nodes WHEN NEW.title='导入乙' BEGIN SELECT RAISE(ABORT,'injected failure'); END;").unwrap();
        assert!(import_manuscript(input.clone())
            .unwrap_err()
            .contains("injected failure"));
        assert_eq!(storage::all_nodes(&db, true).unwrap().len(), before.len());
        let parent = before.iter().find(|n| n.id == input.parent_id).unwrap();
        let (first_path, _) = next_node_location(&root, &before, "chapter", Some(parent)).unwrap();
        assert!(!root.join(first_path).exists());
        db.execute_batch("DROP TRIGGER fail_import").unwrap();
        assert_eq!(
            import_manuscript(input.clone()).unwrap().nodes.len(),
            before.len() + 2
        );
        drop(db);
        guard::release_project(input.project_path).unwrap();
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn rejects_duplicate_preview_and_locked_volume_without_writes() {
        let (root, mut input) = fixture();
        let (_, db) = project_connection(&input.project_path).unwrap();
        let before = storage::all_nodes(&db, true).unwrap().len();
        input.chapters[1].title = input.chapters[0].title.clone();
        assert!(import_manuscript(input.clone())
            .unwrap_err()
            .contains("同名"));
        input.chapters[1].title = "导入乙".into();
        db.execute(
            "UPDATE nodes SET status='locked' WHERE id=?1",
            [&input.parent_id],
        )
        .unwrap();
        assert!(import_manuscript(input.clone())
            .unwrap_err()
            .contains("锁定"));
        assert_eq!(storage::all_nodes(&db, true).unwrap().len(), before);
        drop(db);
        guard::release_project(input.project_path).unwrap();
        fs::remove_dir_all(root).unwrap();
    }
}
