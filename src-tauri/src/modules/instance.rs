use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstanceDefaults {
    pub root_dir: String,
    pub default_user_data_dir: String,
}

fn is_ignored_entry_name(name: &str) -> bool {
    matches!(name, ".DS_Store" | "Thumbs.db" | "desktop.ini")
}

pub fn is_profile_initialized(profile_dir: &Path) -> bool {
    if !profile_dir.is_dir() {
        return false;
    }

    let Ok(entries) = fs::read_dir(profile_dir) else {
        return false;
    };

    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if !is_ignored_entry_name(&name) {
            return true;
        }
    }

    false
}

pub fn delete_instance_directory(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    if !path.is_dir() {
        return Err(format!("实例路径不是目录: {}", path.display()));
    }
    fs::remove_dir_all(path)
        .map_err(|error| format!("删除实例目录失败: path={}, error={}", path.display(), error))
}

pub fn get_default_user_data_dir() -> Result<PathBuf, String> {
    #[cfg(target_os = "windows")]
    {
        let appdata =
            std::env::var("APPDATA").map_err(|_| "无法获取 APPDATA 环境变量".to_string())?;
        return Ok(PathBuf::from(appdata).join("Codex"));
    }

    #[cfg(target_os = "macos")]
    {
        let home = dirs::home_dir().ok_or("无法获取用户主目录")?;
        return Ok(home.join("Library/Application Support/Codex"));
    }

    #[cfg(target_os = "linux")]
    {
        let home = dirs::home_dir().ok_or("无法获取用户主目录")?;
        return Ok(home.join(".config/Codex"));
    }

    #[allow(unreachable_code)]
    Err("无法确定默认用户数据目录".to_string())
}
