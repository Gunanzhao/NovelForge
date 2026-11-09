//! Independent application-data drafts. Never opens or writes the project database.
use crate::storage_impl as storage;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::Manager;
static SERIAL: Mutex<()> = Mutex::new(());
const MAX_BYTES: usize = 2 * 1024 * 1024;
const MAX_TOTAL: u64 = 50 * 1024 * 1024;
const MAX_COUNT: usize = 100;
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftSnapshot {
    pub id: String,
    pub project_id: String,
    pub project_path: String,
    pub target_id: String,
    pub label: String,
    pub version: u64,
    pub captured_at: String,
    pub payload: serde_json::Value,
    #[serde(default)]
    pub fingerprint: String,
}
fn directory(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|_| "DRAFT_IO:应用数据目录不可用")?
        .join("draft-snapshots-v1"))
}
fn list(root: &Path) -> Result<Vec<DraftSnapshot>, String> {
    if !root.exists() {
        return Ok(Vec::new());
    }
    let mut snapshots = Vec::new();
    for entry in fs::read_dir(root).map_err(|_| "DRAFT_IO:无法读取草稿目录")? {
        let path = entry.map_err(|_| "DRAFT_IO:无法读取草稿条目")?.path();
        if path.extension().and_then(|v| v.to_str()) != Some("json") {
            continue;
        }
        let bytes = fs::read(&path).map_err(|_| "DRAFT_IO:草稿读取失败，原文件保留")?;
        if bytes.len() > MAX_BYTES {
            return Err("DRAFT_LIMIT:草稿超过读取限制，原文件保留".into());
        }
        snapshots.push(
            serde_json::from_slice(&bytes).map_err(|_| "DRAFT_CORRUPT:草稿损坏，原文件保留")?,
        );
    }
    for snapshot in &snapshots {
        let snapshot: &DraftSnapshot = snapshot;
        if snapshot.fingerprint.len() != 64
            || !snapshot.fingerprint.bytes().all(|b| b.is_ascii_hexdigit())
        {
            return Err("DRAFT_CORRUPT:草稿索引无效，原文件保留".into());
        }
    }
    Ok(snapshots)
}
fn put(root: &Path, mut snapshot: DraftSnapshot) -> Result<(), String> {
    uuid::Uuid::parse_str(&snapshot.id).map_err(|_| "DRAFT_INVALID:版本标识无效")?;
    if snapshot.project_id.is_empty() || snapshot.target_id.is_empty() || snapshot.version == 0 {
        return Err("DRAFT_INVALID:草稿身份不完整".into());
    }
    snapshot.project_path = PathBuf::from(&snapshot.project_path)
        .canonicalize()
        .map_err(|_| "DRAFT_IO:无法核对项目路径")?
        .to_string_lossy()
        .into_owned();
    snapshot.fingerprint = format!(
        "{:x}",
        Sha256::digest(
            format!(
                "{}\0{}\0{}",
                snapshot.project_id, snapshot.project_path, snapshot.target_id
            )
            .as_bytes()
        )
    );
    let path = root.join(format!("{}.json", snapshot.fingerprint));
    let bytes = serde_json::to_vec(&snapshot).map_err(|_| "DRAFT_INVALID:草稿无法序列化")?;
    if bytes.len() > MAX_BYTES {
        return Err("DRAFT_LIMIT:单份草稿超过 2 MiB，请立即另存".into());
    }
    fs::create_dir_all(root).map_err(|_| "DRAFT_IO:无法创建草稿目录")?;
    let existing = list(root)?;
    if let Some(old) = existing
        .iter()
        .find(|old| old.fingerprint == snapshot.fingerprint)
    {
        if old.id != snapshot.id && old.version >= snapshot.version {
            return Err("DRAFT_STALE:已有更新草稿，未覆盖，请查看恢复列表".into());
        }
    }
    let total: u64 = fs::read_dir(root)
        .map_err(|_| "DRAFT_IO:无法检查草稿占用")?
        .filter_map(Result::ok)
        .filter_map(|e| e.metadata().ok())
        .map(|m| m.len())
        .sum();
    if (!path.exists() && existing.len() >= MAX_COUNT) || total + bytes.len() as u64 > MAX_TOTAL {
        return Err("DRAFT_LIMIT:草稿空间已达上限，请先导出并处理恢复稿".into());
    }
    storage::atomic_write(&path, &bytes).map_err(|_| "DRAFT_IO:独立草稿写入失败，请立即另存".into())
}
fn acknowledge(root: &Path, id: &str) -> Result<(), String> {
    for snapshot in list(root)? {
        if snapshot.id == id {
            let path = root.join(format!("{}.json", snapshot.fingerprint));
            fs::remove_file(path).map_err(|_| "DRAFT_IO:已保存草稿确认失败")?;
        }
    }
    Ok(())
}
#[tauri::command]
pub fn put_draft_snapshot(app: tauri::AppHandle, input: DraftSnapshot) -> Result<(), String> {
    let _guard = SERIAL.lock().map_err(|_| "DRAFT_IO:草稿锁不可用")?;
    put(&directory(&app)?, input)
}
#[tauri::command]
pub fn list_draft_snapshots(app: tauri::AppHandle) -> Result<Vec<DraftSnapshot>, String> {
    let _guard = SERIAL.lock().map_err(|_| "DRAFT_IO:草稿锁不可用")?;
    list(&directory(&app)?)
}
#[tauri::command]
pub fn acknowledge_draft_snapshot(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let _guard = SERIAL.lock().map_err(|_| "DRAFT_IO:草稿锁不可用")?;
    acknowledge(&directory(&app)?, &id)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn atomic_drafts_survive_restart_and_old_ack_cannot_delete_new_version() {
        let root = std::env::temp_dir().join(format!("nf-drafts-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let directory = root.join("appdata");
        let mut draft = DraftSnapshot {
            id: uuid::Uuid::new_v4().to_string(),
            project_id: "p".into(),
            project_path: root.to_string_lossy().into_owned(),
            target_id: "正文".into(),
            label: "正文".into(),
            version: 1,
            captured_at: storage::now(),
            payload: serde_json::json!({"content":"未保存😀"}),
            fingerprint: String::new(),
        };
        put(&directory, draft.clone()).unwrap();
        let old = draft.id.clone();
        draft.id = uuid::Uuid::new_v4().to_string();
        draft.version = 2;
        draft.payload = serde_json::json!({"content":"新正文"});
        put(&directory, draft.clone()).unwrap();
        acknowledge(&directory, &old).unwrap();
        assert_eq!(list(&directory).unwrap()[0].payload, draft.payload);
        let mut stale = draft.clone();
        stale.id = old;
        stale.version = 1;
        assert!(put(&directory, stale)
            .unwrap_err()
            .starts_with("DRAFT_STALE:"));
        let blocked = root.join("blocked");
        fs::write(&blocked, b"file").unwrap();
        assert!(put(&blocked, draft.clone())
            .unwrap_err()
            .starts_with("DRAFT_IO:"));
        assert_eq!(list(&directory).unwrap()[0].id, draft.id);
        draft.payload = serde_json::json!("x".repeat(MAX_BYTES));
        assert!(put(&directory, draft.clone())
            .unwrap_err()
            .starts_with("DRAFT_LIMIT:"));
        acknowledge(&directory, &draft.id).unwrap();
        assert!(list(&directory).unwrap().is_empty());
        fs::remove_dir_all(root).unwrap();
    }
}
