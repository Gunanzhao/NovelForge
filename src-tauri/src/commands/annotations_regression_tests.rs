use super::*;
#[test]
fn annotation_tracking_commits_with_body_and_preserves_deleted_targets_on_reopen() {
    let root = std::env::temp_dir().join(format!("novelforge-annotation-{}", storage::new_id()));
    fs::create_dir_all(&root).unwrap();
    let path = root.to_string_lossy().into_owned();
    let data = create_project(ProjectInput {
        path: path.clone(),
        title: "批注测试".into(),
        author: "".into(),
        description: "".into(),
        genre: "".into(),
        target_words: 1,
    })
    .unwrap();
    let chapter = data.nodes.iter().find(|n| n.kind == "chapter").unwrap();
    let source = "重复段落。重复段落。";
    let (_, mut db) = project_connection(&path).unwrap();
    save_document_internal(&root, &mut db, &chapter.id, source, "测试").unwrap();
    let annotation=upsert_entity(EntityInput{project_path:path.clone(),id:Some("annotation-one".into()),kind:"annotation".into(),title:"核对这处".into(),content:serde_json::json!({"chapterId":chapter.id,"sourceText":source,"from":0,"to":4,"anchorRevision":"revision-one","body":"核对内容","category":"revision","status":"open"}),tags:vec![]}).unwrap().entities.into_iter().find(|e|e.id=="annotation-one").unwrap();
    let input = || SaveDocumentInput {
        project_path: path.clone(),
        node_id: chapter.id.clone(),
        content: "重复段落。".into(),
        reason: "批注测试".into(),
    };
    let anchor = || crate::models::AnnotationAnchor {
        id: annotation.id.clone(),
        revision: "revision-one".into(),
        from: 0,
        to: 0,
        orphaned: true,
    };
    let original = fs::read(root.join(&chapter.file_path)).unwrap();
    db.execute_batch("CREATE TRIGGER fail_annotation BEFORE INSERT ON annotation_tracking BEGIN SELECT RAISE(FAIL,'injected'); END;").unwrap();
    assert!(guard::save_document_annotated(input(), source.into(), Some(vec![anchor()])).is_err());
    assert_eq!(fs::read(root.join(&chapter.file_path)).unwrap(), original);
    assert!(
        storage::database::read_annotation_tracking(&db, &chapter.id)
            .unwrap()
            .is_none()
    );
    db.execute_batch("DROP TRIGGER fail_annotation;").unwrap();
    let saved =
        guard::save_document_annotated(input(), source.into(), Some(vec![anchor()])).unwrap();
    assert!(saved.annotation_tracking.unwrap().anchors[0].orphaned);
    let reopened = get_document(crate::models::NodeActionInput {
        project_path: path.clone(),
        node_id: chapter.id.clone(),
    })
    .unwrap();
    assert_eq!(reopened.content, "重复段落。");
    assert!(reopened.annotation_tracking.unwrap().anchors[0].orphaned);
    let mut wrong = anchor();
    wrong.revision = "stale".into();
    assert!(
        guard::save_document_annotated(input(), "重复段落。".into(), Some(vec![wrong])).is_err()
    );
    assert!(root.join(&annotation.file_path).is_file());
    drop(db);
    guard::release_project(path).unwrap();
    fs::remove_dir_all(root).unwrap();
}
