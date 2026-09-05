use super::*;
use serde_json::json;

struct Fixture(PathBuf);

impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!(
            "novelforge-recovery-regression-{}",
            storage::new_id()
        ));
        fs::create_dir_all(&root).unwrap();
        Self(root)
    }

    fn project(&self) -> ProjectData {
        create_project(ProjectInput {
            path: self.0.to_string_lossy().into_owned(),
            title: "测试".into(),
            author: String::new(),
            description: String::new(),
            genre: String::new(),
            target_words: 0,
        })
        .unwrap()
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn directory_link(target: &Path, link: &Path) {
    #[cfg(unix)]
    std::os::unix::fs::symlink(target, link).unwrap();
    #[cfg(windows)]
    {
        // Junctions exercise Windows reparse-point boundaries without symlink privileges.
        let output = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(link.to_string_lossy().replace('/', "\\"))
            .arg(target.to_string_lossy().replace('/', "\\"))
            .output()
            .unwrap();
        assert!(output.status.success(), "junction failed: {:?}", output);
    }
}

fn remove_directory_link(link: &Path) {
    #[cfg(windows)]
    fs::remove_dir(link).unwrap();
    #[cfg(unix)]
    fs::remove_file(link).unwrap();
}

#[test]
fn entity_structured_mirror_roundtrips_exact_markdown_and_json_types() {
    let fixture = Fixture::new();
    let path = fixture.0.join("entity.md");
    let title = "  \"标题\"\n# 标题内换行  ";
    let tags = vec!["含、分隔符".into(), "换\n行".into(), "".into()];
    for content in [
        json!({
            "prompt": "  开始\n\n第二段\n# 一级\n## 二级\n标签：正文\n---\n```json\n{}\n```\n  ",
            "description": "介绍\n\n# 标题", "summary": "摘要\n\n末尾", "notes": "备注",
            "empty": "", "numericString": "123", "boolString": "true", "nullString": "null",
            "number": 123, "boolean": false, "null": null, "nested": {"list": [1, "x", null]}
        }),
        json!(null),
        json!(["a", 1]),
        json!("正文\n\n## 标题"),
    ] {
        let raw = storage::markdown_entity_with_metadata(
            &storage::new_id(),
            "note",
            "created",
            "updated",
            title,
            &content,
            &tags,
        );
        fs::write(&path, &raw).unwrap();
        let (actual_title, actual_tags, actual_content, metadata) =
            parse_entity_mirror(&path, "fallback").unwrap();
        assert_eq!(actual_title, title);
        assert_eq!(actual_tags, tags);
        assert_eq!(actual_content, content);
        assert_eq!(metadata.unwrap().created_at.as_deref(), Some("created"));
        assert!(raw.contains("# "));
    }
}

#[test]
fn legacy_mirrors_remain_readable_and_user_frontmatter_is_untouched() {
    let fixture = Fixture::new();
    let path = fixture.0.join("old.md");
    for prefix in [
        String::new(),
        format!(
            "---\nnovelforgeId: {}\nnovelforgeKind: character\n---\n",
            storage::new_id()
        ),
    ] {
        fs::write(
            &path,
            format!(
                "{}# 林月\n\n标签：主角、人物\n\n## identity\n\n守夜人\n\n旧介绍\n",
                prefix
            ),
        )
        .unwrap();
        let (title, tags, content, _) = parse_entity_mirror(&path, "fallback").unwrap();
        assert_eq!(title, "林月");
        assert_eq!(tags, vec!["主角", "人物"]);
        assert_eq!(
            content,
            json!({"identity":"守夜人", "description":"旧介绍"})
        );
    }
    let raw = "---\ntitle: user title\nstatus: draft\n---\n# 正文\n";
    assert!(storage::parse_markdown_mirror(raw).0.is_none());
    assert_eq!(storage::strip_markdown_frontmatter(raw), raw);
}

#[test]
fn malformed_or_future_entity_metadata_fails_without_lossy_fallback() {
    let fixture = Fixture::new();
    let path = fixture.0.join("bad.md");
    for data in [
        "{broken",
        r#"{"version":2,"title":"x","tags":[],"content":{}}"#,
        r#"{"version":1,"title":"x","tags":"bad","content":{}}"#,
        r#"{"version":1,"title":"x","tags":[]}"#,
    ] {
        fs::write(
            &path,
            format!("---\nnovelforgeEntity: {}\n---\n# body\n", data),
        )
        .unwrap();
        assert!(parse_entity_mirror(&path, "fallback").is_err());
    }
    fs::write(
        &path,
        "---\nnovelforgeEntity: {}\n# missing closing delimiter",
    )
    .unwrap();
    assert!(parse_entity_mirror(&path, "fallback").is_err());
}

#[test]
fn manually_edited_body_conflicts_are_explicit_and_crlf_is_accepted() {
    let fixture = Fixture::new();
    let path = fixture.0.join("edited.md");
    let raw = storage::markdown_entity_with_metadata(
        &storage::new_id(),
        "note",
        "c",
        "u",
        "标题",
        &json!({"notes":"正文"}),
        &[],
    );
    fs::write(&path, raw.replace('\n', "\r\n")).unwrap();
    assert!(parse_entity_mirror(&path, "fallback").is_ok());
    fs::write(&path, format!("\u{feff}{}", raw.replace('\n', "\r\n"))).unwrap();
    assert!(parse_entity_mirror(&path, "fallback").is_ok());
    for edited in [format!("{raw} "), raw.replacen("---\n#", "---\n \n#", 1)] {
        fs::write(&path, edited).unwrap();
        assert!(parse_entity_mirror(&path, "fallback")
            .unwrap_err()
            .contains("不一致"));
    }
    fs::write(&path, format!("{raw}\n人工追加")).unwrap();
    assert!(parse_entity_mirror(&path, "fallback")
        .unwrap_err()
        .contains("不一致"));
}

#[test]
fn entity_and_node_status_survive_database_recovery() {
    let fixture = Fixture::new();
    let project = fixture.project();
    let project_path = fixture.0.to_string_lossy().into_owned();
    let content = json!({"prompt":"第一段\n\n# 标题\n\n## 内标题\n末尾", "notes":"备注\n\n结束"});
    let entity = upsert_entity(EntityInput {
        project_path: project_path.clone(),
        id: None,
        kind: "prompt-preset".into(),
        title: "提示词".into(),
        content: content.clone(),
        tags: vec!["a、b".into()],
    })
    .unwrap();
    for node in &project.nodes {
        let updated = set_node_status(NodeStatusInput {
            project_path: project_path.clone(),
            node_id: node.id.clone(),
            status: "locked".into(),
        })
        .unwrap();
        let node = updated
            .nodes
            .iter()
            .find(|item| item.id == node.id)
            .unwrap();
        let path = if node.kind == "volume" {
            fixture.0.join(&node.file_path).join(".novelforge.md")
        } else {
            fixture.0.join(&node.file_path)
        };
        let raw = fs::read_to_string(path).unwrap();
        let metadata = storage::parse_markdown_mirror(&raw).0.unwrap();
        assert_eq!(metadata.status.as_deref(), Some("locked"));
        assert_eq!(
            metadata.updated_at.as_deref(),
            Some(node.updated_at.as_str())
        );
    }
    fs::write(
        fixture.0.join(".novelforge/database.sqlite"),
        b"corrupt database",
    )
    .unwrap();
    let recovered = open_project(project_path).unwrap();
    assert!(recovered.nodes.iter().all(|node| node.status == "locked"));
    let recovered_entity = recovered
        .entities
        .iter()
        .find(|item| {
            item.id
                == entity
                    .entities
                    .iter()
                    .find(|item| item.kind == "prompt-preset")
                    .unwrap()
                    .id
        })
        .unwrap();
    assert_eq!(recovered_entity.content, content);
    assert_eq!(recovered_entity.tags, vec!["a、b"]);
}

#[test]
fn status_mirror_read_failure_preserves_database() {
    let fixture = Fixture::new();
    let project = fixture.project();
    let node = project
        .nodes
        .iter()
        .find(|node| node.kind == "volume")
        .unwrap();
    let target = fixture.0.join(&node.file_path).join(".novelforge.md");
    fs::remove_file(&target).unwrap();
    // A directory in place of the mirror must be an error, never an empty-body fallback.
    fs::create_dir(&target).unwrap();
    assert!(set_node_status(NodeStatusInput {
        project_path: fixture.0.to_string_lossy().into_owned(),
        node_id: node.id.clone(),
        status: "done".into()
    })
    .is_err());
    let connection = storage::open_db(&fixture.0).unwrap();
    let actual = storage::node_from_id(&connection, &node.id)
        .unwrap()
        .unwrap();
    assert_eq!(actual.status, node.status);
    assert_eq!(actual.updated_at, node.updated_at);
}

#[test]
fn status_commit_failure_restores_exact_mirror_and_database() {
    let fixture = Fixture::new();
    let project = fixture.project();
    let node = project
        .nodes
        .iter()
        .find(|node| node.kind == "chapter")
        .unwrap();
    let target = fixture.0.join(&node.file_path);
    let bytes = fs::read(&target).unwrap();
    let reader = storage::open_db(&fixture.0).unwrap();
    reader.execute_batch("BEGIN; SELECT * FROM nodes;").unwrap();
    let error = set_node_status(NodeStatusInput {
        project_path: fixture.0.to_string_lossy().into_owned(),
        node_id: node.id.clone(),
        status: "done".into(),
    })
    .unwrap_err();
    assert!(error.contains("提交状态事务失败"), "{error}");
    reader.execute_batch("ROLLBACK").unwrap();
    assert_eq!(fs::read(target).unwrap(), bytes);
    let actual = storage::node_from_id(&reader, &node.id).unwrap().unwrap();
    assert_eq!(actual.status, node.status);
    assert_eq!(actual.updated_at, node.updated_at);
}

#[test]
fn unreadable_manuscript_and_history_abort_recovery_without_rewriting_sources() {
    for history in [false, true] {
        let fixture = Fixture::new();
        let project = fixture.project();
        let node = project
            .nodes
            .iter()
            .find(|node| node.kind == "chapter")
            .unwrap();
        let path = if history {
            let directory = fixture.0.join(".novelforge/history").join(&node.id);
            fs::create_dir_all(&directory).unwrap();
            directory.join(format!("{}.md", storage::new_id()))
        } else {
            fixture.0.join(&node.file_path)
        };
        fs::write(&path, [0xff]).unwrap();
        let database = fixture.0.join(".novelforge/database.sqlite");
        let original = fs::read(&database).unwrap();
        assert!(recovered_project_connection(&fs::canonicalize(&fixture.0).unwrap()).is_err());
        assert_eq!(fs::read(database).unwrap(), original);
        assert_eq!(fs::read(path).unwrap(), vec![0xff]);
    }
}

#[test]
fn failure_after_quarantine_restores_original_database_and_all_sidecars() {
    let fixture = Fixture::new();
    fixture.project();
    let bad_mirror = fixture.0.join("characters/bad.md");
    fs::write(&bad_mirror, [0xff, 0xfe]).unwrap();
    let chapter = fixture.0.join("manuscript/volume_001/chapter_001.md");
    let original_mirror = fs::read(&chapter).unwrap();
    let mut originals = Vec::new();
    for suffix in ["", "-wal", "-shm", "-journal"] {
        let path = fixture
            .0
            .join(format!(".novelforge/database.sqlite{}", suffix));
        let bytes = format!("original bytes {}", suffix).into_bytes();
        fs::write(&path, &bytes).unwrap();
        originals.push((path, bytes));
    }
    let error = recovered_project_connection(&fs::canonicalize(&fixture.0).unwrap()).unwrap_err();
    assert!(error.contains("原数据库已恢复"), "{error}");
    for (path, bytes) in originals {
        assert_eq!(fs::read(path).unwrap(), bytes);
    }
    assert_eq!(fs::read(chapter).unwrap(), original_mirror);
}

#[test]
fn final_project_validation_failure_also_restores_original_database() {
    let fixture = Fixture::new();
    fixture.project();
    let database = fixture.0.join(".novelforge/database.sqlite");
    let bytes = fs::read(&database).unwrap();
    fs::write(fixture.0.join("project.json"), "invalid json").unwrap();
    assert!(recovered_project_connection(&fs::canonicalize(&fixture.0).unwrap()).is_err());
    assert_eq!(fs::read(database).unwrap(), bytes);
}

#[test]
fn recovery_prescan_includes_nested_recovery_paths_before_quarantine() {
    assert!(RECOVERY_DIRECTORIES.contains(&".novelforge/recovery"));
    let fixture = Fixture::new();
    fixture.project();
    let outside = Fixture::new();
    let link = fixture.0.join(".novelforge/recovery/outside");
    directory_link(&outside.0, &link);
    let database = fixture.0.join(".novelforge/database.sqlite");
    let bytes = fs::read(&database).unwrap();
    assert!(recovered_project_connection(&fs::canonicalize(&fixture.0).unwrap()).is_err());
    assert_eq!(fs::read(database).unwrap(), bytes);
    remove_directory_link(&link);
}

#[test]
fn internal_recovery_directory_link_is_accepted() {
    let fixture = Fixture::new();
    fixture.project();
    let target = fixture.0.join("internal-recovery");
    fs::create_dir(&target).unwrap();
    let link = fixture.0.join(".novelforge/recovery/internal");
    directory_link(&target, &link);
    recovered_project_connection(&fs::canonicalize(&fixture.0).unwrap()).unwrap();
    remove_directory_link(&link);
}

#[test]
fn rollback_rechecks_logical_backup_and_destination_boundaries() {
    for replace_backup in [false, true] {
        let fixture = Fixture::new();
        let outside = Fixture::new();
        let backup_dir = fixture.0.join("backup");
        let destination_dir = fixture.0.join("destination");
        fs::create_dir(&backup_dir).unwrap();
        fs::create_dir(&destination_dir).unwrap();
        let moved = vec![("destination/db".into(), "backup/db".into())];
        storage::safe_relative(&fixture.0, "destination/db").unwrap();
        storage::safe_relative(&fixture.0, "backup/db").unwrap();
        let swapped = if replace_backup {
            &backup_dir
        } else {
            &destination_dir
        };
        fs::remove_dir(swapped).unwrap();
        fs::write(outside.0.join("db"), "outside original").unwrap();
        if !replace_backup {
            fs::write(backup_dir.join("db"), "backup original").unwrap();
        }
        directory_link(&outside.0, swapped);
        assert!(restore_database_files(&fixture.0, &moved).is_err());
        assert_eq!(
            fs::read_to_string(outside.0.join("db")).unwrap(),
            "outside original"
        );
        if !replace_backup {
            assert_eq!(
                fs::read_to_string(backup_dir.join("db")).unwrap(),
                "backup original"
            );
        }
        remove_directory_link(swapped);
    }
}

#[test]
fn corrupt_empty_and_missing_database_failures_preserve_source_files() {
    for state in ["corrupt", "empty", "missing"] {
        let fixture = Fixture::new();
        let project = fixture.project();
        let database = fixture.0.join(".novelforge/database.sqlite");
        match state {
            "corrupt" => fs::write(&database, "not a database").unwrap(),
            "empty" => {
                let connection = storage::open_db(&fixture.0).unwrap();
                connection
                    .execute_batch("DELETE FROM nodes; DELETE FROM search_index;")
                    .unwrap();
            }
            "missing" => fs::remove_file(&database).unwrap(),
            _ => unreachable!(),
        }
        let original_database = if database.exists() {
            Some(fs::read(&database).unwrap())
        } else {
            None
        };
        let chapter = project
            .nodes
            .iter()
            .find(|node| node.kind == "chapter")
            .unwrap();
        let chapter_path = fixture.0.join(&chapter.file_path);
        let original_chapter = fs::read(&chapter_path).unwrap();
        let bad = fixture.0.join("characters/bad.md");
        let bad_content = "---\nnovelforgeEntity: {broken}\n---\n# 人工内容\n";
        fs::write(&bad, bad_content).unwrap();
        assert!(
            open_project(fixture.0.to_string_lossy().into_owned()).is_err(),
            "{state}"
        );
        assert_eq!(
            fs::read(&chapter_path).unwrap(),
            original_chapter,
            "{state}"
        );
        assert_eq!(fs::read_to_string(bad).unwrap(), bad_content, "{state}");
        match original_database {
            Some(bytes) => assert_eq!(fs::read(&database).unwrap(), bytes, "{state}"),
            None => assert!(!database.exists(), "missing database must remain missing"),
        }
    }
}

#[test]
fn empty_database_project_validation_failure_rolls_back_rebuilt_rows_and_indexes() {
    let fixture = Fixture::new();
    fixture.project();
    let connection = storage::open_db(&fixture.0).unwrap();
    connection
        .execute_batch("DELETE FROM nodes; DELETE FROM search_index;")
        .unwrap();
    // recovery_items currently enumerates Markdown files; project.json is the parsed JSON input.
    fs::write(fixture.0.join("project.json"), "{bad json").unwrap();
    let error = open_project(fixture.0.to_string_lossy().into_owned()).unwrap_err();
    assert!(error.contains("project.json"), "{error}");
    for table in ["nodes", "entities", "revisions", "search_index"] {
        let count: i64 = connection
            .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(count, 0, "{table} must roll back");
    }
}
