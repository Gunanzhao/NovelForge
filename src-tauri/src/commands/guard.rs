use super::*;
use std::sync::Mutex;
struct Lease {
    _file: fs::File,
    legacy: bool,
    owners: HashSet<String>,
}
static LEASES: OnceLock<Mutex<HashMap<PathBuf, Lease>>> = OnceLock::new();
static SAVES: Mutex<()> = Mutex::new(());
pub struct LeaseRequest {
    root: PathBuf,
    token: String,
    created: bool,
    retained: bool,
}
impl LeaseRequest {
    pub fn retain(mut self) -> String {
        self.retained = true;
        self.token.clone()
    }
    pub fn finish_implicit(self) -> Result<(), String> {
        if self.created {
            if let Some(lease) = LEASES
                .get()
                .unwrap()
                .lock()
                .map_err(|_| "项目锁不可用")?
                .get_mut(&self.root)
            {
                lease.legacy = true;
            }
        }
        Ok(())
    }
}
impl Drop for LeaseRequest {
    fn drop(&mut self) {
        if !self.retained {
            let _ = release_owner(&self.root, Some(&self.token));
        }
    }
}
fn insert_lease(leases: &mut HashMap<PathBuf, Lease>, root: &Path) -> Result<bool, String> {
    if leases.contains_key(root) {
        return Ok(false);
    }
    let file = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(storage::safe_relative(root, ".novelforge/session.lock")?)
        .map_err(|e| format!("无法建立项目锁：{e}"))?;
    file.try_lock()
        .map_err(|_| "项目已在另一个 NovelForge 进程中打开，请关闭该进程中的项目后重试。")?;
    leases.insert(
        root.to_path_buf(),
        Lease {
            _file: file,
            legacy: false,
            owners: HashSet::new(),
        },
    );
    Ok(true)
}
pub fn begin(root: &Path) -> Result<LeaseRequest, String> {
    let root = root.canonicalize().map_err(|e| e.to_string())?;
    let mut leases = LEASES
        .get_or_init(Default::default)
        .lock()
        .map_err(|_| "项目锁不可用")?;
    let created = insert_lease(&mut leases, &root)?;
    let token = storage::new_id();
    leases.get_mut(&root).unwrap().owners.insert(token.clone());
    Ok(LeaseRequest {
        root,
        token,
        created,
        retained: false,
    })
}
#[cfg(test)]
pub fn acquire(root: &Path) -> Result<(), String> {
    begin(root)?.finish_implicit()
}
fn release_owner(root: &Path, token: Option<&str>) -> Result<(), String> {
    let mut leases = LEASES
        .get_or_init(Default::default)
        .lock()
        .map_err(|_| "项目锁不可用")?;
    if let Some(lease) = leases.get_mut(root) {
        if let Some(token) = token {
            lease.owners.remove(token);
        } else {
            lease.legacy = false;
        }
        if !lease.legacy && lease.owners.is_empty() {
            leases.remove(root);
        }
    }
    Ok(())
}
#[tauri::command]
pub fn release_project(path: String) -> Result<(), String> {
    release_owner(
        &PathBuf::from(path)
            .canonicalize()
            .map_err(|e| e.to_string())?,
        None,
    )
}
#[tauri::command]
pub fn release_project_lease(path: String, token: String) -> Result<(), String> {
    release_owner(
        &PathBuf::from(path)
            .canonicalize()
            .map_err(|e| e.to_string())?,
        Some(&token),
    )
}
#[tauri::command]
pub fn retain_project_lease(path: String, token: String) -> Result<(), String> {
    let root = storage::existing_project_root(&path)?;
    let mut leases = LEASES
        .get_or_init(Default::default)
        .lock()
        .map_err(|_| "项目锁不可用")?;
    insert_lease(&mut leases, &root)?;
    leases.get_mut(&root).unwrap().owners.insert(token);
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

#[derive(Debug, serde::Serialize)]
pub struct RenameResult {
    data: ProjectData,
    document: Option<DocumentData>,
}
#[tauri::command]
pub fn rename_node_checked(
    input: crate::models::RenameNodeInput,
    expected_content: Option<String>,
) -> Result<RenameResult, String> {
    let _serial = SAVES.lock().map_err(|_| "正文保存锁不可用")?;
    if let Some(expected) = expected_content {
        let current = manuscript::get_document(crate::models::NodeActionInput {
            project_path: input.project_path.clone(),
            node_id: input.node_id.clone(),
        })?;
        if current.content != expected {
            return Err("EXTERNAL_CONFLICT:磁盘正文已变化，已取消重命名，请先处理正文冲突".into());
        }
    }
    let data = manuscript::rename_node(crate::models::RenameNodeInput {
        project_path: input.project_path.clone(),
        node_id: input.node_id.clone(),
        title: input.title.clone(),
    })?;
    let document = if data
        .nodes
        .iter()
        .any(|node| node.id == input.node_id && node.kind != "volume")
    {
        Some(manuscript::get_document(crate::models::NodeActionInput {
            project_path: input.project_path,
            node_id: input.node_id,
        })?)
    } else {
        None
    };
    Ok(RenameResult { data, document })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn lease_probe_child() {
        let Ok(path) = std::env::var("NF_LEASE_PROBE") else {
            return;
        };
        let expected = std::env::var("NF_LEASE_FREE").unwrap() == "true";
        let file = fs::OpenOptions::new()
            .read(true)
            .write(true)
            .open(path)
            .unwrap();
        assert_eq!(file.try_lock().is_ok(), expected);
    }
    fn probe(root: &Path, free: bool) {
        let status = std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "commands::guard::tests::lease_probe_child"])
            .env("NF_LEASE_PROBE", root.join(".novelforge/session.lock"))
            .env("NF_LEASE_FREE", free.to_string())
            .status()
            .unwrap();
        assert!(status.success());
    }
    #[test]
    fn owned_leases_survive_stale_release_and_failed_open_without_leaking() {
        let root = std::env::temp_dir().join(format!("nf-owned-lease-{}", storage::new_id()));
        let path = root.to_string_lossy().into_owned();
        create_project(ProjectInput {
            path: path.clone(),
            title: "锁测试".into(),
            author: "".into(),
            description: "".into(),
            genre: "".into(),
            target_words: 1,
        })
        .unwrap();
        let first = begin(&root).unwrap().retain();
        let second = begin(&root).unwrap().retain();
        release_project_lease(path.clone(), first.clone()).unwrap();
        probe(&root, false);
        fs::write(root.join("project.json"), b"broken metadata").unwrap();
        assert!(project::prepare_open_project(path.clone()).is_err());
        release_project_lease(path.clone(), first).unwrap();
        probe(&root, false);
        release_project_lease(path.clone(), second).unwrap();
        assert!(project::prepare_open_project(path.clone()).is_err());
        assert!(project::open_project(path).is_err());
        probe(&root, true);
        fs::remove_dir_all(root).unwrap();
    }
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
