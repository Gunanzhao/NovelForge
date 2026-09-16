use super::entity_history::EntityState;
use super::*;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentChange {
    pub id: String,
    pub before: String,
    pub after: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntityChange {
    pub id: String,
    pub before: EntityState,
    pub after: EntityState,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Changes {
    pub documents: Vec<DocumentChange>,
    pub entities: Vec<EntityChange>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyInput {
    pub project_path: String,
    pub target_id: String,
    pub changes: Changes,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UndoInput {
    pub project_path: String,
    pub operation_id: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListInput {
    pub project_path: String,
    pub target_id: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Operation {
    pub id: String,
    pub label: String,
    pub created_at: String,
    pub undone_by: Option<String>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchResult {
    pub data: ProjectData,
    pub operation_id: String,
}

#[tauri::command]
pub fn list_wiki_renames(input: ListInput) -> Result<Vec<Operation>, String> {
    let (_, db) = project_connection(&input.project_path)?;
    let mut statement=db.prepare("SELECT id,label,created_at,undone_by FROM batch_operations WHERE target_id=?1 AND label NOT LIKE '撤销：%' ORDER BY rowid DESC LIMIT 50").map_err(|e|e.to_string())?;
    let rows = statement
        .query_map([input.target_id], |row| {
            Ok(Operation {
                id: row.get(0)?,
                label: row.get(1)?,
                created_at: row.get(2)?,
                undone_by: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub fn apply_wiki_rename(input: ApplyInput) -> Result<BatchResult, String> {
    let _serial = guard::SAVES.lock().map_err(|_| "正文保存锁不可用")?;
    let (root, mut db) = project_connection(&input.project_path)?;
    let target = input
        .changes
        .entities
        .iter()
        .find(|e| e.id == input.target_id)
        .ok_or("改名目标不在变更清单中")?;
    if target.before.title == target.after.title {
        return Err("新旧名称相同".into());
    }
    let title = target.after.title.trim();
    if title.is_empty() || title.contains(['[', ']', '\r', '\n']) || title != target.after.title {
        return Err("新名称无效".into());
    }
    let label = format!("Wiki改名：{} → {}", target.before.title, title);
    apply(
        &root,
        &mut db,
        &input.target_id,
        input.changes,
        &label,
        None,
    )
}
#[tauri::command]
pub fn undo_wiki_rename(input: UndoInput) -> Result<BatchResult, String> {
    let _serial = guard::SAVES.lock().map_err(|_| "正文保存锁不可用")?;
    let (root, mut db) = project_connection(&input.project_path)?;
    let (target, label, json, undone): (String, String, String, Option<String>) = db
        .query_row(
            "SELECT target_id,label,changes_json,undone_by FROM batch_operations WHERE id=?1",
            [&input.operation_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .ok_or("改名操作不存在")?;
    if undone.is_some() || label.starts_with("撤销：") {
        return Err("这次操作不能重复撤销".into());
    }
    let mut changes: Changes = serde_json::from_str(&json).map_err(|e| e.to_string())?;
    for doc in &mut changes.documents {
        std::mem::swap(&mut doc.before, &mut doc.after);
    }
    for entity in &mut changes.entities {
        std::mem::swap(&mut entity.before, &mut entity.after);
    }
    apply(
        &root,
        &mut db,
        &target,
        changes,
        &format!("撤销：{label}"),
        Some(&input.operation_id),
    )
}
fn apply(
    root: &Path,
    db: &mut Connection,
    target_id: &str,
    changes: Changes,
    label: &str,
    undo: Option<&str>,
) -> Result<BatchResult, String> {
    let tx = db
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    let mut ids = HashSet::new();
    let mut paths = HashSet::new();
    let timestamp = storage::now();
    let mut journal = storage::batch::Journal {
        id: storage::new_id(),
        files: vec![],
    };
    let mut nodes = Vec::new();
    let mut entities = Vec::new();
    for change in &changes.documents {
        if !ids.insert(("node", change.id.clone())) {
            return Err("正文变更重复".into());
        }
        let node = storage::node_from_id(&tx, &change.id)?.ok_or("正文不存在")?;
        if node.deleted_at.is_some() || node.kind == "volume" {
            return Err("正文不可修改".into());
        }
        manuscript::ensure_body_unlocked(&tx, &node.id)?;
        let path = storage::safe_relative(root, &node.file_path)?;
        if !paths.insert(path.clone()) {
            return Err("资料文件路径重复".into());
        }
        let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        if storage::strip_markdown_frontmatter(&raw) != change.before {
            return Err(format!("正文已变化，请重新预览：{}", node.title));
        }
        let after = storage::markdown_node(
            &node.id,
            &node.kind,
            node.parent_id.as_deref(),
            &node.status,
            &node.created_at,
            &timestamp,
            &change.after,
        );
        journal.files.push(storage::batch::FileChange {
            path: node.file_path.clone(),
            before: Some(raw),
            after,
        });
        nodes.push(node);
    }
    for change in &changes.entities {
        if !ids.insert(("entity", change.id.clone())) {
            return Err("资料变更重复".into());
        }
        let entity = storage::entity_from_id(&tx, &change.id)?.ok_or("资料不存在")?;
        if entity.deleted_at.is_some() || EntityState::from(&entity) != change.before {
            return Err(format!("资料已变化，请重新预览：{}", entity.title));
        }
        if change.after.title.trim().is_empty() || !change.after.content.is_object() {
            return Err("资料格式无效".into());
        }
        if entity.id != target_id && change.before.title != change.after.title {
            return Err("只能修改目标资料的名称".into());
        }
        let binary = storage::safe_relative(root, &entity.file_path)?;
        let path = if entity.kind == "attachment" {
            entities::attachment_mirror_path(root, &binary)?
        } else {
            binary
        };
        if !paths.insert(path.clone()) {
            return Err("资料文件路径重复".into());
        }
        let raw = if path.exists() {
            Some(fs::read_to_string(&path).map_err(|e| e.to_string())?)
        } else {
            None
        };
        let after = storage::markdown_entity_with_metadata(
            &entity.id,
            &entity.kind,
            &entity.created_at,
            &timestamp,
            &change.after.title,
            &change.after.content,
            &change.after.tags,
        );
        journal.files.push(storage::batch::FileChange {
            path: path
                .strip_prefix(root)
                .map_err(|e| e.to_string())?
                .to_string_lossy()
                .replace('\\', "/"),
            before: raw,
            after,
        });
        entities.push(entity);
    }
    let target = changes
        .entities
        .iter()
        .find(|e| e.id == target_id)
        .ok_or("改名目标缺失")?;
    if undo.is_none()
        && storage::all_entities(&tx, false)?.iter().any(|e| {
            e.id != target_id
                && e.title.trim().to_lowercase() == target.after.title.trim().to_lowercase()
        })
    {
        return Err("目标名称已被其他资料使用".into());
    }
    if undo.is_none()
        && (!changes.documents.is_empty() || changes.entities.iter().any(|e| e.id != target_id))
        && storage::all_entities(&tx, false)?.iter().any(|e| {
            e.id != target_id
                && e.title.trim().to_lowercase() == target.before.title.trim().to_lowercase()
        })
    {
        return Err("原名称存在同名资料，请重新预览并消除歧义".into());
    }
    if let Some(undo) = undo {
        let undone: Option<String> = tx
            .query_row(
                "SELECT undone_by FROM batch_operations WHERE id=?1",
                [undo],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        if undone.is_some() {
            return Err("操作已撤销".into());
        }
    }
    storage::batch::prepare(root, &journal)?;
    let result = (|| -> Result<(), String> {
        for (node, change) in nodes.iter().zip(&changes.documents) {
            manuscript::create_content_snapshot(
                root,
                &tx,
                &node.id,
                &change.before,
                &format!("{label}之前"),
            )?;
            tx.execute(
                "UPDATE nodes SET updated_at=?1 WHERE id=?2",
                params![timestamp, node.id],
            )
            .map_err(|e| e.to_string())?;
            storage::index_record(
                &tx,
                &node.id,
                &node.kind,
                &node.title,
                &change.after,
                &node.file_path,
            )?;
        }
        for (entity, change) in entities.iter().zip(&changes.entities) {
            entity_history::record(
                &tx,
                &entity.id,
                &entity.kind,
                &format!("{label}之前"),
                &change.before,
                false,
            )?;
            tx.execute("UPDATE entities SET title=?1,content_json=?2,tags_json=?3,updated_at=?4 WHERE id=?5",params![change.after.title,change.after.content.to_string(),serde_json::to_string(&change.after.tags).map_err(|e|e.to_string())?,timestamp,entity.id]).map_err(|e|e.to_string())?;
            storage::index_record(
                &tx,
                &entity.id,
                &entity.kind,
                &change.after.title,
                &storage::markdown_entity(
                    &change.after.title,
                    &change.after.content,
                    &change.after.tags,
                ),
                &entity.file_path,
            )?;
            entity_history::record(&tx, &entity.id, &entity.kind, label, &change.after, false)?;
        }
        tx.execute("INSERT INTO batch_operations(id,target_id,label,created_at,changes_json) VALUES(?1,?2,?3,?4,?5)",params![journal.id,target_id,label,timestamp,serde_json::to_string(&changes).map_err(|e|e.to_string())?]).map_err(|e|e.to_string())?;
        if let Some(undo) = undo {
            tx.execute(
                "UPDATE batch_operations SET undone_by=?1 WHERE id=?2",
                params![journal.id, undo],
            )
            .map_err(|e| e.to_string())?;
        }
        for file in &journal.files {
            storage::atomic_write(
                &storage::safe_relative(root, &file.path)?,
                file.after.as_bytes(),
            )?;
            #[cfg(test)]
            if FAIL_FILE_WRITE.with(|flag| flag.replace(false)) {
                return Err("injected file failure".into());
            }
        }
        Ok(())
    })();
    if let Err(error) = result {
        let restored = storage::batch::rollback(root, &journal);
        if restored.is_ok() {
            let _ =
                storage::remove_file_if_exists(&storage::batch::journal_path(root, &journal.id)?);
        }
        return Err(match restored {
            Ok(()) => error,
            Err(rollback) => format!("{error}；回滚未完成：{rollback}"),
        });
    }
    // Commit failures leave the durable journal for recovery on the next open.
    tx.commit()
        .map_err(|e| format!("批量事务提交失败，已保留恢复日志：{e}"))?;
    let _ = storage::remove_file_if_exists(&storage::batch::journal_path(root, &journal.id)?);
    touch_project_best_effort(root, "project_metadata_touch_failed");
    Ok(BatchResult {
        data: project_data(root, db)?,
        operation_id: journal.id,
    })
}

#[cfg(test)]
thread_local! { static FAIL_FILE_WRITE: std::cell::Cell<bool> = const { std::cell::Cell::new(false) }; }

#[cfg(test)]
mod tests {
    use super::*;
    struct Fixture {
        root: PathBuf,
        data: ProjectData,
    }
    impl Fixture {
        fn new() -> Self {
            let root =
                std::env::temp_dir().join(format!("novelforge-wiki-batch-{}", storage::new_id()));
            fs::create_dir_all(&root).unwrap();
            let path = root.to_string_lossy().into_owned();
            create_project(ProjectInput {
                path: path.clone(),
                title: "改名测试".into(),
                author: "".into(),
                description: "".into(),
                genre: "".into(),
                target_words: 1000,
            })
            .unwrap();
            let data = upsert_entity(EntityInput {
                project_path: path,
                id: Some("person".into()),
                kind: "character".into(),
                title: "旧名".into(),
                content: serde_json::json!({"description":"人物资料"}),
                tags: vec![],
            })
            .unwrap();
            Self { root, data }
        }
        fn path(&self) -> String {
            self.root.to_string_lossy().into_owned()
        }
        fn changes(&self) -> Changes {
            let chapter = self
                .data
                .nodes
                .iter()
                .find(|n| n.kind == "chapter")
                .unwrap();
            let raw = fs::read_to_string(self.root.join(&chapter.file_path)).unwrap();
            let before = storage::strip_markdown_frontmatter(&raw);
            let entity = self
                .data
                .entities
                .iter()
                .find(|e| e.id == "person")
                .unwrap();
            let state = EntityState::from(entity);
            let mut after = state.clone();
            after.title = "新名".into();
            after.content["alias"] = serde_json::json!("旧名");
            Changes {
                documents: vec![DocumentChange {
                    id: chapter.id.clone(),
                    before,
                    after: "[[新名]]正文".into(),
                }],
                entities: vec![EntityChange {
                    id: entity.id.clone(),
                    before: state,
                    after,
                }],
            }
        }
        fn apply(&self, changes: Changes) -> Result<BatchResult, String> {
            apply_wiki_rename(ApplyInput {
                project_path: self.path(),
                target_id: "person".into(),
                changes,
            })
        }
        fn body(&self) -> String {
            let chapter = self
                .data
                .nodes
                .iter()
                .find(|n| n.kind == "chapter")
                .unwrap();
            storage::strip_markdown_frontmatter(
                &fs::read_to_string(self.root.join(&chapter.file_path)).unwrap(),
            )
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = guard::release_project(self.path());
            let _ = fs::remove_dir_all(&self.root);
        }
    }
    #[test]
    fn batch_preserves_history_and_undo_restores_every_record() {
        let f = Fixture::new();
        let changes = f.changes();
        let before = changes.documents[0].before.clone();
        let result = f.apply(changes).unwrap();
        assert_eq!(f.body(), "[[新名]]正文");
        assert!(result
            .data
            .entities
            .iter()
            .any(|e| e.id == "person" && e.title == "新名"));
        let versions =
            entity_history::list_entity_history(entity_history::ListEntityHistoryInput {
                project_path: f.path(),
                entity_id: "person".into(),
                before_id: None,
            })
            .unwrap();
        assert!(versions.iter().any(|v| v.state.title == "旧名"));
        assert!(versions.iter().any(|v| v.state.title == "新名"));
        let restored = undo_wiki_rename(UndoInput {
            project_path: f.path(),
            operation_id: result.operation_id.clone(),
        })
        .unwrap();
        assert_eq!(f.body(), before);
        assert!(restored
            .data
            .entities
            .iter()
            .any(|e| e.id == "person" && e.title == "旧名"));
        assert!(undo_wiki_rename(UndoInput {
            project_path: f.path(),
            operation_id: result.operation_id
        })
        .is_err());
        let ops = list_wiki_renames(ListInput {
            project_path: f.path(),
            target_id: "person".into(),
        })
        .unwrap();
        assert_eq!(ops.len(), 1);
        assert!(ops[0].undone_by.is_some());
    }
    #[test]
    fn stale_preview_and_later_edits_cannot_be_overwritten() {
        let f = Fixture::new();
        let changes = f.changes();
        let before = f.body();
        let mut stale = changes.clone();
        stale.documents[0].before = "wrong".into();
        assert!(f.apply(stale).is_err());
        assert_eq!(f.body(), before);
        let result = f.apply(changes).unwrap();
        let chapter = f.data.nodes.iter().find(|n| n.kind == "chapter").unwrap();
        fs::write(f.root.join(&chapter.file_path), "作者后续新稿").unwrap();
        assert!(undo_wiki_rename(UndoInput {
            project_path: f.path(),
            operation_id: result.operation_id
        })
        .is_err());
        assert_eq!(f.body(), "作者后续新稿");
        assert_eq!(
            open_project(f.path())
                .unwrap()
                .entities
                .iter()
                .find(|e| e.id == "person")
                .unwrap()
                .title,
            "新名"
        );
    }
    #[test]
    fn file_failure_rolls_back_all_mirrors_database_and_history() {
        let f = Fixture::new();
        let changes = f.changes();
        let originals: Vec<_> = f
            .data
            .nodes
            .iter()
            .filter(|n| n.kind != "volume")
            .map(|n| {
                (
                    n.file_path.clone(),
                    fs::read(f.root.join(&n.file_path)).unwrap(),
                )
            })
            .collect();
        FAIL_FILE_WRITE.with(|flag| flag.set(true));
        assert!(f.apply(changes).unwrap_err().contains("injected"));
        for (path, bytes) in originals {
            assert_eq!(fs::read(f.root.join(path)).unwrap(), bytes);
        }
        let data = open_project(f.path()).unwrap();
        assert_eq!(
            data.entities
                .iter()
                .find(|e| e.id == "person")
                .unwrap()
                .title,
            "旧名"
        );
        assert!(list_wiki_renames(ListInput {
            project_path: f.path(),
            target_id: "person".into()
        })
        .unwrap()
        .is_empty());
    }
    #[test]
    fn locked_ancestor_collision_and_duplicate_inputs_fail_without_writes() {
        let f = Fixture::new();
        let changes = f.changes();
        let db = storage::open_db(&f.root).unwrap();
        let volume = f.data.nodes.iter().find(|n| n.kind == "volume").unwrap();
        db.execute("UPDATE nodes SET status='locked' WHERE id=?1", [&volume.id])
            .unwrap();
        assert!(f.apply(changes.clone()).is_err());
        db.execute(
            "UPDATE nodes SET status='not-started' WHERE id=?1",
            [&volume.id],
        )
        .unwrap();
        let mut duplicate = changes.clone();
        duplicate.documents.push(duplicate.documents[0].clone());
        assert!(f.apply(duplicate).is_err());
        upsert_entity(EntityInput {
            project_path: f.path(),
            id: Some("other".into()),
            kind: "location".into(),
            title: "新名".into(),
            content: serde_json::json!({}),
            tags: vec![],
        })
        .unwrap();
        assert!(f.apply(changes.clone()).is_err());
        assert_eq!(f.body(), changes.documents[0].before);
    }
    #[test]
    fn interrupted_transaction_recovers_on_open_and_preserves_external_conflicts() {
        let f = Fixture::new();
        let change = f.changes().documents.remove(0);
        let node = f.data.nodes.iter().find(|n| n.id == change.id).unwrap();
        let path = f.root.join(&node.file_path);
        let raw = fs::read_to_string(&path).unwrap();
        let journal = storage::batch::Journal {
            id: storage::new_id(),
            files: vec![storage::batch::FileChange {
                path: node.file_path.clone(),
                before: Some(raw.clone()),
                after: "途中内容".into(),
            }],
        };
        storage::batch::prepare(&f.root, &journal).unwrap();
        fs::write(&path, "途中内容").unwrap();
        open_project(f.path()).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), raw);
        assert!(!storage::batch::journal_path(&f.root, &journal.id)
            .unwrap()
            .exists());
        storage::batch::prepare(&f.root, &journal).unwrap();
        fs::write(&path, "外部修改").unwrap();
        assert!(open_project(f.path())
            .unwrap_err()
            .starts_with("BATCH_RECOVERY:"));
        assert_eq!(fs::read_to_string(&path).unwrap(), "外部修改");
        assert!(f.root.join(".novelforge/database.sqlite").exists());
    }
}
