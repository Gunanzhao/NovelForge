use super::storage_impl as storage;
use std::fs;

fn test_root(name: &str) -> std::path::PathBuf {
    let root = std::env::temp_dir().join(format!("novelforge-{}-{}", name, storage::new_id()));
    fs::create_dir_all(&root).expect("test directory should be creatable");
    root
}

#[test]
fn atomic_write_replaces_without_partial_content() {
    let root = test_root("atomic");
    let target = root.join("chapter.md");
    storage::atomic_write(&target, "第一版".as_bytes()).expect("first write");
    storage::atomic_write(&target, "第二版，更长的正文".as_bytes()).expect("replacement write");
    assert_eq!(fs::read_to_string(&target).expect("read target"), "第二版，更长的正文");
    assert!(storage::safe_relative(&root, "../outside.md").is_err());
    let _ = fs::remove_dir_all(root);
}

#[test]
fn database_initializes_fts5_and_project_directories() {
    let root = test_root("database");
    storage::create_project_directories(&root).expect("project directories");
    let connection = storage::open_db(&root).expect("database");
    let fts_name: String = connection
        .query_row("SELECT name FROM sqlite_master WHERE name = 'search_index'", [], |row| row.get(0))
        .expect("fts5 table");
    assert_eq!(fts_name, "search_index");
    assert!(root.join(".novelforge/database.sqlite").is_file());
    let _ = fs::remove_dir_all(root);
}

#[test]
fn entity_markdown_keeps_human_readable_mirror() {
    let content = serde_json::json!({ "identity": "灯塔守夜人", "description": "熟悉潮汐。" });
    let markdown = storage::markdown_entity("林月", &content, &["主角".to_string()]);
    assert!(markdown.contains("# 林月"));
    assert!(markdown.contains("标签：主角"));
    assert!(markdown.contains("灯塔守夜人"));
    assert!(markdown.contains("熟悉潮汐。"));
}

#[test]
fn real_command_workflow_persists_markdown_and_recoverable_trash() {
    let root = test_root("command-workflow");
    let project_path = root.join("雾港来信").to_string_lossy().to_string();
    let created = super::commands::create_project(super::models::ProjectInput {
        path: project_path.clone(),
        title: "雾港来信".to_string(),
        author: "Rust 测试".to_string(),
        description: "command workflow".to_string(),
        genre: "现代".to_string(),
        target_words: 5000,
    }).expect("create project");
    let chapter = created.nodes.iter().find(|node| node.kind == "chapter").expect("chapter").clone();
    let saved = super::commands::save_document(super::models::SaveDocumentInput {
        project_path: project_path.clone(),
        node_id: chapter.id.clone(),
        content: "# 第一章\n\n林月走进雾港。".to_string(),
        reason: "集成测试".to_string(),
    }).expect("save document");
    assert!(saved.content.contains("雾港"));
    let _ = super::commands::upsert_entity(super::models::EntityInput {
        project_path: project_path.clone(), kind: "character".to_string(), id: None,
        title: "林月".to_string(), content: serde_json::json!({"status": "活动"}), tags: vec!["主角".to_string()],
    }).expect("save entity");
    let results = super::commands::search_project(super::models::SearchInput {
        project_path: project_path.clone(), query: "雾港".to_string(), kind: None,
    }).expect("search project");
    assert!(results.iter().any(|result| result.id == chapter.id));
    let after_delete = super::commands::delete_node(super::models::NodeActionInput {
        project_path: project_path.clone(), node_id: chapter.id.clone(),
    }).expect("delete node");
    assert!(!after_delete.nodes.iter().any(|node| node.id == chapter.id));
    let trash = super::commands::list_trash(project_path.clone()).expect("list trash");
    let trash_id = trash.iter().find(|item| item.ref_id == chapter.id).expect("trash item").id.clone();
    let restored = super::commands::restore_trash(super::models::NodeActionInput {
        project_path: project_path.clone(), node_id: trash_id,
    }).expect("restore node");
    assert!(restored.nodes.iter().any(|node| node.id == chapter.id));
    let reopened = super::commands::open_project(project_path).expect("reopen project");
    assert_eq!(reopened.project.title, "雾港来信");
    let _ = fs::remove_dir_all(root);
}

