use std::collections::HashSet;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use chrono::{TimeZone, Utc};
use rusqlite::{params, Connection, DatabaseName, OpenFlags};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value as JsonValue};
use toml_edit::Document;

const CONFIG_FILE: &str = "config.toml";
const DB_FILE: &str = "state_5.sqlite";
const SESSION_INDEX_FILE: &str = "session_index.jsonl";
const SESSIONS_DIR: &str = "sessions";
const ARCHIVED_SESSIONS_DIR: &str = "archived_sessions";
const BACKUP_DIR: &str = "history_sync_backups";
const SUMMARY_FILE: &str = "clone-history-sync-summary.json";
const BACKUP_FORMAT: &str = "codex-history-sync-backup-manifest-v1";
const SYNC_MODE_SHARED: &str = "shared";
const LOCK_FILE: &str = ".history-sync.lock";
const LOCK_TIMEOUT: Duration = Duration::from_secs(20);
const BACKUP_KEEP_RECENT: usize = 10;
const BACKUP_KEEP_DAYS: i64 = 30;
const SYNC_MEMORY_DIRECTORIES: &[&str] = &["sessions", "archived_sessions"];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexHistoryCount {
    pub value: String,
    pub count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexHistoryCheck {
    pub name: String,
    pub ok: bool,
    pub message: String,
    pub required: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexHistoryStatus {
    pub codex_home: String,
    pub ok: bool,
    pub current_provider: String,
    pub current_model: Option<String>,
    pub thread_count: i64,
    pub session_file_count: i64,
    pub session_index_count: i64,
    pub provider_counts: Vec<CodexHistoryCount>,
    pub model_counts: Vec<CodexHistoryCount>,
    pub mismatch_count: i64,
    pub missing_session_files: i64,
    pub auth_ok: bool,
    pub bound_account_id: Option<String>,
    pub auth_mode: Option<String>,
    pub provider_base_url_host: Option<String>,
    pub sync_mode: String,
    pub last_sync_at: Option<i64>,
    pub last_backup_path: Option<String>,
    pub sync_package_applied:
        Option<crate::modules::codex_sync_package::CodexSyncPackageAppliedMarker>,
    pub warnings: Vec<String>,
    pub checks: Vec<CodexHistoryCheck>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexHistorySyncResult {
    pub codex_home: String,
    pub dry_run: bool,
    pub ok: bool,
    pub current_provider: String,
    pub current_model: Option<String>,
    pub thread_count: i64,
    pub mismatch_count_before: i64,
    pub mismatch_count_after: i64,
    pub updated_threads: i64,
    pub updated_rollout_paths: i64,
    pub updated_session_files: i64,
    pub invalid_session_files: i64,
    pub rewritten_index_entries: i64,
    pub synced_threads: i64,
    pub backup_retention_deleted: i64,
    pub lock_wait_ms: i64,
    pub stderr_warnings: Vec<String>,
    pub auth_mode: Option<String>,
    pub provider_base_url_host: Option<String>,
    pub sync_mode: String,
    pub backup_path: Option<String>,
    pub app_server_refreshed: bool,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackupManifest {
    format: String,
    created_at: i64,
    codex_home: String,
    backup_path: String,
    thread_count: i64,
    session_index_count: i64,
}

#[derive(Debug, Clone)]
struct SyncTarget {
    provider: String,
    model: Option<String>,
}

#[derive(Debug, Clone)]
struct SessionRewriteStats {
    updated: i64,
    invalid: i64,
    total: i64,
}

#[derive(Debug, Clone)]
pub struct CodexHistoryContext {
    pub bound_account_id: Option<String>,
}

#[derive(Debug, Clone)]
struct AuthStatus {
    ok: bool,
    auth_mode: Option<String>,
    provider_base_url_host: Option<String>,
    warning: Option<String>,
}

#[derive(Debug, Default)]
struct DbStatusMetrics {
    thread_count: i64,
    provider_counts: Vec<CodexHistoryCount>,
    model_counts: Vec<CodexHistoryCount>,
    mismatch_count: i64,
    missing_session_files: i64,
}

#[derive(Debug)]
struct ProfileLock {
    path: PathBuf,
    wait_ms: i64,
}

pub fn status(codex_home: &Path) -> Result<CodexHistoryStatus, String> {
    status_with_context(codex_home, None)
}

pub fn status_with_context(
    codex_home: &Path,
    context: Option<&CodexHistoryContext>,
) -> Result<CodexHistoryStatus, String> {
    let target = read_sync_target(codex_home)?;
    let auth_status = read_auth_status(codex_home, context);
    let mut checks = Vec::new();
    let mut warnings = Vec::new();
    let db_path = codex_home.join(DB_FILE);
    let session_index_path = codex_home.join(SESSION_INDEX_FILE);
    let sessions_dir = codex_home.join(SESSIONS_DIR);

    add_check(
        &mut checks,
        "codex_home",
        codex_home.exists() && codex_home.is_dir(),
        codex_home.display().to_string(),
        true,
    );
    add_check(
        &mut checks,
        "config",
        codex_home.join(CONFIG_FILE).exists(),
        codex_home.join(CONFIG_FILE).display().to_string(),
        false,
    );
    add_check(
        &mut checks,
        "database",
        db_path.exists(),
        db_path.display().to_string(),
        true,
    );
    add_check(
        &mut checks,
        "sessions_dir",
        sessions_dir.exists() && sessions_dir.is_dir(),
        sessions_dir.display().to_string(),
        false,
    );
    add_check(
        &mut checks,
        "session_index",
        session_index_path.exists(),
        session_index_path.display().to_string(),
        false,
    );

    let mut thread_count = 0;
    let mut provider_counts = Vec::new();
    let mut model_counts = Vec::new();
    let mut mismatch_count = 0;
    let mut missing_session_files = 0;

    if db_path.exists() {
        match collect_db_status_metrics(codex_home, &db_path, &target, &mut checks) {
            Ok(metrics) => {
                thread_count = metrics.thread_count;
                provider_counts = metrics.provider_counts;
                model_counts = metrics.model_counts;
                mismatch_count = metrics.mismatch_count;
                missing_session_files = metrics.missing_session_files;
            }
            Err(error) => {
                warnings.push(format!(
                    "SQLite history database is unreadable; use sync/repair to rebuild it from the local Codex package: {}",
                    error
                ));
                add_check(&mut checks, "database_integrity", false, error, true);
            }
        }
    }

    let session_file_count = iter_session_files(&sessions_dir).len() as i64;
    let session_index_count = count_jsonl_lines(&session_index_path);
    let (last_sync_at, last_backup_path) = read_last_summary(codex_home);
    let sync_package_applied =
        match crate::modules::codex_sync_package::read_applied_sync_package_marker(codex_home) {
            Ok(marker) => marker,
            Err(error) => {
                warnings.push(error);
                None
            }
        };
    if mismatch_count > 0 {
        warnings.push(format!(
            "{} thread metadata rows do not match current provider/model",
            mismatch_count
        ));
    }
    if missing_session_files > 0 {
        warnings.push(format!(
            "{} rollout paths do not resolve under this Codex home",
            missing_session_files
        ));
    }
    if let Some(warning) = auth_status.warning.clone() {
        warnings.push(warning);
    }
    if db_path.exists() {
        match sync_source_thread_delta(codex_home, &db_path) {
            Ok(Some((missing_count, source_count, source_path))) => {
                let synced = missing_count == 0;
                add_check(
                    &mut checks,
                    "sync_package_threads",
                    synced,
                    format!(
                        "missing_from_source={}, source_threads={}, source={}",
                        missing_count, source_count, source_path
                    ),
                    false,
                );
                if !synced {
                    warnings.push(format!(
                        "clone is missing {} threads from current Codex sync package/source",
                        missing_count
                    ));
                }
            }
            Ok(None) => {}
            Err(error) => {
                warnings.push(format!("sync package thread comparison skipped: {}", error));
                add_check(&mut checks, "sync_package_threads", false, error, false);
            }
        }
    }
    let session_index_matches = thread_count == 0 || session_index_count == thread_count;
    if !session_index_matches {
        warnings.push(format!(
            "session_index.jsonl has {} entries but SQLite has {} threads",
            session_index_count, thread_count
        ));
    }
    add_check(
        &mut checks,
        "session_index_matches_threads",
        session_index_matches,
        format!("index={}, threads={}", session_index_count, thread_count),
        false,
    );
    add_check(
        &mut checks,
        "rollout_paths_resolve",
        missing_session_files == 0,
        format!("missing_session_files={}", missing_session_files),
        false,
    );
    add_check(
        &mut checks,
        "memory_sync_mode",
        true,
        SYNC_MODE_SHARED.to_string(),
        false,
    );
    add_check(
        &mut checks,
        "auth_provider",
        auth_status.ok,
        format!(
            "auth_mode={}, provider_host={}",
            auth_status.auth_mode.as_deref().unwrap_or("unknown"),
            auth_status
                .provider_base_url_host
                .as_deref()
                .unwrap_or("unknown")
        ),
        false,
    );

    let ok = checks.iter().all(|check| check.ok) && mismatch_count == 0 && auth_status.ok;
    Ok(CodexHistoryStatus {
        codex_home: codex_home.to_string_lossy().to_string(),
        ok,
        current_provider: target.provider,
        current_model: target.model,
        thread_count,
        session_file_count,
        session_index_count,
        provider_counts,
        model_counts,
        mismatch_count,
        missing_session_files,
        auth_ok: auth_status.ok,
        bound_account_id: context.and_then(|value| value.bound_account_id.clone()),
        auth_mode: auth_status.auth_mode,
        provider_base_url_host: auth_status.provider_base_url_host,
        sync_mode: SYNC_MODE_SHARED.to_string(),
        last_sync_at,
        last_backup_path,
        sync_package_applied,
        warnings,
        checks,
    })
}

fn collect_db_status_metrics(
    codex_home: &Path,
    db_path: &Path,
    target: &SyncTarget,
    checks: &mut Vec<CodexHistoryCheck>,
) -> Result<DbStatusMetrics, String> {
    let conn = open_readonly(db_path)?;
    sqlite_integrity_check_conn(&conn)?;
    let columns = thread_columns(&conn)?;
    if !table_exists(&conn, "threads")? {
        add_check(
            checks,
            "threads_table",
            false,
            "missing threads table".to_string(),
            true,
        );
        return Ok(DbStatusMetrics::default());
    }

    let thread_count = query_i64(&conn, "SELECT COUNT(*) FROM threads", [])?;
    let provider_counts = query_counts(
        &conn,
        "SELECT COALESCE(model_provider, ''), COUNT(*) FROM threads GROUP BY model_provider ORDER BY COUNT(*) DESC, model_provider ASC",
    )?;
    let model_counts = if columns.iter().any(|column| column == "model") {
        query_counts(
            &conn,
            "SELECT COALESCE(model, ''), COUNT(*) FROM threads GROUP BY model ORDER BY COUNT(*) DESC, model ASC",
        )?
    } else {
        Vec::new()
    };
    let mismatch_count = count_mismatches(&conn, &columns, target)?;
    let missing_session_files = count_missing_session_files(codex_home, &conn, &columns)?;

    add_check(checks, "database_integrity", true, "ok".to_string(), true);
    Ok(DbStatusMetrics {
        thread_count,
        provider_counts,
        model_counts,
        mismatch_count,
        missing_session_files,
    })
}

pub fn verify(codex_home: &Path) -> Result<CodexHistoryStatus, String> {
    verify_with_context(codex_home, None)
}

pub fn verify_with_context(
    codex_home: &Path,
    context: Option<&CodexHistoryContext>,
) -> Result<CodexHistoryStatus, String> {
    let mut result = status_with_context(codex_home, context)?;
    if let Some(path) = result.last_backup_path.clone() {
        match verify_backup(codex_home, Path::new(&path)) {
            Ok(()) => result.checks.push(CodexHistoryCheck {
                name: "last_backup".to_string(),
                ok: true,
                message: path,
                required: false,
            }),
            Err(error) => {
                result.warnings.push(error.clone());
                result.checks.push(CodexHistoryCheck {
                    name: "last_backup".to_string(),
                    ok: false,
                    message: error,
                    required: false,
                });
            }
        }
    }
    result.ok =
        result.checks.iter().all(|check| check.ok) && result.mismatch_count == 0 && result.auth_ok;
    Ok(result)
}

pub fn sync_to_current_provider(
    codex_home: &Path,
    dry_run: bool,
) -> Result<CodexHistorySyncResult, String> {
    sync_to_current_provider_with_context(codex_home, dry_run, None)
}

pub fn sync_to_current_provider_with_context(
    codex_home: &Path,
    dry_run: bool,
    context: Option<&CodexHistoryContext>,
) -> Result<CodexHistorySyncResult, String> {
    let target = read_sync_target(codex_home)?;
    let auth_status = read_auth_status(codex_home, context);
    let profile_lock = if dry_run {
        None
    } else {
        Some(acquire_profile_lock(codex_home)?)
    };
    let lock_wait_ms = profile_lock
        .as_ref()
        .map(|value| value.wait_ms)
        .unwrap_or(0);
    let db_path = codex_home.join(DB_FILE);
    if !db_path.exists() {
        return Err(format!("missing {}", db_path.display()));
    }

    let mut warnings = Vec::new();
    if let Some(warning) = auth_status.warning.clone() {
        warnings.push(warning);
    }
    let backup_path = if dry_run {
        None
    } else {
        Some(make_backup(codex_home)?)
    };

    let conn = if dry_run {
        open_readonly(&db_path)?
    } else {
        Connection::open(&db_path).map_err(|error| format!("open sqlite failed: {}", error))?
    };
    let columns = thread_columns(&conn)?;
    let thread_count = query_i64(&conn, "SELECT COUNT(*) FROM threads", [])?;
    let mismatch_count_before = count_mismatches(&conn, &columns, &target)?;

    let mut updated_threads = 0;
    let mut updated_rollout_paths = 0;
    let synced_threads =
        sync_threads_from_default(codex_home, &conn, &columns, dry_run, &mut warnings)?;
    if !dry_run {
        updated_threads = update_threads_metadata(&conn, &columns, &target)?;
        updated_rollout_paths = normalize_rollout_paths(codex_home, &conn, &columns)?;
    }

    let session_stats = if dry_run {
        count_session_rewrite_candidates(codex_home, &target)
    } else {
        rewrite_session_metadata(codex_home, &target)
    };
    let session_stats = match session_stats {
        Ok(stats) => stats,
        Err(error) => {
            warnings.push(error);
            SessionRewriteStats {
                updated: 0,
                invalid: 0,
                total: 0,
            }
        }
    };

    let mut rewritten_index_entries = if dry_run {
        0
    } else {
        rebuild_session_index(codex_home, &conn, &columns)?
    };

    if !dry_run {
        let _ = conn.execute_batch("PRAGMA wal_checkpoint(FULL);");
    }

    let mut app_server_refreshed = false;
    let mut stderr_warnings = Vec::new();
    if !dry_run {
        match crate::modules::codex_official_app_server::rebuild_thread_metadata(codex_home) {
            Ok(()) => app_server_refreshed = true,
            Err(error) => {
                let warning = format!("app-server refresh skipped/failed: {}", error);
                stderr_warnings.push(warning.clone());
                warnings.push(warning);
            }
        }
    }
    if !dry_run {
        updated_threads += update_threads_metadata(&conn, &columns, &target)?;
        updated_rollout_paths += normalize_rollout_paths(codex_home, &conn, &columns)?;
        match rewrite_session_metadata(codex_home, &target) {
            Ok(stats) => {
                if stats.updated > 0 {
                    let refreshed_index = rebuild_session_index(codex_home, &conn, &columns)?;
                    if refreshed_index > rewritten_index_entries {
                        rewritten_index_entries = refreshed_index;
                    }
                }
            }
            Err(error) => warnings.push(error),
        }
    }
    let mismatch_count_after = if dry_run {
        mismatch_count_before
    } else {
        count_mismatches(&conn, &columns, &target)?
    };
    let thread_count_after = if dry_run {
        thread_count
    } else {
        query_i64(&conn, "SELECT COUNT(*) FROM threads", [])?
    };
    let backup_retention_deleted = if dry_run {
        0
    } else {
        prune_old_backups(codex_home, backup_path.as_deref(), &mut warnings)?
    };

    let result = CodexHistorySyncResult {
        codex_home: codex_home.to_string_lossy().to_string(),
        dry_run,
        ok: mismatch_count_after == 0,
        current_provider: target.provider,
        current_model: target.model,
        thread_count: thread_count_after,
        mismatch_count_before,
        mismatch_count_after,
        updated_threads,
        updated_rollout_paths,
        updated_session_files: session_stats.updated,
        invalid_session_files: session_stats.invalid,
        rewritten_index_entries,
        synced_threads,
        backup_retention_deleted,
        lock_wait_ms,
        stderr_warnings,
        auth_mode: auth_status.auth_mode,
        provider_base_url_host: auth_status.provider_base_url_host,
        sync_mode: SYNC_MODE_SHARED.to_string(),
        backup_path: backup_path
            .as_ref()
            .map(|path| path.to_string_lossy().to_string()),
        app_server_refreshed,
        warnings,
    };

    if !dry_run {
        write_sync_summary(codex_home, &result)?;
    }
    Ok(result)
}

fn read_sync_target(codex_home: &Path) -> Result<SyncTarget, String> {
    let config_path = codex_home.join(CONFIG_FILE);
    let content = fs::read_to_string(&config_path).unwrap_or_default();
    let doc = if content.trim().is_empty() {
        Document::new()
    } else {
        content
            .parse::<Document>()
            .map_err(|error| format!("parse config.toml failed: {}", error))?
    };
    let provider = doc
        .get("model_provider")
        .and_then(|item| item.as_str())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("openai")
        .trim()
        .to_string();
    let model = doc
        .get("model")
        .and_then(|item| item.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string);
    Ok(SyncTarget { provider, model })
}

fn acquire_profile_lock(codex_home: &Path) -> Result<ProfileLock, String> {
    fs::create_dir_all(codex_home)
        .map_err(|error| format!("create Codex home before lock failed: {}", error))?;
    let path = codex_home.join(LOCK_FILE);
    let started = Instant::now();
    loop {
        match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
        {
            Ok(mut file) => {
                let _ = writeln!(
                    file,
                    "pid={};created_at={}",
                    std::process::id(),
                    Utc::now().to_rfc3339()
                );
                return Ok(ProfileLock {
                    path,
                    wait_ms: started.elapsed().as_millis() as i64,
                });
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                if lock_file_is_stale(&path) {
                    let _ = fs::remove_file(&path);
                    continue;
                }
                if started.elapsed() > lock_timeout() {
                    return Err(format!("history sync lock is busy: {}", path.display()));
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(error) => {
                return Err(format!(
                    "create history sync lock failed ({}): {}",
                    path.display(),
                    error
                ));
            }
        }
    }
}

#[cfg(not(test))]
fn lock_timeout() -> Duration {
    LOCK_TIMEOUT
}

#[cfg(test)]
fn lock_timeout() -> Duration {
    std::env::var("CODEX_CLONE_HISTORY_SYNC_TEST_LOCK_TIMEOUT_MS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .map(Duration::from_millis)
        .unwrap_or(LOCK_TIMEOUT)
}

fn lock_file_is_stale(path: &Path) -> bool {
    let Ok(metadata) = fs::metadata(path) else {
        return false;
    };
    let Ok(modified) = metadata.modified() else {
        return false;
    };
    let Ok(age) = modified.elapsed() else {
        return false;
    };
    age > Duration::from_secs(10 * 60)
}

impl Drop for ProfileLock {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

fn read_auth_status(codex_home: &Path, context: Option<&CodexHistoryContext>) -> AuthStatus {
    let config_host = read_provider_base_url_host(codex_home).ok().flatten();
    let auth_path = codex_home.join("auth.json");
    let Ok(content) = fs::read_to_string(&auth_path) else {
        return AuthStatus {
            ok: false,
            auth_mode: None,
            provider_base_url_host: config_host,
            warning: Some(format!("auth.json missing: {}", auth_path.display())),
        };
    };
    let Ok(value) = serde_json::from_str::<JsonValue>(&content) else {
        return AuthStatus {
            ok: false,
            auth_mode: None,
            provider_base_url_host: config_host,
            warning: Some(format!(
                "auth.json is not valid JSON: {}",
                auth_path.display()
            )),
        };
    };
    let auth_mode = value
        .get("auth_mode")
        .or_else(|| value.get("authMode"))
        .and_then(JsonValue::as_str)
        .map(ToString::to_string);
    let has_api_key = json_has_non_empty_string(&value, &["OPENAI_API_KEY"])
        || json_has_non_empty_string(&value, &["openai_api_key"])
        || json_has_non_empty_string(&value, &["openaiApiKey"]);
    let has_token = value
        .get("tokens")
        .and_then(JsonValue::as_object)
        .map(|tokens| {
            tokens
                .get("access_token")
                .or_else(|| tokens.get("accessToken"))
                .and_then(JsonValue::as_str)
                .is_some_and(|value| !value.trim().is_empty())
        })
        .unwrap_or(false);
    let normalized_mode = auth_mode.clone().or_else(|| {
        if has_api_key {
            Some("apikey".to_string())
        } else if has_token {
            Some("oauth".to_string())
        } else {
            None
        }
    });
    let mut ok = has_api_key || has_token;
    let mut warning = None;
    if !ok {
        warning = Some("auth.json has neither API key nor OAuth token".to_string());
    }
    if let Some(bound) = context.and_then(|value| value.bound_account_id.as_deref()) {
        if bound.starts_with("codex_apikey_") && !has_api_key {
            ok = false;
            warning = Some(format!(
                "bound API key account is not reflected in profile auth.json: {}",
                bound
            ));
        }
        if !bound.starts_with("codex_apikey_") && !has_token {
            ok = false;
            warning = Some(format!(
                "bound OAuth account is not reflected in profile auth.json: {}",
                bound
            ));
        }
    }
    if normalized_mode.as_deref() == Some("apikey") && config_host.is_none() {
        ok = false;
        warning = Some("API key profile has no provider base_url in config.toml".to_string());
    }
    AuthStatus {
        ok,
        auth_mode: normalized_mode,
        provider_base_url_host: config_host,
        warning,
    }
}

fn json_has_non_empty_string(value: &JsonValue, keys: &[&str]) -> bool {
    keys.iter().any(|key| {
        value
            .get(*key)
            .and_then(JsonValue::as_str)
            .is_some_and(|item| !item.trim().is_empty())
    })
}

fn read_provider_base_url_host(codex_home: &Path) -> Result<Option<String>, String> {
    let config_path = codex_home.join(CONFIG_FILE);
    let content = fs::read_to_string(&config_path).unwrap_or_default();
    if content.trim().is_empty() {
        return Ok(None);
    }
    let doc = content
        .parse::<Document>()
        .map_err(|error| format!("parse config.toml failed: {}", error))?;
    let provider = doc
        .get("model_provider")
        .and_then(|item| item.as_str())
        .unwrap_or("openai");
    let base_url = doc
        .get("model_providers")
        .and_then(|item| item.as_table())
        .and_then(|table| table.get(provider))
        .and_then(|item| item.as_table())
        .and_then(|table| table.get("base_url"))
        .and_then(|item| item.as_str())
        .or_else(|| doc.get("base_url").and_then(|item| item.as_str()));
    Ok(base_url.and_then(extract_url_host))
}

fn extract_url_host(value: &str) -> Option<String> {
    let trimmed = value.trim();
    let rest = trimmed
        .strip_prefix("https://")
        .or_else(|| trimmed.strip_prefix("http://"))
        .unwrap_or(trimmed);
    rest.split('/')
        .next()
        .map(|host| host.trim().trim_matches('/').to_string())
        .filter(|host| !host.is_empty())
}

fn open_readonly(path: &Path) -> Result<Connection, String> {
    Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(|error| {
        format!(
            "open sqlite readonly failed ({}): {}",
            path.display(),
            error
        )
    })
}

fn sqlite_integrity_check_conn(conn: &Connection) -> Result<(), String> {
    let mut stmt = conn
        .prepare("PRAGMA integrity_check")
        .map_err(|error| format!("prepare sqlite integrity check failed: {}", error))?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| format!("run sqlite integrity check failed: {}", error))?;
    let mut messages = Vec::new();
    for row in rows {
        messages.push(row.map_err(|error| format!("read sqlite integrity row failed: {}", error))?);
    }
    if messages.len() == 1 && messages[0].eq_ignore_ascii_case("ok") {
        Ok(())
    } else {
        Err(format!(
            "sqlite integrity check failed: {}",
            messages.join("; ")
        ))
    }
}

fn table_exists(conn: &Connection, table: &str) -> Result<bool, String> {
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
            [table],
            |row| row.get(0),
        )
        .map_err(|error| format!("query sqlite schema failed: {}", error))?;
    Ok(count > 0)
}

fn thread_columns(conn: &Connection) -> Result<Vec<String>, String> {
    let mut stmt = conn
        .prepare("PRAGMA table_info(threads)")
        .map_err(|error| format!("read threads columns failed: {}", error))?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| format!("read threads columns failed: {}", error))?;
    let mut columns = Vec::new();
    for row in rows {
        columns.push(row.map_err(|error| format!("read threads column failed: {}", error))?);
    }
    Ok(columns)
}

fn query_i64<P: rusqlite::Params>(conn: &Connection, sql: &str, params: P) -> Result<i64, String> {
    conn.query_row(sql, params, |row| row.get(0))
        .map_err(|error| format!("sqlite query failed: {}", error))
}

fn query_counts(conn: &Connection, sql: &str) -> Result<Vec<CodexHistoryCount>, String> {
    let mut stmt = conn
        .prepare(sql)
        .map_err(|error| format!("prepare count query failed: {}", error))?;
    let rows = stmt
        .query_map([], |row| {
            Ok(CodexHistoryCount {
                value: row.get::<_, String>(0)?,
                count: row.get::<_, i64>(1)?,
            })
        })
        .map_err(|error| format!("run count query failed: {}", error))?;
    let mut result = Vec::new();
    for row in rows {
        result.push(row.map_err(|error| format!("read count query row failed: {}", error))?);
    }
    Ok(result)
}

fn count_mismatches(
    conn: &Connection,
    columns: &[String],
    target: &SyncTarget,
) -> Result<i64, String> {
    if !columns.iter().any(|column| column == "model_provider") {
        return Ok(0);
    }
    if columns.iter().any(|column| column == "model") {
        if let Some(model) = target.model.as_deref() {
            return query_i64(
                conn,
                "SELECT COUNT(*) FROM threads WHERE (model_provider IS NULL OR model_provider <> ?1) OR (model IS NULL OR model <> ?2)",
                params![target.provider, model],
            );
        }
    }
    query_i64(
        conn,
        "SELECT COUNT(*) FROM threads WHERE model_provider IS NULL OR model_provider <> ?1",
        params![target.provider],
    )
}

fn read_thread_ids(db_path: &Path) -> Result<HashSet<String>, String> {
    let conn = open_readonly(db_path)?;
    read_thread_ids_from_conn(&conn)
}

fn read_thread_ids_from_conn(conn: &Connection) -> Result<HashSet<String>, String> {
    if !table_exists(&conn, "threads")? {
        return Ok(HashSet::new());
    }
    let mut ids = HashSet::new();
    let mut stmt = conn
        .prepare("SELECT id FROM threads")
        .map_err(|error| format!("prepare default thread id query failed: {}", error))?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| format!("query default thread ids failed: {}", error))?;
    for row in rows {
        ids.insert(row.map_err(|error| format!("read default thread id failed: {}", error))?);
    }
    Ok(ids)
}

fn paths_equal_or_same(left: &Path, right: &Path) -> bool {
    if left == right {
        return true;
    }
    match (left.canonicalize(), right.canonicalize()) {
        (Ok(left), Ok(right)) => left == right,
        _ => false,
    }
}

fn sync_threads_from_default(
    codex_home: &Path,
    conn: &Connection,
    columns: &[String],
    dry_run: bool,
    warnings: &mut Vec<String>,
) -> Result<i64, String> {
    let package_home = crate::modules::codex_sync_package::package_codex_home_dir()?;
    if package_home.join(DB_FILE).exists() {
        return sync_threads_from_source(
            codex_home,
            &package_home,
            conn,
            columns,
            dry_run,
            warnings,
        );
    }

    warnings.push(format!(
        "sync package history database missing; click `提取/刷新本体` before `同步/修复`: {}",
        package_home.join(DB_FILE).display()
    ));
    Ok(0)
}

fn sync_source_thread_delta(
    codex_home: &Path,
    db_path: &Path,
) -> Result<Option<(i64, i64, String)>, String> {
    let Ok(managed_root) = crate::modules::codex_instance::get_default_instances_root_dir() else {
        return Ok(None);
    };
    if !is_under(codex_home, &managed_root) {
        return Ok(None);
    }
    let package_home = crate::modules::codex_sync_package::package_codex_home_dir()?;
    if !package_home.join(DB_FILE).exists() {
        return Ok(None);
    }
    let source_home = package_home;
    if paths_equal_or_same(codex_home, &source_home) {
        return Ok(None);
    }
    let source_db = source_home.join(DB_FILE);
    if !source_db.exists() {
        return Ok(None);
    }

    let source_ids = read_thread_ids(&source_db)?;
    if source_ids.is_empty() {
        return Ok(None);
    }
    let local_ids = read_thread_ids(db_path)?;
    let missing = source_ids
        .iter()
        .filter(|id| !local_ids.contains(*id))
        .count() as i64;
    Ok(Some((
        missing,
        source_ids.len() as i64,
        source_home.to_string_lossy().to_string(),
    )))
}

fn sync_threads_from_source(
    codex_home: &Path,
    default_home: &Path,
    conn: &Connection,
    columns: &[String],
    dry_run: bool,
    warnings: &mut Vec<String>,
) -> Result<i64, String> {
    if !columns.iter().any(|column| column == "id") {
        return Ok(0);
    }
    if paths_equal_or_same(codex_home, &default_home) {
        return Ok(0);
    }
    let source_db = default_home.join(DB_FILE);
    if !source_db.exists() {
        return Ok(0);
    }

    let source_conn = open_readonly(&source_db)?;
    sqlite_integrity_check_conn(&source_conn)?;
    if !table_exists(&source_conn, "threads")? {
        return Ok(0);
    }
    let source_columns = thread_columns(&source_conn)?;
    let source_column_set: HashSet<&str> = source_columns.iter().map(String::as_str).collect();
    let common_columns = columns
        .iter()
        .filter(|column| source_column_set.contains(column.as_str()))
        .cloned()
        .collect::<Vec<_>>();
    if !common_columns.iter().any(|column| column == "id") {
        return Ok(0);
    }

    let source_ids = read_thread_ids_from_conn(&source_conn)?;
    if source_ids.is_empty() {
        return Ok(0);
    }
    let mut missing = 0;
    let mut stmt = conn
        .prepare("SELECT id FROM threads")
        .map_err(|error| format!("prepare local thread id query failed: {}", error))?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| format!("query local thread ids failed: {}", error))?;
    let mut local_ids = HashSet::new();
    for row in rows {
        local_ids.insert(row.map_err(|error| format!("read local thread id failed: {}", error))?);
    }
    for id in source_ids {
        if !local_ids.contains(&id) {
            missing += 1;
        }
    }
    if dry_run || missing == 0 {
        return Ok(missing);
    }
    sync_memory_directories_from_default(&default_home, codex_home, warnings)?;

    conn.execute(
        "ATTACH DATABASE ?1 AS source_history",
        params![source_db.to_string_lossy().to_string()],
    )
    .map_err(|error| format!("attach default history database failed: {}", error))?;
    let column_sql = common_columns
        .iter()
        .map(|column| quote_identifier(column))
        .collect::<Vec<_>>()
        .join(", ");
    let sql = format!(
        "INSERT OR IGNORE INTO threads ({}) SELECT {} FROM source_history.threads",
        column_sql, column_sql
    );
    let inserted = conn
        .execute(&sql, [])
        .map(|count| count as i64)
        .map_err(|error| format!("merge default history threads failed: {}", error));
    let detach_result = conn.execute_batch("DETACH DATABASE source_history");
    if let Err(error) = detach_result {
        warnings.push(format!("detach default history database failed: {}", error));
    }
    inserted
}

fn quote_identifier(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}

fn sync_memory_directories_from_default(
    default_home: &Path,
    codex_home: &Path,
    warnings: &mut Vec<String>,
) -> Result<(), String> {
    for relative in SYNC_MEMORY_DIRECTORIES {
        let source = default_home.join(relative);
        if !source.exists() {
            continue;
        }
        let target = codex_home.join(relative);
        if let Err(error) = copy_directory_newer_or_missing(&source, &target) {
            warnings.push(format!("memory sync skipped {}: {}", relative, error));
        }
    }
    Ok(())
}

fn is_sqlite_sidecar_file(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
        return false;
    };
    name.ends_with(".sqlite-wal")
        || name.ends_with(".sqlite-shm")
        || name.ends_with(".sqlite3-wal")
        || name.ends_with(".sqlite3-shm")
        || name.ends_with(".db-wal")
        || name.ends_with(".db-shm")
}

fn copy_directory_newer_or_missing(source: &Path, target: &Path) -> Result<(), String> {
    fs::create_dir_all(target).map_err(|error| {
        format!(
            "create target directory failed ({}): {}",
            target.display(),
            error
        )
    })?;
    let entries = fs::read_dir(source).map_err(|error| {
        format!(
            "read source directory failed ({}): {}",
            source.display(),
            error
        )
    })?;
    for entry in entries {
        let entry = entry.map_err(|error| format!("read source entry failed: {}", error))?;
        let source_path = entry.path();
        let target_path = target.join(entry.file_name());
        let file_type = entry
            .file_type()
            .map_err(|error| format!("read source entry type failed: {}", error))?;
        if file_type.is_dir() {
            copy_directory_newer_or_missing(&source_path, &target_path)?;
        } else if file_type.is_file() && is_sqlite_sidecar_file(&source_path) {
            continue;
        } else if file_type.is_file() && should_copy_file(&source_path, &target_path) {
            if let Some(parent) = target_path.parent() {
                fs::create_dir_all(parent).map_err(|error| {
                    format!(
                        "create target file parent failed ({}): {}",
                        parent.display(),
                        error
                    )
                })?;
            }
            fs::copy(&source_path, &target_path).map_err(|error| {
                format!(
                    "copy synced memory file failed ({} -> {}): {}",
                    source_path.display(),
                    target_path.display(),
                    error
                )
            })?;
        }
    }
    Ok(())
}

fn should_copy_file(source: &Path, target: &Path) -> bool {
    if !target.exists() {
        return true;
    }
    let Ok(source_modified) = fs::metadata(source).and_then(|metadata| metadata.modified()) else {
        return false;
    };
    let Ok(target_modified) = fs::metadata(target).and_then(|metadata| metadata.modified()) else {
        return true;
    };
    source_modified > target_modified
}

fn update_threads_metadata(
    conn: &Connection,
    columns: &[String],
    target: &SyncTarget,
) -> Result<i64, String> {
    if !columns.iter().any(|column| column == "model_provider") {
        return Ok(0);
    }
    if columns.iter().any(|column| column == "model") {
        if let Some(model) = target.model.as_deref() {
            return conn
                .execute(
                    "UPDATE threads SET model_provider=?1, model=?2 WHERE (model_provider IS NULL OR model_provider <> ?1) OR (model IS NULL OR model <> ?2)",
                    params![target.provider, model],
                )
                .map(|count| count as i64)
                .map_err(|error| format!("update thread provider/model failed: {}", error));
        }
    }
    conn.execute(
        "UPDATE threads SET model_provider=?1 WHERE model_provider IS NULL OR model_provider <> ?1",
        params![target.provider],
    )
    .map(|count| count as i64)
    .map_err(|error| format!("update thread provider failed: {}", error))
}

fn normalize_rollout_paths(
    codex_home: &Path,
    conn: &Connection,
    columns: &[String],
) -> Result<i64, String> {
    if !columns.iter().any(|column| column == "rollout_path") {
        return Ok(0);
    }
    let mut updated = 0;
    let mut stmt = conn
        .prepare("SELECT id, rollout_path FROM threads")
        .map_err(|error| format!("prepare rollout path query failed: {}", error))?;
    let rows = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|error| format!("query rollout paths failed: {}", error))?;
    let mut pairs = Vec::new();
    for row in rows {
        pairs.push(row.map_err(|error| format!("read rollout path row failed: {}", error))?);
    }
    drop(stmt);

    for (id, raw_path) in pairs {
        let Some(next_path) = ensure_local_rollout_path(codex_home, &raw_path)? else {
            continue;
        };
        let next = next_path.to_string_lossy().to_string();
        if next == raw_path {
            continue;
        }
        updated +=
            conn.execute(
                "UPDATE threads SET rollout_path=?1 WHERE id=?2",
                params![next, id],
            )
            .map_err(|error| format!("update rollout path failed: {}", error))? as i64;
    }
    Ok(updated)
}

fn ensure_local_rollout_path(codex_home: &Path, raw_path: &str) -> Result<Option<PathBuf>, String> {
    let raw = PathBuf::from(raw_path);
    if raw.exists() && is_under(&raw, codex_home) {
        return Ok(None);
    }
    if let Some(found) = resolve_local_rollout_path(codex_home, raw_path) {
        return Ok(Some(found));
    }
    if !raw.exists() {
        return Ok(None);
    }
    let Some(filename) = raw.file_name() else {
        return Ok(None);
    };
    let dest_dir = if raw
        .components()
        .any(|component| component.as_os_str() == ARCHIVED_SESSIONS_DIR)
    {
        codex_home.join(ARCHIVED_SESSIONS_DIR)
    } else {
        codex_home.join(SESSIONS_DIR)
    };
    fs::create_dir_all(&dest_dir)
        .map_err(|error| format!("create local rollout directory failed: {}", error))?;
    let dest = dest_dir.join(filename);
    fs::copy(&raw, &dest).map_err(|error| {
        format!(
            "copy rollout file failed ({} -> {}): {}",
            raw.display(),
            dest.display(),
            error
        )
    })?;
    Ok(Some(dest))
}

fn resolve_local_rollout_path(codex_home: &Path, raw_path: &str) -> Option<PathBuf> {
    let raw = PathBuf::from(raw_path);
    if raw.exists() && is_under(&raw, codex_home) {
        return None;
    }
    let filename = raw.file_name()?;
    let mut found = Vec::new();
    find_file_by_name(&codex_home.join(SESSIONS_DIR), filename, &mut found);
    if found.is_empty() {
        find_file_by_name(
            &codex_home.join(ARCHIVED_SESSIONS_DIR),
            filename,
            &mut found,
        );
    }
    found.into_iter().next()
}

fn count_missing_session_files(
    codex_home: &Path,
    conn: &Connection,
    columns: &[String],
) -> Result<i64, String> {
    if !columns.iter().any(|column| column == "rollout_path") {
        return Ok(0);
    }
    let mut missing = 0;
    let mut stmt = conn
        .prepare("SELECT rollout_path FROM threads")
        .map_err(|error| format!("prepare rollout path query failed: {}", error))?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| format!("query rollout paths failed: {}", error))?;
    for row in rows {
        let raw_path = row.map_err(|error| format!("read rollout path failed: {}", error))?;
        let path = PathBuf::from(&raw_path);
        if path.exists() && is_under(&path, codex_home) {
            continue;
        }
        if resolve_local_rollout_path(codex_home, &raw_path).is_none() {
            missing += 1;
        }
    }
    Ok(missing)
}

