mod commands;
mod models;

#[path = "storage/mod.rs"]
mod storage_impl;

#[tauri::command]
async fn confirm_window_close(window: tauri::WebviewWindow) -> Result<(), String> {
    use tauri::Manager;
    let app = window.app_handle().clone();
    let label = window.label().to_owned();
    tauri::async_runtime::spawn_blocking(move || commands::codex::shutdown(&app, &label))
        .await
        .map_err(|_| "无法清理 Codex 子进程")?;
    window
        .destroy()
        .map_err(|error| format!("关闭窗口失败：{error}"))
}

pub fn run() {
    let builder = tauri::Builder::default()
        .manage(commands::codex::CodexState::default())
        .setup(|app| {
            tauri::WebviewWindowBuilder::from_config(app, &app.config().app.windows[0])?
                .on_navigation(commands::navigation::workspace_navigation_allowed)
                .build()?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                use tauri::Emitter;
                api.prevent_close();
                let _ = window.emit("novelforge:request-close", ());
            }
            if matches!(event, tauri::WindowEvent::Destroyed) {
                commands::codex::close(window);
            }
        })
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            confirm_window_close,
            commands::updates::check_updates,
            commands::guard::save_document_checked,
            commands::guard::release_project,
            commands::backup::backup_project,
            commands::backup::validate_backup,
            commands::backup::restore_backup,
            commands::navigation::open_external_url,
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
            commands::recovery::create_history_snapshot,
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
            commands::ai::ai_cancel,
            commands::codex::codex_status,
            commands::codex::codex_models,
            commands::codex::codex_login,
            commands::codex::codex_generate,
            commands::codex::codex_cancel,
            commands::codex::codex_check_cancel,
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
