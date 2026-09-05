use super::*;

fn json_text(value: &serde_json::Value, key: &str) -> String {
    match value.get(key) {
        Some(serde_json::Value::String(text)) => text.clone(),
        Some(serde_json::Value::Number(number)) => number.to_string(),
        Some(serde_json::Value::Bool(flag)) => flag.to_string(),
        _ => String::new(),
    }
}

fn wiki_targets(content: &str) -> Vec<String> {
    let mut targets = Vec::new();
    let mut fenced = false;
    let mut fence_character = 0u8;
    for line in content.lines() {
        let trimmed = line.trim_start();
        let bytes = trimmed.as_bytes();
        let marker = if bytes.starts_with(&[96, 96, 96]) {
            Some(96u8)
        } else if bytes.starts_with(b"~~~") {
            Some(b'~')
        } else {
            None
        };
        if let Some(character) = marker {
            if !fenced {
                fenced = true;
                fence_character = character;
            } else if character == fence_character {
                fenced = false;
                fence_character = 0;
            }
            continue;
        }
        if fenced {
            continue;
        }
        let mut rest = line;
        while let Some(start) = rest.find("[[") {
            let after_start = &rest[start + 2..];
            let Some(end) = after_start.find("]]") else {
                break;
            };
            let target = after_start[..end].trim();
            if !target.is_empty() {
                targets.push(target.to_string());
            }
            rest = &after_start[end + 2..];
        }
    }
    targets
}

fn consistency_normalized_key(value: &str) -> String {
    value
        .chars()
        .filter(|character| !character.is_whitespace() && *character != '_' && *character != '-')
        .collect::<String>()
        .to_lowercase()
}

fn consistency_field_values<'a>(
    entity: &'a crate::models::EntityRecord,
    keys: &[&str],
) -> Vec<&'a serde_json::Value> {
    let expected: std::collections::HashSet<String> = keys
        .iter()
        .map(|key| consistency_normalized_key(key))
        .collect();
    entity
        .content
        .as_object()
        .map(|object| {
            object
                .iter()
                .filter(|(key, _)| expected.contains(&consistency_normalized_key(key)))
                .map(|(_, value)| value)
                .collect()
        })
        .unwrap_or_default()
}

fn consistency_value_text(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::String(text) => text.clone(),
        serde_json::Value::Number(number) => number.to_string(),
        serde_json::Value::Bool(flag) => flag.to_string(),
        serde_json::Value::Array(items) => items
            .iter()
            .map(consistency_value_text)
            .filter(|text| !text.is_empty())
            .collect::<Vec<_>>()
            .join("、"),
        serde_json::Value::Object(object) => object
            .values()
            .map(consistency_value_text)
            .filter(|text| !text.is_empty())
            .collect::<Vec<_>>()
            .join("、"),
        serde_json::Value::Null => String::new(),
    }
}

fn consistency_nested_values<'a>(
    value: &'a serde_json::Value,
    output: &mut Vec<&'a serde_json::Value>,
) {
    match value {
        serde_json::Value::Array(items) => items
            .iter()
            .for_each(|item| consistency_nested_values(item, output)),
        serde_json::Value::Object(object) => object
            .values()
            .for_each(|item| consistency_nested_values(item, output)),
        _ => output.push(value),
    }
}

fn consistency_numeric_values(values: &[&serde_json::Value]) -> Vec<f64> {
    let mut leaves = Vec::new();
    values
        .iter()
        .for_each(|value| consistency_nested_values(value, &mut leaves));
    let mut numbers = Vec::new();
    for value in leaves {
        match value {
            serde_json::Value::Number(number) => {
                if let Some(number) = number.as_f64() {
                    numbers.push(number);
                }
            }
            serde_json::Value::String(text) => {
                let mut token = String::new();
                for character in text.chars() {
                    if character.is_ascii_digit() || character == '-' || character == '.' {
                        token.push(character);
                    } else if !token.is_empty() {
                        if let Ok(number) = token.parse::<f64>() {
                            numbers.push(number);
                        }
                        token.clear();
                    }
                }
                if !token.is_empty() {
                    if let Ok(number) = token.parse::<f64>() {
                        numbers.push(number);
                    }
                }
            }
            _ => {}
        }
    }
    numbers
}

