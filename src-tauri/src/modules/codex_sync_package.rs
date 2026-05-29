use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use chrono::Utc;
use rusqlite::{Connection, DatabaseName, OpenFlags};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use toml_edit::Document;

use crate::modules;

const PACKAGE_DIR_NAME: &str = "sync-package";
const PACKAGE_CODEX_HOME_DIR_NAME: &str = "codex-home";
const MANIFEST_FILE_NAME: &str = "codex-sync-package-manifest.json";

const REPLACE_DIRECTORIES: &[&str] = &[
    ".tmp",
    "ambient-suggestions",
    "automations",
    "browser",
    "cache",
    "log",
    "mcp-servers",
    "memories",
    "pets",
    "plugins",
    "rules",
    "skills",
    "sqlite",
    "vendor_imports",
];
const MERGE_DIRECTORIES: &[&str] = &["sessions", "archived_sessions", "history_sync_backups"];
const COPY_FILES: &[&str] = &[
    ".codex-global-state.json",
    ".credentials.json",
    ".personality_migration",
    "AGENTS.md",
    "external_agent_session_imports.json",
    "session_index.jsonl",
    "history.jsonl",
    "installation_id",
    "logs_2.sqlite",
    "models_cache.json",
    "sandbox.log",
    "state_5.sqlite",
    "transcription-history.jsonl",
    "version.json",
];
const CONFIG_FILE: &str = "config.toml";
const PRESERVE_TARGET_FILES_IF_EXISTS: &[&str] = &["state_5.sqlite", "logs_2.sqlite"];
const QUOTA_CONFIG_KEYS: &[&str] = &[
    "model",
    "model_provider",
    "model_providers",
    "openai_base_url",
];
const FRESHNESS_DIRECTORIES: &[&str] = &[
    "ambient-suggestions",
    "archived_sessions",
    "automations",
    "cache",
    "history_sync_backups",
    "mcp-servers",
    "memories",
    "pets",
    "plugins",
    "rules",
    "sessions",
    "skills",
    "sqlite",
    "vendor_imports",
];
const FRESHNESS_FILES: &[&str] = &[
    ".codex-global-state.json",
    ".credentials.json",
    ".personality_migration",
    "AGENTS.md",
    CONFIG_FILE,
    "external_agent_session_imports.json",
    "history.jsonl",
    "installation_id",
    "models_cache.json",
    "session_index.jsonl",
    "state_5.sqlite",
    "state_5.sqlite-wal",
    "state_5.sqlite-shm",
    "transcription-history.jsonl",
    "version.json",
];

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
    pub sha256: Option<String>,
    pub error: Option<String>,
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
    pub skipped: Vec<String>,
    pub warnings: Vec<String>,
}

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

fn manifest_path_for(package_root: &Path) -> PathBuf {
    package_root.join(MANIFEST_FILE_NAME)
}

pub fn status() -> Result<CodexSyncPackageStatus, String> {
    status_for(&package_root_dir()?)
}

fn status_for(package_root: &Path) -> Result<CodexSyncPackageStatus, String> {
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
    status_from_manifest(&manifest, None)
}

fn status_from_manifest(
    manifest: &CodexSyncPackageManifest,
    current_source_override: Option<&Path>,
) -> Result<CodexSyncPackageStatus, String> {
    let (source_modified_at, stale, mut freshness_warnings) =
        sync_package_freshness(manifest, current_source_override);
    let mut warnings = manifest.warnings.clone();
    warnings.append(&mut freshness_warnings);
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
        .map(|modified_at| modified_at > manifest.created_at)
        .unwrap_or(false);
    if stale_by_time {
        warnings.push("local Codex home changed after sync package extraction".to_string());
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

pub fn ensure_fresh_sync_package() -> Result<CodexSyncPackageStatus, String> {
    ensure_fresh_sync_package_for(&package_root_dir()?)
}

fn ensure_fresh_sync_package_for(package_root: &Path) -> Result<CodexSyncPackageStatus, String> {
    let current = status_for(package_root)?;
    if current.exists && !current.stale {
        return Ok(current);
    }
    let source_home = modules::codex_instance::get_default_codex_home()?;
    extract_sync_package_from(&source_home, package_root)
}

fn require_existing_sync_package_for(
    package_root: &Path,
) -> Result<CodexSyncPackageStatus, String> {
    let current = status_for(package_root)?;
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
            entries.push(package_entry(*relative, "file", "missing", 0, None, None));
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
                Some(sha256),
                None,
            ));
        }
        Ok(None) => {
            skipped.push(CONFIG_FILE.to_string());
            entries.push(package_entry(CONFIG_FILE, "file", "missing", 0, None, None));
        }
        Err(error) => {
            warnings.push(format!("safe config extract skipped: {}", error));
            entries.push(package_entry(
                CONFIG_FILE,
                "file",
                "error",
                0,
                None,
                Some(error),
            ));
        }
    }

    let manifest = CodexSyncPackageManifest {
        version: 1,
        created_at: Utc::now().timestamp_millis(),
        source: source_home.to_string_lossy().to_string(),
        package_path: package_home.to_string_lossy().to_string(),
        manifest_path: manifest_path.to_string_lossy().to_string(),
        file_count: totals.file_count,
        directory_count: totals.directory_count,
        copied_bytes: totals.copied_bytes,
        entries,
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
    let package = require_existing_sync_package_for(&package_root_dir()?)?;
    let package_home = PathBuf::from(&package.package_path);
    apply_sync_package_from(&package_home, target_home)
}

