# Changelog

All notable changes for Codex Clone Launcher are tracked here.

This project uses release tags such as `vX.Y.Z`. The app updater expects the
tag version, `package.json` version, Tauri version, installer assets, signatures,
and `latest.json` metadata to match.

## 0.24.12 - 2026-06-13

- Fixed the release verifier to follow GitHub asset download redirects when
  reading `latest.json`.

## 0.24.11 - 2026-06-13

- Added a release workflow step that publishes `latest.json` directly from the
  uploaded Windows installer and signature assets.
- Kept signed NSIS installers as the public updater target and retained the
  release verifier as the final gate.

## 0.24.10 - 2026-06-13

- Switched the public release workflow to signed NSIS installers so GitHub
  Releases can publish updater-ready Windows assets without the WiX MSI bundle
  failure seen on hosted runners.
- Rotated the Tauri updater public key and documented the matching GitHub
  Actions signing secrets for release builds.
- Added bilingual README files with a dashboard preview for the open-source
  project page.

## 0.24.9 - 2026-06-13

- Simplified the app scope to Codex clone/profile workflows.
- Clarified the source/clone sync package privacy boundary.
- Added generated updater configuration for fork-friendly GitHub Releases.
- Added release verification for `latest.json`, Windows installer assets, and
  updater signatures.
- Reworked open-source documentation for source checkout deployment,
  contribution rules, and security reporting.

## 0.24.7

- Initial Codex Clone Launcher open-source baseline.
