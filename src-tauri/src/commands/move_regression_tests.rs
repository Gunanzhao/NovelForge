use super::*;

struct Fixture(PathBuf);

impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("novelforge-move-{}", storage::new_id()));
        fs::create_dir_all(&root).unwrap();
        Self(fs::canonicalize(root).unwrap())
    }

    fn path(&self) -> String {
        self.0.to_string_lossy().into_owned()
    }

    fn project(&self) -> ProjectData {
        create_project(ProjectInput {
            path: self.path(),
            title: "移动回滚".into(),
            author: String::new(),
            description: String::new(),
            genre: String::new(),
            target_words: 0,
        })
        .unwrap()
    }

    fn node(&self, kind: &str, parent: Option<&str>, title: &str) -> NodeRecord {
        create_node(
            serde_json::from_value(serde_json::json!({
                "projectPath": self.path(), "kind": kind, "parentId": parent, "title": title,
            }))
            .unwrap(),
        )
        .unwrap()
        .nodes
        .into_iter()
        .find(|node| node.title == title)
        .unwrap()
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn sql_failure_restores_cross_volume_chapter_sections_and_rebuilt_parents() {
    let fixture = Fixture::new();
    let initial = fixture.project();
    let first_volume = initial
        .nodes
        .iter()
        .find(|node| node.kind == "volume")
        .unwrap();
    let second_volume = fixture.node("volume", None, "第二卷");
    let chapter = fixture.node("chapter", Some(&second_volume.id), "移动章节");
    let section = fixture.node("section", Some(&chapter.id), "移动小节");
    // Preserve CRLF, user frontmatter and trailing whitespace byte-for-byte.
    for node in [&chapter, &section] {
        let raw = storage::markdown_node(
            &node.id,
            &node.kind,
            node.parent_id.as_deref(),
            &node.status,
            &node.created_at,
            &node.updated_at,
            "---\ntitle: 用户字段\n---\n# 自定义标题\n\n正文  \n",
        )
        .replace('\n', "\r\n");
        fs::write(fixture.0.join(&node.file_path), raw).unwrap();
    }
    let original_chapter = fs::read(fixture.0.join(&chapter.file_path)).unwrap();
    let original_section = fs::read(fixture.0.join(&section.file_path)).unwrap();
    // Fail after the chapter row was updated, during its child's path update.
    let (_, connection) = project_connection(&fixture.path()).unwrap();
    connection
        .execute_batch(
            "CREATE TRIGGER fail_move BEFORE UPDATE OF file_path ON nodes
        WHEN OLD.kind = 'section' BEGIN SELECT RAISE(ABORT, 'injected move failure'); END;",
        )
        .unwrap();
    let before = serde_json::to_value(storage::all_nodes(&connection, true).unwrap()).unwrap();
    let nodes = storage::all_nodes(&connection, true).unwrap();
    let (target, _) =
        next_node_location(&fixture.0, &nodes, "chapter", Some(first_volume)).unwrap();
    drop(connection);
    let error = move_node(MoveNodeInput {
        project_path: fixture.path(),
        node_id: chapter.id.clone(),
        target_parent_id: Some(first_volume.id.clone()),
        target_order_index: None,
    })
    .unwrap_err();
    assert!(error.contains("injected move failure"), "{error}");
    assert!(error.contains("移动已回滚"), "{error}");
    assert_eq!(
        fs::read(fixture.0.join(&chapter.file_path)).unwrap(),
        original_chapter
    );
    assert_eq!(
        fs::read(fixture.0.join(&section.file_path)).unwrap(),
        original_section
    );
    assert!(!fixture.0.join(&target).exists());
    assert!(!fixture.0.join(move_sidecar_relative(&target)).exists());
    let (_, connection) = project_connection(&fixture.path()).unwrap();
    assert_eq!(
        serde_json::to_value(storage::all_nodes(&connection, true).unwrap()).unwrap(),
        before
    );
    drop(connection);
    let recovered = recovered_project_connection(&fixture.0).unwrap();
    let recovered_chapter = storage::node_from_id(&recovered, &chapter.id)
        .unwrap()
        .unwrap();
    let recovered_section = storage::node_from_id(&recovered, &section.id)
        .unwrap()
        .unwrap();
    assert_eq!(recovered_chapter.parent_id, Some(second_volume.id));
    assert_eq!(recovered_section.parent_id, Some(chapter.id));
    assert_eq!(recovered_chapter.file_path, chapter.file_path);
    assert_eq!(recovered_section.file_path, section.file_path);
    assert_eq!(
        fs::read(fixture.0.join(&chapter.file_path)).unwrap(),
        original_chapter
    );
    assert_eq!(
        fs::read(fixture.0.join(&section.file_path)).unwrap(),
        original_section
    );
}

#[test]
fn sql_failure_restores_section_mirror_and_database() {
    let fixture = Fixture::new();
    let initial = fixture.project();
    let chapter = initial
        .nodes
        .iter()
        .find(|node| node.kind == "chapter")
        .unwrap();
    let other = fixture.node("chapter", chapter.parent_id.as_deref(), "目标章");
    let section = fixture.node("section", Some(&chapter.id), "小节");
    let original = fs::read(fixture.0.join(&section.file_path)).unwrap();
    let (_, connection) = project_connection(&fixture.path()).unwrap();
    connection
        .execute_batch(
            "CREATE TRIGGER fail_move BEFORE UPDATE OF parent_id ON nodes
        BEGIN SELECT RAISE(ABORT, 'section move failure'); END;",
        )
        .unwrap();
    drop(connection);
    let error = move_node(MoveNodeInput {
        project_path: fixture.path(),
        node_id: section.id.clone(),
        target_parent_id: Some(other.id),
        target_order_index: None,
    })
    .unwrap_err();
    assert!(error.contains("section move failure"));
    assert!(error.contains("移动已回滚"));
    assert_eq!(
        fs::read(fixture.0.join(&section.file_path)).unwrap(),
        original
    );
    let (_, connection) = project_connection(&fixture.path()).unwrap();
    let restored = storage::node_from_id(&connection, &section.id)
        .unwrap()
        .unwrap();
    assert_eq!(
        serde_json::to_value(restored).unwrap(),
        serde_json::to_value(section).unwrap()
    );
}

#[test]
fn volume_rollback_preserves_exact_mirror_or_original_absence() {
    for original in [Some(b"\xff\xfeoriginal volume\r\n".as_slice()), None] {
        let fixture = Fixture::new();
        fs::create_dir(fixture.0.join("volume")).unwrap();
        if let Some(bytes) = original {
            fs::write(fixture.0.join("volume/.novelforge.md"), bytes).unwrap();
        }
        let snapshot = read_move_mirror(&fixture.0, "volume", "volume").unwrap();
        move_node_files(&fixture.0, "volume", "moved", "volume").unwrap();
        fs::write(fixture.0.join("moved/.novelforge.md"), "changed").unwrap();
        rollback_node_move(
            &fixture.0,
            "volume",
            "moved",
            "volume",
            false,
            snapshot.as_deref(),
        )
        .unwrap();
        assert_eq!(
            read_move_mirror(&fixture.0, "volume", "volume")
                .unwrap()
                .as_deref(),
            original
        );
        assert!(!fixture.0.join("moved").exists());
    }
}

#[test]
fn rollback_reports_both_rename_failures_without_overwriting_blockers() {
    let fixture = Fixture::new();
    fs::write(fixture.0.join("source.md"), "original").unwrap();
    fs::create_dir(fixture.0.join("source")).unwrap();
    fs::write(fixture.0.join("source/section.md"), "section").unwrap();
    let snapshot = read_move_mirror(&fixture.0, "source.md", "chapter").unwrap();
    assert!(move_node_files(&fixture.0, "source.md", "target.md", "chapter").unwrap());
    fs::write(fixture.0.join("target.md"), "changed").unwrap();
    fs::write(fixture.0.join("source.md"), "blocker").unwrap();
    fs::create_dir(fixture.0.join("source")).unwrap();
    let error = rollback_node_move(
        &fixture.0,
        "source.md",
        "target.md",
        "chapter",
        true,
        snapshot.as_deref(),
    )
    .unwrap_err();
    assert!(
        error.contains("移动目标已存在，拒绝覆盖：source；"),
        "{error}"
    );
    assert!(
        error.contains("移动目标已存在，拒绝覆盖：source.md"),
        "{error}"
    );
    assert_eq!(fs::read(fixture.0.join("source.md")).unwrap(), b"blocker");
    assert_eq!(fs::read(fixture.0.join("target.md")).unwrap(), b"original");
    assert_eq!(
        fs::read(fixture.0.join("target/section.md")).unwrap(),
        b"section"
    );
}

#[test]
fn sidecar_move_failure_returns_chapter_to_original_position() {
    let fixture = Fixture::new();
    fs::write(fixture.0.join("source.md"), "original").unwrap();
    fs::create_dir(fixture.0.join("source")).unwrap();
    fs::create_dir(fixture.0.join("target")).unwrap();
    let error = move_node_files(&fixture.0, "source.md", "target.md", "chapter").unwrap_err();
    assert!(error.contains("拒绝覆盖：target"));
    assert!(error.contains("移动已回滚"));
    assert_eq!(fs::read(fixture.0.join("source.md")).unwrap(), b"original");
    assert!(!fixture.0.join("target.md").exists());
    assert!(fixture.0.join("source").is_dir());
}

#[test]
fn rollback_rechecks_paths_after_directory_is_replaced_by_external_link() {
    for replace_source in [false, true] {
        let fixture = Fixture::new();
        let outside = Fixture::new();
        fs::create_dir(fixture.0.join("source")).unwrap();
        fs::create_dir(fixture.0.join("target")).unwrap();
        fs::write(fixture.0.join("source/chapter.md"), "original").unwrap();
        let snapshot = read_move_mirror(&fixture.0, "source/chapter.md", "chapter").unwrap();
        move_node_files(
            &fixture.0,
            "source/chapter.md",
            "target/chapter.md",
            "chapter",
        )
        .unwrap();
        let name = if replace_source { "source" } else { "target" };
        let link = fixture.0.join(name);
        fs::rename(&link, fixture.0.join("preserved")).unwrap();
        fs::write(outside.0.join("chapter.md"), "external original").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(&outside.0, &link).unwrap();
        #[cfg(windows)]
        {
            let result = std::process::Command::new("cmd")
                .args(["/C", "mklink", "/J"])
                .arg(&link)
                .arg(&outside.0)
                .output()
                .unwrap();
            assert!(result.status.success(), "{:?}", result);
        }
        let error = rollback_node_move(
            &fixture.0,
            "source/chapter.md",
            "target/chapter.md",
            "chapter",
            false,
            snapshot.as_deref(),
        )
        .unwrap_err();
        assert!(!error.is_empty());
        assert_eq!(
            fs::read(outside.0.join("chapter.md")).unwrap(),
            b"external original"
        );
        let retained = if replace_source {
            "target/chapter.md"
        } else {
            "preserved/chapter.md"
        };
        assert_eq!(fs::read(fixture.0.join(retained)).unwrap(), b"original");
        #[cfg(windows)]
        fs::remove_dir(&link).unwrap();
        #[cfg(unix)]
        fs::remove_file(&link).unwrap();
    }
}
