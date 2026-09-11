use super::*;

struct Fixture {
    root: PathBuf,
    path: String,
    volume: NodeRecord,
    chapter: NodeRecord,
}
impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("novelforge-rc5-{}", storage::new_id()));
        fs::create_dir_all(&root).unwrap();
        let path = root.to_string_lossy().to_string();
        let data = create_project(ProjectInput {
            path: path.clone(),
            title: "审计回归".into(),
            author: "测试".into(),
            description: String::new(),
            genre: String::new(),
            target_words: 1000,
        })
        .unwrap();
        Self {
            root,
            path,
            volume: data
                .nodes
                .iter()
                .find(|n| n.kind == "volume")
                .unwrap()
                .clone(),
            chapter: data
                .nodes
                .iter()
                .find(|n| n.kind == "chapter")
                .unwrap()
                .clone(),
        }
    }
    fn action(&self, id: &str) -> crate::models::NodeActionInput {
        crate::models::NodeActionInput {
            project_path: self.path.clone(),
            node_id: id.into(),
        }
    }
    fn trash(&self, id: &str) -> TrashItem {
        list_trash(self.path.clone())
            .unwrap()
            .into_iter()
            .find(|i| i.ref_id == id)
            .unwrap()
    }
    fn import(&self) -> EntityRecord {
        let source = self.root.join("reference-source.bin");
        fs::write(&source, b"unchanged attachment bytes\0\xff").unwrap();
        let data = import_attachment(crate::models::AttachmentInput {
            project_path: self.path.clone(),
            source_path: source.to_string_lossy().into(),
            description: "多行说明\n第二行".into(),
        })
        .unwrap();
        data.entities
            .into_iter()
            .find(|e| e.kind == "attachment")
            .unwrap()
    }
    fn lose_database(&self) {
        fs::rename(
            self.root.join(".novelforge/database.sqlite"),
            self.root
                .join(format!(".novelforge/database-{}.backup", storage::new_id())),
        )
        .unwrap();
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

#[test]
fn independent_child_trash_survives_parent_restore_and_path_collision() {
    let f = Fixture::new();
    let data = create_node(NodeInput {
        project_path: f.path.clone(),
        kind: "section".into(),
        title: "独立小节".into(),
        parent_id: Some(f.chapter.id.clone()),
    })
    .unwrap();
    let section = data.nodes.iter().find(|n| n.kind == "section").unwrap();
    delete_node(f.action(&section.id)).unwrap();
    delete_node(f.action(&f.chapter.id)).unwrap();
    delete_node(f.action(&f.volume.id)).unwrap();
    fs::create_dir_all(f.root.join(&f.volume.file_path)).unwrap();
    let restored = restore_trash(f.action(&f.trash(&f.volume.id).id)).unwrap();
    assert_eq!(restored.nodes.len(), 1);
    let volume = &restored.nodes[0];
    assert_ne!(volume.file_path, f.volume.file_path);
    let restored = restore_trash(f.action(&f.trash(&f.chapter.id).id)).unwrap();
    assert_eq!(restored.nodes.len(), 2);
    let chapter = restored
        .nodes
        .iter()
        .find(|n| n.id == f.chapter.id)
        .unwrap();
    assert!(chapter
        .file_path
        .starts_with(&format!("{}/", volume.file_path)));
    let restored = restore_trash(f.action(&f.trash(&section.id).id)).unwrap();
    assert_eq!(restored.nodes.len(), 3);
    assert!(get_document(f.action(&section.id)).is_ok());
    assert!(get_document(f.action(&f.chapter.id)).is_ok());
    assert!(list_trash(f.path.clone()).unwrap().is_empty());
}

#[test]
fn permanent_parent_delete_preserves_independent_child_and_empty_trash_orders_children_first() {
    let f = Fixture::new();
    delete_node(f.action(&f.chapter.id)).unwrap();
    delete_node(f.action(&f.volume.id)).unwrap();
    let child = f.trash(&f.chapter.id);
    assert!(permanent_delete(f.action(&f.trash(&f.volume.id).id))
        .unwrap_err()
        .contains("子节点"));
    assert!(Path::new(&child.trash_path).is_file());
    assert_eq!(list_trash(f.path.clone()).unwrap().len(), 2);
    let data = empty_trash(f.path.clone()).unwrap();
    assert!(data.nodes.is_empty());
    assert!(list_trash(f.path.clone()).unwrap().is_empty());
    assert!(!Path::new(&child.trash_path).exists());
}

#[test]
fn repairs_rc4_active_node_with_missing_file_and_existing_trash_item() {
    let f = Fixture::new();
    delete_node(f.action(&f.chapter.id)).unwrap();
    let (_, connection) = project_connection(&f.path).unwrap();
    connection
        .execute(
            "UPDATE nodes SET deleted_at=NULL,deleted_path=NULL WHERE id=?1",
            params![f.chapter.id],
        )
        .unwrap();
    drop(connection);
    restore_trash(f.action(&f.trash(&f.chapter.id).id)).unwrap();
    assert!(get_document(f.action(&f.chapter.id))
        .unwrap()
        .content
        .contains("故事"));
}

#[test]
fn attachment_metadata_roundtrips_rebuild_and_trash_without_changing_binary() {
    let f = Fixture::new();
    let entity = f.import();
    let binary = f.root.join(&entity.file_path);
    let bytes = fs::read(&binary).unwrap();
    let content = serde_json::json!({"description":" 精确保留\n\n# 标题\n", "chapterId":f.chapter.id, "number":42, "nested":{"ok":true}});
    upsert_entity(EntityInput {
        project_path: f.path.clone(),
        id: Some(entity.id.clone()),
        kind: "attachment".into(),
        title: "参考文档".into(),
        content: content.clone(),
        tags: vec!["标签".into()],
    })
    .unwrap();
    f.lose_database();
    let data = open_project(f.path.clone()).unwrap();
    let recovered = data.entities.iter().find(|e| e.id == entity.id).unwrap();
    assert_eq!(recovered.content, content);
    assert_eq!(recovered.tags, vec!["标签"]);
    assert_eq!(fs::read(&binary).unwrap(), bytes);
    delete_entity(f.action(&entity.id)).unwrap();
    assert!(!binary.exists());
    assert!(!entities::attachment_mirror_path(&f.root, &binary)
        .unwrap()
        .exists());
    let item = f.trash(&entity.id);
    assert!(
        entities::attachment_mirror_path(&f.root, Path::new(&item.trash_path))
            .unwrap()
            .is_file()
    );
    restore_trash(f.action(&item.id)).unwrap();
    assert_eq!(fs::read(&binary).unwrap(), bytes);
    delete_entity(f.action(&entity.id)).unwrap();
    let item = f.trash(&entity.id);
    let mirror = entities::attachment_mirror_path(&f.root, Path::new(&item.trash_path)).unwrap();
    permanent_delete(f.action(&item.id)).unwrap();
    assert!(!mirror.exists());
    f.lose_database();
    assert!(open_project(f.path.clone()).unwrap().entities.is_empty());
}

#[test]
fn old_attachments_are_backfilled_before_database_loss() {
    let f = Fixture::new();
    let entity = f.import();
    let binary = f.root.join(&entity.file_path);
    let mirror = entities::attachment_mirror_path(&f.root, &binary).unwrap();
    fs::remove_file(&mirror).unwrap();
    open_project(f.path.clone()).unwrap();
    assert!(mirror.is_file());
    f.lose_database();
    let recovered = open_project(f.path.clone()).unwrap();
    assert_eq!(recovered.entities[0].id, entity.id);
    assert_eq!(recovered.entities[0].content, entity.content);
}

#[test]
fn legacy_attachment_without_database_or_mirror_is_recovered_with_explicit_metadata_limit() {
    let f = Fixture::new();
    let entity = f.import();
    let binary = f.root.join(&entity.file_path);
    fs::remove_file(entities::attachment_mirror_path(&f.root, &binary).unwrap()).unwrap();
    f.lose_database();
    let recovered = open_project(f.path.clone()).unwrap();
    assert_eq!(recovered.entities.len(), 1);
    assert_eq!(recovered.entities[0].file_path, entity.file_path);
    assert!(recovered.entities[0].content["description"]
        .as_str()
        .unwrap()
        .contains("没有可用"));
}

#[test]
fn attachment_save_and_delete_failures_restore_metadata_and_bytes() {
    let f = Fixture::new();
    let entity = f.import();
    let binary = f.root.join(&entity.file_path);
    let mirror = entities::attachment_mirror_path(&f.root, &binary).unwrap();
    let original = fs::read(&mirror).unwrap();
    let bytes = fs::read(&binary).unwrap();
    let (_, connection) = project_connection(&f.path).unwrap();
    connection.execute_batch("CREATE TRIGGER fail_entity BEFORE UPDATE ON entities BEGIN SELECT RAISE(ABORT,'audit failure'); END;").unwrap();
    assert!(upsert_entity(EntityInput {
        project_path: f.path.clone(),
        id: Some(entity.id.clone()),
        kind: "attachment".into(),
        title: entity.title.clone(),
        content: serde_json::json!({"description":"new"}),
        tags: vec![]
    })
    .is_err());
    assert_eq!(fs::read(&mirror).unwrap(), original);
    assert!(delete_entity(f.action(&entity.id)).is_err());
    assert_eq!(fs::read(&binary).unwrap(), bytes);
    assert_eq!(fs::read(&mirror).unwrap(), original);
    assert!(list_trash(f.path.clone()).unwrap().is_empty());
}

#[test]
fn attachment_restore_failure_returns_binary_and_metadata_to_trash() {
    let f = Fixture::new();
    let entity = f.import();
    delete_entity(f.action(&entity.id)).unwrap();
    let item = f.trash(&entity.id);
    let (_, connection) = project_connection(&f.path).unwrap();
    connection.execute_batch("CREATE TRIGGER fail_restore BEFORE UPDATE ON entities BEGIN SELECT RAISE(ABORT,'audit failure'); END;").unwrap();
    assert!(restore_trash(f.action(&item.id)).is_err());
    assert!(Path::new(&item.trash_path).is_file());
    assert!(
        entities::attachment_mirror_path(&f.root, Path::new(&item.trash_path))
            .unwrap()
            .is_file()
    );
    assert!(!f.root.join(&entity.file_path).exists());
}

#[test]
fn all_text_exports_preserve_internal_headings_and_fenced_hash_lines() {
    let f = Fixture::new();
    save_document(SaveDocumentInput {
        project_path: f.path.clone(),
        node_id: f.chapter.id.clone(),
        content: "# 第一章\n\n# INTERNAL_HEADING\n\n~~~text\n# CODE_SENTINEL\n~~~\n".into(),
        reason: "test".into(),
    })
    .unwrap();
    for format in ["markdown", "txt", "html", "docx", "epub"] {
        let output = export_project(ExportInput {
            project_path: f.path.clone(),
            format: format.into(),
            scope: None,
            volume_path: None,
            node_ids: None,
            title: None,
            author: None,
            include_toc: Some(false),
            include_volume_titles: None,
            include_chapter_titles: None,
            cover_path: None,
        })
        .unwrap();
        let text = if format == "docx" || format == "epub" {
            use std::io::Read;
            let mut zip = zip::ZipArchive::new(fs::File::open(output).unwrap()).unwrap();
            let mut text = String::new();
            for index in 0..zip.len() {
                let mut entry = zip.by_index(index).unwrap();
                if entry.name().ends_with(".xml") || entry.name().ends_with(".xhtml") {
                    let mut body = String::new();
                    entry.read_to_string(&mut body).unwrap();
                    // Word may split a visible word across runs; compare rendered text.
                    let mut in_tag = false;
                    for ch in body.chars() {
                        if ch == '<' {
                            in_tag = true;
                        } else if ch == '>' {
                            in_tag = false;
                        } else if !in_tag {
                            text.push(ch);
                        }
                    }
                }
            }
            text
        } else {
            fs::read_to_string(output).unwrap()
        };
        assert!(text.contains("INTERNAL_HEADING"), "{format}");
        assert!(text.contains("CODE_SENTINEL"), "{format}");
    }
}

#[test]
fn self_and_parent_locks_protect_body_and_history_until_unlocked() {
    let f = Fixture::new();
    let before = fs::read(f.root.join(&f.chapter.file_path)).unwrap();
    for id in [&f.chapter.id, &f.volume.id] {
        set_node_status(NodeStatusInput {
            project_path: f.path.clone(),
            node_id: id.clone(),
            status: "locked".into(),
        })
        .unwrap();
        let locked = fs::read(f.root.join(&f.chapter.file_path)).unwrap();
        let error = save_document(SaveDocumentInput {
            project_path: f.path.clone(),
            node_id: f.chapter.id.clone(),
            content: "must not save".into(),
            reason: "test".into(),
        })
        .unwrap_err();
        assert!(error.contains("锁定"));
        assert!(rename_node(crate::models::RenameNodeInput {
            project_path: f.path.clone(),
            node_id: f.chapter.id.clone(),
            title: "must not rename".into()
        })
        .unwrap_err()
        .contains("锁定"));
        assert_eq!(fs::read(f.root.join(&f.chapter.file_path)).unwrap(), locked);
        assert!(list_recovery(f.path.clone()).unwrap().is_empty());
        set_node_status(NodeStatusInput {
            project_path: f.path.clone(),
            node_id: id.clone(),
            status: "draft".into(),
        })
        .unwrap();
    }
    assert_eq!(
        storage::strip_markdown_frontmatter(&String::from_utf8(before).unwrap()),
        get_document(f.action(&f.chapter.id)).unwrap().content
    );
    save_document(SaveDocumentInput {
        project_path: f.path.clone(),
        node_id: f.chapter.id.clone(),
        content: "unlocked edit".into(),
        reason: "test".into(),
    })
    .unwrap();
}

#[test]
fn damaged_history_does_not_block_body_saves_and_write_failure_keeps_recovery() {
    let f = Fixture::new();
    let save = |content: &str| SaveDocumentInput {
        project_path: f.path.clone(),
        node_id: f.chapter.id.clone(),
        content: content.into(),
        reason: "自动保存".into(),
    };
    save_document(save("第一份稿件")).unwrap();
    let history = list_history(f.action(&f.chapter.id)).unwrap();
    fs::remove_file(f.root.join(&history[0].path)).unwrap();
    let saved = guard::save_document_checked(save("第二份稿件"), "第一份稿件".into()).unwrap();
    assert!(saved.history_created);
    assert_eq!(
        get_document(f.action(&f.chapter.id)).unwrap().content,
        "第二份稿件"
    );
    let latest = list_history(f.action(&f.chapter.id)).unwrap();
    assert_eq!(latest.len(), 2);
    assert_eq!(
        read_history(RevisionActionInput {
            project_path: f.path.clone(),
            revision_id: latest[0].id.clone()
        })
        .unwrap(),
        "第二份稿件"
    );
    // Make the history directory unwritable as a directory, without relying on ACLs.
    let directory = f.root.join(".novelforge/history").join(&f.chapter.id);
    fs::rename(&directory, directory.with_extension("held")).unwrap();
    fs::write(&directory, b"not a directory").unwrap();
    assert!(guard::save_document_checked(save("第三份必须保留"), "第二份稿件".into()).is_err());
    assert_eq!(
        get_document(f.action(&f.chapter.id)).unwrap().content,
        "第二份稿件"
    );
    assert!(!list_recovery(f.path.clone()).unwrap().is_empty());
    assert!(recovery::create_history_snapshot(recovery::SnapshotInput {
        project_path: f.path.clone(),
        node_id: f.chapter.id.clone(),
        content: "保护内容".into(),
        kind: recovery::SnapshotKind::Protected,
        name: Some("测试".into())
    })
    .is_err());
}

#[test]
fn history_pages_use_stable_cursor_and_filter_before_limiting() {
    let f = Fixture::new();
    let (_, connection) = project_connection(&f.path).unwrap();
    for i in 0..205 {
        connection.execute("INSERT INTO revisions (id,node_id,node_title,reason,word_count,created_at,file_path) VALUES (?1,?2,'章',?3,1,'2026-09-11T00:00:00Z','test.md')", params![format!("h{i}"),f.chapter.id,if i==0 {"命名版本：最早的里程碑"} else {"自动保存"}]).unwrap();
    }
    let page = storage::history::history_page(&connection, &f.chapter.id, None, "all").unwrap();
    assert_eq!(page.len(), 101);
    assert_eq!(page[0].id, "h204");
    let next =
        storage::history::history_page(&connection, &f.chapter.id, Some(&page[99].id), "all")
            .unwrap();
    assert_eq!(next[0].id, "h104");
    let named = storage::history::history_page(&connection, &f.chapter.id, None, "named").unwrap();
    assert_eq!(named.len(), 1);
    assert_eq!(named[0].id, "h0");
    assert!(
        storage::history::history_page(&connection, "other", Some(&page[99].id), "all")
            .unwrap()
            .is_empty()
    );
    assert!(storage::history::history_page(&connection, &f.chapter.id, None, "unknown").is_err());
}

#[test]
fn renamed_document_baseline_is_returned_and_external_changes_are_rejected() {
    let f = Fixture::new();
    let before = get_document(f.action(&f.chapter.id)).unwrap().content;
    let result = guard::rename_node_checked(
        crate::models::RenameNodeInput {
            project_path: f.path.clone(),
            node_id: f.chapter.id.clone(),
            title: "新的名字".into(),
        },
        Some(before),
    )
    .unwrap();
    let value = serde_json::to_value(result).unwrap();
    let content = value["document"]["content"].as_str().unwrap().to_string();
    assert!(content.starts_with("# 新的名字"));
    guard::save_document_checked(
        SaveDocumentInput {
            project_path: f.path.clone(),
            node_id: f.chapter.id.clone(),
            content: format!("{content}继续写作"),
            reason: "自动保存".into(),
        },
        content.clone(),
    )
    .unwrap();
    assert!(guard::rename_node_checked(
        crate::models::RenameNodeInput {
            project_path: f.path.clone(),
            node_id: f.chapter.id.clone(),
            title: "不应改名".into()
        },
        Some(content)
    )
    .unwrap_err()
    .contains("EXTERNAL_CONFLICT"));
}

#[test]
fn backup_restores_trash_without_accessing_the_original_project() {
    let f = Fixture::new();
    let volume_data = create_node(NodeInput {
        project_path: f.path.clone(),
        parent_id: None,
        kind: "volume".into(),
        title: "备份回收卷".into(),
    })
    .unwrap();
    let volume = volume_data
        .nodes
        .iter()
        .find(|n| n.title == "备份回收卷")
        .unwrap()
        .clone();
    let chapter_data = create_node(NodeInput {
        project_path: f.path.clone(),
        parent_id: Some(volume.id.clone()),
        kind: "chapter".into(),
        title: "回收章".into(),
    })
    .unwrap();
    let chapter = chapter_data
        .nodes
        .iter()
        .find(|n| n.title == "回收章")
        .unwrap()
        .clone();
    let section_data = create_node(NodeInput {
        project_path: f.path.clone(),
        parent_id: Some(chapter.id.clone()),
        kind: "section".into(),
        title: "独立回收节".into(),
    })
    .unwrap();
    let section = section_data
        .nodes
        .iter()
        .find(|n| n.title == "独立回收节")
        .unwrap()
        .clone();
    let attachment = f.import();
    delete_node(f.action(&section.id)).unwrap();
    delete_node(f.action(&volume.id)).unwrap();
    delete_entity(f.action(&attachment.id)).unwrap();
    let target =
        std::env::temp_dir().join(format!("novelforge-backup-portable-{}", storage::new_id()));
    fs::create_dir(&target).unwrap();
    let report = tauri::async_runtime::block_on(backup::backup_project(
        f.path.clone(),
        target.to_string_lossy().into(),
    ))
    .unwrap();
    let restored = tauri::async_runtime::block_on(backup::restore_backup(
        report.path,
        target.to_string_lossy().into(),
    ))
    .unwrap();
    fs::rename(
        f.root.join("trash/items"),
        f.root.join("trash/original-items-unavailable"),
    )
    .unwrap();
    open_project(restored.path.clone()).unwrap();
    for id in [&volume.id, &section.id, &attachment.id] {
        let trash = list_trash(restored.path.clone())
            .unwrap()
            .into_iter()
            .find(|item| &item.ref_id == id)
            .unwrap();
        restore_trash(crate::models::NodeActionInput {
            project_path: restored.path.clone(),
            node_id: trash.id,
        })
        .unwrap();
    }
    assert!(list_trash(restored.path.clone()).unwrap().is_empty());
    assert!(get_document(crate::models::NodeActionInput {
        project_path: restored.path.clone(),
        node_id: chapter.id
    })
    .is_ok());
    assert_eq!(
        fs::read(Path::new(&restored.path).join(attachment.file_path)).unwrap(),
        b"unchanged attachment bytes\0\xff"
    );
    guard::release_project(restored.path).unwrap();
    fs::remove_dir_all(target).unwrap();
}

#[test]
fn statistics_group_utc_records_by_the_requested_local_day() {
    use chrono::TimeZone;
    let f = Fixture::new();
    let (_, connection) = project_connection(&f.path).unwrap();
    connection.execute("INSERT INTO activity(id,node_id,created_at,delta_words,word_count) VALUES ('local-day',?1,'2026-09-10T18:00:00Z',100,100)",params![f.chapter.id]).unwrap();
    let zone = chrono::FixedOffset::east_opt(8 * 3600).unwrap();
    let now = zone.with_ymd_and_hms(2026, 9, 11, 14, 0, 0).unwrap();
    let stats = statistics::get_statistics_at(
        crate::models::StatisticsInput {
            project_path: f.path.clone(),
            current_node_id: None,
        },
        now,
    )
    .unwrap();
    assert_eq!(stats.today_words, 100);
    assert_eq!(stats.yesterday_words, 0);
    assert_eq!(stats.daily.last().unwrap().date, "2026-09-11");
    assert_eq!(stats.daily.last().unwrap().words, 100);
    assert_eq!(stats.writing_streak, 1);
    // The same UTC timestamp belongs to the previous local day in a western zone.
    let west = chrono::FixedOffset::west_opt(7 * 3600).unwrap();
    let stats = statistics::get_statistics_at(
        crate::models::StatisticsInput {
            project_path: f.path.clone(),
            current_node_id: None,
        },
        west.with_ymd_and_hms(2026, 9, 11, 1, 0, 0).unwrap(),
    )
    .unwrap();
    assert_eq!(stats.today_words, 0);
    assert_eq!(stats.yesterday_words, 100);
}
