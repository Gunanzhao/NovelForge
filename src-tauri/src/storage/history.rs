use super::*;

pub fn recovery_items(root: &Path, connection: &Connection) -> Result<Vec<RecoveryItem>, String> {
    let recovery_dir = safe_relative(root, ".novelforge/recovery")?;
    if !recovery_dir.is_dir() {
        return Ok(Vec::new());
    }
    let nodes = all_nodes(connection, false)?;
    let mut items = Vec::new();
    let entries = fs::read_dir(&recovery_dir).map_err(|error| format!("无法读取恢复目录：{}", error))?;
    for entry in entries {
        let path = entry.map_err(|error| format!("读取恢复文件失败：{}", error))?.path();
        if !path.is_file() {
            continue;
        }
        let filename = match path.file_name().and_then(|name| name.to_str()) {
            Some(value) => value,
            None => continue,
        };
        let node_id = match filename.split("--").next() {
            Some(value) if !value.is_empty() => value,
            _ => continue,
        };
        let node = match nodes.iter().find(|candidate| candidate.id == node_id) {
            Some(value) => value,
            None => continue,
        };
        let created_at = filename.split("--").nth(1).unwrap_or("unknown")
            .trim_end_matches(".md").to_string();
        items.push(RecoveryItem {
            id: filename.to_string(), node_id: node.id.clone(), node_title: node.title.clone(),
            path: path.to_string_lossy().to_string(), created_at,
        });
    }
    items.sort_by(|left, right| right.created_at.cmp(&left.created_at));
    Ok(items)
}

pub fn history_items(connection: &Connection, node_id: &str) -> Result<Vec<HistoryItem>, String> {
    let mut statement = connection.prepare(
        "SELECT id, node_id, node_title, reason, word_count, created_at, file_path FROM revisions WHERE node_id = ?1 ORDER BY created_at DESC LIMIT 100",
    ).map_err(|error| format!("读取版本历史失败：{}", error))?;
    let rows = statement.query_map(params![node_id], |row| Ok(HistoryItem {
        id: row.get(0)?, node_id: row.get(1)?, node_title: row.get(2)?, reason: row.get(3)?,
        word_count: row.get::<_, i64>(4)? as u64, created_at: row.get(5)?, path: row.get(6)?,
    })).map_err(|error| format!("读取版本历史失败：{}", error))?;
    let mut history = Vec::new();
    for row in rows {
        history.push(row.map_err(|error| format!("读取版本历史失败：{}", error))?);
    }
    Ok(history)
}

pub fn parse_timestamp(value: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value).ok().map(|date| date.with_timezone(&Utc))
}

pub fn copy_history(root: &Path, node_id: &str, revision_id: &str, content: &str) -> Result<String, String> {
    let relative = format!(".novelforge/history/{}/{}.md", node_id, revision_id);
    let path = safe_relative(root, &relative)?;
    atomic_write(&path, content.as_bytes())?;
    Ok(relative)
}

pub fn write_recovery(root: &Path, node_id: &str, content: &str) -> Result<(String, String), String> {
    let timestamp = Utc::now().format("%Y%m%dT%H%M%S%.3fZ").to_string();
    let filename = format!("{}--{}.md", node_id, timestamp);
    let relative = format!(".novelforge/recovery/{}", filename);
    let path = safe_relative(root, &relative)?;
    atomic_write(&path, content.as_bytes())?;
    Ok((filename, path.to_string_lossy().to_string()))
}

