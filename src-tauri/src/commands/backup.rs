use super::*;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::io::{Read, Seek};
use zip::ZipArchive;
const MANIFEST: &str = "novelforge-backup.json";
const MAX_BYTES: u64 = 8 * 1024 * 1024 * 1024;
#[derive(Debug, Serialize, Deserialize)]
struct Entry {
    size: u64,
    sha256: String,
}
#[derive(Debug, Serialize, Deserialize)]
struct Manifest {
    format: u32,
    created_at: String,
    files: BTreeMap<String, Entry>,
    directories: Vec<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupReport {
    pub path: String,
    pub file_count: usize,
    pub total_bytes: u64,
}
fn ignored(name: &str) -> bool {
    matches!(
        name,
        ".novelforge/session.lock"
            | ".novelforge/database.sqlite"
            | ".novelforge/database.sqlite-wal"
            | ".novelforge/database.sqlite-shm"
    ) || name.starts_with(".novelforge/cache/")
        || name.starts_with(".novelforge/index/")
        || name.starts_with(".novelforge/exports/")
}
fn list(
    root: &Path,
    directory: &Path,
    files: &mut BTreeMap<String, (u64, std::time::SystemTime)>,
) -> Result<(), String> {
    for item in fs::read_dir(directory).map_err(|e| e.to_string())? {
        let item = item.map_err(|e| e.to_string())?;
        let path = item.path();
        let name = path
            .strip_prefix(root)
            .map_err(|e| e.to_string())?
            .to_string_lossy()
            .replace('\\', "/");
        if ignored(&name) {
            continue;
        }
        let metadata = fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
        if metadata.file_type().is_symlink() {
            return Err(format!("备份不跟随符号链接：{name}"));
        }
        storage::ensure_within_root(root, &path)?;
        if metadata.is_dir() {
            list(root, &path, files)?;
        } else if metadata.is_file() {
            files.insert(
                name,
                (
                    metadata.len(),
                    metadata.modified().map_err(|e| e.to_string())?,
                ),
            );
        }
    }
    Ok(())
}
fn transfer(reader: &mut impl Read, writer: &mut impl Write, limit: u64) -> Result<Entry, String> {
    let mut hash = Sha256::new();
    let mut size = 0;
    let mut buffer = [0u8; 65536];
    loop {
        let n = reader
            .read(&mut buffer)
            .map_err(|e| format!("读取备份数据失败：{e}"))?;
        if n == 0 {
            break;
        }
        size += n as u64;
        if size > limit {
            return Err("备份内容超过安全大小限制".into());
        }
        hash.update(&buffer[..n]);
        writer.write_all(&buffer[..n]).map_err(|e| e.to_string())?;
    }
    Ok(Entry {
        size,
        sha256: format!("{:x}", hash.finalize()),
    })
}
fn safe_name(name: &str) -> bool {
    !name.is_empty()
        && !name.contains(['\\', ':', '\0'])
        && name.split('/').all(|part| {
            let base = part.split('.').next().unwrap_or("").to_ascii_uppercase();
            !part.is_empty()
                && part != "."
                && part != ".."
                && !part.ends_with([' ', '.'])
                && !matches!(
                    base.as_str(),
                    "CON"
                        | "PRN"
                        | "AUX"
                        | "NUL"
                        | "COM1"
                        | "COM2"
                        | "COM3"
                        | "COM4"
                        | "COM5"
                        | "COM6"
                        | "COM7"
                        | "COM8"
                        | "COM9"
                        | "LPT1"
                        | "LPT2"
                        | "LPT3"
                        | "LPT4"
                        | "LPT5"
                        | "LPT6"
                        | "LPT7"
                        | "LPT8"
                        | "LPT9"
                )
        })
}
fn manifest<R: Read + Seek>(archive: &mut ZipArchive<R>) -> Result<Manifest, String> {
    if archive.len() > 100001 {
        return Err("备份文件数量过多".into());
    }
    let file = archive
        .by_name(MANIFEST)
        .map_err(|_| "不是 NovelForge 完整备份")?;
    if file.size() > 32 * 1024 * 1024 {
        return Err("备份清单过大".into());
    }
    let value: Manifest = serde_json::from_reader(file.take(32 * 1024 * 1024 + 1))
        .map_err(|e| format!("备份清单无效：{e}"))?;
    if value.format != 1
        || value.files.len() + 1 != archive.len()
        || !value.files.contains_key("project.json")
        || !value.files.contains_key(".novelforge/database.sqlite")
    {
        return Err("备份格式或必要文件不完整".into());
    }
    let mut seen = HashSet::new();
    let mut total = 0u64;
    for i in 0..archive.len() {
        let file = archive.by_index(i).map_err(|e| e.to_string())?;
        let name = file.name();
        if !safe_name(name)
            || !seen.insert(name.to_lowercase())
            || file.is_dir()
            || file
                .unix_mode()
                .is_some_and(|mode| mode & 0o170000 == 0o120000)
        {
            return Err(format!("备份路径不安全或重复：{name}"));
        }
        if name == MANIFEST {
            continue;
        }
        let entry = value.files.get(name).ok_or("备份包含未登记文件")?;
        if entry.size != file.size() {
            return Err(format!("备份大小不匹配：{name}"));
        }
        total = total.checked_add(entry.size).ok_or("备份大小溢出")?;
        if total > MAX_BYTES {
            return Err("备份解压大小超过 8 GB".into());
        }
    }
    if value.directories.len() > 100000
        || value.directories.iter().any(|name| {
            !safe_name(name)
                || value
                    .files
                    .keys()
                    .any(|file| file.eq_ignore_ascii_case(name))
        })
    {
        return Err("备份目录清单无效".into());
    }
    Ok(value)
}
fn verify<R: Read + Seek>(archive: &mut ZipArchive<R>, value: &Manifest) -> Result<(), String> {
    for (name, expected) in &value.files {
        let mut file = archive.by_name(name).map_err(|e| e.to_string())?;
        let actual = transfer(&mut file, &mut std::io::sink(), expected.size)?;
        if actual.size != expected.size || actual.sha256 != expected.sha256 {
            return Err(format!("备份校验失败：{name}"));
        }
    }
    Ok(())
}
fn create(path: String, directory: String) -> Result<BackupReport, String> {
    let (root, connection) = project_connection(&path)?;
    let root = root.canonicalize().map_err(|e| e.to_string())?;
    let parent = PathBuf::from(directory)
        .canonicalize()
        .map_err(|e| e.to_string())?;
    if !parent.is_dir() || parent.starts_with(&root) {
        return Err("请选择项目文件夹以外的备份目录".into());
    }
    let id = storage::new_id();
    let output = parent.join(format!(
        "NovelForge-{}-{id}.nfbackup",
        Utc::now().format("%Y%m%d-%H%M%S")
    ));
    let snapshot = parent.join(format!(".novelforge-db-{id}.tmp"));
    let result = (|| {
        let version: i64 = connection
            .query_row("PRAGMA data_version", [], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        let mut before = BTreeMap::new();
        list(&root, &root, &mut before)?;
        connection
            .execute(
                "VACUUM INTO ?1",
                params![snapshot.to_string_lossy().as_ref()],
            )
            .map_err(|e| format!("数据库快照失败：{e}"))?;
        let mut writer = ZipWriter::new(
            fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&output)
                .map_err(|e| e.to_string())?,
        );
        let mut files = BTreeMap::new();
        let mut total = 0;
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        for name in before
            .keys()
            .map(String::as_str)
            .chain(std::iter::once(".novelforge/database.sqlite"))
        {
            if !safe_name(name) || name == MANIFEST {
                return Err(format!("项目中存在不支持的备份路径：{name}"));
            }
            let source = if name == ".novelforge/database.sqlite" {
                snapshot.clone()
            } else {
                storage::safe_relative(&root, name)?
            };
            writer
                .start_file(name, options)
                .map_err(|e| e.to_string())?;
            let entry = transfer(
                &mut fs::File::open(source).map_err(|e| e.to_string())?,
                &mut writer,
                MAX_BYTES - total,
            )?;
            total += entry.size;
            files.insert(name.into(), entry);
        }
        let mut after = BTreeMap::new();
        list(&root, &root, &mut after)?;
        let after_version: i64 = connection
            .query_row("PRAGMA data_version", [], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        if before != after || version != after_version {
            return Err("备份期间项目发生变化，请稍后重试以获得一致副本".into());
        }
        let count = files.len();
        fn collect(root: &Path, dir: &Path, out: &mut Vec<String>) -> Result<(), String> {
            for item in fs::read_dir(dir).map_err(|e| e.to_string())? {
                let item = item.map_err(|e| e.to_string())?;
                let path = item.path();
                let meta = fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
                if meta.file_type().is_symlink() {
                    return Err("备份期间目录出现符号链接，请重试".into());
                }
                if meta.is_dir() {
                    storage::ensure_within_root(root, &path)?;
                    out.push(
                        path.strip_prefix(root)
                            .map_err(|e| e.to_string())?
                            .to_string_lossy()
                            .replace('\\', "/"),
                    );
                    collect(root, &path, out)?;
                }
            }
            Ok(())
        }
        let mut directories = Vec::new();
        collect(&root, &root, &mut directories)?;
        let value = Manifest {
            format: 1,
            created_at: storage::now(),
            files,
            directories,
        };
        writer
            .start_file(MANIFEST, options)
            .map_err(|e| e.to_string())?;
        writer
            .write_all(&serde_json::to_vec(&value).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        writer
            .finish()
            .map_err(|e| e.to_string())?
            .sync_all()
            .map_err(|e| e.to_string())?;
        let mut archive = ZipArchive::new(fs::File::open(&output).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        verify(&mut archive, &value)?;
        Ok(BackupReport {
            path: output.to_string_lossy().into_owned(),
            file_count: count,
            total_bytes: total,
        })
    })();
    let _ = fs::remove_file(snapshot);
    if result.is_err() {
        let _ = fs::remove_file(output);
    }
    result
}
#[tauri::command]
pub async fn backup_project(path: String, directory: String) -> Result<BackupReport, String> {
    tauri::async_runtime::spawn_blocking(move || create(path, directory))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn validate_backup(path: String) -> Result<BackupReport, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut archive = ZipArchive::new(fs::File::open(&path).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        let value = manifest(&mut archive)?;
        verify(&mut archive, &value)?;
        Ok(BackupReport {
            path,
            file_count: value.files.len(),
            total_bytes: value.files.values().map(|e| e.size).sum(),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}
fn restore(path: String, directory: String) -> Result<BackupReport, String> {
    let parent = PathBuf::from(directory)
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let mut archive = ZipArchive::new(fs::File::open(path).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    let value = manifest(&mut archive)?;
    verify(&mut archive, &value)?;
    let id = storage::new_id();
    let stage = parent.join(format!(".novelforge-restore-{id}"));
    let output = parent.join(format!(
        "NovelForge-restored-{}-{id}",
        Utc::now().format("%Y%m%d")
    ));
    fs::create_dir(&stage).map_err(|e| e.to_string())?;
    let result = (|| {
        for name in &value.directories {
            fs::create_dir_all(storage::safe_relative(&stage, name)?).map_err(|e| e.to_string())?;
        }
        for (name, expected) in &value.files {
            let target = storage::safe_relative(&stage, name)?;
            fs::create_dir_all(target.parent().ok_or("备份路径无父目录")?)
                .map_err(|e| e.to_string())?;
            let mut source = archive.by_name(name).map_err(|e| e.to_string())?;
            let mut file = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&target)
                .map_err(|e| e.to_string())?;
            let actual = transfer(&mut source, &mut file, expected.size)?;
            if actual.size != expected.size || actual.sha256 != expected.sha256 {
                return Err(format!("恢复时校验失败：{name}"));
            }
        }
        storage::read_project_json(&stage)?;
        let db = Connection::open_with_flags(
            stage.join(".novelforge/database.sqlite"),
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
        )
        .map_err(|e| e.to_string())?;
        let check: String = db
            .query_row("PRAGMA quick_check", [], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        if check != "ok" {
            return Err("备份数据库校验失败".into());
        }
        for node in storage::all_nodes(&db, false)? {
            if !storage::safe_relative(&stage, &node.file_path)?.exists() {
                return Err(format!("备份缺失正文：{}", node.title));
            }
        }
        for entity in storage::all_entities(&db, false)? {
            if !storage::safe_relative(&stage, &entity.file_path)?.exists() {
                return Err(format!("备份缺失资料：{}", entity.title));
            }
        }
        for item in storage::trash_items(&db)? {
            storage::safe_trash_path(&stage, &item.trash_path)
                .map_err(|error| format!("备份回收站条目无效（{}）：{}", item.title, error))?;
        }
        drop(db);
        if output.exists() {
            return Err("恢复目标已存在".into());
        }
        fs::rename(&stage, &output).map_err(|e| e.to_string())?;
        Ok(BackupReport {
            path: output.to_string_lossy().into_owned(),
            file_count: value.files.len(),
            total_bytes: value.files.values().map(|e| e.size).sum(),
        })
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(stage);
    }
    result
}
#[tauri::command]
pub async fn restore_backup(path: String, directory: String) -> Result<BackupReport, String> {
    tauri::async_runtime::spawn_blocking(move || restore(path, directory))
        .await
        .map_err(|e| e.to_string())?
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn roundtrip_preserves_database_history_and_binary_attachments() {
        let parent =
            std::env::temp_dir().join(format!("novelforge-backup-test-{}", storage::new_id()));
        fs::create_dir(&parent).unwrap();
        let project = parent.join("project");
        fs::create_dir(&project).unwrap();
        let data = create_project(ProjectInput {
            path: project.to_string_lossy().into_owned(),
            title: "完整备份".into(),
            author: "".into(),
            genre: "".into(),
            description: "".into(),
            target_words: 1000,
        })
        .unwrap();
        let chapter = data.nodes.iter().find(|n| n.kind == "chapter").unwrap();
        save_document(SaveDocumentInput {
            project_path: project.to_string_lossy().into_owned(),
            node_id: chapter.id.clone(),
            content: "已保存正文".into(),
            reason: "备份前历史".into(),
        })
        .unwrap();
        fs::write(project.join("attachments/test.bin"), [0, 255, 1, 128]).unwrap();
        fs::create_dir(project.join("attachments/empty-folder")).unwrap();
        let backup = create(
            project.to_string_lossy().into_owned(),
            parent.to_string_lossy().into_owned(),
        )
        .unwrap();
        let restored = restore(backup.path, parent.to_string_lossy().into_owned()).unwrap();
        let restored = PathBuf::from(restored.path);
        assert!(restored.join("attachments/empty-folder").is_dir());
        assert_eq!(
            fs::read(restored.join("attachments/test.bin")).unwrap(),
            [0, 255, 1, 128]
        );
        let restored_data = open_project(restored.to_string_lossy().into_owned()).unwrap();
        assert_eq!(restored_data.project.id, data.project.id);
        assert!(get_document(crate::models::NodeActionInput {
            project_path: restored.to_string_lossy().into_owned(),
            node_id: chapter.id.clone()
        })
        .unwrap()
        .content
        .contains("已保存正文"));
        assert!(!list_history(crate::models::NodeActionInput {
            project_path: restored.to_string_lossy().into_owned(),
            node_id: chapter.id.clone()
        })
        .unwrap()
        .is_empty());
        guard::release_project(project.to_string_lossy().into_owned()).unwrap();
        guard::release_project(restored.to_string_lossy().into_owned()).unwrap();
        fs::remove_dir_all(parent).unwrap();
    }
    #[test]
    fn detects_modified_payload_even_when_zip_crc_is_valid() {
        let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
        let mut files = BTreeMap::new();
        for name in ["project.json", ".novelforge/database.sqlite"] {
            writer
                .start_file(name, SimpleFileOptions::default())
                .unwrap();
            writer.write_all(b"tampered").unwrap();
            files.insert(
                name.into(),
                Entry {
                    size: 8,
                    sha256: format!("{:x}", Sha256::digest(b"original")),
                },
            );
        }
        writer
            .start_file(MANIFEST, SimpleFileOptions::default())
            .unwrap();
        serde_json::to_writer(
            &mut writer,
            &Manifest {
                format: 1,
                created_at: storage::now(),
                files,
                directories: vec![".novelforge".into()],
            },
        )
        .unwrap();
        let mut archive = ZipArchive::new(writer.finish().unwrap()).unwrap();
        let value = manifest(&mut archive).unwrap();
        assert!(verify(&mut archive, &value)
            .unwrap_err()
            .contains("校验失败"));
    }
    #[test]
    fn rejects_traversal_and_windows_aliases() {
        for name in [
            "../escape",
            "/absolute",
            "C:/path",
            "a\\b",
            "a/../b",
            "a//b",
            "CON.txt",
            "file.",
            "file ",
        ] {
            assert!(!safe_name(name), "{name}");
        }
        assert!(safe_name(".novelforge/history/章节.md"));
    }
}
