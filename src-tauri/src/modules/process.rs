use crate::modules::config;
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::thread;
use std::time::{Duration, Instant};
use sysinfo::{Pid, ProcessRefreshKind, System, UpdateKind};

#[cfg(target_os = "macos")]
const CODEX_APP_PATH: &str = "/Applications/Codex.app/Contents/MacOS/Codex";

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
#[cfg(target_os = "windows")]
const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;

fn command_trace_enabled() -> bool {
    std::env::var("CODEX_CLONE_COMMAND_TRACE")
        .ok()
        .map(|value| {
            matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes"
            )
        })
        .unwrap_or(false)
}

pub fn summarize_text_for_process_log(text: &str, max_chars: usize) -> String {
    let mut output = String::new();
    for (index, ch) in text.chars().enumerate() {
        if index >= max_chars {
            output.push_str("...");
            return output;
        }
        output.push(ch);
    }
    output
}

fn quote_command_part(part: &str) -> String {
    if part.is_empty() {
        return "\"\"".to_string();
    }
    if part
        .chars()
        .any(|ch| ch.is_whitespace() || matches!(ch, '"' | '\'' | '$' | '`' | '|' | '&' | ';'))
    {
        format!("{:?}", part)
    } else {
        part.to_string()
    }
}

fn format_command_preview(command: &Command) -> String {
    let program = quote_command_part(command.get_program().to_string_lossy().as_ref());
    let args = command
        .get_args()
        .map(|arg| quote_command_part(arg.to_string_lossy().as_ref()))
        .collect::<Vec<_>>();
    if args.is_empty() {
        program
    } else {
        format!("{} {}", program, args.join(" "))
    }
}

fn spawn_command_with_trace(command: &mut Command) -> std::io::Result<Child> {
    let preview = format_command_preview(command);
    if command_trace_enabled() {
        crate::modules::logger::log_info(&format!("[CmdTrace] EXEC {}", preview));
    }
    let start = Instant::now();
    let result = command.spawn();
    if command_trace_enabled() {
        match &result {
            Ok(child) => crate::modules::logger::log_info(&format!(
                "[CmdTrace] SPAWN elapsed={}ms pid={} cmd={}",
                start.elapsed().as_millis(),
                child.id(),
                preview
            )),
            Err(error) => crate::modules::logger::log_warn(&format!(
                "[CmdTrace] SPAWN_ERROR elapsed={}ms cmd={} err={}",
                start.elapsed().as_millis(),
                preview,
                error
            )),
        }
    }
    result
}

fn apply_managed_proxy_env_to_command(command: &mut Command) {
    let cfg = config::get_user_config();
    if !cfg.global_proxy_enabled {
        return;
    }
    let proxy_url = cfg.global_proxy_url.trim();
    if proxy_url.is_empty() {
        return;
    }
    for key in [
        "http_proxy",
        "https_proxy",
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "all_proxy",
        "ALL_PROXY",
    ] {
        command.env(key, proxy_url);
    }
    let no_proxy =
        crate::modules::codex_protocol::merge_local_no_proxy(cfg.global_proxy_no_proxy.trim());
    if !no_proxy.is_empty() {
        command.env("no_proxy", &no_proxy);
        command.env("NO_PROXY", &no_proxy);
    }
}

fn normalize_custom_path(raw: Option<&str>) -> Option<PathBuf> {
    let value = raw?.trim().trim_matches('"').trim_matches('\'').trim();
    if value.is_empty() {
        return None;
    }
    let path = PathBuf::from(value);
    if path.is_file() {
        Some(path)
    } else {
        None
    }
}

