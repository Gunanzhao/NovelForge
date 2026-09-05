use super::*;

#[tauri::command]
pub fn upsert_entity(input: EntityInput) -> Result<ProjectData, String> {
    if input.title.trim().is_empty() {
        return Err("条目名称不能为空".to_string());
    }
    let (root, mut connection) = project_connection(&input.project_path)?;
    let timestamp = storage::now();
    let entity_id = input.id.clone().unwrap_or_else(storage::new_id);
    let existing = storage::entity_from_id(&connection, &entity_id)?;
    if let Some(entity) = existing.as_ref() {
        if entity.deleted_at.is_some() {
            return Err("回收站中的资料不能直接编辑，请先恢复".to_string());
        }
        if entity.kind != input.kind {
            return Err("资料类型不能在编辑时修改".to_string());
        }
    }
    let file_path = if let Some(entity) = existing.as_ref() {
        entity.file_path.clone()
    } else {
        let directory = storage::kind_directory(&input.kind)?;
        format!(
            "{}/{}-{}.md",
            directory,
            safe_filename(&input.title),
            entity_id
        )
    };
    let content_json = serde_json::to_string(&input.content)
        .map_err(|error| format!("资料内容序列化失败：{}", error))?;
    let tags_json =
        serde_json::to_string(&input.tags).map_err(|error| format!("标签序列化失败：{}", error))?;
    let target = if input.kind == "attachment" {
        None
    } else {
        Some(storage::safe_relative(&root, &file_path)?)
    };
    let old_existed = target.as_ref().is_some_and(|path| path.is_file());
    let old_content = if let Some(target) = target.as_ref().filter(|path| path.is_file()) {
        Some(fs::read_to_string(target).map_err(|error| format!("读取原资料镜像失败：{}", error))?)
    } else {
        None
    };
    if let Some(target) = target.as_ref() {
        let created_at = existing
            .as_ref()
            .map(|entity| entity.created_at.as_str())
            .unwrap_or(timestamp.as_str());
        let markdown = storage::markdown_entity_with_metadata(
            &entity_id,
            &input.kind,
            created_at,
            &timestamp,
            input.title.trim(),
            &input.content,
            &input.tags,
        );
        storage::atomic_write(target, markdown.as_bytes())?;
    }
    let index_content = if input.kind == "attachment" {
        input.content.to_string()
    } else {
        storage::markdown_entity(&input.title, &input.content, &input.tags)
    };
    let entity_created_at = existing
        .as_ref()
        .map(|entity| entity.created_at.clone())
        .unwrap_or_else(|| timestamp.clone());
    let database_result = (|| -> Result<(), String> {
        let transaction = connection
            .transaction()
            .map_err(|error| format!("无法开始保存资料事务：{}", error))?;
        transaction
            .execute(
                "INSERT INTO entities (id, kind, title, content_json, tags_json, file_path, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8) ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, title = excluded.title, content_json = excluded.content_json, tags_json = excluded.tags_json, file_path = excluded.file_path, updated_at = excluded.updated_at, deleted_at = NULL, deleted_path = NULL",
                params![entity_id, input.kind, input.title.trim(), content_json, tags_json, file_path, entity_created_at, timestamp],
            )
            .map_err(|error| format!("保存资料条目失败：{}", error))?;
        storage::index_record(
            &transaction,
            &entity_id,
            &input.kind,
            input.title.trim(),
            &index_content,
            &file_path,
        )?;
        transaction
            .commit()
            .map_err(|error| format!("提交资料保存事务失败：{}", error))
    })();
    if let Err(error) = database_result {
        if let Some(target) = target.as_ref() {
            let previous = old_content.as_deref().unwrap_or("");
            if let Err(rollback_error) =
                restore_document_after_save_failure(target, old_existed, previous)
            {
                return Err(format!("{}；资料镜像回滚失败：{}", error, rollback_error));
            }
        }
        return Err(error);
    }
    touch_project_best_effort(&root, "project_metadata_touch_failed");
    let _ = storage::append_log(&root, "INFO", "entity_saved");
    project_data(&root, &connection)
}

fn attachment_extension(name: &str) -> String {
    Path::new(name)
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or("")
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .take(12)
        .collect()
}

fn attachment_filename(name: &str, id: &str) -> String {
    let stem = Path::new(name)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("attachment");
    let stem = safe_filename(stem);
    let extension = attachment_extension(name);
    if extension.is_empty() {
        format!("{}-{}", stem, id)
    } else {
        format!("{}-{}.{}", stem, id, extension)
    }
}

fn attachment_mime(name: &str) -> &'static str {
    match attachment_extension(name).to_lowercase().as_str() {
        "md" | "markdown" => "text/markdown",
        "txt" => "text/plain",
        "json" => "application/json",
        "pdf" => "application/pdf",
        "doc" => "application/msword",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "epub" => "application/epub+zip",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "mp4" => "video/mp4",
        _ => "application/octet-stream",
    }
}

