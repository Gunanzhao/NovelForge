//! Shared JSON fixtures exercise real serde types, including controlled drift.
use crate::models::{NodeInput, ProjectInput, SaveDocumentInput};
use serde_json::{json, Value};

#[test]
fn reliability_serde_contract_and_drift_controls() {
    let fixture: Value = serde_json::from_str(
        include_str!("../../tests/fixtures/reliability-contract.json")
            .trim_start_matches('\u{feff}'),
    )
    .unwrap();
    let project: ProjectInput = serde_json::from_value(fixture["project"].clone()).unwrap();
    assert_eq!(serde_json::to_value(project).unwrap(), fixture["project"]);
    let mut node = fixture["node"].clone();
    assert!(serde_json::from_value::<NodeInput>(node.clone())
        .unwrap()
        .parent_id
        .is_none());
    node.as_object_mut().unwrap().remove("parentId");
    assert!(serde_json::from_value::<NodeInput>(node.clone())
        .unwrap()
        .parent_id
        .is_none());
    node["parentId"] = json!("父卷");
    assert_eq!(
        serde_json::from_value::<NodeInput>(node)
            .unwrap()
            .parent_id
            .as_deref(),
        Some("父卷")
    );
    let valid = json!({"projectPath":"__TEMP__", "nodeId":"章节", "content":fixture["body"], "reason":"手动保存"});
    let save: SaveDocumentInput = serde_json::from_value(valid.clone()).unwrap();
    assert_eq!(serde_json::to_value(save).unwrap(), valid);
    for field in ["projectPath", "nodeId", "content", "reason"] {
        let mut missing = valid.clone();
        missing.as_object_mut().unwrap().remove(field);
        assert!(
            serde_json::from_value::<SaveDocumentInput>(missing.clone()).is_err(),
            "missing {field}"
        );
        missing[field] = Value::Null;
        assert!(
            serde_json::from_value::<SaveDocumentInput>(missing).is_err(),
            "null {field}"
        );
    }
    let mut renamed = valid.clone();
    let content = renamed.as_object_mut().unwrap().remove("content").unwrap();
    renamed["body"] = content;
    assert!(serde_json::from_value::<SaveDocumentInput>(renamed).is_err());
}
