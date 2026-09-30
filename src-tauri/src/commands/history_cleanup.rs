use super::*;
#[tauri::command]
pub fn preview_history_cleanup(path: String) -> Result<storage::history_cleanup::Preview, String> {
    let (root, db) = project_connection(&path)?;
    storage::history_cleanup::preview(&root, &db)
}
#[tauri::command]
pub fn apply_history_cleanup(
    path: String,
    fingerprint: String,
) -> Result<storage::history_cleanup::Preview, String> {
    let _guard = guard::SAVES.lock().map_err(|_| "HISTORY_LOCK")?;
    let (root, mut db) = project_connection(&path)?;
    storage::history_cleanup::apply(&root, &mut db, &fingerprint)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cleaned_project_still_backs_up_and_keeps_recovery_and_committed_batch_evidence() {
        let root =
            std::env::temp_dir().join(format!("nf-history-integration-{}", storage::new_id()));
        let data = create_project(ProjectInput {
            path: root.to_string_lossy().into(),
            title: "清理合成项目".into(),
            author: String::new(),
            description: String::new(),
            genre: String::new(),
            target_words: 1,
        })
        .unwrap();
        let node = data.nodes.iter().find(|n| n.kind == "chapter").unwrap();
        let path = root.to_string_lossy().to_string();
        let mut db = storage::open_db(&root).unwrap();
        for (id, reason) in [
            ("automatic-old", "自动保存"),
            ("named", "命名版本：保留"),
            ("protected", "操作前保护：保留"),
        ] {
            let file = storage::copy_history(&root, &node.id, id, id).unwrap();
            db.execute(
                "INSERT INTO revisions VALUES(?1,?2,'正文',?3,1,'time',?4)",
                params![id, node.id, reason, file],
            )
            .unwrap();
        }
        let marker = storage::new_id();
        db.execute(
            "INSERT INTO batch_operations VALUES(?1,'node','keep','time','[]',NULL)",
            [&marker],
        )
        .unwrap();
        storage::batch::prepare(
            &root,
            &storage::batch::Journal {
                id: marker.clone(),
                files: vec![],
            },
        )
        .unwrap();
        let (_, rescue) = storage::write_recovery(&root, &node.id, "未保存救援正文").unwrap();
        let before = storage::history_cleanup::preview(&root, &db).unwrap();
        storage::history_cleanup::apply(&root, &mut db, &before.fingerprint).unwrap();
        assert_eq!(
            db.query_row(
                "SELECT COUNT(*) FROM batch_operations WHERE id=?1",
                [&marker],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            1
        );
        drop(db);
        let db = storage::open_db(&root).unwrap();
        assert_eq!(
            db.query_row(
                "SELECT COUNT(*) FROM batch_operations WHERE id=?1",
                [&marker],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            1
        );
        drop(db);
        assert_eq!(fs::read_to_string(rescue).unwrap(), "未保存救援正文");
        let out = std::env::temp_dir().join(format!("nf-cleanup-backups-{}", storage::new_id()));
        fs::create_dir_all(&out).unwrap();
        let report = backup::create(path.clone(), out.to_string_lossy().into()).unwrap();
        assert!(Path::new(&report.path).is_file());
        guard::release_project(path).unwrap();
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(out).unwrap();
    }
}