#[tauri::command]
pub fn import_attachment(input: crate::models::AttachmentInput) -> Result<ProjectData, String> {
    if input.source_path.trim().is_empty() {
        return Err("附件路径不能为空".to_string());
    }
    let source = PathBuf::from(&input.source_path);
    let source_metadata =
        fs::metadata(&source).map_err(|error| format!("无法读取附件：{}", error))?;
    if !source_metadata.is_file() {
        return Err("只能导入文件，不能导入文件夹".to_string());
    }
    let (root, connection) = project_connection(&input.project_path)?;
    let id = storage::new_id();
    let original_name = source
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("附件")
        .to_string();
    let relative_path = format!("attachments/{}", attachment_filename(&original_name, &id));
    let destination = storage::safe_relative(&root, &relative_path)?;
    fs::copy(&source, &destination).map_err(|error| format!("复制附件失败：{}", error))?;
    let timestamp = storage::now();
    let content = serde_json::json!({
        "originalName": original_name,
        "mimeType": attachment_mime(&original_name),
        "sizeBytes": source_metadata.len(),
        "description": input.description.trim(),
    });
    let content_json = serde_json::to_string(&content)
        .map_err(|error| format!("附件信息序列化失败：{}", error))?;
    let database_result = (|| -> Result<(), String> {
        connection.execute(
            "INSERT INTO entities (id, kind, title, content_json, tags_json, file_path, created_at, updated_at) VALUES (?1, 'attachment', ?2, ?3, ?4, ?5, ?6, ?7)",
            params![id, original_name, content_json, serde_json::json!(["附件"]).to_string(), relative_path, timestamp, timestamp],
        ).map_err(|error| format!("保存附件资料失败：{}", error))?;
        storage::index_record(
            &connection,
            &id,
            "attachment",
            &original_name,
            &content.to_string(),
            &relative_path,
        )?;
        storage::touch_project(&root)?;
        Ok(())
    })();
    if let Err(error) = database_result {
        let _ = fs::remove_file(&destination);
        let _ = connection.execute("DELETE FROM entities WHERE id = ?1", params![id]);
        let _ = connection.execute("DELETE FROM search_index WHERE ref_id = ?1", params![id]);
        return Err(error);
    }
    project_data(&root, &connection)
}

#[tauri::command]
pub fn open_attachment(input: crate::models::NodeActionInput) -> Result<String, String> {
    let (root, connection) = project_connection(&input.project_path)?;
    let entity = storage::entity_from_id(&connection, &input.node_id)?
        .ok_or_else(|| "附件不存在".to_string())?;
    if entity.kind != "attachment" {
        return Err("只能打开附件条目".to_string());
    }
    let absolute = storage::safe_relative(&root, &entity.file_path)?;
    if !absolute.is_file() {
        return Err("附件文件不存在，可能已被外部程序移动".to_string());
    }
    #[cfg(target_os = "windows")]
    std::process::Command::new("explorer.exe")
        .arg(&absolute)
        .spawn()
        .map_err(|error| format!("无法打开附件：{}", error))?;
    #[cfg(target_os = "macos")]
    std::process::Command::new("open")
        .arg(&absolute)
        .spawn()
        .map_err(|error| format!("无法打开附件：{}", error))?;
    #[cfg(target_os = "linux")]
    std::process::Command::new("xdg-open")
        .arg(&absolute)
        .spawn()
        .map_err(|error| format!("无法打开附件：{}", error))?;
    Ok(absolute.to_string_lossy().to_string())
}

pub(crate) fn safe_filename(title: &str) -> String {
    let cleaned: String = title
        .chars()
        .filter(|character| character.is_alphanumeric() || *character == '-' || *character == '_')
        .take(48)
        .collect();
    if cleaned.is_empty() {
        "entry".to_string()
    } else {
        cleaned
    }
}

#[tauri::command]
pub fn delete_entity(input: crate::models::NodeActionInput) -> Result<ProjectData, String> {
    let (root, mut connection) = project_connection(&input.project_path)?;
    let entity = storage::entity_from_id(&connection, &input.node_id)?
        .ok_or_else(|| "资料条目不存在".to_string())?;
    if entity.deleted_at.is_some() {
        return Err("条目已经在回收站".to_string());
    }
    let original_absolute = storage::safe_relative(&root, &entity.file_path)?;
    let trash_path = storage::move_to_trash(&root, &original_absolute, &entity.id)?;
    let deleted_at = storage::now();
    let database_result = (|| -> Result<(), String> {
        let transaction = connection
            .transaction()
            .map_err(|error| format!("无法开始资料删除事务：{}", error))?;
        transaction
            .execute(
                "UPDATE entities SET deleted_at = ?1, deleted_path = ?2 WHERE id = ?3",
                params![deleted_at, trash_path, entity.id],
            )
            .map_err(|error| format!("移入回收站失败：{}", error))?;
        transaction
            .execute(
                "DELETE FROM search_index WHERE ref_id = ?1",
                params![entity.id],
            )
            .map_err(|error| format!("删除搜索索引失败：{}", error))?;
        transaction
            .execute(
                "INSERT INTO trash_items (id, ref_id, ref_kind, title, original_path, trash_path, deleted_at) VALUES (?1, ?2, 'entity', ?3, ?4, ?5, ?6)",
                params![storage::new_id(), entity.id, entity.title, entity.file_path, trash_path, deleted_at],
            )
            .map_err(|error| format!("记录回收站失败：{}", error))?;
        transaction
            .commit()
            .map_err(|error| format!("提交资料删除事务失败：{}", error))
    })();
    if let Err(error) = database_result {
        return match fs::rename(Path::new(&trash_path), &original_absolute) {
            Ok(()) => Err(format!("{}；资料文件已恢复到原位置", error)),
            Err(rollback_error) => Err(format!("{}；资料文件回滚失败：{}", error, rollback_error)),
        };
    }
    storage::touch_project(&root)?;
    project_data(&root, &connection)
}

#[tauri::command]
pub fn list_entities(path: String, kind: Option<String>) -> Result<Vec<EntityRecord>, String> {
    let (_root, connection) = project_connection(&path)?;
    let entities = storage::all_entities(&connection, false)?;
    Ok(match kind {
        Some(kind) => entities
            .into_iter()
            .filter(|entity| entity.kind == kind)
            .collect(),
        None => entities,
    })
}
