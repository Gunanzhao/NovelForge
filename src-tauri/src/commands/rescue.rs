//! Read-only rescue bypasses normal project connections and never initializes schema.
use super::*;
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RescueReport {
    pub unresolved: bool,
    pub notice: String,
    pub files: Vec<RescueFile>,
}
#[derive(serde::Serialize)]
pub struct RescueFile {
    pub path: String,
    pub content: String,
}
#[tauri::command]
pub fn inspect_project_rescue(path: String) -> Result<RescueReport, String> {
    let root = fs::canonicalize(path).map_err(|_| "RESCUE_IO:无法读取项目目录")?;
    if !storage::safe_relative(&root, "project.json")?.is_file() {
        return Err("RESCUE_INVALID:缺少项目元数据".into());
    }
    validate_recovery_tree(&root)?;
    let mut files = Vec::new();
    let mut total = 0usize;
    let mut visited = HashSet::new();
    let mut pending = Vec::new();
    for relative in RECOVERY_DIRECTORIES {
        let directory = storage::safe_relative(&root, relative)?;
        if directory.exists() {
            pending.push(directory);
        }
    }
    while let Some(path) = pending.pop() {
        let safe = storage::safe_existing_path(&root, &path)?;
        if !visited.insert(safe.clone()) {
            continue;
        }
        if safe.is_dir() {
            for entry in fs::read_dir(&safe).map_err(|_| "RESCUE_IO:无法读取救援目录")? {
                pending.push(entry.map_err(|_| "RESCUE_IO:无法读取目录项")?.path());
            }
        } else if safe.extension().and_then(|v| v.to_str()) == Some("md") {
            let size = fs::metadata(&safe)
                .map_err(|_| "RESCUE_IO:无法检查救援文件")?
                .len();
            if size > 20 * 1024 * 1024
                || total as u64 + size > 20 * 1024 * 1024
                || files.len() >= 2000
            {
                return Err(
                    "RESCUE_LIMIT:超过 20 MiB/2000 文件救援预览限制；请保留完整原项目供离线救援"
                        .into(),
                );
            }
            let content = fs::read_to_string(&safe)
                .map_err(|_| "RESCUE_IO:正文无法读取，请保留原文件供离线救援")?;
            total += content.len();
            files.push(RescueFile {
                path: safe
                    .strip_prefix(&root)
                    .map_err(|_| "RESCUE_PATH")?
                    .to_string_lossy()
                    .replace('\\', "/"),
                content,
            });
        }
    }
    let report = storage::safe_relative(&root, ".novelforge/recovery-report.json")?;
    let notice = if report.is_file() {
        fs::read_to_string(report).map_err(|_| "RESCUE_IO:恢复报告无法读取")?
    } else {
        "只读救援：所列为当前安全可读的 Markdown 文件，不代表事务一致或完整数据库备份；未恢复历史索引、活动统计及操作状态。".into()
    };
    Ok(RescueReport {
        unresolved: storage::safe_relative(&root, ".novelforge/recovery-state.json")?.exists(),
        notice,
        files,
    })
}
#[tauri::command]
pub fn verify_project_recovery(path: String) -> Result<(), String> {
    let root = storage::existing_project_root(&path)?;
    let _serial = guard::SAVES.lock().map_err(|_| "RECOVERY_LOCK")?;
    let _lease = guard::begin(&root)?;
    storage::errors::check_compatibility(&root).map_err(|e| e.to_string())?;
    let mut connection = Connection::open_with_flags(
        storage::safe_relative(&root, ".novelforge/database.sqlite")?,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_WRITE,
    )
    .map_err(|e| e.to_string())?;
    let check: String = connection
        .query_row("PRAGMA integrity_check", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if check != "ok" {
        return Err("RECOVERY_INCONSISTENT:数据库完整性未通过".into());
    }
    let directory = storage::safe_relative(&root, ".novelforge/batch-journal")?;
    let marker = storage::safe_relative(&root, ".novelforge/recovery-state.json")?;
    if marker.exists()
        && (!directory.is_dir()
            || fs::read_dir(&directory)
                .map_err(|e| e.to_string())?
                .filter_map(Result::ok)
                .all(|e| e.path().extension().and_then(|v| v.to_str()) != Some("json")))
    {
        return Err("RECOVERY_EVIDENCE:原始日志缺失，不能解除未解决状态；请导出救援副本".into());
    }
    validate_recovery_tree(&root)?;
    for node in storage::all_nodes(&connection, true)? {
        if node.deleted_at.is_none() && !storage::safe_relative(&root, &node.file_path)?.exists() {
            return Err("RECOVERY_MISSING:数据库引用的正文缺失".into());
        }
    }
    for entity in storage::all_entities(&connection, true)? {
        if entity.deleted_at.is_none()
            && !storage::safe_relative(&root, &entity.file_path)?.exists()
        {
            return Err("RECOVERY_MISSING:数据库引用的资料缺失".into());
        }
    }
    storage::batch::recover(&root, &mut connection).map_err(|e| e.to_string())?;
    storage::remove_file_if_exists(&marker)?;
    Ok(())
}
