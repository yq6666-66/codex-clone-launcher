use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::time::Duration;

use serde_json::{json, Value as JsonValue};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "macos")]
const CODEX_APP_SERVER_EXECUTABLE: &str = "/Applications/Codex.app/Contents/Resources/codex";
#[cfg(target_os = "windows")]
const CODEX_PROGRAMDATA_APP_SERVER_EXECUTABLE: &str =
    "C:\\ProgramData\\Codex\\CodexApp\\resources\\codex.exe";
const APP_SERVER_RESPONSE_TIMEOUT: Duration = Duration::from_secs(20);

pub fn rebuild_thread_metadata(codex_home: &Path) -> Result<(), String> {
    let executable = official_app_server_executable()?;
    let mut child = build_app_server_command(&executable, codex_home)
        .spawn()
        .map_err(|error| {
            format!(
                "failed to start official Codex app-server ({} / CODEX_HOME={}): {}",
                executable.display(),
                codex_home.display(),
                error
            )
        })?;

    let stdout = child
        .stdout
        .take()
        .ok_or("failed to read official app-server stdout")?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or("failed to write official app-server stdin")?;
    let (sender, receiver) = mpsc::channel::<String>();
    let reader = std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines().map_while(Result::ok) {
            let _ = sender.send(line);
        }
    });

    let result = (|| {
        send_request(
            &mut stdin,
            json!({
                "method": "initialize",
                "id": 1,
                "params": {
                    "clientInfo": {
                        "name": "codex-clone-launcher",
                        "version": env!("CARGO_PKG_VERSION"),
                    },
                    "capabilities": null,
                },
            }),
        )?;
        wait_for_response(&receiver, 1)?;

        send_request(
            &mut stdin,
            json!({
                "method": "thread/list",
                "id": 2,
                "params": {
                    "cursor": null,
                    "limit": 1,
                    "sortKey": "updated_at",
                    "sortDirection": "desc",
                    "modelProviders": null,
                    "sourceKinds": [],
                    "archived": false,
                },
            }),
        )?;
        wait_for_response(&receiver, 2)?;
        Ok::<(), String>(())
    })();

    finish_child(&mut child);
    let stderr = collect_child_stderr(&mut child);
    let _ = reader.join();
    result.map_err(|error| {
        if stderr.is_empty() {
            error
        } else {
            format!("{}; stderr: {}", error, stderr)
        }
    })
}

fn official_app_server_executable() -> Result<PathBuf, String> {
    #[cfg(target_os = "macos")]
    {
        let executable = PathBuf::from(CODEX_APP_SERVER_EXECUTABLE);
        if executable.exists() {
            return Ok(executable);
        }
        return Err(format!(
            "official Codex app-server executable was not found: {}",
            executable.display()
        ));
    }

    #[cfg(target_os = "windows")]
    {
        let programdata = PathBuf::from(CODEX_PROGRAMDATA_APP_SERVER_EXECUTABLE);
        if programdata.exists() {
            return Ok(programdata);
        }
        if let Some(windowsapps) = find_windowsapps_codex_resource_exe() {
            return Ok(windowsapps);
        }
        return Err(format!(
            "official Codex app-server executable was not found: {} or WindowsApps OpenAI.Codex_*\\app\\resources\\codex.exe",
            programdata.display()
        ));
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        Err(
            "official Codex app-server executable detection is not configured for this platform"
                .to_string(),
        )
    }
}

#[cfg(target_os = "windows")]
fn find_windowsapps_codex_resource_exe() -> Option<PathBuf> {
    find_windowsapps_codex_resource_exe_in(Path::new("C:\\Program Files\\WindowsApps"))
}

#[cfg(target_os = "windows")]
fn find_windowsapps_codex_resource_exe_in(root: &Path) -> Option<PathBuf> {
    let entries = fs::read_dir(root).ok()?;
    let mut candidates: Vec<(Vec<u64>, String, PathBuf)> = entries
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().to_string();
            if !name.starts_with("OpenAI.Codex_") {
                return None;
            }
            let path = entry.path().join("app").join("resources").join("codex.exe");
            path.exists()
                .then(|| (parse_windowsapps_codex_version(&name), name, path))
        })
        .collect();
    candidates.sort();
    candidates.pop().map(|(_, _, path)| path)
}

