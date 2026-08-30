use super::storage_impl as storage;
use std::fs;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::thread;

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
    let status_data = super::commands::set_node_status(super::commands::NodeStatusInput {
        project_path: project_path.clone(), node_id: chapter.id.clone(), status: "first-draft".to_string(),
    }).expect("set first-draft status");
    assert_eq!(status_data.nodes.iter().find(|node| node.id == chapter.id).expect("status chapter").status, "first-draft");
    let saved = super::commands::save_document(super::models::SaveDocumentInput {
        project_path: project_path.clone(),
        node_id: chapter.id.clone(),
        content: "# 第一章\n\n林月走进雾港，[[林月]]留下线索。".to_string(),
        reason: "集成测试".to_string(),
    }).expect("save document");
    assert!(saved.content.contains("雾港"));
    let _ = super::commands::upsert_entity(super::models::EntityInput {
        project_path: project_path.clone(), kind: "character".to_string(), id: None,
        title: "林月".to_string(), content: serde_json::json!({"status": "活动"}), tags: vec!["主角".to_string()],
    }).expect("save entity");
    let wiki_results = super::commands::search_project(super::models::SearchInput {
        project_path: project_path.clone(), query: "[[林月]]".to_string(), kind: Some("manuscript".to_string()),
        scope: None, node_id: None, volume_path: None, tag: None, case_sensitive: None,
    }).expect("search wiki reference");
    assert!(wiki_results.iter().any(|result| result.id == chapter.id));
    let results = super::commands::search_project(super::models::SearchInput {
        project_path: project_path.clone(), query: "雾港".to_string(), kind: None,
        scope: None, node_id: None, volume_path: None, tag: None, case_sensitive: None,
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
    let _ = super::commands::delete_node(super::models::NodeActionInput {
        project_path: project_path.clone(), node_id: chapter.id.clone(),
    }).expect("delete again");
    let emptied = super::commands::empty_trash(project_path.clone()).expect("empty trash");
    assert!(!emptied.nodes.iter().any(|node| node.id == chapter.id));
    assert!(super::commands::list_trash(project_path.clone()).expect("list emptied trash").is_empty());
    let reopened = super::commands::open_project(project_path).expect("reopen project");
    assert_eq!(reopened.project.title, "雾港来信");
    let _ = fs::remove_dir_all(root);
}

#[test]
fn get_document_surfaces_missing_file_instead_of_returning_empty_content() {
    let root = test_root("missing-document");
    let project_path = root.join("project").to_string_lossy().to_string();
    let created = super::commands::create_project(super::models::ProjectInput {
        path: project_path.clone(), title: "缺失正文测试".to_string(), author: "测试".to_string(),
        description: String::new(), genre: "现代".to_string(), target_words: 1000,
    }).expect("create project");
    let chapter = created.nodes.iter().find(|node| node.kind == "chapter").expect("chapter");
    fs::remove_file(root.join("project").join(&chapter.file_path)).expect("remove chapter file");
    let error = super::commands::get_document(super::models::NodeActionInput {
        project_path, node_id: chapter.id.clone(),
    }).expect_err("missing正文 should be reported");
    assert!(error.contains("读取正文失败"));
    let _ = fs::remove_dir_all(root);
}

#[test]
fn create_and_rename_nodes_roll_back_files_on_database_failure() {
    let root = test_root("node-write-rollback");
    let project_path = root.join("project").to_string_lossy().to_string();
    let created = super::commands::create_project(super::models::ProjectInput {
        path: project_path.clone(), title: "节点回滚测试".to_string(), author: "测试".to_string(),
        description: String::new(), genre: "现代".to_string(), target_words: 1000,
    }).expect("create project");
    let volume = created.nodes.iter().find(|node| node.kind == "volume").expect("volume").clone();
    let _chapter = created.nodes.iter().find(|node| node.kind == "chapter").expect("chapter").clone();
    {
        let connection = storage::open_db(&root.join("project")).expect("database");
        connection.execute_batch("CREATE TRIGGER fail_node_insert BEFORE INSERT ON nodes WHEN NEW.kind = 'chapter' BEGIN SELECT RAISE(ABORT, 'test failure'); END;").expect("insert trigger");
    }
    let create_error = super::commands::create_node(super::models::NodeInput {
        project_path: project_path.clone(), kind: "chapter".to_string(), title: "失败章节".to_string(), parent_id: Some(volume.id.clone()),
    }).expect_err("failed node insert");
    assert!(create_error.contains("写入项目树") || create_error.contains("创建节点"));
    assert!(!root.join("project/manuscript/volume_001/chapter_002.md").exists());
    let _ = fs::remove_file(root.join("project/.novelforge/database.sqlite"));
    let _ = fs::remove_dir_all(root);

    let root = test_root("node-rename-rollback");
    let project_path = root.join("project").to_string_lossy().to_string();
    let created = super::commands::create_project(super::models::ProjectInput {
        path: project_path.clone(), title: "重命名回滚测试".to_string(), author: "测试".to_string(),
        description: String::new(), genre: "现代".to_string(), target_words: 1000,
    }).expect("create project");
    let chapter = created.nodes.iter().find(|node| node.kind == "chapter").expect("chapter").clone();
    let renamed = super::commands::rename_node(super::models::RenameNodeInput {
        project_path: project_path.clone(), node_id: chapter.id.clone(), title: "新标题".to_string(),
    }).expect("rename node");
    assert_eq!(renamed.nodes.iter().find(|node| node.id == chapter.id).expect("renamed chapter").title, "新标题");
    let chapter_path = root.join("project").join(&chapter.file_path);
    let renamed_content = fs::read_to_string(&chapter_path).expect("renamed content");
    assert!(storage::strip_markdown_frontmatter(&renamed_content).starts_with("# 新标题"));
    {
        let connection = storage::open_db(&root.join("project")).expect("database");
        connection.execute_batch("CREATE TRIGGER fail_node_title BEFORE UPDATE OF title ON nodes BEGIN SELECT RAISE(ABORT, 'test failure'); END;").expect("rename trigger");
    }
    assert!(super::commands::rename_node(super::models::RenameNodeInput {
        project_path: project_path.clone(), node_id: chapter.id.clone(), title: "失败标题".to_string(),
    }).is_err());
    let rolled_back_content = fs::read_to_string(&chapter_path).expect("rolled back content");
    assert!(storage::strip_markdown_frontmatter(&rolled_back_content).starts_with("# 新标题"));
    let reopened = super::commands::open_project(project_path).expect("reopen renamed project");
    assert_eq!(reopened.nodes.iter().find(|node| node.id == chapter.id).expect("reopened chapter").title, "新标题");
    let _ = fs::remove_dir_all(root);
}

#[test]
fn entity_upsert_rolls_back_markdown_mirror_on_database_failure() {
    let root = test_root("entity-write-rollback");
    let project_path = root.join("project").to_string_lossy().to_string();
    super::commands::create_project(super::models::ProjectInput {
        path: project_path.clone(), title: "资料写入回滚测试".to_string(), author: "测试".to_string(),
        description: String::new(), genre: "现代".to_string(), target_words: 1000,
    }).expect("create project");
    let created = super::commands::upsert_entity(super::models::EntityInput {
        project_path: project_path.clone(), kind: "character".to_string(), id: None, title: "林月".to_string(),
        content: serde_json::json!({"identity": "旧身份"}), tags: vec!["主角".to_string()],
    }).expect("create entity");
    let entity = created.entities.iter().find(|item| item.title == "林月").expect("entity").clone();
    let mirror = root.join("project").join(&entity.file_path);
    let original = fs::read_to_string(&mirror).expect("original mirror");
    {
        let connection = storage::open_db(&root.join("project")).expect("database");
        connection.execute_batch("CREATE TRIGGER fail_entity_update BEFORE UPDATE ON entities BEGIN SELECT RAISE(ABORT, 'test failure'); END;").expect("entity trigger");
    }
    assert!(super::commands::upsert_entity(super::models::EntityInput {
        project_path: project_path.clone(), kind: "character".to_string(), id: Some(entity.id.clone()), title: "林月".to_string(),
        content: serde_json::json!({"identity": "不应写入"}), tags: vec!["回滚".to_string()],
    }).is_err());
    assert_eq!(fs::read_to_string(&mirror).expect("rolled back mirror"), original);
    let reopened = super::commands::open_project(project_path).expect("reopen entity project");
    let restored = reopened.entities.iter().find(|item| item.id == entity.id).expect("restored entity");
    assert_eq!(restored.content.get("identity").and_then(serde_json::Value::as_str), Some("旧身份"));
    let _ = fs::remove_dir_all(root);
}

#[test]
fn application_logs_are_levelled_and_redacted() {
    let root = test_root("logs");
    storage::create_project_directories(&root).expect("project directories");
    storage::append_log(&root, "INFO", "document_saved").expect("info log");
    storage::append_log(&root, "ERROR", "api_key=super-secret\nfull text").expect("redacted log");
    let logs = storage::read_logs(&root).expect("read logs");
    assert!(logs.contains("[INFO] document_saved"));
    assert!(logs.contains("[ERROR] [REDACTED]"));
    assert!(!logs.contains("super-secret"));
    assert!(storage::append_log(&root, "TRACE", "invalid").is_err());
    let _ = fs::remove_dir_all(root);
}

#[test]
fn opening_corrupt_database_rebuilds_markdown_tree() {
    let root = test_root("database-recovery");
    let project_path = root.join("project").to_string_lossy().to_string();
    let created = super::commands::create_project(super::models::ProjectInput {
        path: project_path.clone(), title: "数据库恢复测试".to_string(), author: "测试".to_string(),
        description: String::new(), genre: "现代".to_string(), target_words: 1000,
    }).expect("create project");
    let chapter = created.nodes.iter().find(|node| node.kind == "chapter").expect("chapter").clone();
    super::commands::save_document(super::models::SaveDocumentInput {
        project_path: project_path.clone(), node_id: chapter.id, content: "# 第一章\n\n数据库损坏后仍应可读。".to_string(), reason: "恢复前".to_string(),
    }).expect("save document");
    super::commands::upsert_entity(super::models::EntityInput {
        project_path: project_path.clone(), kind: "character".to_string(), id: None, title: "林月".to_string(),
        content: serde_json::json!({"identity": "灯塔守夜人", "description": "数据库损坏后资料镜像仍应可恢复。"}), tags: vec!["主角".to_string()],
    }).expect("save character mirror");
    fs::write(root.join("project/.novelforge/database.sqlite"), b"not a sqlite database").expect("corrupt database");

    let reopened = super::commands::open_project(project_path.clone()).expect("open recovered project");
    let recovered = reopened.nodes.iter().find(|node| node.kind == "chapter").expect("recovered chapter").clone();
    let document = super::commands::get_document(super::models::NodeActionInput {
        project_path: project_path.clone(), node_id: recovered.id,
    }).expect("read recovered markdown");
    assert!(document.content.contains("数据库损坏后仍应可读"));
    let recovered_entity = reopened.entities.iter().find(|entity| entity.title == "林月").expect("recovered character");
    assert!(recovered_entity.tags.iter().any(|tag| tag == "主角"));
    assert_eq!(recovered_entity.content.get("identity").and_then(|value| value.as_str()), Some("灯塔守夜人"));
    let backups = fs::read_dir(root.join("project/.novelforge")).expect("read database directory")
        .flatten().filter(|entry| entry.file_name().to_string_lossy().starts_with("database.sqlite.corrupt-")).count();
    assert_eq!(backups, 1);
    let _ = fs::remove_dir_all(root);
}

#[test]
fn corrupt_database_preserves_stable_ids_and_relationships() {
    let root = test_root("stable-id-recovery");
    let project_path = root.join("project").to_string_lossy().to_string();
    let created = super::commands::create_project(super::models::ProjectInput {
        path: project_path.clone(),
        title: "稳定 ID 恢复".to_string(),
        author: "测试".to_string(),
        description: String::new(),
        genre: "科幻".to_string(),
        target_words: 10000,
    })
    .expect("create project");
    let volume = created.nodes.iter().find(|node| node.kind == "volume").expect("volume").clone();
    let chapter = created.nodes.iter().find(|node| node.kind == "chapter").expect("chapter").clone();
    let section_data = super::commands::create_node(super::models::NodeInput {
        project_path: project_path.clone(),
        kind: "section".to_string(),
        title: "港口".to_string(),
        parent_id: Some(chapter.id.clone()),
    })
    .expect("create section");
    let section = section_data.nodes.iter().find(|node| node.kind == "section").expect("section").clone();
    super::commands::save_document(super::models::SaveDocumentInput {
        project_path: project_path.clone(),
        node_id: chapter.id.clone(),
        content: "# 第一章\n\n第一版正文".to_string(),
        reason: "建立恢复历史".to_string(),
    })
    .expect("save first revision");
    super::commands::save_document(super::models::SaveDocumentInput {
        project_path: project_path.clone(),
        node_id: chapter.id.clone(),
        content: "# 第一章\n\n第二版正文".to_string(),
        reason: "建立最新正文".to_string(),
    })
    .expect("save second revision");
    let people = super::commands::upsert_entity(super::models::EntityInput {
        project_path: project_path.clone(),
        kind: "character".to_string(),
        id: None,
        title: "林月".to_string(),
        content: serde_json::json!({"status": "活动"}),
        tags: vec!["主角".to_string()],
    })
    .expect("create first character");
    let person_a = people.entities.iter().find(|entity| entity.title == "林月").expect("person a").clone();
    let people = super::commands::upsert_entity(super::models::EntityInput {
        project_path: project_path.clone(),
        kind: "character".to_string(),
        id: None,
        title: "沈砚".to_string(),
        content: serde_json::json!({"status": "活动"}),
        tags: vec!["对手".to_string()],
    })
    .expect("create second character");
    let person_b = people.entities.iter().find(|entity| entity.title == "沈砚").expect("person b").clone();
    let relationship_data = super::commands::upsert_entity(super::models::EntityInput {
        project_path: project_path.clone(),
        kind: "relationship".to_string(),
        id: None,
        title: "林月与沈砚".to_string(),
        content: serde_json::json!({"fromId": person_a.id, "toId": person_b.id, "label": "敌对", "strength": "强"}),
        tags: Vec::new(),
    })
    .expect("create relationship");
    let relationship = relationship_data.entities.iter().find(|entity| entity.kind == "relationship").expect("relationship").clone();
    let continent_data = super::commands::upsert_entity(super::models::EntityInput {
        project_path: project_path.clone(),
        kind: "location".to_string(),
        id: None,
        title: "大陆".to_string(),
        content: serde_json::json!({}),
        tags: Vec::new(),
    })
    .expect("create continent");
    let continent = continent_data.entities.iter().find(|entity| entity.title == "大陆").expect("continent").clone();
    let country_data = super::commands::upsert_entity(super::models::EntityInput {
        project_path: project_path.clone(),
        kind: "location".to_string(),
        id: None,
        title: "国家".to_string(),
        content: serde_json::json!({"parentId": continent.id}),
        tags: Vec::new(),
    })
    .expect("create country");
    let country = country_data.entities.iter().find(|entity| entity.title == "国家").expect("country").clone();
    let city_data = super::commands::upsert_entity(super::models::EntityInput {
        project_path: project_path.clone(),
        kind: "location".to_string(),
        id: None,
        title: "城市".to_string(),
        content: serde_json::json!({"parentId": country.id}),
        tags: Vec::new(),
    })
    .expect("create city");
    let city = city_data.entities.iter().find(|entity| entity.title == "城市").expect("city").clone();
    let outline_data = super::commands::upsert_entity(super::models::EntityInput {
        project_path: project_path.clone(),
        kind: "outline".to_string(),
        id: None,
        title: "章节大纲".to_string(),
        content: serde_json::json!({"chapterId": chapter.id, "goal": "保留关联"}),
        tags: Vec::new(),
    })
    .expect("create outline");
    let outline = outline_data.entities.iter().find(|entity| entity.kind == "outline").expect("outline").clone();
    let scene_data = super::commands::upsert_entity(super::models::EntityInput {
        project_path: project_path.clone(),
        kind: "scene".to_string(),
        id: None,
        title: "港口场景".to_string(),
        content: serde_json::json!({"chapterId": chapter.id, "location": city.id}),
        tags: Vec::new(),
    })
    .expect("create scene");
    let scene = scene_data.entities.iter().find(|entity| entity.kind == "scene").expect("scene").clone();
    let chapter_path = root.join("project").join(&chapter.file_path);
    let chapter_raw = fs::read_to_string(&chapter_path).expect("read chapter mirror");
    assert!(chapter_raw.contains(&format!("novelforgeId: {}", chapter.id)));
    let entity_raw = fs::read_to_string(root.join("project").join(&person_a.file_path)).expect("read entity mirror");
    assert!(entity_raw.contains(&format!("novelforgeId: {}", person_a.id)));
    fs::write(root.join("project/.novelforge/database.sqlite"), b"corrupt").expect("corrupt database");

    let reopened = super::commands::open_project(project_path.clone()).expect("reopen recovered project");
    let recovered_volume = reopened.nodes.iter().find(|node| node.kind == "volume").expect("recovered volume");
    let recovered_chapter = reopened.nodes.iter().find(|node| node.kind == "chapter").expect("recovered chapter");
    let recovered_section = reopened.nodes.iter().find(|node| node.kind == "section").expect("recovered section");
    assert_eq!(recovered_volume.id, volume.id);
    assert_eq!(recovered_chapter.id, chapter.id);
    assert_eq!(recovered_section.id, section.id);
    assert_eq!(recovered_section.parent_id.as_deref(), Some(chapter.id.as_str()));
    let recovered_relationship = reopened.entities.iter().find(|entity| entity.id == relationship.id).expect("recovered relationship");
    assert_eq!(recovered_relationship.content.get("fromId").and_then(serde_json::Value::as_str), Some(person_a.id.as_str()));
    assert_eq!(recovered_relationship.content.get("toId").and_then(serde_json::Value::as_str), Some(person_b.id.as_str()));
    let recovered_country = reopened.entities.iter().find(|entity| entity.id == country.id).expect("recovered country");
    let recovered_city = reopened.entities.iter().find(|entity| entity.id == city.id).expect("recovered city");
    assert_eq!(recovered_country.content.get("parentId").and_then(serde_json::Value::as_str), Some(continent.id.as_str()));
    assert_eq!(recovered_city.content.get("parentId").and_then(serde_json::Value::as_str), Some(country.id.as_str()));
    let recovered_outline = reopened.entities.iter().find(|entity| entity.id == outline.id).expect("recovered outline");
    let recovered_scene = reopened.entities.iter().find(|entity| entity.id == scene.id).expect("recovered scene");
    assert_eq!(recovered_outline.content.get("chapterId").and_then(serde_json::Value::as_str), Some(chapter.id.as_str()));
    assert_eq!(recovered_scene.content.get("chapterId").and_then(serde_json::Value::as_str), Some(chapter.id.as_str()));
    let document = super::commands::get_document(super::models::NodeActionInput {
        project_path: project_path.clone(),
        node_id: chapter.id.clone(),
    })
    .expect("read recovered document");
    assert_eq!(document.content, "# 第一章\n\n第二版正文");
    let history = super::commands::list_history(super::models::NodeActionInput {
        project_path: project_path.clone(),
        node_id: chapter.id,
    })
    .expect("list recovered history");
    assert!(history.len() >= 2);
    let _ = fs::remove_dir_all(root);
}

#[test]
fn corrupt_database_keeps_legacy_markdown_recoverable_and_warns() {
    let root = test_root("legacy-recovery");
    let project_path = root.join("project").to_string_lossy().to_string();
    let created = super::commands::create_project(super::models::ProjectInput {
        path: project_path.clone(),
        title: "旧格式恢复".to_string(),
        author: "测试".to_string(),
        description: String::new(),
        genre: "现代".to_string(),
        target_words: 1000,
    })
    .expect("create project");
    let chapter = created.nodes.iter().find(|node| node.kind == "chapter").expect("chapter").clone();
    let entity_data = super::commands::upsert_entity(super::models::EntityInput {
        project_path: project_path.clone(),
        kind: "character".to_string(),
        id: None,
        title: "旧人物".to_string(),
        content: serde_json::json!({"identity": "旧项目"}),
        tags: vec!["旧".to_string()],
    })
    .expect("create entity");
    let entity = entity_data.entities.iter().find(|item| item.title == "旧人物").expect("entity").clone();
    let chapter_path = root.join("project").join(&chapter.file_path);
    let chapter_raw = fs::read_to_string(&chapter_path).expect("read chapter");
    fs::write(&chapter_path, storage::strip_markdown_frontmatter(&chapter_raw)).expect("strip chapter metadata");
    let entity_path = root.join("project").join(&entity.file_path);
    let entity_raw = fs::read_to_string(&entity_path).expect("read entity");
    fs::write(&entity_path, storage::strip_markdown_frontmatter(&entity_raw)).expect("strip entity metadata");
    fs::write(root.join("project/.novelforge/database.sqlite"), b"legacy corrupt").expect("corrupt database");

    let reopened = super::commands::open_project(project_path.clone()).expect("reopen legacy project");
    let recovered_chapter = reopened.nodes.iter().find(|node| node.kind == "chapter").expect("recovered chapter");
    let recovered_entity = reopened.entities.iter().find(|item| item.title == "旧人物").expect("recovered entity");
    assert_ne!(recovered_chapter.id, chapter.id);
    assert_ne!(recovered_entity.id, entity.id);
    let logs = super::commands::read_logs(project_path).expect("read recovery logs");
    assert!(logs.contains("database_recovered"));
    assert!(logs.contains("database_recovery_legacy_metadata"));
    let _ = fs::remove_dir_all(root);
}

#[test]
fn move_and_copy_nodes_keep_markdown_files_and_tree_paths_in_sync() {
    let root = test_root("move-copy");
    let project_path = root.join("project").to_string_lossy().to_string();
    let created = super::commands::create_project(super::models::ProjectInput {
        path: project_path.clone(), title: "移动复制测试".to_string(), author: "测试".to_string(),
        description: String::new(), genre: "现代".to_string(), target_words: 1000,
    }).expect("create project");
    let first_volume = created.nodes.iter().find(|node| node.kind == "volume").expect("first volume").clone();
    let first_chapter = created.nodes.iter().find(|node| node.kind == "chapter").expect("first chapter").clone();
    let second_volume_data = super::commands::create_node(super::models::NodeInput {
        project_path: project_path.clone(), kind: "volume".to_string(), title: "第二卷".to_string(), parent_id: None,
    }).expect("create second volume");
    let second_volume = second_volume_data.nodes.iter().find(|node| node.title == "第二卷").expect("second volume").clone();
    let section_data = super::commands::create_node(super::models::NodeInput {
        project_path: project_path.clone(), kind: "section".to_string(), title: "开场".to_string(), parent_id: Some(first_chapter.id.clone()),
    }).expect("create section");
    let section = section_data.nodes.iter().find(|node| node.title == "开场").expect("section").clone();
    super::commands::save_document(super::models::SaveDocumentInput {
        project_path: project_path.clone(), node_id: first_chapter.id.clone(),
        content: "# 第一章\n\n移动后仍然可读".to_string(), reason: "移动复制测试".to_string(),
    }).expect("save chapter");
    let moved = super::commands::move_node(super::models::MoveNodeInput {
        project_path: project_path.clone(), node_id: first_chapter.id.clone(),
        target_parent_id: Some(second_volume.id.clone()), target_order_index: None,
    }).expect("move chapter");
    let moved_chapter = moved.nodes.iter().find(|node| node.id == first_chapter.id).expect("moved chapter");
    assert_eq!(moved_chapter.parent_id.as_deref(), Some(second_volume.id.as_str()));
    assert!(moved_chapter.file_path.starts_with(&second_volume.file_path));
    let moved_section = moved.nodes.iter().find(|node| node.id == section.id).expect("moved section");
    assert!(moved_section.file_path.starts_with(&moved_chapter.file_path.trim_end_matches(".md")));
    let moved_path = root.join("project").join(&moved_chapter.file_path);
    let moved_content = fs::read_to_string(&moved_path).expect("moved file");
    assert_eq!(storage::strip_markdown_frontmatter(&moved_content), "# 第一章\n\n移动后仍然可读");
    assert!(!root.join("project").join(&first_chapter.file_path).exists());

    let copied = super::commands::copy_node(super::models::CopyNodeInput {
        project_path: project_path.clone(), node_id: first_chapter.id.clone(),
        target_parent_id: Some(first_volume.id.clone()), title: Some("第一章副本".to_string()),
    }).expect("copy chapter");
    let copied_chapter = copied.nodes.iter().find(|node| node.title == "第一章副本").expect("copied chapter");
    assert_ne!(copied_chapter.id, first_chapter.id);
    assert_eq!(copied_chapter.parent_id.as_deref(), Some(first_volume.id.as_str()));
    let copied_content = fs::read_to_string(root.join("project").join(&copied_chapter.file_path)).expect("copied file");
    assert_eq!(storage::strip_markdown_frontmatter(&copied_content), "# 第一章副本\n\n移动后仍然可读");
    let copied_section_id = copied.nodes.iter().find(|node| node.parent_id.as_deref() == Some(copied_chapter.id.as_str())).expect("copied section").id.clone();
    assert!(copied.nodes.iter().any(|node| node.id == copied_section_id));
    let _ = fs::remove_dir_all(root);
}

#[test]
fn trash_path_reuse_allocates_unique_path_and_restores_sidecar() {
    let root = test_root("trash-path-reuse");
    let project_path = root.join("project").to_string_lossy().to_string();
    let created = super::commands::create_project(super::models::ProjectInput {
        path: project_path.clone(),
        title: "回收站路径复用".to_string(),
        author: "测试".to_string(),
        description: String::new(),
        genre: "现代".to_string(),
        target_words: 1000,
    })
    .expect("create project");
    let volume = created.nodes.iter().find(|node| node.kind == "volume").expect("volume").clone();
    let first_chapter = created.nodes.iter().find(|node| node.kind == "chapter").expect("first chapter").clone();
    let second_data = super::commands::create_node(super::models::NodeInput {
        project_path: project_path.clone(),
        kind: "chapter".to_string(),
        title: "第二章".to_string(),
        parent_id: Some(volume.id.clone()),
    })
    .expect("create second chapter");
    let second = second_data.nodes.iter().find(|node| node.title == "第二章").expect("second chapter").clone();
    let section_data = super::commands::create_node(super::models::NodeInput {
        project_path: project_path.clone(),
        kind: "section".to_string(),
        title: "第二章·节".to_string(),
        parent_id: Some(second.id.clone()),
    })
    .expect("create section");
    let section = section_data.nodes.iter().find(|node| node.kind == "section").expect("section").clone();
    super::commands::save_document(super::models::SaveDocumentInput {
        project_path: project_path.clone(),
        node_id: second.id.clone(),
        content: "# 第二章\n\n旧章节正文".to_string(),
        reason: "路径复用测试".to_string(),
    })
    .expect("save second chapter");
    super::commands::save_document(super::models::SaveDocumentInput {
        project_path: project_path.clone(),
        node_id: section.id.clone(),
        content: "# 第二章·节\n\n小节正文".to_string(),
        reason: "路径复用测试".to_string(),
    })
    .expect("save section");
    let second_absolute = root.join("project").join(&second.file_path);
    let second_sidecar = second_absolute.with_extension("");
    assert!(second_sidecar.is_dir());
    super::commands::delete_node(super::models::NodeActionInput {
        project_path: project_path.clone(),
        node_id: second.id.clone(),
    })
    .expect("delete second chapter");
    assert!(!second_absolute.exists());
    assert!(!second_sidecar.exists());
    let trash = super::commands::list_trash(project_path.clone()).expect("list trash");
    let trash_item = trash.iter().find(|item| item.ref_id == second.id).expect("second trash item").clone();
    let trash_file = std::path::PathBuf::from(&trash_item.trash_path);
    assert!(trash_file.is_file());
    assert!(trash_file.with_extension("").is_dir());

    let new_data = super::commands::create_node(super::models::NodeInput {
        project_path: project_path.clone(),
        kind: "chapter".to_string(),
        title: "新章节".to_string(),
        parent_id: Some(volume.id.clone()),
    })
    .expect("create replacement chapter");
    let replacement = new_data.nodes.iter().find(|node| node.title == "新章节").expect("replacement").clone();
    assert_ne!(replacement.file_path, second.file_path);
    assert!(replacement.file_path.ends_with("chapter_003.md"));
    let restored = super::commands::restore_trash(super::models::NodeActionInput {
        project_path: project_path.clone(),
        node_id: trash_item.id.clone(),
    })
    .expect("restore second chapter");
    let restored_chapter = restored.nodes.iter().find(|node| node.id == second.id).expect("restored chapter");
    let restored_section = restored.nodes.iter().find(|node| node.id == section.id).expect("restored section");
    assert_eq!(restored_chapter.file_path, second.file_path);
    assert_eq!(restored_section.file_path, section.file_path);
    assert_eq!(restored_section.parent_id.as_deref(), Some(second.id.as_str()));
    assert_eq!(
        storage::strip_markdown_frontmatter(&fs::read_to_string(root.join("project").join(&restored_chapter.file_path)).expect("restored chapter file")),
        "# 第二章\n\n旧章节正文"
    );
    assert_eq!(
        storage::strip_markdown_frontmatter(&fs::read_to_string(root.join("project").join(&restored_section.file_path)).expect("restored section file")),
        "# 第二章·节\n\n小节正文"
    );
    let sibling_orders: Vec<i64> = restored.nodes.iter()
        .filter(|node| node.parent_id.as_deref() == Some(volume.id.as_str()))
        .map(|node| node.order_index)
        .collect();
    assert_eq!(sibling_orders.len(), 3);
    assert_eq!(sibling_orders.iter().collect::<std::collections::HashSet<_>>().len(), sibling_orders.len());

    super::commands::delete_node(super::models::NodeActionInput {
        project_path: project_path.clone(),
        node_id: second.id.clone(),
    })
    .expect("delete restored chapter");
    let restored_trash = super::commands::list_trash(project_path.clone()).expect("list restored trash");
    let restored_item = restored_trash.iter().find(|item| item.ref_id == second.id).expect("restored trash item").clone();
    super::commands::permanent_delete(super::models::NodeActionInput {
        project_path: project_path.clone(),
        node_id: restored_item.id,
    })
    .expect("permanently delete restored chapter");
    assert!(!second_sidecar.exists());
    let _ = fs::remove_file(root.join("project").join(&first_chapter.file_path));
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
fn restore_history_preserves_current_document() {
    let root = test_root("history-restore");
    let project_path = root.join("project").to_string_lossy().to_string();
    let created = super::commands::create_project(super::models::ProjectInput {
        path: project_path.clone(),
        title: "历史恢复测试".to_string(),
        author: "测试".to_string(),
        description: String::new(),
        genre: "现代".to_string(),
        target_words: 1000,
    })
    .expect("create project");
    let chapter = created
        .nodes
        .iter()
        .find(|node| node.kind == "chapter")
        .expect("chapter")
        .clone();

    super::commands::save_document(super::models::SaveDocumentInput {
        project_path: project_path.clone(),
        node_id: chapter.id.clone(),
        content: "当前稿".to_string(),
        reason: "当前".to_string(),
    })
    .expect("save current");
    super::commands::save_document(super::models::SaveDocumentInput {
        project_path: project_path.clone(),
        node_id: chapter.id.clone(),
        content: "最新稿".to_string(),
        reason: "最新".to_string(),
    })
    .expect("save latest");

    let history = super::commands::list_history(super::models::NodeActionInput {
        project_path: project_path.clone(),
        node_id: chapter.id.clone(),
    })
    .expect("list history");
    let current_revision_id = history
        .iter()
        .find_map(|item| {
            let content = super::commands::read_history(super::commands::RevisionActionInput {
                project_path: project_path.clone(),
                revision_id: item.id.clone(),
            })
            .ok()?;
            (content == "当前稿").then(|| item.id.clone())
        })
        .expect("current revision");

    super::commands::restore_history(super::commands::RevisionActionInput {
        project_path: project_path.clone(),
        revision_id: current_revision_id,
    })
    .expect("restore history");

    let document = super::commands::get_document(super::models::NodeActionInput {
        project_path: project_path.clone(),
        node_id: chapter.id.clone(),
    })
    .expect("read restored document");
    assert_eq!(document.content, "当前稿");

    let history_after = super::commands::list_history(super::models::NodeActionInput {
        project_path: project_path.clone(),
        node_id: chapter.id,
    })
    .expect("list history after restore");
    assert!(history_after.iter().any(|item| {
        super::commands::read_history(super::commands::RevisionActionInput {
            project_path: project_path.clone(),
            revision_id: item.id.clone(),
        })
        .map(|content| content == "最新稿")
        .unwrap_or(false)
    }));
    let _ = fs::remove_dir_all(root);
}

#[test]
fn save_failure_restores_original_and_keeps_recovery_file() {
    let root = test_root("save-rollback");
    let project_path = root.join("project").to_string_lossy().to_string();
    let created = super::commands::create_project(super::models::ProjectInput {
        path: project_path.clone(), title: "保存回滚测试".to_string(), author: "测试".to_string(),
        description: String::new(), genre: "现代".to_string(), target_words: 1000,
    }).expect("create project");
    let chapter = created.nodes.iter().find(|node| node.kind == "chapter").expect("chapter").clone();
    super::commands::save_document(super::models::SaveDocumentInput {
        project_path: project_path.clone(), node_id: chapter.id.clone(), content: "原正文".to_string(), reason: "初始".to_string(),
    }).expect("save original");
    {
        let connection = storage::open_db(&root.join("project")).expect("database");
        connection.execute_batch(
            "CREATE TRIGGER fail_revision BEFORE INSERT ON revisions BEGIN SELECT RAISE(ABORT, 'save failure'); END;"
        ).expect("failure trigger");
    }

    let result = super::commands::save_document(super::models::SaveDocumentInput {
        project_path: project_path.clone(), node_id: chapter.id.clone(), content: "新正文，不应覆盖原稿".to_string(), reason: "触发失败".to_string(),
    });
    assert!(result.is_err());
    let original_after_failure = fs::read_to_string(root.join("project").join(&chapter.file_path)).expect("original remains");
    assert_eq!(storage::strip_markdown_frontmatter(&original_after_failure), "原正文");
    let recovery = super::commands::list_recovery(project_path.clone()).expect("list recovery");
    assert_eq!(recovery.len(), 1);
    assert_eq!(super::commands::read_recovery(super::commands::RecoveryActionInput {
        project_path, recovery_id: recovery[0].id.clone(),
    }).expect("read recovery"), "新正文，不应覆盖原稿");
    let _ = fs::remove_dir_all(root);
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
fn entity_delete_restores_file_when_database_transaction_fails() {
    let root = test_root("entity-delete-rollback");
    let project_path = root.join("project").to_string_lossy().to_string();
    let _created = super::commands::create_project(super::models::ProjectInput {
        path: project_path.clone(),
        title: "资料回滚测试".to_string(),
        author: "测试".to_string(),
        description: String::new(),
        genre: "现代".to_string(),
        target_words: 1000,
    }).expect("create project");
    let with_entity = super::commands::upsert_entity(super::models::EntityInput {
        project_path: project_path.clone(),
        kind: "timeline".to_string(),
        id: None,
        title: "第一次停电".to_string(),
        content: serde_json::json!({"date": "2026-08-29", "description": "港区灯火同时熄灭"}),
        tags: vec!["时间线".to_string()],
    }).expect("save timeline entity");
    let entity = with_entity.entities.iter().find(|item| item.title == "第一次停电").expect("timeline entity").clone();
    let entity_path = root.join("project").join(&entity.file_path);
    let original = fs::read_to_string(&entity_path).expect("entity mirror");
    {
        let connection = storage::open_db(&root.join("project")).expect("database");
        connection.execute_batch(
            "CREATE TRIGGER fail_entity_trash BEFORE INSERT ON trash_items BEGIN SELECT RAISE(ABORT, 'entity test failure'); END;"
        ).expect("failure trigger");
    }

    let result = super::commands::delete_entity(super::models::NodeActionInput {
        project_path: project_path.clone(),
        node_id: entity.id.clone(),
    });
    assert!(result.is_err());
    assert_eq!(fs::read_to_string(&entity_path).expect("restored entity"), original);
    let reopened = super::commands::open_project(project_path.clone()).expect("reopen project");
    assert!(reopened.entities.iter().any(|item| item.id == entity.id));
    assert!(super::commands::list_trash(project_path).expect("list trash").is_empty());
    let _ = fs::remove_dir_all(root);
}

#[test]
fn attachment_import_copies_binary_and_metadata_updates_keep_bytes() {
    let root = test_root("attachment-import");
    let project_path = root.join("project").to_string_lossy().to_string();
    let source = root.join("reference.pdf");
    let bytes = b"not-a-real-pdf-but-binary-safe";
    fs::write(&source, bytes).expect("source file");
    super::commands::create_project(super::models::ProjectInput {
        path: project_path.clone(), title: "附件测试".to_string(), author: "测试".to_string(),
        description: String::new(), genre: "现代".to_string(), target_words: 1000,
    }).expect("create project");
    let imported = super::commands::import_attachment(super::models::AttachmentInput {
        project_path: project_path.clone(), source_path: source.to_string_lossy().to_string(), description: "初始参考资料".to_string(),
    }).expect("import attachment");
    let attachment = imported.entities.iter().find(|item| item.kind == "attachment").expect("attachment entity").clone();
    let destination = root.join("project").join(&attachment.file_path);
    assert_eq!(fs::read(&destination).expect("copied bytes"), bytes);
    let updated = super::commands::upsert_entity(super::models::EntityInput {
        project_path: project_path.clone(), kind: "attachment".to_string(), id: Some(attachment.id.clone()), title: attachment.title.clone(),
        content: serde_json::json!({"originalName": "reference.pdf", "mimeType": "application/pdf", "sizeBytes": bytes.len(), "description": "已补充说明"}), tags: vec!["附件".to_string()],
    }).expect("update attachment metadata");
    assert!(updated.entities.iter().any(|item| item.id == attachment.id));
    assert_eq!(fs::read(&destination).expect("bytes after metadata update"), bytes);
    let _ = fs::remove_dir_all(root);
}

#[test]
fn consistency_check_reports_missing_wiki_and_broken_relationship() {
    let root = test_root("consistency");
    let project_path = root.join("project").to_string_lossy().to_string();
    let created = super::commands::create_project(super::models::ProjectInput {
        path: project_path.clone(), title: "一致性测试".to_string(), author: "测试".to_string(),
        description: String::new(), genre: "现代".to_string(), target_words: 1000,
    }).expect("create project");
    let chapter = created.nodes.iter().find(|node| node.kind == "chapter").expect("chapter").clone();
    super::commands::save_document(super::models::SaveDocumentInput {
        project_path: project_path.clone(), node_id: chapter.id, content: "正文引用[[不存在的人物]]".to_string(), reason: "一致性测试".to_string(),
    }).expect("save document");
    super::commands::upsert_entity(super::models::EntityInput {
        project_path: project_path.clone(), kind: "relationship".to_string(), id: None, title: "坏关系".to_string(),
        content: serde_json::json!({"fromId": "missing-a", "toId": "missing-b", "label": "敌对"}), tags: vec!["人物关系".to_string()],
    }).expect("save relationship");
    let report = super::commands::check_consistency(project_path).expect("consistency report");
    assert!(report.issues.iter().any(|issue| issue.code == "missing-wiki"));
    assert!(report.issues.iter().any(|issue| issue.code == "broken-relationship"));
    assert!(report.warnings > 0);
    assert!(report.errors > 0);
    let _ = fs::remove_dir_all(root);
}

#[test]
fn consistency_check_ignores_wiki_inside_fenced_code() {
    let root = test_root("consistency-wiki-fence");
    let project_path = root.join("project").to_string_lossy().to_string();
    let created = super::commands::create_project(super::models::ProjectInput {
        path: project_path.clone(), title: "Wiki 围栏测试".to_string(), author: "测试".to_string(),
        description: String::new(), genre: "现代".to_string(), target_words: 1000,
    }).expect("create project");
    let chapter = created.nodes.iter().find(|node| node.kind == "chapter").expect("chapter").clone();
    super::commands::save_document(super::models::SaveDocumentInput {
        project_path: project_path.clone(), node_id: chapter.id, content: "~~~md\n[[代码示例]]\n~~~".to_string(), reason: "围栏测试".to_string(),
    }).expect("save document");
    let report = super::commands::check_consistency(project_path).expect("consistency report");
    assert!(!report.issues.iter().any(|issue| issue.code == "missing-wiki"));
    let _ = fs::remove_dir_all(root);
}

#[test]
fn consistency_check_accepts_global_chapter_numbers_across_volumes() {
    let root = test_root("consistency-multi-volume");
    let project_path = root.join("project").to_string_lossy().to_string();
    let created = super::commands::create_project(super::models::ProjectInput {
        path: project_path.clone(), title: "多卷一致性测试".to_string(), author: "测试".to_string(),
        description: String::new(), genre: "现代".to_string(), target_words: 1000,
    }).expect("create project");
    let first_volume = created.nodes.iter().find(|node| node.kind == "volume").expect("first volume").clone();
    let _second_chapter_data = super::commands::create_node(super::models::NodeInput {
        project_path: project_path.clone(), kind: "chapter".to_string(), title: "卷一第二章".to_string(),
        parent_id: Some(first_volume.id.clone()),
    }).expect("create second chapter");
    let second_volume_data = super::commands::create_node(super::models::NodeInput {
        project_path: project_path.clone(), kind: "volume".to_string(), title: "第二卷".to_string(), parent_id: None,
    }).expect("create second volume");
    let second_volume = second_volume_data.nodes.iter().find(|node| node.title == "第二卷").expect("second volume").clone();
    super::commands::create_node(super::models::NodeInput {
        project_path: project_path.clone(), kind: "chapter".to_string(), title: "卷二第一章".to_string(),
        parent_id: Some(second_volume.id.clone()),
    }).expect("create third chapter");
    super::commands::upsert_entity(super::models::EntityInput {
        project_path: project_path.clone(), kind: "timeline".to_string(), id: None, title: "第三章事件".to_string(),
        content: serde_json::json!({"chapters": "第3章", "description": "跨卷章节引用"}), tags: vec!["时间线".to_string()],
    }).expect("save timeline");
    let report = super::commands::check_consistency(project_path).expect("consistency report");
    assert!(!report.issues.iter().any(|issue| issue.code == "missing-chapter-reference"));
    let _ = fs::remove_dir_all(root);
}

#[test]
fn consistency_check_accepts_legacy_paid_off_foreshadowing_status() {
    let root = test_root("consistency-legacy-status");
    let project_path = root.join("project").to_string_lossy().to_string();
    let created = super::commands::create_project(super::models::ProjectInput {
        path: project_path.clone(), title: "旧状态一致性测试".to_string(), author: "测试".to_string(),
        description: String::new(), genre: "现代".to_string(), target_words: 1000,
    }).expect("create project");
    let chapter = created.nodes.iter().find(|node| node.kind == "chapter").expect("chapter").clone();
    super::commands::upsert_entity(super::models::EntityInput {
        project_path: project_path.clone(), kind: "foreshadowing".to_string(), id: None, title: "旧伏笔".to_string(),
        content: serde_json::json!({"actualPayoff": chapter.title, "status": "resolved"}), tags: vec!["伏笔".to_string()],
    }).expect("save foreshadowing");
    let report = super::commands::check_consistency(project_path).expect("consistency report");
    assert!(!report.issues.iter().any(|issue| issue.code == "foreshadowing-status"));
    let _ = fs::remove_dir_all(root);
}

#[test]
fn node_status_rejects_missing_nodes() {
    let root = test_root("status-boundaries");
    let project_path = root.join("project").to_string_lossy().to_string();
    super::commands::create_project(super::models::ProjectInput {
        path: project_path.clone(), title: "状态边界测试".to_string(), author: "测试".to_string(),
        description: String::new(), genre: "现代".to_string(), target_words: 1000,
    }).expect("create project");
    let error = super::commands::set_node_status(super::commands::NodeStatusInput {
        project_path: project_path.clone(), node_id: "missing-node".to_string(), status: "done".to_string(),
    }).expect_err("missing node must fail");
    assert!(error.contains("节点不存在"));
    let _ = fs::remove_dir_all(root);
}

#[test]
fn statistics_include_daily_series_and_chapter_breakdown() {
    let root = test_root("statistics");
    let project_path = root.join("project").to_string_lossy().to_string();
    let created = super::commands::create_project(super::models::ProjectInput {
        path: project_path.clone(), title: "统计测试".to_string(), author: "测试".to_string(),
        description: String::new(), genre: "现代".to_string(), target_words: 1000,
    }).expect("create project");
    let chapter = created.nodes.iter().find(|node| node.kind == "chapter").expect("chapter").clone();
    super::commands::save_document(super::models::SaveDocumentInput {
        project_path: project_path.clone(), node_id: chapter.id.clone(), content: "# 第一章\n\n一段统计正文".repeat(20), reason: "统计测试".to_string(),
    }).expect("save document");
    let stats = super::commands::get_statistics(super::models::StatisticsInput { project_path, current_node_id: Some(chapter.id.clone()) }).expect("statistics");
    assert_eq!(stats.daily.len(), 30);
    assert_eq!(stats.chapter_stats.len(), 1);
    assert_eq!(stats.chapter_stats[0].id, chapter.id);
    assert!(stats.chapter_stats[0].words > 0);
    assert_eq!(stats.current_chapter_words, stats.chapter_stats[0].words);
    assert!(stats.current_volume_words >= stats.current_chapter_words);
    assert!(stats.average_daily_words > 0);
    assert!(stats.longest_writing_streak >= stats.writing_streak);
    let _ = fs::remove_dir_all(root);
}

#[test]
fn export_project_writes_all_supported_formats() {
    let root = test_root("exports");
    let project_path = root.join("project").to_string_lossy().to_string();
    let created = super::commands::create_project(super::models::ProjectInput {
        path: project_path.clone(), title: "导出测试".to_string(), author: "测试作者".to_string(),
        description: String::new(), genre: "现代".to_string(), target_words: 1000,
    }).expect("create project");
    let chapter = created.nodes.iter().find(|node| node.kind == "chapter").expect("chapter").clone();
    super::commands::save_document(super::models::SaveDocumentInput {
        project_path: project_path.clone(), node_id: chapter.id, content: "# 第一章\n\n## 小节\n\n- **林月**走进[[雾港]]。".to_string(), reason: "导出测试".to_string(),
    }).expect("save document");

    for format in ["markdown", "txt", "html", "docx", "epub", "pdf"] {
        let output = super::commands::export_project(super::models::ExportInput { project_path: project_path.clone(), format: format.to_string(), ..Default::default() }).expect("export format");
        let bytes = fs::read(&output).expect("read exported file");
        match format {
            "markdown" => assert!(String::from_utf8_lossy(&bytes).contains("导出测试")),
            "txt" => {
                let text = String::from_utf8_lossy(&bytes);
                assert!(text.contains("林月走进雾港"));
                assert!(!text.contains("##"));
                assert!(!text.contains("**"));
                assert!(!text.contains("[["));
            }
            "html" => {
                let html = String::from_utf8_lossy(&bytes);
                assert!(html.contains("<!doctype html>"));
                assert!(html.contains("导出测试"));
                assert_eq!(html.matches("<h1>导出测试</h1>").count(), 1);
                assert_eq!(html.matches("<h2>目录</h2>").count(), 1);
            }
            "docx" => {
                let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes)).expect("read docx zip");
                assert!(archive.by_name("word/document.xml").is_ok());
            }
            "epub" => {
                let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes)).expect("read epub zip");
                assert!(archive.by_name("mimetype").is_ok());
                assert!(archive.by_name("OEBPS/content.xhtml").is_ok());
                assert!(archive.by_name("OEBPS/nav.xhtml").is_ok());
            }
            "pdf" => {
                assert!(bytes.starts_with(b"%PDF-1.4"));
                assert!(!bytes.windows(4).any(|window| window == b"0023"), "PDF must not expose Markdown heading markers");
            }
            _ => unreachable!(),
        }
    }
    assert!(super::commands::export_project(super::models::ExportInput { project_path, format: "unsupported".to_string(), ..Default::default() }).is_err());
    let _ = fs::remove_dir_all(root);
}

