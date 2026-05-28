use serde::Serialize;

use crate::modules::{config, process};

#[derive(Debug, Clone, Serialize)]
pub struct GeneralConfig {
    pub codex_app_path: String,
}

#[tauri::command]
pub fn get_general_config() -> Result<GeneralConfig, String> {
    let current = config::get_user_config();
    Ok(GeneralConfig {
        codex_app_path: current.codex_app_path,
    })
}

#[tauri::command]
pub fn set_app_path(app: String, path: String) -> Result<(), String> {
    let mut current = config::get_user_config();
    let normalized_path = path.trim().to_string();

    match app.as_str() {
        "codex" => current.codex_app_path = normalized_path,
        _ => return Err("仅支持 Codex 启动路径".to_string()),
    }

    config::save_user_config(&current)
}

#[tauri::command]
pub fn detect_app_path(app: String, force: Option<bool>) -> Result<Option<String>, String> {
    let force = force.unwrap_or(false);
    match app.as_str() {
        "codex" => Ok(process::detect_and_save_app_path("codex", force)),
        _ => Err("仅支持 Codex 路径自动识别".to_string()),
    }
}
