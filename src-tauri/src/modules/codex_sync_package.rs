use std::fs;
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use chrono::Utc;
use rusqlite::{Connection, DatabaseName, OpenFlags};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use toml_edit::Document;

use crate::modules;

const PACKAGE_DIR_NAME: &str = "sync-package";
const PACKAGE_BACKUP_DIR_NAME: &str = "sync-package-backups";
const PACKAGE_CODEX_HOME_DIR_NAME: &str = "codex-home";
const MANIFEST_FILE_NAME: &str = "codex-sync-package-manifest.json";
const APPLIED_MARKER_FILE_NAME: &str = "clone-sync-package-applied.json";

// Keep the sync package to stable user data. Runtime caches/logs/plugin bundles
// stay out of the package so manual refresh/apply does not copy live app state.
const REPLACE_DIRECTORIES: &[&str] = &[
    "mcp-servers",
    "memories",
    "rules",
    "skills",
    "sqlite",
    "vendor_imports",
];
const MERGE_DIRECTORIES: &[&str] = &["sessions", "archived_sessions"];
const COPY_FILES: &[&str] = &[
    "AGENTS.md",
    "external_agent_session_imports.json",
    "goals_1.sqlite",
    "session_index.jsonl",
    "history.jsonl",
    "state_5.sqlite",
    "transcription-history.jsonl",
];
const LEGACY_CREDENTIAL_FILES: &[&str] = &[".credentials.json"];
const CONFIG_FILE: &str = "config.toml";
const PRESERVE_TARGET_FILES_IF_EXISTS: &[&str] = &["state_5.sqlite"];
const QUOTA_CONFIG_KEYS: &[&str] = &[
    "model",
    "model_provider",
    "model_providers",
    "openai_base_url",
];
const SECRET_CONFIG_KEY_FRAGMENTS: &[&str] = &[
    "api_key",
    "apikey",
    "authorization",
    "bearer",
    "client_secret",
    "credential",
    "credentials",
    "password",
    "private_key",
    "refresh_token",
    "secret",
    "token",
];
const SECRET_ARG_FRAGMENTS: &[&str] = &[
    "api-key",
    "api_key",
    "apikey",
    "authorization",
    "bearer",
    "client-secret",
    "client_secret",
    "credential",
    "credentials",
    "password",
    "private-key",
    "private_key",
    "refresh-token",
    "refresh_token",
    "secret",
    "token",
];
const FRESHNESS_DIRECTORIES: &[&str] = &[
    "archived_sessions",
    "mcp-servers",
    "memories",
    "rules",
    "sessions",
    "skills",
    "vendor_imports",
];
const FRESHNESS_FILES: &[&str] = &[
    "AGENTS.md",
    "external_agent_session_imports.json",
    "goals_1.sqlite",
    "history.jsonl",
    "session_index.jsonl",
    "transcription-history.jsonl",
];
const FRESHNESS_MTIME_GRACE_MS: i64 = 2_000;

// Freshness intentionally ignores volatile runtime stores such as
// state_5.sqlite, sqlite/, and config.toml. Those files can be rewritten by a
// running Codex app without changing the manually curated memory/skill/session
// package, which made freshly extracted packages look stale immediately.

#[derive(Debug, Clone, Default)]
struct CopyStats {
    file_count: u64,
    directory_count: u64,
    copied_bytes: u64,
}