#[test]
fn ai_endpoint_normalization_rejects_invalid_urls() {
    assert_eq!(super::commands::normalize_ai_endpoint("http://127.0.0.1:1234/v1" ).expect("base endpoint"), "http://127.0.0.1:1234/v1/chat/completions");
    assert_eq!(super::commands::normalize_ai_endpoint("https://api.example.com/v1/chat/completions/").expect("completion endpoint"), "https://api.example.com/v1/chat/completions");
    assert!(super::commands::normalize_ai_endpoint("api.example.com").is_err());
}

#[test]
fn ai_provider_parses_openai_compatible_response() {
    let listener = TcpListener::bind("127.0.0.1:0").expect("mock AI listener");
    let address = listener.local_addr().expect("mock AI address");
    let handle = thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("mock AI request");
        let mut request = [0_u8; 8192];
        let _ = stream.read(&mut request);
        let body = r#"{"model":"mock-model","choices":[{"message":{"content":"生成结果"}}]}"#;
        let response = format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body);
        stream.write_all(response.as_bytes()).expect("mock AI response");
    });
    let result = super::commands::ai_complete(super::models::AiCompletionInput {
        endpoint: format!("http://{}/v1", address), api_key: "test-secret".to_string(), model: "mock-model".to_string(),
        system_prompt: "系统".to_string(), prompt: "用户请求".to_string(), temperature: Some(0.7), max_tokens: Some(100),
    }).expect("AI response");
    handle.join().expect("mock AI thread");
    assert_eq!(result.content, "生成结果");
    assert_eq!(result.model, "mock-model");
}

