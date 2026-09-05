use crate::models::{SearchInput, SearchResult};
use rusqlite::{params, Connection, OptionalExtension};

use super::project_connection;

fn clean_query(query: &str) -> String {
    query
        .split_whitespace()
        .map(|term| format!("\"{}\"", term.replace('"', "")))
        .filter(|term| term != "\"\"")
        .collect::<Vec<String>>()
        .join(" AND ")
}

fn snippet(content: &str, query: &str) -> String {
    let lower = content.to_lowercase();
    let needle = query.trim().to_lowercase();
    // Lowercasing can expand a character (for example İ -> i + combining dot).
    // Map lowercase byte offsets back to original character positions.
    let chars: Vec<char> = content.chars().collect();
    let (position, match_end) = lower
        .find(&needle)
        .map(|byte_start| {
            let byte_end = byte_start + needle.len();
            let mut offset = 0;
            let mut start = 0;
            let mut end = 0;
            for (index, character) in chars.iter().enumerate() {
                let next = offset + character.to_lowercase().map(char::len_utf8).sum::<usize>();
                if offset <= byte_start && byte_start < next {
                    start = index;
                }
                if offset < byte_end {
                    end = index + 1;
                }
                offset = next;
            }
            (start, end)
        })
        .unwrap_or((0, 0));
    let start = position.saturating_sub(45);
    let end = (match_end + 90).min(chars.len());
    let mut value = chars[start..end]
        .iter()
        .collect::<String>()
        .replace('\n', " ");
    if start > 0 {
        value = format!("…{}", value);
    }
    if end < chars.len() {
        value.push('…');
    }
    value
}

#[cfg(test)]
mod tests {
    use super::snippet;

    #[test]
    fn snippet_bounds_chinese_context_by_characters() {
        let content = format!("{}线索{}", "前".repeat(100), "后".repeat(150));
        assert_eq!(
            snippet(&content, "线索"),
            format!("…{}线索{}…", "前".repeat(45), "后".repeat(90))
        );
    }

    #[test]
    fn snippet_maps_lowercase_expansion_back_to_original() {
        let content = format!("{}ABC{}", "İ".repeat(100), "😀".repeat(150));
        assert_eq!(
            snippet(&content, "abc"),
            format!("…{}ABC{}…", "İ".repeat(45), "😀".repeat(90))
        );
        assert_eq!(snippet("İ后文", "i"), "İ后文");
    }

    #[test]
    fn snippet_handles_edges_newlines_and_absent_matches() {
        assert_eq!(snippet("中文\n结尾", "结尾"), "中文 结尾");
        assert_eq!(snippet("", "线索"), "");
        assert_eq!(
            snippet(&"中".repeat(200), "不存在"),
            format!("{}…", "中".repeat(90))
        );
        assert_eq!(
            snippet(&format!("{}END", "a".repeat(100)), "end"),
            format!("…{}END", "a".repeat(45))
        );
    }
}

fn contains_search_terms(value: &str, query: &str, case_sensitive: bool) -> bool {
    let source = if case_sensitive {
        value.to_string()
    } else {
        value.to_lowercase()
    };
    query
        .split_whitespace()
        .filter(|term| !term.is_empty())
        .all(|term| {
            let needle = if case_sensitive {
                term.to_string()
            } else {
                term.to_lowercase()
            };
            source.contains(&needle)
        })
}

fn search_matches_filters(
    connection: &Connection,
    input: &SearchInput,
    id: &str,
    kind: &str,
    path: &str,
    title: &str,
    content: &str,
) -> Result<bool, String> {
    if input.scope.as_deref() == Some("current") && input.node_id.as_deref() != Some(id) {
        return Ok(false);
    }
    if let Some(volume_path) = input
        .volume_path
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        let normalized = volume_path.trim_end_matches('/').replace('\\', "/");
        if !path.replace('\\', "/").starts_with(&(normalized + "/")) {
            return Ok(false);
        }
    }
    if let Some(tag) = input
        .tag
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        if kind == "chapter" || kind == "section" {
            return Ok(false);
        }
        let tags_json: Option<String> = connection
            .query_row(
                "SELECT tags_json FROM entities WHERE id = ?1 AND deleted_at IS NULL",
                params![id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| format!("读取搜索标签失败：{}", error))?;
        let tags: Vec<String> = tags_json
            .and_then(|value| serde_json::from_str(&value).ok())
            .unwrap_or_default();
        let matched = tags.iter().any(|value| {
            if input.case_sensitive.unwrap_or(false) {
                value.contains(tag)
            } else {
                value.to_lowercase().contains(&tag.to_lowercase())
            }
        });
        if !matched {
            return Ok(false);
        }
    }
    if input.case_sensitive.unwrap_or(false)
        && !contains_search_terms(&format!("{} {}", title, content), &input.query, true)
    {
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
            let matches_kind = input.kind.as_deref().is_none_or(|filter| {
                filter == kind
                    || (filter == "manuscript" && (kind == "chapter" || kind == "section"))
            });
            if matches_kind
                && search_matches_filters(&connection, &input, &id, &kind, &path, &title, &content)?
            {
                results.push(SearchResult {
                    id,
                    kind,
                    title,
                    path,
                    snippet: highlighted,
                });
            }
        }
    }
    let like = format!("%{}%", input.query.trim());
    let mut fallback_rows = Vec::new();
    {
        let mut fallback = connection.prepare(
            "SELECT ref_id, kind, title, path, content FROM search_index WHERE title LIKE ?1 OR content LIKE ?1 LIMIT 100",
        ).map_err(|error| format!("执行全文搜索失败：{}", error))?;
        let rows = fallback
            .query_map(params![like], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                ))
            })
            .map_err(|error| format!("执行全文搜索失败：{}", error))?;
        fallback_rows.extend(rows.flatten());
    }
    for (id, kind, title, path, content) in fallback_rows {
        let matches_kind = input.kind.as_deref().is_none_or(|filter| {
            filter == kind || (filter == "manuscript" && (kind == "chapter" || kind == "section"))
        });
        let matches_filters =
            search_matches_filters(&connection, &input, &id, &kind, &path, &title, &content)?;
        if matches_kind
            && matches_filters
            && !results
                .iter()
                .any(|existing: &SearchResult| existing.id == id)
        {
            results.push(SearchResult {
                id,
                kind,
                title,
                path,
                snippet: snippet(&content, &input.query),
            });
        }
    }
    results.truncate(100);
    Ok(results)
}
