mod commands;
pub mod error;
mod models;
mod modules;
mod utils;

use std::sync::OnceLock;
use std::time::{Duration, Instant};
use tauri::{Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

static APP_HANDLE: OnceLock<tauri::AppHandle> = OnceLock::new();
const APP_TITLE: &str = "Codex \u{5206}\u{8eab}\u{542f}\u{52a8}\u{5668}";

pub fn get_app_handle() -> Option<&'static tauri::AppHandle> {
    APP_HANDLE.get()
}

fn ensure_main_window(app: &tauri::App) -> Option<WebviewWindow> {
    if let Some(window) = app.get_webview_window("main") {
        return Some(window);
    }

    match WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
        .title(APP_TITLE)
        .inner_size(1220.0, 780.0)
        .min_inner_size(960.0, 640.0)
        .center()
        .resizable(true)
        .visible(true)
        .build()
    {
        Ok(window) => {
            modules::logger::log_warn(
                "[Window] main window was not created from config; built fallback window",
            );
            Some(window)
        }
        Err(error) => {
            modules::logger::log_error(&format!(
                "[Window] failed to build fallback main window: {}",
                error
            ));
            None
        }
    }
}

fn reveal_main_window(window: &WebviewWindow) {
    let _ = window.set_title(APP_TITLE);
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_always_on_top(true);
    let _ = window.set_focus();

    let window = window.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(900));
        let _ = window.set_always_on_top(false);
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    modules::logger::init_logger();
    let _ = modules::config::get_user_config();
    let startup_at = Instant::now();

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                reveal_main_window(&window);
            } else {
                modules::logger::log_warn("[Window] single-instance activation had no main window to focus");
            }
        }))
        .setup(move |app| {
            let _ = APP_HANDLE.set(app.handle().clone());
            if let Some(window) = ensure_main_window(app) {
                reveal_main_window(&window);
                let window_for_event = window.clone();
                window.on_window_event(move |event| match event {
                    tauri::WindowEvent::CloseRequested { api, .. }
                        if startup_at.elapsed() < Duration::from_secs(120) =>
                    {
                        modules::logger::log_warn(
                            "[Window] main close requested during startup; keeping launcher visible",
                        );
                        api.prevent_close();
                        reveal_main_window(&window_for_event);
                    }
                    tauri::WindowEvent::CloseRequested { .. } => {
                        modules::logger::log_info("[Window] main close requested");
                    }
                    tauri::WindowEvent::Destroyed => {
                        modules::logger::log_warn("[Window] main window destroyed");
                    }
                    _ => {}
                });
            } else {
                modules::logger::log_warn("[Window] main window was not available during setup");
            }
            modules::logger::log_info("[Startup] Minimal Codex clone launcher started");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::system::get_general_config,
            commands::system::get_diagnostics_snapshot,
            commands::system::set_app_path,
            commands::system::detect_app_path,
            commands::system::detect_tool_directory,
            commands::codex::list_codex_accounts,
            commands::codex::codex_oauth_login_start,
            commands::codex::codex_oauth_login_completed,
            commands::codex::codex_oauth_login_cancel,
            commands::codex::codex_oauth_submit_callback_url,
            commands::codex_instance::codex_create_clone_and_launch,
            commands::codex_instance::codex_fetch_provider_models,
            commands::codex_instance::codex_test_provider_connection,
            commands::codex_instance::codex_apply_sync_package_to_instance,
            commands::codex_instance::codex_extract_sync_package,
            commands::codex_instance::codex_export_clone_capability_snapshot,
            commands::codex_instance::codex_update_clone_capabilities,
            commands::codex_instance::codex_history_repair,
            commands::codex_instance::codex_history_status,
            commands::codex_instance::codex_history_sync,
            commands::codex_instance::codex_history_verify,
            commands::codex_instance::codex_export_recent_sessions_markdown,
            commands::codex_instance::codex_list_recent_sessions,
            commands::codex_instance::codex_scan_session_usage,
            commands::codex_instance::codex_open_instance_in_zed,
            commands::codex_instance::codex_list_instances,
            commands::codex_instance::codex_restore_sync_package_backup,
            commands::codex_instance::codex_sync_package_backups,
            commands::codex_instance::codex_sync_package_preflight,
            commands::codex_instance::codex_sync_package_status,
            commands::codex_instance::codex_start_instance,
            commands::codex_instance::codex_stop_instance,
            commands::codex_instance::codex_delete_instance,
            commands::git_worktree::codex_git_worktree_defaults,
            commands::git_worktree::codex_create_upstream_worktree,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|_app_handle, _event| {});
}
