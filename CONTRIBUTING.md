# Contributing

This repository is focused on the Codex Clone Launcher.

## Scope

Good contributions usually improve one of these areas:

- Codex clone creation, launch, stop, delete, and status handling.
- Source sync package extraction, preflight, backup, and clone repair.
- Privacy-preserving diagnostics.
- GitHub release/update reliability.
- Windows source-checkout deployment.
- Documentation that helps other machines reproduce the setup.

Out of scope for this repository:

- General account switching for unrelated desktop apps.
- Copying or exporting real Codex credentials.
- Automating third-party installer or plugin state.
- Uploading private profile data for debugging.

## Project Structure

- `src`: React frontend.
- `src-tauri`: Tauri desktop application.
- `src-tauri/src/modules`: Codex profile, account, history sync, and launcher logic.
- `scripts`: local build, updater, release, and Windows shortcut helpers.
- `docs`: user-facing and maintainer documentation.
- `.github/workflows`: CI and release automation.

## Development

```powershell
npm ci
npm run typecheck
npm run build
npm run test:rust
```

`npm run build` runs `npm run sync-version` first. That script keeps the Tauri version, updater endpoint, Cargo version, and generated frontend updater config in sync.

Run the desktop app in development mode:

```powershell
npm run tauri:dev
```

For a local Windows source checkout, test the shortcut flow with:

```powershell
.\scripts\create-windows-shortcut.ps1
```

## Pull Requests

- Keep changes scoped to Codex clone/profile/history behavior unless the PR is explicitly documentation or release tooling.
- Preserve the source/clone boundary: source credentials are never copied into clone sync packages.
- Do not commit runtime profiles, `auth.json`, `.credentials.json`, tokens, API keys, SQLite history, raw session logs, screenshots with secrets, or local machine paths.
- Add or update documentation when behavior changes.
- Run `npm run typecheck` and `npm run build` for frontend or Tauri config changes.
- Run `npm run test:rust` for Rust module changes.
- Run `npm run verify:updater-release -- --owner-repo owner/repo --tag vX.Y.Z` after publishing updater releases.

## Reporting Logs

When a bug needs logs, redact before posting:

- API keys and bearer tokens.
- OAuth access or refresh tokens.
- Email addresses if they identify private accounts.
- Full local profile paths when they reveal personal information.
- Raw `sessions` content, prompt history, and SQLite database contents.

Prefer short excerpts, exact commands, and reproduction steps over full profile archives.
