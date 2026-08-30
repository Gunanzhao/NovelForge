use crate::models::{SearchInput, SearchResult};
use rusqlite::{params, Connection, OptionalExtension};

use super::project_connection;

fn clean_query(query: &str) -> String {
    query.split_whitespace()
        .map(|term| format!("\"{}\"", term.replace('"', "")))
        .filter(|term| term != "\"\"")
        .collect::<Vec<String>>()
        .join(" AND ")
}

fn snippet(content: &str, query: &str) -> String {
    let lower = content.to_lowercase();
    let needle = query.trim().to_lowercase();
    let position = lower.find(&needle).unwrap_or(0);
    let start = position.saturating_sub(45);
    let end = (position + needle.chars().count() + 90).min(content.len());
    let mut value = content.get(start..end).unwrap_or(content).replace('\n', " ");
    if start > 0 { value = format!("…{}", value); }
    if end < content.len() { value.push('…'); }
    value
}

fn contains_search_terms(value: &str, query: &str, case_sensitive: bool) -> bool {
    let source = if case_sensitive { value.to_string() } else { value.to_lowercase() };
    query.split_whitespace().filter(|term| !term.is_empty()).all(|term| {
        let needle = if case_sensitive { term.to_string() } else { term.to_lowercase() };
        source.contains(&needle)
    })
}

fn search_matches_filters(connection: &Connection, input: &SearchInput, id: &str, kind: &str, path: &str, title: &str, content: &str) -> Result<bool, String> {
    if input.scope.as_deref() == Some("current") && input.node_id.as_deref() != Some(id) {
        return Ok(false);
    }
    if let Some(volume_path) = input.volume_path.as_deref().filter(|value| !value.trim().is_empty()) {
        let normalized = volume_path.trim_end_matches('/').replace('\\', "/");
        if !path.replace('\\', "/").starts_with(&(normalized + "/")) {
            return Ok(false);
        }
    }
    if let Some(tag) = input.tag.as_deref().filter(|value| !value.trim().is_empty()) {
        if kind == "chapter" || kind == "section" {
            return Ok(false);
        }
        let tags_json: Option<String> = connection.query_row(
            "SELECT tags_json FROM entities WHERE id = ?1 AND deleted_at IS NULL",
            params![id],
            |row| row.get(0),
        ).optional().map_err(|error| format!("读取搜索标签失败：{}", error))?;
        let tags: Vec<String> = tags_json.and_then(|value| serde_json::from_str(&value).ok()).unwrap_or_default();
        let matched = tags.iter().any(|value| {
            if input.case_sensitive.unwrap_or(false) { value.contains(tag) } else { value.to_lowercase().contains(&tag.to_lowercase()) }
        });
        if !matched { return Ok(false); }
    }
    if input.case_sensitive.unwrap_or(false) && !contains_search_terms(&format!("{} {}", title, content), &input.query, true) {
        return Ok(false);
    }
    Ok(true)
}

#[tauri::command]
pub fn search_project(input: SearchInput) -> Result<Vec<SearchResult>, String> {
    let (_root, connection) = project_connection(&input.project_path)?;
    let mut results = Vec::new();
    let fts_query = clean_query(&input.query);
    if !fts_query.is_empty() {
        let mut fts_rows = Vec::new();
        if let Ok(mut statement) = connection.prepare(
            "SELECT ref_id, kind, title, path, content, snippet(search_index, 3, '<mark>', '</mark>', '…', 24) FROM search_index WHERE search_index MATCH ?1 LIMIT 100",
        ) {
            if let Ok(rows) = statement.query_map(params![fts_query], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?, row.get::<_, String>(3)?, row.get::<_, String>(4)?, row.get::<_, String>(5)?))
            }) {
                fts_rows.extend(rows.flatten());
            }
        }
        for (id, kind, title, path, content, highlighted) in fts_rows {
            let matches_kind = input.kind.as_deref().is_none_or(|filter| filter == kind || (filter == "manuscript" && (kind == "chapter" || kind == "section")));
            if matches_kind && search_matches_filters(&connection, &input, &id, &kind, &path, &title, &content)? {
                results.push(SearchResult { id, kind, title, path, snippet: highlighted });
            }
        }
    }
    let like = format!("%{}%", input.query.trim());
    let mut fallback_rows = Vec::new();
    {
        let mut fallback = connection.prepare(
            "SELECT ref_id, kind, title, path, content FROM search_index WHERE title LIKE ?1 OR content LIKE ?1 LIMIT 100",
        ).map_err(|error| format!("执行全文搜索失败：{}", error))?;
        let rows = fallback.query_map(params![like], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?, row.get::<_, String>(3)?, row.get::<_, String>(4)?))
        }).map_err(|error| format!("执行全文搜索失败：{}", error))?;
        fallback_rows.extend(rows.flatten());
    }
    for (id, kind, title, path, content) in fallback_rows {
        let matches_kind = input.kind.as_deref().is_none_or(|filter| filter == kind || (filter == "manuscript" && (kind == "chapter" || kind == "section")));
        let matches_filters = search_matches_filters(&connection, &input, &id, &kind, &path, &title, &content)?;
        if matches_kind && matches_filters && !results.iter().any(|existing: &SearchResult| existing.id == id) {
            results.push(SearchResult { id, kind, title, path, snippet: snippet(&content, &input.query) });
        }
    }
    results.truncate(100);
    Ok(results)
}