pub fn validate_codex_desktop_app_path(path: &str) -> Result<PathBuf, String> {
    let normalized = normalize_custom_path(Some(path))
        .ok_or_else(|| "Codex 启动路径必须指向一个存在的文件".to_string())?;
    let file_name = normalized
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default();
    if !file_name.eq_ignore_ascii_case("Codex.exe") && !file_name.eq_ignore_ascii_case("Codex") {
        return Err("Codex 启动路径必须指向 Codex.exe".to_string());
    }
    #[cfg(target_os = "windows")]
    if normalized
        .to_string_lossy()
        .replace('/', "\\")
        .to_ascii_lowercase()
        .ends_with("\\resources\\codex.exe")
    {
        return Err("请选择桌面端 Codex.exe，不要选择 resources\\codex.exe CLI".to_string());
    }
    Ok(normalized)
}

#[cfg(target_os = "windows")]
fn is_protected_or_cli_codex_path(path: &Path) -> bool {
    let normalized = path
        .to_string_lossy()
        .replace('/', "\\")
        .to_ascii_lowercase();
    normalized.contains("\\program files\\windowsapps\\")
        || normalized.ends_with("\\resources\\codex.exe")
}

#[cfg(target_os = "windows")]
fn save_detected_codex_launch_path(path: &Path) {
    let normalized = path.to_string_lossy().to_string();
    let mut config = config::get_user_config();
    if config.codex_app_path.trim() == normalized {
        return;
    }
    config.codex_app_path = normalized;
    if let Err(error) = config::save_user_config(&config) {
        crate::modules::logger::log_warn(&format!(
            "[Codex Start] failed to save detected launch path: {}",
            error
        ));
    }
}

#[cfg(target_os = "windows")]
fn normalize_windows_candidate_path(raw: &str) -> Option<PathBuf> {
    let mut value = raw.trim().trim_matches('"').trim_matches('\'').to_string();
    if let Some(index) = value.to_ascii_lowercase().find(".exe") {
        value.truncate(index + 4);
    }
    let path = PathBuf::from(value.trim());
    if path.is_file() {
        Some(path)
    } else {
        None
    }
}

#[cfg(target_os = "windows")]
fn powershell_output(script: &str) -> std::io::Result<std::process::Output> {
    use std::os::windows::process::CommandExt;
    Command::new("powershell")
        .creation_flags(CREATE_NO_WINDOW)
        .args([
            "-WindowStyle",
            "Hidden",
            "-NonInteractive",
            "-NoProfile",
            "-Command",
            script,
        ])
        .output()
}

#[cfg(target_os = "windows")]
fn compare_windows_store_version(left: &[u32], right: &[u32]) -> std::cmp::Ordering {
    let max_len = left.len().max(right.len());
    for index in 0..max_len {
        let l = left.get(index).copied().unwrap_or(0);
        let r = right.get(index).copied().unwrap_or(0);
        match l.cmp(&r) {
            std::cmp::Ordering::Equal => {}
            other => return other,
        }
    }
    std::cmp::Ordering::Equal
}

#[cfg(target_os = "windows")]
fn parse_codex_store_version_from_dir_name(dir_name: &str) -> Option<Vec<u32>> {
    let lower = dir_name.to_ascii_lowercase();
    if !lower.starts_with("openai.codex_") {
        return None;
    }
    let version_part = dir_name
        .strip_prefix("OpenAI.Codex_")
        .or_else(|| dir_name.strip_prefix("openai.codex_"))?
        .split('_')
        .next()?;
    let parts = version_part
        .split('.')
        .map(str::parse::<u32>)
        .collect::<Result<Vec<_>, _>>()
        .ok()?;
    (!parts.is_empty()).then_some(parts)
}

