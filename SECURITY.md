# Security Policy

## Reporting a Vulnerability

Please report issues that could expose local Codex profile data, account credentials, API keys, OAuth tokens, refresh tokens, or copied history artifacts.

Do not include real secrets or private profile files in public issues. Share only redacted logs or a minimal reproduction.

## Local Data

This project should never require committing `auth.json`, `config.toml`, SQLite history databases, session logs, or sync backups from a real `CODEX_HOME`.
