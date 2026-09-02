use super::*;

pub fn redact_log_text(value: &str) -> String {
    let mut output = value.replace('\r', " ").replace('\n', " ");
    for marker in ["api_key", "api-key", "authorization", "bearer "] {
        let lower = output.to_ascii_lowercase();
        if let Some(index) = lower.find(marker) {
            output.replace_range(index.., "[REDACTED]");
        }
    }
    output.chars().take(240).collect()
}

pub fn append_log(root: &Path, level: &str, event: &str) -> Result<(), String> {
    if !["DEBUG", "INFO", "WARN", "ERROR"].contains(&level) {
        return Err("日志级别无效".to_string());
    }
    let path = safe_relative(root, ".novelforge/logs/app.log")?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("无法创建日志目录：{}", error))?;
    }
    let line = format!("{} [{}] {}\n", now(), level, redact_log_text(event));
    let mut file = OpenOptions::new().create(true).append(true).open(&path)
        .map_err(|error| format!("无法打开应用日志：{}", error))?;
    file.write_all(line.as_bytes()).map_err(|error| format!("写入应用日志失败：{}", error))?;
    file.sync_data().map_err(|error| format!("刷新应用日志失败：{}", error))?;
    Ok(())
}

pub fn read_logs(root: &Path) -> Result<String, String> {
    let path = safe_relative(root, ".novelforge/logs/app.log")?;
    if !path.is_file() {
        return Ok(String::new());
    }
    let content = fs::read_to_string(&path).map_err(|error| format!("读取应用日志失败：{}", error))?;
    let tail: String = content.chars().rev().take(8000).collect();
    Ok(tail.chars().rev().collect())
}

