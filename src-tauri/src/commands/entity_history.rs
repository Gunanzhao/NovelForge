use super::*;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EntityState {
    pub title: String,
    pub content: Value,
    pub tags: Vec<String>,
}
impl From<&EntityRecord> for EntityState {
    fn from(entity: &EntityRecord) -> Self {
        Self {
            title: entity.title.clone(),
            content: entity.content.clone(),
            tags: entity.tags.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntityVersion {
    pub id: String,
    pub entity_id: String,
    pub kind: String,
    pub label: String,
    pub created_at: String,
    pub state: EntityState,
}

pub(crate) fn record(
    db: &Connection,
    entity_id: &str,
    kind: &str,
    label: &str,
    state: &EntityState,
    named: bool,
) -> Result<(), String> {
    if !named {
        let last: Option<String> = db.query_row("SELECT state_json FROM entity_revisions WHERE entity_id=?1 ORDER BY rowid DESC LIMIT 1", [entity_id], |row| row.get(0)).optional().map_err(|e| e.to_string())?;
        if let Some(last) = last {
            let previous: EntityState =
                serde_json::from_str(&last).map_err(|e| format!("资料历史损坏：{e}"))?;
            if previous == *state {
                return Ok(());
            }
        }
    }
    db.execute("INSERT INTO entity_revisions(id,entity_id,kind,label,created_at,state_json) VALUES(?1,?2,?3,?4,?5,?6)", params![storage::new_id(),entity_id,kind,label,storage::now(),serde_json::to_string(state).map_err(|e| e.to_string())?]).map_err(|e| format!("保存资料历史失败：{e}"))?;
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListEntityHistoryInput {
    pub project_path: String,
    pub entity_id: String,
    pub before_id: Option<String>,
}

#[tauri::command]
pub fn list_entity_history(input: ListEntityHistoryInput) -> Result<Vec<EntityVersion>, String> {
    let (_, db) = project_connection(&input.project_path)?;
    let before = match input.before_id {
        Some(id) => db
            .query_row(
                "SELECT rowid FROM entity_revisions WHERE id=?1 AND entity_id=?2",
                params![id, input.entity_id],
                |row| row.get::<_, i64>(0),
            )
            .optional()
            .map_err(|e| e.to_string())?
            .ok_or("资料历史分页位置无效")?,
        None => i64::MAX,
    };
    let mut statement = db.prepare("SELECT id,kind,label,created_at,state_json FROM entity_revisions WHERE entity_id=?1 AND rowid<?2 ORDER BY rowid DESC LIMIT 50").map_err(|e|e.to_string())?;
    let rows = statement
        .query_map(params![input.entity_id, before], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    rows.map(|row| {
        let (id, kind, label, created_at, json) = row.map_err(|e| e.to_string())?;
        Ok(EntityVersion {
            id,
            entity_id: input.entity_id.clone(),
            kind,
            label,
            created_at,
            state: serde_json::from_str(&json).map_err(|e| format!("资料历史损坏：{e}"))?,
        })
    })
    .collect()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NameEntityVersionInput {
    pub project_path: String,
    pub entity_id: String,
    pub name: String,
    pub expected: EntityState,
}

#[tauri::command]
pub fn name_entity_version(input: NameEntityVersionInput) -> Result<(), String> {
    let name = input.name.trim();
    if name.is_empty() || name.chars().count() > 120 {
        return Err("版本名称需为1至120个字符".into());
    }
    let (_, mut db) = project_connection(&input.project_path)?;
    let tx = db
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    let entity = storage::entity_from_id(&tx, &input.entity_id)?
        .filter(|e| e.deleted_at.is_none())
        .ok_or("资料不存在或已删除")?;
    if EntityState::from(&entity) != input.expected {
        return Err("资料已变化，请刷新后再命名版本".into());
    }
    record(
        &tx,
        &entity.id,
        &entity.kind,
        &format!("命名版本：{name}"),
        &input.expected,
        true,
    )?;
    tx.commit().map_err(|e| e.to_string())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreEntityVersionInput {
    pub project_path: String,
    pub entity_id: String,
    pub version_id: String,
    // None restores the full entry. Selected keys are title, tags, content.<key>.
    pub fields: Option<Vec<String>>,
    pub expected: EntityState,
}

#[tauri::command]
pub fn restore_entity_version(input: RestoreEntityVersionInput) -> Result<ProjectData, String> {
    let (_, db) = project_connection(&input.project_path)?;
    let (kind, json): (String, String) = db
        .query_row(
            "SELECT kind,state_json FROM entity_revisions WHERE id=?1 AND entity_id=?2",
            params![input.version_id, input.entity_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .ok_or("找不到当前资料的历史版本")?;
    let snapshot: EntityState =
        serde_json::from_str(&json).map_err(|e| format!("资料历史损坏：{e}"))?;
    let restored = restore_fields(&input.expected, &snapshot, input.fields.as_deref())?;
    drop(db);
    entities::upsert_entity_versioned(
        EntityInput {
            project_path: input.project_path,
            id: Some(input.entity_id),
            kind,
            title: restored.title,
            content: restored.content,
            tags: restored.tags,
        },
        Some(&input.expected),
        "恢复资料版本",
    )
}

fn restore_fields(
    current: &EntityState,
    snapshot: &EntityState,
    fields: Option<&[String]>,
) -> Result<EntityState, String> {
    let Some(fields) = fields else {
        return Ok(snapshot.clone());
    };
    if fields.is_empty() {
        return Err("请选择要恢复的字段".into());
    }
    let mut result = current.clone();
    for field in fields {
        match field.as_str() {
            "title" => result.title = snapshot.title.clone(),
            "tags" => result.tags = snapshot.tags.clone(),
            key if key.starts_with("content.") && key.len() > 8 => {
                let key = &key[8..];
                let target = result
                    .content
                    .as_object_mut()
                    .ok_or("当前资料字段格式无效")?;
                let original = snapshot.content.as_object().ok_or("历史资料字段格式无效")?;
                if let Some(value) = original.get(key) {
                    target.insert(key.into(), value.clone());
                } else {
                    target.remove(key);
                }
            }
            _ => return Err("恢复字段无效".into()),
        }
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Fixture {
        root: PathBuf,
        path: String,
    }
    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir()
                .join(format!("novelforge-entity-history-{}", storage::new_id()));
            fs::create_dir_all(&root).unwrap();
            let path = root.to_string_lossy().into_owned();
            create_project(ProjectInput {
                path: path.clone(),
                title: "资料历史".into(),
                author: "".into(),
                description: "".into(),
                genre: "".into(),
                target_words: 1000,
            })
            .unwrap();
            Self { root, path }
        }
        fn save(&self, id: &str, age: &str) -> EntityRecord {
            upsert_entity(EntityInput {
                project_path: self.path.clone(),
                id: Some(id.into()),
                kind: "character".into(),
                title: "人物".into(),
                content: serde_json::json!({"age":age}),
                tags: vec![],
            })
            .unwrap()
            .entities
            .into_iter()
            .find(|e| e.id == id)
            .unwrap()
        }
        fn list(&self, id: &str) -> Vec<EntityVersion> {
            list_entity_history(ListEntityHistoryInput {
                project_path: self.path.clone(),
                entity_id: id.into(),
                before_id: None,
            })
            .unwrap()
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = guard::release_project(self.path.clone());
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    #[test]
    fn history_records_changes_names_and_selected_field_restore() {
        let f = Fixture::new();
        let first = f.save("person", "19");
        let first_version = f.list("person")[0].id.clone();
        f.save("person", "19");
        assert_eq!(f.list("person").len(), 1);
        let current = f.save("person", "23");
        assert_eq!(f.list("person").len(), 2);
        name_entity_version(NameEntityVersionInput {
            project_path: f.path.clone(),
            entity_id: "person".into(),
            name: "第一卷定稿".into(),
            expected: EntityState::from(&current),
        })
        .unwrap();
        assert!(f.list("person")[0].label.contains("第一卷定稿"));
        let restored = restore_entity_version(RestoreEntityVersionInput {
            project_path: f.path.clone(),
            entity_id: "person".into(),
            version_id: first_version,
            fields: Some(vec!["content.age".into()]),
            expected: EntityState::from(&current),
        })
        .unwrap();
        assert_eq!(
            restored
                .entities
                .iter()
                .find(|e| e.id == "person")
                .unwrap()
                .content,
            first.content
        );
        let versions = f.list("person");
        assert_eq!(versions[0].label, "恢复资料版本");
        assert!(versions.iter().any(|v| v.state.content["age"] == "23"));
    }
    #[test]
    fn restore_rejects_stale_state_and_cross_entity_revision() {
        let f = Fixture::new();
        let old = f.save("person", "19");
        let version = f.list("person")[0].id.clone();
        let current = f.save("person", "23");
        f.save("other", "50");
        for (id, expected) in [
            ("person", EntityState::from(&old)),
            ("other", EntityState::from(&current)),
        ] {
            assert!(restore_entity_version(RestoreEntityVersionInput {
                project_path: f.path.clone(),
                entity_id: id.into(),
                version_id: version.clone(),
                fields: None,
                expected
            })
            .is_err());
        }
        assert_eq!(f.list("person")[0].state.content["age"], "23");
    }
    #[test]
    fn history_failure_rolls_back_database_and_exact_mirror() {
        let f = Fixture::new();
        let current = f.save("person", "19");
        let mirror = f.root.join(&current.file_path);
        let before = fs::read(&mirror).unwrap();
        let (_, db) = project_connection(&f.path).unwrap();
        db.execute_batch("CREATE TRIGGER fail_history BEFORE INSERT ON entity_revisions BEGIN SELECT RAISE(ABORT,'history unavailable'); END;").unwrap();
        drop(db);
        assert!(upsert_entity(EntityInput {
            project_path: f.path.clone(),
            id: Some("person".into()),
            kind: "character".into(),
            title: "changed".into(),
            content: serde_json::json!({"age":"23"}),
            tags: vec![]
        })
        .is_err());
        assert_eq!(fs::read(mirror).unwrap(), before);
        let (_, db) = project_connection(&f.path).unwrap();
        assert_eq!(
            storage::entity_from_id(&db, "person")
                .unwrap()
                .unwrap()
                .title,
            "人物"
        );
        assert_eq!(f.list("person").len(), 1);
    }
    #[test]
    fn same_timestamp_pagination_keeps_insertion_order() {
        let f = Fixture::new();
        let current = f.save("person", "19");
        let (_, mut db) = project_connection(&f.path).unwrap();
        let tx = db.transaction().unwrap();
        for n in 0..55 {
            record(
                &tx,
                "person",
                "character",
                &format!("版本{n}"),
                &EntityState::from(&current),
                true,
            )
            .unwrap();
        }
        tx.execute(
            "UPDATE entity_revisions SET created_at='2026-09-16T00:00:00Z'",
            [],
        )
        .unwrap();
        tx.commit().unwrap();
        drop(db);
        let first = f.list("person");
        assert_eq!(first.len(), 50);
        assert_eq!(first[0].label, "版本54");
        let second = list_entity_history(ListEntityHistoryInput {
            project_path: f.path.clone(),
            entity_id: "person".into(),
            before_id: Some(first[49].id.clone()),
        })
        .unwrap();
        assert_eq!(second.len(), 6);
        assert!(second.iter().all(|s| first.iter().all(|f| f.id != s.id)));
    }
    #[test]
    fn selected_restore_removes_fields_absent_in_snapshot() {
        let current = EntityState {
            title: "新名".into(),
            content: serde_json::json!({"age":"23","new":"added"}),
            tags: vec!["新".into()],
        };
        let old = EntityState {
            title: "旧名".into(),
            content: serde_json::json!({"age":"19"}),
            tags: vec![],
        };
        let restored = restore_fields(
            &current,
            &old,
            Some(&["content.new".into(), "title".into()]),
        )
        .unwrap();
        assert_eq!(restored.title, "旧名");
        assert_eq!(restored.content, serde_json::json!({"age":"23"}));
        assert_eq!(restored.tags, current.tags);
    }
}