#[cfg(target_os = "windows")]
fn parse_windowsapps_codex_version(name: &str) -> Vec<u64> {
    name.strip_prefix("OpenAI.Codex_")
        .and_then(|rest| rest.split('_').next())
        .map(|version| {
            version
                .split('.')
                .map(|part| part.parse::<u64>().unwrap_or(0))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

fn build_app_server_command(executable: &Path, codex_home: &Path) -> Command {
    let mut command = Command::new(executable);
    command
        .args(["app-server", "--listen", "stdio://"])
        .env("CODEX_HOME", codex_home)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    command
}

fn send_request(stdin: &mut impl Write, request: JsonValue) -> Result<(), String> {
    let line = serde_json::to_string(&request)
        .map_err(|error| format!("failed to serialize official app-server request: {}", error))?;
    stdin
        .write_all(line.as_bytes())
        .and_then(|_| stdin.write_all(b"\n"))
        .and_then(|_| stdin.flush())
        .map_err(|error| format!("failed to write official app-server request: {}", error))
}

fn wait_for_response(receiver: &mpsc::Receiver<String>, request_id: i64) -> Result<(), String> {
    loop {
        let line = receiver
            .recv_timeout(APP_SERVER_RESPONSE_TIMEOUT)
            .map_err(|_| {
                format!(
                    "timed out waiting for official app-server response (id={})",
                    request_id
                )
            })?;
        let Ok(value) = serde_json::from_str::<JsonValue>(&line) else {
            continue;
        };
        if value.get("id").and_then(JsonValue::as_i64) != Some(request_id) {
            continue;
        }
        if let Some(error) = value.get("error") {
            return Err(format!(
                "official app-server returned an error (id={}): {}",
                request_id, error
            ));
        }
        if value.get("result").is_some() {
            return Ok(());
        }
        return Err(format!(
            "official app-server response is missing result (id={}): {}",
            request_id, value
        ));
    }
}

fn finish_child(child: &mut Child) {
    if matches!(child.try_wait(), Ok(Some(_))) {
        return;
    }
    let _ = child.kill();
    let _ = child.wait();
}

fn collect_child_stderr(child: &mut Child) -> String {
    let Some(mut stderr) = child.stderr.take() else {
        return String::new();
    };
    let mut content = String::new();
    let _ = stderr.read_to_string(&mut content);
    truncate_stderr(&content)
}

fn truncate_stderr(content: &str) -> String {
    let compact = content
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .take(12)
        .collect::<Vec<_>>()
        .join(" | ");
    if compact.len() > 1200 {
        format!("{}...", &compact[..1200])
    } else {
        compact
    }
}

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::*;

    struct TempDir {
        path: PathBuf,
    }

    impl TempDir {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "codex-clone-app-server-test-{}",
                uuid::Uuid::new_v4()
            ));
            fs::create_dir_all(&path).unwrap();
            Self { path }
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    #[test]
    fn windowsapps_detection_picks_openai_codex_resource_exe() {
        let temp = TempDir::new();
        let stale = temp.path.join("OpenAI.Codex_1.0.0.0_x64__abc");
        let middle = temp.path.join("OpenAI.Codex_2.0.0.0_x64__abc");
        let newest = temp.path.join("OpenAI.Codex_10.0.0.0_x64__abc");
        let ignored = temp.path.join("Other.Codex_9.0.0.0_x64__abc");
        fs::create_dir_all(stale.join("app").join("resources")).unwrap();
        fs::create_dir_all(middle.join("app").join("resources")).unwrap();
        fs::create_dir_all(newest.join("app").join("resources")).unwrap();
        fs::create_dir_all(ignored.join("app").join("resources")).unwrap();
        fs::write(stale.join("app").join("resources").join("codex.exe"), b"").unwrap();
        fs::write(middle.join("app").join("resources").join("codex.exe"), b"").unwrap();
        fs::write(newest.join("app").join("resources").join("codex.exe"), b"").unwrap();
        fs::write(ignored.join("app").join("resources").join("codex.exe"), b"").unwrap();

        let found = find_windowsapps_codex_resource_exe_in(&temp.path).unwrap();

        assert_eq!(
            found,
            newest.join("app").join("resources").join("codex.exe")
        );
    }

    #[test]
    fn windowsapps_version_parser_sorts_numeric_components() {
        assert!(
            parse_windowsapps_codex_version("OpenAI.Codex_10.0.0.0_x64__abc")
                > parse_windowsapps_codex_version("OpenAI.Codex_2.0.0.0_x64__abc")
        );
    }
}
