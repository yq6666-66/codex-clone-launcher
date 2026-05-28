use crate::models::codex::CodexAccount;
use crate::modules::{codex_account, codex_oauth, logger};
use tauri::{AppHandle, Emitter};

#[tauri::command]
pub fn list_codex_accounts() -> Result<Vec<CodexAccount>, String> {
    codex_account::list_accounts_checked()
}

#[tauri::command]
pub async fn codex_oauth_login_start(
    app_handle: AppHandle,
) -> Result<codex_oauth::CodexOAuthLoginStartResponse, String> {
    logger::log_info("Codex OAuth start requested from minimal launcher");
    codex_oauth::start_oauth_login(app_handle).await
}

#[tauri::command]
pub async fn codex_oauth_login_completed(login_id: String) -> Result<CodexAccount, String> {
    logger::log_info(&format!(
        "Codex OAuth complete requested from minimal launcher: login_id={}",
        login_id
    ));

    let tokens = codex_oauth::complete_oauth_login(&login_id).await?;
    let account = codex_account::upsert_account(tokens)?;
    codex_account::load_account(&account.id).ok_or_else(|| "账号保存后无法读取".to_string())
}

#[tauri::command]
pub fn codex_oauth_login_cancel(login_id: Option<String>) -> Result<(), String> {
    codex_oauth::cancel_oauth_flow_for(login_id.as_deref())
}

#[tauri::command]
pub fn codex_oauth_submit_callback_url(
    app_handle: AppHandle,
    login_id: String,
    callback_url: String,
) -> Result<(), String> {
    codex_oauth::submit_callback_url(login_id.as_str(), callback_url.as_str())?;
    let _ = app_handle.emit(
        "codex-oauth-login-completed",
        serde_json::json!({ "loginId": login_id }),
    );
    Ok(())
}
