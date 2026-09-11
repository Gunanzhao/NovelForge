use super::*;

pub fn recovery_items(root: &Path, connection: &Connection) -> Result<Vec<RecoveryItem>, String> {
    let recovery_dir = safe_relative(root, ".novelforge/recovery")?;
    if !recovery_dir.is_dir() {
        return Ok(Vec::new());
    }
    let nodes = all_nodes(connection, false)?;
    let mut items = Vec::new();
    let entries =
        fs::read_dir(&recovery_dir).map_err(|error| format!("无法读取恢复目录：{}", error))?;
    for entry in entries {
        let path = entry
            .map_err(|error| format!("读取恢复文件失败：{}", error))?
            .path();
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
        let created_at = filename
            .split("--")
            .nth(1)
            .unwrap_or("unknown")
            .trim_end_matches(".md")
            .to_string();
        items.push(RecoveryItem {
            id: filename.to_string(),
            node_id: node.id.clone(),
            node_title: node.title.clone(),
            path: path.to_string_lossy().to_string(),
            created_at,
        });
    }
    items.sort_by(|left, right| right.created_at.cmp(&left.created_at));
    Ok(items)
}

pub fn history_items(connection: &Connection, node_id: &str) -> Result<Vec<HistoryItem>, String> {
    let mut statement = connection.prepare(
        "SELECT id, node_id, node_title, reason, word_count, created_at, file_path FROM revisions WHERE node_id = ?1 ORDER BY created_at DESC, rowid DESC",
    ).map_err(|error| format!("读取版本历史失败：{}", error))?;
    let rows = statement
        .query_map(params![node_id], |row| {
            Ok(HistoryItem {
                id: row.get(0)?,
                node_id: row.get(1)?,
                node_title: row.get(2)?,
                reason: row.get(3)?,
                word_count: row.get::<_, i64>(4)? as u64,
                created_at: row.get(5)?,
                path: row.get(6)?,
            })
        })
        .map_err(|error| format!("读取版本历史失败：{}", error))?;
    let mut history = Vec::new();
    for row in rows {
        history.push(row.map_err(|error| format!("读取版本历史失败：{}", error))?);
    }
    Ok(history)
}

pub fn history_page(
    connection: &Connection,
    node_id: &str,
    before: Option<&str>,
    filter: &str,
) -> Result<Vec<HistoryItem>, String> {
    if !matches!(filter, "all" | "named" | "automatic" | "protected") {
        return Err("历史来源筛选无效".into());
    }
    let mut statement = connection.prepare(
        "SELECT id, node_id, node_title, reason, word_count, created_at, file_path FROM revisions
         WHERE node_id = ?1
         AND (?2 IS NULL OR (created_at, rowid) < (SELECT created_at, rowid FROM revisions WHERE id = ?2 AND node_id = ?1))
         AND (?3 = 'all' OR (?3 = 'named' AND reason LIKE '命名版本：%') OR (?3 = 'automatic' AND reason = '自动保存') OR (?3 = 'protected' AND (reason LIKE '%保护%' OR reason LIKE '%恢复前%')))
         ORDER BY created_at DESC, rowid DESC LIMIT 101"
    ).map_err(|e| format!("读取历史分页失败：{e}"))?;
    let rows = statement
        .query_map(params![node_id, before, filter], |row| {
            Ok(HistoryItem {
                id: row.get(0)?,
                node_id: row.get(1)?,
                node_title: row.get(2)?,
                reason: row.get(3)?,
                word_count: row.get::<_, i64>(4)? as u64,
                created_at: row.get(5)?,
                path: row.get(6)?,
            })
        })
        .map_err(|e| format!("读取历史分页失败：{e}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("读取历史分页失败：{e}"))
}

pub fn parse_timestamp(value: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|date| date.with_timezone(&Utc))
}

pub fn copy_history(
    root: &Path,
    node_id: &str,
    revision_id: &str,
    content: &str,
) -> Result<String, String> {
    let relative = format!(".novelforge/history/{}/{}.md", node_id, revision_id);
    let path = safe_relative(root, &relative)?;
    atomic_write(&path, content.as_bytes())?;
    Ok(relative)
}

pub fn write_recovery(
    root: &Path,
    node_id: &str,
    content: &str,
) -> Result<(String, String), String> {
    let timestamp = Utc::now().format("%Y%m%dT%H%M%S%.3fZ").to_string();
    let filename = format!("{}--{}.md", node_id, timestamp);
    let relative = format!(".novelforge/recovery/{}", filename);
    let path = safe_relative(root, &relative)?;
    atomic_write(&path, content.as_bytes())?;
    Ok((filename, path.to_string_lossy().to_string()))
}

/// Schedule history independently of body saves; never delete existing snapshots.
pub fn needs_snapshot(
    root: &Path,
    connection: &Connection,
    node_id: &str,
    content: &str,
    reason: &str,
) -> Result<bool, String> {
    if matches!(reason, "手动保存" | "命令面板保存" | "右键菜单保存") {
        return Ok(false);
    }
    let latest: Option<(String, String, String)> = connection.query_row(
        "SELECT file_path, created_at, reason FROM revisions WHERE node_id = ?1 ORDER BY created_at DESC, rowid DESC LIMIT 1",
        params![node_id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    ).optional().map_err(|e| format!("读取最近历史失败：{}", e))?;
    let Some((path, time, previous_reason)) = latest else {
        return Ok(true);
    };
    // An unavailable previous snapshot cannot be reused. Create a fresh one;
    // the old record remains visible and reading it still reports the damage.
    let previous = match fs::read_to_string(safe_relative(root, &path)?) {
        Ok(content) => content,
        Err(_) => {
            let _ = append_log(
                root,
                "WARN",
                "previous_history_unreadable_creating_fresh_snapshot",
            );
            return Ok(true);
        }
    };
    let named = reason.starts_with("命名版本：");
    if previous == content && (!named || previous_reason == reason) {
        return Ok(false);
    }
    if reason == "自动保存" || reason.is_empty() {
        if let Some(time) = parse_timestamp(&time) {
            return Ok(Utc::now().signed_duration_since(time).num_seconds() >= 300);
        }
    }
    Ok(true)
}