pub fn refresh_and_apply_sync_package_to_home(
    target_home: &Path,
) -> Result<CodexSyncPackageApplyResult, String> {
    let package = extract_sync_package()?;
    let package_home = PathBuf::from(&package.package_path);
    apply_sync_package_from(&package_home, target_home)
}

pub fn apply_fresh_sync_package_to_home(
    target_home: &Path,
) -> Result<CodexSyncPackageApplyResult, String> {
    let package = ensure_fresh_sync_package()?;
    let package_home = PathBuf::from(&package.package_path);
    apply_sync_package_from(&package_home, target_home)
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
    sha256: Option<String>,
    error: Option<String>,
) -> CodexSyncPackageEntry {
    CodexSyncPackageEntry {
        path: path.to_string(),
        kind: kind.to_string(),
        status: status.to_string(),
        bytes,
        sha256,
        error,
    }
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

fn copy_sqlite_snapshot_replace(source: &Path, target: &Path) -> Result<(u64, String), String> {
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
    fs::create_dir_all(target).map_err(|error| {
        format!(
            "create target directory failed ({}): {}",
            target.display(),
            error
        )
    })?;
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
        let metadata = fs::metadata(&source_path).map_err(|error| {
            format!(
                "read source metadata failed ({}): {}",
                source_path.display(),
                error
            )
        })?;
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

                std::thread::sleep(Duration::from_millis(20));
                fs::write(
                    source_home.join("session_index.jsonl"),
                    "{\"id\":\"one\"}\n{\"id\":\"two\"}\n",
                )
                .expect("update source index");

                let manifest: CodexSyncPackageManifest = serde_json::from_str(
                    &fs::read_to_string(manifest_path_for(package_root))
                        .expect("read package manifest"),
                )
                .expect("parse package manifest");
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
    fn package_inherits_local_capabilities_without_overwriting_clone_quota_config() {
        with_temp_paths(
            "codex-sync-package-inherit-capabilities-test",
            |source_home, target_home, package_root| {
                fs::write(source_home.join("auth.json"), r#"{"token":"source"}"#)
                    .expect("write auth");
                fs::write(source_home.join(".credentials.json"), r#"{"secret":true}"#)
                    .expect("write credentials");
                fs::write(
                    source_home.join("config.toml"),
                    r#"model = "source-model"
model_provider = "source-provider"
openai_base_url = "https://source.example.com/v1"

[features]
web_search = true

[model_providers.source-provider]
base_url = "https://source.example.com/v1"
experimental_bearer_token = "dummy-source-provider-token"

[mcp_servers.safe]
command = "node"

[mcp_servers.arg_secret]
command = "node"
args = ["server.js", "--api-key", "dummy-source-api-key"]

[mcp_servers.secret.env]
OPENAI_API_KEY = "dummy-source-api-key"
"#,
                )
                .expect("write source config");
                fs::write(
                    target_home.join("config.toml"),
                    r#"model = "clone-model"
model_provider = "clone-provider"

[model_providers.clone-provider]
base_url = "https://relay.example.com/v1"
experimental_bearer_token = "dummy-clone-token"
"#,
                )
                .expect("write target config");

                extract_sync_package_from(source_home, package_root).expect("extract package");
                let package_home = package_codex_home_dir_for(package_root);
                assert!(!package_home.join("auth.json").exists());
                assert!(package_home.join(".credentials.json").exists());
                let package_config = fs::read_to_string(package_home.join("config.toml"))
                    .expect("read package config");
                assert!(!package_config.contains("source-provider"));
                assert!(!package_config.contains("openai_base_url"));

                apply_sync_package_from(&package_home, target_home).expect("apply package");
                assert!(!target_home.join("auth.json").exists());
                assert!(target_home.join(".credentials.json").exists());
                let content =
                    fs::read_to_string(target_home.join("config.toml")).expect("read config");
                assert!(content.contains(r#"model = "clone-model""#));
                assert!(content.contains(r#"model_provider = "clone-provider""#));
                assert!(content.contains("experimental_bearer_token"));
                assert!(content.contains("[features]"));
                assert!(content.contains("[mcp_servers.safe]"));
                assert!(content.contains("OPENAI_API_KEY"));
                assert!(content.contains("[mcp_servers.arg_secret]"));
                assert!(content.contains("[mcp_servers.secret.env]"));
                assert!(!content.contains("source-provider"));
                assert!(!content.contains("openai_base_url"));
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
                fs::write(source_home.join("state_5.sqlite-wal"), "stale wal").expect("write wal");
                fs::write(source_home.join("state_5.sqlite-shm"), "stale shm").expect("write shm");

                extract_sync_package_from(source_home, package_root).expect("extract package");
                let package_home = package_codex_home_dir_for(package_root);

                assert_eq!(
                    read_sqlite_thread_ids(&package_home.join("state_5.sqlite")),
                    vec!["source".to_string()]
                );
                assert!(!package_home.join("state_5.sqlite-wal").exists());
                assert!(!package_home.join("state_5.sqlite-shm").exists());
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
}
