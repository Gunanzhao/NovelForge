use super::*;

fn export_nodes(
    root: &Path,
    nodes: &[NodeRecord],
    parent_id: Option<&str>,
    level: usize,
    format: &str,
    output: &mut String,
    options: &ExportRenderOptions,
) {
    for node in node_children(nodes, parent_id) {
        let include_title = if node.kind == "volume" {
            options.include_volume_titles
        } else {
            options.include_chapter_titles
        };
        if include_title {
            if format == "markdown" {
                output.push_str(&format!("\n{} {}\n\n", "#".repeat(level.max(1)), node.title));
            } else {
                output.push_str(&format!("\n{}\n{}\n\n", node.title, "=".repeat(node.title.chars().count().max(3))));
            }
        }
        if node.kind != "volume" {
            if let Ok(content) = fs::read_to_string(storage::safe_relative(root, &node.file_path).unwrap_or_else(|_| PathBuf::new())) {
                let content = storage::strip_markdown_frontmatter(&content);
                let clean = if format == "txt" {
                    export_plain_text(&parse_export_document(&content))
                } else {
                    content.lines().filter(|line| !line.trim_start().starts_with("# ")).collect::<Vec<_>>().join("\n")
                };
                output.push_str(clean.trim());
                output.push_str("\n\n");
            }
        }
        export_nodes(root, nodes, Some(&node.id), level + 1, format, output, options);
    }
}

#[derive(Debug, Clone)]
enum ExportInline {
    Text(String),
    Strong(Vec<ExportInline>),
    Emphasis(Vec<ExportInline>),
    Strike(Vec<ExportInline>),
    Code(String),
    Link { label: Vec<ExportInline>, href: String },
    Image { alt: String, src: String },
    Wiki(String),
    FootnoteReference(String),
}

#[derive(Debug, Clone)]
struct ExportListItem {
    content: Vec<ExportInline>,
    checked: Option<bool>,
}

#[derive(Debug, Clone)]
enum ExportBlock {
    Heading { level: usize, content: Vec<ExportInline> },
    Paragraph(Vec<ExportInline>),
    Quote(Vec<ExportInline>),
    List { ordered: bool, items: Vec<ExportListItem> },
    CodeBlock(String),
    HorizontalRule,
    Table { headers: Vec<Vec<ExportInline>>, rows: Vec<Vec<Vec<ExportInline>>> },
    FootnoteDefinition { id: String, content: Vec<ExportInline> },
}

#[derive(Debug, Clone, Default)]
struct ExportDocument {
    blocks: Vec<ExportBlock>,
}

fn export_fence_character(line: &str) -> Option<char> {
    let trimmed = line.trim_start();
    if trimmed.as_bytes().starts_with(&[96, 96, 96]) { Some(char::from(96)) }
    else if trimmed.starts_with("~~~") { Some('~') }
    else { None }
}

fn export_list_marker(line: &str) -> Option<(bool, Option<bool>, String)> {
    let trimmed = line.trim_start();
    for (marker, checked) in [("- [ ] ", Some(false)), ("- [x] ", Some(true)), ("- [X] ", Some(true))] {
        if let Some(content) = trimmed.strip_prefix(marker) {
            return Some((false, checked, content.to_string()));
        }
    }
    for marker in ["- ", "* ", "+ "] {
        if let Some(content) = trimmed.strip_prefix(marker) {
            return Some((false, None, content.to_string()));
        }
    }
    let digits = trimmed.char_indices().take_while(|(_, character)| character.is_ascii_digit()).collect::<Vec<_>>();
    if let Some((end, _)) = digits.last() {
        let marker_end = end + 1;
        if let Some(marker) = trimmed[marker_end..].chars().next() {
            if (marker == '.' || marker == ')') && trimmed[marker_end + marker.len_utf8()..].starts_with(' ') {
                return Some((true, None, trimmed[marker_end + marker.len_utf8() + 1..].to_string()));
            }
        }
    }
    None
}

fn export_table_cells(line: &str) -> Option<Vec<String>> {
    let trimmed = line.trim();
    if !trimmed.contains('|') { return None; }
    let value = trimmed.strip_prefix('|').unwrap_or(trimmed);
    let value = value.strip_suffix('|').unwrap_or(value);
    Some(value.split('|').map(|cell| cell.trim().to_string()).collect())
}

fn export_is_table_separator(line: &str) -> bool {
    export_table_cells(line).map(|cells| !cells.is_empty() && cells.iter().all(|cell| {
        let value = cell.trim_matches(':').trim();
        value.len() >= 3 && value.chars().all(|character| character == '-')
    })).unwrap_or(false)
}

fn export_is_horizontal_rule(line: &str) -> bool {
    matches!(line.trim(), "---" | "***" | "___")
}

fn export_footnote_definition(line: &str) -> Option<(String, String)> {
    let trimmed = line.trim_start();
    let rest = trimmed.strip_prefix("[^")?;
    let close = rest.find("]:")?;
    let id = rest[..close].trim();
    if id.is_empty() || id.chars().any(char::is_whitespace) {
        return None;
    }
    Some((id.to_string(), rest[close + 2..].trim_start().to_string()))
}

fn export_is_block_start(line: &str) -> bool {
    let trimmed = line.trim();
    !trimmed.is_empty()
        && (heading_level(trimmed).is_some() || export_fence_character(trimmed).is_some()
            || export_list_marker(trimmed).is_some() || trimmed.starts_with('>')
            || export_is_horizontal_rule(trimmed) || export_footnote_definition(trimmed).is_some())
}

fn parse_export_link(source: &str, image: bool) -> Option<(usize, String, String)> {
    let prefix = if image { "![" } else { "[" };
    if !source.starts_with(prefix) { return None; }
    let label_start = prefix.len();
    let close = source[label_start..].find("](")?;
    let url_start = label_start + close + 2;
    let url_end = source[url_start..].find(')')?;
    let consumed = url_start + url_end + 1;
    Some((consumed, source[label_start..label_start + close].to_string(), source[url_start..url_start + url_end].to_string()))
}

