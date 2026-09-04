use super::*;

#[tauri::command]
pub fn create_project(input: ProjectInput) -> Result<ProjectData, String> {
    if input.title.trim().is_empty() {
        return Err("作品名不能为空".to_string());
    }
    let root = storage::new_project_root(&input.path)?;
    storage::create_project_directories(&root)?;
    let timestamp = storage::now();
    let metadata = ProjectMetadata {
        format_version: 1,
        id: storage::new_id(),
        title: input.title.trim().to_string(),
        author: input.author.trim().to_string(),
        description: input.description.trim().to_string(),
        genre: input.genre.trim().to_string(),
        target_words: input.target_words,
        created_at: timestamp.clone(),
        updated_at: timestamp.clone(),
    };
    storage::write_project_json(&root, &metadata)?;
    let connection = storage::open_db(&root)?;

    let volume_id = storage::new_id();
    let volume_path = "manuscript/volume_001".to_string();
    let volume_absolute = storage::safe_relative(&root, &volume_path)?;
    fs::create_dir_all(&volume_absolute)
        .map_err(|error| format!("无法创建初始卷：{}", error))?;
    let volume_status = default_status().to_string();
    let volume_mirror = storage::markdown_volume(
        &volume_id,
        "第一卷",
        &volume_status,
        &timestamp,
        &timestamp,
    );
    storage::atomic_write(&volume_absolute.join(".novelforge.md"), volume_mirror.as_bytes())?;
    insert_node(
        &connection,
        &NodeRecord {
            id: volume_id.clone(),
            kind: "volume".to_string(),
            parent_id: None,
            title: "第一卷".to_string(),
            order_index: 0,
            status: volume_status,
            file_path: volume_path,
            created_at: timestamp.clone(),
            updated_at: timestamp.clone(),
            deleted_at: None,
            deleted_path: None,
        },
    )?;

    let chapter_id = storage::new_id();
    let chapter_path = "manuscript/volume_001/chapter_001.md".to_string();
    let chapter = NodeRecord {
        id: chapter_id.clone(),
        kind: "chapter".to_string(),
        parent_id: Some(volume_id),
        title: "第一章".to_string(),
        order_index: 0,
        status: "draft".to_string(),
        file_path: chapter_path.clone(),
        created_at: timestamp.clone(),
        updated_at: timestamp,
        deleted_at: None,
        deleted_path: None,
    };
    let starter_body = "# 第一章\n\n从这里开始你的故事。\n";
    let starter = storage::markdown_node(
        &chapter.id,
        &chapter.kind,
        chapter.parent_id.as_deref(),
        &chapter.status,
        &chapter.created_at,
        &chapter.updated_at,
        starter_body,
    );
    storage::atomic_write(&storage::safe_relative(&root, &chapter_path)?, starter.as_bytes())?;
    insert_node(&connection, &chapter)?;
    storage::index_record(&connection, &chapter.id, &chapter.kind, &chapter.title, starter_body, &chapter.file_path)?;
    let _ = storage::append_log(&root, "INFO", "project_created");
    project_data(&root, &connection)
}
#[tauri::command]
pub fn open_project(path: String) -> Result<ProjectData, String> {
    let root = storage::existing_project_root(&path)?;
    let database_path = storage::safe_relative(&root, ".novelforge/database.sqlite")?;
    if !database_path.is_file() {
        validate_recovery_tree(&root)?;
    }
    let mut connection = match storage::open_db(&root) {
        Ok(connection) if storage::all_nodes(&connection, false).is_ok() && storage::all_entities(&connection, false).is_ok() => connection,
        Ok(connection) => {
            drop(connection);
            recovered_project_connection(&root)?
        }
        Err(_) => recovered_project_connection(&root)?,
    };
    let nodes_empty = storage::all_nodes(&connection, false)?.is_empty();
    let entities_empty = storage::all_entities(&connection, false)?.is_empty();
    if nodes_empty || entities_empty {
        rebuild_project_from_files(&root, &mut connection, nodes_empty, entities_empty)?;
    }
    storage::refresh_search_index(&root, &connection)?;
    let _ = storage::append_log(&root, "INFO", "project_opened");
    project_data(&root, &connection)
}

#[tauri::command]
pub fn list_documents(path: String) -> Result<Vec<NodeRecord>, String> {
    let (_root, connection) = project_connection(&path)?;
    storage::all_nodes(&connection, false)
}

#[tauri::command]
pub fn read_logs(path: String) -> Result<String, String> {
    let (root, _connection) = project_connection(&path)?;
    storage::read_logs(&root)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSettingsInput {
    pub project_path: String,
    pub title: String,
    pub author: String,
    pub description: String,
    pub genre: String,
    pub target_words: u64,
}

#[tauri::command]
pub fn update_project(input: ProjectSettingsInput) -> Result<ProjectData, String> {
    if input.title.trim().is_empty() {
        return Err("作品名不能为空".to_string());
    }
    let (root, connection) = project_connection(&input.project_path)?;
    let mut metadata = storage::read_project_json(&root)?;
    metadata.title = input.title.trim().to_string();
    metadata.author = input.author.trim().to_string();
    metadata.description = input.description.trim().to_string();
    metadata.genre = input.genre.trim().to_string();
    metadata.target_words = input.target_words;
    metadata.updated_at = storage::now();
    storage::write_project_json(&root, &metadata)?;
    let _ = storage::append_log(&root, "INFO", "project_settings_updated");
    project_data(&root, &connection)
}
