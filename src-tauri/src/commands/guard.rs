use super::*;
use std::sync::Mutex;
static LEASES: OnceLock<Mutex<HashMap<PathBuf, fs::File>>> = OnceLock::new();
static SAVES: Mutex<()> = Mutex::new(());
pub fn acquire(root: &Path) -> Result<(), String> {
    let canonical = root.canonicalize().map_err(|e| e.to_string())?;
    let mut leases = LEASES
        .get_or_init(Default::default)
        .lock()
        .map_err(|_| "项目锁不可用")?;
    if leases.contains_key(&canonical) {
        return Ok(());
    }
    let path = storage::safe_relative(root, ".novelforge/session.lock")?;
    let file = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(path)
        .map_err(|e| format!("无法建立项目锁：{e}"))?;
    file.try_lock()
        .map_err(|_| "项目已在另一个 NovelForge 进程中打开，请关闭该进程中的项目后重试。")?;
    leases.insert(canonical, file);
    Ok(())
}
#[tauri::command]
pub fn release_project(path: String) -> Result<(), String> {
    let root = storage::existing_project_root(&path)?
        .canonicalize()
        .map_err(|e| e.to_string())?;
    LEASES
        .get_or_init(Default::default)
        .lock()
        .map_err(|_| "项目锁不可用")?
        .remove(&root);
    Ok(())
}
#[tauri::command]
pub fn save_document_checked(
    input: SaveDocumentInput,
    expected_content: String,
) -> Result<DocumentData, String> {
    let _serial = SAVES.lock().map_err(|_| "正文保存锁不可用")?;
    let (root, mut connection) = project_connection(&input.project_path)?;
    let node = storage::node_from_id(&connection, &input.node_id)?.ok_or("章节不存在")?;
    manuscript::ensure_body_unlocked(&connection, &input.node_id)?;
    let path = storage::safe_relative(&root, &node.file_path)?;
    let disk = fs::read_to_string(&path).map(|raw| storage::strip_markdown_frontmatter(&raw));
    if disk.as_ref().ok() != Some(&expected_content) {
        let (_, recovery_path) = storage::write_recovery(&root, &input.node_id, &input.content)?;
        return Err(format!(
            "EXTERNAL_CONFLICT:磁盘正文已变化或无法读取，已暂停覆盖。当前内容的恢复副本：{}",
            recovery_path
        ));
    }
    save_document_internal(
        &root,
        &mut connection,
        &input.node_id,
        &input.content,
        &input.reason,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn conflict_preserves_disk_and_recovery_then_allows_reviewed_save() {
        let path = std::env::temp_dir().join(format!("novelforge-conflict-{}", storage::new_id()));
        fs::create_dir(&path).unwrap();
        let input = ProjectInput {
            path: path.to_string_lossy().into_owned(),
            title: "冲突测试".into(),
            author: "".into(),
            description: "".into(),
            genre: "".into(),
            target_words: 1000,
        };
        let data = create_project(input).unwrap();
        let chapter = data.nodes.iter().find(|n| n.kind == "chapter").unwrap();
        let file = path.join(&chapter.file_path);
        let original = storage::strip_markdown_frontmatter(&fs::read_to_string(&file).unwrap());
        fs::write(&file, "外部编辑").unwrap();
        let save = || SaveDocumentInput {
            project_path: path.to_string_lossy().into_owned(),
            node_id: chapter.id.clone(),
            content: "本地编辑".into(),
            reason: "测试".into(),
        };
        assert!(save_document_checked(save(), original)
            .unwrap_err()
            .starts_with("EXTERNAL_CONFLICT:"));
        assert_eq!(fs::read_to_string(&file).unwrap(), "外部编辑");
        let (root, connection) = project_connection(path.to_str().unwrap()).unwrap();
        assert!(!storage::recovery_items(&root, &connection)
            .unwrap()
            .is_empty());
        assert_eq!(
            save_document_checked(save(), "外部编辑".into())
                .unwrap()
                .content,
            "本地编辑"
        );
        drop(connection);
        release_project(path.to_string_lossy().into_owned()).unwrap();
        fs::remove_dir_all(path).unwrap();
    }
    #[test]
    fn project_lease_excludes_another_file_handle_and_releases() {
        let root = std::env::temp_dir().join(format!("novelforge-lease-{}", storage::new_id()));
        fs::create_dir_all(root.join(".novelforge")).unwrap();
        acquire(&root).unwrap();
        let other = fs::OpenOptions::new()
            .read(true)
            .write(true)
            .open(root.join(".novelforge/session.lock"))
            .unwrap();
        assert!(other.try_lock().is_err());
        let canonical = root.canonicalize().unwrap();
        LEASES.get().unwrap().lock().unwrap().remove(&canonical);
        assert!(other.try_lock().is_ok());
        drop(other);
        fs::remove_dir_all(root).unwrap();
    }
}