fn parse_export_inline(source: &str) -> Vec<ExportInline> {
    let mut result = Vec::new();
    let mut offset = 0;
    while offset < source.len() {
        let rest = &source[offset..];
        if rest.starts_with("[^") {
            if let Some(end) = rest[2..].find(']') {
                let id = rest[2..2 + end].trim();
                if !id.is_empty() && !id.chars().any(char::is_whitespace) && rest[2 + end..].starts_with(']') {
                    result.push(ExportInline::FootnoteReference(id.to_string()));
                    offset += end + 3;
                    continue;
                }
            }
        }
        if rest.starts_with("[[") {
            if let Some(end) = rest[2..].find("]]") {
                let target = rest[2..2 + end].trim().to_string();
                if !target.is_empty() {
                    result.push(ExportInline::Wiki(target));
                    offset += 2 + end + 2;
                    continue;
                }
            }
        }
        if let Some((consumed, label, href)) = parse_export_link(rest, true) {
            result.push(ExportInline::Image { alt: label, src: href });
            offset += consumed;
            continue;
        }
        if let Some((consumed, label, href)) = parse_export_link(rest, false) {
            result.push(ExportInline::Link { label: parse_export_inline(&label), href });
            offset += consumed;
            continue;
        }
        let mut consumed_pair = None;
        for (marker, kind) in [("**", 0_u8), ("__", 0_u8), ("~~", 1_u8), ("*", 2_u8), ("_", 2_u8)] {
            if !rest.starts_with(marker) { continue; }
            if let Some(end) = rest[marker.len()..].find(marker) {
                let inner = &rest[marker.len()..marker.len() + end];
                if !inner.is_empty() {
                    let inline = match kind {
                        0 => ExportInline::Strong(parse_export_inline(inner)),
                        1 => ExportInline::Strike(parse_export_inline(inner)),
                        _ => ExportInline::Emphasis(parse_export_inline(inner)),
                    };
                    consumed_pair = Some((marker.len() + end + marker.len(), inline));
                    break;
                }
            }
        }
        if let Some((consumed, inline)) = consumed_pair {
            result.push(inline);
            offset += consumed;
            continue;
        }
        let code_marker = char::from(96).to_string();
        if rest.starts_with(&code_marker) {
            if let Some(end) = rest[1..].find(char::from(96)) {
                result.push(ExportInline::Code(rest[1..1 + end].to_string()));
                offset += end + 2;
                continue;
            }
        }
        let next = rest.char_indices().skip(1).find(|(_, character)| {
            *character == '[' || *character == '*' || *character == '_' || *character == '~' || *character == char::from(96)
        }).map(|(index, _)| index).unwrap_or(rest.len());
        if next == 0 {
            let character = rest.chars().next().unwrap();
            let size = character.len_utf8();
            result.push(ExportInline::Text(rest[..size].to_string()));
            offset += size;
        } else {
            result.push(ExportInline::Text(rest[..next].to_string()));
            offset += next;
        }
    }
    result
}

fn parse_export_document(markdown: &str) -> ExportDocument {
    let lines = markdown.lines().collect::<Vec<_>>();
    let mut blocks = Vec::new();
    let mut index = 0;
    while index < lines.len() {
        let line = lines[index];
        let trimmed = line.trim();
        if trimmed.is_empty() { index += 1; continue; }
        if let Some((id, first_line)) = export_footnote_definition(trimmed) {
            let mut definition = first_line;
            index += 1;
            while index < lines.len() {
                let continuation = lines[index];
                if continuation.starts_with("    ") || continuation.starts_with('\t') {
                    if !definition.is_empty() { definition.push('\n'); }
                    definition.push_str(continuation.trim_start());
                    index += 1;
                } else {
                    break;
                }
            }
            blocks.push(ExportBlock::FootnoteDefinition { id, content: parse_export_inline(&definition) });
            continue;
        }
        if let Some(fence) = export_fence_character(trimmed) {
            index += 1;
            let mut code = Vec::new();
            while index < lines.len() {
                if export_fence_character(lines[index]).is_some_and(|character| character == fence) {
                    index += 1;
                    break;
                }
                code.push(lines[index]);
                index += 1;
            }
            blocks.push(ExportBlock::CodeBlock(code.join("\n")));
            continue;
        }
        if let Some(level) = heading_level(trimmed) {
            blocks.push(ExportBlock::Heading { level: level.min(6), content: parse_export_inline(trimmed[level + 1..].trim()) });
            index += 1;
            continue;
        }
        if export_is_horizontal_rule(trimmed) {
            blocks.push(ExportBlock::HorizontalRule);
            index += 1;
            continue;
        }
        if trimmed.starts_with('>') {
            let mut quote = Vec::new();
            while index < lines.len() && lines[index].trim_start().starts_with('>') {
                let value = lines[index].trim_start().strip_prefix('>').unwrap_or("").trim_start();
                quote.push(value);
                index += 1;
            }
            blocks.push(ExportBlock::Quote(parse_export_inline(&quote.join("\n"))));
            continue;
        }
        if let Some((ordered, checked, content)) = export_list_marker(line) {
            let mut items = vec![ExportListItem { content: parse_export_inline(&content), checked }];
            index += 1;
            while index < lines.len() {
                let Some((next_ordered, next_checked, next_content)) = export_list_marker(lines[index]) else { break };
                if next_ordered != ordered { break; }
                items.push(ExportListItem { content: parse_export_inline(&next_content), checked: next_checked });
                index += 1;
            }
            blocks.push(ExportBlock::List { ordered, items });
            continue;
        }
        if index + 1 < lines.len() && export_table_cells(line).is_some() && export_is_table_separator(lines[index + 1]) {
            let headers = export_table_cells(line).unwrap_or_default().into_iter().map(|cell| parse_export_inline(&cell)).collect::<Vec<_>>();
            index += 2;
            let mut rows = Vec::new();
            while index < lines.len() {
                let Some(cells) = export_table_cells(lines[index]) else { break };
                rows.push(cells.into_iter().map(|cell| parse_export_inline(&cell)).collect());
                index += 1;
            }
            blocks.push(ExportBlock::Table { headers, rows });
            continue;
        }
        let mut paragraph = vec![line];
        index += 1;
        while index < lines.len() && !lines[index].trim().is_empty() && !export_is_block_start(lines[index]) {
            if index + 1 < lines.len() && export_table_cells(lines[index]).is_some() && export_is_table_separator(lines[index + 1]) { break; }
            paragraph.push(lines[index]);
            index += 1;
        }
        blocks.push(ExportBlock::Paragraph(parse_export_inline(&paragraph.join("\n"))));
    }
    ExportDocument { blocks }
}

fn export_plain_code(value: &str) -> String {
    let mut result = value.replace("**", "").replace("__", "").replace("~~", "").replace(char::from(96), "");
    while let Some(start) = result.find("[[") {
        let Some(end_offset) = result[start + 2..].find("]]") else { break };
        let end = start + 2 + end_offset;
        let target = result[start + 2..end].trim().to_string();
        result.replace_range(start..end + 2, &target);
    }
    result
}

fn export_plain_inlines(inlines: &[ExportInline]) -> String {
    inlines.iter().map(|inline| match inline {
        ExportInline::Text(text) | ExportInline::Wiki(text) => text.clone(),
        ExportInline::Code(text) => export_plain_code(text),
        ExportInline::Strong(children) | ExportInline::Emphasis(children) | ExportInline::Strike(children) => export_plain_inlines(children),
        ExportInline::Link { label, .. } => export_plain_inlines(label),
        ExportInline::Image { alt, .. } => alt.clone(),
        ExportInline::FootnoteReference(id) => format!("[{}]", id),
    }).collect()
}