fn consistency_entity_aliases(entity: &crate::models::EntityRecord) -> Vec<String> {
    let mut aliases = vec![entity.id.clone(), entity.title.clone()];
    for value in consistency_field_values(entity, &["alias", "aliases"]) {
        aliases.extend(
            consistency_value_text(value)
                .split(|character: char| ",，、;；/|".contains(character))
                .map(str::trim)
                .filter(|item| !item.is_empty())
                .map(ToString::to_string),
        );
    }
    aliases
        .into_iter()
        .map(|value| value.trim().to_lowercase())
        .filter(|value| !value.is_empty())
        .collect()
}

fn consistency_mentions_entity(
    values: &[&serde_json::Value],
    entity: &crate::models::EntityRecord,
) -> bool {
    let text = values
        .iter()
        .map(|value| consistency_value_text(value))
        .collect::<Vec<_>>()
        .join("、")
        .trim()
        .to_lowercase();
    if text.is_empty() {
        return false;
    }
    consistency_entity_aliases(entity)
        .iter()
        .any(|alias| text == *alias || text.contains(alias))
}

fn consistency_parse_chronology(value: &serde_json::Value) -> Option<i64> {
    let text = consistency_value_text(value).trim().to_string();
    if text.is_empty() {
        return None;
    }
    let mut numbers = Vec::new();
    let mut token = String::new();
    for character in text.chars() {
        if character.is_ascii_digit() {
            token.push(character);
        } else if !token.is_empty() {
            if let Ok(number) = token.parse::<i64>() {
                numbers.push(number);
            }
            token.clear();
        }
    }
    if !token.is_empty() {
        if let Ok(number) = token.parse::<i64>() {
            numbers.push(number);
        }
    }
    if numbers.len() >= 3
        && numbers[0] >= 1000
        && (1..=12).contains(&numbers[1])
        && (1..=31).contains(&numbers[2])
    {
        return Some(numbers[0] * 1_000_000 + numbers[1] * 1_000 + numbers[2]);
    }
    numbers.first().copied()
}

fn consistency_field_date(entity: &crate::models::EntityRecord, keys: &[&str]) -> Option<i64> {
    consistency_field_values(entity, keys)
        .iter()
        .find_map(|value| consistency_parse_chronology(value))
}

fn consistency_timeline_date(entity: &crate::models::EntityRecord) -> Option<i64> {
    consistency_field_date(entity, &["date", "startDate", "time"])
}

fn consistency_timeline_range(entity: &crate::models::EntityRecord) -> (Option<i64>, Option<i64>) {
    (
        consistency_field_date(entity, &["startDate", "startTime", "beginDate"]),
        consistency_field_date(entity, &["endDate", "endTime", "finishDate"]),
    )
}

fn consistency_timeline_age_values(
    event: &crate::models::EntityRecord,
    character: &crate::models::EntityRecord,
) -> Vec<f64> {
    let participants = consistency_field_values(
        event,
        &["character", "characterId", "characters", "participants"],
    );
    let mut values = Vec::new();
    if consistency_mentions_entity(&participants, character) {
        values.extend(consistency_numeric_values(&consistency_field_values(
            event,
            &["age", "characterAge"],
        )));
    }
    for value in consistency_field_values(
        event,
        &[
            "ages",
            "ageAt",
            "ageHistory",
            "ageTimeline",
            "ageByChapter",
            "characterAges",
        ],
    ) {
        match value {
            serde_json::Value::Object(object) => {
                for (key, nested) in object {
                    if consistency_entity_aliases(character)
                        .iter()
                        .any(|alias| alias == &key.trim().to_lowercase())
                    {
                        values.extend(consistency_numeric_values(&[nested]));
                    }
                }
            }
            serde_json::Value::Array(items) => {
                for item in items {
                    let Some(object) = item.as_object() else {
                        continue;
                    };
                    let person = object
                        .get("character")
                        .or_else(|| object.get("characterId"))
                        .or_else(|| object.get("name"))
                        .or_else(|| object.get("person"));
                    if person
                        .map(|person| consistency_mentions_entity(&[person], character))
                        .unwrap_or(false)
                    {
                        if let Some(age) = object.get("age").or_else(|| object.get("value")) {
                            values.extend(consistency_numeric_values(&[age]));
                        }
                    }
                }
            }
            _ => {}
        }
    }
    values
}