#[cfg(target_os = "windows")]
fn detect_codex_exec_path_by_windowsapps_scan() -> Option<PathBuf> {
    let program_files =
        std::env::var("ProgramFiles").unwrap_or_else(|_| "C:\\Program Files".into());
    let roots = [
        PathBuf::from(&program_files).join("WindowsApps"),
        PathBuf::from("C:\\Program Files\\WindowsApps"),
    ];
    let mut best: Option<(PathBuf, Vec<u32>)> = None;
    for root in roots {
        let Ok(entries) = std::fs::read_dir(root) else {
            continue;
        };
        for entry in entries.flatten() {
            let dir_name = entry.file_name().to_string_lossy().to_string();
            let Some(version) = parse_codex_store_version_from_dir_name(&dir_name) else {
                continue;
            };
            let candidate = entry.path().join("app").join("Codex.exe");
            if !candidate.is_file() {
                continue;
            }
            let replace = best
                .as_ref()
                .map(|(_, current)| compare_windows_store_version(&version, current).is_gt())
                .unwrap_or(true);
            if replace {
                best = Some((candidate, version));
            }
        }
    }
    best.map(|(path, _)| path)
}

#[cfg(target_os = "windows")]
fn detect_codex_exec_path_by_appx_install_location() -> Option<PathBuf> {
    let script = r#"
$pkg = Get-AppxPackage -Name OpenAI.Codex -ErrorAction SilentlyContinue |
  Sort-Object Version -Descending |
  Select-Object -First 1
if ($pkg -and $pkg.InstallLocation) {
  $candidate = Join-Path $pkg.InstallLocation 'app\Codex.exe'
  if (Test-Path -LiteralPath $candidate) { Write-Output $candidate }
}
"#;
    let output = powershell_output(script).ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .find_map(normalize_windows_candidate_path)
}

#[cfg(target_os = "windows")]
fn codex_program_data_exe_path() -> PathBuf {
    PathBuf::from("C:\\ProgramData\\Codex\\CodexApp\\Codex.exe")
}

#[cfg(target_os = "windows")]
fn detect_codex_exec_path() -> Option<PathBuf> {
    let program_data = codex_program_data_exe_path();
    if program_data.is_file() {
        return Some(program_data);
    }
    detect_codex_exec_path_by_windowsapps_scan()
        .or_else(detect_codex_exec_path_by_appx_install_location)
}

#[cfg(target_os = "macos")]
fn detect_codex_exec_path() -> Option<PathBuf> {
    let path = PathBuf::from(CODEX_APP_PATH);
    path.is_file().then_some(path)
}

#[cfg(target_os = "linux")]
fn detect_codex_exec_path() -> Option<PathBuf> {
    for candidate in ["codex", "/usr/bin/codex", "/usr/local/bin/codex"] {
        let path = PathBuf::from(candidate);
        if path.is_file() || candidate == "codex" {
            return Some(path);
        }
    }
    None
}

#[allow(dead_code)]
fn resolve_codex_launch_path() -> Result<PathBuf, String> {
    if let Some(custom) = normalize_custom_path(Some(&config::get_user_config().codex_app_path)) {
        #[cfg(target_os = "windows")]
        if is_protected_or_cli_codex_path(&custom) {
            return detect_codex_exec_path().ok_or_else(|| {
                "Codex desktop executable was not found. Expected C:\\ProgramData\\Codex\\CodexApp\\Codex.exe"
                    .to_string()
            });
        }
        return Ok(custom);
    }
    detect_codex_exec_path()
        .ok_or_else(|| "未找到 Codex 可执行文件，请在设置中配置 Codex 启动路径".to_string())
}

fn resolve_codex_desktop_launch_path() -> Result<PathBuf, String> {
    if let Some(custom) = normalize_custom_path(Some(&config::get_user_config().codex_app_path)) {
        #[cfg(target_os = "windows")]
        {
            if !is_protected_or_cli_codex_path(&custom) {
                return Ok(custom);
            }
            let detected = detect_codex_exec_path().ok_or_else(|| {
                "Codex executable was not found. Configure the Codex launch path in settings."
                    .to_string()
            })?;
            if is_protected_or_cli_codex_path(&custom) {
                save_detected_codex_launch_path(&detected);
                return Ok(detected);
            }
        }
        #[cfg(not(target_os = "windows"))]
        return Ok(custom);
    }

    let detected = detect_codex_exec_path().ok_or_else(|| {
        "Codex executable was not found. Configure the Codex launch path in settings.".to_string()
    })?;

    #[cfg(target_os = "windows")]
    save_detected_codex_launch_path(&detected);

    Ok(detected)
}

