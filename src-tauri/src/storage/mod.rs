use crate::models::{EntityRecord, HistoryItem, NodeRecord, ProjectMetadata, RecoveryItem, TrashItem};
use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use uuid::Uuid;

pub(crate) mod database;
pub(crate) mod filesystem;
pub(crate) mod history;
pub(crate) mod logging;
pub(crate) mod migration;
pub(crate) mod mirror;
pub(crate) mod search_index;

pub const PROJECT_FILE: &str = "project.json";
pub(crate) use database::{all_entities, all_nodes, entity_from_id, open_db, node_from_id, trash_items};
pub(crate) use filesystem::{atomic_write, create_project_directories, existing_project_root, move_to_trash, new_project_root, read_project_json, remove_file_if_exists, safe_existing_path, safe_relative, safe_trash_path, touch_project, write_project_json};
pub(crate) use history::{copy_history, history_items, parse_timestamp, recovery_items, write_recovery};
pub(crate) use logging::{append_log, read_logs};
pub(crate) use migration::quarantine_database;
pub(crate) use mirror::{kind_directory, markdown_entity, markdown_entity_with_metadata, markdown_node, markdown_volume, parse_markdown_mirror, strip_markdown_frontmatter, MirrorMetadata};
pub(crate) use search_index::{index_record, refresh_search_index};

pub fn now() -> String {
    Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

pub fn new_id() -> String {
    Uuid::new_v4().to_string()
}

pub fn word_count(content: &str) -> u64 {
    content.chars().filter(|character| !character.is_whitespace()).count() as u64
}
