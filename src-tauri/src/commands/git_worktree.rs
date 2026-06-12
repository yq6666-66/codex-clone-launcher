use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use chrono::Utc;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitWorktreeDefaults {
    pub repo_dir: String,
    pub current_branch: String,
    pub remotes: Vec<String>,
    pub base_remote: String,
    pub base_branch: String,
    pub base_ref: String,
    pub suggested_branch: String,
    pub suggested_worktree_dir: String,
    pub dirty: bool,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitWorktreeCreateInput {
    pub repo_dir: String,
    pub base_remote: Option<String>,
    pub base_branch: String,
    pub new_branch: String,
    pub worktree_dir: String,
    pub fetch_before_create: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitWorktreeCreateResult {
    pub repo_dir: String,
    pub base_ref: String,
    pub new_branch: String,
    pub worktree_dir: String,
    pub fetched: bool,
    pub output: String,
    pub warnings: Vec<String>,
}

#[derive(Debug)]
struct GitOutput {
    stdout: String,
    stderr: String,
}

#[cfg(target_os = "windows")]
fn configure_git_command(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(target_os = "windows"))]
fn configure_git_command(_command: &mut Command) {}

fn run_git(repo_dir: &Path, args: &[&str]) -> Result<GitOutput, String> {
    let mut command = Command::new("git");
    command.current_dir(repo_dir).args(args);
    configure_git_command(&mut command);
    let output = command
        .output()
        .map_err(|error| format!("执行 git 失败，请确认 Git 已安装并在 PATH 中: {}", error))?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if output.status.success() {
        return Ok(GitOutput { stdout, stderr });
    }
    Err(format!(
        "git {} 失败，退出码 {:?}: {}{}{}",
        args.join(" "),
        output.status.code(),
        stdout,
        if stdout.is_empty() || stderr.is_empty() {
            ""
        } else {
            " / "
        },
        stderr
    ))
}

fn normalize_existing_dir(raw: &str) -> Result<PathBuf, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        std::env::current_dir().map_err(|error| format!("无法获取当前目录: {}", error))
    } else {
        Ok(PathBuf::from(trimmed))
    }
}

fn resolve_repo_root(raw_repo_dir: &str) -> Result<PathBuf, String> {
    let candidate = normalize_existing_dir(raw_repo_dir)?;
    if !candidate.is_dir() {
        return Err(format!("仓库目录不存在或不是目录: {}", candidate.display()));
    }
    let output = run_git(&candidate, &["rev-parse", "--show-toplevel"])?;
    let root = PathBuf::from(output.stdout.trim());
    if root.is_dir() {
        Ok(root)
    } else {
        Err(format!("Git 返回的仓库根目录不可用: {}", root.display()))
    }
}

fn git_value(repo_dir: &Path, args: &[&str]) -> String {
    run_git(repo_dir, args)
        .map(|output| output.stdout)
        .unwrap_or_default()
}

fn remote_names(repo_dir: &Path) -> Vec<String> {
    git_value(repo_dir, &["remote"])
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(ToString::to_string)
        .collect()
}

fn remote_branch_exists(repo_dir: &Path, remote: &str, branch: &str) -> bool {
    let ref_name = format!("refs/remotes/{remote}/{branch}");
    !git_value(
        repo_dir,
        &["for-each-ref", "--format=%(refname)", &ref_name],
    )
    .is_empty()
}

fn current_branch(repo_dir: &Path) -> String {
    let direct = git_value(repo_dir, &["branch", "--show-current"]);
    if !direct.trim().is_empty() {
        return direct.trim().to_string();
    }
    git_value(repo_dir, &["rev-parse", "--abbrev-ref", "HEAD"])
        .trim()
        .to_string()
}

