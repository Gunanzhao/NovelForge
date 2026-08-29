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
fn statistics_include_daily_series_and_chapter_breakdown() {
    let root = test_root("statistics");
    let project_path = root.join("project").to_string_lossy().to_string();
    let created = super::commands::create_project(super::models::ProjectInput {
        path: project_path.clone(), title: "统计测试".to_string(), author: "测试".to_string(),
        description: String::new(), genre: "现代".to_string(), target_words: 1000,
    }).expect("create project");
    let chapter = created.nodes.iter().find(|node| node.kind == "chapter").expect("chapter").clone();
    super::commands::save_document(super::models::SaveDocumentInput {
        project_path: project_path.clone(), node_id: chapter.id.clone(), content: "# 第一章\n\n一段统计正文".to_string(), reason: "统计测试".to_string(),
    }).expect("save document");
    let stats = super::commands::get_statistics(project_path).expect("statistics");
    assert_eq!(stats.daily.len(), 30);
    assert_eq!(stats.chapter_stats.len(), 1);
    assert_eq!(stats.chapter_stats[0].id, chapter.id);
    assert!(stats.chapter_stats[0].words > 0);
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
        project_path: project_path.clone(), node_id: chapter.id, content: "# 第一章\n\n林月走进雾港。".to_string(), reason: "导出测试".to_string(),
    }).expect("save document");

    for format in ["markdown", "txt", "docx", "epub", "pdf"] {
        let output = super::commands::export_project(super::models::ExportInput { project_path: project_path.clone(), format: format.to_string() }).expect("export format");
        let bytes = fs::read(&output).expect("read exported file");
        match format {
            "markdown" => assert!(String::from_utf8_lossy(&bytes).contains("导出测试")),
            "txt" => assert!(String::from_utf8_lossy(&bytes).contains("林月走进雾港")),
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
            "pdf" => assert!(bytes.starts_with(b"%PDF-1.4")),
            _ => unreachable!(),
        }
    }
    assert!(super::commands::export_project(super::models::ExportInput { project_path, format: "html".to_string() }).is_err());
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
    let volume_id = created.nodes.iter().find(|node| node.kind == "volume").expect("volume").id.clone();
    let first_chapter = created.nodes.iter().find(|node| node.kind == "chapter").expect("first chapter").id.clone();
    super::commands::save_document(super::models::SaveDocumentInput {
        project_path: project_path.clone(), node_id: first_chapter, content: "字".repeat(1000), reason: "大规模验收".to_string(),
    }).expect("save first chapter");
    for index in 1..1000 {
        let data = super::commands::create_node(super::models::NodeInput {
            project_path: project_path.clone(), kind: "chapter".to_string(), title: format!("第{}章", index + 1), parent_id: Some(volume_id.clone()),
        }).expect("create chapter");
        let chapter = data.nodes.iter().find(|node| node.title == format!("第{}章", index + 1)).expect("created chapter");
        super::commands::save_document(super::models::SaveDocumentInput {
            project_path: project_path.clone(), node_id: chapter.id.clone(), content: "字".repeat(1000), reason: "大规模验收".to_string(),
        }).expect("save chapter");
    }
    let data = super::commands::open_project(project_path.clone()).expect("open large project");
    let stats = super::commands::get_statistics(project_path.clone()).expect("large statistics");
    assert_eq!(stats.chapter_count, 1000);
    assert!(stats.total_words >= 1_000_000);
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