pub fn codex_desktop_launch_path_diagnostics() -> (Option<String>, String) {
    let configured = normalize_custom_path(Some(&config::get_user_config().codex_app_path));
    if let Some(custom) = configured {
        #[cfg(target_os = "windows")]
        if is_protected_or_cli_codex_path(&custom) {
            return match detect_codex_exec_path() {
                Some(detected) => (
                    Some(detected.to_string_lossy().to_string()),
                    "detected-from-protected-config".to_string(),
                ),
                None => (None, "protected-config-detection-failed".to_string()),
            };
        }
        return (
            Some(custom.to_string_lossy().to_string()),
            "configured".to_string(),
        );
    }
    match detect_codex_exec_path() {
        Some(detected) => (
            Some(detected.to_string_lossy().to_string()),
            "detected".to_string(),
        ),
        None => (None, "missing".to_string()),
    }
}

pub fn ensure_codex_launch_path_configured() -> Result<(), String> {
    resolve_codex_desktop_launch_path().map(|_| ())
}

pub fn detect_and_save_app_path(app: &str, force: bool) -> Option<String> {
    if app != "codex" {
        return None;
    }
    let current = config::get_user_config();
    if !force && !current.codex_app_path.trim().is_empty() {
        return Some(current.codex_app_path);
    }
    let detected = detect_codex_exec_path()?;
    let normalized = detected.to_string_lossy().to_string();
    let mut next = current;
    next.codex_app_path = normalized.clone();
    let _ = config::save_user_config(&next);
    Some(normalized)
}

pub fn parse_extra_args(raw: &str) -> Vec<String> {
    let mut args = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;
    let mut quote_char = '\0';
    let mut escape = false;

    for ch in raw.chars() {
        if escape {
            current.push(ch);
            escape = false;
            continue;
        }
        match ch {
            '\\' => escape = true,
            '"' | '\'' if in_quotes && ch == quote_char => in_quotes = false,
            '"' | '\'' if !in_quotes => {
                in_quotes = true;
                quote_char = ch;
            }
            ch if ch.is_whitespace() && !in_quotes => {
                if !current.is_empty() {
                    args.push(current.clone());
                    current.clear();
                }
            }
            _ => current.push(ch),
        }
    }
    if !current.is_empty() {
        args.push(current);
    }
    args
}

fn normalize_path_for_compare(path: &str) -> String {
    let mut value = path.trim().trim_matches('"').replace('/', "\\");
    if value.starts_with("\\\\?\\") {
        value = value.trim_start_matches("\\\\?\\").to_string();
    }
    value.to_ascii_lowercase()
}

#[cfg(target_os = "windows")]
fn get_default_codex_windows_app_user_data_dir() -> Option<String> {
    std::env::var("APPDATA").ok().map(|value| {
        PathBuf::from(value)
            .join("Codex")
            .to_string_lossy()
            .to_string()
    })
}

#[cfg(target_os = "windows")]
fn get_managed_codex_windows_app_user_data_dir(codex_home: &str) -> Option<String> {
    crate::modules::codex_instance::get_windows_app_user_data_dir(Path::new(codex_home))
        .ok()
        .map(|path| path.to_string_lossy().to_string())
}

#[cfg(target_os = "windows")]
fn resolve_codex_windows_target(codex_home: Option<&str>) -> Option<String> {
    codex_home
        .and_then(get_managed_codex_windows_app_user_data_dir)
        .or_else(get_default_codex_windows_app_user_data_dir)
}