impl CopyStats {
    fn add(&mut self, other: CopyStats) {
        self.file_count += other.file_count;
        self.directory_count += other.directory_count;
        self.copied_bytes += other.copied_bytes;
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexSyncPackageEntry {
    pub path: String,
    pub kind: String,
    pub status: String,
    pub bytes: u64,
    #[serde(default)]
    pub file_count: u64,
    #[serde(default)]
    pub directory_count: u64,
    pub sha256: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CodexSyncPackageResourceSummary {
    pub id: String,
    pub label: String,
    pub status: String,
    pub apply_mode: String,
    pub file_count: u64,
    pub directory_count: u64,
    pub bytes: u64,
    pub paths: Vec<String>,
    pub missing: Vec<String>,
    pub errors: Vec<String>,
    #[serde(default)]
    pub items: Vec<String>,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexSyncPackageManifest {
    pub version: u32,
    pub created_at: i64,
    pub source: String,
    pub package_path: String,
    pub manifest_path: String,
    pub file_count: u64,
    pub directory_count: u64,
    pub copied_bytes: u64,
    pub entries: Vec<CodexSyncPackageEntry>,
    #[serde(default)]
    pub resources: Vec<CodexSyncPackageResourceSummary>,
    pub skipped: Vec<String>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexSyncPackageStatus {
    pub exists: bool,
    pub package_path: String,
    pub manifest_path: String,
    pub source: Option<String>,
    pub created_at: Option<i64>,
    pub source_modified_at: Option<i64>,
    pub stale: bool,
    pub file_count: u64,
    pub directory_count: u64,
    pub copied_bytes: u64,
    pub entries: Vec<CodexSyncPackageEntry>,
    pub resources: Vec<CodexSyncPackageResourceSummary>,
    pub skipped: Vec<String>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexSyncPackageBackupSummary {
    pub id: String,
    pub backup_path: String,
    pub package_path: String,
    pub manifest_path: String,
    pub backup_created_at: Option<i64>,
    pub package_created_at: Option<i64>,
    pub source: Option<String>,
    pub file_count: u64,
    pub directory_count: u64,
    pub copied_bytes: u64,
    pub resource_count: u64,
    pub ready_resource_count: u64,
    pub status: String,
    pub warnings: Vec<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexSyncPackagePreflightCheck {
    pub id: String,
    pub label: String,
    pub status: String,
    pub detail: String,
    pub action: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexSyncPackagePreflightReport {
    pub checked_at: i64,
    pub status: String,
    pub ready_to_apply: bool,
    pub package_path: String,
    pub manifest_path: String,
    pub package_created_at: Option<i64>,
    pub source: Option<String>,
    pub stale: bool,
    pub entries_checked: u64,
    pub resources_checked: u64,
    pub error_count: u64,
    pub warning_count: u64,
    pub unsafe_paths: Vec<String>,
    pub checks: Vec<CodexSyncPackagePreflightCheck>,
}

struct ResourceSpec {
    id: &'static str,
    label: &'static str,
    detail: &'static str,
    apply_mode: &'static str,
    paths: &'static [&'static str],
}

const RESOURCE_SPECS: &[ResourceSpec] = &[
    ResourceSpec {
        id: "history",
        label: "聊天历史",
        detail: "sessions、archived_sessions、session_index、history.jsonl、state_5.sqlite",
        apply_mode: "sessions 合并；索引/历史文件替换；已有 clone state_5.sqlite 优先保留",
        paths: &[
            "sessions",
            "archived_sessions",
            "session_index.jsonl",
            "history.jsonl",
            "state_5.sqlite",
            "external_agent_session_imports.json",
            "transcription-history.jsonl",
        ],
    },
    ResourceSpec {
        id: "skills",
        label: "技能与规则",
        detail: "skills、rules、AGENTS.md",
        apply_mode: "整目录替换到分身 CODEX_HOME",
        paths: &["skills", "rules", "AGENTS.md"],
    },
    ResourceSpec {
        id: "mcp",
        label: "MCP 配置",
        detail: "mcp-servers 目录；config.toml 中的非账号 MCP 片段会安全合并",
        apply_mode: "mcp-servers 替换；config.toml 安全合并",
        paths: &["mcp-servers"],
    },
    ResourceSpec {
        id: "memory",
        label: "记忆与本地数据",
        detail: "memories、sqlite、vendor_imports",
        apply_mode: "整目录替换到分身 CODEX_HOME",
        paths: &["memories", "sqlite", "vendor_imports"],
    },
    ResourceSpec {
        id: "goals",
        label: "Goals",
        detail: "goals_1.sqlite",
        apply_mode: "Replace the clone goals database from the extracted source snapshot",
        paths: &["goals_1.sqlite"],
    },
    ResourceSpec {
        id: "config",
        label: "安全配置片段",
        detail: "config.toml 会移除账号、额度、provider/model 后再进入同步包",
        apply_mode: "只合并非账号、非额度、非 provider/model 字段",
        paths: &[CONFIG_FILE],
    },
];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexSyncPackageApplyResult {
    pub ok: bool,
    pub package_path: String,
    pub target: String,
    pub file_count: u64,
    pub directory_count: u64,
    pub copied_bytes: u64,
    pub skipped: Vec<String>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CodexSyncPackageAppliedMarker {
    pub version: u32,
    pub applied_at: i64,
    pub package_path: String,
    pub manifest_path: String,
    pub package_created_at: Option<i64>,
    pub source: Option<String>,
    pub stale_when_applied: bool,
    pub file_count: u64,
    pub directory_count: u64,
    pub copied_bytes: u64,
    pub resources: Vec<CodexSyncPackageResourceSummary>,
    pub warnings: Vec<String>,
}

fn package_root_dir() -> Result<PathBuf, String> {
    Ok(modules::account::get_data_dir()?.join(PACKAGE_DIR_NAME))
}

pub fn package_codex_home_dir() -> Result<PathBuf, String> {
    Ok(package_codex_home_dir_for(&package_root_dir()?))
}

fn manifest_path() -> Result<PathBuf, String> {
    Ok(manifest_path_for(&package_root_dir()?))
}

fn package_codex_home_dir_for(package_root: &Path) -> PathBuf {
    package_root.join(PACKAGE_CODEX_HOME_DIR_NAME)
}

fn package_backup_root_dir_for(package_root: &Path) -> PathBuf {
    package_root
        .parent()
        .map(|parent| parent.join(PACKAGE_BACKUP_DIR_NAME))
        .unwrap_or_else(|| package_root.join(PACKAGE_BACKUP_DIR_NAME))
}

fn manifest_path_for(package_root: &Path) -> PathBuf {
    package_root.join(MANIFEST_FILE_NAME)
}

pub fn list_sync_package_backups() -> Result<Vec<CodexSyncPackageBackupSummary>, String> {
    list_sync_package_backups_for(&package_root_dir()?)
}

fn list_sync_package_backups_for(
    package_root: &Path,
) -> Result<Vec<CodexSyncPackageBackupSummary>, String> {
    let backup_root = package_backup_root_dir_for(package_root);
    if !backup_root.exists() {
        return Ok(Vec::new());
    }
    let mut backups = Vec::new();
    for entry in fs::read_dir(&backup_root).map_err(|error| {
        format!(
            "read Codex sync package backup root failed ({}): {}",
            backup_root.display(),
            error
        )
    })? {
        let entry = entry.map_err(|error| {
            format!(
                "read Codex sync package backup entry failed ({}): {}",
                backup_root.display(),
                error
            )
        })?;
        let path = entry.path();
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        if !metadata.is_dir() {
            continue;
        }
        backups.push(sync_package_backup_summary_from_dir(&path));
    }
    backups.sort_by(|left, right| {
        right
            .backup_created_at
            .cmp(&left.backup_created_at)
            .then_with(|| right.id.cmp(&left.id))
    });
    Ok(backups)
}

fn sync_package_backup_summary_from_dir(backup_path: &Path) -> CodexSyncPackageBackupSummary {
    let id = backup_path
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| backup_path.to_string_lossy().to_string());
    let package_path = backup_path.join(PACKAGE_CODEX_HOME_DIR_NAME);
    let manifest_path = backup_path.join(MANIFEST_FILE_NAME);
    let backup_created_at = parse_sync_package_backup_id_timestamp(&id).or_else(|| {
        backup_path
            .metadata()
            .ok()
            .and_then(|metadata| metadata.modified().ok())
            .and_then(system_time_to_millis)
    });

    if !manifest_path.exists() {
        return CodexSyncPackageBackupSummary {
            id,
            backup_path: backup_path.to_string_lossy().to_string(),
            package_path: package_path.to_string_lossy().to_string(),
            manifest_path: manifest_path.to_string_lossy().to_string(),
            backup_created_at,
            package_created_at: None,
            source: None,
            file_count: 0,
            directory_count: 0,
            copied_bytes: 0,
            resource_count: 0,
            ready_resource_count: 0,
            status: "missingManifest".to_string(),
            warnings: vec!["backup manifest is missing".to_string()],
            error: None,
        };
    }

    let manifest = fs::read_to_string(&manifest_path)
        .map_err(|error| format!("read backup manifest failed: {}", error))
        .and_then(|content| {
            serde_json::from_str::<CodexSyncPackageManifest>(&content)
                .map_err(|error| format!("parse backup manifest failed: {}", error))
        });

    match manifest {
        Ok(manifest) => {
            let resources = if manifest.resources.is_empty() {
                resource_summaries_from_entries(&manifest.entries, &package_path)
            } else {
                manifest.resources.clone()
            };
            let ready_resource_count = resources
                .iter()
                .filter(|resource| resource.status == "ready")
                .count() as u64;
            CodexSyncPackageBackupSummary {
                id,
                backup_path: backup_path.to_string_lossy().to_string(),
                package_path: package_path.to_string_lossy().to_string(),
                manifest_path: manifest_path.to_string_lossy().to_string(),
                backup_created_at,
                package_created_at: Some(manifest.created_at),
                source: Some(manifest.source),
                file_count: manifest.file_count,
                directory_count: manifest.directory_count,
                copied_bytes: manifest.copied_bytes,
                resource_count: resources.len() as u64,
                ready_resource_count,
                status: "ready".to_string(),
                warnings: manifest.warnings,
                error: None,
            }
        }
        Err(error) => CodexSyncPackageBackupSummary {
            id,
            backup_path: backup_path.to_string_lossy().to_string(),
            package_path: package_path.to_string_lossy().to_string(),
            manifest_path: manifest_path.to_string_lossy().to_string(),
            backup_created_at,
            package_created_at: None,
            source: None,
            file_count: 0,
            directory_count: 0,
            copied_bytes: 0,
            resource_count: 0,
            ready_resource_count: 0,
            status: "error".to_string(),
            warnings: Vec::new(),
            error: Some(error),
        },
    }
}

pub fn restore_sync_package_backup(backup_id: &str) -> Result<CodexSyncPackageStatus, String> {
    restore_sync_package_backup_for(&package_root_dir()?, backup_id)
}

fn restore_sync_package_backup_for(
    package_root: &Path,
    backup_id: &str,
) -> Result<CodexSyncPackageStatus, String> {
    let backup_id = normalize_sync_package_backup_id(backup_id)?;
    let backup_root = package_backup_root_dir_for(package_root);
    let backup_path = backup_root.join(&backup_id);
    let backup_metadata = fs::symlink_metadata(&backup_path).map_err(|error| {
        format!(
            "read Codex sync package backup failed ({}): {}",
            backup_path.display(),
            error
        )
    })?;
    if !backup_metadata.is_dir() || is_linked_path(&backup_path, &backup_metadata) {
        return Err(format!(
            "Codex sync package backup is not a regular directory: {}",
            backup_path.display()
        ));
    }

    let summary = sync_package_backup_summary_from_dir(&backup_path);
    if summary.status != "ready" {
        return Err(format!(
            "Codex sync package backup {} is not restorable: {}",
            backup_id,
            summary.error.unwrap_or(summary.status)
        ));
    }

    let backup_home = backup_path.join(PACKAGE_CODEX_HOME_DIR_NAME);
    let backup_manifest = backup_path.join(MANIFEST_FILE_NAME);
    if !backup_home.is_dir() || !backup_manifest.is_file() {
        return Err(format!(
            "Codex sync package backup {} is incomplete",
            backup_id
        ));
    }

    fs::create_dir_all(package_root)
        .map_err(|error| format!("create Codex sync package root failed: {}", error))?;
    let package_home = package_codex_home_dir_for(package_root);
    let manifest_path = manifest_path_for(package_root);
    let restored_over_backup =
        backup_existing_sync_package(package_root, &package_home, &manifest_path)?;

    remove_existing_path(&package_home)?;
    remove_existing_path(&manifest_path)?;
    copy_directory_replace(&backup_home, &package_home)
        .map_err(|error| format!("restore Codex sync package home failed: {}", error))?;
    copy_file_replace(&backup_manifest, &manifest_path)
        .map_err(|error| format!("restore Codex sync package manifest failed: {}", error))?;

    let mut status = status_for(package_root)?;
    status
        .warnings
        .push(format!("restored sync package backup {}", backup_id));
    if let Some(path) = restored_over_backup {
        status.warnings.push(format!(
            "current sync package backed up before restore to {}",
            path.display()
        ));
    }
    Ok(status)
}

fn normalize_sync_package_backup_id(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    let Some(timestamp) = trimmed.strip_prefix("sync-package-") else {
        return Err("invalid Codex sync package backup id".to_string());
    };
    if timestamp.is_empty() || !timestamp.chars().all(|ch| ch.is_ascii_digit()) {
        return Err("invalid Codex sync package backup id".to_string());
    }
    if parse_sync_package_backup_id_timestamp(trimmed).is_none() {
        return Err("invalid Codex sync package backup id".to_string());
    }
    Ok(trimmed.to_string())
}

pub fn preflight_sync_package() -> Result<CodexSyncPackagePreflightReport, String> {
    preflight_sync_package_for(&package_root_dir()?, None)
}

fn preflight_sync_package_for(
    package_root: &Path,
    current_source_override: Option<&Path>,
) -> Result<CodexSyncPackagePreflightReport, String> {
    let package_path = package_codex_home_dir_for(package_root);
    let manifest_path = manifest_path_for(package_root);
    let package_present = package_path.exists() && manifest_path.exists();
    let mut checks = Vec::new();
    let mut package_created_at = None;
    let mut source = None;
    let mut stale = false;
    let mut entries_checked = 0_u64;
    let mut resources_checked = 0_u64;
    let mut unsafe_paths = Vec::new();

    if !package_present {
        push_preflight_check(
            &mut checks,
            "package.exists",
            "Package exists",
            "error",
            format!(
                "missing package home or manifest: home={}, manifest={}",
                package_path.display(),
                manifest_path.display()
            ),
            Some("Run Extract/Refresh Source before Sync/Repair.".to_string()),
        );
        return Ok(finalize_preflight_report(
            package_present,
            &package_path,
            &manifest_path,
            package_created_at,
            source,
            stale,
            entries_checked,
            resources_checked,
            unsafe_paths,
            checks,
        ));
    }

    push_preflight_check(
        &mut checks,
        "package.exists",
        "Package exists",
        "ok",
        "package home and manifest are present",
        None,
    );

    let manifest_content = match fs::read_to_string(&manifest_path) {
        Ok(content) => content,
        Err(error) => {
            push_preflight_check(
                &mut checks,
                "manifest.read",
                "Manifest readable",
                "error",
                format!("read manifest failed: {}", error),
                Some("Extract/Refresh Source to rebuild the package manifest.".to_string()),
            );
            return Ok(finalize_preflight_report(
                package_present,
                &package_path,
                &manifest_path,
                package_created_at,
                source,
                stale,
                entries_checked,
                resources_checked,
                unsafe_paths,
                checks,
            ));
        }
    };
    push_preflight_check(
        &mut checks,
        "manifest.read",
        "Manifest readable",
        "ok",
        "manifest JSON file can be read",
        None,
    );

    let manifest = match serde_json::from_str::<CodexSyncPackageManifest>(&manifest_content) {
        Ok(manifest) => manifest,
        Err(error) => {
            push_preflight_check(
                &mut checks,
                "manifest.parse",
                "Manifest parses",
                "error",
                format!("parse manifest failed: {}", error),
                Some("Extract/Refresh Source to rebuild the package manifest.".to_string()),
            );
            return Ok(finalize_preflight_report(
                package_present,
                &package_path,
                &manifest_path,
                package_created_at,
                source,
                stale,
                entries_checked,
                resources_checked,
                unsafe_paths,
                checks,
            ));
        }
    };

    package_created_at = Some(manifest.created_at);
    source = Some(manifest.source.clone());
    entries_checked = manifest.entries.len() as u64;
    push_preflight_check(
        &mut checks,
        "manifest.parse",
        "Manifest parses",
        "ok",
        format!("manifest contains {} entries", entries_checked),
        None,
    );

    if manifest.version == 1 {
        push_preflight_check(
            &mut checks,
            "manifest.version",
            "Manifest version",
            "ok",
            "version 1 is supported",
            None,
        );
    } else {
        push_preflight_check(
            &mut checks,
            "manifest.version",
            "Manifest version",
            "warning",
            format!("unexpected manifest version {}", manifest.version),
            Some(
                "Refresh the source package if this was not produced by the current app."
                    .to_string(),
            ),
        );
    }

    let manifest_package_path = PathBuf::from(&manifest.package_path);
    if paths_equal_or_same(&manifest_package_path, &package_path) {
        push_preflight_check(
            &mut checks,
            "manifest.packagePath",
            "Package path",
            "ok",
            "manifest package path matches this package root",
            None,
        );
    } else {
        push_preflight_check(
            &mut checks,
            "manifest.packagePath",
            "Package path",
            "warning",
            format!(
                "manifest package path differs: manifest={}, current={}",
                manifest_package_path.display(),
                package_path.display()
            ),
            Some("Refresh the source package to rewrite path metadata.".to_string()),
        );
    }

    match status_from_manifest(&manifest, current_source_override) {
        Ok(status) => {
            stale = status.stale;
            resources_checked = status.resources.len() as u64;
            if status.stale {
                push_preflight_check(
                    &mut checks,
                    "package.freshness",
                    "Package freshness",
                    "warning",
                    "source data changed after this package was extracted",
                    Some("Sync/Repair will apply this package; refresh source first only if you want newer source data.".to_string()),
                );
            } else {
                push_preflight_check(
                    &mut checks,
                    "package.freshness",
                    "Package freshness",
                    "ok",
                    "package source metadata is current",
                    None,
                );
            }
            add_resource_preflight_check(&mut checks, &status.resources);
        }
        Err(error) => push_preflight_check(
            &mut checks,
            "package.status",
            "Package status",
            "error",
            format!("status calculation failed: {}", error),
            Some("Extract/Refresh Source to rebuild package status metadata.".to_string()),
        ),
    }

    add_entry_preflight_check(&mut checks, &manifest.entries, &package_path);

    unsafe_paths = find_unsafe_package_paths(&package_path);
    if unsafe_paths.is_empty() {
        push_preflight_check(
            &mut checks,
            "package.boundary",
            "Boundary scan",
            "ok",
            "no auth/runtime/plugin bundle paths were found in the package",
            None,
        );
    } else {
        push_preflight_check(
            &mut checks,
            "package.boundary",
            "Boundary scan",
            "error",
            format!("unsafe package paths: {}", unsafe_paths.join(", ")),
            Some(
                "Extract/Refresh Source with the current whitelist before applying to clones."
                    .to_string(),
            ),
        );
    }

    match unsafe_config_keys_in_package_config(&package_path.join(CONFIG_FILE)) {
        Ok(keys) if keys.is_empty() => push_preflight_check(
            &mut checks,
            "config.boundary",
            "Config boundary",
            "ok",
            "provider/model/quota keys are not present in package config.toml",
            None,
        ),
        Ok(keys) => push_preflight_check(
            &mut checks,
            "config.boundary",
            "Config boundary",
            "error",
            format!("unsafe config keys present: {}", keys.join(", ")),
            Some(
                "Extract/Refresh Source to rebuild safe config.toml before Sync/Repair."
                    .to_string(),
            ),
        ),
        Err(error) => push_preflight_check(
            &mut checks,
            "config.boundary",
            "Config boundary",
            "error",
            error,
            Some("Fix or refresh the package config.toml before Sync/Repair.".to_string()),
        ),
    }

    if manifest.warnings.is_empty() && manifest.skipped.is_empty() {
        push_preflight_check(
            &mut checks,
            "manifest.notes",
            "Manifest notes",
            "ok",
            "no extraction warnings or skipped paths were recorded",
            None,
        );
    } else {
        push_preflight_check(
            &mut checks,
            "manifest.notes",
            "Manifest notes",
            "warning",
            format!(
                "{} warnings, {} skipped paths recorded",
                manifest.warnings.len(),
                manifest.skipped.len()
            ),
            Some("Review the resource list and manifest preview before Sync/Repair.".to_string()),
        );
    }

    Ok(finalize_preflight_report(
        package_present,
        &package_path,
        &manifest_path,
        package_created_at,
        source,
        stale,
        entries_checked,
        resources_checked,
        unsafe_paths,
        checks,
    ))
}

fn push_preflight_check(
    checks: &mut Vec<CodexSyncPackagePreflightCheck>,
    id: &str,
    label: &str,
    status: &str,
    detail: impl Into<String>,
    action: Option<String>,
) {
    checks.push(CodexSyncPackagePreflightCheck {
        id: id.to_string(),
        label: label.to_string(),
        status: status.to_string(),
        detail: detail.into(),
        action,
    });
}

fn finalize_preflight_report(
    package_present: bool,
    package_path: &Path,
    manifest_path: &Path,
    package_created_at: Option<i64>,
    source: Option<String>,
    stale: bool,
    entries_checked: u64,
    resources_checked: u64,
    unsafe_paths: Vec<String>,
    checks: Vec<CodexSyncPackagePreflightCheck>,
) -> CodexSyncPackagePreflightReport {
    let error_count = checks
        .iter()
        .filter(|check| check.status == "error")
        .count() as u64;
    let warning_count = checks
        .iter()
        .filter(|check| check.status == "warning")
        .count() as u64;
    let status = if !package_present {
        "missing"
    } else if error_count > 0 {
        "error"
    } else if warning_count > 0 {
        "warning"
    } else {
        "ok"
    };
    CodexSyncPackagePreflightReport {
        checked_at: Utc::now().timestamp_millis(),
        status: status.to_string(),
        ready_to_apply: package_present && error_count == 0,
        package_path: package_path.to_string_lossy().to_string(),
        manifest_path: manifest_path.to_string_lossy().to_string(),
        package_created_at,
        source,
        stale,
        entries_checked,
        resources_checked,
        error_count,
        warning_count,
        unsafe_paths,
        checks,
    }
}

fn add_resource_preflight_check(
    checks: &mut Vec<CodexSyncPackagePreflightCheck>,
    resources: &[CodexSyncPackageResourceSummary],
) {
    let errors: Vec<String> = resources
        .iter()
        .filter(|resource| resource.status == "error")
        .map(|resource| resource.label.clone())
        .collect();
    let partial: Vec<String> = resources
        .iter()
        .filter(|resource| resource.status == "partial")
        .map(|resource| resource.label.clone())
        .collect();
    let missing: Vec<String> = resources
        .iter()
        .filter(|resource| resource.status == "missing")
        .map(|resource| resource.label.clone())
        .collect();
    if !errors.is_empty() {
        push_preflight_check(
            checks,
            "resources.status",
            "Resource status",
            "error",
            format!("resource extraction errors: {}", errors.join(", ")),
            Some("Refresh source package after fixing the source resource errors.".to_string()),
        );
    } else if !partial.is_empty() {
        push_preflight_check(
            checks,
            "resources.status",
            "Resource status",
            "warning",
            format!("partially extracted resources: {}", partial.join(", ")),
            Some("Review resource details before Sync/Repair.".to_string()),
        );
    } else {
        let detail = if missing.is_empty() {
            format!("{} resource groups are ready", resources.len())
        } else {
            format!(
                "{} resource groups checked; optional/missing: {}",
                resources.len(),
                missing.join(", ")
            )
        };
        push_preflight_check(
            checks,
            "resources.status",
            "Resource status",
            "ok",
            detail,
            None,
        );
    }
}

fn add_entry_preflight_check(
    checks: &mut Vec<CodexSyncPackagePreflightCheck>,
    entries: &[CodexSyncPackageEntry],
    package_home: &Path,
) {
    let mut errors = Vec::new();
    let mut warnings = Vec::new();
    for entry in entries {
        if !is_safe_package_relative_path(&entry.path) {
            errors.push(format!("{}: unsafe relative path", entry.path));
            continue;
        }
        match entry.status.as_str() {
            "copied" => {
                let target = package_home.join(&entry.path);
                match fs::symlink_metadata(&target) {
                    Ok(metadata) => {
                        if entry.kind == "file" && !metadata.is_file() {
                            errors.push(format!("{}: expected file", entry.path));
                        } else if entry.kind == "directory" && !metadata.is_dir() {
                            errors.push(format!("{}: expected directory", entry.path));
                        }
                        if entry.kind == "file" {
                            if entry.bytes != metadata.len() {
                                warnings.push(format!(
                                    "{}: byte count differs manifest={} actual={}",
                                    entry.path,
                                    entry.bytes,
                                    metadata.len()
                                ));
                            }
                            if let Some(expected_sha256) = &entry.sha256 {
                                match sha256_file(&target) {
                                    Ok((_, actual_sha256)) if actual_sha256 == *expected_sha256 => {
                                    }
                                    Ok((_, actual_sha256)) => errors.push(format!(
                                        "{}: sha256 mismatch manifest={} actual={}",
                                        entry.path, expected_sha256, actual_sha256
                                    )),
                                    Err(error) => errors.push(format!(
                                        "{}: sha256 check failed: {}",
                                        entry.path, error
                                    )),
                                }
                            }
                        }
                    }
                    Err(error) => {
                        errors.push(format!("{}: missing copied entry: {}", entry.path, error))
                    }
                }
            }
            "missing" => {}
            "error" => errors.push(format!(
                "{}: extraction error{}",
                entry.path,
                entry
                    .error
                    .as_ref()
                    .map(|error| format!(": {}", error))
                    .unwrap_or_default()
            )),
            other => errors.push(format!("{}: unexpected status {}", entry.path, other)),
        }
    }

    if !errors.is_empty() {
        push_preflight_check(
            checks,
            "entries.integrity",
            "Entry integrity",
            "error",
            errors.into_iter().take(6).collect::<Vec<_>>().join(" / "),
            Some("Refresh the source package; do not apply a corrupted package.".to_string()),
        );
    } else if !warnings.is_empty() {
        push_preflight_check(
            checks,
            "entries.integrity",
            "Entry integrity",
            "warning",
            warnings.into_iter().take(6).collect::<Vec<_>>().join(" / "),
            Some("Review byte-count drift before Sync/Repair.".to_string()),
        );
    } else {
        push_preflight_check(
            checks,
            "entries.integrity",
            "Entry integrity",
            "ok",
            format!("{} manifest entries verified", entries.len()),
            None,
        );
    }
}

fn is_safe_package_relative_path(relative: &str) -> bool {
    let path = Path::new(relative);
    !path.is_absolute()
        && path
            .components()
            .all(|component| matches!(component, Component::Normal(_) | Component::CurDir))
}

fn find_unsafe_package_paths(package_home: &Path) -> Vec<String> {
    let mut unsafe_paths = Vec::new();
    collect_unsafe_package_paths(package_home, package_home, &mut unsafe_paths);
    unsafe_paths.sort();
    unsafe_paths.dedup();
    unsafe_paths.truncate(24);
    unsafe_paths
}

fn collect_unsafe_package_paths(root: &Path, path: &Path, unsafe_paths: &mut Vec<String>) {
    if unsafe_paths.len() >= 24 {
        return;
    }
    let Ok(entries) = fs::read_dir(path) else {
        return;
    };
    for entry in entries.flatten() {
        let entry_path = entry.path();
        let Ok(metadata) = fs::symlink_metadata(&entry_path) else {
            continue;
        };
        if let Ok(relative) = entry_path.strip_prefix(root) {
            let relative_text = relative.to_string_lossy().replace('\\', "/");
            if is_unsafe_package_relative_path(&relative_text) {
                unsafe_paths.push(relative_text);
            }
        }
        if metadata.is_dir() && !is_linked_path(&entry_path, &metadata) {
            collect_unsafe_package_paths(root, &entry_path, unsafe_paths);
        }
        if unsafe_paths.len() >= 24 {
            return;
        }
    }
}

fn is_unsafe_package_relative_path(relative: &str) -> bool {
    let mut parts = relative.split('/').filter(|part| !part.is_empty());
    let first = parts.next().unwrap_or_default().to_ascii_lowercase();
    let name = relative
        .rsplit('/')
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    matches!(
        first.as_str(),
        "plugins" | "cache" | "log" | "logs" | ".tmp" | "tmp"
    ) || matches!(
        name.as_str(),
        "auth.json" | ".credentials.json" | "credentials.json"
    )
}

fn unsafe_config_keys_in_package_config(config_path: &Path) -> Result<Vec<String>, String> {
    if !config_path.exists() {
        return Ok(Vec::new());
    }
    let content = fs::read_to_string(config_path).map_err(|error| {
        format!(
            "read package config.toml failed ({}): {}",
            config_path.display(),
            error
        )
    })?;
    let doc = content
        .parse::<Document>()
        .map_err(|error| format!("parse package config.toml failed: {}", error))?;
    let mut keys = QUOTA_CONFIG_KEYS
        .iter()
        .filter(|key| doc.contains_key(**key))
        .map(|key| (*key).to_string())
        .collect::<Vec<_>>();
    keys.sort();
    Ok(keys)
}

fn parse_sync_package_backup_id_timestamp(id: &str) -> Option<i64> {
    id.strip_prefix("sync-package-")?.parse::<i64>().ok()
}

pub fn status() -> Result<CodexSyncPackageStatus, String> {
    status_for(&package_root_dir()?)
}

fn status_for(package_root: &Path) -> Result<CodexSyncPackageStatus, String> {
    status_for_source(package_root, None)
}

fn status_for_source(
    package_root: &Path,
    current_source_override: Option<&Path>,
) -> Result<CodexSyncPackageStatus, String> {
    let package_path = package_codex_home_dir_for(package_root);
    let manifest_path = manifest_path_for(package_root);
    if !package_path.exists() || !manifest_path.exists() {
        return Ok(CodexSyncPackageStatus {
            exists: false,
            package_path: package_path.to_string_lossy().to_string(),
            manifest_path: manifest_path.to_string_lossy().to_string(),
            source: None,
            created_at: None,
            source_modified_at: None,
            stale: false,
            file_count: 0,
            directory_count: 0,
            copied_bytes: 0,
            entries: Vec::new(),
            resources: resource_summaries_from_entries(&[], &package_path),
            skipped: Vec::new(),
            warnings: Vec::new(),
        });
    }

    let content = fs::read_to_string(&manifest_path).map_err(|error| {
        format!(
            "read Codex sync package manifest failed ({}): {}",
            manifest_path.display(),
            error
        )
    })?;
    let manifest: CodexSyncPackageManifest = serde_json::from_str(&content)
        .map_err(|error| format!("parse Codex sync package manifest failed: {}", error))?;
    status_from_manifest(&manifest, current_source_override)
}

fn status_from_manifest(
    manifest: &CodexSyncPackageManifest,
    current_source_override: Option<&Path>,
) -> Result<CodexSyncPackageStatus, String> {
    let (source_modified_at, stale, mut freshness_warnings) =
        sync_package_freshness(manifest, current_source_override);
    let mut warnings = manifest.warnings.clone();
    warnings.append(&mut freshness_warnings);
    let resources = if manifest.resources.is_empty() {
        resource_summaries_from_entries(&manifest.entries, Path::new(&manifest.package_path))
    } else {
        manifest.resources.clone()
    };
    Ok(CodexSyncPackageStatus {
        exists: true,
        package_path: manifest.package_path.clone(),
        manifest_path: manifest.manifest_path.clone(),
        source: Some(manifest.source.clone()),
        created_at: Some(manifest.created_at),
        source_modified_at,
        stale,
        file_count: manifest.file_count,
        directory_count: manifest.directory_count,
        copied_bytes: manifest.copied_bytes,
        entries: manifest.entries.clone(),
        resources,
        skipped: manifest.skipped.clone(),
        warnings,
    })
}

fn sync_package_freshness(
    manifest: &CodexSyncPackageManifest,
    current_source_override: Option<&Path>,
) -> (Option<i64>, bool, Vec<String>) {
    let mut warnings = Vec::new();
    let manifest_source = PathBuf::from(&manifest.source);
    let current_source = match current_source_override {
        Some(path) => path.to_path_buf(),
        None => match modules::codex_instance::get_default_codex_home() {
            Ok(path) => path,
            Err(error) => {
                warnings.push(format!(
                    "sync package source freshness check skipped: {}",
                    error
                ));
                manifest_source.clone()
            }
        },
    };
    let source_changed = !paths_equal_or_same(&manifest_source, &current_source);
    if source_changed {
        warnings.push(format!(
            "sync package source changed: package was extracted from {}, current source is {}",
            manifest_source.display(),
            current_source.display()
        ));
    }

    let source_modified_at = match sync_source_modified_at(&current_source) {
        Ok(value) => value,
        Err(error) => {
            warnings.push(format!(
                "sync package source freshness check skipped: {}",
                error
            ));
            None
        }
    };
    let stale_by_time = source_modified_at
        .map(|modified_at| modified_at > manifest.created_at + FRESHNESS_MTIME_GRACE_MS)
        .unwrap_or(false);
    if stale_by_time {
        warnings.push(
            "local Codex home changed after sync package extraction; refresh the main sync package before applying it to clones"
                .to_string(),
        );
    }

    (
        source_modified_at,
        source_changed || stale_by_time,
        warnings,
    )
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

fn sync_source_modified_at(source_home: &Path) -> Result<Option<i64>, String> {
    let mut latest = None;
    for relative in FRESHNESS_DIRECTORIES.iter().chain(FRESHNESS_FILES.iter()) {
        update_latest_modified_at(&source_home.join(relative), &mut latest)?;
    }
    Ok(latest)
}

fn update_latest_modified_at(path: &Path, latest: &mut Option<i64>) -> Result<(), String> {
    let Ok(metadata) = fs::symlink_metadata(path) else {
        return Ok(());
    };
    if let Ok(modified) = metadata.modified() {
        if let Some(modified_at) = system_time_to_millis(modified) {
            if latest.map(|value| modified_at > value).unwrap_or(true) {
                *latest = Some(modified_at);
            }
        }
    }
    if metadata.is_dir() && !is_linked_path(path, &metadata) {
        for entry in fs::read_dir(path).map_err(|error| {
            format!(
                "read source freshness directory failed ({}): {}",
                path.display(),
                error
            )
        })? {
            let entry = entry.map_err(|error| {
                format!(
                    "read source freshness entry failed ({}): {}",
                    path.display(),
                    error
                )
            })?;
            update_latest_modified_at(&entry.path(), latest)?;
        }
    }
    Ok(())
}

fn system_time_to_millis(time: SystemTime) -> Option<i64> {
    let millis = time.duration_since(UNIX_EPOCH).ok()?.as_millis();
    Some(millis.min(i64::MAX as u128) as i64)
}

pub fn ensure_sync_package() -> Result<CodexSyncPackageStatus, String> {
    require_existing_sync_package_for(&package_root_dir()?)
}

fn require_existing_sync_package_for(
    package_root: &Path,
) -> Result<CodexSyncPackageStatus, String> {
    require_existing_sync_package_for_source(package_root, None)
}

fn require_existing_sync_package_for_source(
    package_root: &Path,
    current_source_override: Option<&Path>,
) -> Result<CodexSyncPackageStatus, String> {
    let current = status_for_source(package_root, current_source_override)?;
    if current.exists {
        return Ok(current);
    }
    Err(
        "Codex sync package is missing. Click `提取/刷新本体` first, then run `同步/修复`."
            .to_string(),
    )
}

pub fn extract_sync_package() -> Result<CodexSyncPackageStatus, String> {
    let source_home = modules::codex_instance::get_default_codex_home()?;
    extract_sync_package_from(&source_home, &package_root_dir()?)
}

fn extract_sync_package_from(
    source_home: &Path,
    package_root: &Path,
) -> Result<CodexSyncPackageStatus, String> {
    let package_home = package_codex_home_dir_for(package_root);
    let manifest_path = manifest_path_for(package_root);
    let mut entries = Vec::new();
    let mut skipped = Vec::new();
    let mut warnings = Vec::new();
    let mut totals = CopyStats::default();

    fs::create_dir_all(&package_root)
        .map_err(|error| format!("create Codex sync package root failed: {}", error))?;
    if let Some(backup_path) =
        backup_existing_sync_package(package_root, &package_home, &manifest_path)?
    {
        warnings.push(format!(
            "previous sync package backed up to {}",
            backup_path.display()
        ));
    }
    remove_existing_path(&package_home)?;
    fs::create_dir_all(&package_home)
        .map_err(|error| format!("create Codex sync package home failed: {}", error))?;

    for relative in REPLACE_DIRECTORIES.iter().chain(MERGE_DIRECTORIES.iter()) {
        let source = source_home.join(relative);
        let target = package_home.join(relative);
        if !source.exists() {
            skipped.push((*relative).to_string());
            entries.push(package_entry(
                *relative,
                "directory",
                "missing",
                0,
                0,
                0,
                None,
                None,
            ));
            continue;
        }
        match copy_directory_replace(&source, &target) {
            Ok(stats) => {
                totals.add(stats.clone());
                entries.push(package_entry(
                    *relative,
                    "directory",
                    "copied",
                    stats.copied_bytes,
                    stats.file_count,
                    stats.directory_count,
                    None,
                    None,
                ));
            }
            Err(error) => {
                warnings.push(format!("directory extract skipped {}: {}", relative, error));
                entries.push(package_entry(
                    *relative,
                    "directory",
                    "error",
                    0,
                    0,
                    0,
                    None,
                    Some(error),
                ));
            }
        }
    }

    for relative in COPY_FILES {
        let source = source_home.join(relative);
        let target = package_home.join(relative);
        if !source.exists() {
            skipped.push((*relative).to_string());
            entries.push(package_entry(
                *relative, "file", "missing", 0, 0, 0, None, None,
            ));
            continue;
        }
        let result = if is_probable_sqlite_database_file(&source) {
            copy_sqlite_snapshot_replace(&source, &target)
        } else {
            copy_file_replace(&source, &target)
        };
        match result {
            Ok((bytes, sha256)) => {
                totals.file_count += 1;
                totals.copied_bytes += bytes;
                entries.push(package_entry(
                    *relative,
                    "file",
                    "copied",
                    bytes,
                    1,
                    0,
                    Some(sha256),
                    None,
                ));
            }
            Err(error) => {
                warnings.push(format!("file extract skipped {}: {}", relative, error));
                entries.push(package_entry(
                    *relative,
                    "file",
                    "error",
                    0,
                    0,
                    0,
                    None,
                    Some(error),
                ));
            }
        }
    }

    match write_inherited_config_from_source(&source_home, &package_home) {
        Ok(Some((bytes, sha256))) => {
            totals.file_count += 1;
            totals.copied_bytes += bytes;
            entries.push(package_entry(
                CONFIG_FILE,
                "file",
                "copied",
                bytes,
                1,
                0,
                Some(sha256),
                None,
            ));
        }
        Ok(None) => {
            skipped.push(CONFIG_FILE.to_string());
            entries.push(package_entry(
                CONFIG_FILE,
                "file",
                "missing",
                0,
                0,
                0,
                None,
                None,
            ));
        }
        Err(error) => {
            warnings.push(format!("safe config extract skipped: {}", error));
            entries.push(package_entry(
                CONFIG_FILE,
                "file",
                "error",
                0,
                0,
                0,
                None,
                Some(error),
            ));
        }
    }

    let now = Utc::now().timestamp_millis();
    let created_at = sync_source_modified_at(source_home)
        .ok()
        .flatten()
        .map(|source_modified_at| source_modified_at.max(now))
        .unwrap_or(now);

    let resources = resource_summaries_from_entries(&entries, &package_home);
    let manifest = CodexSyncPackageManifest {
        version: 1,
        created_at,
        source: source_home.to_string_lossy().to_string(),
        package_path: package_home.to_string_lossy().to_string(),
        manifest_path: manifest_path.to_string_lossy().to_string(),
        file_count: totals.file_count,
        directory_count: totals.directory_count,
        copied_bytes: totals.copied_bytes,
        entries,
        resources,
        skipped,
        warnings,
    };
    let content = serde_json::to_string_pretty(&manifest)
        .map_err(|error| format!("serialize Codex sync package manifest failed: {}", error))?;
    modules::atomic_write::write_string_atomic(&manifest_path, &content)
        .map_err(|error| format!("write Codex sync package manifest failed: {}", error))?;
    status_from_manifest(&manifest, Some(source_home))
}

pub fn apply_sync_package_to_home(
    target_home: &Path,
) -> Result<CodexSyncPackageApplyResult, String> {
    apply_sync_package_to_home_from(&package_root_dir()?, target_home)
}

fn apply_sync_package_to_home_from(
    package_root: &Path,
    target_home: &Path,
) -> Result<CodexSyncPackageApplyResult, String> {
    apply_sync_package_to_home_from_source(package_root, target_home, None)
}

fn apply_sync_package_to_home_from_source(
    package_root: &Path,
    target_home: &Path,
    current_source_override: Option<&Path>,
) -> Result<CodexSyncPackageApplyResult, String> {
    let package = require_existing_sync_package_for_source(package_root, current_source_override)?;
    let package_home = package_codex_home_dir_for(package_root);
    let manifest_package_home = PathBuf::from(&package.package_path);
    if !paths_equal_or_same(&manifest_package_home, &package_home) {
        return Err(format!(
            "Codex sync package manifest path mismatch: manifest points to {}, expected {}",
            manifest_package_home.display(),
            package_home.display()
        ));
    }
    let mut result = apply_sync_package_from(&package_home, target_home)?;
    if package.stale {
        result.warnings.insert(
            0,
            "Codex sync package was applied from the last extracted package, but the main Codex home has newer local changes. Click `提取/刷新本体` when you want clones to receive those newer changes."
                .to_string(),
        );
    }
    if let Err(error) = write_applied_sync_package_marker(target_home, &package, &result) {
        result.warnings.push(format!(
            "package apply marker could not be written: {}",
            error
        ));
    }
    Ok(result)
}

fn apply_sync_package_from(
    package_home: &Path,
    target_home: &Path,
) -> Result<CodexSyncPackageApplyResult, String> {
    if !package_home.exists() {
        return Err(format!(
            "Codex sync package home missing: {}",
            package_home.display()
        ));
    }

    fs::create_dir_all(target_home)
        .map_err(|error| format!("create target Codex home failed: {}", error))?;

    let mut totals = CopyStats::default();
    let mut skipped = Vec::new();
    let mut warnings = Vec::new();

    for relative in LEGACY_CREDENTIAL_FILES {
        let target = target_home.join(relative);
        match fs::remove_file(&target) {
            Ok(()) => skipped.push(format!(
                "{} (removed stale inherited credentials)",
                relative
            )),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => warnings.push(format!(
                "package apply could not remove stale inherited credentials {}: {}",
                relative, error
            )),
        }
    }

    for relative in REPLACE_DIRECTORIES {
        let source = package_home.join(relative);
        if !source.exists() {
            skipped.push((*relative).to_string());
            continue;
        }
        let target = target_home.join(relative);
        match copy_directory_replace(&source, &target) {
            Ok(stats) => totals.add(stats),
            Err(error) => warnings.push(format!("package apply skipped {}: {}", relative, error)),
        }
    }

    for relative in MERGE_DIRECTORIES {
        let source = package_home.join(relative);
        if !source.exists() {
            skipped.push((*relative).to_string());
            continue;
        }
        let target = target_home.join(relative);
        match copy_directory_merge(&source, &target) {
            Ok(stats) => totals.add(stats),
            Err(error) => warnings.push(format!("package apply skipped {}: {}", relative, error)),
        }
    }

    for relative in COPY_FILES {
        let source = package_home.join(relative);
        if !source.exists() {
            skipped.push((*relative).to_string());
            continue;
        }
        let target = target_home.join(relative);
        if target.exists() && PRESERVE_TARGET_FILES_IF_EXISTS.contains(relative) {
            if is_probable_sqlite_database_file(&target) {
                match sqlite_integrity_check(&target) {
                    Ok(()) => {
                        skipped.push(format!("{} (preserved existing clone state)", relative));
                        continue;
                    }
                    Err(error) => {
                        match quarantine_existing_sqlite(&target) {
                            Ok(quarantine_path) => warnings.push(format!(
                                "target sqlite {} was unreadable and replaced from sync package; corrupt copy moved to {}: {}",
                                relative,
                                quarantine_path.display(),
                                error
                            )),
                            Err(quarantine_error) => {
                                warnings.push(format!(
                                    "package apply skipped {}: target sqlite is unreadable and could not be quarantined: {}; original error: {}",
                                    relative, quarantine_error, error
                                ));
                                continue;
                            }
                        }
                    }
                }
            } else {
                skipped.push(format!("{} (preserved existing clone state)", relative));
                continue;
            }
        }
        if is_probable_sqlite_database_file(&target) {
            if let Err(error) = remove_sqlite_sidecars(&target) {
                warnings.push(format!(
                    "package apply sqlite sidecar cleanup skipped {}: {}",
                    relative, error
                ));
            }
        }
        match copy_file_replace(&source, &target) {
            Ok((bytes, _)) => {
                totals.file_count += 1;
                totals.copied_bytes += bytes;
            }
            Err(error) => warnings.push(format!("package apply skipped {}: {}", relative, error)),
        }
    }

    if package_home.join(CONFIG_FILE).exists() {
        match merge_inherited_config_from_package(&package_home, target_home) {
            Ok(bytes) => {
                totals.file_count += 1;
                totals.copied_bytes += bytes;
            }
            Err(error) => warnings.push(format!("package apply skipped config.toml: {}", error)),
        }
    }

    Ok(CodexSyncPackageApplyResult {
        ok: warnings.is_empty(),
        package_path: package_home.to_string_lossy().to_string(),
        target: target_home.to_string_lossy().to_string(),
        file_count: totals.file_count,
        directory_count: totals.directory_count,
        copied_bytes: totals.copied_bytes,
        skipped,
        warnings,
    })
}

fn package_entry(
    path: &str,
    kind: &str,
    status: &str,
    bytes: u64,
    file_count: u64,
    directory_count: u64,
    sha256: Option<String>,
    error: Option<String>,
) -> CodexSyncPackageEntry {
    CodexSyncPackageEntry {
        path: path.to_string(),
        kind: kind.to_string(),
        status: status.to_string(),
        bytes,
        file_count,
        directory_count,
        sha256,
        error,
    }
}

fn applied_marker_path(codex_home: &Path) -> PathBuf {
    codex_home.join(APPLIED_MARKER_FILE_NAME)
}

fn write_applied_sync_package_marker(
    target_home: &Path,
    package: &CodexSyncPackageStatus,
    apply_result: &CodexSyncPackageApplyResult,
) -> Result<(), String> {
    let marker = CodexSyncPackageAppliedMarker {
        version: 1,
        applied_at: Utc::now().timestamp_millis(),
        package_path: package.package_path.clone(),
        manifest_path: package.manifest_path.clone(),
        package_created_at: package.created_at,
        source: package.source.clone(),
        stale_when_applied: package.stale,
        file_count: apply_result.file_count,
        directory_count: apply_result.directory_count,
        copied_bytes: apply_result.copied_bytes,
        resources: package.resources.clone(),
        warnings: apply_result.warnings.clone(),
    };
    let content = serde_json::to_string_pretty(&marker)
        .map_err(|error| format!("serialize applied sync package marker failed: {}", error))?;
    modules::atomic_write::write_string_atomic(&applied_marker_path(target_home), &content)
        .map_err(|error| format!("write applied sync package marker failed: {}", error))
}

pub fn read_applied_sync_package_marker(
    codex_home: &Path,
) -> Result<Option<CodexSyncPackageAppliedMarker>, String> {
    let path = applied_marker_path(codex_home);
    if !path.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(&path).map_err(|error| {
        format!(
            "read applied sync package marker failed ({}): {}",
            path.display(),
            error
        )
    })?;
    serde_json::from_str::<CodexSyncPackageAppliedMarker>(&content)
        .map(Some)
        .map_err(|error| {
            format!(
                "parse applied sync package marker failed ({}): {}",
                path.display(),
                error
            )
        })
}

fn resource_summaries_from_entries(
    entries: &[CodexSyncPackageEntry],
    package_home: &Path,
) -> Vec<CodexSyncPackageResourceSummary> {
    RESOURCE_SPECS
        .iter()
        .map(|spec| {
            let mut file_count = 0_u64;
            let mut directory_count = 0_u64;
            let mut bytes = 0_u64;
            let mut paths = Vec::new();
            let mut missing = Vec::new();
            let mut errors = Vec::new();
            let mut matched_paths = Vec::new();

            for entry in entries.iter().filter(|entry| {
                spec.paths
                    .iter()
                    .any(|path| entry_matches_path(entry, path))
            }) {
                matched_paths.push(entry.path.clone());
                match entry.status.as_str() {
                    "copied" => {
                        paths.push(entry.path.clone());
                        bytes += entry.bytes;
                        file_count += if entry.file_count > 0 {
                            entry.file_count
                        } else if entry.kind == "file" {
                            1
                        } else {
                            0
                        };
                        directory_count += if entry.directory_count > 0 {
                            entry.directory_count
                        } else if entry.kind == "directory" {
                            1
                        } else {
                            0
                        };
                    }
                    "missing" => missing.push(entry.path.clone()),
                    "error" => errors.push(match &entry.error {
                        Some(error) => format!("{}: {}", entry.path, error),
                        None => entry.path.clone(),
                    }),
                    other => errors.push(format!("{}: unexpected status {}", entry.path, other)),
                }
            }

            for path in spec.paths {
                if !matched_paths
                    .iter()
                    .any(|matched| matched == path || matched.starts_with(&format!("{}/", path)))
                {
                    missing.push((*path).to_string());
                }
            }

            let status = if !errors.is_empty() && paths.is_empty() {
                "error"
            } else if !errors.is_empty() {
                "partial"
            } else if paths.is_empty() {
                "missing"
            } else {
                "ready"
            };

            CodexSyncPackageResourceSummary {
                id: spec.id.to_string(),
                label: spec.label.to_string(),
                status: status.to_string(),
                apply_mode: spec.apply_mode.to_string(),
                file_count,
                directory_count,
                bytes,
                paths,
                missing,
                errors,
                items: resource_inventory_items(package_home, spec.id),
                detail: spec.detail.to_string(),
            }
        })
        .collect()
}

fn entry_matches_path(entry: &CodexSyncPackageEntry, path: &str) -> bool {
    entry.path == path || entry.path.starts_with(&format!("{}/", path))
}

fn resource_inventory_items(package_home: &Path, resource_id: &str) -> Vec<String> {
    let mut items = match resource_id {
        "history" => history_inventory_items(package_home),
        "skills" => named_directory_items(package_home, &["skills", "rules"])
            .into_iter()
            .chain(file_presence_items(package_home, &["AGENTS.md"]))
            .collect(),
        "mcp" => named_directory_items(package_home, &["mcp-servers"])
            .into_iter()
            .chain(config_mcp_server_items(&package_home.join(CONFIG_FILE)))
            .collect(),
        "memory" => named_directory_items(package_home, &["memories", "vendor_imports"])
            .into_iter()
            .chain(file_presence_items(
                package_home,
                &["memories", "sqlite", "vendor_imports"],
            ))
            .collect(),
        "goals" => file_presence_items(package_home, &["goals_1.sqlite"]),
        "config" => config_inventory_items(&package_home.join(CONFIG_FILE)),
        _ => Vec::new(),
    };
    items.sort();
    items.dedup();
    items.truncate(12);
    items
}

fn history_inventory_items(package_home: &Path) -> Vec<String> {
    let mut items = Vec::new();
    for (label, relative) in [
        ("sessions", "sessions"),
        ("archived", "archived_sessions"),
        ("index", "session_index.jsonl"),
        ("history", "history.jsonl"),
        ("state-db", "state_5.sqlite"),
    ] {
        if package_home.join(relative).exists() {
            items.push(label.to_string());
        }
    }
    items
}

fn named_directory_items(package_home: &Path, relatives: &[&str]) -> Vec<String> {
    let mut items = Vec::new();
    for relative in relatives {
        let dir = package_home.join(relative);
        if !dir.is_dir() {
            continue;
        }
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            if let Some(name) = path.file_name().and_then(|name| name.to_str()) {
                items.push(format!("{}/{}", relative, name));
            }
        }
    }
    items
}

fn file_presence_items(package_home: &Path, relatives: &[&str]) -> Vec<String> {
    relatives
        .iter()
        .filter(|relative| package_home.join(relative).exists())
        .map(|relative| (*relative).to_string())
        .collect()
}

fn config_inventory_items(config_path: &Path) -> Vec<String> {
    let Ok(content) = fs::read_to_string(config_path) else {
        return Vec::new();
    };
    let Ok(doc) = content.parse::<Document>() else {
        return vec!["config.toml".to_string()];
    };
    let mut items = Vec::new();
    for (key, item) in doc.iter() {
        if item.is_none() {
            continue;
        }
        if key == "mcp_servers" {
            if let Some(table) = item.as_table() {
                for (server_id, _) in table.iter() {
                    items.push(format!("mcp:{}", server_id));
                }
            }
        } else {
            items.push(key.to_string());
        }
    }
    if items.is_empty() {
        items.push("config.toml".to_string());
    }
    items
}

fn config_mcp_server_items(config_path: &Path) -> Vec<String> {
    config_inventory_items(config_path)
        .into_iter()
        .filter(|item| item.starts_with("mcp:"))
        .collect()
}

fn backup_existing_sync_package(
    package_root: &Path,
    package_home: &Path,
    manifest_path: &Path,
) -> Result<Option<PathBuf>, String> {
    if !package_home.exists() && !manifest_path.exists() {
        return Ok(None);
    }

    let backup_root = package_backup_root_dir_for(package_root);
    fs::create_dir_all(&backup_root).map_err(|error| {
        format!(
            "create Codex sync package backup root failed ({}): {}",
            backup_root.display(),
            error
        )
    })?;
    let backup_path = backup_root.join(format!("sync-package-{}", Utc::now().timestamp_millis()));
    fs::create_dir_all(&backup_path).map_err(|error| {
        format!(
            "create Codex sync package backup failed ({}): {}",
            backup_path.display(),
            error
        )
    })?;

    if package_home.exists() {
        copy_directory_replace(package_home, &backup_path.join(PACKAGE_CODEX_HOME_DIR_NAME))
            .map_err(|error| {
                format!("backup existing Codex sync package home failed: {}", error)
            })?;
    }
    if manifest_path.exists() {
        copy_file_replace(manifest_path, &backup_path.join(MANIFEST_FILE_NAME)).map_err(
            |error| {
                format!(
                    "backup existing Codex sync package manifest failed: {}",
                    error
                )
            },
        )?;
    }

    Ok(Some(backup_path))
}

fn sha256_file(path: &Path) -> Result<(u64, String), String> {
    let mut file = fs::File::open(path).map_err(|error| {
        format!(
            "open file for sha256 failed ({}): {}",
            path.display(),
            error
        )
    })?;
    let mut hasher = Sha256::new();
    let mut total = 0_u64;
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer).map_err(|error| {
            format!(
                "read file for sha256 failed ({}): {}",
                path.display(),
                error
            )
        })?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
        total += read as u64;
    }
    Ok((total, format!("{:x}", hasher.finalize())))
}

fn copy_file_replace(source: &Path, target: &Path) -> Result<(u64, String), String> {
    let _ = regular_source_file_metadata(source, "copy file")?;
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "create target parent failed ({}): {}",
                parent.display(),
                error
            )
        })?;
    }
    remove_existing_path(target)?;
    fs::copy(source, target).map_err(|error| {
        format!(
            "copy file failed ({} -> {}): {}",
            source.display(),
            target.display(),
            error
        )
    })?;
    sha256_file(target)
}

fn regular_source_file_metadata(source: &Path, operation: &str) -> Result<fs::Metadata, String> {
    let metadata = fs::symlink_metadata(source).map_err(|error| {
        format!(
            "{} source metadata failed ({}): {}",
            operation,
            source.display(),
            error
        )
    })?;
    if is_linked_path(source, &metadata) {
        return Err(format!(
            "refuse to {} from linked source path ({})",
            operation,
            source.display()
        ));
    }
    if !metadata.is_file() {
        return Err(format!(
            "refuse to {} from non-file source path ({})",
            operation,
            source.display()
        ));
    }
    Ok(metadata)
}

fn copy_sqlite_snapshot_replace(source: &Path, target: &Path) -> Result<(u64, String), String> {
    let _ = regular_source_file_metadata(source, "copy sqlite snapshot")?;
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "create sqlite snapshot parent failed ({}): {}",
                parent.display(),
                error
            )
        })?;
    }
    remove_existing_path(target)?;
    remove_sqlite_sidecars(target)?;

    let source_conn = Connection::open_with_flags(
        source,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|error| {
        format!(
            "open sqlite source for snapshot failed ({}): {}",
            source.display(),
            error
        )
    })?;
    source_conn
        .backup(DatabaseName::Main, target, None)
        .map_err(|error| {
            format!(
                "sqlite online backup failed ({} -> {}): {}",
                source.display(),
                target.display(),
                error
            )
        })?;

    let target_conn = Connection::open(target).map_err(|error| {
        format!(
            "open sqlite snapshot target failed ({}): {}",
            target.display(),
            error
        )
    })?;
    let _ = target_conn.pragma_update(None, "journal_mode", "DELETE");
    let _ = target_conn.pragma_update(None, "wal_checkpoint", "TRUNCATE");
    drop(target_conn);
    remove_sqlite_sidecars(target)?;
    sqlite_integrity_check(target)?;
    sha256_file(target)
}