fn export_plain_text(document: &ExportDocument) -> String {
    let mut lines = Vec::new();
    for block in &document.blocks {
        match block {
            ExportBlock::Heading { content, .. } | ExportBlock::Paragraph(content) | ExportBlock::Quote(content) => lines.push(export_plain_inlines(content)),
            ExportBlock::List { items, .. } => lines.extend(items.iter().map(|item| export_plain_inlines(&item.content))),
            ExportBlock::CodeBlock(content) => lines.push(export_plain_code(content)),
            ExportBlock::HorizontalRule => {},
            ExportBlock::Table { headers, rows } => {
                lines.push(headers.iter().map(|cell| export_plain_inlines(cell)).collect::<Vec<_>>().join("\t"));
                lines.extend(rows.iter().map(|row| row.iter().map(|cell| export_plain_inlines(cell)).collect::<Vec<_>>().join("\t")));
            }
            ExportBlock::FootnoteDefinition { id, content } => lines.push(format!("[^{}]: {}", id, export_plain_inlines(content))),
        }
    }
    lines.into_iter().filter(|line| !line.trim().is_empty()).collect::<Vec<_>>().join("\n")
}

fn export_scope_nodes(nodes: &[NodeRecord], input: &ExportInput) -> Result<Vec<NodeRecord>, String> {
    let scope = input.scope.as_deref().unwrap_or("project");
    let mut selected_ids = HashSet::new();
    match scope {
        "project" => {

            selected_ids.extend(nodes.iter().map(|node| node.id.clone()));
        }
        "volume" => {
            let volume_path = input.volume_path.as_deref().ok_or_else(|| "指定卷导出需要卷路径".to_string())?;
            let volume = nodes.iter().find(|node| node.kind == "volume" && node.file_path == volume_path)
                .ok_or_else(|| "指定导出卷不存在".to_string())?;
            selected_ids.extend(descendant_ids(nodes, &volume.id));
        }
        "chapters" => {
            let ids = input.node_ids.as_deref().ok_or_else(|| "指定章节导出需要章节 ID".to_string())?;
            for id in ids {
                let node = nodes.iter().find(|node| node.id == *id)
                    .ok_or_else(|| format!("指定章节不存在：{}", id))?;
                selected_ids.extend(descendant_ids(nodes, &node.id));
            }
        }
        _ => return Err(format!("不支持的导出范围：{}", scope)),
    }
    let mut filtered: Vec<NodeRecord> = nodes
        .iter()
        .filter(|node| selected_ids.contains(&node.id))
        .cloned()
        .collect();
    for node in &mut filtered {
        if node.parent_id.as_ref().map(|id| !selected_ids.contains(id)).unwrap_or(false) {
            node.parent_id = None;
        }
    }
    Ok(filtered)
}

fn xml_escape(value: &str) -> String {
    value.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
        .replace('"', "&quot;").replace('\'', "&apos;")
}

#[derive(Clone, Copy)]
enum ExportUrlKind {
    Link,
    Image,
}

fn safe_export_url(value: &str, kind: ExportUrlKind) -> Option<&str> {
    let value = value.trim();
    if value.is_empty()
        || value.chars().any(|character| character.is_control())
        || value.starts_with("//")
        || value.starts_with('\\')
    {
        return None;
    }
    if value.starts_with('#') {
        return Some(value);
    }
    let scheme = value
        .find(':')
        .filter(|index| *index > 0)
        .map(|index| &value[..index])
        .filter(|candidate| {
            candidate.chars().enumerate().all(|(index, character)| {
                if index == 0 {
                    character.is_ascii_alphabetic()
                } else {
                    character.is_ascii_alphanumeric() || matches!(character, '+' | '-' | '.')
                }
            })
        });
    let Some(scheme) = scheme else {
        return Some(value);
    };
    if matches!(kind, ExportUrlKind::Image)
        && scheme.eq_ignore_ascii_case("data")
        && is_safe_data_image(value)
    {
        return Some(value);
    }
    let allowed = match kind {
        ExportUrlKind::Link => ["http", "https", "mailto"].as_slice(),
        ExportUrlKind::Image => ["http", "https"].as_slice(),
    };
    allowed
        .iter()
        .any(|candidate| scheme.eq_ignore_ascii_case(candidate))
        .then_some(value)
}

fn is_safe_data_image(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    let Some((metadata, payload)) = lower.split_once(',') else {
        return false;
    };
    matches!(
        metadata,
        "data:image/png;base64"
            | "data:image/jpeg;base64"
            | "data:image/jpg;base64"
            | "data:image/gif;base64"
            | "data:image/webp;base64"
            | "data:image/avif;base64"
    ) && {
        let padding_start = payload.find('=').unwrap_or(payload.len());
        let padding = &payload[padding_start..];
        !payload.is_empty()
            && payload.len() % 4 == 0
            && payload[..padding_start]
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'/'))
            && padding.len() <= 2
            && padding.bytes().all(|byte| byte == b'=')
    }
}

fn heading_level(line: &str) -> Option<usize> {
    let level = line.chars().take_while(|character| *character == '#').count();
    (level > 0 && line.chars().nth(level) == Some(' ')).then_some(level)
}

fn footnote_slug(id: &str) -> String {
    let slug: String = id.chars().map(|character| if character.is_ascii_alphanumeric() { character.to_ascii_lowercase() } else { '-' }).collect();
    let slug = slug.trim_matches('-');
    if slug.is_empty() { "note".to_string() } else { slug.to_string() }
}

fn export_html_inlines(inlines: &[ExportInline]) -> String {
    inlines.iter().map(|inline| match inline {
        ExportInline::Text(text) => xml_escape(text).replace('\n', "<br/>"),
        ExportInline::Strong(children) => format!("<strong>{}</strong>", export_html_inlines(children)),
        ExportInline::Emphasis(children) => format!("<em>{}</em>", export_html_inlines(children)),
        ExportInline::Strike(children) => format!("<del>{}</del>", export_html_inlines(children)),
        ExportInline::Code(text) => format!("<code>{}</code>", xml_escape(text)),
        ExportInline::Link { label, href } => {
            let label = export_html_inlines(label);
            safe_export_url(href, ExportUrlKind::Link)
                .map(|href| {
                    let rel = if href.to_ascii_lowercase().starts_with("http:")
                        || href.to_ascii_lowercase().starts_with("https:")
                    {
                        " rel=\"noopener noreferrer\""
                    } else {
                        ""
                    };
                    format!("<a href=\"{}\"{}>{}</a>", xml_escape(href), rel, label)
                })
                .unwrap_or(label)
        },
        ExportInline::Image { alt, src } => safe_export_url(src, ExportUrlKind::Image)
            .map(|src| format!("<img src=\"{}\" alt=\"{}\" referrerpolicy=\"no-referrer\" />", xml_escape(src), xml_escape(alt)))
            .unwrap_or_else(|| xml_escape(alt)),
        ExportInline::Wiki(target) => format!("<a class=\"wiki-link\" data-wiki-target=\"{}\" href=\"#wiki-{}\">{}</a>", xml_escape(target), xml_escape(&target.replace(' ', "-")), xml_escape(target)),
        ExportInline::FootnoteReference(id) => {
            let slug = footnote_slug(id);
            format!("<sup class=\"footnote-ref\"><a href=\"#fn-{}\">[{}]</a></sup>", xml_escape(&slug), xml_escape(id))
        },
    }).collect()
}