pub fn is_pid_running(pid: u32) -> bool {
    let mut system = System::new();
    system.refresh_processes_specifics(
        sysinfo::ProcessesToUpdate::Some(&[Pid::from_u32(pid)]),
        true,
        ProcessRefreshKind::nothing().with_exe(UpdateKind::OnlyIfNotSet),
    );
    system.process(Pid::from_u32(pid)).is_some()
}

#[cfg(target_os = "windows")]
fn first_regex_capture(text: &str, pattern: &str) -> Option<String> {
    let captures = regex::Regex::new(pattern).ok()?.captures(text)?;
    captures
        .iter()
        .skip(1)
        .flatten()
        .map(|value| value.as_str().trim().to_string())
        .find(|value| !value.is_empty())
}

#[cfg(target_os = "windows")]
fn extract_windows_codex_target_from_command_line(command_line: &str) -> Option<String> {
    [
        r#"(?i)(?:^|\s)"CODEX_HOME=([^"]+)""#,
        r#"(?i)(?:^|\s)CODEX_HOME="([^"]+)""#,
        r#"(?i)(?:^|\s)CODEX_HOME=([^\s"]+)"#,
        r#"(?i)(?:^|\s)"CODEX_ELECTRON_USER_DATA_PATH=([^"]+)""#,
        r#"(?i)(?:^|\s)CODEX_ELECTRON_USER_DATA_PATH="([^"]+)""#,
        r#"(?i)(?:^|\s)CODEX_ELECTRON_USER_DATA_PATH=([^\s"]+)"#,
        r#"(?i)(?:^|\s)"ELECTRON_USER_DATA_DIR=([^"]+)""#,
        r#"(?i)(?:^|\s)ELECTRON_USER_DATA_DIR="([^"]+)""#,
        r#"(?i)(?:^|\s)ELECTRON_USER_DATA_DIR=([^\s"]+)"#,
        r#"(?i)(?:^|\s)"--user-data-dir=([^"]+)""#,
        r#"(?i)(?:^|\s)--user-data-dir="([^"]+)""#,
        r#"(?i)(?:^|\s)--user-data-dir=([^\s"]+)"#,
        r#"(?i)(?:^|\s)--user-data-dir\s+"([^"]+)""#,
        r#"(?i)(?:^|\s)--user-data-dir\s+([^\s"]+)"#,
    ]
    .iter()
    .find_map(|pattern| first_regex_capture(command_line, pattern))
}

#[cfg(target_os = "windows")]
fn parse_windows_process_entries(output: &str) -> Vec<(u32, Option<String>)> {
    output
        .lines()
        .filter_map(|line| {
            let mut parts = line.splitn(3, '|');
            let pid = parts.next()?.trim().parse::<u32>().ok()?;
            let parent_pid = parts
                .next()
                .and_then(|value| value.trim().parse::<u32>().ok())
                .unwrap_or(0);
            let command_line = parts.next().unwrap_or_default();
            let target = extract_windows_codex_target_from_command_line(command_line);
            let owner_pid = if target.is_some()
                && parent_pid != 0
                && command_line.to_ascii_lowercase().contains("--type=")
            {
                parent_pid
            } else {
                pid
            };
            Some((owner_pid, target))
        })
        .collect()
}

#[cfg(target_os = "windows")]
pub fn collect_codex_process_entries() -> Vec<(u32, Option<String>)> {
    let script = r#"
Get-CimInstance Win32_Process |
      Where-Object {
        $_.Name -match '^(Codex|codex)\.exe$' -or
        $_.CommandLine -match 'CODEX_HOME' -or
        $_.CommandLine -match 'CODEX_ELECTRON_USER_DATA_PATH' -or
        $_.CommandLine -match 'ELECTRON_USER_DATA_DIR' -or
        $_.CommandLine -match 'codex-app-data' -or
        $_.CommandLine -match '--user-data-dir'
      } |
      ForEach-Object {
        "$($_.ProcessId)|$($_.ParentProcessId)|$($_.CommandLine)"
      }
"#;
    let Ok(output) = powershell_output(script) else {
        return Vec::new();
    };
    parse_windows_process_entries(&String::from_utf8_lossy(&output.stdout))
}

