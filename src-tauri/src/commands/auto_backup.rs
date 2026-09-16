use super::*;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::Read;
use std::sync::Mutex;
static BACKUPS: Mutex<()> = Mutex::new(());
const STATE: &str = ".novelforge/auto-backup.json";
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Archive {
    pub id: String,
    pub path: String,
    pub created_at: String,
    pub bytes: u64,
    pub sha256: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub enabled: bool,
    pub directory: String,
    pub trigger: String,
    pub keep: usize,
    pub last_attempt: Option<String>,
    pub last_success: Option<String>,
    pub last_error: Option<String>,
    pub last_fingerprint: Option<String>,
    pub archives: Vec<Archive>,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            enabled: false,
            directory: String::new(),
            trigger: "daily".into(),
            keep: 10,
            last_attempt: None,
            last_success: None,
            last_error: None,
            last_fingerprint: None,
            archives: vec![],
        }
    }
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub settings: Settings,
    pub available_bytes: Option<u64>,
    pub cleanup: Vec<Archive>,
    pub message: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Configure {
    pub project_path: String,
    pub enabled: bool,
    pub directory: String,
    pub trigger: String,
    pub keep: usize,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Run {
    pub project_path: String,
    pub manual: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Cleanup {
    pub project_path: String,
    pub archive_ids: Vec<String>,
}
fn read(root: &Path) -> Result<Settings, String> {
    let path = storage::safe_relative(root, STATE)?;
    if !path.exists() {
        return Ok(Settings::default());
    }
    serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?)
        .map_err(|e| format!("自动备份设置损坏：{e}"))
}
fn write(root: &Path, state: &Settings) -> Result<(), String> {
    storage::atomic_write(
        &storage::safe_relative(root, STATE)?,
        &serde_json::to_vec_pretty(state).map_err(|e| e.to_string())?,
    )
}
fn destination(root: &Path, directory: &str) -> Result<PathBuf, String> {
    let target = PathBuf::from(directory)
        .canonicalize()
        .map_err(|e| format!("备份目录不可用：{e}"))?;
    if !target.is_dir() || target.starts_with(root) {
        return Err("请选择项目之外的独立备份目录".into());
    }
    Ok(target)
}
#[cfg(windows)]
fn available(directory: &str) -> Option<u64> {
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn GetDiskFreeSpaceExW(
            path: *const u16,
            available: *mut u64,
            total: *mut u64,
            free: *mut u64,
        ) -> i32;
    }
    let path: Vec<u16> = std::ffi::OsStr::new(directory)
        .encode_wide()
        .chain(Some(0))
        .collect();
    let mut bytes = 0;
    // The path is NUL-terminated and the output pointer lives for this call.
    let ok = unsafe {
        GetDiskFreeSpaceExW(
            path.as_ptr(),
            &mut bytes,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        )
    };
    (ok != 0).then_some(bytes)
}
#[cfg(not(windows))]
fn available(_directory: &str) -> Option<u64> {
    None
}
fn candidates(state: &Settings) -> Vec<Archive> {
    let mut archives: Vec<_> = state
        .archives
        .iter()
        .filter(|a| Path::new(&a.path).parent() == Some(Path::new(&state.directory)))
        .cloned()
        .collect();
    archives.reverse();
    archives.into_iter().skip(state.keep.max(1)).collect()
}
fn status(state: Settings, message: &str) -> Status {
    Status {
        available_bytes: available(&state.directory),
        cleanup: candidates(&state),
        settings: state,
        message: message.into(),
    }
}
#[tauri::command]
pub fn auto_backup_status(path: String) -> Result<Status, String> {
    let _guard = BACKUPS.lock().map_err(|_| "备份锁不可用")?;
    let (root, _) = project_connection(&path)?;
    Ok(status(read(&root)?, ""))
}
#[tauri::command]
pub fn configure_auto_backup(input: Configure) -> Result<Status, String> {
    let _guard = BACKUPS.lock().map_err(|_| "备份锁不可用")?;
    let (root, _) = project_connection(&input.project_path)?;
    if !(1..=100).contains(&input.keep) || !matches!(input.trigger.as_str(), "daily" | "session") {
        return Err("备份策略无效".into());
    }
    let directory = if input.enabled || !input.directory.is_empty() {
        destination(&root, &input.directory)?
            .to_string_lossy()
            .into_owned()
    } else {
        String::new()
    };
    let mut state = read(&root)?;
    if state.directory != directory {
        state.last_fingerprint = None;
        state.last_success = None;
    }
    state.enabled = input.enabled;
    state.directory = directory;
    state.trigger = input.trigger;
    state.keep = input.keep;
    state.last_error = None;
    write(&root, &state)?;
    Ok(status(state, "自动备份设置已保存"))
}
fn digest(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut hash = Sha256::new();
    let mut bytes = [0; 65536];
    loop {
        let n = file.read(&mut bytes).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        hash.update(&bytes[..n]);
    }
    Ok(format!("{:x}", hash.finalize()))
}
fn fingerprint(root: &Path) -> Result<String, String> {
    fn collect(root: &Path, dir: &Path, entries: &mut Vec<(String, String)>) -> Result<(), String> {
        for item in fs::read_dir(dir).map_err(|e| e.to_string())? {
            let path = item.map_err(|e| e.to_string())?.path();
            let name = path
                .strip_prefix(root)
                .map_err(|e| e.to_string())?
                .to_string_lossy()
                .replace('\\', "/");
            if name == STATE
                || name == ".novelforge/session.lock"
                || [
                    ".novelforge/cache",
                    ".novelforge/index",
                    ".novelforge/logs",
                    ".novelforge/exports",
                    ".novelforge/batch-journal",
                ]
                .iter()
                .any(|prefix| name == *prefix || name.starts_with(&format!("{prefix}/")))
            {
                continue;
            }
            let meta = fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
            if meta.file_type().is_symlink() {
                return Err("自动备份不跟随符号链接".into());
            }
            storage::ensure_within_root(root, &path)?;
            if meta.is_dir() {
                collect(root, &path, entries)?
            } else if meta.is_file() {
                entries.push((name, digest(&path)?));
            }
        }
        Ok(())
    }
    let mut entries = vec![];
    collect(root, root, &mut entries)?;
    entries.sort();
    let mut hash = Sha256::new();
    hash.update(serde_json::to_vec(&entries).map_err(|e| e.to_string())?);
    Ok(format!("{:x}", hash.finalize()))
}
fn run(input: Run) -> Result<Status, String> {
    let _guard = BACKUPS.lock().map_err(|_| "备份锁不可用")?;
    let (root, _) = project_connection(&input.project_path)?;
    let mut state = read(&root)?;
    if !input.manual && !state.enabled {
        return Ok(status(state, "自动备份未启用"));
    }
    let today = chrono::Local::now().date_naive();
    if !input.manual
        && state.trigger == "daily"
        && state
            .last_success
            .as_deref()
            .and_then(|time| chrono::DateTime::parse_from_rfc3339(time).ok())
            .is_some_and(|time| time.with_timezone(&chrono::Local).date_naive() == today)
    {
        return Ok(status(state, "今日自动备份已完成"));
    }
    state.last_attempt = Some(storage::now());
    let result = (|| -> Result<Option<Archive>, String> {
        let directory = destination(&root, &state.directory)?;
        let hash = fingerprint(&root)?;
        if state.last_fingerprint.as_ref() == Some(&hash) {
            return Ok(None);
        }
        let report = backup::create(input.project_path, directory.to_string_lossy().into_owned())?;
        let path = PathBuf::from(&report.path);
        let archive = Archive {
            id: storage::new_id(),
            path: report.path.clone(),
            created_at: storage::now(),
            bytes: fs::metadata(&path).map_err(|e| e.to_string())?.len(),
            sha256: digest(&path)?,
        };
        state.last_fingerprint = Some(hash);
        Ok(Some(archive))
    })();
    let message = match result {
        Ok(Some(archive)) => {
            state.last_success = Some(archive.created_at.clone());
            state.last_error = None;
            state.archives.push(archive);
            "独立备份已创建并通过完整校验".to_string()
        }
        Ok(None) => {
            state.last_error = None;
            "项目内容未变化，无需重复备份".into()
        }
        Err(error) => {
            state.last_error = Some(error.clone());
            format!("自动备份失败：{error}")
        }
    };
    write(&root, &state)?;
    Ok(status(state, &message))
}
#[tauri::command]
pub async fn run_auto_backup(input: Run) -> Result<Status, String> {
    tauri::async_runtime::spawn_blocking(move || run(input))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn cleanup_auto_backups(input: Cleanup) -> Result<Status, String> {
    tauri::async_runtime::spawn_blocking(move || cleanup(input))
        .await
        .map_err(|e| e.to_string())?
}
fn cleanup(input: Cleanup) -> Result<Status, String> {
    let _guard = BACKUPS.lock().map_err(|_| "备份锁不可用")?;
    let (root, _) = project_connection(&input.project_path)?;
    let mut state = read(&root)?;
    let dir = destination(&root, &state.directory)?;
    let expected = candidates(&state);
    let ids: HashSet<_> = input.archive_ids.iter().collect();
    if ids.len() != input.archive_ids.len()
        || ids.is_empty()
        || expected.iter().map(|a| &a.id).collect::<HashSet<_>>() != ids
    {
        return Err("清理预览已变化，请重新查看后确认".into());
    }
    for archive in &expected {
        let path = PathBuf::from(&archive.path);
        let meta = fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
        if !meta.is_file()
            || meta.file_type().is_symlink()
            || path.canonicalize().map_err(|e| e.to_string())?.parent() != Some(dir.as_path())
            || path.extension().and_then(|s| s.to_str()) != Some("nfbackup")
            || digest(&path)? != archive.sha256
        {
            return Err("备份文件已变化或路径无效，取消清理".into());
        }
    }
    for archive in expected {
        fs::remove_file(&archive.path).map_err(|e| e.to_string())?;
        state.archives.retain(|item| item.id != archive.id);
        write(&root, &state)?;
    }
    Ok(status(state, "已删除预览中的旧备份，保留最新备份"))
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Fixture {
        root: PathBuf,
        destination: PathBuf,
        path: String,
    }
    impl Fixture {
        fn new() -> Self {
            let root =
                std::env::temp_dir().join(format!("novelforge-autobackup-{}", storage::new_id()));
            let destination = std::env::temp_dir().join(format!(
                "novelforge-autobackup-target-{}",
                storage::new_id()
            ));
            fs::create_dir_all(&root).unwrap();
            fs::create_dir_all(&destination).unwrap();
            let path = root.to_string_lossy().into_owned();
            create_project(ProjectInput {
                path: path.clone(),
                title: "自动备份测试".into(),
                author: "".into(),
                description: "".into(),
                genre: "".into(),
                target_words: 1,
            })
            .unwrap();
            Self {
                root,
                destination,
                path,
            }
        }
        fn configure(&self, trigger: &str, keep: usize) -> Status {
            configure_auto_backup(Configure {
                project_path: self.path.clone(),
                enabled: true,
                directory: self.destination.to_string_lossy().into_owned(),
                trigger: trigger.into(),
                keep,
            })
            .unwrap()
        }
        fn run(&self, manual: bool) -> Status {
            run(Run {
                project_path: self.path.clone(),
                manual,
            })
            .unwrap()
        }
        fn change(&self, title: &str) {
            upsert_entity(EntityInput {
                project_path: self.path.clone(),
                id: Some("test".into()),
                kind: "character".into(),
                title: title.into(),
                content: serde_json::json!({}),
                tags: vec![],
            })
            .unwrap();
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = guard::release_project(self.path.clone());
            let _ = fs::remove_dir_all(&self.root);
            let _ = fs::remove_dir_all(&self.destination);
        }
    }
    #[test]
    fn unchanged_project_skips_backup_and_restored_project_does_not_inherit_machine_settings() {
        let f = Fixture::new();
        f.configure("session", 2);
        let first = f.run(false);
        assert!(
            first.settings.last_error.is_none(),
            "{:?}",
            first.settings.last_error
        );
        assert_eq!(first.settings.archives.len(), 1);
        let next = f.run(false);
        assert_eq!(next.settings.archives.len(), 1);
        assert!(next.message.contains("未变化"));
        let file = fs::File::open(&first.settings.archives[0].path).unwrap();
        let mut zip = zip::ZipArchive::new(file).unwrap();
        assert!(zip.by_name(STATE).is_err());
        f.change("新人物");
        assert_eq!(f.run(false).settings.archives.len(), 2);
    }
    #[test]
    fn daily_policy_and_manual_check_keep_only_changed_snapshots() {
        let f = Fixture::new();
        f.configure("daily", 2);
        assert_eq!(f.run(false).settings.archives.len(), 1);
        f.change("变化");
        assert_eq!(f.run(false).settings.archives.len(), 1);
        assert_eq!(f.run(true).settings.archives.len(), 2);
        assert_eq!(f.run(true).settings.archives.len(), 2);
    }
    #[test]
    fn cleanup_requires_current_preview_and_preserves_unregistered_files() {
        let f = Fixture::new();
        f.configure("session", 1);
        f.run(false);
        f.change("第二版");
        let next = f.run(false);
        let unrelated = f.destination.join("unrelated.nfbackup");
        fs::write(&unrelated, "unrelated").unwrap();
        assert_eq!(next.cleanup.len(), 1);
        assert!(cleanup(Cleanup {
            project_path: f.path.clone(),
            archive_ids: vec!["not-managed".into()]
        })
        .is_err());
        let newest = next.settings.archives.last().unwrap().path.clone();
        let old = next.cleanup[0].path.clone();
        let status = cleanup(Cleanup {
            project_path: f.path.clone(),
            archive_ids: next.cleanup.iter().map(|a| a.id.clone()).collect(),
        })
        .unwrap();
        assert_eq!(status.settings.archives.len(), 1);
        assert!(Path::new(&newest).exists());
        assert!(!Path::new(&old).exists());
        assert!(unrelated.exists());
    }
    #[test]
    fn unavailable_destination_is_recorded_and_modified_archive_cannot_be_cleaned() {
        let f = Fixture::new();
        f.configure("session", 1);
        f.run(false);
        f.change("第二版");
        let next = f.run(false);
        fs::write(&next.cleanup[0].path, "外部替换").unwrap();
        assert!(cleanup(Cleanup {
            project_path: f.path.clone(),
            archive_ids: next.cleanup.iter().map(|a| a.id.clone()).collect()
        })
        .is_err());
        assert!(Path::new(&next.cleanup[0].path).exists());
        let mut state = read(&f.root).unwrap();
        state.directory = f.destination.join("missing").to_string_lossy().into_owned();
        write(&f.root, &state).unwrap();
        assert!(f.run(false).settings.last_error.is_some());
        assert!(configure_auto_backup(Configure {
            project_path: f.path.clone(),
            enabled: true,
            directory: f.root.join(".novelforge").to_string_lossy().into_owned(),
            trigger: "daily".into(),
            keep: 10
        })
        .is_err());
    }
}