fn choose_base_remote_and_branch(repo_dir: &Path) -> (String, String, Vec<String>) {
    let remotes = remote_names(repo_dir);
    let mut warnings = Vec::new();
    let remote = if remotes.iter().any(|item| item == "upstream") {
        "upstream".to_string()
    } else if remotes.iter().any(|item| item == "origin") {
        warnings.push(
            "未发现 upstream remote，已退回 origin；创建前请确认 origin 指向主仓库。".to_string(),
        );
        "origin".to_string()
    } else {
        warnings
            .push("未发现 upstream/origin remote；请先给仓库添加远端后再创建工作树。".to_string());
        "upstream".to_string()
    };

    for branch in ["main", "master", "trunk", "develop"] {
        if remote_branch_exists(repo_dir, &remote, branch) {
            return (remote, branch.to_string(), warnings);
        }
    }

    let upstream = git_value(
        repo_dir,
        &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
    );
    if let Some((upstream_remote, upstream_branch)) = upstream.split_once('/') {
        if !upstream_remote.trim().is_empty() && !upstream_branch.trim().is_empty() {
            return (
                upstream_remote.trim().to_string(),
                upstream_branch.trim().to_string(),
                warnings,
            );
        }
    }

    warnings.push(format!(
        "未识别到 {}/main 或 {}/master，默认使用 main；创建前可手动改 base branch。",
        remote, remote
    ));
    (remote, "main".to_string(), warnings)
}

fn sanitize_branch_for_path(branch: &str) -> String {
    let mut slug = String::new();
    let mut previous_separator = false;
    for ch in branch.chars() {
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
        "codex-worktree".to_string()
    } else {
        trimmed
    }
}

fn suggested_branch_name(current: &str) -> String {
    let current = current.trim();
    if current.is_empty() || matches!(current, "main" | "master" | "trunk" | "develop") {
        return format!("codex/worktree-{}", Utc::now().format("%Y%m%d-%H%M"));
    }
    format!("{current}-codex-worktree")
}

fn suggested_worktree_dir(repo_root: &Path, branch: &str) -> PathBuf {
    let repo_name = repo_root
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("repo");
    let leaf = format!("{}-{}", repo_name, sanitize_branch_for_path(branch));
    repo_root
        .parent()
        .map(|parent| parent.join(&leaf))
        .unwrap_or_else(|| repo_root.join(&leaf))
}

fn is_dirty(repo_dir: &Path) -> bool {
    !git_value(repo_dir, &["status", "--porcelain"])
        .trim()
        .is_empty()
}

fn validate_branch_name(repo_dir: &Path, branch: &str) -> Result<String, String> {
    let trimmed = branch.trim();
    if trimmed.is_empty() {
        return Err("新工作树分支名不能为空".to_string());
    }
    let output = run_git(repo_dir, &["check-ref-format", "--branch", trimmed])?;
    Ok(output.stdout.trim().to_string())
}

fn normalize_base_remote(value: Option<&str>) -> String {
    value
        .map(str::trim)
        .filter(|remote| !remote.is_empty())
        .unwrap_or("upstream")
        .to_string()
}

fn normalize_base_branch(value: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err("base branch 不能为空".to_string());
    }
    if trimmed.contains(char::is_whitespace) || trimmed.contains("..") || trimmed.starts_with('-') {
        return Err("base branch 含有不安全字符".to_string());
    }
    Ok(trimmed.trim_start_matches('/').to_string())
}

fn base_ref(remote: &str, branch: &str) -> String {
    if branch.contains('/') && branch.starts_with(remote) {
        branch.to_string()
    } else {
        format!("{remote}/{}", branch.trim_start_matches('/'))
    }
}

fn normalize_worktree_dir(repo_root: &Path, raw: &str) -> Result<PathBuf, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("工作树目录不能为空".to_string());
    }
    let path = PathBuf::from(trimmed);
    let absolute = if path.is_absolute() {
        path
    } else {
        repo_root.parent().unwrap_or(repo_root).join(path)
    };
    if absolute == repo_root {
        return Err("工作树目录不能等于当前仓库根目录".to_string());
    }
    if absolute.exists() {
        if !absolute.is_dir() {
            return Err(format!(
                "工作树目标已存在且不是目录: {}",
                absolute.display()
            ));
        }
        let mut entries = fs::read_dir(&absolute)
            .map_err(|error| format!("读取工作树目标目录失败: {}", error))?;
        if entries.next().is_some() {
            return Err(format!("工作树目标目录必须为空: {}", absolute.display()));
        }
    } else if let Some(parent) = absolute.parent() {
        if !parent.is_dir() {
            return Err(format!("工作树目标父目录不存在: {}", parent.display()));
        }
    }
    Ok(absolute)
}

