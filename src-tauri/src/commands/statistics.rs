use crate::models::{StatisticsInput, Stats};
use crate::storage_impl as storage;
use chrono::{Duration, Utc};
use std::fs;

use super::project_connection;

#[tauri::command]
pub fn get_statistics(input: StatisticsInput) -> Result<Stats, String> {
    let (root, connection) = project_connection(&input.project_path)?;
    let nodes = storage::all_nodes(&connection, false)?;
    let mut total_words = 0;
    let mut chapter_count = 0;
    let mut chapter_stats = Vec::new();
    let mut word_counts = std::collections::HashMap::<String, u64>::new();
    for node in nodes.iter().filter(|node| node.kind != "volume") {
        if node.kind == "chapter" { chapter_count += 1; }
        if let Ok(content) = fs::read_to_string(storage::safe_relative(&root, &node.file_path)?) {
            let content = storage::strip_markdown_frontmatter(&content);
            let words = storage::word_count(&content);
            total_words += words;
            word_counts.insert(node.id.clone(), words);
            if node.kind == "chapter" {
                chapter_stats.push(crate::models::ChapterStats {
                    id: node.id.clone(), title: node.title.clone(), words, updated_at: node.updated_at.clone(),
                });
            }
        }
    }
    let now = Utc::now();
    let today = now.format("%Y-%m-%d").to_string();
    let yesterday = (now - Duration::days(1)).format("%Y-%m-%d").to_string();
    let week_start = (now - Duration::days(6)).date_naive();
    let month_start = (now - Duration::days(30)).date_naive();
    let mut today_words = 0_u64;
    let mut yesterday_words = 0_u64;
    let mut week_words = 0_u64;
    let mut month_words = 0_u64;
    let mut dates = std::collections::BTreeSet::new();
    let mut daily_totals = std::collections::BTreeMap::<String, u64>::new();
    let mut statement = connection.prepare("SELECT created_at, delta_words FROM activity")
        .map_err(|error| format!("读取写作统计失败：{}", error))?;
    let rows = statement.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)))
        .map_err(|error| format!("读取写作统计失败：{}", error))?;
    for row in rows.flatten() {
        let (created_at, delta) = row;
        let positive = delta.max(0) as u64;
        if let Some(date) = storage::parse_timestamp(&created_at) {
            let date_key = date.format("%Y-%m-%d").to_string();
            if positive > 0 { dates.insert(date_key.clone()); }
            *daily_totals.entry(date_key.clone()).or_default() += positive;
            if date_key == today { today_words += positive; }
            if date_key == yesterday { yesterday_words += positive; }
            if date.date_naive() >= week_start { week_words += positive; }
            if date.date_naive() >= month_start { month_words += positive; }
        }
    }
    let active_days = dates.len() as u64;
    let average_daily_words = if active_days > 0 { daily_totals.values().sum::<u64>() / active_days } else { 0 };
    let mut streak = 0;
    let mut cursor = now.date_naive();
    loop {
        let key = cursor.format("%Y-%m-%d").to_string();
        if dates.contains(&key) {
            streak += 1;
            cursor = cursor - Duration::days(1);
        } else {
            break;
        }
    }
    let mut longest_streak = 0;
    let mut run = 0;
    let mut previous: Option<chrono::NaiveDate> = None;
    for date in dates.iter().filter_map(|value| chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d").ok()) {
        if previous.is_some_and(|last| date == last + Duration::days(1)) { run += 1; } else { run = 1; }
        longest_streak = longest_streak.max(run);
        previous = Some(date);
    }
    let metadata = storage::read_project_json(&root)?;
    let daily = (0..30).rev().map(|offset| {
        let date = (now - Duration::days(offset)).format("%Y-%m-%d").to_string();
        let words = daily_totals.get(&date).copied().unwrap_or(0);
        crate::models::DailyStats { date, words }
    }).collect();
    chapter_stats.sort_by(|left, right| right.words.cmp(&left.words).then_with(|| left.title.cmp(&right.title)));
    let current_node = input.current_node_id.as_deref().and_then(|id| nodes.iter().find(|node| node.id == id));
    let current_chapter_words = current_node.filter(|node| node.kind == "chapter").and_then(|node| word_counts.get(&node.id).copied()).unwrap_or(0);
    let mut current_volume_id: Option<String> = None;
    if let Some(node) = current_node {
        let mut parent = node.parent_id.clone();
        while let Some(parent_id) = parent {
            if let Some(parent_node) = nodes.iter().find(|candidate| candidate.id == parent_id) {
                if parent_node.kind == "volume" { current_volume_id = Some(parent_node.id.clone()); break; }
                parent = parent_node.parent_id.clone();
            } else { break; }
        }
    }
    let current_volume_words = current_volume_id.map(|volume_id| {
        nodes.iter().filter(|node| node.kind != "volume" && (node.id == volume_id || {
            let mut parent = node.parent_id.clone();
            let mut found = false;
            while let Some(parent_id) = parent {
                if parent_id == volume_id { found = true; break; }
                parent = nodes.iter().find(|candidate| candidate.id == parent_id).and_then(|candidate| candidate.parent_id.clone());
            }
            found
        })).map(|node| word_counts.get(&node.id).copied().unwrap_or(0)).sum()
    }).unwrap_or(0);
    Ok(Stats {
        total_words, current_volume_words, current_chapter_words, today_words, yesterday_words, week_words, month_words,
        chapter_count, target_words: metadata.target_words, writing_streak: streak, average_daily_words, longest_writing_streak: longest_streak, daily, chapter_stats,
    })
}

