use super::entity_history::EntityState;
use super::*;
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfirmMemory {
    pub project_path: String,
    pub entity_id: String,
    pub expected: EntityState,
}
#[tauri::command]
pub fn confirm_chapter_memory(input: ConfirmMemory) -> Result<ProjectData, String> {
    let _serial = guard::SAVES.lock().map_err(|_| "正文保存锁不可用")?;
    let (root, db) = project_connection(&input.project_path)?;
    let entity = storage::entity_from_id(&db, &input.entity_id)?.ok_or("章节记忆不存在")?;
    if entity.kind != "chapter-memory"
        || entity.deleted_at.is_some()
        || EntityState::from(&entity) != input.expected
    {
        return Err("章节记忆已变化，请重新审阅".into());
    }
    let node_id = entity.content["chapterId"].as_str().ok_or("来源章节缺失")?;
    let node = storage::node_from_id(&db, node_id)?.ok_or("来源章节不存在")?;
    if node.deleted_at.is_some() || node.kind == "volume" {
        return Err("来源章节不可用".into());
    }
    let raw = fs::read_to_string(storage::safe_relative(&root, &node.file_path)?)
        .map_err(|e| e.to_string())?;
    let content = storage::strip_markdown_frontmatter(&raw);
    if entity.content["sourceText"].as_str() != Some(&content) {
        return Err("来源正文已变化，请重新核对后更新记忆草稿".into());
    }
    let sources = entity.content["sources"]
        .as_array()
        .ok_or("请添加来源段落")?;
    if sources.is_empty() {
        return Err("至少添加一处原文依据后再确认".into());
    }
    let utf16: Vec<_> = content.encode_utf16().collect();
    for source in sources {
        let from = source["from"].as_u64().ok_or("来源范围无效")? as usize;
        let to = source["to"].as_u64().ok_or("来源范围无效")? as usize;
        if from >= to
            || to > utf16.len()
            || !matches!(
                source["field"].as_str(),
                Some(
                    "summary"
                        | "events"
                        | "knowledge"
                        | "changes"
                        | "planted"
                        | "resolved"
                        | "next"
                )
            )
        {
            return Err("来源范围或字段无效".into());
        }
        if String::from_utf16(&utf16[from..to]).map_err(|e| e.to_string())?
            != source["quote"].as_str().ok_or("来源引文无效")?
        {
            return Err("来源引文与原文不一致".into());
        }
    }
    let mut next = entity.content.clone();
    next["status"] = serde_json::json!("confirmed");
    next["confirmedAt"] = serde_json::json!(storage::now());
    entities::upsert_entity_versioned(
        EntityInput {
            project_path: input.project_path,
            id: Some(entity.id),
            kind: entity.kind,
            title: entity.title,
            content: next,
            tags: entity.tags,
        },
        Some(&input.expected),
        "作者确认章节记忆",
    )
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn confirmation_requires_saved_source_matching_citations_and_current_entity() {
        let root = std::env::temp_dir().join(format!("novelforge-memory-{}", storage::new_id()));
        fs::create_dir_all(&root).unwrap();
        let path = root.to_string_lossy().into_owned();
        let data = create_project(ProjectInput {
            path: path.clone(),
            title: "记忆测试".into(),
            author: "".into(),
            description: "".into(),
            genre: "".into(),
            target_words: 1,
        })
        .unwrap();
        let chapter = data
            .nodes
            .iter()
            .find(|node| node.kind == "chapter")
            .unwrap();
        let source = "🌙林月拿到了钥匙。";
        let (_, mut db) = project_connection(&path).unwrap();
        save_document_internal(&root, &mut db, &chapter.id, source, "测试").unwrap();
        let save = |content: serde_json::Value| {
            upsert_entity(EntityInput {
                project_path: path.clone(),
                id: Some("memory".into()),
                kind: "chapter-memory".into(),
                title: "章节记忆".into(),
                content,
                tags: vec![],
            })
            .unwrap()
            .entities
            .into_iter()
            .find(|entity| entity.id == "memory")
            .unwrap()
        };
        let mut content = serde_json::json!({"chapterId":chapter.id,"sourceText":source,"summary":"林月取得钥匙","status":"draft","sources":[]});
        let draft = save(content.clone());
        assert!(confirm_chapter_memory(ConfirmMemory {
            project_path: path.clone(),
            entity_id: draft.id.clone(),
            expected: EntityState::from(&draft)
        })
        .is_err());
        content["sources"] = serde_json::json!([{"id":"s","field":"summary","from":2,"to":10,"quote":"林月拿到了钥匙。"}]);
        let draft = save(content);
        let confirmed = confirm_chapter_memory(ConfirmMemory {
            project_path: path.clone(),
            entity_id: draft.id.clone(),
            expected: EntityState::from(&draft),
        })
        .unwrap();
        assert_eq!(
            confirmed
                .entities
                .iter()
                .find(|e| e.id == draft.id)
                .unwrap()
                .content["status"],
            "confirmed"
        );
        assert!(confirm_chapter_memory(ConfirmMemory {
            project_path: path.clone(),
            entity_id: draft.id.clone(),
            expected: EntityState::from(&draft)
        })
        .is_err());
        let latest = storage::entity_from_id(&db, &draft.id).unwrap().unwrap();
        save_document_internal(&root, &mut db, &chapter.id, "正文已变化", "测试").unwrap();
        assert!(confirm_chapter_memory(ConfirmMemory {
            project_path: path.clone(),
            entity_id: latest.id.clone(),
            expected: EntityState::from(&latest)
        })
        .is_err());
        drop(db);
        guard::release_project(path).unwrap();
        fs::remove_dir_all(root).unwrap();
    }
}