fn rebuild_session_index(
    codex_home: &Path,
    conn: &Connection,
    columns: &[String],
) -> Result<i64, String> {
    if !columns.iter().any(|column| column == "id") {
        return Ok(0);
    }
    let has_title = columns.iter().any(|column| column == "title");
    let has_updated_at = columns.iter().any(|column| column == "updated_at");
    let title_expr = if has_title { "title" } else { "id" };
    let updated_expr = if has_updated_at { "updated_at" } else { "0" };
    let sql = format!(
        "SELECT id, {}, {} FROM threads ORDER BY {}, id",
        title_expr, updated_expr, updated_expr
    );
    let mut stmt = conn
        .prepare(&sql)
        .map_err(|error| format!("prepare session index query failed: {}", error))?;
    let rows = stmt
        .query_map([], |row| {
            let id: String = row.get(0)?;
            let title: String = row.get(1).unwrap_or_else(|_| id.clone());
            let updated_at: i64 = row.get(2).unwrap_or(0);
            Ok((id, title, updated_at))
        })
        .map_err(|error| format!("query session index rows failed: {}", error))?;
    let mut lines = Vec::new();
    for row in rows {
        let (id, title, updated_at) =
            row.map_err(|error| format!("read session index row failed: {}", error))?;
        lines.push(
            serde_json::to_string(&json!({
                "id": id,
                "thread_name": title,
                "updated_at": iso_utc_from_unix(updated_at),
            }))
            .map_err(|error| format!("serialize session index row failed: {}", error))?,
        );
    }
    let mut content = lines.join("\n");
    if !content.is_empty() {
        content.push('\n');
    }
    crate::modules::atomic_write::write_string_atomic(
        &codex_home.join(SESSION_INDEX_FILE),
        &content,
    )
    .map_err(|error| format!("write session_index.jsonl failed: {}", error))?;
    Ok(lines.len() as i64)
}

