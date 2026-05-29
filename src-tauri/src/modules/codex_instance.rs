use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use chrono::Utc;
use serde::Serialize;
use sha2::{Digest, Sha256};
use toml_edit::Document;
use uuid::Uuid;

use crate::models::codex::CodexAppSpeed;
use crate::models::{DefaultInstanceSettings, InstanceLaunchMode, InstanceProfile, InstanceStore};
use crate::modules;
use crate::modules::instance::InstanceDefaults;
use crate::modules::instance_store;

static CODEX_INSTANCE_STORE_LOCK: std::sync::LazyLock<Mutex<()>> =
    std::sync::LazyLock::new(|| Mutex::new(()));

const CODEX_INSTANCES_FILE: &str = "codex_instances.json";
pub const CODEX_API_SERVICE_BIND_ACCOUNT_ID: &str = "__api_service__";
const CODEX_SHARED_SKILLS_DIR_NAME: &str = "skills";
const CODEX_SHARED_RULES_DIR_NAME: &str = "rules";
const CODEX_SHARED_AGENTS_FILE_NAME: &str = "AGENTS.md";
const CODEX_SHARED_VENDOR_IMPORTS_SKILLS_DIR: &str = "vendor_imports/skills";
const CODEX_CLONE_MEMORY_MANIFEST_FILE_NAME: &str = "clone-memory-manifest.json";
#[cfg(target_os = "windows")]
const CODEX_WINDOWS_APP_DATA_DIR_NAME: &str = "codex-app-data";

const CODEX_MEMORY_DIRECTORIES: &[&str] = &[
    "sessions",
    "archived_sessions",
    "mcp-servers",
    "plugins",
    "cache",
    "memories",
    "sqlite",
    "ambient-suggestions",
    ".tmp/plugins",
    ".tmp/bundled-marketplaces",
];

const CODEX_MEMORY_FILES: &[&str] = &[
    "config.toml",
    ".credentials.json",
    ".tmp/plugins.sha",
    "session_index.jsonl",
    "history.jsonl",
    "state_5.sqlite",
    "state_5.sqlite-wal",
    "state_5.sqlite-shm",
    "logs_2.sqlite",
    "logs_2.sqlite-wal",
    "logs_2.sqlite-shm",
    "models_cache.json",
    "external_agent_session_imports.json",
    "transcription-history.jsonl",
    ".codex-global-state.json",
];

const CODEX_LIGHTWEIGHT_PLUGIN_STATE_FILES: &[&str] = &[".credentials.json", ".tmp/plugins.sha"];

const CODEX_INHERITED_CONFIG_TABLES: &[&str] = &[
    "features",
    "notice",
    "marketplaces",
    "mcp_servers",
    "memories",
    "plugins",
    "projects",
    "shell_environment_policy",
];

const CODEX_SHARED_MEMORY_ITEMS: &[&str] = &[
    CODEX_SHARED_SKILLS_DIR_NAME,
    CODEX_SHARED_RULES_DIR_NAME,
    CODEX_SHARED_VENDOR_IMPORTS_SKILLS_DIR,
    CODEX_SHARED_AGENTS_FILE_NAME,
];

