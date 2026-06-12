use std::collections::{BTreeMap, HashSet};
use std::env;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use toml_edit::{value, Document};

use crate::models::codex::{CodexApiProviderMode, CodexAppSpeed};
use crate::models::{InstanceLaunchMode, InstanceProfile};
use crate::modules;

const DEFAULT_INSTANCE_ID: &str = "__default__";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexSessionExportResult {
    pub session_id: String,
    pub title: String,
    pub exported_path: String,
    pub message_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexSessionSummary {
    pub session_id: String,
    pub title: String,
    pub rollout_path: String,
    pub project_dir: Option<String>,
    pub summary: Option<String>,
    pub search_preview: Option<String>,
    pub message_count: usize,
    pub last_message_at: Option<String>,
    pub rollout_exists: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexSessionUsageModelSummary {
    pub model: String,
    pub event_count: usize,
    pub input_tokens: u64,
    pub cached_input_tokens: u64,
    pub output_tokens: u64,
    pub total_tokens: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexSessionUsageSummary {
    pub codex_home: String,
    pub scanned_files: usize,
    pub parsed_files: usize,
    pub event_count: usize,
    pub input_tokens: u64,
    pub cached_input_tokens: u64,
    pub output_tokens: u64,
    pub total_tokens: u64,
    pub first_event_at: Option<String>,
    pub last_event_at: Option<String>,
    pub by_model: Vec<CodexSessionUsageModelSummary>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexProviderConnectionTestInput {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexProviderConnectionTestResult {
    pub ok: bool,
    pub codex_ready: bool,
    pub status: String,
    pub protocol: String,
    pub endpoint: String,
    pub http_status: Option<u16>,
    pub latency_ms: u64,
    pub ttfb_ms: Option<u64>,
    pub message: String,
    pub response_preview: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexProviderModelsFetchInput {
    pub base_url: String,
    pub api_key: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexProviderModelsFetchResult {
    pub ok: bool,
    pub status: String,
    pub endpoint: String,
    pub http_status: Option<u16>,
    pub latency_ms: u64,
    pub model_count: usize,
    pub models: Vec<String>,
    pub message: String,
    pub response_preview: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ZedOpenResult {
    pub target: String,
    pub mode: String,
    pub zed_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexCloneCapabilitySnapshotSource {
    pub instance_id: String,
    pub instance_name: String,
    pub codex_home: String,
    pub working_dir: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexCloneCapabilitySnapshotProvider {
    pub auth_type: String,
    pub base_url: Option<String>,
    pub provider_id: Option<String>,
    pub provider_name: Option<String>,
    pub model: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexCloneCapabilitySnapshotCapabilities {
    pub model_catalog_enabled: bool,
    pub model_catalog_models: Vec<String>,
    pub goal_enabled: bool,
    pub goal: Option<String>,
    pub prompt_pack_enabled: bool,
    pub prompt_pack: Option<String>,
    pub launch_script_present: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexCloneCapabilitySnapshot {
    pub version: u8,
    pub app: String,
    pub exported_at: i64,
    pub source: CodexCloneCapabilitySnapshotSource,
    pub provider: CodexCloneCapabilitySnapshotProvider,
    pub capabilities: CodexCloneCapabilitySnapshotCapabilities,
    pub boundaries: Vec<String>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexCloneCapabilitySnapshotExportResult {
    pub exported_path: String,
    pub snapshot: CodexCloneCapabilitySnapshot,
}

#[derive(Debug)]
struct ExportMessage {
    speaker: &'static str,
    timestamp: Option<String>,
    body: String,
}

#[derive(Debug, Clone)]
struct RecentSessionRow {
    session_id: String,
    raw_title: String,
    rollout_path: String,
    project_dir: Option<String>,
}

#[derive(Debug, Clone, Default)]
struct CumulativeTokenUsage {
    input: u64,
    cached_input: u64,
    output: u64,
}

#[derive(Debug, Clone, Default)]
struct DeltaTokenUsage {
    input: u64,
    cached_input: u64,
    output: u64,
}

impl DeltaTokenUsage {
    fn is_zero(&self) -> bool {
        self.input == 0 && self.cached_input == 0 && self.output == 0
    }
}

#[derive(Debug, Clone)]
struct UsageParseState {
    current_model: String,
    previous_total: Option<CumulativeTokenUsage>,
}

impl Default for UsageParseState {
    fn default() -> Self {
        Self {
            current_model: "unknown".to_string(),
            previous_total: None,
        }
    }
}

#[derive(Debug, Clone, Default)]
struct UsageAccumulator {
    event_count: usize,
    input_tokens: u64,
    cached_input_tokens: u64,
    output_tokens: u64,
}

impl UsageAccumulator {
    fn add(&mut self, delta: &DeltaTokenUsage) {
        self.event_count += 1;
        self.input_tokens = self.input_tokens.saturating_add(delta.input);
        self.cached_input_tokens = self.cached_input_tokens.saturating_add(delta.cached_input);
        self.output_tokens = self.output_tokens.saturating_add(delta.output);
    }

    fn total_tokens(&self) -> u64 {
        self.input_tokens.saturating_add(self.output_tokens)
    }
}

const PROVIDER_TEST_TIMEOUT_SECONDS: u64 = 45;
const PROVIDER_TEST_DEGRADED_MS: u64 = 6_000;
const PROVIDER_TEST_PREVIEW_CHARS: usize = 480;
const PROVIDER_MODELS_TIMEOUT_SECONDS: u64 = 30;
const PROVIDER_MODELS_MAX_RETURNED: usize = 240;
const CLONE_MODEL_CATALOG_FILE_NAME: &str = "model-catalog.json";
const CLONE_MODEL_CATALOG_MAX_MODELS: usize = 240;
const CLONE_GOAL_FILE_NAME: &str = "clone-goal.md";
const CLONE_GOAL_MARKER_FILE_NAME: &str = "clone-goal.json";
const CLONE_GOAL_MAX_CHARS: usize = 12_000;
const CLONE_GOAL_AGENTS_BEGIN: &str = "<!-- CODEX_CLONE_GOAL_BEGIN -->";
const CLONE_GOAL_AGENTS_END: &str = "<!-- CODEX_CLONE_GOAL_END -->";
const CLONE_PROMPT_PACK_FILE_NAME: &str = "clone-prompts.md";
const CLONE_PROMPT_PACK_MARKER_FILE_NAME: &str = "clone-prompts.json";
const CLONE_PROMPT_PACK_MAX_CHARS: usize = 16_000;
const CLONE_PROMPT_PACK_AGENTS_BEGIN: &str = "<!-- CODEX_CLONE_PROMPT_PACK_BEGIN -->";
const CLONE_PROMPT_PACK_AGENTS_END: &str = "<!-- CODEX_CLONE_PROMPT_PACK_END -->";
const CLONE_CAPABILITY_SNAPSHOT_VERSION: u8 = 1;
const CLONE_CAPABILITY_SNAPSHOT_APP: &str = "codex-clone-launcher";
const CLONE_CAPABILITY_SNAPSHOT_DIR_NAME: &str = "clone-capability-snapshots";

#[derive(Debug, Clone)]
struct ProviderTestAttempt {
    protocol: &'static str,
    endpoint: String,
    http_status: Option<u16>,
    latency_ms: u64,
    ttfb_ms: Option<u64>,
    success: bool,
    body_preview: Option<String>,
    error: Option<String>,
}

fn elapsed_ms(start: Instant) -> u64 {
    start.elapsed().as_millis().min(u128::from(u64::MAX)) as u64
}

fn normalize_provider_test_base_url(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Err("Base URL 不能为空".to_string());
    }
    let mut parsed = reqwest::Url::parse(trimmed)
        .map_err(|_| "Base URL 格式无效，请输入完整的 http:// 或 https:// 地址".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("Base URL 仅支持 http 或 https 协议".to_string());
    }
    parsed.set_query(None);
    parsed.set_fragment(None);
    if parsed.path().is_empty() || parsed.path() == "/" {
        parsed.set_path("/v1");
    }
    Ok(parsed.to_string().trim_end_matches('/').to_string())
}

fn provider_test_endpoint(base_url: &str, suffix: &str) -> Result<String, String> {
    let mut parsed = reqwest::Url::parse(base_url)
        .map_err(|_| "Base URL 格式无效，请输入完整的 http:// 或 https:// 地址".to_string())?;
    let suffix = suffix.trim_start_matches('/');
    let current_path = parsed.path().trim_end_matches('/');
    let next_path = if current_path.ends_with(suffix) {
        current_path.to_string()
    } else if current_path.is_empty() {
        format!("/{}", suffix)
    } else {
        format!("{}/{}", current_path, suffix)
    };
    parsed.set_path(&next_path);
    parsed.set_query(None);
    parsed.set_fragment(None);
    Ok(parsed.to_string())
}

fn provider_test_preview(raw: &str, api_key: &str) -> Option<String> {
    let mut normalized = if api_key.trim().is_empty() {
        raw.to_string()
    } else {
        raw.replace(api_key, "[redacted-api-key]")
    };
    normalized = normalized
        .replace('\r', " ")
        .replace('\n', " ")
        .replace('\t', " ");
    normalized = normalized.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.is_empty() {
        return None;
    }
    if normalized.chars().count() > PROVIDER_TEST_PREVIEW_CHARS {
        let mut clipped = normalized
            .chars()
            .take(PROVIDER_TEST_PREVIEW_CHARS)
            .collect::<String>();
        clipped.push_str("...");
        Some(clipped)
    } else {
        Some(normalized)
    }
}

fn provider_attempt_summary(attempt: &ProviderTestAttempt) -> String {
    if let Some(status) = attempt.http_status {
        return format!("{} HTTP {}", attempt.protocol, status);
    }
    if let Some(error) = attempt.error.as_ref() {
        return format!("{} {}", attempt.protocol, error);
    }
    format!("{} failed", attempt.protocol)
}

fn parse_provider_model_payload(payload: &Value) -> Vec<String> {
    if let Some(array) = payload.as_array() {
        return unique_provider_model_ids(
            array
                .iter()
                .filter_map(|item| {
                    item.as_str().map(str::to_string).or_else(|| {
                        item.as_object().and_then(|object| {
                            ["id", "model", "name"]
                                .iter()
                                .filter_map(|key| object.get(*key).and_then(Value::as_str))
                                .find(|value| !value.trim().is_empty())
                                .map(|value| value.trim().to_string())
                        })
                    })
                })
                .collect(),
        );
    }

    let Some(object) = payload.as_object() else {
        return Vec::new();
    };
    for key in ["data", "models", "items"] {
        if let Some(value) = object.get(key) {
            let nested = parse_provider_model_payload(value);
            if !nested.is_empty() {
                return nested;
            }
        }
    }
    ["id", "model", "name"]
        .iter()
        .filter_map(|key| object.get(*key).and_then(Value::as_str))
        .find(|value| !value.trim().is_empty())
        .map(|value| vec![value.trim().to_string()])
        .unwrap_or_default()
}

fn unique_provider_model_ids(values: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut models = Vec::new();
    for value in values {
        let value = value.trim();
        if value.is_empty() {
            continue;
        }
        let key = value.to_ascii_lowercase();
        if seen.insert(key) {
            models.push(value.to_string());
        }
    }
    models.sort_by(|left, right| left.to_ascii_lowercase().cmp(&right.to_ascii_lowercase()));
    models
}

async fn send_provider_test_attempt(
    client: &reqwest::Client,
    endpoint: String,
    api_key: &str,
    protocol: &'static str,
    body: Value,
) -> ProviderTestAttempt {
    let started = Instant::now();
    let response = client
        .post(&endpoint)
        .bearer_auth(api_key)
        .header(reqwest::header::ACCEPT, "application/json")
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .json(&body)
        .send()
        .await;

    match response {
        Ok(response) => {
            let ttfb_ms = elapsed_ms(started);
            let http_status = response.status().as_u16();
            let success = response.status().is_success();
            match response.text().await {
                Ok(text) => ProviderTestAttempt {
                    protocol,
                    endpoint,
                    http_status: Some(http_status),
                    latency_ms: elapsed_ms(started),
                    ttfb_ms: Some(ttfb_ms),
                    success,
                    body_preview: provider_test_preview(&text, api_key),
                    error: None,
                },
                Err(error) => ProviderTestAttempt {
                    protocol,
                    endpoint,
                    http_status: Some(http_status),
                    latency_ms: elapsed_ms(started),
                    ttfb_ms: Some(ttfb_ms),
                    success: false,
                    body_preview: None,
                    error: Some(format!("read response failed: {}", error)),
                },
            }
        }
        Err(error) => ProviderTestAttempt {
            protocol,
            endpoint,
            http_status: None,
            latency_ms: elapsed_ms(started),
            ttfb_ms: None,
            success: false,
            body_preview: None,
            error: Some(error.to_string()),
        },
    }
}

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
    pub launch_script: Option<String>,
    pub model_catalog_enabled: bool,
    pub model_catalog_path: Option<String>,
    pub model_catalog_count: usize,
    pub goal_enabled: bool,
    pub goal: Option<String>,
    pub goal_path: Option<String>,
    pub prompt_pack_enabled: bool,
    pub prompt_pack: Option<String>,
    pub prompt_pack_path: Option<String>,
    pub history_status: Option<modules::codex_history_sync::CodexHistoryStatus>,
}

impl CodexInstanceProfileView {
    fn from_profile(profile: InstanceProfile, running: bool, initialized: bool) -> Self {
        let profile_dir = Path::new(&profile.user_data_dir);
        let goal = read_clone_goal_marker(profile_dir);
        let prompt_pack = read_clone_prompt_pack_marker(profile_dir);
        let (goal_enabled, goal_path) = clone_goal_status(profile_dir);
        let (prompt_pack_enabled, prompt_pack_path) = clone_prompt_pack_status(profile_dir);
        let (model_catalog_enabled, model_catalog_path, model_catalog_count) =
            clone_model_catalog_status(profile_dir);
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
            launch_script: profile.launch_script,
            model_catalog_enabled,
            model_catalog_path,
            model_catalog_count,
            goal_enabled,
            goal,
            goal_path,
            prompt_pack_enabled,
            prompt_pack,
            prompt_pack_path,
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
    pub model_catalog_enabled: Option<bool>,
    pub model_catalog_models: Option<Vec<String>>,
    pub working_dir: Option<String>,
    pub launch_script: Option<String>,
    pub goal_enabled: Option<bool>,
    pub goal: Option<String>,
    pub prompt_pack_enabled: Option<bool>,
    pub prompt_pack: Option<String>,
    pub api_key_config: Option<CodexCloneApiKeyConfig>,
    pub official_account_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexCloneCapabilitiesUpdateInput {
    pub instance_id: String,
    pub goal_enabled: bool,
    pub goal: Option<String>,
    pub prompt_pack_enabled: Option<bool>,
    pub prompt_pack: Option<String>,
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

fn normalize_clone_model_catalog_models(
    primary_model: Option<&str>,
    catalog_models: Option<&[String]>,
) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut models = Vec::new();
    for value in primary_model.into_iter().chain(
        catalog_models
            .unwrap_or_default()
            .iter()
            .map(String::as_str),
    ) {
        let value = value.trim();
        if value.is_empty() {
            continue;
        }
        let key = value.to_ascii_lowercase();
        if seen.insert(key) {
            models.push(value.to_string());
        }
        if models.len() >= CLONE_MODEL_CATALOG_MAX_MODELS {
            break;
        }
    }
    models
}

fn write_clone_model_config(
    profile_dir: &Path,
    model: Option<&str>,
    model_catalog_enabled: bool,
    model_catalog_models: Option<&[String]>,
) -> Result<(), String> {
    let model = model.map(str::trim).filter(|value| !value.is_empty());
    let catalog_models = if model_catalog_enabled {
        normalize_clone_model_catalog_models(model, model_catalog_models)
    } else {
        Vec::new()
    };
    if model.is_none() && catalog_models.is_empty() {
        return Ok(());
    };
    let config_path = profile_dir.join("config.toml");
    if let Some(parent) = config_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建 config.toml 目录失败: {}", e))?;
    }
    let existing = fs::read_to_string(&config_path).unwrap_or_default();
    let mut doc = if existing.trim().is_empty() {
        Document::new()
    } else {
        existing
            .parse::<Document>()
            .map_err(|e| format!("解析 config.toml 失败: {}", e))?
    };
    if let Some(model) = model {
        doc["model"] = value(model);
    }
    if !catalog_models.is_empty() {
        let catalog_path = profile_dir.join(CLONE_MODEL_CATALOG_FILE_NAME);
        let models = catalog_models
            .iter()
            .map(|model| {
                json!({
                    "slug": model,
                    "name": model,
                    "provider": "clone-provider",
                    "visibility": "list",
                    "supported_in_api": true,
                })
            })
            .collect::<Vec<_>>();
        let catalog = json!({
            "object": "list",
            "generated_by": "codex-clone-launcher",
            "models": models,
        });
        let content = serde_json::to_string_pretty(&catalog)
            .map(|value| format!("{}\n", value))
            .map_err(|e| format!("生成 model catalog JSON 失败: {}", e))?;
        modules::atomic_write::write_string_atomic(&catalog_path, &content)
            .map_err(|e| format!("写入 model-catalog.json 失败: {}", e))?;
        doc["model_catalog_json"] = value(CLONE_MODEL_CATALOG_FILE_NAME);
    }
    #[cfg(target_os = "windows")]
    {
        if doc.get("windows").is_none() {
            doc["windows"] = toml_edit::table();
        }
        if let Some(windows_table) = doc["windows"].as_table_mut() {
            windows_table["sandbox"] = value("unelevated");
        }
    }
    let content = doc.to_string();
    modules::atomic_write::write_string_atomic(&config_path, &content)
        .map_err(|e| format!("写入 config.toml 失败: {}", e))
}

fn current_unix_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(i64::MAX as u128) as i64)
        .unwrap_or_default()
}

fn normalize_clone_goal_value(enabled: bool, goal: Option<&str>) -> Result<Option<String>, String> {
    if !enabled {
        return Ok(None);
    }
    let raw = goal.unwrap_or_default();
    let normalized = raw.replace("\r\n", "\n").replace('\r', "\n");
    let trimmed = normalized.trim();
    if trimmed.is_empty() {
        return Err("已开启追求目标，请填写目标内容。".to_string());
    }
    if trimmed.chars().count() > CLONE_GOAL_MAX_CHARS {
        return Err(format!(
            "追求目标过长，请控制在 {} 个字符以内。",
            CLONE_GOAL_MAX_CHARS
        ));
    }
    Ok(Some(trimmed.to_string()))
}

fn normalize_clone_goal(input: &CodexCloneCreateInput) -> Result<Option<String>, String> {
    normalize_clone_goal_value(input.goal_enabled.unwrap_or(false), input.goal.as_deref())
}

fn clone_goal_markdown(goal: &str) -> String {
    format!(
        "# Clone Pursuit Goal\n\n\
Managed by Codex Clone Launcher for this clone profile only.\n\n\
## Objective\n\n{}\n\n\
## Boundaries\n\n\
- Keep source profile and clone profile separate.\n\
- Do not copy source auth, credentials, quota state, plugin cache, logs, or runtime cache.\n\
- Prefer concrete progress toward this objective until the user gives newer instructions.\n",
        goal.trim()
    )
}

fn clone_goal_agents_block(goal: &str) -> String {
    format!(
        "{begin}\n\
# Clone Pursuit Goal\n\n\
This clone has an active pursuit goal stored in `{goal_file}` inside its isolated `CODEX_HOME`.\n\n\
Objective:\n{}\n\n\
Rules:\n\
- Treat this as the clone's goal context when the user asks it to keep working.\n\
- Preserve source/clone separation; do not copy live source auth, credentials, quota, plugin cache, logs, or runtime cache.\n\
- If newer user instructions conflict with this goal, follow the newer user instructions.\n\
{end}",
        goal.trim(),
        begin = CLONE_GOAL_AGENTS_BEGIN,
        end = CLONE_GOAL_AGENTS_END,
        goal_file = CLONE_GOAL_FILE_NAME
    )
}

fn strip_managed_clone_goal_block(content: &str) -> String {
    let Some(start) = content.find(CLONE_GOAL_AGENTS_BEGIN) else {
        return content.trim_end().to_string();
    };
    let Some(end_offset) = content[start..].find(CLONE_GOAL_AGENTS_END) else {
        return content.trim_end().to_string();
    };
    let end = start + end_offset + CLONE_GOAL_AGENTS_END.len();
    let before = content[..start].trim_end();
    let after = content[end..].trim_start_matches(['\r', '\n']);
    match (before.is_empty(), after.is_empty()) {
        (true, true) => String::new(),
        (true, false) => after.trim_end().to_string(),
        (false, true) => before.to_string(),
        (false, false) => format!("{}\n\n{}", before, after.trim_end()),
    }
}

fn upsert_clone_goal_agents_block(profile_dir: &Path, goal: &str) -> Result<(), String> {
    let agents_path = profile_dir.join("AGENTS.md");
    let existing = fs::read_to_string(&agents_path).unwrap_or_default();
    let base = strip_managed_clone_goal_block(&existing);
    let block = clone_goal_agents_block(goal);
    let content = if base.trim().is_empty() {
        format!("{}\n", block)
    } else {
        format!("{}\n\n{}\n", base.trim_end(), block)
    };
    modules::atomic_write::write_string_atomic(&agents_path, &content)
        .map_err(|error| format!("写入分身追求目标 AGENTS.md 失败: {}", error))
}

fn write_clone_goal_to_profile(profile_dir: &Path, goal: Option<&str>) -> Result<(), String> {
    let Some(goal) = goal.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(());
    };
    fs::create_dir_all(profile_dir)
        .map_err(|error| format!("创建分身追求目标目录失败: {}", error))?;
    let goal_path = profile_dir.join(CLONE_GOAL_FILE_NAME);
    let marker_path = profile_dir.join(CLONE_GOAL_MARKER_FILE_NAME);
    modules::atomic_write::write_string_atomic(&goal_path, &clone_goal_markdown(goal))
        .map_err(|error| format!("写入分身追求目标失败: {}", error))?;
    let marker = json!({
        "version": 1,
        "enabled": true,
        "createdAt": current_unix_millis(),
        "goalFile": CLONE_GOAL_FILE_NAME,
        "agentsFile": "AGENTS.md",
        "goal": goal,
    });
    let marker_content = serde_json::to_string_pretty(&marker)
        .map_err(|error| format!("序列化分身追求目标失败: {}", error))?;
    modules::atomic_write::write_string_atomic(&marker_path, &marker_content)
        .map_err(|error| format!("写入分身追求目标标记失败: {}", error))?;
    upsert_clone_goal_agents_block(profile_dir, goal)
}

fn remove_file_if_exists(path: &Path) -> Result<(), String> {
    match fs::remove_file(path) {
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("删除文件失败 ({}): {}", path.display(), error)),
    }
}

fn clear_clone_goal_from_profile(profile_dir: &Path) -> Result<(), String> {
    remove_file_if_exists(&profile_dir.join(CLONE_GOAL_FILE_NAME))?;
    remove_file_if_exists(&profile_dir.join(CLONE_GOAL_MARKER_FILE_NAME))?;
    let agents_path = profile_dir.join("AGENTS.md");
    let Ok(existing) = fs::read_to_string(&agents_path) else {
        return Ok(());
    };
    let content = strip_managed_clone_goal_block(&existing);
    if content.trim().is_empty() {
        remove_file_if_exists(&agents_path)
    } else {
        modules::atomic_write::write_string_atomic(
            &agents_path,
            &format!("{}\n", content.trim_end()),
        )
        .map_err(|error| format!("清理分身追求目标 AGENTS.md 托管块失败: {}", error))
    }
}

fn read_clone_goal_marker(profile_dir: &Path) -> Option<String> {
    let marker_path = profile_dir.join(CLONE_GOAL_MARKER_FILE_NAME);
    let contents = fs::read_to_string(marker_path).ok()?;
    let payload = serde_json::from_str::<Value>(&contents).ok()?;
    if !payload
        .get("enabled")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        return None;
    }
    payload
        .get("goal")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn ensure_clone_goal_for_launch(profile_dir: &Path) -> Result<Option<PathBuf>, String> {
    let goal_path = profile_dir.join(CLONE_GOAL_FILE_NAME);
    if let Some(goal) = read_clone_goal_marker(profile_dir) {
        upsert_clone_goal_agents_block(profile_dir, &goal)?;
        return Ok(Some(goal_path));
    }
    if goal_path.is_file() {
        return Ok(Some(goal_path));
    }
    Ok(None)
}

fn clone_goal_status(profile_dir: &Path) -> (bool, Option<String>) {
    let goal_path = profile_dir.join(CLONE_GOAL_FILE_NAME);
    if goal_path.is_file() {
        return (true, Some(goal_path.to_string_lossy().to_string()));
    }
    (false, None)
}

fn normalize_clone_prompt_pack_value(
    enabled: bool,
    prompt_pack: Option<&str>,
) -> Result<Option<String>, String> {
    if !enabled {
        return Ok(None);
    }
    let raw = prompt_pack.unwrap_or_default();
    let normalized = raw.replace("\r\n", "\n").replace('\r', "\n");
    let trimmed = normalized.trim();
    if trimmed.is_empty() {
        return Err("已开启分身提示词包，请填写提示词内容。".to_string());
    }
    if trimmed.chars().count() > CLONE_PROMPT_PACK_MAX_CHARS {
        return Err(format!(
            "分身提示词包过长，请控制在 {} 个字符以内。",
            CLONE_PROMPT_PACK_MAX_CHARS
        ));
    }
    Ok(Some(trimmed.to_string()))
}

fn normalize_clone_prompt_pack(input: &CodexCloneCreateInput) -> Result<Option<String>, String> {
    normalize_clone_prompt_pack_value(
        input.prompt_pack_enabled.unwrap_or(false),
        input.prompt_pack.as_deref(),
    )
}

fn clone_prompt_pack_markdown(prompt_pack: &str) -> String {
    format!(
        "# Clone Prompt Pack\n\n\
Managed by Codex Clone Launcher for this clone profile only.\n\n\
## Prompts\n\n{}\n\n\
## Boundaries\n\n\
- Keep this prompt pack inside the clone profile.\n\
- Do not copy source auth, credentials, quota state, plugin cache, logs, or runtime cache.\n\
- Treat these prompts as reusable modes when they match the user's current request.\n",
        prompt_pack.trim()
    )
}

fn clone_prompt_pack_agents_block(prompt_pack: &str) -> String {
    format!(
        "{begin}\n\
# Clone Prompt Pack\n\n\
This clone has a prompt pack stored in `{prompt_file}` inside its isolated `CODEX_HOME`.\n\n\
Reusable prompts:\n{}\n\n\
Rules:\n\
- Use these prompts as optional operating modes when they fit the current task.\n\
- Preserve source/clone separation; do not copy live source auth, credentials, quota, plugin cache, logs, or runtime cache.\n\
- If newer user instructions conflict with this prompt pack, follow the newer user instructions.\n\
{end}",
        prompt_pack.trim(),
        begin = CLONE_PROMPT_PACK_AGENTS_BEGIN,
        end = CLONE_PROMPT_PACK_AGENTS_END,
        prompt_file = CLONE_PROMPT_PACK_FILE_NAME
    )
}

fn strip_managed_clone_prompt_pack_block(content: &str) -> String {
    let Some(start) = content.find(CLONE_PROMPT_PACK_AGENTS_BEGIN) else {
        return content.trim_end().to_string();
    };
    let Some(end_offset) = content[start..].find(CLONE_PROMPT_PACK_AGENTS_END) else {
        return content.trim_end().to_string();
    };
    let end = start + end_offset + CLONE_PROMPT_PACK_AGENTS_END.len();
    let before = content[..start].trim_end();
    let after = content[end..].trim_start_matches(['\r', '\n']);
    match (before.is_empty(), after.is_empty()) {
        (true, true) => String::new(),
        (true, false) => after.trim_end().to_string(),
        (false, true) => before.to_string(),
        (false, false) => format!("{}\n\n{}", before, after.trim_end()),
    }
}

fn upsert_clone_prompt_pack_agents_block(
    profile_dir: &Path,
    prompt_pack: &str,
) -> Result<(), String> {
    let agents_path = profile_dir.join("AGENTS.md");
    let existing = fs::read_to_string(&agents_path).unwrap_or_default();
    let base = strip_managed_clone_prompt_pack_block(&existing);
    let block = clone_prompt_pack_agents_block(prompt_pack);
    let content = if base.trim().is_empty() {
        format!("{}\n", block)
    } else {
        format!("{}\n\n{}\n", base.trim_end(), block)
    };
    modules::atomic_write::write_string_atomic(&agents_path, &content)
        .map_err(|error| format!("写入分身提示词包 AGENTS.md 失败: {}", error))
}

fn write_clone_prompt_pack_to_profile(
    profile_dir: &Path,
    prompt_pack: Option<&str>,
) -> Result<(), String> {
    let Some(prompt_pack) = prompt_pack.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(());
    };
    fs::create_dir_all(profile_dir)
        .map_err(|error| format!("创建分身提示词包目录失败: {}", error))?;
    let prompt_path = profile_dir.join(CLONE_PROMPT_PACK_FILE_NAME);
    let marker_path = profile_dir.join(CLONE_PROMPT_PACK_MARKER_FILE_NAME);
    modules::atomic_write::write_string_atomic(
        &prompt_path,
        &clone_prompt_pack_markdown(prompt_pack),
    )
    .map_err(|error| format!("写入分身提示词包失败: {}", error))?;
    let marker = json!({
        "version": 1,
        "enabled": true,
        "createdAt": current_unix_millis(),
        "promptFile": CLONE_PROMPT_PACK_FILE_NAME,
        "agentsFile": "AGENTS.md",
        "promptPack": prompt_pack,
    });
    let marker_content = serde_json::to_string_pretty(&marker)
        .map_err(|error| format!("序列化分身提示词包失败: {}", error))?;
    modules::atomic_write::write_string_atomic(&marker_path, &marker_content)
        .map_err(|error| format!("写入分身提示词包标记失败: {}", error))?;
    upsert_clone_prompt_pack_agents_block(profile_dir, prompt_pack)
}

fn clear_clone_prompt_pack_from_profile(profile_dir: &Path) -> Result<(), String> {
    remove_file_if_exists(&profile_dir.join(CLONE_PROMPT_PACK_FILE_NAME))?;
    remove_file_if_exists(&profile_dir.join(CLONE_PROMPT_PACK_MARKER_FILE_NAME))?;
    let agents_path = profile_dir.join("AGENTS.md");
    let Ok(existing) = fs::read_to_string(&agents_path) else {
        return Ok(());
    };
    let content = strip_managed_clone_prompt_pack_block(&existing);
    if content.trim().is_empty() {
        remove_file_if_exists(&agents_path)
    } else {
        modules::atomic_write::write_string_atomic(
            &agents_path,
            &format!("{}\n", content.trim_end()),
        )
        .map_err(|error| format!("清理分身提示词包 AGENTS.md 托管块失败: {}", error))
    }
}

fn read_clone_prompt_pack_marker(profile_dir: &Path) -> Option<String> {
    let marker_path = profile_dir.join(CLONE_PROMPT_PACK_MARKER_FILE_NAME);
    let contents = fs::read_to_string(marker_path).ok()?;
    let payload = serde_json::from_str::<Value>(&contents).ok()?;
    if !payload
        .get("enabled")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        return None;
    }
    payload
        .get("promptPack")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn ensure_clone_prompt_pack_for_launch(profile_dir: &Path) -> Result<Option<PathBuf>, String> {
    let prompt_path = profile_dir.join(CLONE_PROMPT_PACK_FILE_NAME);
    if let Some(prompt_pack) = read_clone_prompt_pack_marker(profile_dir) {
        upsert_clone_prompt_pack_agents_block(profile_dir, &prompt_pack)?;
        return Ok(Some(prompt_path));
    }
    if prompt_path.is_file() {
        return Ok(Some(prompt_path));
    }
    Ok(None)
}

fn clone_prompt_pack_status(profile_dir: &Path) -> (bool, Option<String>) {
    let prompt_path = profile_dir.join(CLONE_PROMPT_PACK_FILE_NAME);
    if prompt_path.is_file() {
        return (true, Some(prompt_path.to_string_lossy().to_string()));
    }
    (false, None)
}

fn read_clone_config_model(profile_dir: &Path) -> Option<String> {
    let config = fs::read_to_string(profile_dir.join("config.toml")).ok()?;
    let doc = config.parse::<Document>().ok()?;
    doc.get("model")
        .and_then(|item| item.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn read_clone_model_catalog_models(profile_dir: &Path) -> Vec<String> {
    let contents = match fs::read_to_string(profile_dir.join(CLONE_MODEL_CATALOG_FILE_NAME)) {
        Ok(contents) => contents,
        Err(_) => return Vec::new(),
    };
    let Ok(payload) = serde_json::from_str::<Value>(&contents) else {
        return Vec::new();
    };
    let Some(items) = payload
        .get("models")
        .and_then(Value::as_array)
        .or_else(|| payload.as_array())
    else {
        return Vec::new();
    };

    let mut seen = HashSet::new();
    let mut models = Vec::new();
    for item in items {
        let candidate = item
            .get("slug")
            .or_else(|| item.get("id"))
            .or_else(|| item.get("name"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty());
        if let Some(model) = candidate {
            let key = model.to_ascii_lowercase();
            if seen.insert(key) {
                models.push(model.to_string());
            }
        }
        if models.len() >= CLONE_MODEL_CATALOG_MAX_MODELS {
            break;
        }
    }
    models
}

fn clone_model_catalog_status(profile_dir: &Path) -> (bool, Option<String>, usize) {
    let path = profile_dir.join(CLONE_MODEL_CATALOG_FILE_NAME);
    if !path.is_file() {
        return (false, None, 0);
    }

    let count = read_clone_model_catalog_models(profile_dir).len();
    (true, Some(path.to_string_lossy().to_string()), count)
}

fn normalized_optional_snapshot_string(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn clone_capability_provider_snapshot(
    instance: &InstanceProfile,
) -> (CodexCloneCapabilitySnapshotProvider, Vec<String>) {
    let profile_dir = Path::new(&instance.user_data_dir);
    let mut provider = CodexCloneCapabilitySnapshotProvider {
        auth_type: "unknown".to_string(),
        base_url: None,
        provider_id: None,
        provider_name: None,
        model: read_clone_config_model(profile_dir),
    };
    let mut warnings = Vec::new();

    let Some(account_id) = instance
        .bind_account_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        warnings.push("clone has no bound account; provider fields may be incomplete".to_string());
        return (provider, warnings);
    };

    let Some(account) = modules::codex_account::load_account(account_id) else {
        warnings.push(
            "bound account metadata is missing; snapshot excludes auth and API key material"
                .to_string(),
        );
        return (provider, warnings);
    };

    if account.is_api_key_auth() {
        provider.auth_type = "apiKey".to_string();
        provider.base_url = normalized_optional_snapshot_string(account.api_base_url.as_deref());
        provider.provider_id =
            normalized_optional_snapshot_string(account.api_provider_id.as_deref());
        provider.provider_name =
            normalized_optional_snapshot_string(account.api_provider_name.as_deref());
    } else {
        provider.auth_type = "officialAccount".to_string();
        provider.provider_id = Some("openai-official".to_string());
        provider.provider_name = Some("OpenAI/Codex official".to_string());
    }

    (provider, warnings)
}

fn build_clone_capability_snapshot(instance: &InstanceProfile) -> CodexCloneCapabilitySnapshot {
    let profile_dir = Path::new(&instance.user_data_dir);
    let (provider, mut warnings) = clone_capability_provider_snapshot(instance);
    let goal = read_clone_goal_marker(profile_dir);
    let prompt_pack = read_clone_prompt_pack_marker(profile_dir);
    let (goal_file_enabled, _) = clone_goal_status(profile_dir);
    let (prompt_pack_file_enabled, _) = clone_prompt_pack_status(profile_dir);
    let model_catalog_models = read_clone_model_catalog_models(profile_dir);

    if goal_file_enabled && goal.is_none() {
        warnings.push(
            "clone goal file exists but marker is missing; goal text was not exported".to_string(),
        );
    }
    if prompt_pack_file_enabled && prompt_pack.is_none() {
        warnings.push(
            "clone prompt pack file exists but marker is missing; prompt text was not exported"
                .to_string(),
        );
    }
    if instance
        .launch_script
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_some()
    {
        warnings.push("clone launch script is present but intentionally excluded".to_string());
    }

    warnings.push(
        "API keys, auth tokens, quota state, sessions, logs, plugin cache, and runtime cache are excluded"
            .to_string(),
    );

    CodexCloneCapabilitySnapshot {
        version: CLONE_CAPABILITY_SNAPSHOT_VERSION,
        app: CLONE_CAPABILITY_SNAPSHOT_APP.to_string(),
        exported_at: current_unix_millis(),
        source: CodexCloneCapabilitySnapshotSource {
            instance_id: instance.id.clone(),
            instance_name: instance.name.clone(),
            codex_home: instance.user_data_dir.clone(),
            working_dir: instance.working_dir.clone(),
        },
        provider,
        capabilities: CodexCloneCapabilitySnapshotCapabilities {
            model_catalog_enabled: !model_catalog_models.is_empty(),
            model_catalog_models,
            goal_enabled: goal.is_some(),
            goal,
            prompt_pack_enabled: prompt_pack.is_some(),
            prompt_pack,
            launch_script_present: instance
                .launch_script
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .is_some(),
        },
        boundaries: vec![
            "snapshot is clone-owned and never reads the live source profile".to_string(),
            "snapshot can prefill a new clone form but never creates or mutates a clone by itself"
                .to_string(),
            "secrets and runtime state are excluded by design".to_string(),
        ],
        warnings,
    }
}

fn export_clone_capability_snapshot_for_instance(
    instance: &InstanceProfile,
) -> Result<CodexCloneCapabilitySnapshotExportResult, String> {
    let snapshot = build_clone_capability_snapshot(instance);
    let export_dir = Path::new(&instance.user_data_dir).join(CLONE_CAPABILITY_SNAPSHOT_DIR_NAME);
    fs::create_dir_all(&export_dir)
        .map_err(|error| format!("创建分身能力快照目录失败: {}", error))?;
    let target = unique_export_path(
        &export_dir,
        &format!("clone-capability-snapshot-{}.json", snapshot.exported_at),
    );
    let content = serde_json::to_string_pretty(&snapshot)
        .map(|value| format!("{}\n", value))
        .map_err(|error| format!("序列化分身能力快照失败: {}", error))?;
    modules::atomic_write::write_string_atomic(&target, &content)
        .map_err(|error| format!("写入分身能力快照失败: {}", error))?;

    Ok(CodexCloneCapabilitySnapshotExportResult {
        exported_path: target.to_string_lossy().to_string(),
        snapshot,
    })
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

fn find_zed_cli_path() -> Option<PathBuf> {
    let mut names = vec!["zed".to_string()];
    #[cfg(target_os = "windows")]
    {
        names.push("zed.exe".to_string());
        names.push("zed.cmd".to_string());
    }

    if let Some(path_var) = env::var_os("PATH") {
        for dir in env::split_paths(&path_var) {
            for name in &names {
                let candidate = dir.join(name);
                if candidate.is_file() {
                    return Some(candidate);
                }
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        let mut candidates = Vec::new();
        if let Some(local_app_data) = env::var_os("LOCALAPPDATA") {
            let root = PathBuf::from(local_app_data);
            candidates.push(root.join("Programs").join("Zed").join("Zed.exe"));
            candidates.push(root.join("Microsoft").join("WindowsApps").join("zed.exe"));
        }
        if let Some(program_files) = env::var_os("ProgramFiles") {
            candidates.push(PathBuf::from(program_files).join("Zed").join("Zed.exe"));
        }
        if let Some(program_files_x86) = env::var_os("ProgramFiles(x86)") {
            candidates.push(PathBuf::from(program_files_x86).join("Zed").join("Zed.exe"));
        }
        return candidates.into_iter().find(|path| path.is_file());
    }

    #[cfg(not(target_os = "windows"))]
    {
        None
    }
}

fn is_windows_drive_path(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && (bytes[2] == b'\\' || bytes[2] == b'/')
}

fn looks_like_scp_remote_path(value: &str) -> Option<(&str, &str)> {
    if value.starts_with("ssh://") || value.contains("://") || is_windows_drive_path(value) {
        return None;
    }
    let (authority, remote_path) = value.split_once(':')?;
    if authority.trim().is_empty() || remote_path.trim().is_empty() {
        return None;
    }
    if authority.contains('/')
        || authority.contains('\\')
        || authority.chars().any(char::is_whitespace)
    {
        return None;
    }
    if !remote_path.starts_with('/') {
        return None;
    }
    Some((authority.trim(), remote_path.trim()))
}

fn percent_encode_path_segment(segment: &str) -> String {
    let mut encoded = String::new();
    for byte in segment.as_bytes() {
        let ch = *byte as char;
        if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '.' | '_' | '~') {
            encoded.push(ch);
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }
    encoded
}

fn encode_remote_path(path: &str) -> String {
    path.replace('\\', "/")
        .split('/')
        .map(percent_encode_path_segment)
        .collect::<Vec<_>>()
        .join("/")
}

fn zed_target_from_workdir(raw: &str) -> Result<(String, &'static str), String> {
    let target = raw.trim();
    if target.is_empty() {
        return Err("Zed 打开路径为空".to_string());
    }
    if target.starts_with("ssh://") {
        return Ok((target.to_string(), "remote"));
    }
    if let Some((authority, remote_path)) = looks_like_scp_remote_path(target) {
        return Ok((
            format!("ssh://{}{}", authority, encode_remote_path(remote_path)),
            "remote",
        ));
    }
    Ok((target.to_string(), "local"))
}

#[tauri::command]
pub async fn codex_open_instance_in_zed(instance_id: String) -> Result<ZedOpenResult, String> {
    let instance_id = instance_id.trim();
    if instance_id.is_empty() || instance_id == DEFAULT_INSTANCE_ID {
        return Err("只能从分身打开 Zed，不能以本体作为目标".to_string());
    }
    let store = modules::codex_instance::load_instance_store()?;
    let instance = store
        .instances
        .into_iter()
        .find(|item| item.id == instance_id)
        .ok_or("Codex 分身不存在")?;
    let raw_target = instance
        .working_dir
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(instance.user_data_dir.as_str());
    let (target, mode) = zed_target_from_workdir(raw_target)?;
    let zed_path = find_zed_cli_path()
        .ok_or("未找到 Zed CLI。请确认已安装 Zed，并且 zed/zed.exe 已加入 PATH。")?;

    let mut command = Command::new(&zed_path);
    command.arg(&target);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x00000200;
        command.creation_flags(CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP);
    }
    command
        .spawn()
        .map_err(|error| format!("启动 Zed 失败: {}", error))?;
    Ok(ZedOpenResult {
        target,
        mode: mode.to_string(),
        zed_path: zed_path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub async fn codex_test_provider_connection(
    input: CodexProviderConnectionTestInput,
) -> Result<CodexProviderConnectionTestResult, String> {
    let base_url = normalize_provider_test_base_url(&input.base_url)?;
    let api_key = input.api_key.trim();
    if api_key.is_empty() {
        return Err("API Key 不能为空".to_string());
    }
    if reqwest::Url::parse(api_key).is_ok() {
        return Err("API Key 不能是 URL，请检查 Base URL 和 API Key 是否填反".to_string());
    }
    let model = input.model.trim();
    if model.is_empty() {
        return Err("模型不能为空".to_string());
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(PROVIDER_TEST_TIMEOUT_SECONDS))
        .build()
        .map_err(|error| format!("创建 provider 测试客户端失败: {}", error))?;

    let responses_endpoint = provider_test_endpoint(&base_url, "/responses")?;
    let responses_body = json!({
        "model": model,
        "input": "Hi",
        "max_output_tokens": 16,
        "stream": false,
    });
    let responses_attempt = send_provider_test_attempt(
        &client,
        responses_endpoint,
        api_key,
        "responses",
        responses_body,
    )
    .await;

    if responses_attempt.success {
        let degraded = responses_attempt.latency_ms > PROVIDER_TEST_DEGRADED_MS
            || responses_attempt.ttfb_ms.unwrap_or_default() > PROVIDER_TEST_DEGRADED_MS;
        return Ok(CodexProviderConnectionTestResult {
            ok: true,
            codex_ready: true,
            status: if degraded { "degraded" } else { "healthy" }.to_string(),
            protocol: "responses".to_string(),
            endpoint: responses_attempt.endpoint,
            http_status: responses_attempt.http_status,
            latency_ms: responses_attempt.latency_ms,
            ttfb_ms: responses_attempt.ttfb_ms,
            message: if degraded {
                "Responses 端点可用，但响应较慢；可考虑更快的模型或镜像端点。"
            } else {
                "Responses 端点可用，当前 Codex 分身直连配置可以使用这个 provider。"
            }
            .to_string(),
            response_preview: responses_attempt.body_preview,
        });
    }

    let should_probe_chat = !matches!(responses_attempt.http_status, Some(401 | 403));
    if should_probe_chat {
        let chat_endpoint = provider_test_endpoint(&base_url, "/chat/completions")?;
        let chat_body = json!({
            "model": model,
            "messages": [{ "role": "user", "content": "Hi" }],
            "max_tokens": 16,
            "stream": false,
        });
        let chat_attempt = send_provider_test_attempt(
            &client,
            chat_endpoint,
            api_key,
            "chat_completions",
            chat_body,
        )
        .await;

        if chat_attempt.success {
            let responses_summary = provider_attempt_summary(&responses_attempt);
            return Ok(CodexProviderConnectionTestResult {
                ok: true,
                codex_ready: false,
                status: "chatOnly".to_string(),
                protocol: "chat_completions".to_string(),
                endpoint: chat_attempt.endpoint,
                http_status: chat_attempt.http_status,
                latency_ms: chat_attempt.latency_ms,
                ttfb_ms: chat_attempt.ttfb_ms,
                message: format!(
                    "Chat Completions 端点可用，但 Responses 探测失败（{}）。当前分身直连 Codex 使用 Responses wire_api，请改用 Responses 兼容端点或中转/代理。",
                    responses_summary
                ),
                response_preview: chat_attempt.body_preview,
            });
        }

        let responses_summary = provider_attempt_summary(&responses_attempt);
        let chat_summary = provider_attempt_summary(&chat_attempt);
        return Ok(CodexProviderConnectionTestResult {
            ok: false,
            codex_ready: false,
            status: "failed".to_string(),
            protocol: "responses".to_string(),
            endpoint: responses_attempt.endpoint,
            http_status: responses_attempt.http_status,
            latency_ms: responses_attempt.latency_ms,
            ttfb_ms: responses_attempt.ttfb_ms,
            message: format!(
                "Responses 和 Chat Completions 探测都失败：{}；{}。请检查 Base URL、API Key、模型名或网络。",
                responses_summary,
                chat_summary
            ),
            response_preview: responses_attempt
                .body_preview
                .or(chat_attempt.body_preview),
        });
    }

    let responses_summary = provider_attempt_summary(&responses_attempt);
    Ok(CodexProviderConnectionTestResult {
        ok: false,
        codex_ready: false,
        status: "failed".to_string(),
        protocol: "responses".to_string(),
        endpoint: responses_attempt.endpoint,
        http_status: responses_attempt.http_status,
        latency_ms: responses_attempt.latency_ms,
        ttfb_ms: responses_attempt.ttfb_ms,
        message: format!(
            "Responses 探测失败：{}。请检查 API Key 权限、Base URL 和模型名。",
            responses_summary
        ),
        response_preview: responses_attempt.body_preview,
    })
}

#[tauri::command]
pub async fn codex_fetch_provider_models(
    input: CodexProviderModelsFetchInput,
) -> Result<CodexProviderModelsFetchResult, String> {
    let base_url = normalize_provider_test_base_url(&input.base_url)?;
    let api_key = input.api_key.trim();
    if !api_key.is_empty() && reqwest::Url::parse(api_key).is_ok() {
        return Err("API Key 不能是 URL，请检查 Base URL 和 API Key 是否填反".to_string());
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(PROVIDER_MODELS_TIMEOUT_SECONDS))
        .build()
        .map_err(|error| format!("创建 provider models 客户端失败: {}", error))?;
    let endpoint = provider_test_endpoint(&base_url, "/models")?;
    let started = Instant::now();
    let mut request = client
        .get(&endpoint)
        .header(reqwest::header::ACCEPT, "application/json");
    if !api_key.is_empty() {
        request = request.bearer_auth(api_key);
    }

    let response = request.send().await;
    match response {
        Ok(response) => {
            let http_status = response.status().as_u16();
            let success = response.status().is_success();
            let text = response.text().await.map_err(|error| {
                format!("读取 provider models 响应失败 ({}): {}", endpoint, error)
            })?;
            let preview = provider_test_preview(&text, api_key);
            if !success {
                return Ok(CodexProviderModelsFetchResult {
                    ok: false,
                    status: "failed".to_string(),
                    endpoint,
                    http_status: Some(http_status),
                    latency_ms: elapsed_ms(started),
                    model_count: 0,
                    models: Vec::new(),
                    message: format!("models endpoint 返回 HTTP {}", http_status),
                    response_preview: preview,
                });
            }

            let payload = serde_json::from_str::<Value>(&text).map_err(|error| {
                format!("解析 provider models JSON 失败 ({}): {}", endpoint, error)
            })?;
            let mut models = parse_provider_model_payload(&payload);
            if models.len() > PROVIDER_MODELS_MAX_RETURNED {
                models.truncate(PROVIDER_MODELS_MAX_RETURNED);
            }
            let model_count = models.len();
            Ok(CodexProviderModelsFetchResult {
                ok: model_count > 0,
                status: if model_count > 0 { "ready" } else { "empty" }.to_string(),
                endpoint,
                http_status: Some(http_status),
                latency_ms: elapsed_ms(started),
                model_count,
                models,
                message: if model_count > 0 {
                    format!("models endpoint 返回 {} 个模型", model_count)
                } else {
                    "models endpoint 可访问，但未返回可识别的模型 ID".to_string()
                },
                response_preview: preview,
            })
        }
        Err(error) => Ok(CodexProviderModelsFetchResult {
            ok: false,
            status: "failed".to_string(),
            endpoint,
            http_status: None,
            latency_ms: elapsed_ms(started),
            model_count: 0,
            models: Vec::new(),
            message: format!("models endpoint 请求失败: {}", error),
            response_preview: None,
        }),
    }
}

#[tauri::command]
pub async fn codex_create_clone_and_launch(
    input: CodexCloneCreateInput,
) -> Result<CodexInstanceProfileView, String> {
    let account_id = resolve_clone_account_id(&input)?;
    let clone_goal = normalize_clone_goal(&input)?;
    let clone_prompt_pack = normalize_clone_prompt_pack(&input)?;
    let name = resolve_unique_clone_name(&input.name)?;
    let user_data_dir = resolve_unique_clone_user_data_dir(&name)?;
    let working_dir = normalize_optional_trimmed(input.working_dir.clone());
    let inherit_local_data = input.inherit_local_data.unwrap_or(false);

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
            launch_script: input.launch_script.clone(),
        })?;

    if inherit_local_data {
        modules::codex_sync_package::apply_sync_package_to_home(Path::new(
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
    write_clone_model_config(
        Path::new(&instance.user_data_dir),
        input.model.as_deref(),
        input.model_catalog_enabled.unwrap_or(false),
        input.model_catalog_models.as_deref(),
    )?;
    write_clone_goal_to_profile(Path::new(&instance.user_data_dir), clone_goal.as_deref())?;
    write_clone_prompt_pack_to_profile(
        Path::new(&instance.user_data_dir),
        clone_prompt_pack.as_deref(),
    )?;
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

#[tauri::command]
pub async fn codex_update_clone_capabilities(
    input: CodexCloneCapabilitiesUpdateInput,
) -> Result<CodexInstanceProfileView, String> {
    let instance_id = input.instance_id.trim();
    ensure_managed_instance_write_target(instance_id)?;
    let clone_goal = normalize_clone_goal_value(input.goal_enabled, input.goal.as_deref())?;
    let clone_prompt_pack = input
        .prompt_pack_enabled
        .map(|enabled| {
            normalize_clone_prompt_pack_value(enabled, input.prompt_pack.as_deref())
                .map(|value| (enabled, value))
        })
        .transpose()?;
    let store = modules::codex_instance::load_instance_store()?;
    let instance = store
        .instances
        .into_iter()
        .find(|item| item.id == instance_id)
        .ok_or_else(|| "instance not found".to_string())?;
    let profile_dir = Path::new(&instance.user_data_dir);
    if input.goal_enabled {
        write_clone_goal_to_profile(profile_dir, clone_goal.as_deref())?;
    } else {
        clear_clone_goal_from_profile(profile_dir)?;
    }
    if let Some((prompt_pack_enabled, prompt_pack)) = clone_prompt_pack {
        if prompt_pack_enabled {
            write_clone_prompt_pack_to_profile(profile_dir, prompt_pack.as_deref())?;
        } else {
            clear_clone_prompt_pack_from_profile(profile_dir)?;
        }
    }

    let process_entries = modules::process::collect_codex_process_entries();
    let resolved_pid = modules::process::resolve_codex_pid_from_entries(
        instance.last_pid,
        Some(&instance.user_data_dir),
        &process_entries,
    );
    let running = resolved_pid.is_some();
    let initialized = is_profile_initialized(&instance.user_data_dir);
    let mut view = CodexInstanceProfileView::from_profile(instance, running, initialized);
    view.last_pid = resolved_pid;
    Ok(view)
}

#[tauri::command]
pub async fn codex_export_clone_capability_snapshot(
    instance_id: String,
) -> Result<CodexCloneCapabilitySnapshotExportResult, String> {
    let instance_id = instance_id.trim();
    ensure_managed_instance_write_target(instance_id)?;
    let store = modules::codex_instance::load_instance_store()?;
    let instance = store
        .instances
        .into_iter()
        .find(|item| item.id == instance_id)
        .ok_or_else(|| "instance not found".to_string())?;
    export_clone_capability_snapshot_for_instance(&instance)
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

fn ensure_managed_instance_write_target(instance_id: &str) -> Result<(), String> {
    if instance_id == DEFAULT_INSTANCE_ID {
        return Err(
            "The default Codex home is read-only in clone sync flows. Extract a sync package from the main Codex module, then apply it to a managed clone."
                .to_string(),
        );
    }
    Ok(())
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
    if !dry_run {
        ensure_managed_instance_write_target(&instance_id)?;
    }
    let (codex_home, bind_account_id) = codex_home_and_bind_for_instance(&instance_id)?;
    let mut apply_warnings = Vec::new();
    if !dry_run {
        let apply_result =
            modules::codex_sync_package::apply_sync_package_to_home(Path::new(&codex_home))?;
        apply_warnings = apply_result.warnings;
        if let Some(ref account_id) = bind_account_id {
            modules::codex_instance::inject_account_to_profile(Path::new(&codex_home), account_id)
                .await?;
        }
    }
    let context = modules::codex_history_sync::CodexHistoryContext {
        bound_account_id: bind_account_id,
    };
    let mut result = modules::codex_history_sync::sync_to_current_provider_with_context(
        Path::new(&codex_home),
        dry_run,
        Some(&context),
    )?;
    for warning in apply_warnings {
        if !result.warnings.contains(&warning) {
            result.warnings.push(warning);
        }
    }
    Ok(result)
}

#[tauri::command]
pub async fn codex_history_repair(
    instance_id: String,
) -> Result<modules::codex_history_sync::CodexHistorySyncResult, String> {
    ensure_managed_instance_write_target(&instance_id)?;
    let (codex_home, bind_account_id) = codex_home_and_bind_for_instance(&instance_id)?;
    let apply_result =
        modules::codex_sync_package::apply_sync_package_to_home(Path::new(&codex_home))?;
    if let Some(ref account_id) = bind_account_id {
        modules::codex_instance::inject_account_to_profile(Path::new(&codex_home), account_id)
            .await?;
    }
    let context = modules::codex_history_sync::CodexHistoryContext {
        bound_account_id: bind_account_id,
    };
    let mut result = modules::codex_history_sync::sync_to_current_provider_with_context(
        Path::new(&codex_home),
        false,
        Some(&context),
    )?;
    for warning in apply_result.warnings {
        if !result.warnings.contains(&warning) {
            result.warnings.push(warning);
        }
    }
    let _ =
        modules::codex_history_sync::verify_with_context(Path::new(&codex_home), Some(&context))?;
    Ok(result)
}

#[tauri::command]
pub async fn codex_list_recent_sessions(
    instance_id: String,
    limit: Option<usize>,
) -> Result<Vec<CodexSessionSummary>, String> {
    if instance_id == DEFAULT_INSTANCE_ID {
        return Err("默认本体会话不在分身会话列表入口处理；请在受管分身上查看会话。".to_string());
    }
    let codex_home = codex_home_for_instance(&instance_id)?;
    list_recent_sessions_from_home(Path::new(&codex_home), limit.unwrap_or(8))
}

#[tauri::command]
pub async fn codex_scan_session_usage(
    instance_id: String,
) -> Result<CodexSessionUsageSummary, String> {
    if instance_id == DEFAULT_INSTANCE_ID {
        return Err(
            "默认 Codex 本体用量不在分身扫描入口处理；请在受管分身上查看会话用量。".to_string(),
        );
    }
    let codex_home = codex_home_for_instance(&instance_id)?;
    scan_session_usage_from_home(Path::new(&codex_home))
}

#[tauri::command]
pub async fn codex_export_recent_sessions_markdown(
    instance_id: String,
    limit: Option<usize>,
) -> Result<Vec<CodexSessionExportResult>, String> {
    if instance_id == DEFAULT_INSTANCE_ID {
        return Err(
            "默认本体会话不在分身导出入口处理；请在受管分身上执行 Markdown 导出。".to_string(),
        );
    }
    let codex_home = codex_home_for_instance(&instance_id)?;
    export_recent_sessions_markdown_from_home(Path::new(&codex_home), limit.unwrap_or(5))
}

fn list_recent_sessions_from_home(
    codex_home: &Path,
    limit: usize,
) -> Result<Vec<CodexSessionSummary>, String> {
    let rows = query_recent_session_rows(codex_home, limit)?;
    let mut sessions = Vec::new();
    for row in rows {
        let RecentSessionRow {
            session_id,
            raw_title,
            rollout_path,
            project_dir,
        } = row;
        let rollout = PathBuf::from(&rollout_path);
        let rollout_exists = rollout.is_file();
        let messages = if rollout_exists {
            load_rollout_messages(&rollout).unwrap_or_default()
        } else {
            Vec::new()
        };
        let last_message_at = messages
            .iter()
            .rev()
            .find_map(|message| message.timestamp.clone());
        let project_dir = normalize_session_optional_string(project_dir)
            .or_else(|| extract_rollout_project_dir(&rollout).unwrap_or(None));
        sessions.push(CodexSessionSummary {
            session_id: session_id.clone(),
            title: display_export_title(&raw_title, &session_id),
            rollout_path,
            project_dir,
            summary: session_summary_from_messages(&messages),
            search_preview: session_search_preview_from_messages(&messages),
            message_count: messages.len(),
            last_message_at,
            rollout_exists,
        });
    }
    Ok(sessions)
}

fn scan_session_usage_from_home(codex_home: &Path) -> Result<CodexSessionUsageSummary, String> {
    let files = collect_codex_session_usage_files(codex_home);
    let mut total = UsageAccumulator::default();
    let mut by_model: BTreeMap<String, UsageAccumulator> = BTreeMap::new();
    let mut first_event_at: Option<String> = None;
    let mut last_event_at: Option<String> = None;
    let mut parsed_files = 0usize;
    let mut warnings = Vec::new();

    for file in &files {
        match scan_session_usage_file(
            file,
            &mut total,
            &mut by_model,
            &mut first_event_at,
            &mut last_event_at,
        ) {
            Ok(true) => parsed_files += 1,
            Ok(false) => {}
            Err(error) => {
                if warnings.len() < 12 {
                    warnings.push(format!("{}: {}", file.display(), error));
                }
            }
        }
    }

    let mut models = by_model
        .into_iter()
        .map(|(model, usage)| CodexSessionUsageModelSummary {
            model,
            event_count: usage.event_count,
            input_tokens: usage.input_tokens,
            cached_input_tokens: usage.cached_input_tokens,
            output_tokens: usage.output_tokens,
            total_tokens: usage.total_tokens(),
        })
        .collect::<Vec<_>>();
    models.sort_by(|a, b| {
        b.total_tokens
            .cmp(&a.total_tokens)
            .then_with(|| a.model.cmp(&b.model))
    });

    Ok(CodexSessionUsageSummary {
        codex_home: codex_home.to_string_lossy().to_string(),
        scanned_files: files.len(),
        parsed_files,
        event_count: total.event_count,
        input_tokens: total.input_tokens,
        cached_input_tokens: total.cached_input_tokens,
        output_tokens: total.output_tokens,
        total_tokens: total.total_tokens(),
        first_event_at,
        last_event_at,
        by_model: models,
        warnings,
    })
}

fn collect_codex_session_usage_files(codex_home: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    collect_jsonl_recursive(&codex_home.join("sessions"), &mut files, 0, 8);
    collect_jsonl_recursive(&codex_home.join("archived_sessions"), &mut files, 0, 4);
    files.sort_by(|a, b| a.to_string_lossy().cmp(&b.to_string_lossy()));
    files
}

fn collect_jsonl_recursive(dir: &Path, files: &mut Vec<PathBuf>, depth: u8, max_depth: u8) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if depth < max_depth {
                collect_jsonl_recursive(&path, files, depth + 1, max_depth);
            }
        } else if path.extension().and_then(|value| value.to_str()) == Some("jsonl") {
            files.push(path);
        }
    }
}

fn scan_session_usage_file(
    path: &Path,
    total: &mut UsageAccumulator,
    by_model: &mut BTreeMap<String, UsageAccumulator>,
    first_event_at: &mut Option<String>,
    last_event_at: &mut Option<String>,
) -> Result<bool, String> {
    let file = fs::File::open(path).map_err(|error| format!("打开会话日志失败: {}", error))?;
    let reader = BufReader::new(file);
    let mut state = UsageParseState::default();
    let mut parsed_any = false;

    for line_result in reader.lines() {
        let Ok(line) = line_result else {
            continue;
        };
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if !line.contains("\"token_count\"")
            && !line.contains("\"turn_context\"")
            && !line.contains("\"session_meta\"")
        {
            continue;
        }
        let Ok(event) = serde_json::from_str::<Value>(line) else {
            continue;
        };

        if let Some(model) = extract_usage_model(&event) {
            state.current_model = normalize_usage_model(&model);
        }

        if !is_token_count_event(&event) {
            continue;
        }

        let Some((tokens, is_cumulative)) = extract_token_usage(&event) else {
            continue;
        };
        let mut delta = if is_cumulative {
            let delta = compute_token_delta(state.previous_total.as_ref(), &tokens);
            state.previous_total = Some(tokens);
            delta
        } else {
            DeltaTokenUsage {
                input: tokens.input,
                cached_input: tokens.cached_input,
                output: tokens.output,
            }
        };
        delta.cached_input = delta.cached_input.min(delta.input);
        if delta.is_zero() {
            continue;
        }

        parsed_any = true;
        total.add(&delta);
        by_model
            .entry(state.current_model.clone())
            .or_default()
            .add(&delta);
        if let Some(timestamp) = event.get("timestamp").and_then(Value::as_str) {
            update_usage_timestamp(first_event_at, timestamp, true);
            update_usage_timestamp(last_event_at, timestamp, false);
        }
    }

    Ok(parsed_any)
}

fn is_token_count_event(event: &Value) -> bool {
    event
        .get("payload")
        .and_then(|payload| payload.get("type"))
        .and_then(Value::as_str)
        == Some("token_count")
}

fn extract_token_usage(event: &Value) -> Option<(CumulativeTokenUsage, bool)> {
    let info = event.get("payload")?.get("info")?;
    if let Some(total) = info.get("total_token_usage") {
        parse_cumulative_token_usage(total).map(|tokens| (tokens, true))
    } else if let Some(last) = info.get("last_token_usage") {
        parse_cumulative_token_usage(last).map(|tokens| (tokens, false))
    } else if info.get("input_tokens").is_some() || info.get("output_tokens").is_some() {
        parse_cumulative_token_usage(info).map(|tokens| (tokens, false))
    } else {
        None
    }
}

fn parse_cumulative_token_usage(value: &Value) -> Option<CumulativeTokenUsage> {
    if !value.is_object() {
        return None;
    }
    let input = number_at_any(value, &["input_tokens", "prompt_tokens"])?;
    let cached_input = number_at_any(
        value,
        &[
            "cached_input_tokens",
            "cache_read_input_tokens",
            "/input_tokens_details/cached_tokens",
            "/prompt_tokens_details/cached_tokens",
        ],
    )
    .unwrap_or(0);
    let output = number_at_any(value, &["output_tokens", "completion_tokens"]).unwrap_or(0);
    Some(CumulativeTokenUsage {
        input,
        cached_input,
        output,
    })
}

fn number_at_any(value: &Value, keys: &[&str]) -> Option<u64> {
    keys.iter().find_map(|key| {
        let field = if key.starts_with('/') {
            value.pointer(key)
        } else {
            value.get(key)
        }?;
        field.as_u64().or_else(|| {
            field
                .as_f64()
                .filter(|number| number.is_finite() && *number >= 0.0)
                .map(|number| number as u64)
        })
    })
}

fn compute_token_delta(
    previous: Option<&CumulativeTokenUsage>,
    current: &CumulativeTokenUsage,
) -> DeltaTokenUsage {
    match previous {
        None => DeltaTokenUsage {
            input: current.input,
            cached_input: current.cached_input,
            output: current.output,
        },
        Some(previous) => DeltaTokenUsage {
            input: current.input.saturating_sub(previous.input),
            cached_input: current.cached_input.saturating_sub(previous.cached_input),
            output: current.output.saturating_sub(previous.output),
        },
    }
}

fn extract_usage_model(event: &Value) -> Option<String> {
    let payload = event.get("payload")?;
    payload
        .get("model")
        .or_else(|| payload.get("info").and_then(|info| info.get("model")))
        .or_else(|| payload.get("info").and_then(|info| info.get("model_name")))
        .and_then(Value::as_str)
        .map(ToString::to_string)
}

fn normalize_usage_model(raw: &str) -> String {
    let mut name = raw.trim().to_ascii_lowercase();
    if let Some((_, suffix)) = name.rsplit_once('/') {
        name = suffix.to_string();
    }
    if name.len() > 11 {
        let suffix = &name[name.len() - 11..];
        if suffix.as_bytes()[0] == b'-'
            && suffix[1..5].chars().all(|ch| ch.is_ascii_digit())
            && suffix.as_bytes()[5] == b'-'
            && suffix[6..8].chars().all(|ch| ch.is_ascii_digit())
            && suffix.as_bytes()[8] == b'-'
            && suffix[9..11].chars().all(|ch| ch.is_ascii_digit())
        {
            name.truncate(name.len() - 11);
        }
    }
    if let Some((prefix, suffix)) = name.rsplit_once('-') {
        if suffix.len() == 8 && suffix.chars().all(|ch| ch.is_ascii_digit()) {
            name = prefix.to_string();
        }
    }
    if name.is_empty() {
        "unknown".to_string()
    } else {
        name
    }
}

fn update_usage_timestamp(target: &mut Option<String>, candidate: &str, keep_first: bool) {
    let candidate = candidate.trim();
    if candidate.is_empty() {
        return;
    }
    let should_replace = match target.as_deref() {
        None => true,
        Some(existing) if keep_first => candidate < existing,
        Some(existing) => candidate > existing,
    };
    if should_replace {
        *target = Some(candidate.to_string());
    }
}

fn export_recent_sessions_markdown_from_home(
    codex_home: &Path,
    limit: usize,
) -> Result<Vec<CodexSessionExportResult>, String> {
    let bounded_limit = limit.clamp(1, 20);
    let db_path = codex_home.join("state_5.sqlite");
    if !db_path.is_file() {
        return Err(format!("分身历史数据库不存在: {}", db_path.display()));
    }
    let conn =
        Connection::open(&db_path).map_err(|error| format!("打开分身历史数据库失败: {}", error))?;
    if !supports_threads_for_export(&conn)? {
        return Err(
            "当前 state_5.sqlite 不包含可导出的 threads(id,title,rollout_path) 结构".to_string(),
        );
    }

    let mut stmt = conn
        .prepare(
            "SELECT id, title, rollout_path FROM threads \
             WHERE rollout_path IS NOT NULL AND trim(rollout_path) <> '' \
             ORDER BY COALESCE(updated_at, created_at, last_updated_at, 0) DESC, rowid DESC \
             LIMIT ?1",
        )
        .or_else(|_| {
            conn.prepare(
                "SELECT id, title, rollout_path FROM threads \
                 WHERE rollout_path IS NOT NULL AND trim(rollout_path) <> '' \
                 ORDER BY rowid DESC LIMIT ?1",
            )
        })
        .map_err(|error| format!("查询分身会话失败: {}", error))?;
    let rows = stmt
        .query_map([bounded_limit as i64], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(|error| format!("读取分身会话失败: {}", error))?;

    let export_dir = session_export_dir(codex_home)?;
    fs::create_dir_all(&export_dir)
        .map_err(|error| format!("创建 Markdown 导出目录失败: {}", error))?;
    let mut exported = Vec::new();
    for row in rows {
        let (session_id, raw_title, rollout_path) =
            row.map_err(|error| format!("解析分身会话行失败: {}", error))?;
        let rollout = PathBuf::from(&rollout_path);
        if !rollout.is_file() {
            continue;
        }
        let messages = load_rollout_messages(&rollout)?;
        if messages.is_empty() {
            continue;
        }
        let title = display_export_title(&raw_title, &session_id);
        let filename = build_markdown_filename(&title, &session_id);
        let target = unique_export_path(&export_dir, &filename);
        let markdown = render_session_markdown(&title, &session_id, &messages);
        fs::write(&target, markdown)
            .map_err(|error| format!("写入 Markdown 导出失败: {}", error))?;
        exported.push(CodexSessionExportResult {
            session_id,
            title,
            exported_path: target.to_string_lossy().to_string(),
            message_count: messages.len(),
        });
    }
    if exported.is_empty() {
        return Err("未找到可导出的分身会话；请先同步/修复或在分身中新开对话。".to_string());
    }
    Ok(exported)
}

fn query_recent_session_rows(
    codex_home: &Path,
    limit: usize,
) -> Result<Vec<RecentSessionRow>, String> {
    let bounded_limit = limit.clamp(1, 50);
    let db_path = codex_home.join("state_5.sqlite");
    if !db_path.is_file() {
        return Err(format!("分身历史数据库不存在: {}", db_path.display()));
    }
    let conn =
        Connection::open(&db_path).map_err(|error| format!("打开分身历史数据库失败: {}", error))?;
    if !supports_threads_for_export(&conn)? {
        return Err(
            "当前 state_5.sqlite 不包含可读取的 threads(id,title,rollout_path) 结构".to_string(),
        );
    }
    let columns = read_threads_columns(&conn)?;
    let project_expr = session_project_dir_sql_expr(&columns);

    let mut stmt = conn
        .prepare(&format!(
            "SELECT id, title, rollout_path, {project_expr} FROM threads \
             WHERE rollout_path IS NOT NULL AND trim(rollout_path) <> '' \
             ORDER BY COALESCE(updated_at, created_at, last_updated_at, 0) DESC, rowid DESC \
             LIMIT ?1"
        ))
        .or_else(|_| {
            conn.prepare(&format!(
                "SELECT id, title, rollout_path, {project_expr} FROM threads \
                 WHERE rollout_path IS NOT NULL AND trim(rollout_path) <> '' \
                 ORDER BY rowid DESC LIMIT ?1"
            ))
        })
        .map_err(|error| format!("查询分身会话失败: {}", error))?;
    let rows = stmt
        .query_map([bounded_limit as i64], |row| {
            Ok(RecentSessionRow {
                session_id: row.get::<_, String>(0)?,
                raw_title: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                rollout_path: row.get::<_, String>(2)?,
                project_dir: row.get::<_, Option<String>>(3)?,
            })
        })
        .map_err(|error| format!("读取分身会话失败: {}", error))?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|error| format!("解析分身会话行失败: {}", error))?;
    Ok(rows)
}

fn supports_threads_for_export(conn: &Connection) -> Result<bool, String> {
    let has_threads = conn
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'threads'",
            [],
            |_| Ok(()),
        )
        .is_ok();
    if !has_threads {
        return Ok(false);
    }
    let columns = read_threads_columns(conn)?;
    Ok(["id", "title", "rollout_path"]
        .iter()
        .all(|column| columns.iter().any(|existing| existing == column)))
}

fn read_threads_columns(conn: &Connection) -> Result<Vec<String>, String> {
    let mut stmt = conn
        .prepare("PRAGMA table_info(\"threads\")")
        .map_err(|error| format!("读取 threads 结构失败: {}", error))?;
    let columns = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| format!("读取 threads 字段失败: {}", error))?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|error| format!("解析 threads 字段失败: {}", error))?;
    Ok(columns)
}

fn session_project_dir_sql_expr(columns: &[String]) -> &'static str {
    for candidate in [
        "cwd",
        "project_dir",
        "projectDir",
        "working_dir",
        "workingDir",
    ] {
        if columns.iter().any(|column| column == candidate) {
            return match candidate {
                "cwd" => "cwd",
                "project_dir" => "project_dir",
                "projectDir" => "projectDir",
                "working_dir" => "working_dir",
                "workingDir" => "workingDir",
                _ => "NULL",
            };
        }
    }
    "NULL"
}

fn session_export_dir(codex_home: &Path) -> Result<PathBuf, String> {
    let base = dirs::download_dir()
        .or_else(dirs::document_dir)
        .or_else(dirs::home_dir)
        .ok_or("无法获取导出目录")?;
    let leaf = codex_home
        .file_name()
        .and_then(|value| value.to_str())
        .map(|value| safe_filename(value, "codex-clone"))
        .unwrap_or_else(|| "codex-clone".to_string());
    Ok(base.join("Codex Clone Session Exports").join(leaf))
}

fn load_rollout_messages(path: &Path) -> Result<Vec<ExportMessage>, String> {
    let text = fs::read_to_string(path)
        .map_err(|error| format!("读取 rollout 文件失败 ({}): {}", path.display(), error))?;
    let mut messages = Vec::new();
    for raw in text.lines().filter(|line| !line.trim().is_empty()) {
        let Ok(event) = serde_json::from_str::<Value>(raw) else {
            continue;
        };
        if event.get("type").and_then(Value::as_str) != Some("response_item") {
            continue;
        }
        let payload = &event["payload"];
        if payload.get("type").and_then(Value::as_str) != Some("message") {
            continue;
        }
        let speaker = match payload
            .get("role")
            .and_then(Value::as_str)
            .unwrap_or_default()
        {
            "user" => "User",
            "assistant" => "Assistant",
            _ => continue,
        };
        let body = serialize_message_content(&payload["content"]);
        if body.trim().is_empty() {
            continue;
        }
        messages.push(ExportMessage {
            speaker,
            timestamp: format_export_timestamp(event.get("timestamp")),
            body,
        });
    }
    Ok(messages)
}

fn extract_rollout_project_dir(path: &Path) -> Result<Option<String>, String> {
    if !path.is_file() {
        return Ok(None);
    }
    let file = fs::File::open(path)
        .map_err(|error| format!("打开 rollout 文件失败 ({}): {}", path.display(), error))?;
    let reader = BufReader::new(file);
    for line in reader.lines().map_while(Result::ok) {
        let line = line.trim();
        if line.is_empty()
            || !["cwd", "project", "working", "workspace", "rootPath"]
                .iter()
                .any(|needle| line.contains(needle))
        {
            continue;
        }
        let Ok(event) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        if let Some(project_dir) = first_string_at_any(
            &event,
            &[
                "/payload/cwd",
                "/payload/project_dir",
                "/payload/projectDir",
                "/payload/working_dir",
                "/payload/workingDir",
                "/payload/workspaceRoot",
                "/payload/rootPath",
                "/cwd",
            ],
        ) {
            return Ok(Some(project_dir));
        }
    }
    Ok(None)
}

fn first_string_at_any(value: &Value, pointers: &[&str]) -> Option<String> {
    pointers
        .iter()
        .filter_map(|pointer| value.pointer(pointer).and_then(Value::as_str))
        .find_map(|value| normalize_session_optional_string(Some(value.to_string())))
}

fn normalize_session_optional_string(value: Option<String>) -> Option<String> {
    let normalized = value?.split_whitespace().collect::<Vec<_>>().join(" ");
    (!normalized.is_empty()).then_some(normalized)
}

fn session_summary_from_messages(messages: &[ExportMessage]) -> Option<String> {
    messages
        .iter()
        .find(|message| message.speaker == "User")
        .or_else(|| messages.first())
        .and_then(|message| clip_session_text(&message.body, 180))
}

fn session_search_preview_from_messages(messages: &[ExportMessage]) -> Option<String> {
    let preview = messages
        .iter()
        .take(4)
        .filter_map(|message| {
            let body = clip_session_text(&message.body, 90)?;
            Some(format!("{}: {}", message.speaker, body))
        })
        .collect::<Vec<_>>()
        .join(" | ");
    clip_session_text(&preview, 420)
}

fn clip_session_text(value: &str, limit: usize) -> Option<String> {
    let normalized = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.is_empty() {
        return None;
    }
    if normalized.chars().count() <= limit {
        Some(normalized)
    } else {
        let mut clipped = normalized.chars().take(limit).collect::<String>();
        clipped.push_str("...");
        Some(clipped)
    }
}

fn serialize_message_content(content: &Value) -> String {
    let Some(items) = content.as_array() else {
        return String::new();
    };
    items
        .iter()
        .filter_map(|block| {
            let block_type = block.get("type").and_then(Value::as_str)?;
            match block_type {
                "input_text" | "output_text" => {
                    let text = block
                        .get("text")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .replace("\r\n", "\n")
                        .replace('\r', "\n")
                        .trim_matches('\n')
                        .to_string();
                    (!text.trim().is_empty()).then_some(text)
                }
                "input_image" => {
                    let image_url = block
                        .get("image_url")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .trim();
                    if image_url.is_empty() || image_url.starts_with("data:") {
                        Some("> Image attachment".to_string())
                    } else {
                        Some(format!("> Image attachment\n[Image link](<{image_url}>)"))
                    }
                }
                _ => None,
            }
        })
        .collect::<Vec<_>>()
        .join("\n\n")
}

fn format_export_timestamp(value: Option<&Value>) -> Option<String> {
    let raw = value?.as_str()?.trim();
    if raw.is_empty() {
        return None;
    }
    let normalized = raw
        .strip_suffix('Z')
        .map_or_else(|| raw.to_string(), |prefix| format!("{prefix}+00:00"));
    chrono::DateTime::parse_from_rfc3339(&normalized)
        .ok()
        .map(|parsed| {
            parsed
                .with_timezone(&chrono::Local)
                .format("%Y-%m-%d %H:%M:%S")
                .to_string()
        })
}

fn display_export_title(raw_title: &str, session_id: &str) -> String {
    let normalized = raw_title.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.is_empty() {
        format!("Codex session {}", short_session_id(session_id))
    } else {
        normalized
    }
}

fn short_session_id(session_id: &str) -> String {
    session_id.chars().take(12).collect()
}

fn safe_filename(value: &str, fallback: &str) -> String {
    let cleaned = value
        .chars()
        .map(|ch| match ch {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => ' ',
            ch if ch.is_control() => ' ',
            ch => ch,
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim_matches([' ', '.'])
        .chars()
        .take(90)
        .collect::<String>()
        .trim_matches([' ', '.'])
        .to_string();
    if cleaned.is_empty() {
        fallback.to_string()
    } else {
        cleaned
    }
}

fn build_markdown_filename(title: &str, session_id: &str) -> String {
    format!(
        "{}-{}.md",
        safe_filename(title, "Codex session"),
        safe_filename(&short_session_id(session_id), "session")
    )
}

fn unique_export_path(dir: &Path, filename: &str) -> PathBuf {
    let candidate = dir.join(filename);
    if !candidate.exists() {
        return candidate;
    }
    let stem = filename.trim_end_matches(".md");
    for index in 2..1000 {
        let next = dir.join(format!("{stem}-{index}.md"));
        if !next.exists() {
            return next;
        }
    }
    dir.join(format!(
        "{stem}-{}.md",
        chrono::Local::now().timestamp_millis()
    ))
}

fn render_session_markdown(title: &str, session_id: &str, messages: &[ExportMessage]) -> String {
    let mut lines = vec![
        format!("# {title}"),
        String::new(),
        format!("- Session: `{session_id}`"),
        format!(
            "- Exported: {}",
            chrono::Local::now().format("%Y-%m-%d %H:%M:%S")
        ),
        String::new(),
    ];
    for message in messages {
        lines.push(format!("## {}", message.speaker));
        if let Some(timestamp) = &message.timestamp {
            lines.push(format!("_{timestamp}_"));
        }
        lines.push(String::new());
        lines.push(message.body.trim_end().to_string());
        lines.push(String::new());
    }
    format!("{}\n", lines.join("\n").trim_end())
}

#[tauri::command]
pub async fn codex_sync_package_status(
) -> Result<modules::codex_sync_package::CodexSyncPackageStatus, String> {
    modules::codex_sync_package::status()
}

#[tauri::command]
pub async fn codex_sync_package_backups(
) -> Result<Vec<modules::codex_sync_package::CodexSyncPackageBackupSummary>, String> {
    modules::codex_sync_package::list_sync_package_backups()
}

#[tauri::command]
pub async fn codex_sync_package_preflight(
) -> Result<modules::codex_sync_package::CodexSyncPackagePreflightReport, String> {
    modules::codex_sync_package::preflight_sync_package()
}

#[tauri::command]
pub async fn codex_restore_sync_package_backup(
    backup_id: String,
) -> Result<modules::codex_sync_package::CodexSyncPackageStatus, String> {
    modules::codex_sync_package::restore_sync_package_backup(&backup_id)
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
    ensure_managed_instance_write_target(&instance_id)?;
    let codex_home = codex_home_for_instance(&instance_id)?;
    modules::codex_sync_package::apply_sync_package_to_home(Path::new(&codex_home))
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
    let launch_script_path = modules::codex_instance::prepare_instance_launch_script(&instance)?;
    let mut extra_env: Vec<(String, String)> = Vec::new();
    if let Some(goal_path) = ensure_clone_goal_for_launch(Path::new(&instance.user_data_dir))? {
        extra_env.push(("CODEX_CLONE_PURSUIT_GOAL".to_string(), "1".to_string()));
        extra_env.push((
            "CODEX_CLONE_GOAL_FILE".to_string(),
            goal_path.to_string_lossy().to_string(),
        ));
    }
    if let Some(prompt_pack_path) =
        ensure_clone_prompt_pack_for_launch(Path::new(&instance.user_data_dir))?
    {
        extra_env.push(("CODEX_CLONE_PROMPT_PACK".to_string(), "1".to_string()));
        extra_env.push((
            "CODEX_CLONE_PROMPT_PACK_FILE".to_string(),
            prompt_pack_path.to_string_lossy().to_string(),
        ));
    }
    if let Some(path) = launch_script_path {
        let path = path.to_string_lossy().to_string();
        extra_env.push(("CODEX_CLONE_LAUNCH_SCRIPT".to_string(), path.clone()));
        extra_env.push(("CODEX_PLUS_PLUS_LAUNCH_SCRIPT".to_string(), path));
        extra_env.push((
            "CODEX_CLONE_LAUNCH_SCRIPT_MODE".to_string(),
            "external-cdp-compatible".to_string(),
        ));
    }
    let extra_args = modules::process::parse_extra_args(&instance.extra_args);
    let pid =
        modules::process::start_codex_with_args(&instance.user_data_dir, &extra_args, &extra_env)?;
    let updated = modules::codex_instance::update_instance_after_start(&instance.id, pid)?;
    let running = modules::process::is_pid_running(pid);
    let initialized = is_profile_initialized(&updated.user_data_dir);
    Ok(CodexInstanceProfileView::from_profile(
        updated,
        running,
        initialized,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clone_create_does_not_inherit_local_data_by_default() {
        let input = CodexCloneCreateInput {
            name: "test".to_string(),
            auth_type: "apiKey".to_string(),
            launch_after_create: None,
            inherit_local_data: None,
            model: None,
            model_catalog_enabled: None,
            model_catalog_models: None,
            working_dir: None,
            launch_script: None,
            goal_enabled: None,
            goal: None,
            prompt_pack_enabled: None,
            prompt_pack: None,
            api_key_config: None,
            official_account_id: None,
        };

        assert!(!input.inherit_local_data.unwrap_or(false));
        assert!(normalize_clone_goal(&input)
            .expect("normalize goal")
            .is_none());
        assert!(normalize_clone_prompt_pack(&input)
            .expect("normalize prompt pack")
            .is_none());
    }

    #[test]
    fn clone_model_catalog_writes_codex_catalog_json_and_config() {
        let root = std::env::temp_dir().join(format!(
            "codex-clone-model-catalog-test-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&root).expect("create temp dir");
        let catalog_models = vec![
            "gpt-5-mini".to_string(),
            "GPT-5".to_string(),
            " ".to_string(),
            "gpt-5-mini".to_string(),
        ];

        write_clone_model_config(&root, Some("gpt-5"), true, Some(&catalog_models))
            .expect("write model catalog");

        let (enabled, catalog_path, catalog_count) = clone_model_catalog_status(&root);
        assert!(enabled);
        assert_eq!(catalog_count, 2);
        assert_eq!(
            catalog_path
                .as_deref()
                .and_then(|path| Path::new(path).file_name())
                .and_then(|name| name.to_str()),
            Some(CLONE_MODEL_CATALOG_FILE_NAME)
        );
        let config = fs::read_to_string(root.join("config.toml")).expect("read config");
        assert!(config.contains("model = \"gpt-5\""));
        assert!(config.contains("model_catalog_json = \"model-catalog.json\""));
        let catalog =
            fs::read_to_string(root.join(CLONE_MODEL_CATALOG_FILE_NAME)).expect("read catalog");
        let payload: Value = serde_json::from_str(&catalog).expect("parse catalog");
        let slugs = payload["models"]
            .as_array()
            .expect("models array")
            .iter()
            .filter_map(|item| item["slug"].as_str())
            .collect::<Vec<_>>();
        assert_eq!(slugs, vec!["gpt-5", "gpt-5-mini"]);
        assert!(catalog.contains("\"supported_in_api\": true"));
        assert!(!catalog.contains("api_key"));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn clone_goal_writes_sidecar_and_replaces_agents_block() {
        let root =
            std::env::temp_dir().join(format!("codex-clone-goal-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).expect("create temp dir");
        fs::write(
            root.join("AGENTS.md"),
            "# Existing\n\nKeep Chinese replies.",
        )
        .expect("write agents");

        write_clone_goal_to_profile(&root, Some("完成 provider 融合\n并持续验证"))
            .expect("write clone goal");
        write_clone_goal_to_profile(&root, Some("完成 provider 融合\n并持续验证"))
            .expect("rewrite clone goal");

        let goal = fs::read_to_string(root.join(CLONE_GOAL_FILE_NAME)).expect("read goal");
        assert!(goal.contains("完成 provider 融合"));
        let marker =
            fs::read_to_string(root.join(CLONE_GOAL_MARKER_FILE_NAME)).expect("read marker");
        assert!(marker.contains("\"enabled\": true"));
        let agents = fs::read_to_string(root.join("AGENTS.md")).expect("read agents");
        assert!(agents.contains("# Existing"));
        assert!(agents.contains(CLONE_GOAL_AGENTS_BEGIN));
        assert_eq!(agents.matches(CLONE_GOAL_AGENTS_BEGIN).count(), 1);
        assert_eq!(agents.matches(CLONE_GOAL_AGENTS_END).count(), 1);

        let launch_goal = ensure_clone_goal_for_launch(&root)
            .expect("ensure launch goal")
            .expect("goal path");
        assert_eq!(
            launch_goal.file_name().and_then(|name| name.to_str()),
            Some(CLONE_GOAL_FILE_NAME)
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn clone_goal_clear_removes_sidecar_and_managed_agents_block() {
        let root = std::env::temp_dir().join(format!(
            "codex-clone-goal-clear-test-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&root).expect("create temp dir");
        fs::write(
            root.join("AGENTS.md"),
            "# Existing\n\nKeep Chinese replies.",
        )
        .expect("write agents");

        write_clone_goal_to_profile(&root, Some("持续完成目标")).expect("write goal");
        clear_clone_goal_from_profile(&root).expect("clear goal");

        assert!(!root.join(CLONE_GOAL_FILE_NAME).exists());
        assert!(!root.join(CLONE_GOAL_MARKER_FILE_NAME).exists());
        let agents = fs::read_to_string(root.join("AGENTS.md")).expect("read agents");
        assert!(agents.contains("# Existing"));
        assert!(!agents.contains(CLONE_GOAL_AGENTS_BEGIN));
        assert!(ensure_clone_goal_for_launch(&root)
            .expect("ensure launch goal")
            .is_none());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn clone_prompt_pack_writes_sidecar_and_replaces_agents_block() {
        let root = std::env::temp_dir().join(format!(
            "codex-clone-prompt-pack-test-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&root).expect("create temp dir");
        fs::write(
            root.join("AGENTS.md"),
            "# Existing\n\nKeep Chinese replies.",
        )
        .expect("write agents");

        let prompt_pack =
            "## Code Review\n\nCheck regressions first.\n\n## Debug\n\nReproduce before editing.";
        write_clone_prompt_pack_to_profile(&root, Some(prompt_pack)).expect("write prompt pack");
        write_clone_prompt_pack_to_profile(&root, Some(prompt_pack)).expect("rewrite prompt pack");

        let prompt_file =
            fs::read_to_string(root.join(CLONE_PROMPT_PACK_FILE_NAME)).expect("read prompt pack");
        assert!(prompt_file.contains("Check regressions first."));
        let marker =
            fs::read_to_string(root.join(CLONE_PROMPT_PACK_MARKER_FILE_NAME)).expect("read marker");
        assert!(marker.contains("\"enabled\": true"));
        let agents = fs::read_to_string(root.join("AGENTS.md")).expect("read agents");
        assert!(agents.contains("# Existing"));
        assert!(agents.contains(CLONE_PROMPT_PACK_AGENTS_BEGIN));
        assert_eq!(agents.matches(CLONE_PROMPT_PACK_AGENTS_BEGIN).count(), 1);
        assert_eq!(agents.matches(CLONE_PROMPT_PACK_AGENTS_END).count(), 1);

        fs::write(root.join("AGENTS.md"), "# Existing\n").expect("simulate sync overwrite");
        let launch_prompt_pack = ensure_clone_prompt_pack_for_launch(&root)
            .expect("ensure launch prompt pack")
            .expect("prompt pack path");
        assert_eq!(
            launch_prompt_pack
                .file_name()
                .and_then(|name| name.to_str()),
            Some(CLONE_PROMPT_PACK_FILE_NAME)
        );
        let agents = fs::read_to_string(root.join("AGENTS.md")).expect("read launch agents");
        assert!(agents.contains(CLONE_PROMPT_PACK_AGENTS_BEGIN));
        assert!(agents.contains("Check regressions first."));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn clone_capability_snapshot_exports_safe_metadata_without_secrets() {
        let root = std::env::temp_dir().join(format!(
            "codex-clone-capability-snapshot-test-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&root).expect("create temp dir");
        let catalog_models = vec![
            "gpt-5-mini".to_string(),
            "GPT-5".to_string(),
            "gpt-5-mini".to_string(),
        ];
        write_clone_model_config(&root, Some("gpt-5"), true, Some(&catalog_models))
            .expect("write model config");
        write_clone_goal_to_profile(&root, Some("持续融合能力并验证构建")).expect("write goal");
        write_clone_prompt_pack_to_profile(&root, Some("## Debug\n\nReproduce before editing."))
            .expect("write prompt pack");

        let instance = InstanceProfile {
            id: "clone-snapshot-test".to_string(),
            name: "Snapshot Clone".to_string(),
            user_data_dir: root.to_string_lossy().to_string(),
            working_dir: Some("C:\\workspace\\demo".to_string()),
            extra_args: String::new(),
            launch_script: Some("window.secret = 'sk-secret-should-not-export';".to_string()),
            bind_account_id: None,
            launch_mode: InstanceLaunchMode::App,
            app_speed: CodexAppSpeed::Standard,
            created_at: 0,
            last_launched_at: None,
            last_pid: None,
        };

        let exported = export_clone_capability_snapshot_for_instance(&instance)
            .expect("export capability snapshot");
        assert!(Path::new(&exported.exported_path).is_file());
        assert_eq!(exported.snapshot.provider.model.as_deref(), Some("gpt-5"));
        assert_eq!(
            exported.snapshot.capabilities.model_catalog_models,
            vec!["gpt-5".to_string(), "gpt-5-mini".to_string()]
        );
        assert_eq!(
            exported.snapshot.capabilities.goal.as_deref(),
            Some("持续融合能力并验证构建")
        );
        assert_eq!(
            exported.snapshot.capabilities.prompt_pack.as_deref(),
            Some("## Debug\n\nReproduce before editing.")
        );
        assert!(exported.snapshot.capabilities.launch_script_present);
        assert!(exported
            .snapshot
            .warnings
            .iter()
            .any(|warning| warning.contains("launch script")));

        let content = fs::read_to_string(&exported.exported_path).expect("read snapshot");
        assert!(!content.contains("sk-secret-should-not-export"));
        assert!(!content.contains("openai_api_key"));
        assert!(!content.contains("auth.json"));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn provider_test_base_url_adds_v1_for_origin_only_urls() {
        assert_eq!(
            normalize_provider_test_base_url("https://api.example.com").expect("normalize"),
            "https://api.example.com/v1"
        );
        assert_eq!(
            normalize_provider_test_base_url("https://api.example.com/custom/v1?x=1")
                .expect("normalize"),
            "https://api.example.com/custom/v1"
        );
    }

    #[test]
    fn provider_test_endpoint_avoids_duplicate_suffix() {
        let base =
            normalize_provider_test_base_url("https://api.example.com/v1").expect("normalize");
        assert_eq!(
            provider_test_endpoint(&base, "/responses").expect("endpoint"),
            "https://api.example.com/v1/responses"
        );
        assert_eq!(
            provider_test_endpoint("https://api.example.com/v1/responses", "/responses")
                .expect("endpoint"),
            "https://api.example.com/v1/responses"
        );
    }

    #[test]
    fn provider_test_preview_redacts_api_key_and_clips() {
        let preview = provider_test_preview(
            "error with redaction-test-api-key\nand more details",
            "redaction-test-api-key",
        )
        .expect("preview");

        assert!(preview.contains("[redacted-api-key]"));
        assert!(!preview.contains("redaction-test-api-key"));
        assert!(!preview.contains('\n'));
    }

    #[test]
    fn provider_test_preview_handles_empty_api_key() {
        let preview = provider_test_preview("plain response\nwith model", "").expect("preview");

        assert_eq!(preview, "plain response with model");
        assert!(!preview.contains("[redacted-api-key]"));
    }

    #[test]
    fn provider_model_payload_parses_common_shapes() {
        let payload = json!({
            "data": [
                { "id": "gpt-5.4" },
                { "model": "qwen3-coder" },
                { "name": "deepseek-v3.2" },
                { "id": "GPT-5.4" },
                { "id": "" }
            ]
        });
        let models = parse_provider_model_payload(&payload);

        assert_eq!(
            models,
            vec![
                "deepseek-v3.2".to_string(),
                "gpt-5.4".to_string(),
                "qwen3-coder".to_string()
            ]
        );

        let array_payload = json!(["z-model", { "id": "a-model" }]);
        assert_eq!(
            parse_provider_model_payload(&array_payload),
            vec!["a-model".to_string(), "z-model".to_string()]
        );

        let nested_payload = json!({ "items": [{ "name": "local-model" }] });
        assert_eq!(
            parse_provider_model_payload(&nested_payload),
            vec!["local-model".to_string()]
        );
    }

    #[test]
    fn sync_package_write_flows_reject_default_instance_target() {
        let error = ensure_managed_instance_write_target(DEFAULT_INSTANCE_ID)
            .expect_err("default Codex home must not be a sync package write target");

        assert!(error.contains("default Codex home is read-only"));
    }

    #[test]
    fn markdown_export_renders_rollout_messages_without_credentials() {
        let root = std::env::temp_dir().join(format!(
            "codex-session-export-test-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&root).expect("create temp dir");
        let rollout = root.join("rollout.jsonl");
        fs::write(
            &rollout,
            r#"{"type":"response_item","timestamp":"2026-06-03T12:00:00Z","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"hello"}]}}
{"type":"response_item","timestamp":"2026-06-03T12:00:01Z","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"world sample-session-export-text"}]}}
"#,
        )
        .expect("write rollout");

        let messages = load_rollout_messages(&rollout).expect("load messages");
        assert_eq!(messages.len(), 2);
        let markdown = render_session_markdown("Unsafe / Title", "thread-123456789", &messages);
        assert!(markdown.contains("# Unsafe / Title"));
        assert!(markdown.contains("## User"));
        assert!(markdown.contains("hello"));
        assert!(markdown.contains("## Assistant"));
        assert!(markdown.contains("world sample-session-export-text"));

        let filename = build_markdown_filename("Unsafe / Title:*?", "thread-123456789");
        assert!(!filename.contains('/'));
        assert!(!filename.contains(':'));
        assert!(filename.ends_with(".md"));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn session_list_reads_clone_threads_without_writing_exports() {
        let root =
            std::env::temp_dir().join(format!("codex-session-list-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).expect("create temp dir");
        let rollout = root.join("rollout.jsonl");
        fs::write(
            &rollout,
            r#"{"type":"response_item","timestamp":"2026-06-03T12:00:00Z","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"hello"}]}}
{"type":"response_item","timestamp":"2026-06-03T12:00:02Z","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"world"}]}}
"#,
        )
        .expect("write rollout");

        let db = root.join("state_5.sqlite");
        let conn = Connection::open(&db).expect("open sqlite");
        conn.execute(
            "CREATE TABLE threads (id TEXT PRIMARY KEY, title TEXT, rollout_path TEXT, updated_at INTEGER, cwd TEXT)",
            [],
        )
        .expect("create threads");
        conn.execute(
            "INSERT INTO threads (id, title, rollout_path, updated_at, cwd) VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![
                "thread-123456789",
                "List Title",
                rollout.to_string_lossy().to_string(),
                100_i64,
                "C:/workspace/project",
            ],
        )
        .expect("insert thread");
        drop(conn);

        let sessions = list_recent_sessions_from_home(&root, 5).expect("list sessions");
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].title, "List Title");
        assert_eq!(sessions[0].message_count, 2);
        let expected_last_message_at =
            format_export_timestamp(Some(&json!("2026-06-03T12:00:02Z")));
        assert_eq!(
            sessions[0].last_message_at.as_deref(),
            expected_last_message_at.as_deref()
        );
        assert_eq!(
            sessions[0].project_dir.as_deref(),
            Some("C:/workspace/project")
        );
        assert_eq!(sessions[0].summary.as_deref(), Some("hello"));
        assert!(sessions[0]
            .search_preview
            .as_deref()
            .is_some_and(|preview| preview.contains("Assistant: world")));
        assert!(sessions[0].rollout_exists);
        assert!(!root.join("Codex Clone Session Exports").exists());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn session_list_falls_back_to_rollout_cwd_and_tolerates_bad_rollout() {
        let root = std::env::temp_dir().join(format!(
            "codex-session-list-cwd-test-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&root).expect("create temp dir");
        let rollout = root.join("rollout.jsonl");
        fs::write(
            &rollout,
            r#"{"type":"session_meta","payload":{"cwd":"D:/fallback/project"}}
{"this is not valid json"
{"type":"response_item","timestamp":"2026-06-03T12:00:00Z","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"Find the sync bug"}]}}
"#,
        )
        .expect("write rollout");

        let db = root.join("state_5.sqlite");
        let conn = Connection::open(&db).expect("open sqlite");
        conn.execute(
            "CREATE TABLE threads (id TEXT PRIMARY KEY, title TEXT, rollout_path TEXT, updated_at INTEGER)",
            [],
        )
        .expect("create threads");
        conn.execute(
            "INSERT INTO threads (id, title, rollout_path, updated_at) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![
                "thread-fallback",
                "Fallback Title",
                rollout.to_string_lossy().to_string(),
                100_i64,
            ],
        )
        .expect("insert thread");
        drop(conn);

        let sessions = list_recent_sessions_from_home(&root, 5).expect("list sessions");
        assert_eq!(sessions.len(), 1);
        assert_eq!(
            sessions[0].project_dir.as_deref(),
            Some("D:/fallback/project")
        );
        assert_eq!(sessions[0].summary.as_deref(), Some("Find the sync bug"));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn session_usage_summarizes_token_count_deltas() {
        let root =
            std::env::temp_dir().join(format!("codex-session-usage-test-{}", uuid::Uuid::new_v4()));
        let session_dir = root.join("sessions").join("2026").join("06").join("05");
        fs::create_dir_all(&session_dir).expect("create session dir");
        fs::write(
            session_dir.join("rollout.jsonl"),
            r#"{"type":"turn_context","timestamp":"2026-06-05T10:00:00Z","payload":{"model":"openai/GPT-5.4-2026-03-05"}}
{"type":"event_msg","timestamp":"2026-06-05T10:00:01Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":100,"cached_input_tokens":40,"output_tokens":10}}}}
{"type":"event_msg","timestamp":"2026-06-05T10:00:02Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":160,"cached_input_tokens":60,"output_tokens":25}}}}
"#,
        )
        .expect("write rollout");

        let usage = scan_session_usage_from_home(&root).expect("scan usage");

        assert_eq!(usage.scanned_files, 1);
        assert_eq!(usage.parsed_files, 1);
        assert_eq!(usage.event_count, 2);
        assert_eq!(usage.input_tokens, 160);
        assert_eq!(usage.cached_input_tokens, 60);
        assert_eq!(usage.output_tokens, 25);
        assert_eq!(usage.total_tokens, 185);
        assert_eq!(
            usage.first_event_at.as_deref(),
            Some("2026-06-05T10:00:01Z")
        );
        assert_eq!(usage.last_event_at.as_deref(), Some("2026-06-05T10:00:02Z"));
        assert_eq!(usage.by_model.len(), 1);
        assert_eq!(usage.by_model[0].model, "gpt-5.4");
        assert_eq!(usage.by_model[0].total_tokens, 185);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn session_usage_clamps_cached_input_and_skips_zero_delta() {
        let root = std::env::temp_dir().join(format!(
            "codex-session-usage-clamp-test-{}",
            uuid::Uuid::new_v4()
        ));
        let session_dir = root.join("archived_sessions");
        fs::create_dir_all(&session_dir).expect("create archived dir");
        fs::write(
            session_dir.join("rollout.jsonl"),
            r#"{"type":"turn_context","timestamp":"2026-06-05T10:00:00Z","payload":{"model":"GPT-5.2-CODEX"}}
{"type":"event_msg","timestamp":"2026-06-05T10:00:01Z","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":10,"cache_read_input_tokens":99,"output_tokens":2}}}}
{"type":"event_msg","timestamp":"2026-06-05T10:00:02Z","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":0,"cache_read_input_tokens":0,"output_tokens":0}}}}
"#,
        )
        .expect("write rollout");

        let usage = scan_session_usage_from_home(&root).expect("scan usage");

        assert_eq!(usage.event_count, 1);
        assert_eq!(usage.input_tokens, 10);
        assert_eq!(usage.cached_input_tokens, 10);
        assert_eq!(usage.output_tokens, 2);
        assert_eq!(usage.by_model[0].model, "gpt-5.2-codex");

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn zed_target_keeps_explicit_ssh_url() {
        let (target, mode) = zed_target_from_workdir("ssh://alice@example.com:2222/home/a b")
            .expect("build zed target");

        assert_eq!(mode, "remote");
        assert_eq!(target, "ssh://alice@example.com:2222/home/a b");
    }

    #[test]
    fn zed_target_converts_scp_like_remote_path() {
        let (target, mode) =
            zed_target_from_workdir("alice@example.com:/home/alice/My Project/你好.py")
                .expect("build zed target");

        assert_eq!(mode, "remote");
        assert_eq!(
            target,
            "ssh://alice@example.com/home/alice/My%20Project/%E4%BD%A0%E5%A5%BD.py"
        );
    }

    #[test]
    fn zed_target_does_not_treat_windows_drive_as_remote() {
        let (target, mode) =
            zed_target_from_workdir("C:\\Users\\admin\\repo").expect("build zed target");

        assert_eq!(mode, "local");
        assert_eq!(target, "C:\\Users\\admin\\repo");
    }
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
