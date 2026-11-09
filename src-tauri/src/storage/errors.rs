use super::*;
#[derive(Debug, thiserror::Error)]
pub enum StorageError {
    #[error("{0}")]
    Policy(String),
    #[error("{code}:存储操作失败；原数据保留", code = sqlite_code(.0))]
    Sqlite(#[from] rusqlite::Error),
    #[error("{code}:文件操作失败；原数据保留", code = io_code(.0))]
    Io(#[from] std::io::Error),
    #[error("BATCH_RECOVERY:{0}")]
    Journal(String),
}
impl From<String> for StorageError {
    fn from(value: String) -> Self {
        Self::Policy(value)
    }
}
impl StorageError {
    pub fn corrupt(&self) -> bool {
        matches!(self, Self::Sqlite(rusqlite::Error::SqliteFailure(e,_)) if matches!(e.code,rusqlite::ErrorCode::DatabaseCorrupt|rusqlite::ErrorCode::NotADatabase))
    }
}
pub fn sqlite_code(error: &rusqlite::Error) -> &'static str {
    use rusqlite::ErrorCode::*;
    match error.sqlite_error_code() {
        Some(DatabaseBusy | DatabaseLocked) => "STORAGE_BUSY",
        Some(PermissionDenied | AuthorizationForStatementDenied) => "STORAGE_PERMISSION",
        Some(ReadOnly) => "STORAGE_READ_ONLY",
        Some(DiskFull) => "STORAGE_FULL",
        Some(SystemIoFailure | CannotOpen) => "STORAGE_IO",
        Some(DatabaseCorrupt | NotADatabase) => "STORAGE_CORRUPT",
        _ => "STORAGE_QUERY",
    }
}
fn io_code(error: &std::io::Error) -> &'static str {
    match error.kind() {
        std::io::ErrorKind::PermissionDenied => "STORAGE_PERMISSION",
        std::io::ErrorKind::StorageFull => "STORAGE_FULL",
        _ => "STORAGE_IO",
    }
}
pub const SCHEMA_VERSION: i64 = 1;
/// Read-only preflight, before session file creation, initialization or recovery.
pub fn check_compatibility(root: &Path) -> Result<(), StorageError> {
    let metadata_path = safe_relative(root, PROJECT_FILE)?;
    if metadata_path.exists() {
        let metadata: crate::models::ProjectMetadata =
            serde_json::from_slice(&fs::read(metadata_path)?).map_err(|_| {
                StorageError::Policy("PROJECT_FORMAT:project.json 格式无效，拒绝写入".into())
            })?;
        if metadata.format_version != 1 {
            return Err(StorageError::Policy(
                "PROJECT_FORMAT:不支持此项目格式，请使用兼容版本或升级；未写入项目".into(),
            ));
        }
    }
    let path = safe_relative(root, ".novelforge/database.sqlite")?;
    if path.exists() {
        let connection =
            Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)?;
        let version: i64 = connection.pragma_query_value(None, "user_version", |row| row.get(0))?;
        if !(0..=SCHEMA_VERSION).contains(&version) {
            return Err(StorageError::Policy(
                "SCHEMA_VERSION:数据库由更新版本创建，请升级；未写入项目".into(),
            ));
        }
    }
    Ok(())
}