fn rewrite_session_metadata(
    codex_home: &Path,
    target: &SyncTarget,
) -> Result<SessionRewriteStats, String> {
    let mut stats = SessionRewriteStats {
        updated: 0,
        invalid: 0,
        total: 0,
    };
    for path in iter_session_files(&codex_home.join(SESSIONS_DIR)) {
        stats.total += 1;
        match rewrite_one_session_metadata(&path, target, false)? {
            Some(true) => stats.updated += 1,
            Some(false) => {}
            None => stats.invalid += 1,
        }
    }
    Ok(stats)
}

fn count_session_rewrite_candidates(
    codex_home: &Path,
    target: &SyncTarget,
) -> Result<SessionRewriteStats, String> {
    let mut stats = SessionRewriteStats {
        updated: 0,
        invalid: 0,
        total: 0,
    };
    for path in iter_session_files(&codex_home.join(SESSIONS_DIR)) {
        stats.total += 1;
        match rewrite_one_session_metadata(&path, target, true)? {
            Some(true) => stats.updated += 1,
            Some(false) => {}
            None => stats.invalid += 1,
        }
    }
    Ok(stats)
}

fn rewrite_one_session_metadata(
    path: &Path,
    target: &SyncTarget,
    dry_run: bool,
) -> Result<Option<bool>, String> {
    let content = fs::read_to_string(path)
        .map_err(|error| format!("read session file failed ({}): {}", path.display(), error))?;
    let Some(first_line_end) = content.find('\n') else {
        return Ok(None);
    };
    let first_line = &content[..first_line_end];
    let remainder = &content[first_line_end..];
    let mut item: JsonValue = match serde_json::from_str(first_line) {
        Ok(value) => value,
        Err(_) => return Ok(None),
    };
    if item.get("type").and_then(JsonValue::as_str) != Some("session_meta") {
        return Ok(Some(false));
    }
    let Some(payload) = item.get_mut("payload").and_then(JsonValue::as_object_mut) else {
        return Ok(None);
    };
    let provider_matches =
        payload.get("model_provider").and_then(JsonValue::as_str) == Some(target.provider.as_str());
    let model_matches = match target.model.as_deref() {
        Some(model) => payload.get("model").and_then(JsonValue::as_str) == Some(model),
        None => true,
    };
    if provider_matches && model_matches {
        return Ok(Some(false));
    }
    if dry_run {
        return Ok(Some(true));
    }
    payload.insert(
        "model_provider".to_string(),
        JsonValue::String(target.provider.clone()),
    );
    if let Some(model) = target.model.as_deref() {
        payload.insert("model".to_string(), JsonValue::String(model.to_string()));
    }
    let next_first_line = serde_json::to_string(&item)
        .map_err(|error| format!("serialize session metadata failed: {}", error))?;
    crate::modules::atomic_write::write_string_atomic(
        path,
        &format!("{}{}", next_first_line, remainder),
    )
    .map_err(|error| {
        format!(
            "write session metadata failed ({}): {}",
            path.display(),
            error
        )
    })?;
    Ok(Some(true))
}