fn copy_directory_replace(source: &Path, target: &Path) -> Result<CopyStats, String> {
    remove_existing_path(target)?;
    copy_directory_merge(source, target)
}

fn copy_directory_merge(source: &Path, target: &Path) -> Result<CopyStats, String> {
    prepare_merge_target_directory(target)?;
    let mut stats = CopyStats {
        directory_count: 1,
        ..CopyStats::default()
    };

    for entry in fs::read_dir(source).map_err(|error| {
        format!(
            "read source directory failed ({}): {}",
            source.display(),
            error
        )
    })? {
        let entry = entry.map_err(|error| format!("read source entry failed: {}", error))?;
        let source_path = entry.path();
        let target_path = target.join(entry.file_name());
        let metadata = fs::symlink_metadata(&source_path).map_err(|error| {
            format!(
                "read source metadata failed ({}): {}",
                source_path.display(),
                error
            )
        })?;
        if is_linked_path(&source_path, &metadata) {
            return Err(format!(
                "refuse to copy linked source path ({})",
                source_path.display()
            ));
        }
        if metadata.is_file() && is_sensitive_sync_package_file(&source_path) {
            continue;
        }
        if metadata.is_dir() {
            stats.add(copy_directory_merge(&source_path, &target_path)?);
        } else if metadata.is_file() && is_sqlite_sidecar_file(&source_path) {
            continue;
        } else if metadata.is_file() {
            let (bytes, _) = if is_probable_sqlite_database_file(&source_path) {
                copy_sqlite_snapshot_replace(&source_path, &target_path)?
            } else {
                copy_file_replace(&source_path, &target_path)?
            };
            stats.file_count += 1;
            stats.copied_bytes += bytes;
        }
    }

    Ok(stats)
}

