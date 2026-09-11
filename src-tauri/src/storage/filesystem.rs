use super::*;

const DIRECTORIES: &[&str] = &[
    "manuscript",
    "characters",
    "locations",
    "world",
    "timeline",
    "outlines",
    "scenes",
    "foreshadowing",
    "relationships",
    "notes",
    "research",
    "attachments",
    "mentions",
    "story-arcs",
    "prompts",
    "inbox",
    "checklist-templates",
    "checklists",
    "trash",
    ".novelforge/history",
    ".novelforge/recovery",
    ".novelforge/cache",
    ".novelforge/index",
    ".novelforge/exports",
    ".novelforge/logs",
];

fn canonical_root(root: &Path) -> Result<PathBuf, String> {
    fs::canonicalize(root).map_err(|error| format!("无法规范化项目根目录：{}", error))
}

fn canonical_existing_ancestor(path: &Path) -> Result<PathBuf, String> {
    let mut current = Some(path);
    while let Some(candidate) = current {
        match fs::symlink_metadata(candidate) {
            Ok(_) => {
                return fs::canonicalize(candidate).map_err(|error| {
                    format!("无法规范化项目路径 {}：{}", candidate.display(), error)
                });
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(format!(
                    "无法检查项目路径 {}：{}",
                    candidate.display(),
                    error
                ));
            }
        }
        current = candidate.parent();
    }
    Err("无法找到项目路径的现有父目录".to_string())
}

pub(crate) fn ensure_within_root(root: &Path, candidate: &Path) -> Result<(), String> {
    let canonical_root = canonical_root(root)?;
    let boundary = match fs::symlink_metadata(candidate) {
        Ok(_) => {
            let canonical_candidate = fs::canonicalize(candidate).map_err(|error| {
                format!("无法规范化项目路径 {}：{}", candidate.display(), error)
            })?;
            if canonical_candidate == canonical_root {
                return Err("项目路径不能指向项目根目录本身".to_string());
            }
            canonical_candidate
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            canonical_existing_ancestor(candidate)?
        }
        Err(error) => {
            return Err(format!(
                "无法检查项目路径 {}：{}",
                candidate.display(),
                error
            ));
        }
    };
    if !boundary.starts_with(&canonical_root) {
        return Err(format!("项目路径越界：{}", candidate.display()));
    }
    Ok(())
}

pub fn safe_existing_path(root: &Path, candidate: &Path) -> Result<PathBuf, String> {
    let canonical_root = canonical_root(root)?;
    let canonical_candidate = fs::canonicalize(candidate)
        .map_err(|error| format!("无法规范化项目恢复路径 {}：{}", candidate.display(), error))?;
    if canonical_candidate == canonical_root || !canonical_candidate.starts_with(&canonical_root) {
        return Err(format!("项目恢复路径越界：{}", candidate.display()));
    }
    Ok(canonical_candidate)
}

pub fn create_project_directories(root: &Path) -> Result<(), String> {
    for directory in DIRECTORIES {
        let path = safe_relative(root, directory)?;
        fs::create_dir_all(&path)
            .map_err(|error| format!("无法创建项目目录 {}：{}", path.display(), error))?;
    }
    Ok(())
}

pub fn new_project_root(input: &str) -> Result<PathBuf, String> {
    if input.trim().is_empty() {
        return Err("项目路径不能为空".to_string());
    }
    let root = PathBuf::from(input);
    if root.exists() && !root.is_dir() {
        return Err("项目路径不是文件夹".to_string());
    }
    fs::create_dir_all(&root).map_err(|error| format!("无法创建项目文件夹：{}", error))?;
    let canonical =
        fs::canonicalize(&root).map_err(|error| format!("无法访问项目文件夹：{}", error))?;
    if canonical.join(PROJECT_FILE).exists() {
        return Err("该文件夹已经是 NovelForge 项目".to_string());
    }
    if fs::read_dir(&canonical)
        .map_err(|error| format!("无法检查项目文件夹：{error}"))?
        .next()
        .transpose()
        .map_err(|error| format!("无法检查项目文件夹内容：{error}"))?
        .is_some()
    {
        return Err(
            "新项目必须使用空文件夹；已有正文或资料不会被覆盖，请选择其他文件夹或打开原项目".into(),
        );
    }
    Ok(canonical)
}