fn make_backup(codex_home: &Path) -> Result<PathBuf, String> {
    fs::create_dir_all(codex_home.join(BACKUP_DIR))
        .map_err(|error| format!("create backup dir failed: {}", error))?;
    let db_path = codex_home.join(DB_FILE);
    let conn =
        Connection::open(&db_path).map_err(|error| format!("open sqlite failed: {}", error))?;
    let _ = conn.execute_batch("PRAGMA wal_checkpoint(FULL);");
    let timestamp = Utc::now().format("%Y%m%d-%H%M%S").to_string();
    let backup_path = codex_home
        .join(BACKUP_DIR)
        .join(format!("state_5.sqlite.sync.{}.bak", timestamp));
    conn.backup(DatabaseName::Main, &backup_path, None)
        .map_err(|error| {
            format!(
                "sqlite online backup failed ({} -> {}): {}",
                db_path.display(),
                backup_path.display(),
                error
            )
        })?;
    let backup_conn = open_readonly(&backup_path)?;
    sqlite_integrity_check_conn(&backup_conn)?;
    let thread_count = query_i64(&conn, "SELECT COUNT(*) FROM threads", [])?;
    let session_index_count = count_jsonl_lines(&codex_home.join(SESSION_INDEX_FILE));
    let manifest = BackupManifest {
        format: BACKUP_FORMAT.to_string(),
        created_at: Utc::now().timestamp_millis(),
        codex_home: codex_home.to_string_lossy().to_string(),
        backup_path: backup_path.to_string_lossy().to_string(),
        thread_count,
        session_index_count,
    };
    let manifest_path = backup_path.with_extension("bak.manifest.json");
    let content = serde_json::to_string_pretty(&manifest)
        .map_err(|error| format!("serialize backup manifest failed: {}", error))?;
    crate::modules::atomic_write::write_string_atomic(&manifest_path, &content)
        .map_err(|error| format!("write backup manifest failed: {}", error))?;
    Ok(backup_path)
}

