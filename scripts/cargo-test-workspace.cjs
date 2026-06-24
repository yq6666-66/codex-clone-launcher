#!/usr/bin/env node

const { spawnSync } = require('node:child_process');

const env = {
  ...process.env,
  RUST_TEST_THREADS: process.env.RUST_TEST_THREADS || '1',
};

const result = spawnSync('cargo', ['test', '--workspace', '--lib', ...process.argv.slice(2)], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env,
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