pub fn existing_project_root(input: &str) -> Result<PathBuf, String> {
    if input.trim().is_empty() {
        return Err("项目路径不能为空".to_string());
    }
    let root = fs::canonicalize(PathBuf::from(input))
        .map_err(|error| format!("无法访问项目文件夹：{}", error))?;
    if !root.is_dir() {
        return Err("项目路径不是文件夹".to_string());
    }
    let project_file = safe_relative(&root, PROJECT_FILE)?;
    if !project_file.is_file() {
        let backups: Vec<_> = fs::read_dir(&root)
            .map_err(|e| e.to_string())?
            .filter_map(Result::ok)
            .filter(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with(".project.json.backup-")
            })
            .map(|entry| entry.path().display().to_string())
            .collect();
        if !backups.is_empty() {
            return Err(format!("检测到旧版写入中断，project.json 缺失。原副本已保留，请复制所需副本为 project.json 后重试：{}", backups.join("；")));
        }
        return Err("这里没有找到 project.json，不是有效的 NovelForge 项目".to_string());
    }
    Ok(root)
}

pub fn write_project_json(root: &Path, metadata: &ProjectMetadata) -> Result<(), String> {
    let data = serde_json::to_vec_pretty(metadata)
        .map_err(|error| format!("项目元数据序列化失败：{}", error))?;
    atomic_write(&safe_relative(root, PROJECT_FILE)?, &data)
}

pub fn read_project_json(root: &Path) -> Result<ProjectMetadata, String> {
    let data = fs::read(safe_relative(root, PROJECT_FILE)?)
        .map_err(|error| format!("无法读取 project.json：{}", error))?;
    serde_json::from_slice(&data).map_err(|error| format!("project.json 格式无效：{}", error))
}

pub fn touch_project(root: &Path) -> Result<(), String> {
    let mut metadata = read_project_json(root)?;
    metadata.updated_at = now();
    write_project_json(root, &metadata)
}

pub fn safe_relative(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let candidate = Path::new(relative);
    if candidate.is_absolute() || relative.trim().is_empty() {
        return Err("项目相对路径无效".to_string());
    }
    if candidate
        .components()
        .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err("项目路径只能包含普通相对路径段".to_string());
    }
    let joined = root.join(candidate);
    ensure_within_root(root, &joined)?;
    Ok(joined)
}

pub fn safe_trash_path(root: &Path, stored_path: &str) -> Result<PathBuf, String> {
    // Old projects stored absolute paths. Resolve only their trash/items suffix
    // against this project, never access the original project's files.
    let normalized = stored_path.replace('\\', "/");
    let relative = if normalized.starts_with("trash/items/") {
        normalized.as_str()
    } else {
        let absolute = normalized.starts_with('/')
            || (normalized.as_bytes().get(1) == Some(&b':')
                && normalized.as_bytes().get(2) == Some(&b'/'));
        if !absolute {
            return Err("回收站路径必须位于 trash/items 内".into());
        }
        let (_, suffix) = normalized
            .rsplit_once("/trash/items/")
            .ok_or("回收站路径必须位于 trash/items 内")?;
        if suffix.is_empty() {
            return Err("回收站条目路径为空".into());
        }
        // The following safe_relative/canonical checks reject traversal and links.
        return safe_trash_path(root, &format!("trash/items/{suffix}"));
    };
    let candidate = safe_relative(root, relative)?;
    let trash_root = safe_relative(root, "trash/items")?;
    let canonical_trash_root = fs::canonicalize(&trash_root)
        .map_err(|error| format!("无法规范化回收站目录：{}", error))?;
    let canonical_candidate = fs::canonicalize(&candidate)
        .map_err(|error| format!("无法访问回收站内容 {}：{}", candidate.display(), error))?;
    if canonical_candidate == canonical_trash_root
        || !canonical_candidate.starts_with(&canonical_trash_root)
    {
        return Err(format!(
            "拒绝访问项目回收站外的路径：{}",
            candidate.display()
        ));
    }
    Ok(canonical_candidate)
}

