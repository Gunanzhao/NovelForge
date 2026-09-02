mod commands;
mod models;

#[path = "storage/mod.rs"]
mod storage_impl;

pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::project::create_project,
            commands::project::open_project,
            commands::project::list_documents,
            commands::manuscript::create_node,
            commands::manuscript::rename_node,
            commands::manuscript::set_node_status,
            commands::manuscript::reorder_node,
            commands::manuscript::move_node,
            commands::manuscript::copy_node,
            commands::manuscript::delete_node,
            commands::manuscript::get_document,
            commands::manuscript::save_document,
            commands::recovery::list_recovery,
            commands::recovery::read_recovery,
            commands::recovery::restore_recovery,
            commands::recovery::discard_recovery,
            commands::recovery::list_history,
            commands::recovery::read_history,
            commands::recovery::restore_history,
            commands::entities::upsert_entity,
            commands::entities::import_attachment,
            commands::entities::open_attachment,
            commands::entities::delete_entity,
            commands::entities::list_entities,
            commands::trash::list_trash,
            commands::trash::empty_trash,
            commands::trash::restore_trash,
            commands::trash::permanent_delete,
            commands::search::search_project,
            commands::consistency::check_consistency,
            commands::ai::ai_complete,
            commands::statistics::get_statistics,
            commands::export::export_project,
            commands::project::read_logs,
            commands::project::update_project
        ]);
    if let Err(error) = builder.run(tauri::generate_context!()) {
        eprintln!("NovelForge 启动失败：{error}");
    }
}

#[cfg(test)]
mod rust_tests;
