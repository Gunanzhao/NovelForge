use super::*;
use serde::Serialize;
use std::io::Read;

const MAX_CHAPTERS: usize = 2_000;
const MAX_CHAPTER_BYTES: usize = 2 * 1024 * 1024;
const MAX_ROUND_BYTES: usize = 64 * 1024 * 1024;
const SOURCE_CHANGED: &str = "REVISION_CONFLICT:正文已变化，旧改稿仍保留。请重新对比。";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RevisionRound {
    id: String,
    title: String,
    selected_node_id: String,
    chapter_count: i64,
    confirmed_count: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChapterSummary {
    node_id: String,
    title: String,
    has_candidate: bool,
    confirmed_at: Option<String>,
    available: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RevisionChapter {
    node_id: String,
    original: String,
    candidate: Option<String>,
    version: i64,
    confirmed_at: Option<String>,
    current_content: Option<String>,
    source_issue: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RevisionRoundView {
    round: RevisionRound,
    chapters: Vec<ChapterSummary>,
    current: RevisionChapter,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateRevisionRound {
    project_path: String,
    title: String,
    node_ids: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenRevisionRound {
    project_path: String,
    round_id: String,
    node_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RevisionTarget {
    project_path: String,
    round_id: String,
    node_id: String,
    expected_version: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfirmedRevision {
    confirmed_at: String,
    version: i64,
    document: Option<DocumentData>,
}

struct ChapterSource {
    node: NodeRecord,
    raw: String,
    body: String,
}

fn chapter_source(root: &Path, db: &Connection, node_id: &str) -> Result<ChapterSource, String> {
    let node = storage::node_from_id(db, node_id)?
        .filter(|node| node.kind == "chapter" && node.deleted_at.is_none())
        .ok_or("章节已移除或不再可用。")?;
    let path = storage::safe_relative(root, &node.file_path)?;
    let read_error = |error| format!("无法读取「{}」的正文：{error}", node.title);
    let mut raw = String::new();
    fs::File::open(path)
        .map_err(read_error)?
        // Allow room for the project's Markdown metadata header.
        .take((MAX_CHAPTER_BYTES + 8193) as u64)
        .read_to_string(&mut raw)
        .map_err(read_error)?;
    let body = storage::strip_markdown_frontmatter(&raw);
    if body.len() > MAX_CHAPTER_BYTES || raw.len() > MAX_CHAPTER_BYTES + 8192 {
        return Err(format!("「{}」的正文超过 2 MiB，无法审阅。", node.title));
    }
    Ok(ChapterSource { node, raw, body })
}

fn rounds(db: &Connection) -> Result<Vec<RevisionRound>, String> {
    let mut query = db
        .prepare(
            "SELECT r.id,r.title,r.selected_node_id,COUNT(c.node_id),COUNT(c.confirmed_at)
         FROM revision_rounds r JOIN revision_round_chapters c ON r.id=c.round_id
         GROUP BY r.id ORDER BY r.opened_at DESC,r.rowid DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = query
        .query_map([], |row| {
            Ok(RevisionRound {
                id: row.get(0)?,
                title: row.get(1)?,
                selected_node_id: row.get(2)?,
                chapter_count: row.get(3)?,
                confirmed_count: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<_, _>>().map_err(|e| e.to_string())
}

fn stored_chapter(
    db: &Connection,
    round_id: &str,
    node_id: &str,
) -> Result<RevisionChapter, String> {
    db.query_row(
        "SELECT original,candidate,version,confirmed_at
         FROM revision_round_chapters WHERE round_id=?1 AND node_id=?2",
        params![round_id, node_id],
        |row| {
            Ok(RevisionChapter {
                node_id: node_id.into(),
                original: row.get(0)?,
                candidate: row.get(1)?,
                version: row.get(2)?,
                confirmed_at: row.get(3)?,
                current_content: None,
                source_issue: None,
            })
        },
    )
    .optional()
    .map_err(|e| e.to_string())?
    .ok_or("该章节不在本轮修订中。".into())
}

fn chapter_view(root: &Path, db: &Connection, mut chapter: RevisionChapter) -> RevisionChapter {
    match chapter_source(root, db, &chapter.node_id) {
        Ok(source) => {
            if source.body != chapter.original {
                chapter.current_content = Some(source.body);
            }
            chapter.source_issue = manuscript::ensure_body_unlocked(db, &chapter.node_id).err();
        }
        Err(error) => chapter.source_issue = Some(error),
    }
    chapter
}

fn open_round(
    root: &Path,
    db: &Connection,
    round_id: &str,
    node_id: Option<&str>,
) -> Result<RevisionRoundView, String> {
    let mut round = rounds(db)?
        .into_iter()
        .find(|round| round.id == round_id)
        .ok_or("修订轮次不存在。")?;
    let current = stored_chapter(db, round_id, node_id.unwrap_or(&round.selected_node_id))?;
    let mut query = db.prepare(
        "SELECT c.node_id,COALESCE(n.title,c.title),c.candidate IS NOT NULL,c.confirmed_at,n.id IS NOT NULL
         FROM revision_round_chapters c LEFT JOIN nodes n
           ON n.id=c.node_id AND n.kind='chapter' AND n.deleted_at IS NULL
         WHERE c.round_id=?1 ORDER BY c.ordinal",
    ).map_err(|e| e.to_string())?;
    let chapters = query
        .query_map([round_id], |row| {
            Ok(ChapterSummary {
                node_id: row.get(0)?,
                title: row.get(1)?,
                has_candidate: row.get(2)?,
                confirmed_at: row.get(3)?,
                available: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    db.execute(
        "UPDATE revision_rounds SET selected_node_id=?2,opened_at=?3 WHERE id=?1",
        params![round_id, current.node_id, storage::now()],
    )
    .map_err(|e| e.to_string())?;
    round.selected_node_id.clone_from(&current.node_id);
    Ok(RevisionRoundView {
        round,
        chapters,
        current: chapter_view(root, db, current),
    })
}

#[tauri::command]
pub fn list_revision_rounds(path: String) -> Result<Vec<RevisionRound>, String> {
    let (_, db) = project_connection(&path)?;
    rounds(&db)
}

#[tauri::command]
pub async fn create_revision_round(
    input: CreateRevisionRound,
) -> Result<RevisionRoundView, String> {
    tauri::async_runtime::spawn_blocking(move || create_round(input))
        .await
        .map_err(|e| e.to_string())?
}

fn create_round(input: CreateRevisionRound) -> Result<RevisionRoundView, String> {
    let title = input.title.trim();
    if title.is_empty() || title.encode_utf16().count() > 100 {
        return Err("修订名称须为 1 至 100 个字符。".into());
    }
    if input.node_ids.is_empty() || input.node_ids.len() > MAX_CHAPTERS {
        return Err("请选择 1 至 2000 个章节。".into());
    }
    let unique: HashSet<_> = input.node_ids.iter().collect();
    if unique.len() != input.node_ids.len() {
        return Err("修订范围内有重复章节。".into());
    }
    let _serial = guard::SAVES.lock().map_err(|_| "正文保存锁不可用")?;
    let (root, mut db) = project_connection(&input.project_path)?;
    let tx = db
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    let round_id = storage::new_id();
    tx.execute(
        "INSERT INTO revision_rounds(id,title,opened_at,selected_node_id) VALUES (?1,?2,?3,?4)",
        params![round_id, title, storage::now(), input.node_ids[0]],
    )
    .map_err(|e| e.to_string())?;
    let mut total = 0;
    for (ordinal, node_id) in input.node_ids.iter().enumerate() {
        let source = chapter_source(&root, &tx, node_id)?;
        total += source.body.len();
        if total > MAX_ROUND_BYTES {
            return Err("本轮原文超过 64 MiB，请缩小章节范围。".into());
        }
        tx.execute(
            "INSERT INTO revision_round_chapters(round_id,node_id,ordinal,title,original) VALUES (?1,?2,?3,?4,?5)",
            params![round_id, node_id, ordinal, source.node.title, source.body],
        ).map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    open_round(&root, &db, &round_id, None)
}

#[tauri::command]
pub fn open_revision_round(input: OpenRevisionRound) -> Result<RevisionRoundView, String> {
    let (root, db) = project_connection(&input.project_path)?;
    open_round(&root, &db, &input.round_id, input.node_id.as_deref())
}

fn editable_chapter(db: &Connection, input: &RevisionTarget) -> Result<RevisionChapter, String> {
    let chapter = stored_chapter(db, &input.round_id, &input.node_id)?;
    if chapter.version != input.expected_version || chapter.confirmed_at.is_some() {
        return Err("REVISION_CHANGED:改稿已更新或已确认，请重新打开该章。".into());
    }
    Ok(chapter)
}

#[tauri::command]
pub fn save_revision_candidate(
    input: RevisionTarget,
    candidate: String,
) -> Result<RevisionChapter, String> {
    if candidate.len() > MAX_CHAPTER_BYTES {
        return Err("单章改稿不能超过 2 MiB。".into());
    }
    if candidate
        .chars()
        .any(|c| c < ' ' && !matches!(c, '\t' | '\n' | '\r'))
    {
        return Err("改稿包含无法保存的控制字符。".into());
    }
    if storage::strip_markdown_frontmatter(&candidate) != candidate {
        return Err("请移除改稿开头的 NovelForge 文件头，只保留正文。".into());
    }
    let _serial = guard::SAVES.lock().map_err(|_| "正文保存锁不可用")?;
    let (root, db) = project_connection(&input.project_path)?;
    let mut chapter = editable_chapter(&db, &input)?;
    let candidate = (!candidate.trim().is_empty()).then_some(candidate);
    db.execute(
        "UPDATE revision_round_chapters SET candidate=?3,version=version+1 WHERE round_id=?1 AND node_id=?2",
        params![input.round_id,input.node_id,candidate],
    ).map_err(|e| e.to_string())?;
    chapter.candidate = candidate;
    chapter.version += 1;
    Ok(chapter_view(&root, &db, chapter))
}

#[tauri::command]
pub fn rebase_revision_chapter(
    input: RevisionTarget,
    seen_content: String,
) -> Result<RevisionChapter, String> {
    let _serial = guard::SAVES.lock().map_err(|_| "正文保存锁不可用")?;
    let (root, db) = project_connection(&input.project_path)?;
    let mut chapter = editable_chapter(&db, &input)?;
    let source = chapter_source(&root, &db, &input.node_id)?;
    if source.body != seen_content {
        return Err(SOURCE_CHANGED.into());
    }
    db.execute(
        "UPDATE revision_round_chapters SET original=?3,version=version+1 WHERE round_id=?1 AND node_id=?2",
        params![input.round_id,input.node_id,source.body],
    ).map_err(|e| e.to_string())?;
    chapter.original = source.body;
    chapter.version += 1;
    Ok(chapter_view(&root, &db, chapter))
}

fn checked_source(
    root: &Path,
    db: &Connection,
    chapter: &RevisionChapter,
) -> Result<ChapterSource, String> {
    let source = chapter_source(root, db, &chapter.node_id)?;
    manuscript::ensure_body_unlocked(db, &chapter.node_id)?;
    if source.body != chapter.original {
        return Err(SOURCE_CHANGED.into());
    }
    Ok(source)
}

#[tauri::command]
pub fn confirm_revision_chapter(input: RevisionTarget) -> Result<ConfirmedRevision, String> {
    let _serial = guard::SAVES.lock().map_err(|_| "正文保存锁不可用")?;
    let (root, mut db) = project_connection(&input.project_path)?;
    let chapter = editable_chapter(&db, &input)?;
    let candidate = chapter.candidate.as_deref().ok_or("请先保存本章改稿。")?;
    let source = checked_source(&root, &db, &chapter)?;
    let has_changes = candidate != source.body;
    if has_changes {
        manuscript::create_content_snapshot(
            &root,
            &db,
            &input.node_id,
            &source.body,
            "操作保护：整卷修订前",
        )?;
    }
    let tx = db
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    let ChapterSource {
        mut node,
        raw,
        body,
    } = checked_source(&root, &tx, &chapter)?;
    let now = storage::now();
    tx.execute(
        "UPDATE revision_round_chapters SET confirmed_at=?3,version=version+1 WHERE round_id=?1 AND node_id=?2",
        params![input.round_id,input.node_id,now],
    ).map_err(|e| e.to_string())?;
    if !has_changes {
        tx.commit().map_err(|e| e.to_string())?;
        return Ok(ConfirmedRevision {
            confirmed_at: now,
            version: chapter.version + 1,
            document: None,
        });
    }
    let tracking = storage::database::read_annotation_tracking(&tx, &input.node_id)?;
    manuscript::record_document_change(&tx, &node, &body, candidate, &now, None)?;
    let after = storage::markdown_node(
        &node.id,
        &node.kind,
        node.parent_id.as_deref(),
        &node.status,
        &node.created_at,
        &now,
        candidate,
    );
    let path = storage::safe_relative(&root, &node.file_path)?;
    let journal = storage::batch::Journal {
        id: storage::new_id(),
        files: vec![storage::batch::FileChange {
            path: node.file_path.clone(),
            before: Some(raw),
            after,
        }],
    };
    let journal_path = storage::batch::journal_path(&root, &journal.id)?;
    tx.execute(
        "INSERT INTO batch_operations(id,target_id,label,created_at,changes_json) VALUES(?1,?2,'整卷修订',?3,?4)",
        params![journal.id, input.node_id, now, input.round_id],
    ).map_err(|e| e.to_string())?;
    storage::batch::prepare(&root, &journal)?;
    let change = &journal.files[0];
    if let Err(error) = storage::filesystem::atomic_write_checked(
        &path,
        change.after.as_bytes(),
        change.before.as_ref().unwrap().as_bytes(),
    ) {
        // No replacement took place. Remove our journal without restoring an old file.
        storage::remove_file_if_exists(&journal_path)?;
        return Err(error);
    }
    if let Err(error) = tx.commit() {
        // A failing commit must not leave a partially applied chapter visible
        // until the next time the project is opened.
        return Err(match storage::batch::recover(&root, &mut db) {
            Ok(()) => format!("应用事务失败，已检查恢复记录。请刷新本章：{error}"),
            Err(recovery) => format!("应用事务失败，已保留恢复日志：{error}；{recovery}"),
        });
    }
    let _ = storage::remove_file_if_exists(&journal_path);
    touch_project_best_effort(&root, "project_metadata_touch_failed");
    let _ = storage::append_log(&root, "INFO", "revision_chapter_confirmed");
    node.updated_at.clone_from(&now);
    Ok(ConfirmedRevision {
        confirmed_at: now,
        version: chapter.version + 1,
        document: Some(DocumentData {
            node,
            content: candidate.into(),
            annotation_tracking: tracking,
            history_created: true,
        }),
    })
}
