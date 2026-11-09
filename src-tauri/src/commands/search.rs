use crate::models::{SearchInput, SearchPage, SearchResult};
use rusqlite::{params, Connection};
use std::collections::HashSet;

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

const PAGE_SIZE: usize = 100;

fn read_search_page(
    connection: &Connection,
    input: &SearchInput,
    offset: usize,
) -> rusqlite::Result<SearchPage> {
    let mut page = SearchPage::default();
    let query = input.query.trim();
    if query.is_empty() {
        return Ok(page);
    }
    let fts_query = clean_query(query);
    let literal = format!(
        "%{}%",
        query
            .replace('!', "!!")
            .replace('%', "!%")
            .replace('_', "!_")
    );
    let current = (input.scope.as_deref() == Some("current"))
        .then(|| input.node_id.as_deref().unwrap_or_default());
    let volume = input
        .volume_path
        .as_deref()
        .filter(|path| !path.trim().is_empty())
        .map(|path| format!("{}/", path.replace('\\', "/").trim_end_matches('/')));
    let case_sensitive = input.case_sensitive.unwrap_or_default();
    let tag = input
        .tag
        .as_deref()
        .map(str::trim)
        .filter(|tag| !tag.is_empty());
    let tag = tag.map(|tag| {
        if case_sensitive {
            tag.to_owned()
        } else {
            tag.to_lowercase()
        }
    });
    let mut seen = HashSet::new();

    // Token matches come first; literal matches also find words inside CJK text.
    // Count only distinct, fully filtered rows towards the offset and page size.
    for (needle, predicate, highlight) in [
        (
            fts_query.as_str(),
            "search_index MATCH ?1",
            "snippet(search_index, 3, '<mark>', '</mark>', '…', 24)",
        ),
        (
            literal.as_str(),
            "title LIKE ?1 ESCAPE '!' OR content LIKE ?1 ESCAPE '!'",
            "NULL",
        ),
    ] {
        if needle.is_empty() {
            continue;
        }
        let mut statement = connection.prepare(&format!(
            "SELECT ref_id, kind, title, path, content, {highlight},
                    CASE WHEN ?5 THEN (SELECT tags_json FROM entities
                        WHERE id=search_index.ref_id AND deleted_at IS NULL) END
             FROM search_index WHERE ({predicate})
               AND (?2 IS NULL OR kind=?2 OR (?2='manuscript' AND kind IN ('chapter','section')))
               AND (?3 IS NULL OR ref_id=?3)
               AND (?4 IS NULL OR substr(replace(path,char(92),'/'),1,length(?4))=?4)
               AND (NOT ?5 OR kind NOT IN ('chapter','section'))
             ORDER BY rowid"
        ))?;
        let mut rows =
            statement.query(params![needle, input.kind, current, volume, tag.is_some()])?;
        while let Some(row) = rows.next()? {
            let id: String = row.get(0)?;
            if seen.contains(&id) {
                continue;
            }
            if let Some(tag) = tag.as_ref() {
                let tags = row
                    .get::<_, Option<String>>(6)?
                    .and_then(|value| serde_json::from_str::<Vec<String>>(&value).ok())
                    .unwrap_or_default();
                if !tags.iter().any(|value| {
                    if case_sensitive {
                        value.contains(tag)
                    } else {
                        value.to_lowercase().contains(tag)
                    }
                }) {
                    continue;
                }
            }
            let title: &str = row.get_ref(2)?.as_str()?;
            let content: &str = row.get_ref(4)?.as_str()?;
            if case_sensitive
                && !query
                    .split_whitespace()
                    .all(|term| title.contains(term) || content.contains(term))
            {
                continue;
            }
            seen.insert(id.clone());
            if seen.len() <= offset {
                continue;
            }
            if page.results.len() == PAGE_SIZE {
                page.has_more = true;
                return Ok(page);
            }
            page.results.push(SearchResult {
                id,
                kind: row.get(1)?,
                title: title.to_owned(),
                path: row.get(3)?,
                snippet: row
                    .get::<_, Option<String>>(5)?
                    .unwrap_or_else(|| snippet(content, query)),
            });
        }
    }
    Ok(page)
}

#[tauri::command]
pub fn search_project(input: SearchInput) -> Result<Vec<SearchResult>, String> {
    Ok(search_project_page(input, 0)?.results)
}

#[tauri::command]
pub fn search_project_page(input: SearchInput, offset: u32) -> Result<SearchPage, String> {
    let (_root, connection) = project_connection(&input.project_path)?;
    read_search_page(&connection, &input, offset as usize)
        .map_err(|error| format!("执行全文搜索失败：{}", error))
}