pub fn atomic_write(target: &Path, content: &[u8]) -> Result<(), String> {
    let parent = target
        .parent()
        .ok_or_else(|| "无法确定文件目录".to_string())?;
    fs::create_dir_all(parent).map_err(|error| format!("无法创建文件目录：{}", error))?;
    let filename = target
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "文件名无效".to_string())?;
    let temp = parent.join(format!(".{}.tmp-{}", filename, new_id()));
    let result = (|| -> Result<(), String> {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)
            .map_err(|error| format!("无法创建临时文件：{}", error))?;
        file.write_all(content)
            .map_err(|error| format!("写入临时文件失败：{}", error))?;
        file.sync_all()
            .map_err(|error| format!("刷新临时文件失败：{}", error))?;
        drop(file);
        replace_file(&temp, target)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}

fn replace_file(source: &Path, target: &Path) -> Result<(), String> {
    // Same-directory rename replaces an existing file on Unix and Windows
    // (MoveFileExW with MOVEFILE_REPLACE_EXISTING). Never remove the old name first.
    // The temp file is synced above; atomic visibility is not a power-loss guarantee.
    fs::rename(source, target).map_err(|error| format!("原子替换文件失败：{}", error))
}

pub fn remove_file_if_exists(path: &Path) -> Result<(), String> {
    if path.exists() {
        fs::remove_file(path).map_err(|error| format!("删除临时文件失败：{}", error))?;
    }
    Ok(())
}

pub fn move_to_trash(root: &Path, original: &Path, ref_id: &str) -> Result<String, String> {
    ensure_within_root(root, original)?;
    if !original.exists() {
        return Err(format!("待删除内容不存在：{}", original.display()));
    }
    let trash_directory = safe_relative(root, "trash/items")?;
    fs::create_dir_all(&trash_directory)
        .map_err(|error| format!("无法创建回收站目录：{}", error))?;
    let filename = original
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("item");
    let trash_path = trash_directory.join(format!(
        "{}_{}_{}",
        ref_id,
        Utc::now().timestamp_millis(),
        filename
    ));
    ensure_within_root(root, &trash_path)?;
    fs::rename(original, &trash_path).map_err(|error| format!("移动到回收站失败：{}", error))?;
    Ok(trash_path.to_string_lossy().to_string())
}

#[cfg(test)]
mod atomic_tests {
    use super::*;
    #[test]
    fn replacement_failure_preserves_old_target_and_success_replaces_it() {
        let root = std::env::temp_dir().join(format!("nf-atomic-{}", new_id()));
        fs::create_dir(&root).unwrap();
        let target = root.join("chapter.md");
        atomic_write(&target, b"old draft").unwrap();
        assert!(replace_file(&root.join("missing-temp"), &target).is_err());
        assert_eq!(fs::read(&target).unwrap(), b"old draft");
        // An interrupted preparation leaves a temp file, never a missing target.
        fs::write(root.join(".chapter.md.tmp-interrupted"), b"partial").unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"old draft");
        atomic_write(&target, b"new draft").unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"new draft");
        assert!(!fs::read_dir(&root).unwrap().any(|p| p
            .unwrap()
            .file_name()
            .to_string_lossy()
            .contains("backup-")));
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn legacy_interruption_reports_preserved_metadata_copy() {
        let root = std::env::temp_dir().join(format!("nf-legacy-{}", new_id()));
        fs::create_dir(&root).unwrap();
        let copy = root.join(".project.json.backup-interrupted");
        fs::write(&copy, b"preserved").unwrap();
        let error = existing_project_root(root.to_str().unwrap()).unwrap_err();
        assert!(error.contains("旧版写入中断"));
        assert!(error.contains(copy.to_str().unwrap()));
        assert_eq!(fs::read(copy).unwrap(), b"preserved");
        fs::remove_dir_all(root).unwrap();
    }
}
