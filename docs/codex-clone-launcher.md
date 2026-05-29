# Codex Clone Launcher Notes

The app creates isolated Codex Desktop profiles and can synchronize local Codex history into a clone without copying authentication secrets.

## History Sync

When local data inheritance is enabled, the app copies history artifacts, refreshes `session_index.jsonl`, and aligns stored thread metadata to the clone's current `model_provider` and `model`.

The sync logic intentionally avoids copying source `auth.json` or account tokens.

## Development

```powershell
npm ci
npm run verify
```

## Troubleshooting

- If inherited conversations do not appear in Codex Desktop, run the clone's `Verify` and `Sync/Repair` actions.
- If provider/model mismatch is non-zero, run `Sync/Repair`.
- If a clone launches into the wrong account, inspect its isolated `CODEX_HOME`; credentials are not inherited by history sync.