fn prepare_merge_target_directory(target: &Path) -> Result<(), String> {
    if let Ok(metadata) = fs::symlink_metadata(target) {
        if is_linked_path(target, &metadata) {
            remove_existing_path(target)?;
        }
    }
    fs::create_dir_all(target).map_err(|error| {
        format!(
            "create target directory failed ({}): {}",
            target.display(),
            error
        )
    })
}

fn remove_existing_path(path: &Path) -> Result<(), String> {
    let Ok(metadata) = fs::symlink_metadata(path) else {
        return Ok(());
    };
    let file_type = metadata.file_type();
    if file_type.is_symlink() || is_windows_reparse_dir(path, &metadata) {
        let points_to_dir = fs::metadata(path)
            .map(|target_metadata| target_metadata.is_dir())
            .unwrap_or_else(|_| metadata.is_dir());
        if points_to_dir {
            return fs::remove_dir(path).map_err(|error| {
                format!(
                    "remove existing linked directory failed ({}): {}",
                    path.display(),
                    error
                )
            });
        }
        return fs::remove_file(path).map_err(|error| {
            format!(
                "remove existing linked file failed ({}): {}",
                path.display(),
                error
            )
        });
    }
    if metadata.is_dir() {
        fs::remove_dir_all(path).map_err(|error| {
            format!(
                "remove existing directory failed ({}): {}",
                path.display(),
                error
            )
        })
    } else {
        fs::remove_file(path).map_err(|error| {
            format!(
                "remove existing file failed ({}): {}",
                path.display(),
                error
            )
        })
    }
}

