# Codex Clone Launcher Guide

Codex Clone Launcher is a Codex-only Tauri desktop app. It creates isolated
Codex Desktop profiles, launches them with their own `CODEX_HOME`, and applies
an explicit sync package when you choose to inherit local data.

The app is intentionally narrow:

- It manages Codex clones, not general account switching for unrelated desktop apps.
- It does not copy source credentials into clones.
- It does not read or write third-party tool configuration.
- It does not refresh source profile data when a clone is launched.

## Main Workflow

1. Open **Settings** and confirm the Codex Desktop executable path.
2. Open **Create Codex** and fill Base URL, API Key, clone name, and model.
3. Enable sync-package inheritance only when the clone should receive the last
   extracted local package.
4. Use **Codex List** to extract or refresh the source sync package.
5. Run **Sync/Repair** on a clone to apply the current package.
6. Use **Verify** or **Refresh Status** to confirm history and resource health.
7. Launch the clone after its readiness and sync status are acceptable.

Advanced create options such as working directory, startup script, model
catalog, goal pursuit, and prompt pack are clone-owned. They are folded behind
the advanced options section in the UI and never modify the source Codex
profile.

## Data Boundary

The sync package is launcher-owned staging data. It can include stable local
artifacts such as:

- `sessions`
- `archived_sessions`
- `state_5.sqlite`
- `goals_1.sqlite`
- `session_index.jsonl`
- `history.jsonl`
- `memories`
- `skills`
- `rules`
- `AGENTS.md`
- `mcp-servers`

The package intentionally excludes source secrets and runtime state:

- `auth.json`
- `.credentials.json`
- API keys and OAuth tokens
- quota configuration
- `plugins`
- `cache`
- `log`
- `.tmp`
- live process state

Clone metadata such as `clone-sync-package-applied.json`, `clone-goal.md`,
`clone-prompts.md`, and `model-catalog.json` belongs to the clone profile. These
files are not written back to the source profile.

## Sync Package Panel

The Codex List page owns the full sync package workflow:

- **Extract** builds a new package from the current source Codex profile.
- **Refresh** reloads current package status.
- **Preflight** performs a read-only integrity and safety check.
- The panel menu contains copy actions for resources, preflight, and backups.
- Backup history is collapsed by default and can be opened for diagnostics.

Dashboard cards intentionally show only summary health and navigation so the
main screen stays quiet.

## Clone List

Each clone card keeps the most common actions visible:

- Start or stop.
- Sync or repair.
- Delete.

Secondary actions live in the card menu, including verify, refresh, export,
open directories, copy applied markers, refresh sessions, and scan usage.

Session summaries and usage summaries are read-only and collapsed by default.
They read the selected clone's own files and do not call provider billing or
quota APIs.

## Provider Checks

The create form includes manual provider actions:

- **Fetch Models** calls the configured provider model-list endpoint.
- **Test Connection** sends a small compatibility request.

The API key is used only for the requested action. It is not saved to provider
presets, diagnostics, sync packages, or source profile files.

Diagnostics should show endpoint, protocol, HTTP status, latency, and a redacted
message. They must not show full API keys, bearer tokens, OAuth tokens, or
private response bodies.

## Updates

The app uses Tauri Updater and GitHub Releases. The update endpoint is generated
at build time by `npm run sync-version`.

Resolution order:

1. `UPDATER_ENDPOINT`
2. `UPDATER_OWNER_REPO`
3. `GITHUB_REPOSITORY`
4. `package.json` `repository.url`
5. The upstream default repository

Release builds need:

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` when the signing key is password
  protected
- a tag that matches `package.json`, such as `vX.Y.Z`
- Windows installer assets and `latest.json`

Portable zip assets are useful for manual download, but the automatic updater
should use a signed NSIS `.exe` installer. The verification script still accepts
MSI assets, but the public workflow builds NSIS by default to avoid
WiX-specific packaging failures on GitHub-hosted Windows runners. Verify a
published release with:

```powershell
npm run verify:updater-release -- --owner-repo owner/repo --tag vX.Y.Z
```

## Local Development

Prerequisites:

- Node.js LTS with `npm`
- Rust stable toolchain
- Tauri system prerequisites for the target OS

Common commands:

```powershell
npm ci
npm run typecheck
npm run build
npm run test:rust
npm run tauri:dev
```

On Windows, a source checkout can create a local shortcut:

```powershell
.\scripts\create-windows-shortcut.ps1
```

The shortcut runs `scripts\start-codex-clone-launcher.ps1`, which rebuilds the
release executable when source files are newer than the last local build.

## Troubleshooting

- If inherited conversations do not appear, run **Verify** and then
  **Sync/Repair** on the clone.
- If a clone still looks stale, compare `clone-sync-package-applied.json` with
  the current package status.
- If package health is unclear, run **Preflight** before repair.
- If update checks fail with `latest.json` missing, publish a release that
  includes updater metadata.
- If signature verification fails, confirm the GitHub signing secret matches
  the public key in `src-tauri/tauri.conf.json`.
- If a desktop build fails on Windows with `拒绝访问。 (os error 5)`, stop the
  running `codex-clone-launcher.exe` before rebuilding.
