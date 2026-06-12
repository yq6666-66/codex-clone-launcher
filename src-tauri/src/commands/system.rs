use serde::{Deserialize, Serialize};
use std::path::PathBuf;

use crate::modules::{config, logger, process};

#[derive(Debug, Clone, Serialize)]
pub struct GeneralConfig {
    pub codex_app_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogFileView {
    pub name: String,
    pub path: String,
    pub bytes: u64,
    pub modified_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsSnapshot {
    pub log_dir: String,
    pub latest_log_file: Option<String>,
    pub latest_log_tail: String,
    pub log_files: Vec<LogFileView>,
    pub codex_app_path: String,
    pub codex_app_path_exists: bool,
    pub launcher_pid: u32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolDirectoryProbeRequest {
    pub id: String,
    pub executables: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolDirectoryDetection {
    pub id: String,
    pub detected: bool,
    pub executable: Option<String>,
    pub path: Option<String>,
    pub checked: Vec<String>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolDirectoryDetectionReport {
    pub detected_count: usize,
    pub total_count: usize,
    pub path_entry_count: usize,
    pub tools: Vec<ToolDirectoryDetection>,
    pub warnings: Vec<String>,
}

const TOOL_DIRECTORY_PROBE_LIMIT: usize = 128;
const TOOL_DIRECTORY_EXECUTABLE_LIMIT: usize = 12;

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

#[tauri::command]
pub fn detect_tool_directory(
    probes: Vec<ToolDirectoryProbeRequest>,
) -> Result<ToolDirectoryDetectionReport, String> {
    let mut warnings = Vec::new();
    if probes.len() > TOOL_DIRECTORY_PROBE_LIMIT {
        warnings.push(format!(
            "tool probe count {} exceeded limit {}; extra entries were skipped",
            probes.len(),
            TOOL_DIRECTORY_PROBE_LIMIT
        ));
    }

    let path_entries: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|value| {
            std::env::split_paths(&value)
                .filter(|path| !path.as_os_str().is_empty())
                .collect()
        })
        .unwrap_or_default();
    if path_entries.is_empty() {
        warnings.push("PATH is empty; no tools can be detected".to_string());
    }

    let extensions = executable_extensions();
    let mut tools = Vec::new();

    for probe in probes.into_iter().take(TOOL_DIRECTORY_PROBE_LIMIT) {
        let mut tool_warnings = Vec::new();
        let id = probe.id.trim().to_string();
        if !is_valid_tool_id(&id) {
            tool_warnings.push("invalid tool id; skipped PATH lookup".to_string());
            tools.push(ToolDirectoryDetection {
                id: if id.is_empty() {
                    "invalid".to_string()
                } else {
                    id
                },
                detected: false,
                executable: None,
                path: None,
                checked: Vec::new(),
                warnings: tool_warnings,
            });
            continue;
        }

        if probe.executables.len() > TOOL_DIRECTORY_EXECUTABLE_LIMIT {
            tool_warnings.push(format!(
                "executable count {} exceeded limit {}; extra names were skipped",
                probe.executables.len(),
                TOOL_DIRECTORY_EXECUTABLE_LIMIT
            ));
        }

        let mut checked = Vec::new();
        for executable in probe
            .executables
            .into_iter()
            .take(TOOL_DIRECTORY_EXECUTABLE_LIMIT)
        {
            let executable = executable.trim().to_string();
            if !is_valid_executable_name(&executable) {
                tool_warnings.push(format!("invalid executable name skipped: {}", executable));
                continue;
            }
            if !checked.iter().any(|name| name == &executable) {
                checked.push(executable);
            }
        }

        if checked.is_empty() {
            tool_warnings.push("no valid executable names to check".to_string());
        }

        let found = find_executable_in_paths(&checked, &path_entries, &extensions);
        let (detected, executable, path) = match found {
            Some((executable, path)) => (
                true,
                Some(executable),
                Some(path.to_string_lossy().to_string()),
            ),
            None => (false, None, None),
        };

        tools.push(ToolDirectoryDetection {
            id,
            detected,
            executable,
            path,
            checked,
            warnings: tool_warnings,
        });
    }

    Ok(ToolDirectoryDetectionReport {
        detected_count: tools.iter().filter(|tool| tool.detected).count(),
        total_count: tools.len(),
        path_entry_count: path_entries.len(),
        tools,
        warnings,
    })
}

#[tauri::command]
pub fn get_diagnostics_snapshot(line_limit: Option<usize>) -> Result<DiagnosticsSnapshot, String> {
    let current = config::get_user_config();
    let log_dir = logger::get_log_dir()?;
    let log_files = logger::list_managed_log_files()?;
    let latest_log_file = logger::get_latest_app_log_file().ok();
    let latest_log_tail = match latest_log_file.as_deref() {
        Some(path) => logger::read_log_tail_lines(path, logger::clamp_log_tail_lines(line_limit))?,
        None => String::new(),
    };

    Ok(DiagnosticsSnapshot {
        log_dir: log_dir.to_string_lossy().to_string(),
        latest_log_file: latest_log_file
            .as_ref()
            .map(|path| path.to_string_lossy().to_string()),
        latest_log_tail,
        log_files: log_files
            .into_iter()
            .map(log_file_view)
            .collect::<Result<Vec<_>, String>>()?,
        codex_app_path_exists: !current.codex_app_path.trim().is_empty()
            && PathBuf::from(&current.codex_app_path).exists(),
        codex_app_path: current.codex_app_path,
        launcher_pid: std::process::id(),
    })
}

fn log_file_view(path: PathBuf) -> Result<LogFileView, String> {
    let metadata = std::fs::metadata(&path)
        .map_err(|error| format!("read log metadata failed ({}): {}", path.display(), error))?;
    let modified_at = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis().min(i64::MAX as u128) as i64);
    Ok(LogFileView {
        name: path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("log")
            .to_string(),
        path: path.to_string_lossy().to_string(),
        bytes: metadata.len(),
        modified_at,
    })
}

fn is_valid_tool_id(value: &str) -> bool {
    is_valid_ascii_name(value, 80)
}

fn is_valid_executable_name(value: &str) -> bool {
    is_valid_ascii_name(value, 64)
}

fn is_valid_ascii_name(value: &str, max_len: usize) -> bool {
    if value.is_empty()
        || value.len() > max_len
        || value == "."
        || value == ".."
        || value.contains("..")
        || value.contains('/')
        || value.contains('\\')
        || value.contains(':')
    {
        return false;
    }

    value
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-' | '.'))
}

fn find_executable_in_paths(
    executables: &[String],
    path_entries: &[PathBuf],
    extensions: &[String],
) -> Option<(String, PathBuf)> {
    for executable in executables {
        for candidate_name in executable_candidate_names(executable, extensions) {
            for path_entry in path_entries {
                let candidate = path_entry.join(&candidate_name);
                if std::fs::metadata(&candidate)
                    .map(|metadata| metadata.is_file())
                    .unwrap_or(false)
                {
                    return Some((executable.clone(), candidate));
                }
            }
        }
    }
    None
}

fn executable_candidate_names(executable: &str, extensions: &[String]) -> Vec<String> {
    if PathBuf::from(executable).extension().is_some() {
        return vec![executable.to_string()];
    }

    let mut names = vec![executable.to_string()];
    for extension in extensions {
        names.push(format!("{}{}", executable, extension));
    }
    names
}

#[cfg(windows)]
fn executable_extensions() -> Vec<String> {
    let mut extensions: Vec<String> = std::env::var("PATHEXT")
        .ok()
        .map(|value| {
            value
                .split(';')
                .map(str::trim)
                .filter(|extension| {
                    extension.starts_with('.') && is_valid_executable_name(extension)
                })
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();

    if extensions.is_empty() {
        extensions = [".COM", ".EXE", ".BAT", ".CMD"]
            .into_iter()
            .map(str::to_string)
            .collect();
    }

    extensions.dedup();
    extensions
}

#[cfg(not(windows))]
fn executable_extensions() -> Vec<String> {
    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn invalid_executable_names_are_rejected() {
        assert!(is_valid_executable_name("codex"));
        assert!(is_valid_executable_name("qwen-code"));
        assert!(is_valid_executable_name("codex.exe"));
        assert!(!is_valid_executable_name(""));
        assert!(!is_valid_executable_name(".."));
        assert!(!is_valid_executable_name("../codex"));
        assert!(!is_valid_executable_name("codex\\bin"));
        assert!(!is_valid_executable_name("C:codex"));
        assert!(!is_valid_executable_name("codex shell"));
    }

    #[test]
    fn find_executable_in_paths_detects_file_without_running_it() {
        let dir = temp_probe_dir();
        std::fs::create_dir_all(&dir).expect("create temp dir");
        let file_name = if cfg!(windows) { "codex.EXE" } else { "codex" };
        let executable_path = dir.join(file_name);
        std::fs::write(&executable_path, b"not executed").expect("write fake executable");

        let extensions = if cfg!(windows) {
            vec![".EXE".to_string()]
        } else {
            Vec::new()
        };
        let found = find_executable_in_paths(&["codex".to_string()], &[dir.clone()], &extensions)
            .expect("detect fake executable");

        assert_eq!(found.0, "codex");
        assert_eq!(found.1, executable_path);

        std::fs::remove_dir_all(dir).ok();
    }

    fn temp_probe_dir() -> PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        std::env::temp_dir().join(format!(
            "codex-clone-launcher-tool-probe-{}-{}",
            std::process::id(),
            stamp
        ))
    }
}