fn consistency_character_age_values(
    character: &crate::models::EntityRecord,
    timelines: &[&crate::models::EntityRecord],
) -> Vec<f64> {
    let mut values = consistency_numeric_values(&consistency_field_values(
        character,
        &[
            "age",
            "currentAge",
            "ages",
            "ageAt",
            "ageAtChapter",
            "ageHistory",
            "ageTimeline",
            "ageByChapter",
        ],
    ));
    for event in timelines {
        values.extend(consistency_timeline_age_values(event, character));
    }
    values.sort_by(|left, right| left.partial_cmp(right).unwrap_or(std::cmp::Ordering::Equal));
    values.dedup_by(|left, right| (*left - *right).abs() < 0.01);
    values
}

fn consistency_normalize_birthday(value: &str) -> String {
    value
        .trim()
        .chars()
        .map(|character| {
            if " ./年月日".contains(character) {
                '-'
            } else {
                character
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .replace("--", "-")
        .to_lowercase()
}

fn consistency_character_birthday_values(
    character: &crate::models::EntityRecord,
    timelines: &[&crate::models::EntityRecord],
) -> Vec<String> {
    let mut values = Vec::new();
    for value in consistency_field_values(
        character,
        &[
            "birthday",
            "birthDate",
            "dateOfBirth",
            "birthDay",
            "birthdays",
            "birthdayHistory",
        ],
    ) {
        let mut leaves = Vec::new();
        consistency_nested_values(value, &mut leaves);
        values.extend(
            leaves
                .iter()
                .map(|item| consistency_normalize_birthday(&consistency_value_text(item)))
                .filter(|item| !item.is_empty()),
        );
    }
    for event in timelines {
        let participants = consistency_field_values(
            event,
            &["character", "characterId", "characters", "participants"],
        );
        if !consistency_mentions_entity(&participants, character) {
            continue;
        }
        for value in consistency_field_values(event, &["birthday", "birthDate", "dateOfBirth"]) {
            let mut leaves = Vec::new();
            consistency_nested_values(value, &mut leaves);
            values.extend(
                leaves
                    .iter()
                    .map(|item| consistency_normalize_birthday(&consistency_value_text(item)))
                    .filter(|item| !item.is_empty()),
            );
        }
    }
    values.sort();
    values.dedup();
    values
}

fn consistency_normalize_gender(value: &str) -> String {
    let text = value.trim().to_lowercase();
    match text.as_str() {
        "男" | "男性" | "male" | "man" | "m" => "male".to_string(),
        "女" | "女性" | "female" | "woman" | "f" => "female".to_string(),
        "非二元" | "非二元性别" | "nonbinary" | "non-binary" | "other" | "其他" => {
            "other".to_string()
        }
        _ => text,
    }
}

fn consistency_character_gender_values(character: &crate::models::EntityRecord) -> Vec<String> {
    let mut leaves = Vec::new();
    for value in consistency_field_values(
        character,
        &["gender", "sex", "genderIdentity", "genderHistory"],
    ) {
        consistency_nested_values(value, &mut leaves);
    }
    let mut values: Vec<String> = leaves
        .iter()
        .map(|value| consistency_normalize_gender(&consistency_value_text(value)))
        .filter(|value| !value.is_empty())
        .collect();
    values.sort();
    values.dedup();
    values
}

fn consistency_is_dead_status(value: &serde_json::Value) -> bool {
    matches!(
        consistency_value_text(value).trim().to_lowercase().as_str(),
        "死亡" | "已死亡" | "dead" | "deceased"
    )
}

fn consistency_is_death_event(event: &crate::models::EntityRecord) -> bool {
    consistency_field_values(event, &["status", "state", "activity", "eventType", "type"])
        .iter()
        .any(|value| {
            let text = consistency_value_text(value).trim().to_lowercase();
            consistency_is_dead_status(value) || matches!(text.as_str(), "死亡" | "death" | "dead")
        })
}

fn consistency_is_similar_name(left: &str, right: &str) -> bool {
    let normalize = |value: &str| {
        value
            .chars()
            .filter(|character| {
                !character.is_whitespace() && !"·。、“”\"'’‘-—_".contains(*character)
            })
            .collect::<String>()
            .to_lowercase()
    };
    let left = normalize(left).chars().collect::<Vec<_>>();
    let right = normalize(right).chars().collect::<Vec<_>>();
    if left.len() < 2 || right.len() < 2 || left == right || left.len().abs_diff(right.len()) > 1 {
        return false;
    }
    let mut previous: Vec<usize> = (0..=right.len()).collect();
    for row in 1..=left.len() {
        let mut diagonal = previous[0];
        previous[0] = row;
        for column in 1..=right.len() {
            let next = previous[column];
            previous[column] = if left[row - 1] == right[column - 1] {
                diagonal
            } else {
                (diagonal + 1)
                    .min(previous[column] + 1)
                    .min(previous[column - 1] + 1)
            };
            diagonal = next;
        }
    }
    previous[right.len()] <= 1
}

fn chapter_reference_tokens(value: &str) -> Vec<String> {
    value
        .split(|character: char| ",，、;；\r\n".contains(character))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .collect()
}

fn ordered_chapters(nodes: &[NodeRecord]) -> Vec<NodeRecord> {
    let volume_order: HashMap<&str, i64> = nodes
        .iter()
        .filter(|node| node.kind == "volume")
        .map(|node| (node.id.as_str(), node.order_index))
        .collect();
    let mut chapters: Vec<NodeRecord> = nodes
        .iter()
        .filter(|node| node.kind == "chapter")
        .cloned()
        .collect();
    chapters.sort_by(|left, right| {
        let left_volume_order = left
            .parent_id
            .as_deref()
            .and_then(|id| volume_order.get(id))
            .copied()
            .unwrap_or(i64::MAX);
        let right_volume_order = right
            .parent_id
            .as_deref()
            .and_then(|id| volume_order.get(id))
            .copied()
            .unwrap_or(i64::MAX);

        left_volume_order
            .cmp(&right_volume_order)
            .then_with(|| left.order_index.cmp(&right.order_index))
            .then_with(|| left.created_at.cmp(&right.created_at))
            .then_with(|| left.id.cmp(&right.id))
    });
    chapters
}

fn chapter_reference_exists(nodes: &[NodeRecord], reference: &str) -> bool {
    let normalized = reference.trim();
    if normalized.is_empty() {
        return false;
    }
    let chapters = ordered_chapters(nodes);
    if chapters
        .iter()
        .any(|chapter| chapter.title.trim() == normalized)
    {
        return true;
    }
    let digits: String = normalized
        .chars()
        .filter(|character| character.is_ascii_digit())
        .collect();
    let Ok(number) = digits.parse::<usize>() else {
        return false;
    };
    number > 0 && chapters.get(number - 1).is_some()
}

fn is_paid_off_foreshadowing_status(value: &str) -> bool {
    matches!(
        value.trim().to_lowercase().as_str(),
        "paid-off" | "paid_off" | "paidoff" | "resolved" | "已回收" | "已解决" | "回收"
    )
}

fn consistency_issue(
    severity: &str,
    code: &str,
    title: &str,
    detail: String,
    ref_id: &str,
    ref_kind: &str,
    path: &str,
) -> crate::models::ConsistencyIssue {
    crate::models::ConsistencyIssue {
        id: format!("{}:{}:{}", code, ref_id, title),
        severity: severity.to_string(),
        code: code.to_string(),
        title: title.to_string(),
        detail,
        ref_id: ref_id.to_string(),
        ref_kind: ref_kind.to_string(),
        path: path.to_string(),
    }
}

#[tauri::command]
pub fn check_consistency(path: String) -> Result<crate::models::ConsistencyReport, String> {
    let (root, connection) = project_connection(&path)?;
    let nodes = storage::all_nodes(&connection, false)?;
    let entities = storage::all_entities(&connection, false)?;
    let mut issues = Vec::new();
    let mut known_titles = std::collections::HashSet::new();
    let mut duplicate_titles = std::collections::HashSet::new();
    for entity in &entities {
        let title = entity.title.trim();
        if title.is_empty() {
            issues.push(consistency_issue(
                "error",
                "empty-title",
                "资料条目没有名称",
                "请为资料条目补充名称，避免 Wiki 链接和搜索结果无法定位。".to_string(),
                &entity.id,
                "entity",
                &entity.file_path,
            ));
            continue;
        }
        let duplicate_key = format!("{}:{}", entity.kind, title.to_lowercase());
        if !duplicate_titles.insert(duplicate_key) {
            issues.push(consistency_issue(
                "warning",
                "duplicate-title",
                "资料条目名称重复",
                format!(
                    "“{}”在同一资料类型中出现多次，Wiki 链接可能指向不明确。",
                    title
                ),
                &entity.id,
                "entity",
                &entity.file_path,
            ));
        }
        known_titles.insert(title.to_string());
    }
    for node in nodes.iter().filter(|node| node.kind != "volume") {
        let file = storage::safe_relative(&root, &node.file_path)?;
        let content = fs::read_to_string(file).unwrap_or_default();
        for target in wiki_targets(&content) {
            if !known_titles.contains(&target) {
                issues.push(consistency_issue(
                    "warning",
                    "missing-wiki",
                    "Wiki 链接没有对应资料",
                    format!("正文引用了“{}”，但资料库中没有同名条目。", target),
                    &node.id,
                    &node.kind,
                    &node.file_path,
                ));
            }
        }
    }
    let chapter_ids: std::collections::HashSet<&str> = nodes
        .iter()
        .filter(|node| node.kind == "chapter")
        .map(|node| node.id.as_str())
        .collect();
    let ordered_chapters = ordered_chapters(&nodes);
    let chapter_order: std::collections::HashMap<&str, usize> = ordered_chapters
        .iter()
        .enumerate()
        .map(|(index, node)| (node.id.as_str(), index))
        .collect();
    for arc in entities.iter().filter(|entity| entity.kind == "story-arc") {
        let linked = arc
            .content
            .get("chapterIds")
            .and_then(serde_json::Value::as_array)
            .cloned()
            .unwrap_or_default();
        let broken = linked
            .iter()
            .filter_map(serde_json::Value::as_str)
            .filter(|id| !chapter_ids.contains(id))
            .count();
        if broken > 0 {
            issues.push(consistency_issue(
                "warning",
                "broken-story-arc-chapter",
                "剧情线章节关联失效",
                format!("剧情线“{}”包含 {} 个已删除章节引用。", arc.title, broken),
                &arc.id,
                &arc.kind,
                &arc.file_path,
            ));
        }
        let milestones = arc
            .content
            .get("milestones")
            .and_then(serde_json::Value::as_array)
            .cloned()
            .unwrap_or_default();
        let mut open_milestones = 0usize;
        for milestone in &milestones {
            if milestone.get("status").and_then(serde_json::Value::as_str) != Some("completed") {
                open_milestones += 1;
            }
            if let Some(chapter_id) = milestone
                .get("chapterId")
                .and_then(serde_json::Value::as_str)
                .filter(|value| !value.is_empty())
            {
                if !chapter_ids.contains(chapter_id) {
                    let title = milestone
                        .get("title")
                        .and_then(serde_json::Value::as_str)
                        .unwrap_or("未命名节点");
                    issues.push(consistency_issue(
                        "warning",
                        "story-arc-orphan-milestone",
                        "剧情线节点引用失效",
                        format!("节点“{}”引用的章节已不存在。", title),
                        &arc.id,
                        &arc.kind,
                        &arc.file_path,
                    ));
                }
            }
        }
        let status = arc
            .content
            .get("status")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("planned");
        if status == "completed" && open_milestones > 0 {
            issues.push(consistency_issue(
                "warning",
                "story-arc-completed-with-open-milestone",
                "已完成剧情线仍有未完成节点",
                format!(
                    "剧情线“{}”仍有 {} 个计划节点未完成。",
                    arc.title, open_milestones
                ),
                &arc.id,
                &arc.kind,
                &arc.file_path,
            ));
        }
        let last_progress = linked
            .iter()
            .filter_map(serde_json::Value::as_str)
            .filter_map(|id| chapter_order.get(id).copied())
            .max();
        if status == "active" && open_milestones > 0 && !ordered_chapters.is_empty() {
            let latest = ordered_chapters.len() - 1;
            let gap = last_progress
                .map(|index| latest.saturating_sub(index))
                .unwrap_or(ordered_chapters.len());
            if gap >= 5 {
                issues.push(consistency_issue(
                    "warning",
                    "story-arc-stale",
                    "剧情线可能长期未推进",
                    format!("剧情线“{}”已连续 {} 章没有关联推进。", arc.title, gap),
                    &arc.id,
                    &arc.kind,
                    &arc.file_path,
                ));
            }
        }
    }
    let character_ids: std::collections::HashSet<String> = entities
        .iter()
        .filter(|entity| entity.kind == "character")
        .map(|entity| entity.id.clone())
        .collect();
    for entity in entities
        .iter()
        .filter(|entity| entity.kind == "relationship")
    {
        let from_id = json_text(&entity.content, "fromId");
        let to_id = json_text(&entity.content, "toId");
        if !character_ids.contains(&from_id) || !character_ids.contains(&to_id) {
            issues.push(consistency_issue(
                "error",
                "broken-relationship",
                "人物关系引用失效",
                "关系两端必须指向仍存在的人物资料。".to_string(),
                &entity.id,
                "relationship",
                &entity.file_path,
            ));
        }
        if !from_id.is_empty() && from_id == to_id {
            issues.push(consistency_issue(
                "warning",
                "self-relationship",
                "人物关系连接到自身",
                "请确认这是否是有意记录的自我关系。".to_string(),
                &entity.id,
                "relationship",
                &entity.file_path,
            ));
        }
    }
    for entity in &entities {
        let fields: &[(&str, &str)] = match entity.kind.as_str() {
            "timeline" => &[("chapters", "关联章节")],
            "foreshadowing" => &[
                ("plantedIn", "首次埋设章节"),
                ("plannedPayoff", "计划回收章节"),
                ("actualPayoff", "实际回收章节"),
            ],
            _ => &[],
        };
        for (key, label) in fields {
            for reference in chapter_reference_tokens(&json_text(&entity.content, key)) {
                if !chapter_reference_exists(&nodes, &reference) {
                    issues.push(consistency_issue(
                        "warning",
                        "missing-chapter-reference",
                        &format!("{}不存在", label),
                        format!("“{}”无法匹配当前正文中的章节。", reference),
                        &entity.id,
                        &entity.kind,
                        &entity.file_path,
                    ));
                }
            }
        }
        if entity.kind == "foreshadowing"
            && !json_text(&entity.content, "actualPayoff").trim().is_empty()
            && !is_paid_off_foreshadowing_status(&json_text(&entity.content, "status"))
        {
            issues.push(consistency_issue(
                "warning",
                "foreshadowing-status",
                "伏笔状态未标记为已回收",
                "已经填写实际回收章节，但当前状态仍未标记为“已回收”。".to_string(),
                &entity.id,
                &entity.kind,
                &entity.file_path,
            ));
        }
    }

    let characters: Vec<&crate::models::EntityRecord> = entities
        .iter()
        .filter(|entity| entity.kind == "character")
        .collect();
    let timelines: Vec<&crate::models::EntityRecord> = entities
        .iter()
        .filter(|entity| entity.kind == "timeline")
        .collect();
    for character in &characters {
        let ages = consistency_character_age_values(character, &timelines);
        let age_difference = ages
            .last()
            .zip(ages.first())
            .map(|(last, first)| last - first)
            .unwrap_or(0.0);
        if ages.len() > 1 && age_difference >= 2.0 {
            issues.push(consistency_issue(
                "warning",
                "character-age-conflict",
                "可能存在年龄冲突",
                format!(
                    "人物“{}”的结构化年龄记录为 {}，差异较大，请确认时间线或年龄设定。",
                    character.title,
                    ages.iter()
                        .map(|age| age.to_string())
                        .collect::<Vec<_>>()
                        .join("、")
                ),
                &character.id,
                &character.kind,
                &character.file_path,
            ));
        }
        let birthdays = consistency_character_birthday_values(character, &timelines);
        if birthdays.len() > 1 {
            issues.push(consistency_issue(
                "warning",
                "character-birthday-conflict",
                "生日描述可能冲突",
                format!(
                    "人物“{}”存在多个结构化生日记录：{}。",
                    character.title,
                    birthdays.join("、")
                ),
                &character.id,
                &character.kind,
                &character.file_path,
            ));
        }
        let genders = consistency_character_gender_values(character);
        if genders.len() > 1 {
            issues.push(consistency_issue(
                "warning",
                "character-gender-conflict",
                "性别描述可能冲突",
                format!(
                    "人物“{}”的结构化性别字段出现不一致值：{}。",
                    character.title,
                    genders.join("、")
                ),
                &character.id,
                &character.kind,
                &character.file_path,
            ));
        }

        let dead = consistency_field_values(character, &["status", "state", "lifeStatus"])
            .iter()
            .any(|value| {
                let mut leaves = Vec::new();
                consistency_nested_values(value, &mut leaves);
                leaves.iter().any(|item| consistency_is_dead_status(item))
            });

        let mut death_at = consistency_field_date(
            character,
            &["deathDate", "dateOfDeath", "deceasedAt", "deathTime"],
        );
        if death_at.is_none() {
            for event in &timelines {
                let participants = consistency_field_values(
                    event,
                    &["character", "characterId", "characters", "participants"],
                );
                if !consistency_mentions_entity(&participants, character)
                    || !consistency_is_death_event(event)
                {
                    continue;
                }
                if let Some(date) = consistency_timeline_date(event) {
                    if death_at.map(|current| date < current).unwrap_or(true) {
                        death_at = Some(date);
                    }
                }
            }
        }
        if dead {
            if let Some(death_date) = death_at {
                if let Some(later) = timelines.iter().find(|event| {
                    let date = consistency_timeline_date(event);
                    let participants = consistency_field_values(
                        event,
                        &["character", "characterId", "characters", "participants"],
                    );
                    date.map(|date| date > death_date).unwrap_or(false)
                        && consistency_mentions_entity(&participants, character)
                        && !consistency_is_death_event(event)
                }) {
                    issues.push(consistency_issue("warning", "posthumous-appearance", "人物可能在死亡事件之后继续出现", format!("人物“{}”在结构化死亡时间之后仍出现在时间线事件“{}”中，请确认是否为回忆、幻象或时间线误记。", character.title, later.title), &character.id, &character.kind, &character.file_path));
                }
            }
        }
    }

    let mut character_groups: std::collections::HashMap<String, Vec<&crate::models::EntityRecord>> =
        std::collections::HashMap::new();
    for character in &characters {
        character_groups
            .entry(character.title.trim().to_lowercase())
            .or_default()
            .push(character);
    }
    for group in character_groups.values() {
        if group.len() < 2 {
            continue;
        }
        let mut genders = group
            .iter()
            .flat_map(|character| consistency_character_gender_values(character))
            .collect::<Vec<_>>();
        genders.sort();
        genders.dedup();
        if genders.len() > 1 {
            issues.push(consistency_issue(
                "warning",
                "character-gender-conflict",
                "性别描述可能冲突",
                format!(
                    "同名人物资料的结构化性别字段出现不一致值：{}。",
                    genders.join("、")
                ),
                &group[0].id,
                &group[0].kind,
                &group[0].file_path,
            ));
        }
    }

    for left in 0..characters.len() {
        for right in (left + 1)..characters.len() {
            if !consistency_is_similar_name(&characters[left].title, &characters[right].title) {
                continue;
            }
            issues.push(consistency_issue(
                "warning",
                "similar-character-name",
                "名称可能相似",
                format!(
                    "人物“{}”与“{}”名称相似，请确认是否为不同人物或同一人物的拼写变化。",
                    characters[left].title, characters[right].title
                ),
                &characters[right].id,
                &characters[right].kind,
                &characters[right].file_path,
            ));
        }
    }

    let locations: Vec<&crate::models::EntityRecord> = entities
        .iter()
        .filter(|entity| entity.kind == "location")
        .collect();
    for left in 0..locations.len() {
        for right in (left + 1)..locations.len() {
            if !consistency_is_similar_name(&locations[left].title, &locations[right].title) {
                continue;
            }
            issues.push(consistency_issue(
                "warning",
                "similar-location-name",
                "地点名称可能相似",
                format!(
                    "地点“{}”与“{}”名称相似，请确认层级或拼写。",
                    locations[left].title, locations[right].title
                ),
                &locations[right].id,
                &locations[right].kind,
                &locations[right].file_path,
            ));
        }
    }

    let mut previous_timeline: Option<(String, i64)> = None;
    for event in &timelines {
        let (start, end) = consistency_timeline_range(event);
        if let (Some(start), Some(end)) = (start, end) {
            if end < start {
                issues.push(consistency_issue(
                    "warning",
                    "timeline-range",
                    "时间线结束时间早于开始时间",
                    format!(
                        "事件“{}”的结束时间早于开始时间，请确认时间范围。",
                        event.title
                    ),
                    &event.id,
                    &event.kind,
                    &event.file_path,
                ));
            }
        }
        let Some(date) = consistency_timeline_date(event) else {
            continue;
        };
        if let Some((previous_title, previous_date)) = &previous_timeline {
            if date < *previous_date {
                issues.push(consistency_issue(
                    "warning",
                    "timeline-order",
                    "时间线日期可能逆序",
                    format!(
                        "事件“{}”的日期早于前一个结构化事件“{}”，请确认时间线顺序。",
                        event.title, previous_title
                    ),
                    &event.id,
                    &event.kind,
                    &event.file_path,
                ));
            }
        }
        previous_timeline = Some((event.title.clone(), date));
    }

    let errors = issues
        .iter()
        .filter(|issue| issue.severity == "error")
        .count() as u64;
    let warnings = issues
        .iter()
        .filter(|issue| issue.severity == "warning")
        .count() as u64;
    Ok(crate::models::ConsistencyReport {
        checked_at: storage::now(),
        issue_count: issues.len() as u64,
        errors,
        warnings,
        issues,
    })
}

pub(crate) struct ExportRenderOptions {
    pub(crate) include_volume_titles: bool,
    pub(crate) include_chapter_titles: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn story_arc_staleness_uses_volume_then_chapter_order() {
        let root = std::env::temp_dir().join(format!("novelforge-arc-order-{}", storage::new_id()));
        let path = root.to_string_lossy().to_string();
        let project = create_project(ProjectInput {
            path: path.clone(),
            title: "剧情线回归".to_string(),
            author: String::new(),
            description: String::new(),
            genre: String::new(),
            target_words: 0,
        })
        .unwrap();
        let volume = project
            .nodes
            .iter()
            .find(|node| node.kind == "volume")
            .unwrap();
        let chapter = project
            .nodes
            .iter()
            .find(|node| node.kind == "chapter")
            .unwrap();
        let (_, connection) = project_connection(&path).unwrap();
        let mut second_volume = volume.clone();
        second_volume.id = "second-volume".to_string();
        second_volume.order_index = 1;
        second_volume.file_path = "manuscript/second".to_string();
        insert_node(&connection, &second_volume).unwrap();
        // Six chapters per volume, with chapter indices restarting in each volume.
        for (parent, prefix, start) in [(&volume.id, "first", 1), (&second_volume.id, "second", 0)]
        {
            for index in start..6 {
                let mut node = chapter.clone();
                node.id = format!("{prefix}-{index}");
                node.parent_id = Some(parent.clone());
                node.order_index = index;
                node.file_path = format!("manuscript/{}.md", node.id);
                fs::write(root.join(&node.file_path), "正文").unwrap();
                insert_node(&connection, &node).unwrap();
            }
        }
        drop(connection);
        for (title, linked) in [("应告警", "first-5"), ("不应告警", "second-1")] {
            upsert_entity(EntityInput {
                project_path: path.clone(),
                kind: "story-arc".to_string(),
                id: None,
                title: title.to_string(),
                tags: Vec::new(),
                content: serde_json::json!({"status": "active", "chapterIds": [linked],
                    "milestones": [{"title": "待推进", "status": "planned"}]}),
            })
            .unwrap();
        }
        let report = check_consistency(path).unwrap();
        let stale: Vec<_> = report
            .issues
            .iter()
            .filter(|issue| issue.code == "story-arc-stale")
            .collect();
        assert_eq!(stale.len(), 1);
        assert!(stale[0].detail.contains("“应告警”"));
        assert!(stale[0].detail.contains("连续 6 章"));
        fs::remove_dir_all(root).unwrap();
    }
}
