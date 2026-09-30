use super::*;
use storage::errors::{sqlite_code, StorageError};
fn fixture() -> (PathBuf, ProjectData) {
    let root = std::env::temp_dir().join(format!("nf-conservative-{}", storage::new_id()));
    let data = create_project(ProjectInput {
        path: root.to_string_lossy().into(),
        title: "恢复测试".into(),
        author: String::new(),
        description: String::new(),
        genre: String::new(),
        target_words: 100,
    })
    .unwrap();
    (root, data)
}
fn dispose(root: PathBuf) {
    guard::release_project(root.to_string_lossy().into()).unwrap();
    fs::remove_dir_all(root).unwrap();
}
#[test]
fn future_format_and_schema_are_refused_without_any_database_or_metadata_write() {
    for format in [false, true] {
        let (root, _) = fixture();
        let db = root.join(".novelforge/database.sqlite");
        let metadata = root.join("project.json");
        if format {
            let mut value: serde_json::Value =
                serde_json::from_slice(&fs::read(&metadata).unwrap()).unwrap();
            value["formatVersion"] = serde_json::json!(999);
            fs::write(&metadata, serde_json::to_vec(&value).unwrap()).unwrap();
        } else {
            let c = Connection::open(&db).unwrap();
            c.pragma_update(None, "user_version", 999).unwrap();
        }
        let before = fs::read(&db).unwrap();
        let original = fs::read(&metadata).unwrap();
        let error = open_project(root.to_string_lossy().into()).unwrap_err();
        assert!(error.starts_with(if format {
            "PROJECT_FORMAT:"
        } else {
            "SCHEMA_VERSION:"
        }));
        assert!(before == fs::read(&db).unwrap());
        assert_eq!(original, fs::read(&metadata).unwrap());
        assert!(!root.join(".novelforge/session.lock").exists());
        dispose(root);
    }
}
#[test]
fn legacy_schema_zero_migrates_but_current_schema_does_not_rewrite_header() {
    let (root, _) = fixture();
    let db = root.join(".novelforge/database.sqlite");
    {
        let c = Connection::open(&db).unwrap();
        c.pragma_update(None, "user_version", 0).unwrap();
    }
    let c = storage::open_db(&root).unwrap();
    assert_eq!(
        c.pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))
            .unwrap(),
        1
    );
    drop(c);
    let before = fs::read(&db).unwrap();
    drop(storage::open_db(&root).unwrap());
    assert!(before == fs::read(db).unwrap());
    dispose(root);
}
#[test]
fn temporary_errors_are_typed_and_healthy_database_is_not_quarantined() {
    let (root, _) = fixture();
    let db = root.join(".novelforge/database.sqlite");
    let before = fs::read(&db).unwrap();
    let c = Connection::open(&db).unwrap();
    c.execute_batch("BEGIN EXCLUSIVE").unwrap();
    let error = open_project(root.to_string_lossy().into()).unwrap_err();
    assert!(error.starts_with("STORAGE_BUSY:"));
    c.execute_batch("ROLLBACK").unwrap();
    drop(c);
    assert!(before == fs::read(&db).unwrap());
    assert!(!fs::read_dir(root.join(".novelforge"))
        .unwrap()
        .filter_map(Result::ok)
        .any(|e| e.file_name().to_string_lossy().contains("corrupt")));
    let readonly =
        Connection::open_with_flags(&db, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
    assert_eq!(
        sqlite_code(&readonly.execute("DELETE FROM nodes", []).unwrap_err()),
        "STORAGE_READ_ONLY"
    );
    drop(readonly);
    let memory = Connection::open_in_memory().unwrap();
    memory
        .execute_batch("PRAGMA max_page_count=2; CREATE TABLE full(x BLOB);")
        .unwrap();
    assert_eq!(
        sqlite_code(
            &memory
                .execute("INSERT INTO full VALUES(zeroblob(1000000))", [])
                .unwrap_err()
        ),
        "STORAGE_FULL"
    );
    assert!(
        StorageError::Io(std::io::Error::from(std::io::ErrorKind::PermissionDenied))
            .to_string()
            .starts_with("STORAGE_PERMISSION:")
    );
    assert!(
        StorageError::Io(std::io::Error::from(std::io::ErrorKind::Other))
            .to_string()
            .starts_with("STORAGE_IO:")
    );
    dispose(root);
}
#[test]
fn bad_journals_remain_unresolved_across_reopen_and_allow_read_only_rescue() {
    for mode in ["truncated", "id", "external", "committed-external"] {
        let (root, data) = fixture();
        let node = data.nodes.iter().find(|n| n.kind == "chapter").unwrap();
        let id = storage::new_id();
        let journal = storage::batch::Journal {
            id: id.clone(),
            files: vec![storage::batch::FileChange {
                path: node.file_path.clone(),
                before: Some("before".into()),
                after: "after".into(),
            }],
        };
        storage::batch::prepare(&root, &journal).unwrap();
        let path = storage::batch::journal_path(&root, &id).unwrap();
        if mode == "truncated" {
            fs::write(&path, "{\"id\":").unwrap();
        }
        if mode == "id" {
            let mut value = serde_json::to_value(&journal).unwrap();
            value["id"] = serde_json::json!(storage::new_id());
            fs::write(&path, serde_json::to_vec(&value).unwrap()).unwrap();
        }
        if mode == "committed-external" {
            let c = Connection::open(root.join(".novelforge/database.sqlite")).unwrap();
            c.execute(
                "INSERT INTO batch_operations VALUES(?1,'x','x','x','[]',NULL)",
                [&id],
            )
            .unwrap();
        }
        let original = fs::read(&path).unwrap();
        let body = fs::read(root.join(&node.file_path)).unwrap();
        for _ in 0..2 {
            assert!(open_project(root.to_string_lossy().into())
                .unwrap_err()
                .starts_with("BATCH_RECOVERY:"));
        }
        assert_eq!(fs::read(&path).unwrap(), original);
        assert_eq!(fs::read(root.join(&node.file_path)).unwrap(), body);
        let rescue = rescue::inspect_project_rescue(root.to_string_lossy().into()).unwrap();
        assert!(rescue.unresolved);
        assert!(!rescue.files.is_empty());
        assert!(rescue::verify_project_recovery(root.to_string_lossy().into()).is_err());
        dispose(root);
    }
}
#[test]
fn n4_connection_recovery_measurement_empty_active_and_crashed() {
    let (root, _) = fixture();
    fs::create_dir_all(root.join(".novelforge/batch-journal")).unwrap();
    for mode in ["empty", "active", "crashed"] {
        let mut samples = Vec::new();
        for _ in 0..5 {
            let id = storage::new_id();
            let worker = if mode == "active" {
                let (send, receive) = std::sync::mpsc::channel();
                let owned = root.clone();
                let live_id = id.clone();
                let worker = std::thread::spawn(move || {
                    let c = Connection::open(owned.join(".novelforge/database.sqlite")).unwrap();
                    c.execute_batch("BEGIN IMMEDIATE").unwrap();
                    storage::batch::prepare(
                        &owned,
                        &storage::batch::Journal {
                            id: live_id.clone(),
                            files: vec![],
                        },
                    )
                    .unwrap();
                    c.execute(
                        "INSERT INTO batch_operations VALUES(?1,'n4','active','time','[]',NULL)",
                        [&live_id],
                    )
                    .unwrap();
                    send.send(()).unwrap();
                    std::thread::sleep(std::time::Duration::from_millis(80));
                    c.execute_batch("COMMIT").unwrap();
                });
                receive.recv().unwrap();
                Some(worker)
            } else {
                None
            };
            if mode == "crashed" {
                storage::batch::prepare(&root, &storage::batch::Journal { id, files: vec![] })
                    .unwrap();
            }
            let start = std::time::Instant::now();
            let (_, c) = project_connection(&root.to_string_lossy()).unwrap();
            storage::all_nodes(&c, false).unwrap();
            samples.push(start.elapsed().as_micros());
            drop(c);
            if let Some(worker) = worker {
                worker.join().unwrap();
            }
        }
        println!("N4 {mode}: 5 normal project_connection+node reads, one schema call/one recover/one Immediate per read; microseconds={samples:?}");
    }
    dispose(root);
}

#[test]
fn verified_journal_can_unlock_but_missing_evidence_cannot() {
    let (root, _) = fixture();
    let id = storage::new_id();
    let path = storage::batch::journal_path(&root, &id).unwrap();
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(&path, "{").unwrap();
    assert!(open_project(root.to_string_lossy().into()).is_err());
    // Repair only this synthetic fixture to a verifiable no-op journal.
    storage::batch::prepare(
        &root,
        &storage::batch::Journal {
            id: id.clone(),
            files: vec![],
        },
    )
    .unwrap();
    rescue::verify_project_recovery(root.to_string_lossy().into()).unwrap();
    assert!(!root.join(".novelforge/recovery-state.json").exists());
    open_project(root.to_string_lossy().into()).unwrap();
    fs::write(&path, "{").unwrap();
    assert!(open_project(root.to_string_lossy().into()).is_err());
    fs::remove_file(&path).unwrap();
    assert!(
        rescue::verify_project_recovery(root.to_string_lossy().into())
            .unwrap_err()
            .starts_with("RECOVERY_EVIDENCE:")
    );
    assert!(open_project(root.to_string_lossy().into()).is_err());
    dispose(root);
}
