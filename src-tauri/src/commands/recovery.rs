use super::*;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryActionInput {
    pub project_path: String,
    pub recovery_id: String,
}
fn recovery_path(root: &Path, recovery_id: &str) -> Result<PathBuf, String> {
    if recovery_id.contains('/') || recovery_id.contains('\\') || !recovery_id.ends_with(".md") {
        return Err("恢复文件名无效".to_string());
    }
    storage::safe_relative(root, &format!(".novelforge/recovery/{}", recovery_id))
}

#[tauri::command]
pub fn list_recovery(path: String) -> Result<Vec<RecoveryItem>, String> {
    let (root, connection) = project_connection(&path)?;
    storage::recovery_items(&root, &connection)
}

#[tauri::command]
pub fn read_recovery(input: RecoveryActionInput) -> Result<String, String> {
    let (root, _connection) = project_connection(&input.project_path)?;
    fs::read_to_string(recovery_path(&root, &input.recovery_id)?)
        .map_err(|error| format!("无法读取恢复内容：{}", error))
}

#[tauri::command]
pub fn restore_recovery(input: RecoveryActionInput) -> Result<ProjectData, String> {
    let (root, mut connection) = project_connection(&input.project_path)?;
    let node_id = input.recovery_id.split("--").next().unwrap_or_default().to_string();
    if node_id.is_empty() {
        return Err("恢复文件关联的章节无效".to_string());
    }
    let recovery_file = recovery_path(&root, &input.recovery_id)?;
    let content = fs::read_to_string(&recovery_file)
        .map_err(|error| format!("无法读取恢复内容：{}", error))?;
    preserve_current_revision(&root, &connection, &node_id, "恢复前自动快照")?;
    save_document_internal(&root, &mut connection, &node_id, &content, "崩溃恢复")?;
    storage::remove_file_if_exists(&recovery_file)?;
    project_data(&root, &connection)
}

#[tauri::command]
pub fn discard_recovery(input: RecoveryActionInput) -> Result<Vec<RecoveryItem>, String> {
    let (root, connection) = project_connection(&input.project_path)?;
    storage::remove_file_if_exists(&recovery_path(&root, &input.recovery_id)?)?;
    storage::recovery_items(&root, &connection)
}

#[tauri::command]
pub fn list_history(input: crate::models::NodeActionInput) -> Result<Vec<HistoryItem>, String> {
    let (_root, connection) = project_connection(&input.project_path)?;
    storage::history_items(&connection, &input.node_id)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RevisionActionInput {
    pub project_path: String,
    pub revision_id: String,
}

#[tauri::command]
pub fn read_history(input: RevisionActionInput) -> Result<String, String> {
    let (root, connection) = project_connection(&input.project_path)?;
    let path: String = connection
        .query_row("SELECT file_path FROM revisions WHERE id = ?1", params![input.revision_id], |row| row.get(0))
        .map_err(|error| format!("版本不存在：{}", error))?;
    let content = fs::read_to_string(storage::safe_relative(&root, &path)?)
        .map_err(|error| format!("无法读取历史内容：{}", error))?;
    Ok(storage::strip_markdown_frontmatter(&content))
}

#[tauri::command]
pub fn restore_history(input: RevisionActionInput) -> Result<ProjectData, String> {
    let (root, mut connection) = project_connection(&input.project_path)?;
    let (node_id, path): (String, String) = connection
        .query_row("SELECT node_id, file_path FROM revisions WHERE id = ?1", params![input.revision_id], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(|error| format!("版本不存在：{}", error))?;
    let content = fs::read_to_string(storage::safe_relative(&root, &path)?)
        .map_err(|error| format!("无法读取历史内容：{}", error))?;
    preserve_current_revision(&root, &connection, &node_id, "恢复前自动快照")?;
    save_document_internal(&root, &mut connection, &node_id, &content, "恢复历史版本")?;
    project_data(&root, &connection)
}