fn export_html_fragment(document: &ExportDocument, include_toc: bool) -> (String, String) {
    let mut body = String::new();
    let mut toc = String::new();
    let mut footnotes = Vec::new();
    let mut heading_index = 0_usize;
    for block in &document.blocks {
        match block {
            ExportBlock::Heading { level, content } => {
                heading_index += 1;
                let id = format!("heading-{}", heading_index);
                let text = export_html_inlines(content);
                body.push_str(&format!("<h{} id=\"{}\">{}</h{}>", level, id, text, level));
                if include_toc {
                    toc.push_str(&format!("<li class=\"toc-level-{}\"><a href=\"#{}\">{}</a></li>", level, id, text));
                }
            },
            ExportBlock::Paragraph(content) => body.push_str(&format!("<p>{}</p>", export_html_inlines(content))),
            ExportBlock::Quote(content) => body.push_str(&format!("<blockquote>{}</blockquote>", export_html_inlines(content))),
            ExportBlock::List { ordered, items } => {
                let tag = if *ordered { "ol" } else { "ul" };
                body.push_str(&format!("<{}>", tag));
                for item in items {
                    let checkbox = item.checked.map(|checked| format!("<input type=\"checkbox\" disabled{} /> ", if checked { " checked" } else { "" })).unwrap_or_default();
                    body.push_str(&format!("<li>{}{}</li>", checkbox, export_html_inlines(&item.content)));
                }
                body.push_str(&format!("</{}>", tag));
            },
            ExportBlock::CodeBlock(content) => body.push_str(&format!("<pre><code>{}</code></pre>", xml_escape(content))),
            ExportBlock::HorizontalRule => body.push_str("<hr/>"),
            ExportBlock::Table { headers, rows } => {
                body.push_str("<table><thead><tr>");
                for cell in headers { body.push_str(&format!("<th>{}</th>", export_html_inlines(cell))); }
                body.push_str("</tr></thead><tbody>");
                for row in rows {
                    body.push_str("<tr>");
                    for cell in row { body.push_str(&format!("<td>{}</td>", export_html_inlines(cell))); }
                    body.push_str("</tr>");
                }
                body.push_str("</tbody></table>");
            },
            ExportBlock::FootnoteDefinition { id, content } => {
                let slug = footnote_slug(id);
                footnotes.push(format!("<li id=\"fn-{}\">{} <a href=\"#fnref-{}\" class=\"footnote-backref\">↩</a></li>", xml_escape(&slug), export_html_inlines(content), xml_escape(&slug)));
            },
        }
    }
    if !footnotes.is_empty() {
        body.push_str(&format!("<section class=\"footnotes\"><h2>脚注</h2><ol>{}</ol></section>", footnotes.join("")));
    }
    (body, toc)
}

fn docx_run(text: &str, run_properties: &str) -> String {
    let mut value = String::new();
    for (index, line) in text.split('\n').enumerate() {
        if index > 0 { value.push_str("<w:br/>"); }
        value.push_str(&format!("<w:r>{}<w:t xml:space=\"preserve\">{}</w:t></w:r>", if run_properties.is_empty() { String::new() } else { format!("<w:rPr>{}</w:rPr>", run_properties) }, xml_escape(line)));
    }
    value
}

fn export_docx_inlines_with_properties(inlines: &[ExportInline], inherited: &str) -> String {
    let mut result = String::new();
    for inline in inlines {
        match inline {
            ExportInline::Text(text) => result.push_str(&docx_run(text, inherited)),
            ExportInline::Strong(children) => result.push_str(&export_docx_inlines_with_properties(children, &(inherited.to_string() + "<w:b/>"))),
            ExportInline::Emphasis(children) => result.push_str(&export_docx_inlines_with_properties(children, &(inherited.to_string() + "<w:i/>"))),
            ExportInline::Strike(children) => result.push_str(&export_docx_inlines_with_properties(children, &(inherited.to_string() + "<w:strike/>"))),
            ExportInline::Code(text) => result.push_str(&docx_run(text, &(inherited.to_string() + "<w:rStyle w:val=\"CodeChar\"/>"))),
            ExportInline::Link { label, .. } => result.push_str(&export_docx_inlines_with_properties(label, &(inherited.to_string() + "<w:color w:val=\"0563C1\"/><w:u w:val=\"single\"/>"))),
            ExportInline::Image { alt, .. } => result.push_str(&docx_run(alt, &(inherited.to_string() + "<w:color w:val=\"666666\"/>"))),
            ExportInline::Wiki(target) => result.push_str(&docx_run(target, &(inherited.to_string() + "<w:color w:val=\"7030A0\"/><w:u w:val=\"single\"/>"))),
            ExportInline::FootnoteReference(id) => result.push_str(&docx_run(&format!("[^{}]", id), inherited)),
        }
    }
    result
}

fn export_docx_table(table: &ExportBlock) -> String {
    let ExportBlock::Table { headers, rows } = table else { return String::new() };

    let mut result = String::from("<w:tbl><w:tblPr><w:tblBorders><w:top w:val=\"single\"/><w:left w:val=\"single\"/><w:bottom w:val=\"single\"/><w:right w:val=\"single\"/><w:insideH w:val=\"single\"/><w:insideV w:val=\"single\"/></w:tblBorders></w:tblPr>");
    result.push_str("<w:tr>");
    for cell in headers { result.push_str(&format!("<w:tc><w:p>{}</w:p></w:tc>", export_docx_inlines_with_properties(cell, "<w:b/>"))); }
    result.push_str("</w:tr>");
    for row in rows {
        result.push_str("<w:tr>");
        for cell in row { result.push_str(&format!("<w:tc><w:p>{}</w:p></w:tc>", export_docx_inlines_with_properties(cell, ""))); }
        result.push_str("</w:tr>");
    }
    result.push_str("</w:tbl>");
    result
}

fn docx_cover_drawing() -> String {
    "<w:p><w:r><w:drawing><wp:inline distT=\"0\" distB=\"0\" distL=\"0\" distR=\"0\"><wp:extent cx=\"4572000\" cy=\"6096000\"/><wp:docPr id=\"1\" name=\"封面\"/><a:graphic><a:graphicData uri=\"http://schemas.openxmlformats.org/drawingml/2006/picture\"><pic:pic><pic:nvPicPr><pic:cNvPr id=\"0\" name=\"cover\"/><pic:cNvPrPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed=\"rIdCover\"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x=\"0\" y=\"0\"/><a:ext cx=\"4572000\" cy=\"6096000\"/></a:xfrm><a:prstGeom prst=\"rect\"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>".to_string()
}