#[cfg(windows)]
fn is_windows_reparse_dir(_path: &Path, metadata: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;

    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
    metadata.is_dir() && metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
}

#[cfg(not(windows))]
fn is_windows_reparse_dir(_path: &Path, _metadata: &fs::Metadata) -> bool {
    false
}

fn is_linked_path(path: &Path, metadata: &fs::Metadata) -> bool {
    metadata.file_type().is_symlink() || is_windows_reparse_dir(path, metadata)
}

fn is_sensitive_sync_package_file(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
        return false;
    };
    let name = name.to_ascii_lowercase();
    name == ".env"
        || name.starts_with(".env.")
        || name.ends_with(".pem")
        || name.ends_with(".key")
        || name.ends_with(".p12")
        || name.ends_with(".pfx")
        || name.contains("api_key")
        || name.contains("apikey")
        || name.contains("credential")
        || name.contains("password")
        || name.contains("private_key")
        || name.contains("secret")
        || name.contains("token")
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

fn is_probable_sqlite_database_file(path: &Path) -> bool {
    matches!(
        path.extension().and_then(|value| value.to_str()),
        Some("sqlite" | "sqlite3" | "db")
    )
}

fn sqlite_sidecar_paths(path: &Path) -> Vec<PathBuf> {
    vec![
        PathBuf::from(format!("{}-wal", path.to_string_lossy())),
        PathBuf::from(format!("{}-shm", path.to_string_lossy())),
    ]
}

fn remove_sqlite_sidecars(path: &Path) -> Result<(), String> {
    for sidecar in sqlite_sidecar_paths(path) {
        remove_existing_path(&sidecar)?;
    }
    Ok(())
}

fn sqlite_integrity_check(path: &Path) -> Result<(), String> {
    let conn =
        Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(|error| {
            format!(
                "open sqlite for integrity check failed ({}): {}",
                path.display(),
                error
            )
        })?;
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

fn quarantine_existing_sqlite(path: &Path) -> Result<PathBuf, String> {
    let timestamp = Utc::now().format("%Y%m%d-%H%M%S").to_string();
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| format!("invalid sqlite filename: {}", path.display()))?;
    let quarantine_path = path.with_file_name(format!("{}.corrupt-{}", file_name, timestamp));
    fs::rename(path, &quarantine_path).map_err(|error| {
        format!(
            "move corrupt sqlite failed ({} -> {}): {}",
            path.display(),
            quarantine_path.display(),
            error
        )
    })?;
    for sidecar in sqlite_sidecar_paths(path) {
        if !sidecar.exists() {
            continue;
        }
        let Some(sidecar_name) = sidecar.file_name().and_then(|value| value.to_str()) else {
            remove_existing_path(&sidecar)?;
            continue;
        };
        let target = sidecar.with_file_name(format!("{}.corrupt-{}", sidecar_name, timestamp));
        let _ = fs::rename(&sidecar, target).or_else(|_| remove_existing_path(&sidecar));
    }
    Ok(quarantine_path)
}

fn write_inherited_config_from_source(
    source_home: &Path,
    package_home: &Path,
) -> Result<Option<(u64, String)>, String> {
    let source_config = source_home.join(CONFIG_FILE);
    if !source_config.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(&source_config).map_err(|error| {
        format!(
            "read source config.toml failed ({}): {}",
            source_config.display(),
            error
        )
    })?;
    if content.trim().is_empty() {
        return Ok(None);
    }
    let mut source_doc = content
        .parse::<Document>()
        .map_err(|error| format!("parse source config.toml failed: {}", error))?;
    replace_toml_string_paths(
        source_doc.as_item_mut(),
        &source_home.to_string_lossy(),
        &package_home.to_string_lossy(),
    );

    remove_quota_config_from_doc(&mut source_doc);
    if source_doc.is_empty() {
        return Ok(None);
    }

    let target = package_home.join(CONFIG_FILE);
    let config_content = source_doc.to_string();
    modules::atomic_write::write_string_atomic(&target, &config_content)
        .map_err(|error| format!("write package config.toml failed: {}", error))?;
    sha256_file(&target).map(Some)
}

fn merge_inherited_config_from_package(
    package_home: &Path,
    target_home: &Path,
) -> Result<u64, String> {
    let package_config = package_home.join(CONFIG_FILE);
    let package_content = fs::read_to_string(&package_config).map_err(|error| {
        format!(
            "read package config.toml failed ({}): {}",
            package_config.display(),
            error
        )
    })?;
    let mut package_doc = package_content
        .parse::<Document>()
        .map_err(|error| format!("parse package config.toml failed: {}", error))?;
    replace_toml_string_paths(
        package_doc.as_item_mut(),
        &package_home.to_string_lossy(),
        &target_home.to_string_lossy(),
    );

    let target_config = target_home.join(CONFIG_FILE);
    let target_content = fs::read_to_string(&target_config).unwrap_or_default();
    let mut target_doc = if target_content.trim().is_empty() {
        Document::new()
    } else {
        target_content
            .parse::<Document>()
            .map_err(|error| format!("parse target config.toml failed: {}", error))?
    };

    remove_quota_config_from_doc(&mut package_doc);
    merge_toml_item(target_doc.as_item_mut(), package_doc.as_item());

    let content = target_doc.to_string();
    modules::atomic_write::write_string_atomic(&target_config, &content)
        .map_err(|error| format!("write target config.toml failed: {}", error))?;
    fs::metadata(&target_config)
        .map(|metadata| metadata.len())
        .map_err(|error| format!("read target config.toml metadata failed: {}", error))
}

fn remove_quota_config_from_doc(doc: &mut Document) {
    for key in QUOTA_CONFIG_KEYS {
        let _ = doc.remove(key);
    }
    sanitize_inherited_config_doc(doc);
}

fn sanitize_inherited_config_doc(doc: &mut Document) {
    sanitize_secret_config_item(doc.as_item_mut());
    if let Some(mcp_servers) = doc.get_mut("mcp_servers") {
        sanitize_mcp_servers_item(mcp_servers);
    }
    let remove_mcp_servers = doc
        .get("mcp_servers")
        .is_some_and(|item| toml_item_is_empty_table(item));
    if remove_mcp_servers {
        let _ = doc.remove("mcp_servers");
    }
}

fn sanitize_secret_config_item(item: &mut toml_edit::Item) {
    if let Some(table) = item.as_table_mut() {
        let keys = table
            .iter()
            .map(|(key, _)| key.to_string())
            .collect::<Vec<_>>();
        for key in keys {
            if key == "mcp_servers" {
                continue;
            }
            if is_secret_config_key(&key) {
                let _ = table.remove(&key);
                continue;
            }
            if let Some(child) = table.get_mut(&key) {
                sanitize_secret_config_item(child);
            }
            let remove_child = table
                .get(&key)
                .is_some_and(|child| toml_item_is_empty_table(child));
            if remove_child {
                let _ = table.remove(&key);
            }
        }
        return;
    }

    if let Some(array_of_tables) = item.as_array_of_tables_mut() {
        for table in array_of_tables.iter_mut() {
            let mut table_item = toml_edit::Item::Table(table.clone());
            sanitize_secret_config_item(&mut table_item);
            if let toml_edit::Item::Table(sanitized) = table_item {
                *table = sanitized;
            }
        }
    }
}

fn sanitize_mcp_servers_item(item: &mut toml_edit::Item) {
    let Some(table) = item.as_table_mut() else {
        return;
    };

    let server_names = table
        .iter()
        .map(|(key, _)| key.to_string())
        .collect::<Vec<_>>();
    for server_name in server_names {
        if let Some(server) = table.get_mut(&server_name) {
            sanitize_mcp_server_item(server);
        }
        let remove_server = table
            .get(&server_name)
            .is_some_and(|server| toml_item_is_empty_table(server));
        if remove_server {
            let _ = table.remove(&server_name);
        }
    }
}

fn sanitize_mcp_server_item(item: &mut toml_edit::Item) {
    let Some(table) = item.as_table_mut() else {
        return;
    };

    let keys = table
        .iter()
        .map(|(key, _)| key.to_string())
        .collect::<Vec<_>>();
    for key in keys {
        if is_secret_config_key(&key) {
            let _ = table.remove(&key);
            continue;
        }
        match key.as_str() {
            "args" => {
                if let Some(args) = table.get_mut(&key) {
                    sanitize_mcp_args_item(args);
                }
            }
            "env" => {
                if let Some(env) = table.get_mut(&key) {
                    sanitize_env_item(env);
                }
                let remove_env = table
                    .get(&key)
                    .is_some_and(|env| toml_item_is_empty_table(env));
                if remove_env {
                    let _ = table.remove(&key);
                }
            }
            _ => {
                if let Some(child) = table.get_mut(&key) {
                    sanitize_mcp_server_item(child);
                }
                let remove_child = table
                    .get(&key)
                    .is_some_and(|child| toml_item_is_empty_table(child));
                if remove_child {
                    let _ = table.remove(&key);
                }
            }
        }
    }
}

fn sanitize_env_item(item: &mut toml_edit::Item) {
    let Some(table) = item.as_table_mut() else {
        return;
    };
    let keys = table
        .iter()
        .map(|(key, _)| key.to_string())
        .collect::<Vec<_>>();
    for key in keys {
        if is_secret_config_key(&key) {
            let _ = table.remove(&key);
        }
    }
}

fn sanitize_mcp_args_item(item: &mut toml_edit::Item) {
    let Some(array) = item.as_array() else {
        return;
    };
    let Some(args) = array
        .iter()
        .map(|value| value.as_str().map(str::to_string))
        .collect::<Option<Vec<_>>>()
    else {
        return;
    };

    let mut sanitized = Vec::with_capacity(args.len());
    let mut skip_next = false;
    let mut changed = false;
    for arg in args {
        if skip_next {
            skip_next = false;
            changed = true;
            continue;
        }
        if let Some((key, _)) = arg.split_once('=') {
            if is_secret_arg_key(key) {
                changed = true;
                continue;
            }
        }
        if is_secret_arg_key(&arg) {
            skip_next = true;
            changed = true;
            continue;
        }
        sanitized.push(arg);
    }

    if !changed {
        return;
    }
    let mut replacement = toml_edit::Array::default();
    for arg in sanitized {
        replacement.push(arg);
    }
    *item = toml_edit::value(replacement);
}

