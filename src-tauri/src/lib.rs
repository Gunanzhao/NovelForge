mod commands;
mod models;

mod storage_impl;

pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::create_project,
            commands::open_project,
            commands::list_documents,
            commands::create_node,
            commands::rename_node,
            commands::set_node_status,
            commands::reorder_node,
            commands::delete_node,
            commands::get_document,
            commands::save_document,
            commands::list_recovery,
            commands::read_recovery,
            commands::restore_recovery,
            commands::discard_recovery,
            commands::list_history,
            commands::read_history,
            commands::restore_history,
            commands::upsert_entity,
            commands::import_attachment,
            commands::delete_entity,
            commands::list_entities,
            commands::list_trash,
            commands::restore_trash,
            commands::permanent_delete,
            commands::search_project,
            commands::check_consistency,
            commands::ai_complete,
            commands::get_statistics,
            commands::export_project,
            commands::update_project
        ]);
    if let Err(error) = builder.run(tauri::generate_context!()) {
        eprintln!("NovelForge 启动失败：{error}");
    }
}

#[cfg(test)]
mod rust_tests;
