use super::*;

#[tauri::command]
pub fn create_project(input: ProjectInput) -> Result<ProjectData, String> {
    if input.title.trim().is_empty() {
        return Err("作品名不能为空".to_string());
    }
    let root = storage::new_project_root(&input.path)?;
    create_project_staged(root, input, initialize_project)
}

fn create_project_staged(
    root: PathBuf,
    input: ProjectInput,
    initialize: impl FnOnce(PathBuf, ProjectInput) -> Result<ProjectData, String>,
) -> Result<ProjectData, String> {
    let parent = root.parent().ok_or("不能在文件系统根目录创建项目")?;
    let stage = parent.join(format!(".novelforge-init-{}", storage::new_id()));
    fs::create_dir(&stage).map_err(|error| format!("无法创建初始化暂存目录：{error}"))?;
    let result = initialize(stage.clone(), input);
    let data = match result {
        Ok(data) => data,
        Err(error) => {
            return match fs::remove_dir_all(&stage) {
                Ok(()) => Err(error),
                Err(cleanup) => Err(format!(
                    "{error}；清理暂存目录失败（{}）：{cleanup}",
                    stage.display()
                )),
            };
        }
    };
    // remove_dir succeeds only for an empty destination. Never merge a new
    // project into existing files, even if another writer populated it meanwhile.
    if let Err(error) = fs::remove_dir(&root) {
        let cleanup = fs::remove_dir_all(&stage);
        return Err(format!(
            "项目目标目录不再为空或无法访问，已取消创建：{error}；暂存清理：{cleanup:?}"
        ));
    }
    if let Err(error) = fs::rename(&stage, &root) {
        let _ = fs::create_dir(&root);
        return Err(format!(
            "无法完成项目创建：{error}；完整暂存项目保留于 {}",
            stage.display()
        ));
    }
    Ok(data)
}

fn initialize_project(root: PathBuf, input: ProjectInput) -> Result<ProjectData, String> {
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
    fs::create_dir_all(&volume_absolute).map_err(|error| format!("无法创建初始卷：{}", error))?;
    let volume_status = default_status().to_string();
    let volume_mirror =
        storage::markdown_volume(&volume_id, "第一卷", &volume_status, &timestamp, &timestamp);
    storage::atomic_write(
        &volume_absolute.join(".novelforge.md"),
        volume_mirror.as_bytes(),
    )?;
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
    storage::atomic_write(
        &storage::safe_relative(&root, &chapter_path)?,
        starter.as_bytes(),
    )?;
    insert_node(&connection, &chapter)?;
    storage::index_record(
        &connection,
        &chapter.id,
        &chapter.kind,
        &chapter.title,
        starter_body,
        &chapter.file_path,
    )?;
    let _ = storage::append_log(&root, "INFO", "project_created");
    project_data(&root, &connection)
}
#[tauri::command]
pub fn open_project(path: String) -> Result<ProjectData, String> {
    let root = storage::existing_project_root(&path)?;
    let lease = super::guard::begin(&root)?;
    let data = open_project_inner(&root)?;
    lease.finish_implicit()?;
    Ok(data)
}
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedProject {
    data: ProjectData,
    lease_token: String,
}
#[tauri::command]
pub fn prepare_open_project(path: String) -> Result<PreparedProject, String> {
    let root = storage::existing_project_root(&path)?;
    let lease = super::guard::begin(&root)?;
    let data = open_project_inner(&root)?;
    Ok(PreparedProject {
        data,
        lease_token: lease.retain(),
    })
}
fn open_project_inner(root: &Path) -> Result<ProjectData, String> {
    let database_path = storage::safe_relative(root, ".novelforge/database.sqlite")?;
    if !database_path.is_file() {
        // Do not leave a newly initialized, empty database behind when recovery fails.
        let connection = recovered_project_connection(root)?;
        entities::backfill_attachment_mirrors(root, &connection)?;
        let _ = storage::append_log(root, "INFO", "project_opened");
        return project_data(root, &connection);
    }
    let mut connection = match storage::open_db(root) {
        Ok(connection)
            if storage::all_nodes(&connection, false).is_ok()
                && storage::all_entities(&connection, false).is_ok() =>
        {
            connection
        }
        Ok(connection) => {
            drop(connection);
            recovered_project_connection(root)?
        }
        Err(_) => recovered_project_connection(root)?,
    };
    let nodes_empty = storage::all_nodes(&connection, false)?.is_empty();
    let entities_empty = storage::all_entities(&connection, false)?.is_empty();
    if nodes_empty || entities_empty {
        rebuild_project_from_files(root, &mut connection, nodes_empty, entities_empty)?;
    }
    entities::backfill_attachment_mirrors(root, &connection)?;
    storage::refresh_search_index(root, &connection)?;
    let _ = storage::append_log(root, "INFO", "project_opened");
    project_data(root, &connection)
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

#[cfg(test)]
mod initialization_tests {
    use super::*;
    fn input(root: &Path) -> ProjectInput {
        ProjectInput {
            path: root.to_string_lossy().into(),
            title: "初始化保护".into(),
            author: String::new(),
            description: String::new(),
            genre: String::new(),
            target_words: 1000,
        }
    }
    fn fixture() -> (PathBuf, PathBuf) {
        let base = std::env::temp_dir().join(format!("novelforge-init-test-{}", storage::new_id()));
        let target = base.join("project");
        fs::create_dir_all(&target).unwrap();
        (base, target)
    }
    #[test]
    fn rejects_existing_manuscript_without_writing_any_project_files() {
        let (base, target) = fixture();
        let manuscript = target.join("manuscript/volume_001/chapter_001.md");
        fs::create_dir_all(manuscript.parent().unwrap()).unwrap();
        fs::write(&manuscript, "EXISTING_MANUSCRIPT").unwrap();
        let error = create_project(input(&target)).unwrap_err();
        assert!(error.contains("空文件夹"));
        assert_eq!(
            fs::read_to_string(&manuscript).unwrap(),
            "EXISTING_MANUSCRIPT"
        );
        assert!(!target.join("project.json").exists());
        assert!(!target.join(".novelforge").exists());
        fs::remove_dir_all(base).unwrap();
    }
    #[test]
    fn initialization_failure_leaves_destination_empty_and_removes_stage() {
        let (base, target) = fixture();
        let error = create_project_staged(target.clone(), input(&target), |stage, _| {
            fs::write(stage.join("partial"), "partial").unwrap();
            Err("injected initialization failure".into())
        })
        .unwrap_err();
        assert!(error.contains("injected"));
        assert_eq!(fs::read_dir(&target).unwrap().count(), 0);
        assert_eq!(fs::read_dir(&base).unwrap().count(), 1);
        fs::remove_dir_all(base).unwrap();
    }
    #[test]
    fn concurrent_destination_write_is_preserved_and_prevents_publish() {
        let (base, target) = fixture();
        let sentinel = target.join("concurrent.txt");
        let result = create_project_staged(target.clone(), input(&target), |stage, value| {
            let data = initialize_project(stage, value)?;
            fs::write(&sentinel, "CONCURRENT_WRITER").unwrap();
            Ok(data)
        });
        assert!(result.unwrap_err().contains("取消创建"));
        assert_eq!(fs::read_to_string(sentinel).unwrap(), "CONCURRENT_WRITER");
        assert!(!target.join("project.json").exists());
        assert_eq!(fs::read_dir(&base).unwrap().count(), 1);
        fs::remove_dir_all(base).unwrap();
    }
}