fn export_docx_xml_from_document(document: &ExportDocument, cover: Option<&ExportCover>) -> String {
    let mut body = String::new();
    if cover.is_some() { body.push_str(&docx_cover_drawing()); }
    for block in &document.blocks {
        match block {
            ExportBlock::Heading { level, content } => body.push_str(&format!("<w:p><w:pPr><w:pStyle w:val=\"Heading{}\"/></w:pPr>{}</w:p>", level, export_docx_inlines_with_properties(content, ""))),
            ExportBlock::Paragraph(content) => body.push_str(&format!("<w:p>{}</w:p>", export_docx_inlines_with_properties(content, ""))),
            ExportBlock::Quote(content) => body.push_str(&format!("<w:p><w:pPr><w:pStyle w:val=\"Quote\"/></w:pPr>{}</w:p>", export_docx_inlines_with_properties(content, "<w:i/>"))),
            ExportBlock::List { ordered, items } => {
                let number_id = if *ordered { 2 } else { 1 };
                for item in items {
                    let checkbox = item.checked.map(|checked| if checked { "☑ " } else { "☐ " }).unwrap_or("");
                    let prefix = if checkbox.is_empty() { String::new() } else { checkbox.to_string() };
                    body.push_str(&format!("<w:p><w:pPr><w:numPr><w:ilvl w:val=\"0\"/><w:numId w:val=\"{}\"/></w:numPr></w:pPr>{}{}</w:p>", number_id, docx_run(&prefix, ""), export_docx_inlines_with_properties(&item.content, "")));
                }
            },
            ExportBlock::CodeBlock(content) => body.push_str(&format!("<w:p><w:pPr><w:pStyle w:val=\"IntenseQuote\"/></w:pPr>{}</w:p>", docx_run(content, "<w:rStyle w:val=\"CodeChar\"/>"))),
            ExportBlock::HorizontalRule => body.push_str("<w:p><w:pPr><w:pBdr><w:bottom w:val=\"single\" w:sz=\"6\"/></w:pBdr></w:pPr></w:p>"),
            ExportBlock::Table { .. } => body.push_str(&export_docx_table(block)),
            ExportBlock::FootnoteDefinition { id, content } => body.push_str(&format!("<w:p><w:pPr><w:pStyle w:val=\"FootnoteText\"/></w:pPr>{}</w:p>", export_docx_inlines_with_properties(&[ExportInline::Text(format!("[^{}]: ", id)), ExportInline::Strong(content.clone())], ""))),
        }
    }
    format!(r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>{}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>"#, body)
}

fn docx_xml(markdown: &str, cover: Option<&ExportCover>) -> String {
    export_docx_xml_from_document(&parse_export_document(markdown), cover)
}

fn zip_document_with_binary(files: &[(&str, &str)], binary: &[(&str, &[u8])], stored: &[&str]) -> Result<Vec<u8>, String> {
    let cursor = Cursor::new(Vec::new());
    let mut writer = ZipWriter::new(cursor);
    for (name, content) in files {
        let method = if stored.iter().any(|item| item == name) { CompressionMethod::Stored } else { CompressionMethod::Deflated };
        let options = SimpleFileOptions::default().compression_method(method);
        writer.start_file(*name, options).map_err(|error| format!("创建压缩文件失败：{}", error))?;
        writer.write_all(content.as_bytes()).map_err(|error| format!("写入压缩文件失败：{}", error))?;
    }
    for (name, content) in binary {
        let method = if stored.iter().any(|item| item == name) { CompressionMethod::Stored } else { CompressionMethod::Deflated };
        let options = SimpleFileOptions::default().compression_method(method);
        writer.start_file(*name, options).map_err(|error| format!("创建压缩文件失败：{}", error))?;
        writer.write_all(content).map_err(|error| format!("写入压缩文件失败：{}", error))?;
    }
    writer.finish().map(|cursor| cursor.into_inner()).map_err(|error| format!("完成压缩文件失败：{}", error))
}

#[derive(Debug, Clone)]
struct ExportCover {
    file_name: String,
    mime_type: String,
    bytes: Vec<u8>,
    data_uri: String,
}

fn export_base64(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = String::new();
    let mut index = 0;
    while index < bytes.len() {
        let first = bytes[index] as u32;
        let second = bytes.get(index + 1).copied().unwrap_or(0) as u32;
        let third = bytes.get(index + 2).copied().unwrap_or(0) as u32;
        let combined = (first << 16) | (second << 8) | third;
        result.push(ALPHABET[((combined >> 18) & 63) as usize] as char);
        result.push(ALPHABET[((combined >> 12) & 63) as usize] as char);
        result.push(if index + 1 < bytes.len() { ALPHABET[((combined >> 6) & 63) as usize] as char } else { '=' });
        result.push(if index + 2 < bytes.len() { ALPHABET[(combined & 63) as usize] as char } else { '=' });
        index += 3;
    }
    result
}

fn export_cover(root: &Path, path: Option<&str>) -> Result<Option<ExportCover>, String> {
    let Some(path) = path else { return Ok(None); };
    let absolute = storage::safe_relative(root, path)?;
    if !absolute.is_file() { return Err("封面文件不存在".to_string()); }
    let extension = absolute.extension().and_then(|value| value.to_str()).unwrap_or("").to_lowercase();
    let mime_type = match extension.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        _ => return Err("封面必须是 jpg、png、gif、webp 或 svg 图片".to_string()),
    }.to_string();

    let bytes = fs::read(&absolute).map_err(|error| format!("读取封面失败：{}", error))?;
    let file_name = format!("cover.{}", if extension.is_empty() { "bin" } else { extension.as_str() });
    let data_uri = format!("data:{};base64,{}", mime_type, export_base64(&bytes));
    Ok(Some(ExportCover { file_name, mime_type, bytes, data_uri }))
}