fn toml_item_is_empty_table(item: &toml_edit::Item) -> bool {
    item.as_table().is_some_and(|table| table.is_empty())
}

fn normalize_secret_key(value: &str) -> String {
    value
        .trim_start_matches('-')
        .to_ascii_lowercase()
        .replace('-', "_")
}

fn is_secret_config_key(key: &str) -> bool {
    let normalized = normalize_secret_key(key);
    SECRET_CONFIG_KEY_FRAGMENTS
        .iter()
        .any(|fragment| normalized == *fragment || normalized.ends_with(&format!("_{}", fragment)))
}

fn is_secret_arg_key(key: &str) -> bool {
    let normalized = key.trim_start_matches('-').to_ascii_lowercase();
    SECRET_ARG_FRAGMENTS.iter().any(|fragment| {
        normalized == *fragment
            || normalized.ends_with(&format!("-{}", fragment))
            || normalized.ends_with(&format!("_{}", fragment))
    })
}

fn merge_toml_item(target: &mut toml_edit::Item, source: &toml_edit::Item) {
    match (target, source) {
        (toml_edit::Item::Table(target_table), toml_edit::Item::Table(source_table)) => {
            for (key, source_child) in source_table.iter() {
                if QUOTA_CONFIG_KEYS.contains(&key) {
                    continue;
                }
                if target_table.contains_key(key) {
                    merge_toml_item(&mut target_table[key], source_child);
                } else {
                    target_table[key] = source_child.clone();
                }
            }
        }
        (target_item, source_item) => {
            *target_item = source_item.clone();
        }
    }
}

