const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const distIndex = path.join(repoRoot, 'dist', 'index.html');

if (process.env.CODEX_SKIP_TAURI_BEFORE_BUILD === '1') {
  if (!fs.existsSync(distIndex)) {
    console.error(
      'CODEX_SKIP_TAURI_BEFORE_BUILD=1 requires an existing dist/index.html from a prior build.'
    );
    process.exit(1);
  }
  console.log('Skipping Tauri beforeBuildCommand; using prebuilt frontend dist.');
  process.exit(0);
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run('node', ['scripts/prepare-tauri.cjs']);
run('npm', ['run', 'build']);
