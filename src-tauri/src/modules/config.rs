use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::{OnceLock, RwLock};

const USER_CONFIG_FILE: &str = "config.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserConfig {
    #[serde(default)]
    pub codex_app_path: String,
    #[serde(default)]
    pub global_proxy_enabled: bool,
    #[serde(default)]
    pub global_proxy_url: String,
    #[serde(default)]
    pub global_proxy_no_proxy: String,
    #[serde(default)]
    pub codex_auto_switch_enabled: bool,
    #[serde(default = "default_codex_auto_switch_primary_threshold")]
    pub codex_auto_switch_primary_threshold: i32,
    #[serde(default = "default_codex_auto_switch_secondary_threshold")]
    pub codex_auto_switch_secondary_threshold: i32,
    #[serde(default = "default_codex_auto_switch_account_scope_mode")]
    pub codex_auto_switch_account_scope_mode: String,
    #[serde(default)]
    pub codex_auto_switch_selected_account_ids: Vec<String>,
    #[serde(default)]
    pub codex_quota_alert_enabled: bool,
    #[serde(default = "default_codex_quota_alert_threshold")]
    pub codex_quota_alert_threshold: i32,
    #[serde(default = "default_codex_quota_alert_primary_threshold")]
    pub codex_quota_alert_primary_threshold: i32,
    #[serde(default = "default_codex_quota_alert_secondary_threshold")]
    pub codex_quota_alert_secondary_threshold: i32,
}

impl Default for UserConfig {
    fn default() -> Self {
        Self {
            codex_app_path: String::new(),
            global_proxy_enabled: false,
            global_proxy_url: String::new(),
            global_proxy_no_proxy: String::new(),
            codex_auto_switch_enabled: false,
            codex_auto_switch_primary_threshold: default_codex_auto_switch_primary_threshold(),
            codex_auto_switch_secondary_threshold: default_codex_auto_switch_secondary_threshold(),
            codex_auto_switch_account_scope_mode: default_codex_auto_switch_account_scope_mode(),
            codex_auto_switch_selected_account_ids: Vec::new(),
            codex_quota_alert_enabled: false,
            codex_quota_alert_threshold: default_codex_quota_alert_threshold(),
            codex_quota_alert_primary_threshold: default_codex_quota_alert_primary_threshold(),
            codex_quota_alert_secondary_threshold: default_codex_quota_alert_secondary_threshold(),
        }
    }
}

#[derive(Debug, Clone)]
struct ConfigState {
    user_config: UserConfig,
}

static CONFIG_STATE: OnceLock<RwLock<ConfigState>> = OnceLock::new();

fn default_codex_auto_switch_primary_threshold() -> i32 {
    10
}

fn default_codex_auto_switch_secondary_threshold() -> i32 {
    10
}

fn default_codex_auto_switch_account_scope_mode() -> String {
    "all_accounts".to_string()
}

fn default_codex_quota_alert_threshold() -> i32 {
    10
}

fn default_codex_quota_alert_primary_threshold() -> i32 {
    10
}

fn default_codex_quota_alert_secondary_threshold() -> i32 {
    10
}

fn user_config_path() -> Result<PathBuf, String> {
    Ok(crate::modules::account::get_data_dir()?.join(USER_CONFIG_FILE))
}

fn load_user_config_from_disk() -> UserConfig {
    let Ok(path) = user_config_path() else {
        return UserConfig::default();
    };
    let Ok(content) = fs::read_to_string(path) else {
        return UserConfig::default();
    };
    serde_json::from_str::<UserConfig>(&content).unwrap_or_default()
}

fn state() -> &'static RwLock<ConfigState> {
    CONFIG_STATE.get_or_init(|| {
        let config = load_user_config_from_disk();
        sync_global_proxy_env(&config);
        RwLock::new(ConfigState {
            user_config: config,
        })
    })
}

pub fn get_user_config() -> UserConfig {
    state()
        .read()
        .map(|state| state.user_config.clone())
        .unwrap_or_default()
}

pub fn save_user_config(config: &UserConfig) -> Result<(), String> {
    let path = user_config_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("创建配置目录失败: {}", error))?;
    }
    let content = serde_json::to_string_pretty(config)
        .map_err(|error| format!("序列化配置失败: {}", error))?;
    fs::write(&path, format!("{}\n", content))
        .map_err(|error| format!("保存配置失败: {}", error))?;
    sync_global_proxy_env(config);

    if let Ok(mut state) = state().write() {
        state.user_config = config.clone();
    }
    Ok(())
}

const MANAGED_PROXY_KEYS: [&str; 6] = [
    "http_proxy",
    "https_proxy",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "all_proxy",
    "ALL_PROXY",
];

const MANAGED_NO_PROXY_KEYS: [&str; 2] = ["no_proxy", "NO_PROXY"];

pub fn sync_global_proxy_env(config: &UserConfig) {
    for key in MANAGED_PROXY_KEYS {
        std::env::remove_var(key);
    }
    for key in MANAGED_NO_PROXY_KEYS {
        std::env::remove_var(key);
    }

    if !config.global_proxy_enabled {
        return;
    }
    let proxy_url = config.global_proxy_url.trim();
    if proxy_url.is_empty() {
        return;
    }
    for key in MANAGED_PROXY_KEYS {
        std::env::set_var(key, proxy_url);
    }
    let no_proxy =
        crate::modules::codex_protocol::merge_local_no_proxy(config.global_proxy_no_proxy.trim());
    if !no_proxy.is_empty() {
        for key in MANAGED_NO_PROXY_KEYS {
            std::env::set_var(key, &no_proxy);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codex_defaults_are_conservative() {
        let cfg = UserConfig::default();
        assert!(!cfg.codex_auto_switch_enabled);
        assert!(!cfg.codex_quota_alert_enabled);
        assert_eq!(cfg.codex_auto_switch_account_scope_mode, "all_accounts");
    }
}
