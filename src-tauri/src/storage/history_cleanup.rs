//! Explicit automatic-history cleanup. Database commits precede file deletion.
//! A separate durable journal resumes deletion after crashes; unrelated batch
//! commit markers, protected/named history, activity and recovery copies are untouched.
use super::*;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    pub id: String,
    pub kind: String,
    pub label: String,
    pub bytes: u64,
    pub path: Option<String>,
    pub digest: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    pub body_bytes: u64,
    pub entity_bytes: u64,
    pub batch_bytes: u64,
    pub protected_count: usize,
    pub candidates: Vec<Candidate>,
    pub fingerprint: String,
}
#[derive(Serialize, Deserialize)]
struct CleanupJournal {
    id: String,
    candidates: Vec<Candidate>,
}
fn fingerprint(value: &[Candidate]) -> Result<String, String> {
    Ok(format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(value).map_err(|e| e.to_string())?)
    ))
}
pub fn preview(root: &Path, db: &Connection) -> Result<Preview, String> {
    let mut result = Preview {
        body_bytes: 0,
        entity_bytes: 0,
        batch_bytes: 0,
        protected_count: 0,
        candidates: Vec::new(),
        fingerprint: String::new(),
    };
    let mut statement=db.prepare("SELECT id,reason,file_path, rowid=(SELECT MAX(r2.rowid) FROM revisions r2 WHERE r2.node_id=r.node_id) FROM revisions r ORDER BY rowid").map_err(|e|e.to_string())?;
    for row in statement
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, bool>(3)?,
            ))
        })
        .map_err(|e| e.to_string())?
    {
        let (id, label, path, latest) = row.map_err(|e| e.to_string())?;
        let bytes = fs::read(safe_relative(root, &path)?)
            .map_err(|_| "HISTORY_MISSING:历史文件缺失，不能预览清理或忽略损坏引用")?;
        result.body_bytes += bytes.len() as u64;
        if label == "自动保存" && !latest && result.candidates.len() < 1000 {
            if !path.starts_with(".novelforge/history/") {
                return Err("HISTORY_PATH:历史路径异常，拒绝清理".into());
            }
            result.candidates.push(Candidate {
                id,
                kind: "body".into(),
                label,
                bytes: bytes.len() as u64,
                path: Some(path),
                digest: Some(format!("{:x}", Sha256::digest(bytes))),
            });
        } else {
            result.protected_count += 1;
        }
    }
    let mut statement=db.prepare("SELECT id,label,length(CAST(state_json AS BLOB)),rowid=(SELECT MAX(e2.rowid) FROM entity_revisions e2 WHERE e2.entity_id=e.entity_id) FROM entity_revisions e ORDER BY rowid").map_err(|e|e.to_string())?;
    for row in statement
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, u64>(2)?,
                r.get::<_, bool>(3)?,
            ))
        })
        .map_err(|e| e.to_string())?
    {
        let (id, label, bytes, latest) = row.map_err(|e| e.to_string())?;
        result.entity_bytes += bytes;
        if matches!(label.as_str(), "资料保存" | "修改前")
            && !latest
            && result.candidates.len() < 1000
        {
            result.candidates.push(Candidate {
                id,
                kind: "entity".into(),
                label,
                bytes,
                path: None,
                digest: None,
            });
        } else {
            result.protected_count += 1;
        }
    }
    result.batch_bytes = db
        .query_row(
            "SELECT COALESCE(SUM(length(CAST(changes_json AS BLOB))),0) FROM batch_operations",
            [],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    result.fingerprint = fingerprint(&result.candidates)?;
    Ok(result)
}
fn prepare(root: &Path, tx: &Connection, expected: &str) -> Result<CleanupJournal, String> {
    let current = preview(root, tx)?;
    if current.fingerprint != expected {
        return Err("HISTORY_CHANGED:历史已变化，请重新预览".into());
    }
    if current.candidates.is_empty() {
        return Err("HISTORY_EMPTY:没有可清理的自动历史".into());
    }
    let journal = CleanupJournal {
        id: new_id(),
        candidates: current.candidates,
    };
    let directory = safe_relative(root, ".novelforge/history-cleanup")?;
    fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    atomic_write(
        &directory.join(format!("{}.json", journal.id)),
        &serde_json::to_vec(&journal).map_err(|e| e.to_string())?,
    )?;
    for item in &journal.candidates {
        let table = if item.kind == "body" {
            "revisions"
        } else {
            "entity_revisions"
        };
        tx.execute(&format!("DELETE FROM {table} WHERE id=?1"), [&item.id])
            .map_err(|e| e.to_string())?;
    }
    tx.execute(
        "INSERT INTO batch_operations VALUES(?1,'history-cleanup','history-cleanup',?2,'[]',NULL)",
        params![journal.id, now()],
    )
    .map_err(|e| e.to_string())?;
    Ok(journal)
}
pub fn apply(root: &Path, db: &mut Connection, expected: &str) -> Result<Preview, String> {
    let tx = db
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    prepare(root, &tx, expected)?;
    tx.commit().map_err(|e| e.to_string())?;
    recover(root, db)?;
    preview(root, db)
}
pub fn recover(root: &Path, db: &mut Connection) -> Result<(), String> {
    let directory = safe_relative(root, ".novelforge/history-cleanup")?;
    if !directory.exists() {
        return Ok(());
    }
    let tx = db
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    for entry in fs::read_dir(&directory).map_err(|e| e.to_string())? {
        let path = entry.map_err(|e| e.to_string())?.path();
        ensure_within_root(root, &path)?;
        if path.extension().and_then(|v| v.to_str()) != Some("json") {
            continue;
        }
        let journal: CleanupJournal =
            serde_json::from_slice(&fs::read(&path).map_err(|e| e.to_string())?)
                .map_err(|_| "HISTORY_JOURNAL:清理日志损坏，保留证据")?;
        Uuid::parse_str(&journal.id).map_err(|_| "HISTORY_JOURNAL:清理标识无效")?;
        if path != directory.join(format!("{}.json", journal.id)) {
            return Err("HISTORY_JOURNAL:清理标识不匹配".into());
        }
        let committed:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM batch_operations WHERE id=?1 AND target_id='history-cleanup')",[&journal.id],|r|r.get(0)).map_err(|e|e.to_string())?;
        if committed {
            for item in &journal.candidates {
                if let Some(relative) = &item.path {
                    if !relative.starts_with(".novelforge/history/") {
                        return Err("HISTORY_PATH:拒绝清理历史目录以外文件".into());
                    }
                    let referenced: bool = tx
                        .query_row(
                            "SELECT EXISTS(SELECT 1 FROM revisions WHERE file_path=?1)",
                            [relative],
                            |r| r.get(0),
                        )
                        .map_err(|e| e.to_string())?;
                    if referenced {
                        continue;
                    }
                    let file = safe_relative(root, relative)?;
                    match fs::read(&file) {
                        Ok(bytes) => {
                            if Some(format!("{:x}", Sha256::digest(bytes))) != item.digest {
                                return Err(
                                    "HISTORY_CHANGED:待清理文件被外部修改，已保留文件与清理日志"
                                        .into(),
                                );
                            }
                            fs::remove_file(&file).map_err(|e| e.to_string())?;
                        }
                        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                        Err(e) => return Err(e.to_string()),
                    }
                }
            }
        }
        // Remove journal before its own small commit marker; never other markers.
        fs::remove_file(&path).map_err(|e| e.to_string())?;
        if committed {
            tx.execute(
                "DELETE FROM batch_operations WHERE id=?1 AND target_id='history-cleanup'",
                [&journal.id],
            )
            .map_err(|e| e.to_string())?;
        }
    }
    tx.commit().map_err(|e| e.to_string())
}
#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> (PathBuf, Connection) {
        let root = std::env::temp_dir().join(format!("nf-cleanup-{}", new_id()));
        fs::create_dir_all(&root).unwrap();
        let db = open_db(&root).unwrap();
        for (id, reason) in [
            ("old", "自动保存"),
            ("named", "命名版本：保留"),
            ("protected", "操作前保护：保留"),
            ("latest", "自动保存"),
        ] {
            let path = copy_history(&root, "node", id, id).unwrap();
            db.execute(
                "INSERT INTO revisions VALUES(?1,'node','node',?2,1,'time',?3)",
                params![id, reason, path],
            )
            .unwrap();
        }
        for (id, label) in [
            ("entity-old", "资料保存"),
            ("entity-named", "命名版本：保留"),
            ("entity-latest", "资料保存"),
        ] {
            db.execute(
                "INSERT INTO entity_revisions VALUES(?1,'entity','character',?2,'time','{}')",
                params![id, label],
            )
            .unwrap();
        }
        db.execute(
            "INSERT INTO activity VALUES('activity','node','time',1,1)",
            [],
        )
        .unwrap();
        db.execute("INSERT INTO batch_operations VALUES('unrelated','node','keep','time','large undo payload',NULL)",[]).unwrap();
        write_recovery(&root, "node", "rescue").unwrap();
        (root, db)
    }
    #[test]
    fn cleanup_protects_named_latest_activity_recovery_and_other_batch_markers() {
        let (root, mut db) = fixture();
        let before = preview(&root, &db).unwrap();
        assert_eq!(before.candidates.len(), 2);
        apply(&root, &mut db, &before.fingerprint).unwrap();
        assert_eq!(history_items(&db, "node").unwrap().len(), 3);
        assert_eq!(recovery_items(&root, &db).unwrap().len(), 1);
        assert_eq!(
            db.query_row(
                "SELECT COUNT(*) FROM batch_operations WHERE id='unrelated'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            1
        );
        assert_eq!(
            db.query_row("SELECT COUNT(*) FROM activity", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            1
        );
        assert!(!root.join(".novelforge/history/node/old.md").exists());
        drop(db);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn interrupted_cleanup_recovers_before_and_after_commit_and_refuses_external_edits() {
        for mode in ["rollback", "commit", "external"] {
            let (root, mut db) = fixture();
            let plan = preview(&root, &db).unwrap();
            let tx = db
                .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
                .unwrap();
            prepare(&root, &tx, &plan.fingerprint).unwrap();
            if mode == "rollback" {
                drop(tx);
            } else {
                tx.commit().unwrap();
            }
            drop(db);
            if mode == "external" {
                fs::write(root.join(".novelforge/history/node/old.md"), "external").unwrap();
                assert!(open_db(&root).is_err());
                assert_eq!(
                    fs::read_to_string(root.join(".novelforge/history/node/old.md")).unwrap(),
                    "external"
                );
            } else {
                let db = open_db(&root).unwrap();
                assert_eq!(
                    history_items(&db, "node").unwrap().len(),
                    if mode == "rollback" { 4 } else { 3 }
                );
                drop(db);
            }
            fs::remove_dir_all(root).unwrap();
        }
    }
    #[test]
    fn missing_history_is_not_hidden_by_cleanup() {
        let (root, mut db) = fixture();
        let plan = preview(&root, &db).unwrap();
        fs::remove_file(root.join(".novelforge/history/node/named.md")).unwrap();
        assert!(apply(&root, &mut db, &plan.fingerprint).is_err());
        drop(db);
        fs::remove_dir_all(root).unwrap();
    }
}
