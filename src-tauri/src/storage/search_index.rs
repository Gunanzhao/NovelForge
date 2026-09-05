use super::*;

pub fn index_record(
    connection: &Connection,
    ref_id: &str,
    kind: &str,
    title: &str,
    content: &str,
    path: &str,
) -> Result<(), String> {
    connection
        .execute(
            "DELETE FROM search_index WHERE ref_id = ?1",
            params![ref_id],
        )
        .map_err(|error| format!("更新搜索索引失败：{}", error))?;
    connection.execute(
        "INSERT INTO search_index (ref_id, kind, title, content, path) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![ref_id, kind, title, content, path],
    ).map_err(|error| format!("写入搜索索引失败：{}", error))?;
    Ok(())
}

pub fn refresh_search_index(root: &Path, connection: &Connection) -> Result<(), String> {
    connection
        .execute("DELETE FROM search_index", [])
        .map_err(|error| format!("清理搜索索引失败：{}", error))?;
    let nodes = all_nodes(connection, false)?;
    for node in nodes.iter().filter(|node| node.kind != "volume") {
        let path = safe_relative(root, &node.file_path)?;
        let content = fs::read_to_string(&path).unwrap_or_default();
        let content = strip_markdown_frontmatter(&content);
        index_record(
            connection,
            &node.id,
            &node.kind,
            &node.title,
            &content,
            &node.file_path,
        )?;
    }
    for entity in all_entities(connection, false)? {
        index_record(
            connection,
            &entity.id,
            &entity.kind,
            &entity.title,
            &entity.content.to_string(),
            &entity.file_path,
        )?;
    }
    Ok(())
}