fn verify_backup(codex_home: &Path, backup_path: &Path) -> Result<(), String> {
    if !backup_path.exists() {
        return Err(format!("backup missing: {}", backup_path.display()));
    }
    let conn = open_readonly(backup_path)?;
    let backup_threads = query_i64(&conn, "SELECT COUNT(*) FROM threads", [])?;
    let manifest_path = backup_path.with_extension("bak.manifest.json");
    if !manifest_path.exists() {
        return Err(format!(
            "backup manifest missing: {}",
            manifest_path.display()
        ));
    }
    let content = fs::read_to_string(&manifest_path)
        .map_err(|error| format!("read backup manifest failed: {}", error))?;
    let manifest: BackupManifest = serde_json::from_str(&content)
        .map_err(|error| format!("parse backup manifest failed: {}", error))?;
    if manifest.format != BACKUP_FORMAT {
        return Err("backup manifest format mismatch".to_string());
    }
    if manifest.codex_home != codex_home.to_string_lossy() {
        return Err("backup manifest codex_home mismatch".to_string());
    }
    if manifest.thread_count != backup_threads {
        return Err(format!(
            "backup manifest thread count differs: manifest={}, backup={}",
            manifest.thread_count, backup_threads
        ));
    }
    Ok(())
}

fn prune_old_backups(
    codex_home: &Path,
    current_backup: Option<&Path>,
    warnings: &mut Vec<String>,
) -> Result<i64, String> {
    let dir = codex_home.join(BACKUP_DIR);
    let Ok(entries) = fs::read_dir(&dir) else {
        return Ok(0);
    };
    let current = current_backup.and_then(|path| path.canonicalize().ok());
    let now_ms = Utc::now().timestamp_millis();
    let keep_ms = BACKUP_KEEP_DAYS * 24 * 60 * 60 * 1000;
    let mut backups = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some("bak") {
            continue;
        }
        let modified_ms = fs::metadata(&path)
            .and_then(|metadata| metadata.modified())
            .ok()
            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|duration| duration.as_millis() as i64)
            .unwrap_or(0);
        backups.push((modified_ms, path));
    }
    backups.sort_by(|left, right| right.0.cmp(&left.0));
    let mut deleted = 0;
    for (index, (modified_ms, path)) in backups.into_iter().enumerate() {
        if current
            .as_ref()
            .is_some_and(|current| path.canonicalize().ok().as_ref() == Some(current))
        {
            continue;
        }
        let too_many = index >= BACKUP_KEEP_RECENT;
        let too_old = modified_ms > 0 && now_ms.saturating_sub(modified_ms) > keep_ms;
        if !too_many && !too_old {
            continue;
        }
        match fs::remove_file(&path) {
            Ok(()) => {
                deleted += 1;
                let manifest = path.with_extension("bak.manifest.json");
                let _ = fs::remove_file(manifest);
            }
            Err(error) => warnings.push(format!(
                "failed to delete old backup {}: {}",
                path.display(),
                error
            )),
        }
    }
    Ok(deleted)
}

