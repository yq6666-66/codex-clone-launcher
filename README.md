# Codex 分身启动器

[English](README.en.md)

Codex Clone Launcher 是一款桌面应用程序，用于在同一台电脑上运行多个 Codex Desktop 克隆版本。每个克隆版本都使用自己独立的 `CODEX_HOME`，因此不同克隆可以使用不同账号或配额池；同时，在选择继承数据时，应用仍然可以把本地 Codex 对话、记忆、索引和常用本地能力同步到克隆版本中。

简而言之：保持 Codex 账号和使用配额彼此独立，同时允许克隆之间访问有用的本地历史记录。

![Codex 分身启动器界面](docs/images/codex-clone-launcher-v0.24.8.png)

## 下载

从 [GitHub Releases](https://github.com/yq6666-66/codex-clone-launcher/releases/latest) 获取最新 Windows 和 macOS 软件包。

- Windows x64 便携版：`codex-clone-launcher_0.24.8_windows_x64_portable.zip`
- macOS 通用 DMG：`codex-clone-launcher_0.24.8_macos_universal.dmg`

说明：`v0.24.8` 是当前发布包版本；部分现成应用二进制内部仍可能显示 `0.24.7`。

## 特征

- 创建、启动、停止和删除 Codex Desktop 克隆。
- 将每个克隆实例放在单独的 `CODEX_HOME` 中，允许使用不同账号和配额池。
- 继承本地 Codex 数据，而不复制源身份验证密钥。
- 复制并修复历史记录，例如 `sessions`、`state_5.sqlite`、`session_index.jsonl`、`memories` 和插件缓存。
- 将继承的 `threads.model_provider` 与 `threads.model` 对齐到克隆当前的 `config.toml`。
- 更新会话 JSONL 元数据并重新构建 `session_index.jsonl`，以便继承的对话显示在 Codex Desktop 中。
- 在克隆列表中显示历史健康状况、线程数、provider/model 不匹配、验证、同步和修复状态。
- 检测 Windows 上的 Codex Desktop，并刷新 Codex 应用服务器中克隆配置文件的元数据。

## 使用提示

- 在分身里要新开一个对话；继续旧对话可能仍然使用本体会话或本体额度。
- 如果 Codex 显示未响应，先等一会儿；系统弹窗出现时选择等待应用，不要直接关闭。
- 加载同步包、plugins、skills 或历史数据时，应用可能短暂卡顿。
- 如果历史、skills、MCP、plugins 或 memories 没有出现，先刷新/提取本体同步包，再执行同步/修复。

## 隐私边界

应用围绕严格的隐私边界设计：历史同步不应复制身份验证密钥。本仓库只包含源代码。不要提交本地运行数据，包括：

- `auth.json`
- `config.toml`
- `state_5.sqlite`
- `sessions/`
- `memories/`
- API keys、OAuth tokens、refresh tokens 或复制的账号数据
- 来自真实配置文件的历史同步备份或 manifest

历史同步逻辑用于复制对话和索引数据，不用于复制源身份验证密钥。

## 平台说明

- Windows：当前发布提供 Windows x64 便携版。
- macOS：当前发布提供 Apple Silicon 和 Intel Mac 通用 DMG。
- macOS 包当前未使用 Apple Developer ID 公证，因此 Gatekeeper 可能要求右键点击应用并选择 `Open`。

## 开发

```powershell
npm ci
npm run verify
```

以开发模式运行桌面应用：

```powershell
npm run tauri:dev
```

构建桌面应用：

```powershell
npm run tauri build
```

## 许可证

MIT