#[test]
#[ignore = "large project acceptance benchmark; run explicitly with cargo test -- --ignored"]
fn large_project_acceptance_handles_1000_chapters_and_one_million_characters() {
    let root = test_root("large-project");
    let project_path = root.join("project").to_string_lossy().to_string();
    let started = std::time::Instant::now();
    let created = super::commands::create_project(super::models::ProjectInput {
        path: project_path.clone(), title: "大规模验收".to_string(), author: "测试".to_string(),
        description: String::new(), genre: "现代".to_string(), target_words: 1_000_000,
    }).expect("create project");
    let first_volume_id = created.nodes.iter().find(|node| node.kind == "volume").expect("volume").id.clone();
    let first_chapter = created.nodes.iter().find(|node| node.kind == "chapter").expect("first chapter").id.clone();
    super::commands::save_document(super::models::SaveDocumentInput {
        project_path: project_path.clone(), node_id: first_chapter, content: "字".repeat(1000), reason: "大规模验收".to_string(),
    }).expect("save first chapter");
    let mut volume_ids = vec![first_volume_id];
    for volume_number in 2..=10 {
        let data = super::commands::create_node(super::models::NodeInput {
            project_path: project_path.clone(), kind: "volume".to_string(), title: format!("第{}卷", volume_number), parent_id: None,
        }).expect("create volume");
        volume_ids.push(data.nodes.iter().find(|node| node.title == format!("第{}卷", volume_number)).expect("created volume").id.clone());
    }
    for chapter_number in 2..=1000 {
        let volume_index = (chapter_number - 1) / 100;
        let volume_id = volume_ids.get(volume_index).expect("volume for chapter");
        let data = super::commands::create_node(super::models::NodeInput {
            project_path: project_path.clone(), kind: "chapter".to_string(), title: format!("第{}章", chapter_number), parent_id: Some(volume_id.clone()),
        }).expect("create chapter");
        let chapter = data.nodes.iter().find(|node| node.title == format!("第{}章", chapter_number)).expect("created chapter");
        super::commands::save_document(super::models::SaveDocumentInput {
            project_path: project_path.clone(), node_id: chapter.id.clone(), content: "字".repeat(1000), reason: "大规模验收".to_string(),
        }).expect("save chapter");
    }
    for index in 0..100 {
        let _ = super::commands::upsert_entity(super::models::EntityInput {
            project_path: project_path.clone(), kind: "character".to_string(), id: None,
            title: format!("人物{:03}", index + 1), content: serde_json::json!({"identity": "验收角色", "status": "活动"}), tags: vec!["大规模".to_string()],
        }).expect("create character");
    }
    for index in 0..100 {
        let _ = super::commands::upsert_entity(super::models::EntityInput {
            project_path: project_path.clone(), kind: "location".to_string(), id: None,
            title: format!("地点{:03}", index + 1), content: serde_json::json!({"type": "城市", "description": "大规模验收地点"}), tags: vec!["大规模".to_string()],
        }).expect("create location");
    }
    for index in 0..200 {
        let _ = super::commands::upsert_entity(super::models::EntityInput {
            project_path: project_path.clone(), kind: "world".to_string(), id: None,
            title: format!("世界观{:03}", index + 1), content: serde_json::json!({"category": "设定", "summary": "大规模验收世界观"}), tags: vec!["大规模".to_string()],
        }).expect("create world entry");
    }
    for index in 0..500 {
        let _ = super::commands::upsert_entity(super::models::EntityInput {
            project_path: project_path.clone(), kind: "timeline".to_string(), id: None,
            title: format!("时间线事件{:03}", index + 1), content: serde_json::json!({"date": format!("第{}日", index + 1), "chapters": format!("第{}章", (index % 1000) + 1), "description": "大规模验收事件"}), tags: vec!["大规模".to_string()],
        }).expect("create timeline event");
    }
    for index in 0..100 {
        let _ = super::commands::upsert_entity(super::models::EntityInput {
            project_path: project_path.clone(), kind: "foreshadowing".to_string(), id: None,
            title: format!("伏笔{:03}", index + 1), content: serde_json::json!({"status": "planned", "plannedPayoff": format!("第{}章", index + 10), "description": "大规模验收伏笔"}), tags: vec!["大规模".to_string()],
        }).expect("create foreshadowing");
    }
    let data = super::commands::open_project(project_path.clone()).expect("open large project");
    let stats = super::commands::get_statistics(super::models::StatisticsInput { project_path: project_path.clone(), current_node_id: None }).expect("large statistics");
    assert_eq!(data.nodes.iter().filter(|node| node.kind == "volume").count(), 10);
    assert_eq!(stats.chapter_count, 1000);
    assert!(stats.total_words >= 1_000_000);
    assert_eq!(data.entities.iter().filter(|entity| entity.kind == "character").count(), 100);
    assert_eq!(data.entities.iter().filter(|entity| entity.kind == "location").count(), 100);
    assert_eq!(data.entities.iter().filter(|entity| entity.kind == "world").count(), 200);
    assert_eq!(data.entities.iter().filter(|entity| entity.kind == "timeline").count(), 500);
    assert_eq!(data.entities.iter().filter(|entity| entity.kind == "foreshadowing").count(), 100);
    let search = super::commands::search_project(super::models::SearchInput {
        project_path: project_path.clone(), query: "世界观099".to_string(), kind: Some("world".to_string()),
        scope: None, node_id: None, volume_path: None, tag: Some("大规模".to_string()), case_sensitive: None,
    }).expect("search large project");
    assert!(search.iter().any(|result| result.title == "世界观099"));
    assert!(started.elapsed() < std::time::Duration::from_secs(120));
    let _ = fs::remove_dir_all(root);
    assert_eq!(data.nodes.iter().filter(|node| node.kind == "chapter").count(), 1000);
}