fn write_sync_summary(codex_home: &Path, result: &CodexHistorySyncResult) -> Result<(), String> {
    let content = serde_json::to_string_pretty(result)
        .map_err(|error| format!("serialize sync summary failed: {}", error))?;
    crate::modules::atomic_write::write_string_atomic(&codex_home.join(SUMMARY_FILE), &content)
        .map_err(|error| format!("write sync summary failed: {}", error))
}

fn read_last_summary(codex_home: &Path) -> (Option<i64>, Option<String>) {
    let path = codex_home.join(SUMMARY_FILE);
    let Ok(content) = fs::read_to_string(path) else {
        return (None, None);
    };
    let Ok(value) = serde_json::from_str::<JsonValue>(&content) else {
        return (None, None);
    };
    let backup = value
        .get("backupPath")
        .and_then(JsonValue::as_str)
        .map(ToString::to_string);
    let sync_at = fs::metadata(codex_home.join(SUMMARY_FILE))
        .and_then(|metadata| metadata.modified())
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as i64);
    (sync_at, backup)
}

fn iter_session_files(root: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    collect_jsonl_files(root, &mut files);
    files.sort();
    files
}

fn collect_jsonl_files(root: &Path, files: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_jsonl_files(&path, files);
        } else if path.extension().and_then(|value| value.to_str()) == Some("jsonl") {
            files.push(path);
        }
    }
}

