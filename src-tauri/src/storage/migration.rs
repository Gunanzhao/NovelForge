use super::*;

pub fn quarantine_database(root: &Path) -> Result<Option<String>, String> {
    let database = safe_relative(root, ".novelforge/database.sqlite")?;
    if !database.exists() {
        return Ok(None);
    }
    let stamp = Utc::now().format("%Y%m%dT%H%M%S%.3fZ");
    let backup_relative = format!(".novelforge/database.sqlite.corrupt-{}.bak", stamp);
    let backup = safe_relative(root, &backup_relative)?;
    fs::rename(&database, &backup).map_err(|error| format!("隔离损坏数据库失败：{}", error))?;
    for suffix in ["-wal", "-shm"] {
        let sidecar = PathBuf::from(format!("{}{}", database.to_string_lossy(), suffix));
        if sidecar.exists() {
            let sidecar_backup = PathBuf::from(format!("{}{}", backup.to_string_lossy(), suffix));
            let _ = fs::rename(sidecar, sidecar_backup);
        }
    }
    Ok(Some(backup_relative))
}