#[cfg(not(target_os = "windows"))]
pub fn collect_codex_process_entries() -> Vec<(u32, Option<String>)> {
    let mut system = System::new_all();
    system.refresh_all();
    system
        .processes()
        .iter()
        .filter_map(|(pid, process)| {
            let cmdline = process
                .cmd()
                .iter()
                .map(|part| part.to_string_lossy())
                .collect::<Vec<_>>()
                .join(" ");
            let exe = process
                .exe()
                .map(|path| path.to_string_lossy().to_string())
                .unwrap_or_default();
            let haystack = format!("{} {}", exe, cmdline).to_ascii_lowercase();
            if !haystack.contains("codex") {
                return None;
            }
            let home = process
                .environ()
                .iter()
                .filter_map(|item| item.to_str())
                .find_map(|item| item.strip_prefix("CODEX_HOME=").map(ToOwned::to_owned));
            Some((pid.as_u32(), home))
        })
        .collect()
}

pub fn resolve_codex_pid_from_entries(
    last_pid: Option<u32>,
    codex_home: Option<&str>,
    entries: &[(u32, Option<String>)],
) -> Option<u32> {
    if let Some(last_pid) = last_pid {
        if entries.iter().any(|(pid, _)| *pid == last_pid) {
            return Some(last_pid);
        }
    }

    let mut targets = Vec::new();
    if let Some(home) = codex_home {
        targets.push(normalize_path_for_compare(home));
    }
    #[cfg(target_os = "windows")]
    if let Some(target) = resolve_codex_windows_target(codex_home) {
        targets.push(normalize_path_for_compare(&target));
    }
    entries.iter().find_map(|(pid, home)| {
        if targets.is_empty() {
            return Some(*pid);
        }
        let home = home.as_ref()?;
        let normalized_home = normalize_path_for_compare(home);
        targets
            .iter()
            .any(|target| *target == normalized_home)
            .then_some(*pid)
    })
}

pub fn resolve_codex_pid(last_pid: Option<u32>, codex_home: Option<&str>) -> Option<u32> {
    let entries = collect_codex_process_entries();
    resolve_codex_pid_from_entries(last_pid, codex_home, &entries)
}

#[cfg(target_os = "windows")]
fn codex_main_window_handle(pid: u32) -> Option<u64> {
    let script = format!(
        r#"
$process = Get-Process -Id {} -ErrorAction SilentlyContinue
if ($process -and $process.MainWindowHandle -and $process.MainWindowHandle -ne 0) {{
  [UInt64]$process.MainWindowHandle
}}
"#,
        pid
    );
    let output = powershell_output(&script).ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .find_map(|line| line.trim().parse::<u64>().ok())
        .filter(|handle| *handle != 0)
}

#[cfg(target_os = "windows")]
pub fn focus_process_main_window(pid: u32) -> bool {
    let script = format!(
        r#"
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Win32WindowFocus {{
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
}}
"@
$process = Get-Process -Id {} -ErrorAction SilentlyContinue
if (-not $process -or -not $process.MainWindowHandle -or $process.MainWindowHandle -eq 0) {{
  exit 2
}}
$handle = [IntPtr]$process.MainWindowHandle
[Win32WindowFocus]::ShowWindow($handle, 9) | Out-Null
if ([Win32WindowFocus]::SetForegroundWindow($handle)) {{
  exit 0
}}
exit 1
"#,
        pid
    );
    powershell_output(&script)
        .map(|output| output.status.success())
        .unwrap_or(false)
}

#[cfg(not(target_os = "windows"))]
pub fn focus_process_main_window(_pid: u32) -> bool {
    false
}

