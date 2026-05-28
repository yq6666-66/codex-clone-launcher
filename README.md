# Codex Clone Launcher

Codex Clone Launcher is a small Tauri desktop app for creating isolated Codex Desktop profiles. Each clone gets its own `CODEX_HOME`, so different clones can use different accounts or quota pools while sharing synchronized local history when you choose to inherit data.

## Features

- Create, launch, stop, and delete Codex Desktop clones.
- Keep each clone in an isolated `CODEX_HOME`.
- Optionally copy local Codex history artifacts such as `sessions`, `state_5.sqlite`, `session_index.jsonl`, `memories`, and plugin cache.
- Align inherited `threads.model_provider` and `threads.model` values to the clone's current `config.toml`.
- Update session JSONL metadata and rebuild `session_index.jsonl` so inherited conversations appear in Codex Desktop.
- Show history health, verification, sync, and repair status in the clone list.

## Privacy Boundary

This repository is source code only. Do not commit local runtime data, including:

- `auth.json`
- `config.toml`
- `state_5.sqlite`
- `sessions/`
- `memories/`
- API keys, OAuth tokens, refresh tokens, or copied account data
- history sync backups or manifests from a real profile

The history sync logic is designed to copy conversation and index artifacts without copying source authentication secrets.

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

CC-BY-NC-SA-4.0