#[derive(Debug, Serialize)]
struct MemoryInheritanceEntry {
    path: String,
    kind: String,
    status: String,
    bytes: u64,
    sha256: Option<String>,
    error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MemoryInheritanceManifest {
    version: u32,
    created_at: i64,
    source: String,
    target: String,
    entries: Vec<MemoryInheritanceEntry>,
}

pub fn is_api_service_bind_account_id(account_id: &str) -> bool {
    account_id.trim() == CODEX_API_SERVICE_BIND_ACCOUNT_ID
}

#[derive(Debug, Clone)]
pub struct CreateInstanceParams {
    pub name: String,
    pub user_data_dir: String,
    pub working_dir: Option<String>,
    pub extra_args: String,
    pub bind_account_id: Option<String>,
    pub copy_source_instance_id: Option<String>,
    pub init_mode: Option<String>,
    pub launch_mode: Option<InstanceLaunchMode>,
    pub app_speed: Option<CodexAppSpeed>,
}

#[derive(Debug, Clone)]
pub struct UpdateInstanceParams {
    pub instance_id: String,
    pub name: Option<String>,
    pub working_dir: Option<String>,
    pub extra_args: Option<String>,
    pub bind_account_id: Option<Option<String>>,
    pub launch_mode: Option<InstanceLaunchMode>,
    pub app_speed: Option<CodexAppSpeed>,
}

fn instances_path() -> Result<PathBuf, String> {
    let data_dir = modules::account::get_data_dir()?;
    Ok(data_dir.join(CODEX_INSTANCES_FILE))
}

pub fn load_instance_store() -> Result<InstanceStore, String> {
    let path = instances_path()?;
    let mut store = instance_store::load_instance_store(&path, CODEX_INSTANCES_FILE)?;
    if normalize_managed_instance_dirs(&mut store)? {
        save_instance_store(&store)?;
    }
    Ok(store)
}

pub fn save_instance_store(store: &InstanceStore) -> Result<(), String> {
    let path = instances_path()?;
    instance_store::save_instance_store(&path, CODEX_INSTANCES_FILE, store)
}

pub fn load_default_settings() -> Result<DefaultInstanceSettings, String> {
    let store = load_instance_store()?;
    Ok(store.default_settings)
}

pub fn update_default_settings(
    bind_account_id: Option<Option<String>>,
    extra_args: Option<String>,
    follow_local_account: Option<bool>,
    launch_mode: Option<InstanceLaunchMode>,
) -> Result<DefaultInstanceSettings, String> {
    let _lock = CODEX_INSTANCE_STORE_LOCK
        .lock()
        .map_err(|_| "无法获取实例锁")?;
    let mut store = load_instance_store()?;
    let settings = &mut store.default_settings;

    if follow_local_account == Some(true) {
        settings.follow_local_account = true;
        settings.bind_account_id = None;
    }

    if let Some(bind) = bind_account_id {
        settings.bind_account_id = bind;
        settings.follow_local_account = false;
    }

    if follow_local_account == Some(false) && settings.bind_account_id.is_none() {
        settings.follow_local_account = false;
    }

    if let Some(args) = extra_args {
        settings.extra_args = args.trim().to_string();
    }

    if let Some(mode) = launch_mode {
        settings.launch_mode = mode;
    }

    let updated = settings.clone();
    save_instance_store(&store)?;
    Ok(updated)
}

pub fn update_default_app_speed(speed: CodexAppSpeed) -> Result<DefaultInstanceSettings, String> {
    let _lock = CODEX_INSTANCE_STORE_LOCK
        .lock()
        .map_err(|_| "无法获取实例锁")?;
    let mut store = load_instance_store()?;
    store.default_settings.app_speed = speed;
    let updated = store.default_settings.clone();
    save_instance_store(&store)?;
    Ok(updated)
}

pub fn get_default_codex_home() -> Result<PathBuf, String> {
    Ok(modules::codex_account::get_codex_home())
}

pub fn get_default_instances_root_dir() -> Result<PathBuf, String> {
    Ok(modules::account::get_data_dir()?
        .join("instances")
        .join("codex"))
}

fn legacy_hardcoded_instances_root_dir() -> Result<Option<PathBuf>, String> {
    #[cfg(target_os = "macos")]
    {
        let home = dirs::home_dir().ok_or("无法获取用户主目录")?;
        return Ok(Some(home.join(".codex_clone_launcher/instances/codex")));
    }

    #[cfg(target_os = "windows")]
    {
        let appdata =
            std::env::var("APPDATA").map_err(|_| "无法获取 APPDATA 环境变量".to_string())?;
        return Ok(Some(
            PathBuf::from(appdata).join(".codex_clone_launcher\\instances\\codex"),
        ));
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        Ok(None)
    }
}

fn migrate_managed_instance_dir(
    instance: &mut InstanceProfile,
    active_root: &Path,
    legacy_root: &Path,
) -> Result<bool, String> {
    let current = PathBuf::from(instance.user_data_dir.trim());
    let relative_path = match current.strip_prefix(legacy_root) {
        Ok(path) if path.components().next().is_some() => path.to_path_buf(),
        _ => return Ok(false),
    };
    let next = active_root.join(relative_path);
    if paths_point_to_same_location(&current, &next) {
        return Ok(false);
    }

    if current.exists() && !next.exists() {
        instance_store::copy_dir_recursive(&current, &next)?;
    }

    instance.user_data_dir = next.to_string_lossy().to_string();
    Ok(true)
}

fn normalize_managed_instance_dirs(store: &mut InstanceStore) -> Result<bool, String> {
    let active_root = get_default_instances_root_dir()?;
    let Some(legacy_root) = legacy_hardcoded_instances_root_dir()? else {
        return Ok(false);
    };
    if paths_point_to_same_location(&active_root, &legacy_root) {
        return Ok(false);
    }

    let mut changed = false;
    for instance in &mut store.instances {
        if migrate_managed_instance_dir(instance, &active_root, &legacy_root)? {
            changed = true;
        }
    }
    Ok(changed)
}

pub fn get_instance_defaults() -> Result<InstanceDefaults, String> {
    let root_dir = get_default_instances_root_dir()?;
    let default_user_data_dir = get_default_codex_home()?;
    Ok(InstanceDefaults {
        root_dir: root_dir.to_string_lossy().to_string(),
        default_user_data_dir: default_user_data_dir.to_string_lossy().to_string(),
    })
}

#[cfg(target_os = "windows")]
fn normalize_windows_codex_home_for_hash(path: &Path) -> String {
    let resolved = fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    resolved.to_string_lossy().replace('/', "\\").to_lowercase()
}

#[cfg(target_os = "windows")]
pub fn get_windows_app_user_data_dir(codex_home: &Path) -> Result<PathBuf, String> {
    let root = get_default_instances_root_dir()?
        .parent()
        .ok_or("无法获取 Codex 实例根目录")?
        .join(CODEX_WINDOWS_APP_DATA_DIR_NAME);
    let normalized = normalize_windows_codex_home_for_hash(codex_home);
    let digest = format!("{:x}", md5::compute(normalized.as_bytes()));
    Ok(root.join(digest))
}

#[cfg(target_os = "windows")]
pub fn delete_windows_app_user_data_dir(codex_home: &Path) -> Result<(), String> {
    let app_user_data_dir = get_windows_app_user_data_dir(codex_home)?;
    modules::instance::delete_instance_directory(&app_user_data_dir)
}

#[cfg(unix)]
fn create_directory_symlink(source: &Path, target: &Path) -> Result<(), String> {
    std::os::unix::fs::symlink(source, target).map_err(|e| format!("创建目录共享链接失败: {}", e))
}

#[cfg(windows)]
fn create_directory_symlink(source: &Path, target: &Path) -> Result<(), String> {
    create_directory_junction(source, target).or_else(|junction_error| {
        std::os::windows::fs::symlink_dir(source, target).map_err(|symlink_error| {
            format!(
                "创建目录共享链接失败: junction 失败: {}; symlink 失败: {}",
                junction_error, symlink_error
            )
        })
    })
}

#[cfg(windows)]
fn create_directory_junction(source: &Path, target: &Path) -> Result<(), String> {
    let output = std::process::Command::new("cmd")
        .arg("/C")
        .arg("mklink")
        .arg("/J")
        .arg(target)
        .arg(source)
        .output()
        .map_err(|e| format!("执行 mklink /J 失败: {}", e))?;

    if output.status.success() {
        return Ok(());
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Err(format!(
        "mklink /J 退出码 {:?}; stdout: {}; stderr: {}",
        output.status.code(),
        stdout,
        stderr
    ))
}

#[cfg(windows)]
fn is_windows_directory_junction(path: &Path) -> bool {
    use std::os::windows::fs::MetadataExt;

    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
    fs::symlink_metadata(path)
        .map(|metadata| {
            metadata.is_dir()
                && metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
                && !metadata.file_type().is_symlink()
        })
        .unwrap_or(false)
}

#[cfg(not(windows))]
fn is_windows_directory_junction(_path: &Path) -> bool {
    false
}

#[cfg(not(any(unix, windows)))]
fn create_directory_symlink(_source: &Path, _target: &Path) -> Result<(), String> {
    Err("当前系统不支持创建目录符号链接".to_string())
}

#[cfg(unix)]
fn create_file_symlink(source: &Path, target: &Path) -> Result<(), String> {
    std::os::unix::fs::symlink(source, target).map_err(|e| format!("创建文件共享链接失败: {}", e))
}

#[cfg(windows)]
fn create_file_symlink(source: &Path, target: &Path) -> Result<(), String> {
    std::os::windows::fs::symlink_file(source, target).or_else(|symlink_error| {
        fs::hard_link(source, target)
            .or_else(|hard_link_error| {
                fs::copy(source, target).map(|_| ()).map_err(|copy_error| {
                    format!(
                        "symlink 失败: {}; hard link 失败: {}; copy 失败: {}",
                        symlink_error, hard_link_error, copy_error
                    )
                })
            })
            .map_err(|fallback_error| format!("创建文件共享链接失败: {}", fallback_error))
    })
}

#[cfg(not(any(unix, windows)))]
fn create_file_symlink(_source: &Path, _target: &Path) -> Result<(), String> {
    Err("当前系统不支持创建文件符号链接".to_string())
}

fn remove_symlink(path: &Path) -> Result<(), String> {
    fs::remove_file(path)
        .or_else(|_| fs::remove_dir(path))
        .map_err(|e| format!("移除已有共享链接失败: {}", e))
}

fn create_directory_shared_link_or_copy(source: &Path, target: &Path) -> Result<(), String> {
    create_directory_shared_link_or_copy_with(source, target, create_directory_symlink)
}

fn create_directory_shared_link_or_copy_with<F>(
    source: &Path,
    target: &Path,
    create_link: F,
) -> Result<(), String>
where
    F: FnOnce(&Path, &Path) -> Result<(), String>,
{
    create_link(source, target).or_else(|link_error| {
        tracing::warn!(
            "Falling back to copying Codex shared directory after link creation failed ({} -> {}): {}",
            display_abs_path(source),
            display_abs_path(target),
            link_error
        );
        instance_store::copy_dir_recursive(source, target).map_err(|copy_error| {
            format!(
                "创建目录共享链接失败且复制 fallback 失败: link: {}; copy: {}",
                link_error, copy_error
            )
        })
    })
}

fn is_directory_empty(path: &Path) -> Result<bool, String> {
    let mut iter = fs::read_dir(path).map_err(|e| format!("读取目录失败: {}", e))?;
    Ok(iter.next().is_none())
}

fn files_have_same_content(a: &Path, b: &Path) -> Result<bool, String> {
    let meta_a = fs::metadata(a).map_err(|e| format!("读取文件元数据失败: {}", e))?;
    let meta_b = fs::metadata(b).map_err(|e| format!("读取文件元数据失败: {}", e))?;
    if meta_a.len() != meta_b.len() {
        return Ok(false);
    }
    let bytes_a = fs::read(a).map_err(|e| format!("读取文件失败: {}", e))?;
    let bytes_b = fs::read(b).map_err(|e| format!("读取文件失败: {}", e))?;
    Ok(bytes_a == bytes_b)
}

fn sorted_entries(path: &Path) -> Result<Vec<fs::DirEntry>, String> {
    let mut entries: Vec<fs::DirEntry> = fs::read_dir(path)
        .map_err(|e| format!("读取目录失败: {}", e))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("读取目录项失败: {}", e))?;
    entries.sort_by(|a, b| {
        a.file_name()
            .to_string_lossy()
            .cmp(&b.file_name().to_string_lossy())
    });
    Ok(entries)
}

fn directories_are_equivalent(a: &Path, b: &Path) -> Result<bool, String> {
    let entries_a = sorted_entries(a)?;
    let entries_b = sorted_entries(b)?;
    if entries_a.len() != entries_b.len() {
        return Ok(false);
    }

    for (entry_a, entry_b) in entries_a.into_iter().zip(entries_b.into_iter()) {
        if entry_a.file_name() != entry_b.file_name() {
            return Ok(false);
        }

        let path_a = entry_a.path();
        let path_b = entry_b.path();
        let meta_a =
            fs::symlink_metadata(&path_a).map_err(|e| format!("读取路径元数据失败: {}", e))?;
        let meta_b =
            fs::symlink_metadata(&path_b).map_err(|e| format!("读取路径元数据失败: {}", e))?;
        let type_a = meta_a.file_type();
        let type_b = meta_b.file_type();

        if type_a.is_symlink()
            || type_b.is_symlink()
            || is_windows_directory_junction(&path_a)
            || is_windows_directory_junction(&path_b)
        {
            return Ok(false);
        }

        if type_a.is_dir() && type_b.is_dir() {
            if !directories_are_equivalent(&path_a, &path_b)? {
                return Ok(false);
            }
            continue;
        }

        if type_a.is_file() && type_b.is_file() {
            if !files_have_same_content(&path_a, &path_b)? {
                return Ok(false);
            }
            continue;
        }

        return Ok(false);
    }

    Ok(true)
}

fn paths_point_to_same_location(a: &Path, b: &Path) -> bool {
    match (fs::canonicalize(a), fs::canonicalize(b)) {
        (Ok(left), Ok(right)) => left == right,
        _ => a == b,
    }
}

fn display_abs_path(path: &Path) -> String {
    instance_store::display_path(path)
}

fn resolve_link_target(link_path: &Path, target: PathBuf) -> PathBuf {
    if target.is_absolute() {
        target
    } else {
        link_path
            .parent()
            .unwrap_or_else(|| Path::new(""))
            .join(target)
    }
}

fn is_directory_shared_link(metadata: &fs::Metadata, path: &Path) -> bool {
    metadata.file_type().is_symlink() || is_windows_directory_junction(path)
}

fn resolve_directory_shared_link_target(
    link_path: &Path,
    metadata: &fs::Metadata,
) -> Result<PathBuf, String> {
    if metadata.file_type().is_symlink() {
        let current_target = fs::read_link(link_path).map_err(|e| {
            format!(
                "读取实例共享目录链接失败 ({}): {}",
                display_abs_path(link_path),
                e
            )
        })?;
        return Ok(resolve_link_target(link_path, current_target));
    }

    if is_windows_directory_junction(link_path) {
        return fs::canonicalize(link_path).map_err(|e| {
            format!(
                "解析实例共享目录 junction 失败 ({}): {}",
                display_abs_path(link_path),
                e
            )
        });
    }

    Err(format!(
        "实例共享目录不是可识别的链接: {}",
        display_abs_path(link_path)
    ))
}

fn sync_shared_directory(
    profile_dir: &Path,
    default_codex_home: &Path,
    relative_path: &Path,
) -> Result<(), String> {
    let global_dir = default_codex_home.join(relative_path);
    let instance_dir = profile_dir.join(relative_path);
    let relative_display = relative_path.to_string_lossy();

    fs::create_dir_all(&global_dir).map_err(|e| {
        format!(
            "创建全局共享目录失败 ({}): {}",
            display_abs_path(&global_dir),
            e
        )
    })?;
    if let Some(parent) = instance_dir.parent() {
        fs::create_dir_all(parent).map_err(|e| {
            format!(
                "创建实例共享目录父路径失败 ({}): {}",
                display_abs_path(parent),
                e
            )
        })?;
    }

    if !instance_dir.exists() {
        return create_directory_shared_link_or_copy(&global_dir, &instance_dir);
    }

    let metadata = fs::symlink_metadata(&instance_dir).map_err(|e| {
        format!(
            "读取实例共享目录信息失败 ({}): {}",
            display_abs_path(&instance_dir),
            e
        )
    })?;
    if is_directory_shared_link(&metadata, &instance_dir) {
        let resolved_target = resolve_directory_shared_link_target(&instance_dir, &metadata)?;
        if paths_point_to_same_location(&resolved_target, &global_dir) {
            return Ok(());
        }
        remove_symlink(&instance_dir)?;
        return create_directory_shared_link_or_copy(&global_dir, &instance_dir);
    }

    if !metadata.is_dir() {
        return Err(format!(
            "实例共享目录路径不是目录 ({}): {}",
            relative_display,
            display_abs_path(&instance_dir)
        ));
    }

    let instance_empty = is_directory_empty(&instance_dir)?;
    let global_empty = is_directory_empty(&global_dir)?;
    if instance_empty {
        fs::remove_dir(&instance_dir).map_err(|e| {
            format!(
                "清理空实例共享目录失败 ({}): {}",
                display_abs_path(&instance_dir),
                e
            )
        })?;
        return create_directory_shared_link_or_copy(&global_dir, &instance_dir);
    }

    if global_empty {
        fs::remove_dir(&global_dir).map_err(|e| {
            format!(
                "移除空全局共享目录失败 ({}): {}",
                display_abs_path(&global_dir),
                e
            )
        })?;
        instance_store::copy_dir_recursive(&instance_dir, &global_dir).map_err(|e| {
            format!(
                "迁移实例共享目录到全局失败 ({}): {}",
                display_abs_path(&instance_dir),
                e
            )
        })?;
        fs::remove_dir_all(&instance_dir).map_err(|e| {
            format!(
                "清理实例共享目录失败 ({}): {}",
                display_abs_path(&instance_dir),
                e
            )
        })?;
        return create_directory_shared_link_or_copy(&global_dir, &instance_dir);
    }

    if directories_are_equivalent(&instance_dir, &global_dir)? {
        fs::remove_dir_all(&instance_dir).map_err(|e| {
            format!(
                "清理实例共享目录失败 ({}): {}",
                display_abs_path(&instance_dir),
                e
            )
        })?;
        return create_directory_shared_link_or_copy(&global_dir, &instance_dir);
    }

    fs::remove_dir_all(&instance_dir).map_err(|e| {
        format!(
            "强制重建实例共享目录链接前清理实例目录失败 ({}): {}",
            display_abs_path(&instance_dir),
            e
        )
    })?;
    create_directory_shared_link_or_copy(&global_dir, &instance_dir).map_err(|e| {
        format!(
            "强制重建实例共享目录链接失败 ({} -> {}, {}): {}",
            display_abs_path(&global_dir),
            display_abs_path(&instance_dir),
            relative_display,
            e
        )
    })
}

fn sync_shared_file(
    profile_dir: &Path,
    default_codex_home: &Path,
    relative_path: &Path,
) -> Result<(), String> {
    let global_file = default_codex_home.join(relative_path);
    let instance_file = profile_dir.join(relative_path);
    let relative_display = relative_path.to_string_lossy();

    if let Some(parent) = global_file.parent() {
        fs::create_dir_all(parent).map_err(|e| {
            format!(
                "创建全局共享文件父目录失败 ({}): {}",
                display_abs_path(parent),
                e
            )
        })?;
    }
    if let Some(parent) = instance_file.parent() {
        fs::create_dir_all(parent).map_err(|e| {
            format!(
                "创建实例共享文件父目录失败 ({}): {}",
                display_abs_path(parent),
                e
            )
        })?;
    }

    if !global_file.exists() {
        if instance_file.exists() {
            let meta = fs::symlink_metadata(&instance_file).map_err(|e| {
                format!(
                    "读取实例共享文件信息失败 ({}): {}",
                    display_abs_path(&instance_file),
                    e
                )
            })?;
            if meta.file_type().is_symlink() {
                remove_symlink(&instance_file)?;
            } else if meta.is_file() {
                fs::copy(&instance_file, &global_file).map_err(|e| {
                    format!(
                        "迁移实例共享文件到全局失败 ({} -> {}): {}",
                        display_abs_path(&instance_file),
                        display_abs_path(&global_file),
                        e
                    )
                })?;
                fs::remove_file(&instance_file).map_err(|e| {
                    format!(
                        "清理实例共享文件失败 ({}): {}",
                        display_abs_path(&instance_file),
                        e
                    )
                })?;
            } else {
                return Err(format!(
                    "实例共享文件路径不是文件 ({}): {}",
                    relative_display,
                    display_abs_path(&instance_file)
                ));
            }
        } else {
            return Ok(());
        }
    }

    let global_meta = fs::metadata(&global_file).map_err(|e| {
        format!(
            "读取全局共享文件信息失败 ({}): {}",
            display_abs_path(&global_file),
            e
        )
    })?;
    if !global_meta.is_file() {
        return Err(format!(
            "全局共享路径不是文件 ({}): {}",
            relative_display,
            display_abs_path(&global_file)
        ));
    }

    if !instance_file.exists() {
        return create_file_symlink(&global_file, &instance_file);
    }

    let instance_meta = fs::symlink_metadata(&instance_file).map_err(|e| {
        format!(
            "读取实例共享文件信息失败 ({}): {}",
            display_abs_path(&instance_file),
            e
        )
    })?;
    if instance_meta.file_type().is_symlink() {
        let current_target = fs::read_link(&instance_file).map_err(|e| {
            format!(
                "读取实例共享文件链接失败 ({}): {}",
                display_abs_path(&instance_file),
                e
            )
        })?;
        let resolved_target = resolve_link_target(&instance_file, current_target);
        if paths_point_to_same_location(&resolved_target, &global_file) {
            return Ok(());
        }
        remove_symlink(&instance_file)?;
        return create_file_symlink(&global_file, &instance_file);
    }

    if !instance_meta.is_file() {
        return Err(format!(
            "实例共享文件路径不是文件 ({}): {}",
            relative_display,
            display_abs_path(&instance_file)
        ));
    }

    if files_have_same_content(&instance_file, &global_file)? {
        fs::remove_file(&instance_file).map_err(|e| {
            format!(
                "清理实例共享文件失败 ({}): {}",
                display_abs_path(&instance_file),
                e
            )
        })?;
        return create_file_symlink(&global_file, &instance_file);
    }

    fs::remove_file(&instance_file).map_err(|e| {
        format!(
            "强制重建实例共享文件链接前清理实例文件失败 ({}): {}",
            display_abs_path(&instance_file),
            e
        )
    })?;
    create_file_symlink(&global_file, &instance_file).map_err(|e| {
        format!(
            "强制重建实例共享文件链接失败 ({} -> {}, {}): {}",
            display_abs_path(&global_file),
            display_abs_path(&instance_file),
            relative_display,
            e
        )
    })
}

pub fn ensure_instance_shared_skills(profile_dir: &Path) -> Result<(), String> {
    let default_codex_home = get_default_codex_home()?;
    if paths_point_to_same_location(profile_dir, &default_codex_home) {
        return Ok(());
    }
    fs::create_dir_all(profile_dir).map_err(|e| format!("创建实例目录失败: {}", e))?;

    sync_shared_directory(
        profile_dir,
        &default_codex_home,
        Path::new(CODEX_SHARED_SKILLS_DIR_NAME),
    )?;
    sync_shared_directory(
        profile_dir,
        &default_codex_home,
        Path::new(CODEX_SHARED_RULES_DIR_NAME),
    )?;
    sync_shared_directory(
        profile_dir,
        &default_codex_home,
        Path::new(CODEX_SHARED_VENDOR_IMPORTS_SKILLS_DIR),
    )?;
    sync_shared_file(
        profile_dir,
        &default_codex_home,
        Path::new(CODEX_SHARED_AGENTS_FILE_NAME),
    )?;

    Ok(())
}

fn sha256_file(path: &Path) -> Result<(u64, String), String> {
    let mut file = fs::File::open(path).map_err(|e| {
        format!(
            "open inherited memory file failed: {}: {}",
            path.display(),
            e
        )
    })?;
    let mut hasher = Sha256::new();
    let mut total = 0_u64;
    let mut buffer = [0_u8; 64 * 1024];

    loop {
        let read = file.read(&mut buffer).map_err(|e| {
            format!(
                "read inherited memory file failed: {}: {}",
                path.display(),
                e
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

fn remove_existing_memory_target(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    let metadata = fs::symlink_metadata(path).map_err(|e| {
        format!(
            "read memory target metadata failed: {}: {}",
            path.display(),
            e
        )
    })?;
    if metadata.file_type().is_symlink() || metadata.is_file() {
        fs::remove_file(path).map_err(|e| {
            format!(
                "remove memory target file failed: {}: {}",
                path.display(),
                e
            )
        })
    } else if metadata.is_dir() {
        fs::remove_dir_all(path).map_err(|e| {
            format!(
                "remove memory target directory failed: {}: {}",
                path.display(),
                e
            )
        })
    } else {
        Ok(())
    }
}

fn copy_memory_file(source: &Path, target: &Path) -> Result<(u64, String), String> {
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| {
            format!(
                "create inherited memory parent directory failed: {}: {}",
                parent.display(),
                e
            )
        })?;
    }
    remove_existing_memory_target(target)?;
    fs::copy(source, target).map_err(|e| {
        format!(
            "copy inherited memory file failed: {} -> {}: {}",
            source.display(),
            target.display(),
            e
        )
    })?;
    sha256_file(target)
}

fn copy_memory_directory_recursive(source: &Path, target: &Path) -> Result<u64, String> {
    remove_existing_memory_target(target)?;
    fs::create_dir_all(target).map_err(|e| {
        format!(
            "create inherited memory directory failed: {}: {}",
            target.display(),
            e
        )
    })?;

    let mut total = 0_u64;
    for entry in fs::read_dir(source).map_err(|e| {
        format!(
            "read inherited memory directory failed: {}: {}",
            source.display(),
            e
        )
    })? {
        let entry = entry.map_err(|e| {
            format!(
                "read inherited memory directory entry failed: {}: {}",
                source.display(),
                e
            )
        })?;
        let source_path = entry.path();
        let target_path = target.join(entry.file_name());
        let file_type = entry.file_type().map_err(|e| {
            format!(
                "read inherited memory entry type failed: {}: {}",
                source_path.display(),
                e
            )
        })?;

        if file_type.is_dir() {
            total += copy_memory_directory_recursive(&source_path, &target_path)?;
        } else if file_type.is_file() {
            let (bytes, _) = copy_memory_file(&source_path, &target_path)?;
            total += bytes;
        }
    }

    Ok(total)
}

fn memory_entry_missing(relative_path: &str, kind: &str) -> MemoryInheritanceEntry {
    MemoryInheritanceEntry {
        path: relative_path.to_string(),
        kind: kind.to_string(),
        status: "missing".to_string(),
        bytes: 0,
        sha256: None,
        error: None,
    }
}

fn memory_entry_error(relative_path: &str, kind: &str, error: String) -> MemoryInheritanceEntry {
    MemoryInheritanceEntry {
        path: relative_path.to_string(),
        kind: kind.to_string(),
        status: "error".to_string(),
        bytes: 0,
        sha256: None,
        error: Some(error),
    }
}

fn normalize_toml_path_literal(path: &Path) -> String {
    #[cfg(target_os = "windows")]
    {
        format!(r"\\?\{}", path.to_string_lossy().replace('/', "\\"))
    }

    #[cfg(not(target_os = "windows"))]
    {
        path.to_string_lossy().to_string()
    }
}

fn rewrite_inherited_config_paths(doc: &mut Document, source_home: &Path, target_home: &Path) {
    let replacements = [
        (
            source_home.join(".tmp").join("plugins"),
            target_home.join(".tmp").join("plugins"),
        ),
        (
            source_home.join(".tmp").join("bundled-marketplaces"),
            target_home.join(".tmp").join("bundled-marketplaces"),
        ),
        (
            source_home.join("plugins").join("cache"),
            target_home.join("plugins").join("cache"),
        ),
    ];

    for (source, target) in replacements {
        replace_toml_string_paths(
            doc.as_item_mut(),
            &normalize_toml_path_literal(&source),
            &normalize_toml_path_literal(&target),
        );
        replace_toml_string_paths(
            doc.as_item_mut(),
            &source.to_string_lossy(),
            &target.to_string_lossy(),
        );
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

fn normalize_inherited_config_toml(profile_dir: &Path, source_home: &Path) -> Result<(), String> {
    let config_path = profile_dir.join("config.toml");
    if !config_path.exists() {
        return Ok(());
    }

    let content = fs::read_to_string(&config_path).map_err(|e| {
        format!(
            "read inherited config.toml failed: {}: {}",
            config_path.display(),
            e
        )
    })?;
    if content.trim().is_empty() {
        return Ok(());
    }

    let mut doc = content
        .parse::<Document>()
        .map_err(|e| format!("parse inherited config.toml failed: {}", e))?;
    rewrite_inherited_config_paths(&mut doc, source_home, profile_dir);
    let content = doc.to_string();
    modules::atomic_write::write_string_atomic(&config_path, &content)
        .map_err(|e| format!("write inherited config.toml failed: {}", e))
}

fn copy_lightweight_plugin_state_if_missing(profile_dir: &Path, source_home: &Path) {
    for relative_path in CODEX_LIGHTWEIGHT_PLUGIN_STATE_FILES {
        let source = source_home.join(relative_path);
        let target = profile_dir.join(relative_path);
        if !source.exists() || target.exists() {
            continue;
        }
        if let Err(error) = copy_memory_file(&source, &target) {
            modules::logger::log_warn(&format!(
                "[Codex Memory] failed to inherit lightweight plugin state {}: {}",
                relative_path, error
            ));
        }
    }
}

fn sync_inherited_plugin_config_from_source(
    profile_dir: &Path,
    source_home: &Path,
) -> Result<(), String> {
    if paths_point_to_same_location(profile_dir, source_home) {
        return Ok(());
    }

    fs::create_dir_all(profile_dir).map_err(|e| {
        format!(
            "create Codex clone home failed: {}: {}",
            profile_dir.display(),
            e
        )
    })?;
    copy_lightweight_plugin_state_if_missing(profile_dir, source_home);

    let source_config_path = source_home.join("config.toml");
    if !source_config_path.exists() {
        return Ok(());
    }

    let source_content = fs::read_to_string(&source_config_path).map_err(|e| {
        format!(
            "read source config.toml failed: {}: {}",
            source_config_path.display(),
            e
        )
    })?;
    if source_content.trim().is_empty() {
        return Ok(());
    }

    let mut source_doc = source_content
        .parse::<Document>()
        .map_err(|e| format!("parse source config.toml failed: {}", e))?;
    rewrite_inherited_config_paths(&mut source_doc, source_home, profile_dir);

    let target_config_path = profile_dir.join("config.toml");
    let target_content = fs::read_to_string(&target_config_path).unwrap_or_default();
    let mut target_doc = if target_content.trim().is_empty() {
        Document::new()
    } else {
        target_content
            .parse::<Document>()
            .map_err(|e| format!("parse clone config.toml failed: {}", e))?
    };

    for key in CODEX_INHERITED_CONFIG_TABLES {
        if let Some(item) = source_doc.get(key) {
            target_doc[key] = item.clone();
        } else {
            let _ = target_doc.remove(key);
        }
    }
    rewrite_inherited_config_paths(&mut target_doc, source_home, profile_dir);

    let content = target_doc.to_string();
    modules::atomic_write::write_string_atomic(&target_config_path, &content)
        .map_err(|e| format!("write clone config.toml failed: {}", e))
}

pub fn sync_inherited_plugin_config(profile_dir: &Path) -> Result<(), String> {
    let source_home = get_default_codex_home()?;
    sync_inherited_plugin_config_from_source(profile_dir, &source_home)
}

pub fn inherit_local_memory_artifacts(profile_dir: &Path) -> Result<(), String> {
    let source_home = get_default_codex_home()?;
    if paths_point_to_same_location(profile_dir, &source_home) {
        return Ok(());
    }

    fs::create_dir_all(profile_dir).map_err(|e| {
        format!(
            "create Codex clone home failed: {}: {}",
            profile_dir.display(),
            e
        )
    })?;

    let mut entries = Vec::new();

    for relative_path in CODEX_MEMORY_DIRECTORIES {
        let source = source_home.join(relative_path);
        let target = profile_dir.join(relative_path);
        if !source.exists() {
            entries.push(memory_entry_missing(relative_path, "directory"));
            continue;
        }
        match copy_memory_directory_recursive(&source, &target) {
            Ok(bytes) => entries.push(MemoryInheritanceEntry {
                path: relative_path.to_string(),
                kind: "directory".to_string(),
                status: "copied".to_string(),
                bytes,
                sha256: None,
                error: None,
            }),
            Err(error) => {
                modules::logger::log_warn(&format!(
                    "[Codex Memory] failed to inherit directory {}: {}",
                    relative_path, error
                ));
                entries.push(memory_entry_error(relative_path, "directory", error));
            }
        }
    }

    for relative_path in CODEX_MEMORY_FILES {
        let source = source_home.join(relative_path);
        let target = profile_dir.join(relative_path);
        if !source.exists() {
            entries.push(memory_entry_missing(relative_path, "file"));
            continue;
        }
        match copy_memory_file(&source, &target) {
            Ok((bytes, sha256)) => entries.push(MemoryInheritanceEntry {
                path: relative_path.to_string(),
                kind: "file".to_string(),
                status: "copied".to_string(),
                bytes,
                sha256: Some(sha256),
                error: None,
            }),
            Err(error) => {
                modules::logger::log_warn(&format!(
                    "[Codex Memory] failed to inherit file {}: {}",
                    relative_path, error
                ));
                entries.push(memory_entry_error(relative_path, "file", error));
            }
        }
    }

    ensure_instance_shared_skills(profile_dir)?;
    normalize_inherited_config_toml(profile_dir, &source_home)?;
    for relative_path in CODEX_SHARED_MEMORY_ITEMS {
        let target = profile_dir.join(relative_path);
        entries.push(MemoryInheritanceEntry {
            path: relative_path.to_string(),
            kind: "shared".to_string(),
            status: if target.exists() {
                "available".to_string()
            } else {
                "missing".to_string()
            },
            bytes: 0,
            sha256: None,
            error: None,
        });
    }

    let manifest = MemoryInheritanceManifest {
        version: 1,
        created_at: Utc::now().timestamp_millis(),
        source: source_home.to_string_lossy().to_string(),
        target: profile_dir.to_string_lossy().to_string(),
        entries,
    };
    let manifest_path = profile_dir.join(CODEX_CLONE_MEMORY_MANIFEST_FILE_NAME);
    let content = serde_json::to_string_pretty(&manifest)
        .map_err(|e| format!("serialize memory inheritance manifest failed: {}", e))?;
    modules::atomic_write::write_string_atomic(&manifest_path, &content)
        .map_err(|e| format!("write memory inheritance manifest failed: {}", e))
}

pub fn create_instance(params: CreateInstanceParams) -> Result<InstanceProfile, String> {
    let _lock = CODEX_INSTANCE_STORE_LOCK
        .lock()
        .map_err(|_| "无法获取实例锁")?;
    let mut store = load_instance_store()?;

    let name = instance_store::normalize_name(&params.name)?;
    let user_data_dir = params.user_data_dir.trim().to_string();
    if user_data_dir.is_empty() {
        return Err("实例目录不能为空".to_string());
    }

    instance_store::ensure_unique(&store, &name, &user_data_dir, None)?;

    let user_dir_path = PathBuf::from(&user_data_dir);
    let init_mode = params
        .init_mode
        .as_deref()
        .unwrap_or("copy")
        .to_ascii_lowercase();
    let create_empty = init_mode == "empty";
    let use_existing_dir = init_mode == "existingdir" || init_mode == "existing_dir";

    if use_existing_dir {
        if !user_dir_path.exists() {
            let resolved = instance_store::display_path(&user_dir_path);
            return Err(format!("所选目录不存在: {}", resolved));
        }
        if !user_dir_path.is_dir() {
            return Err("所选路径不是目录".to_string());
        }
    } else if create_empty {
        if user_dir_path.exists() {
            let mut has_entries = false;
            if let Ok(mut iter) = fs::read_dir(&user_dir_path) {
                if iter.next().is_some() {
                    has_entries = true;
                }
            }
            if has_entries {
                let resolved_path = instance_store::display_path(&user_dir_path);
                return Err(format!("空白实例需要目标目录为空: {}", resolved_path));
            }
        }
        fs::create_dir_all(&user_dir_path).map_err(|e| format!("创建实例目录失败: {}", e))?;
    } else {
        let source_dir = match params.copy_source_instance_id.as_deref() {
            Some("__default__") | None => get_default_codex_home()?,
            Some(source_id) => {
                let source_instance = store
                    .instances
                    .iter()
                    .find(|item| item.id == source_id)
                    .ok_or("复制来源实例不存在")?;
                PathBuf::from(&source_instance.user_data_dir)
            }
        };

        if user_dir_path.exists() {
            let mut has_entries = false;
            if let Ok(mut iter) = fs::read_dir(&user_dir_path) {
                if iter.next().is_some() {
                    has_entries = true;
                }
            }
            if has_entries {
                let resolved_path = instance_store::display_path(&user_dir_path);
                modules::logger::log_info(&format!(
                    "[Codex Instance] 复制来源实例需要空目录，但目标已存在: {}",
                    resolved_path
                ));
                return Err(format!("复制来源实例需要目标目录为空: {}", resolved_path));
            }
        }

        if !source_dir.exists() {
            return Err("未找到复制来源目录，请先确保来源实例已初始化".to_string());
        }

        instance_store::copy_dir_recursive(&source_dir, &user_dir_path)?;
    }

    ensure_instance_shared_skills(&user_dir_path)?;

    let instance = InstanceProfile {
        id: Uuid::new_v4().to_string(),
        name,
        user_data_dir,
        working_dir: params.working_dir,
        extra_args: params.extra_args.trim().to_string(),
        bind_account_id: params.bind_account_id,
        launch_mode: params.launch_mode.unwrap_or_default(),
        app_speed: params.app_speed.unwrap_or_default(),
        created_at: Utc::now().timestamp_millis(),
        last_launched_at: None,
        last_pid: None,
    };

    store.instances.push(instance.clone());
    save_instance_store(&store)?;
    Ok(instance)
}

pub fn update_instance(params: UpdateInstanceParams) -> Result<InstanceProfile, String> {
    let _lock = CODEX_INSTANCE_STORE_LOCK
        .lock()
        .map_err(|_| "无法获取实例锁")?;
    let mut store = load_instance_store()?;
    let index = store
        .instances
        .iter()
        .position(|instance| instance.id == params.instance_id)
        .ok_or("实例不存在")?;

    let current_id = store.instances[index].id.clone();
    let current_dir = store.instances[index].user_data_dir.clone();
    let next_name = params
        .name
        .as_ref()
        .map(|name| instance_store::normalize_name(name))
        .transpose()?;

    if let Some(ref normalized) = next_name {
        instance_store::ensure_unique(&store, normalized, &current_dir, Some(&current_id))?;
    }

    let instance = &mut store.instances[index];
    if let Some(normalized) = next_name {
        instance.name = normalized;
    }
    if let Some(ref extra_args) = params.extra_args {
        instance.extra_args = extra_args.trim().to_string();
    }
    if let Some(working_dir) = params.working_dir {
        instance.working_dir = if working_dir.trim().is_empty() {
            None
        } else {
            Some(working_dir.trim().to_string())
        };
    }
    if let Some(bind) = params.bind_account_id.clone() {
        instance.bind_account_id = bind;
    }
    if let Some(mode) = params.launch_mode {
        instance.launch_mode = mode;
    }
    if let Some(speed) = params.app_speed {
        instance.app_speed = speed;
    }

    let updated = instance.clone();
    save_instance_store(&store)?;
    Ok(updated)
}

pub fn update_bound_instances_app_speed(
    account_id: &str,
    speed: CodexAppSpeed,
) -> Result<Vec<InstanceProfile>, String> {
    let target_account_id = account_id.trim();
    if target_account_id.is_empty() {
        return Ok(Vec::new());
    }

    let _lock = CODEX_INSTANCE_STORE_LOCK
        .lock()
        .map_err(|_| "无法获取实例锁")?;
    let mut store = load_instance_store()?;
    let mut changed = false;
    let mut updated_instances = Vec::new();

    for instance in &mut store.instances {
        if instance.bind_account_id.as_deref() != Some(target_account_id) {
            continue;
        }
        if instance.app_speed != speed {
            instance.app_speed = speed.clone();
            changed = true;
        }
        updated_instances.push(instance.clone());
    }

    if changed {
        save_instance_store(&store)?;
    }

    Ok(updated_instances)
}

pub fn delete_instance(instance_id: &str) -> Result<(), String> {
    let _lock = CODEX_INSTANCE_STORE_LOCK
        .lock()
        .map_err(|_| "无法获取实例锁")?;
    let mut store = load_instance_store()?;
    let index = store
        .instances
        .iter()
        .position(|instance| instance.id == instance_id)
        .ok_or("实例不存在")?;
    let user_data_dir = store.instances[index].user_data_dir.clone();

    if !user_data_dir.trim().is_empty() {
        let dir_path = PathBuf::from(&user_data_dir);
        modules::instance::delete_instance_directory(&dir_path)?;
        #[cfg(target_os = "windows")]
        delete_windows_app_user_data_dir(&dir_path)?;
    }

    store.instances.remove(index);
    save_instance_store(&store)?;
    Ok(())
}

pub fn update_instance_after_start(instance_id: &str, pid: u32) -> Result<InstanceProfile, String> {
    let _lock = CODEX_INSTANCE_STORE_LOCK
        .lock()
        .map_err(|_| "无法获取实例锁")?;
    let mut store = load_instance_store()?;
    let mut updated = None;
    for instance in &mut store.instances {
        if instance.id == instance_id {
            instance.last_launched_at = Some(Utc::now().timestamp_millis());
            instance.last_pid = Some(pid);
            updated = Some(instance.clone());
            break;
        }
    }
    let updated = updated.ok_or("实例不存在")?;
    save_instance_store(&store)?;
    Ok(updated)
}

pub fn update_instance_after_cli_prepare(instance_id: &str) -> Result<InstanceProfile, String> {
    let _lock = CODEX_INSTANCE_STORE_LOCK
        .lock()
        .map_err(|_| "无法获取实例锁")?;
    let mut store = load_instance_store()?;
    let mut updated = None;
    for instance in &mut store.instances {
        if instance.id == instance_id {
            instance.last_launched_at = Some(Utc::now().timestamp_millis());
            instance.last_pid = None;
            updated = Some(instance.clone());
            break;
        }
    }
    let updated = updated.ok_or("实例不存在")?;
    save_instance_store(&store)?;
    Ok(updated)
}

pub fn update_instance_pid(instance_id: &str, pid: Option<u32>) -> Result<InstanceProfile, String> {
    let _lock = CODEX_INSTANCE_STORE_LOCK
        .lock()
        .map_err(|_| "无法获取实例锁")?;
    let mut store = load_instance_store()?;
    let mut updated = None;
    for instance in &mut store.instances {
        if instance.id == instance_id {
            instance.last_pid = pid;
            updated = Some(instance.clone());
            break;
        }
    }
    let updated = updated.ok_or("实例不存在")?;
    save_instance_store(&store)?;
    Ok(updated)
}

pub fn update_default_pid(pid: Option<u32>) -> Result<DefaultInstanceSettings, String> {
    let _lock = CODEX_INSTANCE_STORE_LOCK
        .lock()
        .map_err(|_| "无法获取实例锁")?;
    let mut store = load_instance_store()?;
    store.default_settings.last_pid = pid;
    let updated = store.default_settings.clone();
    save_instance_store(&store)?;
    Ok(updated)
}

pub fn clear_all_pids() -> Result<(), String> {
    let _lock = CODEX_INSTANCE_STORE_LOCK
        .lock()
        .map_err(|_| "无法获取实例锁")?;
    let mut store = load_instance_store()?;
    store.default_settings.last_pid = None;
    for instance in &mut store.instances {
        instance.last_pid = None;
    }
    save_instance_store(&store)?;
    Ok(())
}

pub fn replace_bind_account_references(
    old_account_id: &str,
    new_account_id: &str,
) -> Result<(), String> {
    let old_id = old_account_id.trim();
    let new_id = new_account_id.trim();
    if old_id.is_empty() || new_id.is_empty() || old_id == new_id {
        return Ok(());
    }

    let _lock = CODEX_INSTANCE_STORE_LOCK
        .lock()
        .map_err(|_| "无法获取实例锁")?;
    let mut store = load_instance_store()?;
    let mut changed = false;

    if store.default_settings.bind_account_id.as_deref() == Some(old_id) {
        store.default_settings.bind_account_id = Some(new_id.to_string());
        store.default_settings.follow_local_account = false;
        changed = true;
    }

    for instance in &mut store.instances {
        if instance.bind_account_id.as_deref() == Some(old_id) {
            instance.bind_account_id = Some(new_id.to_string());
            changed = true;
        }
    }

    if changed {
        save_instance_store(&store)?;
    }

    Ok(())
}

pub async fn inject_account_to_profile(profile_dir: &Path, account_id: &str) -> Result<(), String> {
    modules::codex_account::prepare_account_for_injection_from_auth_dir(
        account_id,
        Some(profile_dir),
    )
    .await
    .map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

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

    #[test]
    fn directory_shared_link_falls_back_to_copy_when_link_creation_fails() {
        let temp_dir = make_temp_dir("codex-shared-link-copy-fallback-test");
        let source = temp_dir.join("source");
        let nested = source.join("nested");
        let target = temp_dir.join("target");

        fs::create_dir_all(&nested).expect("create source nested dir");
        fs::write(source.join("root.txt"), "root").expect("write root file");
        fs::write(nested.join("child.txt"), "child").expect("write child file");

        create_directory_shared_link_or_copy_with(&source, &target, |_source, _target| {
            Err("simulated link failure".to_string())
        })
        .expect("copy fallback should succeed");

        assert_eq!(
            fs::read_to_string(target.join("root.txt")).expect("read copied root file"),
            "root"
        );
        assert_eq!(
            fs::read_to_string(target.join("nested").join("child.txt"))
                .expect("read copied nested file"),
            "child"
        );

        fs::remove_dir_all(&temp_dir).expect("cleanup temp dir");
    }

    #[test]
    fn inherited_config_rewrites_plugin_sources_to_clone_home() {
        let temp_dir = make_temp_dir("codex-config-path-rewrite-test");
        let source_home = temp_dir.join("source").join(".codex");
        let clone_home = temp_dir.join("clone");
        fs::create_dir_all(&clone_home).expect("create clone home");

        let source_plugins = normalize_toml_path_literal(
            &source_home
                .join(".tmp")
                .join("bundled-marketplaces")
                .join("openai-bundled"),
        );
        let source_cache = normalize_toml_path_literal(
            &source_home
                .join("plugins")
                .join("cache")
                .join("openai-curated"),
        );
        fs::write(
            clone_home.join("config.toml"),
            format!(
                r#"[marketplaces.openai-bundled]
source = '{}'

[marketplaces.openai-curated]
source = '{}'

[plugins."linear@openai-curated"]
enabled = true
"#,
                source_plugins, source_cache
            ),
        )
        .expect("write config");

        normalize_inherited_config_toml(&clone_home, &source_home).expect("normalize config");
        let content = fs::read_to_string(clone_home.join("config.toml")).expect("read config");
        assert!(content.contains("linear@openai-curated"));
        assert!(content.contains(&normalize_toml_path_literal(
            &clone_home
                .join(".tmp")
                .join("bundled-marketplaces")
                .join("openai-bundled")
        )));
        assert!(content.contains(&normalize_toml_path_literal(
            &clone_home
                .join("plugins")
                .join("cache")
                .join("openai-curated")
        )));
        assert!(!content.contains(&source_home.to_string_lossy().to_string()));

        fs::remove_dir_all(&temp_dir).expect("cleanup temp dir");
    }

    #[test]
    fn plugin_config_sync_preserves_clone_provider_config() {
        let temp_dir = make_temp_dir("codex-plugin-config-sync-test");
        let source_home = temp_dir.join("source").join(".codex");
        let clone_home = temp_dir.join("clone");
        fs::create_dir_all(&source_home).expect("create source home");
        fs::create_dir_all(&clone_home).expect("create clone home");

        let source_cache = normalize_toml_path_literal(
            &source_home
                .join("plugins")
                .join("cache")
                .join("openai-curated"),
        );
        fs::write(source_home.join(".credentials.json"), r#"{"plugins":true}"#)
            .expect("write source credentials");
        fs::write(
            source_home.join("config.toml"),
            format!(
                r#"model = "gpt-source"

[marketplaces.openai-curated]
source = '{}'
source_type = "local"

[mcp_servers.github]
type = "stdio"
command = "npx"

[plugins."linear@openai-curated"]
enabled = true
"#,
                source_cache
            ),
        )
        .expect("write source config");
        fs::write(
            clone_home.join("config.toml"),
            r#"model = "gpt-clone"
model_provider = "codex_local_access"

[model_providers.codex_local_access]
name = "Custom API"
base_url = "https://relay.example.com/v1"
wire_api = "responses"
requires_openai_auth = true
experimental_bearer_token = "sk-test"

[plugins."browser-use@openai-bundled"]
enabled = true
"#,
        )
        .expect("write clone config");

        sync_inherited_plugin_config_from_source(&clone_home, &source_home).expect("sync config");
        let content = fs::read_to_string(clone_home.join("config.toml")).expect("read config");

        assert!(content.contains(r#"model = "gpt-clone""#));
        assert!(content.contains(r#"model_provider = "codex_local_access""#));
        assert!(content.contains("[model_providers.codex_local_access]"));
        assert!(content.contains(r#"base_url = "https://relay.example.com/v1""#));
        assert!(content.contains(r#"experimental_bearer_token = "sk-test""#));
        assert!(content.contains("[plugins.\"linear@openai-curated\"]"));
        assert!(content.contains("[mcp_servers.github]"));
        assert!(content.contains(&normalize_toml_path_literal(
            &clone_home
                .join("plugins")
                .join("cache")
                .join("openai-curated")
        )));
        assert!(!content.contains("gpt-source"));
        assert!(!content.contains("[plugins.\"browser-use@openai-bundled\"]"));
        assert!(clone_home.join(".credentials.json").exists());

        fs::remove_dir_all(&temp_dir).expect("cleanup temp dir");
    }
}
