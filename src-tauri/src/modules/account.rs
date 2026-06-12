use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

const DATA_DIR: &str = ".codex_clone_launcher";
const DEV_DATA_DIR: &str = ".codex_clone_launcher_dev";
const DATA_DIR_ENV: &str = "CODEX_CLONE_DATA_DIR";
const PROFILE_ENV: &str = "CODEX_CLONE_PROFILE";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuotaAlertPayload {
    pub platform: String,
    pub current_account_id: String,
    pub current_email: String,
    pub threshold: i32,
    pub threshold_display: Option<String>,
    pub lowest_percentage: i32,
    pub low_models: Vec<String>,
    pub recommended_account_id: Option<String>,
    pub recommended_email: Option<String>,
    pub triggered_at: i64,
}

pub fn is_dev_profile() -> bool {
    std::env::var(PROFILE_ENV)
        .map(|value| value.trim().eq_ignore_ascii_case("dev"))
        .unwrap_or(false)
}

pub fn resolve_data_dir() -> Result<PathBuf, String> {
    if let Ok(raw) = std::env::var(DATA_DIR_ENV) {
        let trimmed = raw.trim();
        if !trimmed.is_empty() {
            return Ok(PathBuf::from(trimmed));
        }
    }

    let home = dirs::home_dir().ok_or("无法获取用户主目录")?;
    Ok(home.join(if is_dev_profile() {
        DEV_DATA_DIR
    } else {
        DATA_DIR
    }))
}

pub fn get_data_dir() -> Result<PathBuf, String> {
    let data_dir = resolve_data_dir()?;
    fs::create_dir_all(&data_dir).map_err(|error| format!("创建数据目录失败: {}", error))?;
    Ok(data_dir)
}

pub fn dispatch_quota_alert(payload: &QuotaAlertPayload) {
    crate::modules::logger::log_info(&format!(
        "[QuotaAlert] skipped in minimal launcher: platform={}, account={}, lowest={}%",
        payload.platform, payload.current_account_id, payload.lowest_percentage
    ));
}
