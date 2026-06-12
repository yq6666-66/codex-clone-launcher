# Security Policy

Codex Clone Launcher works with local Codex profile data. Treat profile files,
session history, account metadata, and update signing material as sensitive.

## Supported Versions

Security fixes target the latest tagged release and the `main` branch.

## Reporting a Vulnerability

Please report issues that could expose local Codex profile data, account credentials, API keys, OAuth tokens, refresh tokens, or copied history artifacts.

Use GitHub private vulnerability reporting if it is enabled for the repository. If it is not available, open a minimal public issue without secrets and state that sensitive details are available privately.

Do not include real secrets or private profile files in public issues. Share only redacted logs, a minimal reproduction, affected versions, and the expected impact.

## Local Data

This project should never require committing `auth.json`, `config.toml`, SQLite history databases, session logs, or sync backups from a real `CODEX_HOME`.

Never attach these files to public issues or pull requests:

- `auth.json`
- `.credentials.json`
- API keys, bearer tokens, OAuth access tokens, or refresh tokens
- `state_5.sqlite` or other real profile databases
- raw `sessions` or `archived_sessions`
- `plugins`, `cache`, `log`, or `.tmp`
- generated sync packages from a real profile

## Update Signing

Tauri updater signing keys must stay outside git. Only the public key belongs in
`src-tauri/tauri.conf.json`.

GitHub Actions release builds should use repository secrets:

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` when needed

If an updater private key is exposed, rotate it, update the public key, and
publish a new signed release.

## Telemetry

Sentry telemetry is disabled unless `VITE_SENTRY_DSN` is configured for a build.
Telemetry events should be redacted before sending and must not contain API
keys, authorization headers, OAuth tokens, raw session contents, or private
profile files.
