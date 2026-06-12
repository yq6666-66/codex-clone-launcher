const { spawnSync } = require('node:child_process');
const path = require('node:path');

const isWindows = process.platform === 'win32';
const localBin = (name) =>
  path.join(__dirname, '..', 'node_modules', '.bin', isWindows ? `${name}.cmd` : name);
const runCommand = (command, args, options) => {
  if (!isWindows) {
    return spawnSync(command, args, options);
  }
  const commandForCmd =
    path.isAbsolute(command) && command.startsWith(process.cwd())
      ? path.relative(process.cwd(), command)
      : command;
  const quoteForCmd = (part) => {
    const value = String(part);
    return /[\s&()^|<>]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  };
  const escaped = [commandForCmd, ...args]
    .map(quoteForCmd)
    .join(' ');
  return spawnSync('cmd.exe', ['/d', '/c', escaped], options);
};

const env = {
  ...process.env,
  CODEX_CLONE_PROFILE: process.env.CODEX_CLONE_PROFILE || 'dev',
  CODEX_CLONE_API_PORT: process.env.CODEX_CLONE_API_PORT || '1456',
  VITE_CODEX_CLONE_PROFILE: process.env.VITE_CODEX_CLONE_PROFILE || 'dev',
};
const extraArgs = process.argv.slice(2);

const syncResult = runCommand('npm', ['run', 'sync-version'], {
  stdio: 'inherit',
  env,
});

if (syncResult.status !== 0) {
  process.exit(syncResult.status ?? 1);
}

const tauriResult = runCommand(
  localBin('tauri'),
  ['dev', '--config', 'src-tauri/tauri.dev.conf.json', ...extraArgs],
  {
    stdio: 'inherit',
    env,
  },
);

process.exit(tauriResult.status ?? 1);
