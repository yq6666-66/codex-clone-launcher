# Contributing

This repository is focused on the Codex Clone Launcher.

## Project Structure

- `src`: React frontend.
- `src-tauri`: Tauri desktop application.
- `src-tauri/src/modules`: Codex profile, account, history sync, and launcher logic.
- `docs`: user-facing documentation.

## Development

```powershell
npm ci
npm run typecheck
npm run build
npm run test:rust
```

Run the desktop app in development mode:

```powershell
npm run tauri:dev
```

## Pull Requests

- Keep changes scoped to Codex clone/profile/history behavior.
- Do not commit runtime profiles, `auth.json`, tokens, API keys, SQLite history, session logs, screenshots, or local machine paths.
- Run `npm run verify` before opening a PR.