pub fn close_pid(pid: u32, timeout_secs: u64) -> Result<(), String> {
    if !is_pid_running(pid) {
        return Ok(());
    }

    #[cfg(target_os = "windows")]
    {
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T"])
            .output();
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = Command::new("kill").arg(pid.to_string()).output();
    }

    let deadline = Instant::now() + Duration::from_secs(timeout_secs);
    while Instant::now() < deadline {
        if !is_pid_running(pid) {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(200));
    }

    #[cfg(target_os = "windows")]
    let force_result = Command::new("taskkill")
        .args(["/F", "/PID", &pid.to_string(), "/T"])
        .output();

    #[cfg(not(target_os = "windows"))]
    let force_result = Command::new("kill").args(["-9", &pid.to_string()]).output();

    force_result
        .map(|_| ())
        .map_err(|error| format!("关闭 Codex 进程失败: {}", error))
}

#[cfg(target_os = "windows")]
fn codex_extra_args_have_user_data_dir(extra_args: &[String]) -> bool {
    extra_args
        .iter()
        .any(|arg| arg == "--user-data-dir" || arg.starts_with("--user-data-dir="))
}

pub fn start_codex_with_args(
    codex_home: &str,
    extra_args: &[String],
    extra_env: &[(String, String)],
) -> Result<u32, String> {
    let launch_path = resolve_codex_desktop_launch_path()?;
    let codex_home = codex_home.trim();
    if codex_home.is_empty() {
        return Err("CODEX_HOME 不能为空".to_string());
    }

    #[cfg(target_os = "windows")]
    let app_user_data_dir =
        crate::modules::codex_instance::get_windows_app_user_data_dir(Path::new(codex_home))?;

    let mut command = Command::new(&launch_path);
    command.env("CODEX_HOME", codex_home);
    for (key, value) in extra_env {
        if is_allowed_clone_launch_env_key(key) && !value.trim().is_empty() {
            command.env(key, value);
        }
    }
    command.args(extra_args);

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP);
        command.env("CODEX_ELECTRON_USER_DATA_PATH", &app_user_data_dir);
        command.env("ELECTRON_USER_DATA_DIR", &app_user_data_dir);
        if !codex_extra_args_have_user_data_dir(extra_args) {
            command.arg(format!(
                "--user-data-dir={}",
                app_user_data_dir.to_string_lossy()
            ));
        }
    }

    #[cfg(target_os = "macos")]
    {
        command.env("ELECTRON_USER_DATA_DIR", codex_home);
    }

    apply_managed_proxy_env_to_command(&mut command);
    let child = spawn_command_with_trace(&mut command)
        .map_err(|error| format!("启动 Codex 失败: {}", error))?;
    let pid = child.id();
    crate::modules::logger::log_info(&format!(
        "[Codex Start] launch_path={} codex_home={} app_user_data_dir={} pid={}",
        launch_path.to_string_lossy(),
        summarize_text_for_process_log(codex_home, 96),
        {
            #[cfg(target_os = "windows")]
            {
                summarize_text_for_process_log(&app_user_data_dir.to_string_lossy(), 120)
            }
            #[cfg(not(target_os = "windows"))]
            {
                "-".to_string()
            }
        },
        pid
    ));

    let deadline = Instant::now() + Duration::from_secs(30);
    while Instant::now() < deadline {
        if let Some(resolved_pid) = resolve_codex_pid(None, Some(codex_home)) {
            #[cfg(target_os = "windows")]
            {
                let window_deadline = Instant::now() + Duration::from_secs(30);
                while Instant::now() < window_deadline {
                    if codex_main_window_handle(resolved_pid).is_some() {
                        let _ = focus_process_main_window(resolved_pid);
                        return Ok(resolved_pid);
                    }
                    thread::sleep(Duration::from_millis(250));
                }
                crate::modules::logger::log_warn(&format!(
                    "[Codex Start] clone process is running but no visible window handle was detected before timeout: codex_home={} pid={}",
                    summarize_text_for_process_log(codex_home, 120),
                    resolved_pid
                ));
                return Ok(resolved_pid);
            }
            #[cfg(not(target_os = "windows"))]
            return Ok(resolved_pid);
        }
        thread::sleep(Duration::from_millis(250));
    }

    Err(format!(
        "Codex process was spawned but no managed clone window was detected for CODEX_HOME={}. Check that the launch path points to the desktop Codex.exe, not resources\\codex.exe or WindowsApps.",
        summarize_text_for_process_log(codex_home, 120)
    ))
}