#[test]
fn trash_path_must_stay_inside_project() {
    let root = test_root("trash-boundary");
    storage::create_project_directories(&root).expect("project directories");
    let outside = root.parent().expect("temporary parent").join(format!("novelforge-outside-{}", storage::new_id()));
    fs::create_dir_all(&outside).expect("outside directory");
    let sentinel = outside.join("sentinel.txt");
    fs::write(&sentinel, "do not delete").expect("sentinel");
    let inside = root.join("trash/items/inside.md");
    fs::create_dir_all(inside.parent().expect("trash item parent")).expect("trash items directory");
    fs::write(&inside, "trash").expect("trash item");

    assert!(storage::safe_trash_path(&root, &sentinel.to_string_lossy()).is_err());
    assert_eq!(
        storage::safe_trash_path(&root, &inside.to_string_lossy()).expect("inside path"),
        fs::canonicalize(&inside).expect("canonical inside path")
    );
    assert_eq!(fs::read_to_string(&sentinel).expect("sentinel remains"), "do not delete");
    let _ = fs::remove_dir_all(root);
    let _ = fs::remove_dir_all(outside);
}

#[test]
fn node_delete_restores_file_when_database_transaction_fails() {
    let root = test_root("delete-rollback");
    let project_path = root.join("project").to_string_lossy().to_string();
    let created = super::commands::create_project(super::models::ProjectInput {
        path: project_path.clone(),
        title: "回滚测试".to_string(),
        author: "测试".to_string(),
        description: String::new(),
        genre: "现代".to_string(),
        target_words: 1000,
    }).expect("create project");
    let chapter = created.nodes.iter().find(|node| node.kind == "chapter").expect("chapter").clone();
    let chapter_path = root.join("project").join(&chapter.file_path);
    let original = fs::read_to_string(&chapter_path).expect("chapter content");
    {
        let connection = storage::open_db(&root.join("project")).expect("database");
        connection.execute_batch(
            "CREATE TRIGGER fail_trash BEFORE INSERT ON trash_items BEGIN SELECT RAISE(ABORT, 'test failure'); END;"
        ).expect("failure trigger");
    }

    let result = super::commands::delete_node(super::models::NodeActionInput {
        project_path: project_path.clone(),
        node_id: chapter.id.clone(),
    });
    assert!(result.is_err());
    assert_eq!(fs::read_to_string(&chapter_path).expect("restored chapter"), original);
    let reopened = super::commands::open_project(project_path).expect("reopen project");
    let restored = reopened.nodes.iter().find(|node| node.id == chapter.id).expect("restored node");
    assert!(restored.deleted_at.is_none());
    assert!(reopened.recovery.is_empty());
    let _ = fs::remove_dir_all(root);
}

#[test]
fn permanent_delete_rejects_external_database_path() {
    let root = test_root("permanent-boundary");
    let project_path = root.join("project").to_string_lossy().to_string();
    super::commands::create_project(super::models::ProjectInput {
        path: project_path.clone(),
        title: "路径测试".to_string(),
        author: "测试".to_string(),
        description: String::new(),
        genre: "现代".to_string(),
        target_words: 1000,
    }).expect("create project");
    let outside = root.parent().expect("temporary parent").join(format!("novelforge-external-{}", storage::new_id()));
    fs::create_dir_all(&outside).expect("external directory");
    let sentinel = outside.join("sentinel.txt");
    fs::write(&sentinel, "keep").expect("external sentinel");
    {
        let connection = storage::open_db(&root.join("project")).expect("database");
        connection.execute(
            "INSERT INTO trash_items (id, ref_id, ref_kind, title, original_path, trash_path, deleted_at) VALUES (?1, ?2, 'entity', 'fake', 'notes/fake.md', ?3, ?4)",
            rusqlite::params!["trash-id", "entity-id", outside.to_string_lossy(), storage::now()],
        ).expect("malicious trash record");
    }

    let result = super::commands::permanent_delete(super::models::NodeActionInput {
        project_path,
        node_id: "trash-id".to_string(),
    });
    assert!(result.is_err());
    assert_eq!(fs::read_to_string(&sentinel).expect("external sentinel remains"), "keep");
    let _ = fs::remove_dir_all(root);
    let _ = fs::remove_dir_all(outside);
}