#[test]
fn restore_trash_keeps_quarantined_entity_when_destination_exists() {
    let root = test_root("entity-restore-collision");
    let project_path = root.join("project").to_string_lossy().to_string();
    let _created = super::commands::create_project(super::models::ProjectInput {
        path: project_path.clone(),
        title: "恢复冲突测试".to_string(),
        author: "测试".to_string(),
        description: String::new(),
        genre: "现代".to_string(),
        target_words: 1000,
    }).expect("create project");
    let with_entity = super::commands::upsert_entity(super::models::EntityInput {
        project_path: project_path.clone(),
        kind: "foreshadowing".to_string(),
        id: None,
        title: "缺失的钟声".to_string(),
        content: serde_json::json!({"status": "planted"}),
        tags: vec!["伏笔".to_string()],
    }).expect("save foreshadowing entity");
    let entity = with_entity.entities.iter().find(|item| item.title == "缺失的钟声").expect("foreshadowing entity").clone();
    super::commands::delete_entity(super::models::NodeActionInput {
        project_path: project_path.clone(),
        node_id: entity.id.clone(),
    }).expect("delete entity");
    let trash = super::commands::list_trash(project_path.clone()).expect("list trash");
    let trash_item = trash.iter().find(|item| item.ref_id == entity.id).expect("entity trash item").clone();
    let original_path = root.join("project").join(&trash_item.original_path);
    fs::create_dir_all(original_path.parent().expect("entity parent")).expect("entity parent");
    fs::write(&original_path, "用户新建的同名文件").expect("collision file");
    let trash_path = storage::safe_trash_path(&root.join("project"), &trash_item.trash_path).expect("trash path");

    let result = super::commands::restore_trash(super::models::NodeActionInput {
        project_path: project_path.clone(),
        node_id: trash_item.id,
    });
    assert!(result.is_err());
    assert_eq!(fs::read_to_string(&original_path).expect("collision remains"), "用户新建的同名文件");
    assert!(trash_path.exists());
    assert!(super::commands::list_trash(project_path).expect("trash remains").iter().any(|item| item.ref_id == entity.id));
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
