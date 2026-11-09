//! File journal coordinated by the same SQLite write transaction as the data changes.
use super::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize, Deserialize)]
pub struct FileChange {
    pub path: String,
    pub before: Option<String>,
    pub after: String,
}
#[derive(Serialize, Deserialize)]
pub struct Journal {
    pub id: String,
    pub files: Vec<FileChange>,
}
pub fn journal_path(root: &Path, id: &str) -> Result<PathBuf, String> {
    Uuid::parse_str(id).map_err(|_| "批量操作标识无效")?;
    safe_relative(root, &format!(".novelforge/batch-journal/{id}.json"))
}
pub fn prepare(root: &Path, journal: &Journal) -> Result<(), String> {
    let path = journal_path(root, &journal.id)?;
    fs::create_dir_all(path.parent().ok_or("批量日志目录无效")?).map_err(|e| e.to_string())?;
    atomic_write(
        &path,
        &serde_json::to_vec(journal).map_err(|e| e.to_string())?,
    )
}
pub fn rollback(root: &Path, journal: &Journal) -> Result<(), String> {
    // Check all paths before restoring any: never overwrite external edits.
    for change in &journal.files {
        let path = safe_relative(root, &change.path)?;
        let current = if path.exists() {
            Some(fs::read_to_string(&path).map_err(|e| e.to_string())?)
        } else {
            None
        };
        if current != change.before && current.as_deref() != Some(change.after.as_str()) {
            return Err(format!(
                "未完成操作的文件已被外部修改，保留日志等待处理：{}",
                change.path
            ));
        }
    }
    for change in &journal.files {
        let path = safe_relative(root, &change.path)?;
        match &change.before {
            Some(before) => atomic_write(&path, before.as_bytes())?,
            None => remove_file_if_exists(&path)?,
        }
    }
    Ok(())
}
fn recover_inner(root: &Path, connection: &mut Connection) -> Result<(), errors::StorageError> {
    let directory = safe_relative(root, ".novelforge/batch-journal")?;
    if !directory.exists() {
        return Ok(());
    }
    // A live batch owns this write lock before publishing its journal. Waiting for
    // it distinguishes a crashed transaction from an operation still in progress.
    let tx = connection
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(errors::StorageError::from)?;
    for entry in fs::read_dir(&directory).map_err(errors::StorageError::from)? {
        let path = entry.map_err(errors::StorageError::from)?.path();
        ensure_within_root(root, &path)?;
        if path.extension().and_then(|v| v.to_str()) != Some("json") {
            continue;
        }
        let journal: Journal =
            serde_json::from_slice(&fs::read(&path).map_err(errors::StorageError::from)?)
                .map_err(|_| errors::StorageError::Journal("批量日志损坏，原文件保留".into()))?;
        if path != journal_path(root, &journal.id)? {
            return Err(errors::StorageError::Journal("批量日志标识不匹配".into()));
        }
        let committed: bool = tx
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM batch_operations WHERE id=?1)",
                [&journal.id],
                |row| row.get(0),
            )
            .map_err(errors::StorageError::from)?;
        if committed {
            for change in &journal.files {
                let file = safe_relative(root, &change.path)?;
                let current = fs::read_to_string(file).map_err(errors::StorageError::from)?;
                if current != change.after {
                    return Err(errors::StorageError::Journal(
                        "已提交日志的文件被外部修改，保留证据等待处理".into(),
                    ));
                }
            }
        }
        if !committed {
            rollback(root, &journal).map_err(errors::StorageError::Journal)?;
        }
        remove_file_if_exists(&path)?;
    }
    tx.commit().map_err(errors::StorageError::from)
}

pub fn recover(root: &Path, connection: &mut Connection) -> Result<(), errors::StorageError> {
    let result = recover_inner(root, connection);
    if matches!(
        &result,
        Err(errors::StorageError::Journal(_)) | Err(errors::StorageError::Policy(_))
    ) {
        // This is a separate durable unresolved-state marker, not a renamed journal.
        let path = safe_relative(root, ".novelforge/recovery-state.json")?;
        atomic_write(
            &path,
            b"{\"version\":1,\"state\":\"unresolved\",\"code\":\"BATCH_RECOVERY\"}",
        )?;
    }
    result
}
