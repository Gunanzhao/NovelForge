use super::*;

#[derive(Debug, Clone, Default)]
pub struct MirrorMetadata {
    pub id: Option<String>,
    pub kind: Option<String>,
    pub parent_id: Option<String>,
    pub title: Option<String>,
    pub status: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

fn clean_metadata_value(value: &str) -> String {
    value
        .replace('\r', " ")
        .replace('\n', " ")
        .trim()
        .to_string()
}

fn parse_metadata_line(line: &str, metadata: &mut MirrorMetadata) -> bool {
    let Some((key, value)) = line.split_once(':') else {
        return false;
    };
    let key = key.trim();
    let value = value.trim().trim_matches('"').trim_matches('\'');
    let value = (!value.is_empty() && value != "null").then(|| value.to_string());
    match key {
        "novelforgeId" => metadata.id = value,
        "novelforgeKind" => metadata.kind = value,
        "novelforgeParentId" | "parentId" => metadata.parent_id = value,
        "novelforgeTitle" | "title" => metadata.title = value,
        "novelforgeStatus" | "status" => metadata.status = value,
        "novelforgeCreatedAt" | "createdAt" => metadata.created_at = value,
        "novelforgeUpdatedAt" | "updatedAt" => metadata.updated_at = value,
        _ => return false,
    }
    true
}

/// Parse NovelForge metadata while leaving ordinary user-authored
/// frontmatter untouched when no NovelForge key is present.
pub fn parse_markdown_mirror(raw: &str) -> (Option<MirrorMetadata>, String) {
    let mut lines = raw.split_inclusive('\n');
    let Some(first) = lines.next() else {
        return (None, raw.to_string());
    };
    let first_line = first
        .trim_end_matches(|character| character == '\r' || character == '\n')
        .trim_start_matches('\u{feff}')
        .trim();
    if first_line != "---" {
        return (None, raw.to_string());
    }
    let mut metadata = MirrorMetadata::default();
    let mut recognized = false;
    let mut body_start = first.len();
    let mut closed = false;
    for line in lines {
        body_start += line.len();
        let trimmed = line
            .trim_end_matches(|character| character == '\r' || character == '\n')
            .trim();
        if trimmed == "---" {
            closed = true;
            break;
        }
        recognized |= parse_metadata_line(trimmed, &mut metadata);
    }
    if !closed || !recognized {
        return (None, raw.to_string());
    }
    (Some(metadata), raw[body_start..].to_string())
}

pub fn strip_markdown_frontmatter(raw: &str) -> String {
    parse_markdown_mirror(raw).1
}

fn metadata_block(fields: &[(&str, Option<&str>)]) -> String {
    let mut output = String::from("---\n");
    for (key, value) in fields {
        if let Some(value) = value.filter(|value| !value.trim().is_empty()) {
            output.push_str(key);
            output.push_str(": ");
            output.push_str(&clean_metadata_value(value));
            output.push('\n');
        }
    }
    output.push_str("---\n");
    output
}

pub fn markdown_node(
    id: &str,
    kind: &str,
    parent_id: Option<&str>,
    status: &str,
    created_at: &str,
    updated_at: &str,
    content: &str,
) -> String {
    let mut output = metadata_block(&[
        ("novelforgeId", Some(id)),
        ("novelforgeKind", Some(kind)),
        ("novelforgeParentId", parent_id),
        ("novelforgeStatus", Some(status)),
        ("novelforgeCreatedAt", Some(created_at)),
        ("novelforgeUpdatedAt", Some(updated_at)),
    ]);
    output.push_str(&strip_markdown_frontmatter(content));
    output
}

pub fn markdown_volume(id: &str, title: &str, status: &str, created_at: &str, updated_at: &str) -> String {
    let mut output = metadata_block(&[
        ("novelforgeId", Some(id)),
        ("novelforgeKind", Some("volume")),
        ("novelforgeTitle", Some(title)),
        ("novelforgeStatus", Some(status)),
        ("novelforgeCreatedAt", Some(created_at)),
        ("novelforgeUpdatedAt", Some(updated_at)),
    ]);
    output.push_str("# ");
    output.push_str(&clean_metadata_value(title));
    output.push('\n');
    output
}

pub fn markdown_entity_with_metadata(
    id: &str,
    kind: &str,
    created_at: &str,
    updated_at: &str,
    title: &str,
    content: &Value,
    tags: &[String],
) -> String {
    let mut output = metadata_block(&[
        ("novelforgeId", Some(id)),
        ("novelforgeKind", Some(kind)),
        ("novelforgeCreatedAt", Some(created_at)),
        ("novelforgeUpdatedAt", Some(updated_at)),
    ]);
    output.push_str(&markdown_entity(title, content, tags));
    output
}

pub fn kind_directory(kind: &str) -> Result<&'static str, String> {
    match kind {
        "character" => Ok("characters"), "location" => Ok("locations"), "world" => Ok("world"),
        "timeline" => Ok("timeline"), "foreshadowing" => Ok("foreshadowing"), "relationship" => Ok("relationships"), "attachment" => Ok("attachments"),
        "outline" => Ok("outlines"), "scene" => Ok("scenes"), "note" => Ok("notes"),
        "mention-ignore" => Ok("mentions"),
        "story-arc" => Ok("story-arcs"),
        "prompt-preset" => Ok("prompts"),
        _ => Err(format!("不支持的资料类型：{}", kind)),
    }
}

pub fn markdown_entity(title: &str, content: &Value, tags: &[String]) -> String {
    let mut output = format!("# {}\n\n", title);
    if !tags.is_empty() {
        output.push_str(&format!("标签：{}\n\n", tags.join("、")));
    }
    if let Some(object) = content.as_object() {
        for (key, value) in object {
            if key == "description" || key == "notes" || key == "summary" {
                continue;
            }
            let display = match value { Value::String(text) => text.clone(), _ => value.to_string() };
            if !display.is_empty() {
                output.push_str(&format!("## {}\n\n{}\n\n", key, display));
            }
        }
        for key in ["description", "summary", "notes"] {
            if let Some(Value::String(text)) = object.get(key) {
                if !text.trim().is_empty() {
                    output.push_str(&format!("{}\n\n", text));
                }
            }
        }
    } else if !content.is_null() {
        output.push_str(&format!("{}\n", content));
    }
    output
}