fn docx_bytes(markdown: &str, cover: Option<&ExportCover>) -> Result<Vec<u8>, String> {
    let document = docx_xml(markdown, cover);
    let numbering = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/></w:lvl></w:abstractNum><w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>"#;
    let cover_default = cover.map(|asset| {
        let extension = asset.file_name.rsplit('.').next().unwrap_or("bin");
        format!("<Default Extension=\"{}\" ContentType=\"{}\"/>", xml_escape(extension), xml_escape(&asset.mime_type))
    }).unwrap_or_default();
    let content_types = format!(r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>{}<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>"#, cover_default);
    let rels = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>"#;
    let document_rels = cover.map(|asset| format!(r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdCover" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/{}"/></Relationships>"#, xml_escape(&asset.file_name)));
    let mut files = vec![("[Content_Types].xml", content_types.as_str()), ("_rels/.rels", rels), ("word/document.xml", document.as_str()), ("word/numbering.xml", numbering)];
    if let Some(document_rels) = document_rels.as_ref() {
        files.push(("word/_rels/document.xml.rels", document_rels.as_str()));
    }
    let cover_name = cover.map(|asset| format!("word/media/{}", asset.file_name));
    let binary = cover.map(|asset| vec![(cover_name.as_deref().unwrap_or("word/media/cover.bin"), asset.bytes.as_slice())]).unwrap_or_default();
    zip_document_with_binary(&files, &binary, &[])
}

fn export_epub_parts(document: &ExportDocument) -> Vec<(String, ExportDocument, String)> {
    let mut groups: Vec<Vec<ExportBlock>> = Vec::new();
    let mut current = Vec::new();
    for block in &document.blocks {
        let split = matches!(block, ExportBlock::Heading { level: 1, .. }) && !current.is_empty();
        if split {
            groups.push(std::mem::take(&mut current));
        }
        current.push(block.clone());
    }
    if !current.is_empty() { groups.push(current); }
    if groups.is_empty() { groups.push(Vec::new()); }
    groups.into_iter().enumerate().map(|(index, blocks)| {
        let label = blocks.iter().find_map(|block| {
            if let ExportBlock::Heading { content, .. } = block { Some(export_plain_inlines(content)) } else { None }
        }).filter(|value| !value.trim().is_empty()).unwrap_or_else(|| format!("第{}章", index + 1));
        (format!("chapter-{:03}.xhtml", index + 1), ExportDocument { blocks }, label)
    }).collect()
}

fn epub_xhtml_document(document: &ExportDocument, cover: Option<&ExportCover>, title: &str) -> String {
    let (body, _) = export_html_fragment(&document, false);
    let cover_markup = cover.map(|asset| format!("<p class=\"cover\"><img src=\"images/{}\" alt=\"封面\" /></p>", xml_escape(&asset.file_name))).unwrap_or_default();
    format!(r#"<?xml version="1.0" encoding="utf-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml"><head><meta charset="utf-8"/><title>{}</title><style>body{{font-family:serif;line-height:1.8;margin:5%;}}h1,h2,h3{{line-height:1.3;}}.cover{{text-align:center}}.cover img{{max-width:100%;max-height:520px}}</style></head><body>{}{}</body></html>"#, xml_escape(title), cover_markup, body)
}

fn epub_bytes(markdown: &str, title: &str, author: &str, cover: Option<&ExportCover>) -> Result<Vec<u8>, String> {
    let document = parse_export_document(markdown);
    let xhtml = epub_xhtml_document(&document, cover, title);
    let parts = export_epub_parts(&document);
    let mut nav_entries = String::new();
    for (file_name, part, label) in &parts {
        let level = part.blocks.iter().find_map(|block| if let ExportBlock::Heading { level, .. } = block { Some(*level) } else { None }).unwrap_or(1);
        nav_entries.push_str(&format!("<li class=\"toc-level-{}\"><a href=\"{}#heading-1\">{}</a></li>", level, xml_escape(file_name), xml_escape(label)));
    }
    if nav_entries.is_empty() {
        nav_entries.push_str(&format!("<li><a href=\"content.xhtml\">{}</a></li>", xml_escape(title)));
    }
    let nav = format!(r#"<?xml version="1.0" encoding="utf-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>{}</title></head><body><nav epub:type="toc" id="toc"><h1>目录</h1><ol>{}</ol></nav></body></html>"#, xml_escape(title), nav_entries);
    let container = r#"<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>"#;
    let cover_manifest = cover.map(|asset| format!("<item id=\"cover-image\" href=\"images/{}\" media-type=\"{}\" properties=\"cover-image\"/>", xml_escape(&asset.file_name), xml_escape(&asset.mime_type))).unwrap_or_default();
    let cover_metadata = cover.map(|_| "<meta name=\"cover\" content=\"cover-image\"/>").unwrap_or_default();
    let part_manifest = parts.iter().enumerate().map(|(index, (file_name, _, _))| format!("<item id=\"chapter-{}\" href=\"{}\" media-type=\"application/xhtml+xml\"/>", index + 1, xml_escape(file_name))).collect::<String>();

    let part_spine = parts.iter().enumerate().map(|(index, _)| format!("<itemref idref=\"chapter-{}\"/>", index + 1)).collect::<String>();
    let opf = format!(r#"<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book-id">novelforge-{}</dc:identifier><dc:title>{}</dc:title><dc:creator>{}</dc:creator><dc:language>zh</dc:language>{}</metadata><manifest><item id="content" href="content.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>{}{}</manifest><spine toc="nav"><itemref idref="nav"/>{}</spine></package>"#, storage::new_id(), xml_escape(title), xml_escape(author), cover_metadata, cover_manifest, part_manifest, part_spine);
    let mut file_storage = vec![
        ("mimetype".to_string(), "application/epub+zip".to_string()),
        ("META-INF/container.xml".to_string(), container.to_string()),
        ("OEBPS/content.opf".to_string(), opf),
        ("OEBPS/nav.xhtml".to_string(), nav),
        ("OEBPS/content.xhtml".to_string(), xhtml),
    ];
    for (file_name, part, _) in &parts {
        file_storage.push(("OEBPS/".to_string() + file_name, epub_xhtml_document(part, cover, title)));
    }
    let files = file_storage.iter().map(|(name, content)| (name.as_str(), content.as_str())).collect::<Vec<_>>();
    let cover_name = cover.map(|asset| format!("OEBPS/images/{}", asset.file_name));
    let binary = cover.map(|asset| vec![(cover_name.as_deref().unwrap_or("OEBPS/images/cover.bin"), asset.bytes.as_slice())]).unwrap_or_default();
    zip_document_with_binary(&files, &binary, &["mimetype"])
}

fn html_bytes(markdown: &str, title: &str, author: &str, include_toc: bool, cover: Option<&ExportCover>) -> Vec<u8> {
    let document = parse_export_document(markdown);
    let (body, toc) = export_html_fragment(&document, include_toc);
    let cover = cover
        .map(|asset| format!("<p class=\"cover\"><img src=\"{}\" alt=\"封面\" /></p>", xml_escape(&asset.data_uri)))
        .unwrap_or_default();
    let toc_html = if include_toc {
        format!("<nav class=\"toc\"><h2>目录</h2><ol>{}</ol></nav>", toc)
    } else {
        String::new()
    };
    format!(
        "<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\"><meta name=\"author\" content=\"{}\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>{}</title><style>body{{font-family:serif;line-height:1.9;max-width:860px;margin:40px auto;padding:0 24px;color:#27211e}}h1{{margin-bottom:4px}}.author{{color:#756b64}}.toc{{padding:16px 20px;background:#f7f3ef;border-radius:8px}}.toc-level-2{{margin-left:16px}}.toc-level-3{{margin-left:32px}}.cover{{text-align:center}}.cover img{{max-width:100%;max-height:520px}}</style></head><body><header><h1>{}</h1><p class=\"author\">作者：{}</p></header>{}{}<main>{}</main></body></html>",
        xml_escape(author), xml_escape(title), xml_escape(title), xml_escape(author), cover, toc_html, body
    ).into_bytes()
}

fn pdf_hex_text(value: &str) -> String {
    value.encode_utf16().map(|unit| format!("{:04X}", unit)).collect()
}

fn pdf_plain_text(markdown: &str) -> String {
    export_plain_text(&parse_export_document(markdown))
}

fn pdf_jpeg_dimensions(bytes: &[u8]) -> Option<(u16, u16)> {
    if bytes.len() < 4 || bytes[0] != 0xFF || bytes[1] != 0xD8 { return None; }
    let mut index = 2;
    while index + 9 < bytes.len() {
        if bytes[index] != 0xFF { index += 1; continue; }
        while index < bytes.len() && bytes[index] == 0xFF { index += 1; }
        if index >= bytes.len() { break; }
        let marker = bytes[index];
        index += 1;
        if marker == 0xD9 || marker == 0xDA { break; }
        if index + 1 >= bytes.len() { break; }
        let length = u16::from_be_bytes([bytes[index], bytes[index + 1]]) as usize;
        if length < 2 || index + length > bytes.len() { break; }
        if (0xC0..=0xC3).contains(&marker) || (0xC5..=0xC7).contains(&marker) || (0xC9..=0xCB).contains(&marker) || (0xCD..=0xCF).contains(&marker) {
            if length >= 7 {
                let height = u16::from_be_bytes([bytes[index + 3], bytes[index + 4]]);
                let width = u16::from_be_bytes([bytes[index + 5], bytes[index + 6]]);
                return Some((width, height));
            }
        }
        index += length;
    }
    None
}

fn pdf_hex_bytes(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{:02X}", byte)).collect()
}

fn pdf_bytes_legacy(text: &str, cover: Option<&ExportCover>) -> Vec<u8> {
    let jpeg = cover.and_then(|asset| pdf_jpeg_dimensions(&asset.bytes).map(|dimensions| (dimensions, asset)));
    let mut lines = Vec::new();
    for source in text.lines() {
        let mut current = String::new();
        for character in source.chars() {
            current.push(character);
            if current.chars().count() >= 92 { lines.push(std::mem::take(&mut current)); }
        }
        lines.push(current);
    }
    let mut page_lines = Vec::new();
    for chunk in lines.chunks(48) { page_lines.push(chunk.to_vec()); }
    if page_lines.is_empty() { page_lines.push(Vec::new()); }
    let mut objects = vec![String::new(), String::new()];
    let mut page_refs = Vec::new();
    for (page_index, chunk) in page_lines.into_iter().enumerate() {
        let page_number = objects.len() + 1;
        let content_number = page_number + 1;
        let mut stream = if page_index == 0 && jpeg.is_some() {
            String::from("q\n400 0 0 500 100 220 cm\n/Im1 Do\nQ\nBT\n/F1 11 Tf\n50 790 Td\n")
        } else {
            String::from("BT\n/F1 11 Tf\n50 790 Td\n")
        };
        for (index, line) in chunk.iter().enumerate() {
            if index > 0 { stream.push_str("0 -15 Td\n"); }
            stream.push_str(&format!("<{}> Tj\n", pdf_hex_text(line)));
        }
        stream.push_str("ET\n");
        let image_resources = if jpeg.is_some() { " /XObject << /Im1 IMGREF >>" } else { "" };
        objects.push(format!("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 FONTREF >>{} >> /Contents {} 0 R >>", image_resources, content_number));
        objects.push(format!("<< /Length {} >>\nstream\n{}endstream", stream.as_bytes().len(), stream));
        page_refs.push(format!("{} 0 R", page_number));
    }
    let font_number = objects.len() + 1;
    let descendant_number = font_number + 1;
    let image_number = jpeg.as_ref().map(|_| descendant_number + 1);
    objects.push("<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [DESCREF] >>".to_string());
    objects.push("<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 4 >> /DW 1000 >>".to_string());
    if let Some((dimensions, asset)) = jpeg {

        let encoded = pdf_hex_bytes(&asset.bytes);
        objects.push(format!("<< /Type /XObject /Subtype /Image /Width {} /Height {} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter [/ASCIIHexDecode /DCTDecode] /Length {} >>\nstream\n{}>\nendstream", dimensions.0, dimensions.1, encoded.len() + 1, encoded));
    }
    objects[0] = "<< /Type /Catalog /Pages 2 0 R >>".to_string();
    objects[1] = format!("<< /Type /Pages /Kids [{}] /Count {} >>", page_refs.join(" "), page_refs.len());
    let mut pdf = b"%PDF-1.4\n%\xE2\xE3\xCF\xD3\n".to_vec();
    let mut offsets = Vec::new();
    for (index, object) in objects.iter().enumerate() {
        offsets.push(pdf.len());
        let number = index + 1;
        let image_reference = image_number.map(|number| format!("{} 0 R", number)).unwrap_or_default();
        pdf.extend_from_slice(format!("{} 0 obj\n{}\nendobj\n", number, object.replace("FONTREF", &format!("{} 0 R", font_number)).replace("DESCREF", &format!("{} 0 R", descendant_number)).replace("IMGREF", &image_reference)).as_bytes());
    }
    let xref = pdf.len();
    pdf.extend_from_slice(format!("xref\n0 {}\n0000000000 65535 f \n", objects.len() + 1).as_bytes());
    for offset in offsets { pdf.extend_from_slice(format!("{:010} 00000 n \n", offset).as_bytes()); }
    pdf.extend_from_slice(format!("trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{}\n%%EOF\n", objects.len() + 1, xref).as_bytes());
    pdf
}

static PDF_FONT: OnceLock<Option<ParsedFont>> = OnceLock::new();

fn pdf_font_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(path) = std::env::var_os("NOVELFORGE_PDF_FONT") {
        candidates.push(PathBuf::from(path));
    }
    #[cfg(windows)]
    {
        candidates.extend([
            PathBuf::from(r"C:\Windows\Fonts\simhei.ttf"),
            PathBuf::from(r"C:\Windows\Fonts\Deng.ttf"),
            PathBuf::from(r"C:\Windows\Fonts\NotoSansSC-VF.ttf"),
            PathBuf::from(r"C:\Windows\Fonts\NotoSerifSC-VF.ttf"),
            PathBuf::from(r"C:\Windows\Fonts\simsun.ttc"),
        ]);
    }
    #[cfg(not(windows))]
    {
        candidates.extend([
            PathBuf::from("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"),
            PathBuf::from("/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc"),
            PathBuf::from("/usr/share/fonts/opentype/noto/NotoSansSC-Regular.otf"),
        ]);
    }
    candidates
}

fn load_pdf_font() -> Option<ParsedFont> {
    for path in pdf_font_candidates() {
        let Ok(bytes) = fs::read(&path) else { continue };
        let mut warnings = Vec::new();
        let Some(font) = ParsedFont::from_bytes(&bytes, 0, &mut warnings) else { continue };
        let has_cjk = font.lookup_glyph_index('中' as u32).is_some()
            || font.lookup_glyph_index('雾' as u32).is_some()
            || font.lookup_glyph_index('测' as u32).is_some();
        if has_cjk {
            return Some(font);
        }
    }
    None
}

fn shared_pdf_font() -> Option<&'static ParsedFont> {
    PDF_FONT.get_or_init(load_pdf_font).as_ref()
}

fn pdf_text_lines(text: &str) -> Vec<String> {
    let mut lines = Vec::new();
    for source in text.lines() {
        let mut current = String::new();
        for character in source.chars() {
            current.push(character);
            if current.chars().count() >= 92 {
                lines.push(std::mem::take(&mut current));
            }
        }
        lines.push(current);
    }
    if lines.is_empty() {
        lines.push(String::new());
    }
    lines
}

fn pdf_bytes_embedded(text: &str, cover: Option<&ExportCover>, font: &ParsedFont) -> Vec<u8> {
    let mut document = PdfDocument::new("NovelForge");
    let font_id = document.add_font(font);
    let mut image_warnings = Vec::new();
    let cover_image = cover.and_then(|asset| RawImage::decode_from_bytes(&asset.bytes, &mut image_warnings).ok());
    let cover_id = cover_image.as_ref().map(|image| document.add_image(image));
    let lines = pdf_text_lines(text);
    let chunks: Vec<Vec<String>> = lines.chunks(48).map(|chunk| chunk.to_vec()).collect();
    let mut pages = Vec::new();
    for (page_index, chunk) in chunks.iter().enumerate() {
        let mut operations = Vec::new();
        if page_index == 0 {
            if let (Some(image), Some(image_id)) = (cover_image.as_ref(), cover_id.as_ref()) {
                let width_pt = image.width.max(1) as f32 * 72.0 / 96.0;
                let height_pt = image.height.max(1) as f32 * 72.0 / 96.0;
                let scale = (120.0 / width_pt).min(180.0 / height_pt);
                operations.push(Op::UseXobject {
                    id: image_id.clone(),
                    transform: XObjectTransform {
                        translate_x: Some(Pt(400.0)),
                        translate_y: Some(Pt((842.0 - 60.0 - height_pt * scale).max(20.0))),
                        scale_x: Some(scale),
                        scale_y: Some(scale),
                        dpi: Some(96.0),
                        ..Default::default()
                    },
                });
            }
        }
        operations.push(Op::StartTextSection);
        operations.push(Op::SetFont { font: PdfFontHandle::External(font_id.clone()), size: Pt(11.0) });
        operations.push(Op::SetLineHeight { lh: Pt(15.0) });
        operations.push(Op::SetTextCursor { pos: Point::new(Pt(50.0).into(), Pt(790.0).into()) });
        for (line_index, line) in chunk.iter().enumerate() {
            if line_index > 0 {
                operations.push(Op::AddLineBreak);
            }
            operations.push(Op::ShowText { items: vec![TextItem::Text(line.clone())] });
        }
        operations.push(Op::EndTextSection);
        pages.push(PdfPage::new(Mm(210.0), Mm(297.0), operations));
    }
    let mut save_warnings = Vec::new();
    let mut bytes = document.with_pages(pages).save(&PdfSaveOptions::default(), &mut save_warnings);
    if bytes.starts_with(b"%PDF-1.3") {
        bytes[7] = b'4';
    }
    bytes
}

fn pdf_bytes(text: &str, cover: Option<&ExportCover>) -> Vec<u8> {
    shared_pdf_font()
        .map(|font| pdf_bytes_embedded(text, cover, font))
        .unwrap_or_else(|| pdf_bytes_legacy(text, cover))
}

#[tauri::command]
pub fn export_project(input: ExportInput) -> Result<String, String> {
    let (root, connection) = project_connection(&input.project_path)?;
    let format = match input.format.as_str() {
        "markdown" | "txt" | "html" | "docx" | "epub" | "pdf" => input.format.as_str(),
        _ => return Err(format!("不支持的导出格式：{}", input.format)),
    };
    let metadata = storage::read_project_json(&root)?;
    let nodes = storage::all_nodes(&connection, false)?;
    let nodes = export_scope_nodes(&nodes, &input)?;
    let title = input
        .title
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(metadata.title.as_str())
        .to_string();
    let author = input
        .author

        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(metadata.author.as_str())
        .to_string();
    let options = ExportRenderOptions {
        include_volume_titles: input.include_volume_titles.unwrap_or(true),
        include_chapter_titles: input.include_chapter_titles.unwrap_or(true),
    };
    let cover = export_cover(&root, input.cover_path.as_deref())?;
    let mut markdown = String::new();
    export_nodes(&root, &nodes, None, 1, "markdown", &mut markdown, &options);
    let toc = if input.include_toc.unwrap_or(true) {
        let entries = nodes
            .iter()
            .filter(|node| node.kind != "section" || options.include_chapter_titles)
            .map(|node| format!("- {}", node.title))
            .collect::<Vec<_>>();
        if entries.is_empty() { String::new() } else { format!("## 目录\n\n{}\n\n", entries.join("\n")) }
    } else {
        String::new()
    };
    let markdown_document = format!("# {}\n\n作者：{}\n\n{}{}", title, author, toc, markdown);
    let txt_document = parse_export_document(&format!("# {}\n\n作者：{}\n\n{}", title, author, markdown));
    let output = if format == "markdown" {
        markdown_document.clone()
    } else if format == "txt" {
        export_plain_text(&txt_document)
    } else {
        String::new()
    };
    let (extension, bytes) = match format {
        "markdown" | "txt" => (format.to_string(), output.into_bytes()),
        "html" => ("html".to_string(), html_bytes(&markdown, &title, &author, input.include_toc.unwrap_or(true), cover.as_ref())),
        "docx" => ("docx".to_string(), docx_bytes(&markdown_document, cover.as_ref())?),
        "epub" => ("epub".to_string(), epub_bytes(&markdown_document, &title, &author, cover.as_ref())?),
        "pdf" => ("pdf".to_string(), pdf_bytes(&pdf_plain_text(&format!("{}\n作者：{}\n\n{}", title, author, markdown)), cover.as_ref())),
        _ => unreachable!(),
    };
    let filename = format!(
        "{}-{}.{}",
        safe_filename(&metadata.title),
        Utc::now().format("%Y%m%d%H%M%S%3f"),
        extension
    );
    let relative = format!(".novelforge/exports/{}", filename);
    let target = storage::safe_relative(&root, &relative)?;
    storage::atomic_write(&target, &bytes)?;
    let _ = storage::append_log(&root, "INFO", "export_created");
    Ok(target.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn footnotes_survive_all_text_renderers() {
        let markdown = "正文[^1] 与正文[^note]。\n\n[^1]: 中文脚注\n[^note]: 命名脚注";
        let document = parse_export_document(markdown);
        let plain = export_plain_text(&document);
        assert!(plain.contains("[1]"));
        assert!(plain.contains("[^note]: 命名脚注"));
        let (html, _) = export_html_fragment(&document, false);
        assert!(html.contains("href=\"#fn-1\""));
        assert!(html.contains("中文脚注"));
        let docx = export_docx_xml_from_document(&document, None);
        assert!(docx.contains("[^1]:"));
        assert!(docx.contains("命名脚注"));
    }

    #[test]
    fn invalid_footnote_syntax_remains_text() {
        let document = parse_export_document("这不是脚注[^]，也不是[^ bad]。");
        let plain = export_plain_text(&document);
        assert!(plain.contains("[^]"));
        assert!(plain.contains("bad"));
    }

    #[test]
    fn html_export_filters_unsafe_urls_and_preserves_safe_links() {
        let document = parse_export_document(
            "[危险](javascript:evil)\n\n![本地机密](file:///tmp/secret.png)\n\n[官网](https://example.com)\n\n![封面](data:image/png;base64,AA==)",
        );
        let (html, _) = export_html_fragment(&document, false);
        assert!(!html.contains("javascript:"));
        assert!(!html.contains("file:///"));
        assert!(html.contains("危险"));
        assert!(html.contains("本地机密"));
        assert!(html.contains("href=\"https://example.com\" rel=\"noopener noreferrer\""));
        assert!(html.contains("src=\"data:image/png;base64,AA==\""));
    }
}