fn find_file_by_name(root: &Path, filename: &std::ffi::OsStr, found: &mut Vec<PathBuf>) {
    if !found.is_empty() {
        return;
    }
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            find_file_by_name(&path, filename, found);
        } else if path.file_name() == Some(filename) {
            found.push(path);
            return;
        }
    }
}

fn count_jsonl_lines(path: &Path) -> i64 {
    let Ok(content) = fs::read_to_string(path) else {
        return 0;
    };
    content
        .lines()
        .filter(|line| !line.trim().is_empty())
        .count() as i64
}

fn iso_utc_from_unix(timestamp: i64) -> String {
    let dt = Utc
        .timestamp_opt(timestamp, 0)
        .single()
        .unwrap_or_else(Utc::now);
    dt.format("%Y-%m-%dT%H:%M:%SZ").to_string()
}

fn is_under(path: &Path, root: &Path) -> bool {
    let Ok(path) = path.canonicalize() else {
        return false;
    };
    let Ok(root) = root.canonicalize() else {
        return false;
    };
    path.starts_with(root)
}

fn add_check(
    checks: &mut Vec<CodexHistoryCheck>,
    name: &str,
    ok: bool,
    message: String,
    required: bool,
) {
    checks.push(CodexHistoryCheck {
        name: name.to_string(),
        ok,
        message,
        required,
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TempCodexHome {
        path: PathBuf,
    }

    impl TempCodexHome {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "codex-clone-history-sync-test-{}",
                uuid::Uuid::new_v4()
            ));
            fs::create_dir_all(path.join(SESSIONS_DIR).join("2026").join("05")).unwrap();
            fs::write(
                path.join(CONFIG_FILE),
                r#"model_provider = "codex_local_access"
model = "gpt-5.5"
"#,
            )
            .unwrap();
            let conn = Connection::open(path.join(DB_FILE)).unwrap();
            conn.execute_batch(
                r#"
                CREATE TABLE threads (
                    id TEXT PRIMARY KEY,
                    title TEXT,
                    updated_at INTEGER,
                    model_provider TEXT,
                    model TEXT,
                    rollout_path TEXT
                );
                "#,
            )
            .unwrap();
            Self { path }
        }

        fn new_default_source() -> Self {
            let home = Self::new();
            fs::write(
                home.path.join(CONFIG_FILE),
                r#"model_provider = "openai"
model = "gpt-4.1"
"#,
            )
            .unwrap();
            home
        }

        fn session_path(&self, name: &str) -> PathBuf {
            self.path
                .join(SESSIONS_DIR)
                .join("2026")
                .join("05")
                .join(name)
        }

        fn insert_thread(&self, id: &str, title: &str, rollout_path: &Path) {
            let conn = Connection::open(self.path.join(DB_FILE)).unwrap();
            conn.execute(
                "INSERT INTO threads (id, title, updated_at, model_provider, model, rollout_path) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    id,
                    title,
                    1_700_000_000_i64,
                    "openai",
                    "gpt-4.1",
                    rollout_path.to_string_lossy().to_string()
                ],
            )
            .unwrap();
        }
    }

    impl Drop for TempCodexHome {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    struct TempExternalRoot {
        path: PathBuf,
    }

    impl TempExternalRoot {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "codex-clone-history-sync-external-{}",
                uuid::Uuid::new_v4()
            ));
            fs::create_dir_all(path.join(ARCHIVED_SESSIONS_DIR)).unwrap();
            Self { path }
        }

        fn archived_session_path(&self, name: &str) -> PathBuf {
            self.path.join(ARCHIVED_SESSIONS_DIR).join(name)
        }
    }

    impl Drop for TempExternalRoot {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    fn write_session(path: &Path, provider: &str, model: &str) {
        let content = format!(
            "{}\n{}\n",
            serde_json::to_string(&json!({
                "type": "session_meta",
                "payload": {
                    "id": "session-id",
                    "model_provider": provider,
                    "model": model
                }
            }))
            .unwrap(),
            serde_json::to_string(&json!({"type": "event_msg", "payload": {"message": "hello"}}))
                .unwrap()
        );
        fs::write(path, content).unwrap();
    }

    fn write_session_with_id(path: &Path, id: &str, provider: &str, model: &str) {
        let content = format!(
            "{}\n{}\n{}\n",
            serde_json::to_string(&json!({
                "type": "session_meta",
                "payload": {
                    "id": id,
                    "model_provider": provider,
                    "model": model
                }
            }))
            .unwrap(),
            serde_json::to_string(&json!({
                "type": "event_msg",
                "thread_id": id,
                "payload": {
                    "response_id": "resp_original",
                    "previous_response_id": "resp_previous",
                    "conversation_id": "conversation_original",
                    "message": "keep content"
                }
            }))
            .unwrap(),
            "{not json}"
        );
        fs::write(path, content).unwrap();
    }

    #[test]
    fn dry_run_reports_changes_without_writing_files() {
        let home = TempCodexHome::new();
        let session = home.session_path("rollout-a.jsonl");
        write_session(&session, "openai", "gpt-4.1");
        home.insert_thread("thread-a", "Thread A", &session);
        fs::write(home.path.join(SESSION_INDEX_FILE), "stale\n").unwrap();
        let before_session = fs::read_to_string(&session).unwrap();

        let result = sync_to_current_provider(&home.path, true).unwrap();

        assert!(result.dry_run);
        assert_eq!(result.mismatch_count_before, 1);
        assert_eq!(result.mismatch_count_after, 1);
        assert_eq!(result.updated_session_files, 1);
        assert!(result.backup_path.is_none());
        assert_eq!(fs::read_to_string(&session).unwrap(), before_session);
        assert_eq!(
            fs::read_to_string(home.path.join(SESSION_INDEX_FILE)).unwrap(),
            "stale\n"
        );
        assert_eq!(status(&home.path).unwrap().mismatch_count, 1);
    }

    #[test]
    fn sqlite_provider_model_sync_preserves_thread_count() {
        let home = TempCodexHome::new();
        let first = home.session_path("rollout-a.jsonl");
        let second = home.session_path("rollout-b.jsonl");
        write_session(&first, "openai", "gpt-4.1");
        write_session(&second, "openai", "gpt-4.1");
        home.insert_thread("thread-a", "Thread A", &first);
        home.insert_thread("thread-b", "Thread B", &second);
        let target = read_sync_target(&home.path).unwrap();
        let conn = Connection::open(home.path.join(DB_FILE)).unwrap();
        let columns = thread_columns(&conn).unwrap();
        let before = query_i64(&conn, "SELECT COUNT(*) FROM threads", []).unwrap();

        let updated = update_threads_metadata(&conn, &columns, &target).unwrap();

        assert_eq!(updated, 2);
        assert_eq!(
            query_i64(&conn, "SELECT COUNT(*) FROM threads", []).unwrap(),
            before
        );
        assert_eq!(count_mismatches(&conn, &columns, &target).unwrap(), 0);
    }

    #[test]
    fn session_jsonl_metadata_syncs_and_preserves_invalid_lines() {
        let home = TempCodexHome::new();
        let valid = home.session_path("rollout-valid.jsonl");
        let invalid = home.session_path("rollout-invalid.jsonl");
        write_session(&valid, "openai", "gpt-4.1");
        fs::write(&invalid, "{not json}\nkeep me\n").unwrap();
        let target = read_sync_target(&home.path).unwrap();

        let stats = rewrite_session_metadata(&home.path, &target).unwrap();

        assert_eq!(stats.updated, 1);
        assert_eq!(stats.invalid, 1);
        assert!(fs::read_to_string(&valid)
            .unwrap()
            .contains(r#""model_provider":"codex_local_access""#));
        assert!(fs::read_to_string(&valid)
            .unwrap()
            .contains(r#""model":"gpt-5.5""#));
        assert_eq!(
            fs::read_to_string(&invalid).unwrap(),
            "{not json}\nkeep me\n"
        );
    }

    #[test]
    fn backup_manifest_verifies_and_reports_missing_backup() {
        let home = TempCodexHome::new();
        let session = home.session_path("rollout-a.jsonl");
        write_session(&session, "openai", "gpt-4.1");
        home.insert_thread("thread-a", "Thread A", &session);

        let backup = make_backup(&home.path).unwrap();

        assert!(backup.exists());
        assert!(backup.with_extension("bak.manifest.json").exists());
        verify_backup(&home.path, &backup).unwrap();
        fs::remove_file(&backup).unwrap();
        assert!(verify_backup(&home.path, &backup)
            .unwrap_err()
            .contains("backup missing"));
    }

    #[test]
    fn rebuilt_session_index_count_matches_sqlite_threads() {
        let home = TempCodexHome::new();
        let first = home.session_path("rollout-a.jsonl");
        let second = home.session_path("rollout-b.jsonl");
        write_session(&first, "openai", "gpt-4.1");
        write_session(&second, "openai", "gpt-4.1");
        home.insert_thread("thread-a", "Thread A", &first);
        home.insert_thread("thread-b", "Thread B", &second);
        let conn = Connection::open(home.path.join(DB_FILE)).unwrap();
        let columns = thread_columns(&conn).unwrap();

        let count = rebuild_session_index(&home.path, &conn, &columns).unwrap();

        assert_eq!(count, 2);
        assert_eq!(count_jsonl_lines(&home.path.join(SESSION_INDEX_FILE)), 2);
    }

    #[test]
    fn external_archived_rollout_path_is_copied_and_normalized() {
        let home = TempCodexHome::new();
        let external = TempExternalRoot::new();
        let source = external.archived_session_path("rollout-archived.jsonl");
        write_session(&source, "openai", "gpt-4.1");
        home.insert_thread("thread-archived", "Archived Thread", &source);
        let conn = Connection::open(home.path.join(DB_FILE)).unwrap();
        let columns = thread_columns(&conn).unwrap();

        assert_eq!(
            count_missing_session_files(&home.path, &conn, &columns).unwrap(),
            1
        );

        let updated = normalize_rollout_paths(&home.path, &conn, &columns).unwrap();

        assert_eq!(updated, 1);
        let dest = home
            .path
            .join(ARCHIVED_SESSIONS_DIR)
            .join("rollout-archived.jsonl");
        assert!(dest.exists());
        assert_eq!(
            fs::read_to_string(&dest).unwrap(),
            fs::read_to_string(&source).unwrap()
        );
        let stored: String = conn
            .query_row(
                "SELECT rollout_path FROM threads WHERE id=?1",
                params!["thread-archived"],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(stored, dest.to_string_lossy());
        assert_eq!(
            count_missing_session_files(&home.path, &conn, &columns).unwrap(),
            0
        );
    }

    #[test]
    fn shared_sync_merges_missing_default_threads_without_rewriting_ids() {
        let default_home = TempCodexHome::new_default_source();
        let default_session = default_home.session_path("rollout-source.jsonl");
        write_session_with_id(&default_session, "thread-shared", "openai", "gpt-4.1");
        default_home.insert_thread("thread-shared", "Default Thread", &default_session);

        let clone = TempCodexHome::new();
        let conn = Connection::open(clone.path.join(DB_FILE)).unwrap();
        let columns = thread_columns(&conn).unwrap();
        let mut warnings = Vec::new();

        let synced = sync_threads_from_source(
            &clone.path,
            &default_home.path,
            &conn,
            &columns,
            false,
            &mut warnings,
        )
        .unwrap();
        let target = read_sync_target(&clone.path).unwrap();
        let updated_paths = normalize_rollout_paths(&clone.path, &conn, &columns).unwrap();
        update_threads_metadata(&conn, &columns, &target).unwrap();

        assert_eq!(synced, 1);
        assert!(warnings.is_empty());
        assert_eq!(updated_paths, 1);
        let id: String = conn
            .query_row("SELECT id FROM threads", [], |row| row.get(0))
            .unwrap();
        assert_eq!(id, "thread-shared");
        assert_eq!(count_mismatches(&conn, &columns, &target).unwrap(), 0);
        let rollout_path: String = conn
            .query_row("SELECT rollout_path FROM threads", [], |row| row.get(0))
            .unwrap();
        assert!(Path::new(&rollout_path).starts_with(&clone.path));
        assert!(Path::new(&rollout_path).exists());
    }

    #[test]
    fn shared_sync_does_not_copy_source_auth_or_config() {
        let default_home = TempCodexHome::new_default_source();
        let default_session = default_home.session_path("rollout-source.jsonl");
        write_session_with_id(&default_session, "thread-shared", "openai", "gpt-4.1");
        default_home.insert_thread("thread-shared", "Default Thread", &default_session);
        fs::write(
            default_home.path.join("auth.json"),
            r#"{"source":"secret"}"#,
        )
        .unwrap();
        fs::write(
            default_home.path.join(CONFIG_FILE),
            r#"model_provider = "source_provider"
model = "source-model"
"#,
        )
        .unwrap();

        let clone = TempCodexHome::new();
        fs::write(clone.path.join("auth.json"), r#"{"clone":"own-auth"}"#).unwrap();
        fs::write(
            clone.path.join(CONFIG_FILE),
            r#"model_provider = "clone_provider"
model = "clone-model"
"#,
        )
        .unwrap();
        let original_auth = fs::read_to_string(clone.path.join("auth.json")).unwrap();
        let original_config = fs::read_to_string(clone.path.join(CONFIG_FILE)).unwrap();
        let conn = Connection::open(clone.path.join(DB_FILE)).unwrap();
        let columns = thread_columns(&conn).unwrap();
        let mut warnings = Vec::new();

        let synced = sync_threads_from_source(
            &clone.path,
            &default_home.path,
            &conn,
            &columns,
            false,
            &mut warnings,
        )
        .unwrap();

        assert_eq!(synced, 1);
        assert_eq!(
            fs::read_to_string(clone.path.join("auth.json")).unwrap(),
            original_auth
        );
        assert_eq!(
            fs::read_to_string(clone.path.join(CONFIG_FILE)).unwrap(),
            original_config
        );
    }

    #[test]
    fn profile_lock_blocks_second_writer_until_released() {
        let home = TempCodexHome::new();
        let first = acquire_profile_lock(&home.path).unwrap();
        std::env::set_var("CODEX_CLONE_HISTORY_SYNC_TEST_LOCK_TIMEOUT_MS", "10");

        let error = acquire_profile_lock(&home.path).unwrap_err();
        std::env::remove_var("CODEX_CLONE_HISTORY_SYNC_TEST_LOCK_TIMEOUT_MS");

        assert!(error.contains("history sync lock is busy"));
        drop(first);
        let second = acquire_profile_lock(&home.path).unwrap();
        assert!(second.wait_ms < 1_000);
    }

    #[test]
    fn backup_retention_deletes_older_extra_backups_and_manifests() {
        let home = TempCodexHome::new();
        let backup_dir = home.path.join(BACKUP_DIR);
        fs::create_dir_all(&backup_dir).unwrap();
        for index in 0..12 {
            let backup = backup_dir.join(format!("state_5.sqlite.sync.{}.bak", index));
            fs::write(&backup, b"backup").unwrap();
            fs::write(backup.with_extension("bak.manifest.json"), b"manifest").unwrap();
            std::thread::sleep(Duration::from_millis(2));
        }
        let mut warnings = Vec::new();

        let deleted = prune_old_backups(&home.path, None, &mut warnings).unwrap();

        assert_eq!(deleted, 2);
        assert!(warnings.is_empty());
        let remaining = fs::read_dir(&backup_dir)
            .unwrap()
            .flatten()
            .filter(|entry| {
                entry.path().extension().and_then(|value| value.to_str()) == Some("bak")
            })
            .count();
        assert_eq!(remaining, BACKUP_KEEP_RECENT);
        assert!(!backup_dir
            .join("state_5.sqlite.sync.0.bak.manifest.json")
            .exists());
    }

    #[test]
    #[ignore = "manual local Codex profile repair smoke test"]
    fn local_codex_history_repair_from_env() {
        let home = std::env::var("CODEX_CLONE_HISTORY_SYNC_REPAIR_HOME")
            .expect("CODEX_CLONE_HISTORY_SYNC_REPAIR_HOME is required");
        let home = PathBuf::from(home);
        let bound_account_id = std::env::var("CODEX_CLONE_HISTORY_SYNC_BOUND_ACCOUNT_ID").ok();
        let context = CodexHistoryContext { bound_account_id };

        let result = sync_to_current_provider_with_context(&home, false, Some(&context)).unwrap();
        let verified = verify_with_context(&home, Some(&context)).unwrap();

        assert_eq!(result.mismatch_count_after, 0);
        assert_eq!(verified.session_index_count, verified.thread_count);
        if context.bound_account_id.is_some() {
            assert!(verified.auth_ok, "{:?}", verified.warnings);
        }
        assert!(verified.ok, "{:?}", verified.warnings);
    }
}
