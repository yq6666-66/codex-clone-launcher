mod commands;
pub mod error;
mod models;
mod modules;
mod utils;

use std::sync::OnceLock;
use tauri::Manager;

static APP_HANDLE: OnceLock<tauri::AppHandle> = OnceLock::new();

pub fn get_app_handle() -> Option<&'static tauri::AppHandle> {
    APP_HANDLE.get()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    modules::logger::init_logger();
    let _ = modules::config::get_user_config();

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .setup(|app| {
            let _ = APP_HANDLE.set(app.handle().clone());
            modules::logger::log_info("[Startup] Minimal Codex clone launcher started");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::system::get_general_config,
            commands::system::set_app_path,
            commands::system::detect_app_path,
            commands::codex::list_codex_accounts,
            commands::codex::codex_oauth_login_start,
            commands::codex::codex_oauth_login_completed,
            commands::codex::codex_oauth_login_cancel,
            commands::codex::codex_oauth_submit_callback_url,
            commands::codex_instance::codex_create_clone_and_launch,
            commands::codex_instance::codex_history_repair,
            commands::codex_instance::codex_history_status,
            commands::codex_instance::codex_history_sync,
            commands::codex_instance::codex_history_verify,
            commands::codex_instance::codex_list_instances,
            commands::codex_instance::codex_start_instance,
            commands::codex_instance::codex_stop_instance,
            commands::codex_instance::codex_delete_instance,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|_app_handle, _event| {});
}
