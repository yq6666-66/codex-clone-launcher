# Codex Clone Launcher

Codex Clone Launcher is a desktop app for running multiple Codex Desktop clones on the same computer. Each clone uses its own isolated `CODEX_HOME`, so different clones can sign in with different accounts or quota pools, while the app can still synchronize local Codex conversations, memories, and indexes into the clone when you choose to inherit data.

In short: keep separate Codex accounts and usage quotas, but make useful local history available across clones.

## Downloads

Get the latest Windows and macOS packages from [GitHub Releases](https://github.com/yq6666-66/codex-clone-launcher/releases).

- Windows x64 installer: `codex-clone-launcher_0.24.7_windows_x64_setup.exe`
- Windows x64 portable build: `codex-clone-launcher_0.24.7_windows_x64_portable.zip`
- macOS universal DMG: `codex-clone-launcher_0.24.7_macos_universal.dmg`

## Features

- Create, launch, stop, and delete Codex Desktop clones.
- Keep every clone in a separate `CODEX_HOME`, allowing different accounts and quota pools.
- Inherit local Codex data without copying source authentication secrets.
- Copy and repair history artifacts such as `sessions`, `state_5.sqlite`, `session_index.jsonl`, `memories`, and plugin cache.
- Align inherited `threads.model_provider` and `threads.model` values to the clone's current `config.toml`.
- Update session JSONL metadata and rebuild `session_index.jsonl` so inherited conversations appear in Codex Desktop.
- Show history health, thread count, provider/model mismatch, verification, sync, and repair status in the clone list.
- Detect Codex Desktop on Windows and refresh Codex app-server metadata for cloned profiles.

## Use Cases

- Use several Codex accounts on one machine without mixing credentials.
- Keep quota usage separate between personal, work, or backup accounts.
- Reuse existing Codex conversations and memory context in a new clone.
- Repair inherited history when Codex Desktop does not show copied conversations.

## Privacy Boundary

The app is designed around a strict privacy boundary: history synchronization should not copy authentication secrets. This repository is source code only. Do not commit local runtime data, including:

- `auth.json`
- `config.toml`
- `state_5.sqlite`
- `sessions/`
- `memories/`
- API keys, OAuth tokens, refresh tokens, or copied account data
- history sync backups or manifests from a real profile

The history sync logic is designed to copy conversation and index artifacts without copying source authentication secrets.

## Platform Notes

- Windows: the release includes an installer and a portable zip.
- macOS: the release includes a universal DMG for Apple Silicon and Intel Macs.
- macOS packages are not currently notarized with an Apple Developer ID, so Gatekeeper may require right-clicking the app and choosing `Open`.
- Windows packages are signed with the current release certificate when available, but SmartScreen reputation may still depend on certificate trust and download reputation.

## Development

```powershell
npm ci
npm run verify
```

Run the desktop app in development mode:

```powershell
npm run tauri:dev
```

Build the desktop app:

```powershell
npm run tauri build
```

## License

MIT
