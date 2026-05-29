use std::collections::HashSet;
use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};
use toml_edit::{value, Document};

use crate::models::codex::{CodexApiProviderMode, CodexAppSpeed};
use crate::models::{InstanceLaunchMode, InstanceProfile};
use crate::modules;

const DEFAULT_INSTANCE_ID: &str = "__default__";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexInstanceProfileView {
    pub id: String,
    pub name: String,
    pub user_data_dir: String,
    pub working_dir: Option<String>,
    pub extra_args: String,
    pub bind_account_id: Option<String>,
    pub launch_mode: InstanceLaunchMode,
    pub app_speed: CodexAppSpeed,
    pub created_at: i64,
    pub last_launched_at: Option<i64>,
    pub last_pid: Option<u32>,
    pub running: bool,
    pub initialized: bool,
    pub is_default: bool,
    pub follow_local_account: bool,
    pub history_status: Option<modules::codex_history_sync::CodexHistoryStatus>,
}

impl CodexInstanceProfileView {
    fn from_profile(profile: InstanceProfile, running: bool, initialized: bool) -> Self {
        let history_status = if profile.user_data_dir.trim().is_empty() {
            None
        } else {
            let context = modules::codex_history_sync::CodexHistoryContext {
                bound_account_id: profile.bind_account_id.clone(),
            };
            modules::codex_history_sync::status_with_context(
                Path::new(&profile.user_data_dir),
                Some(&context),
            )
            .ok()
        };
        Self {
            id: profile.id,
            name: profile.name,
            user_data_dir: profile.user_data_dir,
            working_dir: profile.working_dir,
            extra_args: profile.extra_args,
            bind_account_id: profile.bind_account_id,
            launch_mode: profile.launch_mode,
            app_speed: profile.app_speed,
            created_at: profile.created_at,
            last_launched_at: profile.last_launched_at,
            last_pid: profile.last_pid,
            running,
            initialized,
            is_default: false,
            follow_local_account: false,
            history_status,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexCloneApiKeyConfig {
    pub api_key: String,
    pub base_url: String,
    pub provider_id: Option<String>,
    pub provider_name: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexCloneCreateInput {
    pub name: String,
    pub auth_type: String,
    pub launch_after_create: Option<bool>,
    pub inherit_local_data: Option<bool>,
    pub model: Option<String>,
    pub working_dir: Option<String>,
    pub api_key_config: Option<CodexCloneApiKeyConfig>,
    pub official_account_id: Option<String>,
}

fn normalize_optional_trimmed(value: Option<String>) -> Option<String> {
    value.and_then(|raw| {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

fn slugify_clone_name(name: &str) -> String {
    let mut slug = String::new();
    let mut previous_separator = false;
    for ch in name.chars() {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch.to_ascii_lowercase());
            previous_separator = false;
        } else if !previous_separator {
            slug.push('-');
            previous_separator = true;
        }
    }
    let trimmed = slug.trim_matches('-').to_string();
    if trimmed.is_empty() {
        "codex-clone".to_string()
    } else {
        trimmed
    }
}

fn resolve_unique_clone_name(raw_name: &str) -> Result<String, String> {
    let base_name = raw_name.trim();
    if base_name.is_empty() {
        return Err("分身名称不能为空".to_string());
    }
    let store = modules::codex_instance::load_instance_store()?;
    let used_names: HashSet<String> = store
        .instances
        .iter()
        .map(|instance| instance.name.trim().to_ascii_lowercase())
        .collect();
    if !used_names.contains(&base_name.to_ascii_lowercase()) {
        return Ok(base_name.to_string());
    }
    for index in 2..1000 {
        let candidate = format!("{} {}", base_name, index);
        if !used_names.contains(&candidate.to_ascii_lowercase()) {
            return Ok(candidate);
        }
    }
    Err("无法生成唯一分身名称".to_string())
}

fn resolve_unique_clone_user_data_dir(name: &str) -> Result<String, String> {
    let root = modules::codex_instance::get_default_instances_root_dir()?;
    let store = modules::codex_instance::load_instance_store()?;
    let used_dirs: HashSet<String> = store
        .instances
        .iter()
        .map(|instance| instance.user_data_dir.trim().to_ascii_lowercase())
        .collect();
    let slug = slugify_clone_name(name);
    for index in 0..1000 {
        let dir_name = if index == 0 {
            slug.clone()
        } else {
            format!("{}-{}", slug, index + 1)
        };
        let candidate = root.join(dir_name);
        let candidate_string = candidate.to_string_lossy().to_string();
        if !candidate.exists() && !used_dirs.contains(&candidate_string.to_ascii_lowercase()) {
            return Ok(candidate_string);
        }
    }
    Err("无法生成唯一分身目录".to_string())
}

fn write_clone_model_to_config(profile_dir: &Path, model: Option<&str>) -> Result<(), String> {
    let Some(model) = model.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(());
    };
    let config_path = profile_dir.join("config.toml");
    let existing = fs::read_to_string(&config_path).unwrap_or_default();
    let mut doc = if existing.trim().is_empty() {
        Document::new()
    } else {
        existing
            .parse::<Document>()
            .map_err(|e| format!("解析 config.toml 失败: {}", e))?
    };
    doc["model"] = value(model);
    #[cfg(target_os = "windows")]
    {
        if doc.get("windows").is_none() {
            doc["windows"] = toml_edit::table();
        }
        if let Some(windows_table) = doc["windows"].as_table_mut() {
            windows_table["sandbox"] = value("unelevated");
        }
    }
    if let Some(parent) = config_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建 config.toml 目录失败: {}", e))?;
    }
    let content = doc.to_string();
    modules::atomic_write::write_string_atomic(&config_path, &content)
        .map_err(|e| format!("写入 config.toml 失败: {}", e))
}

fn resolve_clone_account_id(input: &CodexCloneCreateInput) -> Result<String, String> {
    match input.auth_type.trim() {
        "apiKey" | "api_key" => {
            let config = input
                .api_key_config
                .as_ref()
                .ok_or("第三方 API 分身缺少 API Key 配置")?;
            let account = modules::codex_account::upsert_api_key_account(
                config.api_key.clone(),
                Some(config.base_url.clone()),
                Some(CodexApiProviderMode::Custom),
                config.provider_id.clone(),
                config.provider_name.clone(),
            )?;
            Ok(account.id)
        }
        "officialAccount" | "official_account" => {
            let account_id = input
                .official_account_id
                .as_ref()
                .map(|value| value.trim())
                .filter(|value| !value.is_empty())
                .ok_or("官方账号分身缺少账号 ID")?;
            let account = modules::codex_account::load_account(account_id)
                .ok_or("选择的官方账号不存在，请先完成登录")?;
            if account.is_api_key_auth() {
                return Err(
                    "请选择官方 OpenAI/Codex 账号；API Key 账号请使用第三方 API 模式".to_string(),
                );
            }
            Ok(account.id)
        }
        _ => Err("authType 必须是 apiKey 或 officialAccount".to_string()),
    }
}

fn is_profile_initialized(user_data_dir: &str) -> bool {
    modules::instance::is_profile_initialized(Path::new(user_data_dir))
}

#[tauri::command]
pub async fn codex_create_clone_and_launch(
    input: CodexCloneCreateInput,
) -> Result<CodexInstanceProfileView, String> {
    let account_id = resolve_clone_account_id(&input)?;
    let name = resolve_unique_clone_name(&input.name)?;
    let user_data_dir = resolve_unique_clone_user_data_dir(&name)?;
    let working_dir = normalize_optional_trimmed(input.working_dir.clone());
    let inherit_local_data = input.inherit_local_data.unwrap_or(true);

    let instance =
        modules::codex_instance::create_instance(modules::codex_instance::CreateInstanceParams {
            name,
            user_data_dir,
            working_dir,
            extra_args: String::new(),
            bind_account_id: Some(account_id),
            copy_source_instance_id: None,
            init_mode: Some("empty".to_string()),
            launch_mode: Some(InstanceLaunchMode::App),
            app_speed: Some(CodexAppSpeed::Standard),
        })?;

    if inherit_local_data {
        modules::codex_sync_package::apply_fresh_sync_package_to_home(Path::new(
            &instance.user_data_dir,
        ))?;
    }
    if let Some(ref account_id) = instance.bind_account_id {
        modules::codex_instance::inject_account_to_profile(
            Path::new(&instance.user_data_dir),
            account_id,
        )
        .await?;
    }
    write_clone_model_to_config(Path::new(&instance.user_data_dir), input.model.as_deref())?;
    if inherit_local_data {
        let context = modules::codex_history_sync::CodexHistoryContext {
            bound_account_id: instance.bind_account_id.clone(),
        };
        let _ = modules::codex_history_sync::sync_to_current_provider_with_context(
            Path::new(&instance.user_data_dir),
            false,
            Some(&context),
        )?;
    }

    if input.launch_after_create.unwrap_or(true) {
        return codex_start_instance(instance.id).await;
    }

    let initialized = is_profile_initialized(&instance.user_data_dir);
    Ok(CodexInstanceProfileView::from_profile(
        instance,
        false,
        initialized,
    ))
}

#[tauri::command]
pub async fn codex_list_instances() -> Result<Vec<CodexInstanceProfileView>, String> {
    let store = modules::codex_instance::load_instance_store()?;
    let process_entries = modules::process::collect_codex_process_entries();
    Ok(store
        .instances
        .into_iter()
        .map(|instance| {
            let resolved_pid = modules::process::resolve_codex_pid_from_entries(
                instance.last_pid,
                Some(&instance.user_data_dir),
                &process_entries,
            );
            let running = resolved_pid.is_some();
            let initialized = is_profile_initialized(&instance.user_data_dir);
            let mut view = CodexInstanceProfileView::from_profile(instance, running, initialized);
            view.last_pid = resolved_pid;
            view
        })
        .collect())
}

fn codex_home_for_instance(instance_id: &str) -> Result<String, String> {
    if instance_id == DEFAULT_INSTANCE_ID {
        return Ok(modules::codex_instance::get_default_codex_home()?
            .to_string_lossy()
            .to_string());
    }
    let store = modules::codex_instance::load_instance_store()?;
    store
        .instances
        .into_iter()
        .find(|item| item.id == instance_id)
        .map(|item| item.user_data_dir)
        .ok_or_else(|| "instance not found".to_string())
}

fn codex_home_and_bind_for_instance(instance_id: &str) -> Result<(String, Option<String>), String> {
    if instance_id == DEFAULT_INSTANCE_ID {
        return Ok((
            modules::codex_instance::get_default_codex_home()?
                .to_string_lossy()
                .to_string(),
            None,
        ));
    }
    let store = modules::codex_instance::load_instance_store()?;
    store
        .instances
        .into_iter()
        .find(|item| item.id == instance_id)
        .map(|item| (item.user_data_dir, item.bind_account_id))
        .ok_or_else(|| "instance not found".to_string())
}

#[tauri::command]
pub async fn codex_history_status(
    instance_id: String,
) -> Result<modules::codex_history_sync::CodexHistoryStatus, String> {
    let (codex_home, bind_account_id) = codex_home_and_bind_for_instance(&instance_id)?;
    let context = modules::codex_history_sync::CodexHistoryContext {
        bound_account_id: bind_account_id,
    };
    modules::codex_history_sync::status_with_context(Path::new(&codex_home), Some(&context))
}

#[tauri::command]
pub async fn codex_history_verify(
    instance_id: String,
) -> Result<modules::codex_history_sync::CodexHistoryStatus, String> {
    let (codex_home, bind_account_id) = codex_home_and_bind_for_instance(&instance_id)?;
    let context = modules::codex_history_sync::CodexHistoryContext {
        bound_account_id: bind_account_id,
    };
    modules::codex_history_sync::verify_with_context(Path::new(&codex_home), Some(&context))
}

#[tauri::command]
pub async fn codex_history_sync(
    instance_id: String,
    dry_run: bool,
) -> Result<modules::codex_history_sync::CodexHistorySyncResult, String> {
    let (codex_home, bind_account_id) = codex_home_and_bind_for_instance(&instance_id)?;
    if !dry_run {
        modules::codex_sync_package::apply_fresh_sync_package_to_home(Path::new(&codex_home))?;
        if let Some(ref account_id) = bind_account_id {
            modules::codex_instance::inject_account_to_profile(Path::new(&codex_home), account_id)
                .await?;
        }
    }
    let context = modules::codex_history_sync::CodexHistoryContext {
        bound_account_id: bind_account_id,
    };
    modules::codex_history_sync::sync_to_current_provider_with_context(
        Path::new(&codex_home),
        dry_run,
        Some(&context),
    )
}

#[tauri::command]
pub async fn codex_history_repair(
    instance_id: String,
) -> Result<modules::codex_history_sync::CodexHistorySyncResult, String> {
    let (codex_home, bind_account_id) = codex_home_and_bind_for_instance(&instance_id)?;
    if let Some(ref account_id) = bind_account_id {
        modules::codex_sync_package::apply_fresh_sync_package_to_home(Path::new(&codex_home))?;
        modules::codex_instance::inject_account_to_profile(Path::new(&codex_home), account_id)
            .await?;
    } else {
        modules::codex_sync_package::apply_fresh_sync_package_to_home(Path::new(&codex_home))?;
    }
    let context = modules::codex_history_sync::CodexHistoryContext {
        bound_account_id: bind_account_id,
    };
    let result = modules::codex_history_sync::sync_to_current_provider_with_context(
        Path::new(&codex_home),
        false,
        Some(&context),
    )?;
    let _ =
        modules::codex_history_sync::verify_with_context(Path::new(&codex_home), Some(&context))?;
    Ok(result)
}

#[tauri::command]
pub async fn codex_sync_package_status(
) -> Result<modules::codex_sync_package::CodexSyncPackageStatus, String> {
    modules::codex_sync_package::status()
}

#[tauri::command]
pub async fn codex_extract_sync_package(
) -> Result<modules::codex_sync_package::CodexSyncPackageStatus, String> {
    modules::codex_sync_package::extract_sync_package()
}

#[tauri::command]
pub async fn codex_apply_sync_package_to_instance(
    instance_id: String,
) -> Result<modules::codex_sync_package::CodexSyncPackageApplyResult, String> {
    let codex_home = codex_home_for_instance(&instance_id)?;
    modules::codex_sync_package::apply_fresh_sync_package_to_home(Path::new(&codex_home))
}

#[tauri::command]
pub async fn codex_start_instance(instance_id: String) -> Result<CodexInstanceProfileView, String> {
    if instance_id == DEFAULT_INSTANCE_ID {
        return Err("default Codex instance is not managed by this launcher".to_string());
    }

    let store = modules::codex_instance::load_instance_store()?;
    let instance = store
        .instances
        .into_iter()
        .find(|item| item.id == instance_id)
        .ok_or_else(|| "instance not found".to_string())?;

    if let Some(pid) =
        modules::process::resolve_codex_pid(instance.last_pid, Some(&instance.user_data_dir))
    {
        modules::process::close_pid(pid, 20)?;
        let _ = modules::codex_instance::update_instance_pid(&instance.id, None)?;
    }

    if let Some(ref account_id) = instance.bind_account_id {
        modules::codex_instance::inject_account_to_profile(
            Path::new(&instance.user_data_dir),
            account_id,
        )
        .await?;
    }

    modules::process::ensure_codex_launch_path_configured()?;
    let extra_args = modules::process::parse_extra_args(&instance.extra_args);
    let pid = modules::process::start_codex_with_args(&instance.user_data_dir, &extra_args)?;
    let updated = modules::codex_instance::update_instance_after_start(&instance.id, pid)?;
    let running = modules::process::is_pid_running(pid);
    let initialized = is_profile_initialized(&updated.user_data_dir);
    Ok(CodexInstanceProfileView::from_profile(
        updated,
        running,
        initialized,
    ))
}

#[tauri::command]
pub async fn codex_stop_instance(instance_id: String) -> Result<CodexInstanceProfileView, String> {
    if instance_id == DEFAULT_INSTANCE_ID {
        return Err("default Codex instance is not managed by this launcher".to_string());
    }

    let store = modules::codex_instance::load_instance_store()?;
    let instance = store
        .instances
        .into_iter()
        .find(|item| item.id == instance_id)
        .ok_or_else(|| "instance not found".to_string())?;

    if let Some(pid) =
        modules::process::resolve_codex_pid(instance.last_pid, Some(&instance.user_data_dir))
    {
        modules::process::close_pid(pid, 20)?;
    }
    let updated = modules::codex_instance::update_instance_pid(&instance.id, None)?;
    let initialized = is_profile_initialized(&updated.user_data_dir);
    Ok(CodexInstanceProfileView::from_profile(
        updated,
        false,
        initialized,
    ))
}

#[tauri::command]
pub async fn codex_delete_instance(instance_id: String) -> Result<(), String> {
    if instance_id == DEFAULT_INSTANCE_ID {
        return Err("default Codex instance cannot be deleted".to_string());
    }
    modules::codex_instance::delete_instance(&instance_id)
}
