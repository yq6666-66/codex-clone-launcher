# Codex Clone Launcher Notes

The app creates isolated Codex Desktop profiles for users who want multiple Codex accounts or quota pools on the same computer while keeping useful local history available across clones.

Each clone gets its own `CODEX_HOME`. Credentials stay isolated, but selected local data can be inherited and repaired so Codex Desktop can show copied projects and conversations.

## History Sync

When local data inheritance is enabled, the app copies history artifacts, refreshes `session_index.jsonl`, and aligns stored thread metadata to the clone's current `model_provider` and `model`.

The sync logic intentionally avoids copying source `auth.json` or account tokens.

## Release Packages

The public release provides:

- Windows x64 installer
- Windows x64 portable zip
- macOS universal DMG

## Development

```powershell
npm ci
npm run verify
```

## Troubleshooting

- If inherited conversations do not appear in Codex Desktop, run the clone's `Verify` and `Sync/Repair` actions.
- If provider/model mismatch is non-zero, run `Sync/Repair`.
- If a clone launches into the wrong account, inspect its isolated `CODEX_HOME`; credentials are not inherited by history sync.
