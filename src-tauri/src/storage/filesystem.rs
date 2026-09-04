use super::*;

const DIRECTORIES: &[&str] = &[
    "manuscript", "characters", "locations", "world", "timeline", "outlines",
    "scenes", "foreshadowing", "relationships", "notes", "research", "attachments", "trash",
    ".novelforge/history", ".novelforge/recovery", ".novelforge/cache",
    ".novelforge/index", ".novelforge/exports", ".novelforge/logs",
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

fn ensure_within_root(root: &Path, candidate: &Path) -> Result<(), String> {
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
        fs::create_dir_all(&path).map_err(|error| {
            format!("无法创建项目目录 {}：{}", path.display(), error)
        })?;
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
    let canonical = fs::canonicalize(&root).map_err(|error| format!("无法访问项目文件夹：{}", error))?;
    if canonical.join(PROJECT_FILE).exists() {
        return Err("该文件夹已经是 NovelForge 项目".to_string());
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
    if candidate.components().any(|component| !matches!(component, Component::Normal(_))) {
        return Err("项目路径只能包含普通相对路径段".to_string());
    }
    let joined = root.join(candidate);
    ensure_within_root(root, &joined)?;
    Ok(joined)
}

pub fn safe_trash_path(root: &Path, stored_path: &str) -> Result<PathBuf, String> {
    let candidate = PathBuf::from(stored_path);
    if !candidate.is_absolute() {
        return Err("回收站路径必须是绝对路径".to_string());
    }
    let trash_root = safe_relative(root, "trash/items")?;
    if !trash_root.is_dir() {
        return Err("项目回收站目录不存在".to_string());
    }
    let canonical_trash_root = fs::canonicalize(&trash_root)
        .map_err(|error| format!("无法规范化回收站目录：{}", error))?;
    let canonical_candidate = fs::canonicalize(&candidate)
        .map_err(|error| format!("无法访问回收站内容 {}：{}", candidate.display(), error))?;
    if canonical_candidate == canonical_trash_root || !canonical_candidate.starts_with(&canonical_trash_root) {
        return Err(format!("拒绝访问项目回收站外的路径：{}", candidate.display()));
    }
    Ok(canonical_candidate)
}

pub fn atomic_write(target: &Path, content: &[u8]) -> Result<(), String> {
    let parent = target.parent().ok_or_else(|| "无法确定文件目录".to_string())?;
    fs::create_dir_all(parent).map_err(|error| format!("无法创建文件目录：{}", error))?;
    let filename = target.file_name().and_then(|name| name.to_str())
        .ok_or_else(|| "文件名无效".to_string())?;
    let temp = parent.join(format!(".{}.tmp-{}", filename, new_id()));
    let result = (|| -> Result<(), String> {
        let mut file = OpenOptions::new().write(true).create_new(true).open(&temp)
            .map_err(|error| format!("无法创建临时文件：{}", error))?;
        file.write_all(content).map_err(|error| format!("写入临时文件失败：{}", error))?;
        file.sync_all().map_err(|error| format!("刷新临时文件失败：{}", error))?;
        drop(file);
        replace_file(&temp, target)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}

fn replace_file(source: &Path, target: &Path) -> Result<(), String> {
    // Windows std::fs::rename 不覆盖现有文件；失败时会恢复旧文件。
    if target.exists() {
        let backup = target.with_file_name(format!(
            ".{}.backup-{}",
            target.file_name().and_then(|name| name.to_str()).unwrap_or("file"),
            new_id()
        ));
        fs::rename(target, &backup).map_err(|error| format!("准备替换文件失败：{}", error))?;
        match fs::rename(source, target) {
            Ok(()) => {
                let _ = fs::remove_file(backup);
                Ok(())
            }
            Err(error) => {
                let _ = fs::rename(&backup, target);
                Err(format!("原子替换文件失败：{}", error))
            }
        }
    } else {
        fs::rename(source, target).map_err(|error| format!("原子替换文件失败：{}", error))
    }
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
    fs::create_dir_all(&trash_directory).map_err(|error| format!("无法创建回收站目录：{}", error))?;
    let filename = original.file_name().and_then(|name| name.to_str()).unwrap_or("item");
    let trash_path = trash_directory.join(format!("{}_{}_{}", ref_id, Utc::now().timestamp_millis(), filename));
    ensure_within_root(root, &trash_path)?;
    fs::rename(original, &trash_path).map_err(|error| format!("移动到回收站失败：{}", error))?;
    Ok(trash_path.to_string_lossy().to_string())
}
