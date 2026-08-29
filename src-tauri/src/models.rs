use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMetadata {
    pub format_version: u32,
    pub id: String,
    pub title: String,
    pub author: String,
    pub description: String,
    pub genre: String,
    pub target_words: u64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeRecord {
    pub id: String,
    pub kind: String,
    pub parent_id: Option<String>,
    pub title: String,
    pub order_index: i64,
    pub status: String,
    pub file_path: String,
    pub created_at: String,
    pub updated_at: String,
    #[serde(skip_serializing)]
    pub deleted_at: Option<String>,
    #[serde(skip_serializing)]
    pub deleted_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntityRecord {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub content: Value,
    pub tags: Vec<String>,
    pub file_path: String,
    pub created_at: String,
    pub updated_at: String,
    #[serde(skip_serializing)]
    pub deleted_at: Option<String>,
    #[serde(skip_serializing)]
    pub deleted_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryItem {
    pub id: String,
    pub node_id: String,
    pub node_title: String,
    pub path: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryItem {
    pub id: String,
    pub node_id: String,
    pub node_title: String,
    pub reason: String,
    pub word_count: u64,
    pub created_at: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashItem {
    pub id: String,
    pub ref_id: String,
    pub ref_kind: String,
    pub title: String,
    pub original_path: String,
    pub trash_path: String,
    pub deleted_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectData {
    pub project: ProjectMetadata,
    pub nodes: Vec<NodeRecord>,
    pub entities: Vec<EntityRecord>,
    pub recovery: Vec<RecoveryItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentData {
    pub node: NodeRecord,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    pub total_words: u64,
    pub today_words: u64,
    pub yesterday_words: u64,
    pub week_words: u64,
    pub month_words: u64,
    pub chapter_count: u64,
    pub target_words: u64,
    pub writing_streak: u64,
    pub daily: Vec<DailyStats>,
    pub chapter_stats: Vec<ChapterStats>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyStats {
    pub date: String,
    pub words: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChapterStats {
    pub id: String,
    pub title: String,
    pub words: u64,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsistencyIssue {
    pub id: String,
    pub severity: String,
    pub code: String,
    pub title: String,
    pub detail: String,
    pub ref_id: String,
    pub ref_kind: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsistencyReport {
    pub checked_at: String,
    pub issue_count: u64,
    pub errors: u64,
    pub warnings: u64,
    pub issues: Vec<ConsistencyIssue>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub path: String,
    pub snippet: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInput {
    pub path: String,
    pub title: String,
    pub author: String,
    pub description: String,
    pub genre: String,
    pub target_words: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeInput {
    pub project_path: String,
    pub kind: String,
    pub title: String,
    pub parent_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameNodeInput {
    pub project_path: String,
    pub node_id: String,
    pub title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeActionInput {
    pub project_path: String,
    pub node_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReorderNodeInput {
    pub project_path: String,
    pub node_id: String,
    pub direction: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveDocumentInput {
    pub project_path: String,
    pub node_id: String,
    pub content: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntityInput {
    pub project_path: String,
    pub kind: String,
    pub id: Option<String>,
    pub title: String,
    pub content: Value,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentInput {
    pub project_path: String,
    pub source_path: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchInput {
    pub project_path: String,
    pub query: String,
    pub kind: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportInput {
    pub project_path: String,
    pub format: String,
}
