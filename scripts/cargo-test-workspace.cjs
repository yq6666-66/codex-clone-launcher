#!/usr/bin/env node

const { spawnSync } = require('node:child_process');

const result = spawnSync('cargo', ['test', '--workspace', ...process.argv.slice(2)], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: process.env,
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