fn is_allowed_clone_launch_env_key(key: &str) -> bool {
    matches!(
        key,
        "CODEX_CLONE_LAUNCH_SCRIPT"
            | "CODEX_PLUS_PLUS_LAUNCH_SCRIPT"
            | "CODEX_CLONE_LAUNCH_SCRIPT_MODE"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_extra_args_with_quotes() {
        assert_eq!(
            parse_extra_args(r#"--foo "bar baz" --flag"#),
            vec!["--foo", "bar baz", "--flag"]
        );
    }

    #[test]
    fn clone_launch_env_key_allowlist_is_narrow() {
        assert!(is_allowed_clone_launch_env_key("CODEX_CLONE_LAUNCH_SCRIPT"));
        assert!(is_allowed_clone_launch_env_key(
            "CODEX_PLUS_PLUS_LAUNCH_SCRIPT"
        ));
        assert!(is_allowed_clone_launch_env_key(
            "CODEX_CLONE_LAUNCH_SCRIPT_MODE"
        ));
        assert!(!is_allowed_clone_launch_env_key("CODEX_HOME"));
        assert!(!is_allowed_clone_launch_env_key("PATH"));
        assert!(!is_allowed_clone_launch_env_key("CODEX_UNRELATED"));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windowsapps_version_parser_sorts_numeric_components() {
        let older =
            parse_codex_store_version_from_dir_name("OpenAI.Codex_1.2.9.0_x64__abc").unwrap();
        let newer =
            parse_codex_store_version_from_dir_name("OpenAI.Codex_1.2.10.0_x64__abc").unwrap();
        assert!(compare_windows_store_version(&newer, &older).is_gt());
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_process_parser_extracts_user_data_dir_and_parent_owner() {
        let output = r#"100|0|"C:\ProgramData\Codex\CodexApp\Codex.exe" --user-data-dir=C:\Users\example\.codex_clone_launcher\instances\codex-app-data\abc
101|100|"C:\ProgramData\Codex\CodexApp\Codex.exe" --type=renderer --user-data-dir="C:\Users\example\.codex_clone_launcher\instances\codex-app-data\abc"
102|0|"C:\ProgramData\Codex\CodexApp\Codex.exe" "--user-data-dir=C:\Users\example\AppData\Roaming\Codex Clone"
"#;
        assert_eq!(
            parse_windows_process_entries(output),
            vec![
                (
                    100,
                    Some(
                        r#"C:\Users\example\.codex_clone_launcher\instances\codex-app-data\abc"#
                            .to_string()
                    )
                ),
                (
                    100,
                    Some(
                        r#"C:\Users\example\.codex_clone_launcher\instances\codex-app-data\abc"#
                            .to_string()
                    )
                ),
                (
                    102,
                    Some(r#"C:\Users\example\AppData\Roaming\Codex Clone"#.to_string())
                ),
            ]
        );
    }

    #[test]
    fn resolves_pid_by_matching_home() {
        let entries = vec![
            (1, Some("C:/tmp/one".to_string())),
            (2, Some("C:/tmp/two".to_string())),
        ];
        assert_eq!(
            resolve_codex_pid_from_entries(None, Some("C:/tmp/two"), &entries),
            Some(2)
        );
    }
}