fn replace_toml_string_paths(item: &mut toml_edit::Item, source: &str, target: &str) {
    match item {
        toml_edit::Item::Value(value) => {
            if let Some(text) = value.as_str() {
                if text.contains(source) {
                    *item = toml_edit::value(text.replace(source, target));
                }
            }
        }
        toml_edit::Item::Table(table) => {
            for (_, child) in table.iter_mut() {
                replace_toml_string_paths(child, source, target);
            }
        }
        toml_edit::Item::ArrayOfTables(array) => {
            for table in array.iter_mut() {
                for (_, child) in table.iter_mut() {
                    replace_toml_string_paths(child, source, target);
                }
            }
        }
        toml_edit::Item::None => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, SystemTime, UNIX_EPOCH};

    fn make_temp_dir(prefix: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after unix epoch")
            .as_nanos();
        let dir =
            std::env::temp_dir().join(format!("{}-{}-{}", prefix, std::process::id(), unique));
        if dir.exists() {
            fs::remove_dir_all(&dir).expect("cleanup old temp dir");
        }
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    fn with_temp_paths<F>(prefix: &str, test: F)
    where
        F: FnOnce(&Path, &Path, &Path),
    {
        let temp = make_temp_dir(prefix);
        let package_root = temp.join("launcher-data").join(PACKAGE_DIR_NAME);
        let source_home = temp.join(".codex");
        let target_home = temp.join("clone");
        fs::create_dir_all(&package_root).expect("create package root");
        fs::create_dir_all(&source_home).expect("create source home");
        fs::create_dir_all(&target_home).expect("create target home");

        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            test(&source_home, &target_home, &package_root);
        }));

        fs::remove_dir_all(&temp).expect("cleanup temp dir");
        if let Err(payload) = result {
            std::panic::resume_unwind(payload);
        }
    }

    fn create_history_db(path: &Path, id: &str) {
        let conn = Connection::open(path).expect("open test sqlite");
        conn.execute_batch(
            r#"
            CREATE TABLE threads (
                id TEXT PRIMARY KEY,
                title TEXT,
                model_provider TEXT,
                model TEXT,
                rollout_path TEXT
            );
            "#,
        )
        .expect("create threads table");
        conn.execute(
            "INSERT INTO threads (id, title, model_provider, model, rollout_path) VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![id, "Thread", "openai", "gpt-4.1", ""],
        )
        .expect("insert thread");
    }

    #[test]
    fn package_apply_requires_existing_manual_extract() {
        with_temp_paths(
            "codex-sync-package-manual-extract-test",
            |source_home, _target_home, package_root| {
                fs::write(source_home.join("history.jsonl"), "{\"history\":true}\n")
                    .expect("write source history");

                let result = require_existing_sync_package_for(package_root);

                assert!(result.is_err());
                assert!(result
                    .unwrap_err()
                    .contains("Codex sync package is missing"));
                assert!(!package_codex_home_dir_for(package_root).exists());
            },
        );
    }

    #[test]
    fn package_status_marks_stale_when_source_changes_after_extract() {
        with_temp_paths(
            "codex-sync-package-stale-test",
            |source_home, _target_home, package_root| {
                fs::write(
                    source_home.join("session_index.jsonl"),
                    "{\"id\":\"one\"}\n",
                )
                .expect("write source index");

                let status =
                    extract_sync_package_from(source_home, package_root).expect("extract package");
                assert!(status.exists);
                assert!(!status.stale);

                fs::write(
                    source_home.join("session_index.jsonl"),
                    "{\"id\":\"one\"}\n{\"id\":\"two\"}\n",
                )
                .expect("update source index");

                let mut manifest: CodexSyncPackageManifest = serde_json::from_str(
                    &fs::read_to_string(manifest_path_for(package_root))
                        .expect("read package manifest"),
                )
                .expect("parse package manifest");
                let source_modified_at = sync_source_modified_at(source_home)
                    .expect("read source mtime")
                    .unwrap();
                manifest.created_at = source_modified_at - FRESHNESS_MTIME_GRACE_MS - 1;
                let status = status_from_manifest(&manifest, Some(source_home))
                    .expect("read package status");

                assert!(status.stale);
                assert!(status.source_modified_at.unwrap() > status.created_at.unwrap());
                assert!(status
                    .warnings
                    .iter()
                    .any(|item| item.contains("local Codex home changed")));
            },
        );
    }

    #[test]
    fn package_status_ignores_volatile_runtime_writes_after_extract() {
        with_temp_paths(
            "codex-sync-package-volatile-freshness-test",
            |source_home, _target_home, package_root| {
                fs::write(
                    source_home.join("session_index.jsonl"),
                    "{\"id\":\"one\"}\n",
                )
                .expect("write source index");
                fs::write(source_home.join("config.toml"), "model = \"gpt-5\"\n")
                    .expect("write source config");
                create_history_db(&source_home.join("state_5.sqlite"), "source");
                fs::create_dir_all(source_home.join("sqlite")).expect("create sqlite dir");
                fs::write(source_home.join("sqlite").join("runtime.db"), "runtime")
                    .expect("write sqlite runtime file");

                let status =
                    extract_sync_package_from(source_home, package_root).expect("extract package");
                assert!(status.exists);
                assert!(!status.stale);

                std::thread::sleep(Duration::from_millis(20));
                fs::write(source_home.join("config.toml"), "model = \"gpt-5.1\"\n")
                    .expect("update source config");
                fs::remove_file(source_home.join("state_5.sqlite")).expect("remove old state db");
                create_history_db(&source_home.join("state_5.sqlite"), "source-2");
                fs::write(
                    source_home.join("sqlite").join("runtime.db"),
                    "runtime update",
                )
                .expect("update sqlite runtime file");

                let manifest: CodexSyncPackageManifest = serde_json::from_str(
                    &fs::read_to_string(manifest_path_for(package_root))
                        .expect("read package manifest"),
                )
                .expect("parse package manifest");
                let status = status_from_manifest(&manifest, Some(source_home))
                    .expect("read package status");

                assert!(!status.stale);
                assert!(!status
                    .warnings
                    .iter()
                    .any(|item| item.contains("local Codex home changed")));
            },
        );
    }

    #[test]
    fn package_status_ignores_small_mtime_drift_after_extract() {
        with_temp_paths(
            "codex-sync-package-mtime-drift-test",
            |source_home, _target_home, package_root| {
                fs::write(
                    source_home.join("session_index.jsonl"),
                    "{\"id\":\"one\"}\n",
                )
                .expect("write source index");

                extract_sync_package_from(source_home, package_root).expect("extract package");
                fs::write(
                    source_home.join("session_index.jsonl"),
                    "{\"id\":\"one\"}\n{\"id\":\"two\"}\n",
                )
                .expect("update source index");

                let mut manifest: CodexSyncPackageManifest = serde_json::from_str(
                    &fs::read_to_string(manifest_path_for(package_root))
                        .expect("read package manifest"),
                )
                .expect("parse package manifest");
                let source_modified_at = sync_source_modified_at(source_home)
                    .expect("read source mtime")
                    .unwrap();
                manifest.created_at = source_modified_at - (FRESHNESS_MTIME_GRACE_MS / 2);
                let status = status_from_manifest(&manifest, Some(source_home))
                    .expect("read package status");

                assert!(!status.stale);
            },
        );
    }

    #[test]
    fn package_excludes_runtime_cache_and_plugin_state() {
        with_temp_paths(
            "codex-sync-package-runtime-exclusion-test",
            |source_home, _target_home, package_root| {
                for relative in [
                    ".tmp",
                    "ambient-suggestions",
                    "automations",
                    "browser",
                    "cache",
                    "history_sync_backups",
                    "log",
                    "pets",
                    "plugins",
                ] {
                    let dir = source_home.join(relative);
                    fs::create_dir_all(&dir).expect("create runtime dir");
                    fs::write(dir.join("runtime.txt"), "runtime").expect("write runtime file");
                }
                for relative in [
                    ".codex-global-state.json",
                    ".personality_migration",
                    "installation_id",
                    "logs_2.sqlite",
                    "models_cache.json",
                    "sandbox.log",
                    "version.json",
                ] {
                    fs::write(source_home.join(relative), "runtime").expect("write runtime file");
                }
                let skill_dir = source_home.join("skills").join("define-goal");
                fs::create_dir_all(&skill_dir).expect("create skill dir");
                fs::write(skill_dir.join("SKILL.md"), "# Define Goal").expect("write skill");

                extract_sync_package_from(source_home, package_root).expect("extract package");
                let package_home = package_codex_home_dir_for(package_root);

                assert!(package_home
                    .join("skills")
                    .join("define-goal")
                    .join("SKILL.md")
                    .exists());
                for relative in [
                    ".tmp",
                    "ambient-suggestions",
                    "automations",
                    "browser",
                    "cache",
                    "history_sync_backups",
                    "log",
                    "pets",
                    "plugins",
                    ".codex-global-state.json",
                    ".personality_migration",
                    "installation_id",
                    "logs_2.sqlite",
                    "models_cache.json",
                    "sandbox.log",
                    "version.json",
                ] {
                    assert!(
                        !package_home.join(relative).exists(),
                        "{} should not be copied into sync package",
                        relative
                    );
                }
            },
        );
    }

    #[test]
    fn package_status_reports_resource_summaries() {
        with_temp_paths(
            "codex-sync-package-resource-summary-test",
            |source_home, _target_home, package_root| {
                let session_dir = source_home.join("sessions").join("2026");
                fs::create_dir_all(&session_dir).expect("create sessions");
                fs::write(
                    session_dir.join("rollout-a.jsonl"),
                    "{\"type\":\"session\"}\n",
                )
                .expect("write session");
                fs::write(source_home.join("session_index.jsonl"), "{\"id\":\"a\"}\n")
                    .expect("write index");

                let skill_dir = source_home.join("skills").join("define-goal");
                fs::create_dir_all(&skill_dir).expect("create skill dir");
                fs::write(skill_dir.join("SKILL.md"), "# Define Goal").expect("write skill");
                fs::write(source_home.join("AGENTS.md"), "Use Simplified Chinese")
                    .expect("write agents");

                let mcp_dir = source_home.join("mcp-servers").join("time");
                fs::create_dir_all(&mcp_dir).expect("create mcp dir");
                fs::write(mcp_dir.join("server.json"), "{}").expect("write mcp");

                let memory_dir = source_home.join("memories");
                fs::create_dir_all(&memory_dir).expect("create memory dir");
                fs::write(memory_dir.join("user.md"), "memory").expect("write memory");
                fs::write(
                    source_home.join(CONFIG_FILE),
                    "[mcp_servers.time]\ncommand = \"time\"\n",
                )
                .expect("write config");

                let status =
                    extract_sync_package_from(source_home, package_root).expect("extract package");
                assert!(status.exists);
                assert_eq!(status.resources.len(), RESOURCE_SPECS.len());

                let history = status
                    .resources
                    .iter()
                    .find(|resource| resource.id == "history")
                    .expect("history summary");
                assert_eq!(history.status, "ready");
                assert!(history.file_count >= 2);
                assert!(history.paths.iter().any(|path| path == "sessions"));

                let skills = status
                    .resources
                    .iter()
                    .find(|resource| resource.id == "skills")
                    .expect("skills summary");
                assert_eq!(skills.status, "ready");
                assert!(skills.file_count >= 2);
                assert!(skills.items.iter().any(|item| item == "skills/define-goal"));
                assert!(skills.items.iter().any(|item| item == "AGENTS.md"));

                let mcp = status
                    .resources
                    .iter()
                    .find(|resource| resource.id == "mcp")
                    .expect("mcp summary");
                assert_eq!(mcp.status, "ready");
                assert!(mcp.bytes > 0);
                assert!(mcp.items.iter().any(|item| item == "mcp-servers/time"));
                assert!(mcp.items.iter().any(|item| item == "mcp:time"));

                let memory = status
                    .resources
                    .iter()
                    .find(|resource| resource.id == "memory")
                    .expect("memory summary");
                assert!(memory.items.iter().any(|item| item == "memories"));

                let config = status
                    .resources
                    .iter()
                    .find(|resource| resource.id == "config")
                    .expect("config summary");
                assert!(config.items.iter().any(|item| item == "mcp:time"));

                let manifest: CodexSyncPackageManifest = serde_json::from_str(
                    &fs::read_to_string(manifest_path_for(package_root))
                        .expect("read package manifest"),
                )
                .expect("parse manifest");
                assert_eq!(manifest.resources.len(), RESOURCE_SPECS.len());
                assert!(manifest
                    .resources
                    .iter()
                    .any(|resource| resource.items.iter().any(|item| item == "mcp:time")));
            },
        );
    }

    #[test]
    fn package_preflight_allows_valid_extracted_package() {
        with_temp_paths(
            "codex-sync-package-preflight-valid-test",
            |source_home, _target_home, package_root| {
                let session_dir = source_home.join("sessions").join("2026");
                fs::create_dir_all(&session_dir).expect("create sessions");
                fs::write(
                    session_dir.join("rollout-a.jsonl"),
                    "{\"type\":\"session\"}\n",
                )
                .expect("write session");
                fs::write(source_home.join("session_index.jsonl"), "{\"id\":\"a\"}\n")
                    .expect("write index");
                fs::write(
                    source_home.join(CONFIG_FILE),
                    "[mcp_servers.time]\ncommand = \"time\"\n",
                )
                .expect("write config");

                let status =
                    extract_sync_package_from(source_home, package_root).expect("extract package");
                let report = preflight_sync_package_for(package_root, Some(source_home))
                    .expect("preflight package");

                assert!(report.ready_to_apply);
                assert_eq!(report.error_count, 0);
                assert!(matches!(report.status.as_str(), "ok" | "warning"));
                assert_eq!(report.package_created_at, status.created_at);
                assert!(report
                    .checks
                    .iter()
                    .any(|check| check.id == "entries.integrity" && check.status == "ok"));
                assert!(report
                    .checks
                    .iter()
                    .any(|check| check.id == "config.boundary" && check.status == "ok"));
            },
        );
    }

    #[test]
    fn package_preflight_blocks_unsafe_runtime_paths() {
        with_temp_paths(
            "codex-sync-package-preflight-unsafe-test",
            |source_home, _target_home, package_root| {
                let memory_dir = source_home.join("memories");
                fs::create_dir_all(&memory_dir).expect("create memory dir");
                fs::write(memory_dir.join("user.md"), "memory").expect("write memory");

                extract_sync_package_from(source_home, package_root).expect("extract package");
                let package_home = package_codex_home_dir_for(package_root);
                fs::write(package_home.join("auth.json"), "{}").expect("write unsafe auth");

                let report = preflight_sync_package_for(package_root, Some(source_home))
                    .expect("preflight package");

                assert_eq!(report.status, "error");
                assert!(!report.ready_to_apply);
                assert!(report.unsafe_paths.iter().any(|path| path == "auth.json"));
                assert!(report
                    .checks
                    .iter()
                    .any(|check| check.id == "package.boundary" && check.status == "error"));
            },
        );
    }

    #[test]
    fn package_apply_writes_clone_applied_marker() {
        with_temp_paths(
            "codex-sync-package-applied-marker-test",
            |source_home, target_home, package_root| {
                let memory_dir = source_home.join("memories");
                fs::create_dir_all(&memory_dir).expect("create memory dir");
                fs::write(memory_dir.join("user.md"), "memory").expect("write memory");

                extract_sync_package_from(source_home, package_root).expect("extract package");
                let apply = apply_sync_package_to_home_from_source(
                    package_root,
                    target_home,
                    Some(source_home),
                )
                .expect("apply package");
                assert!(apply.warnings.is_empty());

                let marker = read_applied_sync_package_marker(target_home)
                    .expect("read applied marker")
                    .expect("marker exists");
                assert_eq!(marker.version, 1);
                assert_eq!(
                    marker.package_path,
                    package_codex_home_dir_for(package_root)
                        .to_string_lossy()
                        .to_string()
                );
                assert!(marker.applied_at > 0);
                assert!(marker
                    .resources
                    .iter()
                    .any(|resource| resource.id == "memory"));
            },
        );
    }

    #[test]
    fn package_extract_backs_up_existing_package_before_replace() {
        with_temp_paths(
            "codex-sync-package-backup-test",
            |source_home, _target_home, package_root| {
                let package_home = package_codex_home_dir_for(package_root);
                fs::create_dir_all(package_home.join("plugins")).expect("create old package dir");
                fs::write(package_home.join("plugins").join("old.txt"), "old")
                    .expect("write old package file");
                fs::write(manifest_path_for(package_root), "{\"old\":true}")
                    .expect("write old manifest");
                let skill_dir = source_home.join("skills").join("define-goal");
                fs::create_dir_all(&skill_dir).expect("create source skill");
                fs::write(skill_dir.join("SKILL.md"), "# Define Goal").expect("write source skill");

                let status =
                    extract_sync_package_from(source_home, package_root).expect("extract package");

                assert!(status
                    .warnings
                    .iter()
                    .any(|warning| warning.contains("previous sync package backed up")));
                assert!(!package_home.join("plugins").exists());
                assert!(package_home
                    .join("skills")
                    .join("define-goal")
                    .join("SKILL.md")
                    .exists());

                let backup_root = package_backup_root_dir_for(package_root);
                let backups = fs::read_dir(&backup_root)
                    .expect("read backups")
                    .map(|entry| entry.expect("backup entry").path())
                    .collect::<Vec<_>>();
                assert_eq!(backups.len(), 1);
                let backup = &backups[0];
                assert!(backup
                    .join(PACKAGE_CODEX_HOME_DIR_NAME)
                    .join("plugins")
                    .join("old.txt")
                    .exists());
                assert!(backup.join(MANIFEST_FILE_NAME).exists());

                let summaries =
                    list_sync_package_backups_for(package_root).expect("list backup summaries");
                assert_eq!(summaries.len(), 1);
                assert_eq!(summaries[0].status, "error");
                assert!(summaries[0].backup_path.contains("sync-package-"));
            },
        );
    }

    #[test]
    fn package_restore_backup_replaces_current_package_and_backs_up_current() {
        with_temp_paths(
            "codex-sync-package-restore-test",
            |source_home, _target_home, package_root| {
                let source_memories = source_home.join("memories");
                fs::create_dir_all(&source_memories).expect("create source memories");
                fs::write(source_memories.join("MEMORY.md"), "source memory v1")
                    .expect("write v1 memory");

                let first =
                    extract_sync_package_from(source_home, package_root).expect("extract v1");
                std::thread::sleep(std::time::Duration::from_millis(2));

                fs::write(source_memories.join("MEMORY.md"), "source memory v2")
                    .expect("write v2 memory");
                let second =
                    extract_sync_package_from(source_home, package_root).expect("extract v2");
                assert_eq!(
                    fs::read_to_string(
                        package_codex_home_dir_for(package_root)
                            .join("memories")
                            .join("MEMORY.md")
                    )
                    .expect("read current package memory"),
                    "source memory v2"
                );

                let backup_id = list_sync_package_backups_for(package_root)
                    .expect("list backups")
                    .into_iter()
                    .find(|backup| backup.package_created_at == first.created_at)
                    .expect("find v1 backup")
                    .id;
                std::thread::sleep(std::time::Duration::from_millis(2));

                let restored = restore_sync_package_backup_for(package_root, &backup_id)
                    .expect("restore v1 backup");

                assert_eq!(restored.created_at, first.created_at);
                assert!(restored
                    .warnings
                    .iter()
                    .any(|warning| warning.contains("restored sync package backup")));
                assert!(restored
                    .warnings
                    .iter()
                    .any(|warning| warning.contains("current sync package backed up")));
                assert_eq!(
                    fs::read_to_string(
                        package_codex_home_dir_for(package_root)
                            .join("memories")
                            .join("MEMORY.md")
                    )
                    .expect("read restored package memory"),
                    "source memory v1"
                );

                let backups_after =
                    list_sync_package_backups_for(package_root).expect("list backups after");
                assert!(backups_after
                    .iter()
                    .any(|backup| backup.package_created_at == second.created_at));
            },
        );
    }

    #[test]
    fn package_restore_backup_rejects_invalid_backup_id() {
        with_temp_paths(
            "codex-sync-package-restore-invalid-test",
            |_source_home, _target_home, package_root| {
                let error = restore_sync_package_backup_for(package_root, "../sync-package-123")
                    .expect_err("backup id traversal must fail");
                assert!(error.contains("invalid Codex sync package backup id"));

                let error = restore_sync_package_backup_for(package_root, "sync-package-not-ms")
                    .expect_err("backup id suffix must be numeric");
                assert!(error.contains("invalid Codex sync package backup id"));
            },
        );
    }

    #[test]
    fn package_extracts_define_goal_and_applies_real_skill_directory() {
        with_temp_paths(
            "codex-sync-package-define-goal-test",
            |source_home, target_home, package_root| {
                let skill_dir = source_home.join("skills").join("define-goal");
                fs::create_dir_all(&skill_dir).expect("create skill dir");
                fs::write(skill_dir.join("SKILL.md"), "# Define Goal").expect("write skill");

                let status =
                    extract_sync_package_from(source_home, package_root).expect("extract package");
                assert!(status.exists);
                assert!(Path::new(&status.package_path)
                    .join("skills")
                    .join("define-goal")
                    .join("SKILL.md")
                    .exists());

                let apply =
                    apply_sync_package_from(&package_codex_home_dir_for(package_root), target_home)
                        .expect("apply package");
                assert!(apply.warnings.is_empty());
                assert_eq!(
                    fs::read_to_string(
                        target_home
                            .join("skills")
                            .join("define-goal")
                            .join("SKILL.md")
                    )
                    .expect("read copied skill"),
                    "# Define Goal"
                );
                let metadata =
                    fs::symlink_metadata(target_home.join("skills")).expect("skill metadata");
                assert!(!metadata.file_type().is_symlink());
            },
        );
    }

    #[test]
    fn package_apply_allows_stale_package_with_warning_until_refresh() {
        with_temp_paths(
            "codex-sync-package-stale-apply-test",
            |source_home, target_home, package_root| {
                let source_memories = source_home.join("memories");
                fs::create_dir_all(&source_memories).expect("create source memories");
                fs::write(source_memories.join("MEMORY.md"), "source memory v1")
                    .expect("write source memory");

                extract_sync_package_from(source_home, package_root).expect("extract package");

                fs::write(source_memories.join("MEMORY.md"), "source memory v2")
                    .expect("update source memory");
                let manifest_path = manifest_path_for(package_root);
                let mut manifest: CodexSyncPackageManifest = serde_json::from_str(
                    &fs::read_to_string(&manifest_path).expect("read package manifest"),
                )
                .expect("parse package manifest");
                let source_modified_at = sync_source_modified_at(source_home)
                    .expect("read source mtime")
                    .unwrap();
                manifest.created_at = source_modified_at - FRESHNESS_MTIME_GRACE_MS - 1;
                fs::write(
                    &manifest_path,
                    serde_json::to_string_pretty(&manifest).expect("serialize manifest"),
                )
                .expect("write stale manifest");

                let stale_apply = apply_sync_package_to_home_from_source(
                    package_root,
                    target_home,
                    Some(source_home),
                )
                .expect("stale package should still apply the last extracted content");
                assert!(stale_apply
                    .warnings
                    .iter()
                    .any(|warning| warning.contains("last extracted package")));
                assert_eq!(
                    fs::read_to_string(target_home.join("memories").join("MEMORY.md"))
                        .expect("read copied stale memory"),
                    "source memory v1"
                );

                let status =
                    extract_sync_package_from(source_home, package_root).expect("refresh package");
                assert!(!status.stale);

                let apply = apply_sync_package_to_home_from_source(
                    package_root,
                    target_home,
                    Some(source_home),
                )
                .expect("apply refreshed package");
                assert!(apply.warnings.is_empty());
                assert_eq!(
                    fs::read_to_string(target_home.join("memories").join("MEMORY.md"))
                        .expect("read copied memory"),
                    "source memory v2"
                );
            },
        );
    }

    #[test]
    fn package_apply_rejects_manifest_package_path_tampering() {
        with_temp_paths(
            "codex-sync-package-path-tamper-test",
            |source_home, target_home, package_root| {
                let source_skills = source_home.join("skills").join("safe");
                fs::create_dir_all(&source_skills).expect("create safe skills");
                fs::write(source_skills.join("SKILL.md"), "# Safe").expect("write safe skill");
                extract_sync_package_from(source_home, package_root).expect("extract package");

                let outside_home = package_root.join("outside-codex-home");
                let outside_skills = outside_home.join("skills").join("evil");
                fs::create_dir_all(&outside_skills).expect("create outside skills");
                fs::write(outside_skills.join("SKILL.md"), "# Evil").expect("write outside skill");

                let manifest_path = manifest_path_for(package_root);
                let mut manifest: CodexSyncPackageManifest = serde_json::from_str(
                    &fs::read_to_string(&manifest_path).expect("read package manifest"),
                )
                .expect("parse package manifest");
                manifest.package_path = outside_home.to_string_lossy().to_string();
                fs::write(
                    &manifest_path,
                    serde_json::to_string_pretty(&manifest).expect("serialize manifest"),
                )
                .expect("write tampered manifest");

                let error = apply_sync_package_to_home_from_source(
                    package_root,
                    target_home,
                    Some(source_home),
                )
                .expect_err("tampered package path should be rejected");

                assert!(error.contains("manifest path mismatch"));
                assert!(!target_home.join("skills").join("evil").exists());
                assert!(!target_home.join("skills").join("safe").exists());
            },
        );
    }

    #[test]
    fn package_apply_replaces_clone_memories_with_package_memories() {
        with_temp_paths(
            "codex-sync-package-memories-replace-test",
            |source_home, target_home, package_root| {
                let source_memories = source_home.join("memories");
                fs::create_dir_all(&source_memories).expect("create source memories");
                fs::write(source_memories.join("MEMORY.md"), "source memory")
                    .expect("write source memory");
                fs::write(source_memories.join("memory_summary.md"), "source summary")
                    .expect("write source summary");

                let target_memories = target_home.join("memories");
                fs::create_dir_all(&target_memories).expect("create target memories");
                fs::write(target_memories.join("old-only.md"), "stale clone memory")
                    .expect("write stale memory");

                extract_sync_package_from(source_home, package_root).expect("extract package");
                let apply =
                    apply_sync_package_from(&package_codex_home_dir_for(package_root), target_home)
                        .expect("apply package");

                assert!(apply.warnings.is_empty());
                assert_eq!(
                    fs::read_to_string(target_memories.join("MEMORY.md"))
                        .expect("read copied memory"),
                    "source memory"
                );
                assert_eq!(
                    fs::read_to_string(target_memories.join("memory_summary.md"))
                        .expect("read copied summary"),
                    "source summary"
                );
                assert!(!target_memories.join("old-only.md").exists());
            },
        );
    }

    #[test]
    fn package_inherits_local_capabilities_without_overwriting_clone_quota_config() {
        with_temp_paths(
            "codex-sync-package-inherit-capabilities-test",
            |source_home, target_home, package_root| {
                fs::write(source_home.join("auth.json"), r#"{"token":"source"}"#)
                    .expect("write auth");
                fs::write(source_home.join(".credentials.json"), r#"{"secret":true}"#)
                    .expect("write credentials");
                let mcp_secret_dir = source_home.join("mcp-servers").join("local");
                fs::create_dir_all(&mcp_secret_dir).expect("create mcp dir");
                fs::write(mcp_secret_dir.join("server.js"), "console.log('ok')")
                    .expect("write mcp server");
                fs::write(mcp_secret_dir.join(".env"), "OPENAI_API_KEY=sk-source")
                    .expect("write mcp env");
                fs::write(mcp_secret_dir.join("private.key"), "secret key").expect("write mcp key");
                fs::write(
                    source_home.join("config.toml"),
                    r#"model = "source-model"
model_provider = "source-provider"
openai_base_url = "https://source.example.com/v1"
api_key = "sk-source-top-level"
refresh_token = "refresh-source-top-level"

[features]
web_search = true

[custom_tool]
command = "safe"
bearer_token = "source-bearer-token"

[model_providers.source-provider]
base_url = "https://source.example.com/v1"
experimental_bearer_token = "sk-source-provider"

[mcp_servers.safe]
command = "node"

[mcp_servers.arg_secret]
command = "node"
args = ["server.js", "--api-key", "sk-source"]

[mcp_servers.secret.env]
OPENAI_API_KEY = "sk-source"
"#,
                )
                .expect("write source config");
                fs::write(
                    target_home.join("config.toml"),
                    r#"model = "clone-model"
model_provider = "clone-provider"

[model_providers.clone-provider]
base_url = "https://relay.example.com/v1"
experimental_bearer_token = "sk-clone"
"#,
                )
                .expect("write target config");
                fs::write(target_home.join(".credentials.json"), r#"{"old":true}"#)
                    .expect("write old target credentials");

                extract_sync_package_from(source_home, package_root).expect("extract package");
                let package_home = package_codex_home_dir_for(package_root);
                assert!(!package_home.join("auth.json").exists());
                assert!(!package_home.join(".credentials.json").exists());
                let package_config = fs::read_to_string(package_home.join("config.toml"))
                    .expect("read package config");
                assert!(!package_config.contains("source-provider"));
                assert!(!package_config.contains("openai_base_url"));
                assert!(package_config.contains("[features]"));
                assert!(package_config.contains("[mcp_servers.safe]"));
                assert!(package_config.contains("[mcp_servers.arg_secret]"));
                assert!(!package_config.contains("OPENAI_API_KEY"));
                assert!(!package_config.contains("sk-source"));
                assert!(!package_config.contains("refresh-source-top-level"));
                assert!(!package_config.contains("source-bearer-token"));
                assert!(!package_config.contains("--api-key"));
                assert!(!package_config.contains("[mcp_servers.secret.env]"));
                assert!(package_home
                    .join("mcp-servers")
                    .join("local")
                    .join("server.js")
                    .exists());
                assert!(!package_home
                    .join("mcp-servers")
                    .join("local")
                    .join(".env")
                    .exists());
                assert!(!package_home
                    .join("mcp-servers")
                    .join("local")
                    .join("private.key")
                    .exists());

                apply_sync_package_from(&package_home, target_home).expect("apply package");
                assert!(!target_home.join("auth.json").exists());
                assert!(!target_home.join(".credentials.json").exists());
                let content =
                    fs::read_to_string(target_home.join("config.toml")).expect("read config");
                assert!(content.contains(r#"model = "clone-model""#));
                assert!(content.contains(r#"model_provider = "clone-provider""#));
                assert!(content.contains("experimental_bearer_token"));
                assert!(content.contains("[features]"));
                assert!(content.contains("[mcp_servers.safe]"));
                assert!(content.contains("[mcp_servers.arg_secret]"));
                assert!(!content.contains("OPENAI_API_KEY"));
                assert!(!content.contains("sk-source"));
                assert!(!content.contains("refresh-source-top-level"));
                assert!(!content.contains("source-bearer-token"));
                assert!(!content.contains("--api-key"));
                assert!(!content.contains("[mcp_servers.secret.env]"));
                assert!(!content.contains("source-provider"));
                assert!(!content.contains("openai_base_url"));
                assert!(target_home
                    .join("mcp-servers")
                    .join("local")
                    .join("server.js")
                    .exists());
                assert!(!target_home
                    .join("mcp-servers")
                    .join("local")
                    .join(".env")
                    .exists());
                assert!(!target_home
                    .join("mcp-servers")
                    .join("local")
                    .join("private.key")
                    .exists());
            },
        );
    }

    #[test]
    fn package_applies_chat_files_without_overwriting_existing_state_db() {
        with_temp_paths(
            "codex-sync-package-history-test",
            |source_home, target_home, package_root| {
                let session_dir = source_home.join("sessions").join("2026");
                fs::create_dir_all(&session_dir).expect("create sessions");
                fs::write(session_dir.join("rollout-source.jsonl"), "{}\n").expect("write session");
                fs::write(
                    source_home.join("session_index.jsonl"),
                    "{\"id\":\"source\"}\n",
                )
                .expect("write index");
                fs::write(source_home.join("history.jsonl"), "{\"history\":true}\n")
                    .expect("write history");
                create_history_db(&source_home.join("state_5.sqlite"), "source");
                create_history_db(&target_home.join("state_5.sqlite"), "target");

                extract_sync_package_from(source_home, package_root).expect("extract package");
                let apply =
                    apply_sync_package_from(&package_codex_home_dir_for(package_root), target_home)
                        .expect("apply package");
                assert!(apply
                    .skipped
                    .iter()
                    .any(|item| item.contains("state_5.sqlite")));
                assert_eq!(
                    read_sqlite_thread_ids(&target_home.join("state_5.sqlite")),
                    vec!["target".to_string()]
                );
                assert!(target_home
                    .join("sessions")
                    .join("2026")
                    .join("rollout-source.jsonl")
                    .exists());
                assert_eq!(
                    fs::read_to_string(target_home.join("session_index.jsonl"))
                        .expect("read copied index"),
                    "{\"id\":\"source\"}\n"
                );
            },
        );
    }

    #[test]
    fn package_extracts_sqlite_snapshot_without_wal_sidecars() {
        with_temp_paths(
            "codex-sync-package-sqlite-snapshot-test",
            |source_home, _target_home, package_root| {
                let db_path = source_home.join("state_5.sqlite");
                create_history_db(&db_path, "source");
                let goals_db_path = source_home.join("goals_1.sqlite");
                create_history_db(&goals_db_path, "goal-source");
                fs::write(source_home.join("state_5.sqlite-wal"), "stale wal").expect("write wal");
                fs::write(source_home.join("state_5.sqlite-shm"), "stale shm").expect("write shm");
                fs::write(source_home.join("goals_1.sqlite-wal"), "stale goals wal")
                    .expect("write goals wal");
                fs::write(source_home.join("goals_1.sqlite-shm"), "stale goals shm")
                    .expect("write goals shm");

                extract_sync_package_from(source_home, package_root).expect("extract package");
                let package_home = package_codex_home_dir_for(package_root);

                assert_eq!(
                    read_sqlite_thread_ids(&package_home.join("state_5.sqlite")),
                    vec!["source".to_string()]
                );
                assert!(!package_home.join("state_5.sqlite-wal").exists());
                assert!(!package_home.join("state_5.sqlite-shm").exists());
                assert_eq!(
                    read_sqlite_thread_ids(&package_home.join("goals_1.sqlite")),
                    vec!["goal-source".to_string()]
                );
                assert!(!package_home.join("goals_1.sqlite-wal").exists());
                assert!(!package_home.join("goals_1.sqlite-shm").exists());
            },
        );
    }

    #[test]
    fn package_apply_replaces_clone_goals_database() {
        with_temp_paths(
            "codex-sync-package-goals-test",
            |source_home, target_home, package_root| {
                create_history_db(&source_home.join("goals_1.sqlite"), "source-goal");
                create_history_db(&target_home.join("goals_1.sqlite"), "old-clone-goal");
                fs::write(target_home.join("goals_1.sqlite-wal"), "old goals wal")
                    .expect("write target goals wal");

                extract_sync_package_from(source_home, package_root).expect("extract package");
                let apply =
                    apply_sync_package_from(&package_codex_home_dir_for(package_root), target_home)
                        .expect("apply package");

                assert!(!apply
                    .skipped
                    .iter()
                    .any(|item| item.contains("goals_1.sqlite")));
                assert_eq!(
                    read_sqlite_thread_ids(&target_home.join("goals_1.sqlite")),
                    vec!["source-goal".to_string()]
                );
                assert!(!target_home.join("goals_1.sqlite-wal").exists());
            },
        );
    }

    #[test]
    fn package_apply_replaces_corrupt_existing_sqlite() {
        with_temp_paths(
            "codex-sync-package-corrupt-sqlite-test",
            |source_home, target_home, package_root| {
                create_history_db(&source_home.join("state_5.sqlite"), "source");
                fs::write(target_home.join("state_5.sqlite"), "not sqlite")
                    .expect("write corrupt db");
                fs::write(target_home.join("state_5.sqlite-wal"), "bad wal")
                    .expect("write corrupt wal");

                extract_sync_package_from(source_home, package_root).expect("extract package");
                let apply =
                    apply_sync_package_from(&package_codex_home_dir_for(package_root), target_home)
                        .expect("apply package");

                assert!(apply
                    .warnings
                    .iter()
                    .any(|item| item.contains("was unreadable and replaced")));
                assert_eq!(
                    read_sqlite_thread_ids(&target_home.join("state_5.sqlite")),
                    vec!["source".to_string()]
                );
                assert!(!target_home.join("state_5.sqlite-wal").exists());
                assert!(fs::read_dir(target_home)
                    .expect("read target home")
                    .flatten()
                    .any(|entry| entry
                        .file_name()
                        .to_string_lossy()
                        .starts_with("state_5.sqlite.corrupt-")));
            },
        );
    }

    fn read_sqlite_thread_ids(path: &Path) -> Vec<String> {
        let conn = Connection::open(path).expect("open sqlite for ids");
        let mut stmt = conn
            .prepare("SELECT id FROM threads ORDER BY id")
            .expect("prepare ids");
        stmt.query_map([], |row| row.get::<_, String>(0))
            .expect("query ids")
            .map(|row| row.expect("read id"))
            .collect()
    }

    #[cfg(windows)]
    #[test]
    fn package_extract_rejects_linked_top_level_file_source() {
        with_temp_paths(
            "codex-sync-package-linked-top-level-file-test",
            |source_home, _target_home, package_root| {
                let linked_target = package_root.join("outside-agents-link-target");
                fs::create_dir_all(&linked_target).expect("create linked target");
                fs::write(linked_target.join("secret.txt"), "do-not-copy")
                    .expect("write linked target file");
                let linked_source = source_home.join("AGENTS.md");
                let output = std::process::Command::new("cmd")
                    .arg("/C")
                    .arg("mklink")
                    .arg("/J")
                    .arg(&linked_source)
                    .arg(&linked_target)
                    .output()
                    .expect("run mklink");
                assert!(
                    output.status.success(),
                    "mklink failed: {}{}",
                    String::from_utf8_lossy(&output.stdout),
                    String::from_utf8_lossy(&output.stderr)
                );

                let result =
                    extract_sync_package_from(source_home, package_root).expect("extract package");

                assert!(
                    result
                        .warnings
                        .iter()
                        .any(|warning| warning
                            .contains("refuse to copy file from linked source path"))
                );
                assert!(!package_codex_home_dir_for(package_root)
                    .join("AGENTS.md")
                    .join("secret.txt")
                    .exists());
            },
        );
    }

    #[cfg(windows)]
    #[test]
    fn package_apply_rejects_linked_source_directory() {
        with_temp_paths(
            "codex-sync-package-source-junction-test",
            |_source_home, target_home, package_root| {
                let package_home = package_codex_home_dir_for(package_root);
                let linked_target = package_root.join("outside-linked-source");
                fs::create_dir_all(&linked_target).expect("create linked target");
                fs::write(linked_target.join("secret.txt"), "do-not-copy")
                    .expect("write linked target file");
                let linked_source = package_home.join("skills");
                fs::create_dir_all(&package_home).expect("create package home");
                let output = std::process::Command::new("cmd")
                    .arg("/C")
                    .arg("mklink")
                    .arg("/J")
                    .arg(&linked_source)
                    .arg(&linked_target)
                    .output()
                    .expect("run mklink");
                assert!(
                    output.status.success(),
                    "mklink failed: {}{}",
                    String::from_utf8_lossy(&output.stdout),
                    String::from_utf8_lossy(&output.stderr)
                );

                let result = copy_directory_merge(&package_home, target_home);

                assert!(result.is_err());
                assert!(result
                    .unwrap_err()
                    .contains("refuse to copy linked source path"));
                assert!(!target_home.join("skills").join("secret.txt").exists());
            },
        );
    }

    #[cfg(windows)]
    #[test]
    fn package_apply_replaces_windows_junction_with_real_directory() {
        with_temp_paths(
            "codex-sync-package-junction-test",
            |source_home, target_home, package_root| {
                let skill_dir = source_home.join("skills").join("define-goal");
                fs::create_dir_all(&skill_dir).expect("create skill");
                fs::write(skill_dir.join("SKILL.md"), "# Define Goal").expect("write skill");

                let old_target = target_home.join("old-skills");
                fs::create_dir_all(&old_target).expect("create old target");
                fs::write(old_target.join("old.txt"), "old").expect("write old");
                let junction = target_home.join("skills");
                let output = std::process::Command::new("cmd")
                    .arg("/C")
                    .arg("mklink")
                    .arg("/J")
                    .arg(&junction)
                    .arg(&old_target)
                    .output()
                    .expect("run mklink");
                assert!(
                    output.status.success(),
                    "mklink failed: {}{}",
                    String::from_utf8_lossy(&output.stdout),
                    String::from_utf8_lossy(&output.stderr)
                );
                let before = fs::symlink_metadata(&junction).expect("junction metadata");
                assert!(is_linked_path(&junction, &before));

                extract_sync_package_from(source_home, package_root).expect("extract package");
                apply_sync_package_from(&package_codex_home_dir_for(package_root), target_home)
                    .expect("apply package");

                let after = fs::symlink_metadata(&junction).expect("skills metadata");
                assert!(!is_linked_path(&junction, &after));
                assert!(junction.join("define-goal").join("SKILL.md").exists());
                assert!(old_target.exists());
            },
        );
    }

    #[cfg(windows)]
    #[test]
    fn package_apply_replaces_windows_junction_for_merge_directory() {
        with_temp_paths(
            "codex-sync-package-merge-junction-test",
            |source_home, target_home, package_root| {
                let session_dir = source_home.join("sessions").join("2026");
                fs::create_dir_all(&session_dir).expect("create session dir");
                fs::write(session_dir.join("rollout-source.jsonl"), "{}\n")
                    .expect("write source session");

                let linked_target = target_home.join("outside-sessions");
                fs::create_dir_all(&linked_target).expect("create linked target");
                fs::write(linked_target.join("old.txt"), "old").expect("write old target");
                let junction = target_home.join("sessions");
                let output = std::process::Command::new("cmd")
                    .arg("/C")
                    .arg("mklink")
                    .arg("/J")
                    .arg(&junction)
                    .arg(&linked_target)
                    .output()
                    .expect("run mklink");
                assert!(
                    output.status.success(),
                    "mklink failed: {}{}",
                    String::from_utf8_lossy(&output.stdout),
                    String::from_utf8_lossy(&output.stderr)
                );
                let before = fs::symlink_metadata(&junction).expect("junction metadata");
                assert!(is_linked_path(&junction, &before));

                extract_sync_package_from(source_home, package_root).expect("extract package");
                apply_sync_package_from(&package_codex_home_dir_for(package_root), target_home)
                    .expect("apply package");

                let after = fs::symlink_metadata(&junction).expect("sessions metadata");
                assert!(!is_linked_path(&junction, &after));
                assert!(junction.join("2026").join("rollout-source.jsonl").exists());
                assert!(!linked_target
                    .join("2026")
                    .join("rollout-source.jsonl")
                    .exists());
                assert_eq!(
                    fs::read_to_string(linked_target.join("old.txt")).expect("read old target"),
                    "old"
                );
            },
        );
    }
}