#[tauri::command]
pub async fn codex_git_worktree_defaults(
    repo_dir: Option<String>,
) -> Result<GitWorktreeDefaults, String> {
    let raw_repo = repo_dir.unwrap_or_default();
    let repo_root = resolve_repo_root(&raw_repo)?;
    let current = current_branch(&repo_root);
    let remotes = remote_names(&repo_root);
    let (remote, branch, mut warnings) = choose_base_remote_and_branch(&repo_root);
    let suggested_branch = suggested_branch_name(&current);
    let suggested_dir = suggested_worktree_dir(&repo_root, &suggested_branch);
    let dirty = is_dirty(&repo_root);
    if dirty {
        warnings.push(
            "当前仓库存在未提交改动；新工作树会从远端基线创建，不会携带这些本地改动。".to_string(),
        );
    }

    Ok(GitWorktreeDefaults {
        repo_dir: repo_root.to_string_lossy().to_string(),
        current_branch: current,
        remotes,
        base_ref: base_ref(&remote, &branch),
        base_remote: remote,
        base_branch: branch,
        suggested_branch,
        suggested_worktree_dir: suggested_dir.to_string_lossy().to_string(),
        dirty,
        warnings,
    })
}

#[tauri::command]
pub async fn codex_create_upstream_worktree(
    input: GitWorktreeCreateInput,
) -> Result<GitWorktreeCreateResult, String> {
    let repo_root = resolve_repo_root(&input.repo_dir)?;
    let remote = normalize_base_remote(input.base_remote.as_deref());
    let branch = normalize_base_branch(&input.base_branch)?;
    let new_branch = validate_branch_name(&repo_root, &input.new_branch)?;
    let worktree_dir = normalize_worktree_dir(&repo_root, &input.worktree_dir)?;
    let target_base_ref = base_ref(&remote, &branch);
    let mut output_lines = Vec::new();
    let mut warnings = Vec::new();
    let fetched = input.fetch_before_create.unwrap_or(true);

    if fetched {
        let fetch = run_git(&repo_root, &["fetch", &remote, &branch, "--prune"])?;
        if !fetch.stdout.is_empty() {
            output_lines.push(fetch.stdout);
        }
        if !fetch.stderr.is_empty() {
            output_lines.push(fetch.stderr);
        }
    } else {
        warnings.push("已跳过 fetch；工作树将使用本地已知的远端引用。".to_string());
    }

    if !remote_branch_exists(&repo_root, &remote, &branch) {
        return Err(format!(
            "未找到远端基线 {}，请确认 remote/base branch 是否正确。",
            target_base_ref
        ));
    }

    let worktree_dir_string = worktree_dir.to_string_lossy().to_string();
    let add = run_git(
        &repo_root,
        &[
            "worktree",
            "add",
            "-b",
            &new_branch,
            &worktree_dir_string,
            &target_base_ref,
        ],
    )?;
    if !add.stdout.is_empty() {
        output_lines.push(add.stdout);
    }
    if !add.stderr.is_empty() {
        output_lines.push(add.stderr);
    }

    Ok(GitWorktreeCreateResult {
        repo_dir: repo_root.to_string_lossy().to_string(),
        base_ref: target_base_ref,
        new_branch,
        worktree_dir: worktree_dir_string,
        fetched,
        output: output_lines.join("\n"),
        warnings,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_branch_for_path_keeps_readable_slug() {
        assert_eq!(
            sanitize_branch_for_path("feature/Add Zed Remote"),
            "feature-add-zed-remote"
        );
        assert_eq!(sanitize_branch_for_path("你好"), "codex-worktree");
    }

    #[test]
    fn base_ref_uses_selected_remote() {
        assert_eq!(base_ref("upstream", "main"), "upstream/main");
        assert_eq!(base_ref("origin", "release/v1"), "origin/release/v1");
    }

    #[test]
    fn normalize_base_branch_rejects_unsafe_values() {
        assert!(normalize_base_branch("main").is_ok());
        assert!(normalize_base_branch("feature/foo").is_ok());
        assert!(normalize_base_branch("bad branch").is_err());
        assert!(normalize_base_branch("../main").is_err());
        assert!(normalize_base_branch("-main").is_err());
    }
}
