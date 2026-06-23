const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const workflowPath = path.join(repoRoot, '.github', 'workflows', 'release.yml');
const tauriConfigPath = path.join(repoRoot, 'src-tauri', 'tauri.conf.json');

function fail(message) {
  throw new Error(message);
}

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function stepBlock(lines, startIndex) {
  const block = [];
  for (let i = startIndex; i < lines.length; i += 1) {
    if (i > startIndex && /^ {6}- (uses|name|run):/.test(lines[i])) break;
    block.push(lines[i]);
  }
  return block.join('\n');
}

function unquoteYamlScalar(value) {
  const trimmed = value.trim();
  const commentIndex = trimmed.indexOf(' #');
  const uncommented = commentIndex >= 0 ? trimmed.slice(0, commentIndex).trim() : trimmed;
  if (
    (uncommented.startsWith('"') && uncommented.endsWith('"')) ||
    (uncommented.startsWith("'") && uncommented.endsWith("'"))
  ) {
    return uncommented.slice(1, -1);
  }
  return uncommented;
}

const workflow = read(workflowPath);
const workflowLines = workflow.split(/\r?\n/);
const signingSecretLines = [];
for (let index = 0; index < workflowLines.length; index += 1) {
  const line = workflowLines[index];
  if (line.includes('TAURI_SIGNING_PRIVATE_KEY')) signingSecretLines.push(index);

  if (!/^\s*-?\s*uses\s*:/.test(line)) continue;
  const actionRef = line.match(/^\s*-?\s*uses\s*:\s*(.+?)\s*$/);
  if (!actionRef) {
    fail(`release workflow uses line ${index + 1} could not be parsed`);
  }
  const usesValue = unquoteYamlScalar(actionRef[1]);
  const atIndex = usesValue.lastIndexOf('@');
  if (atIndex <= 0 || atIndex === usesValue.length - 1) {
    fail(`release workflow uses line ${index + 1} must include an action ref`);
  }
  const actionName = usesValue.slice(0, atIndex);
  const ref = usesValue.slice(atIndex + 1);
  if (!/^[a-f0-9]{40}$/i.test(ref)) {
    fail(`release workflow action ${actionName} must be pinned to a 40-character commit SHA`);
  }
}

const checkoutIndex = workflowLines.findIndex((line) => line.includes('uses: actions/checkout@'));
if (checkoutIndex < 0) fail('release workflow is missing actions/checkout');
const checkoutBlock = stepBlock(workflowLines, checkoutIndex);
if (!checkoutBlock.includes('persist-credentials: false')) {
  fail('release workflow checkout must set persist-credentials: false');
}

const prebuildIndex = workflowLines.findIndex((line) =>
  line.includes('name: Build frontend before signing')
);
if (prebuildIndex < 0) fail('release workflow is missing Build frontend before signing step');
const tauriActionIndex = workflowLines.findIndex((line) => line.includes('tauri-apps/tauri-action@'));
if (tauriActionIndex < 0) fail('release workflow is missing tauri-action step');
if (prebuildIndex > tauriActionIndex) {
  fail('frontend prebuild must run before tauri-action receives signing secrets');
}

const tauriBlock = stepBlock(workflowLines, tauriActionIndex);
if (!tauriBlock.includes('TAURI_SIGNING_PRIVATE_KEY:')) {
  fail('tauri-action step must keep signing key only in the signing/bundling step');
}
if (!tauriBlock.includes('CODEX_SKIP_TAURI_BEFORE_BUILD: "1"')) {
  fail('tauri-action step must set CODEX_SKIP_TAURI_BEFORE_BUILD: "1"');
}
if (tauriBlock.includes('VITE_SENTRY_DSN:')) {
  fail('VITE_SENTRY_DSN belongs in the prebuild step, not the signing step');
}
for (const index of signingSecretLines) {
  if (index < tauriActionIndex || index >= workflowLines.length) {
    fail(`signing secret appears outside tauri-action step at line ${index + 1}`);
  }
  const line = workflowLines[index];
  if (!tauriBlock.includes(line)) {
    fail(`signing secret appears outside tauri-action step at line ${index + 1}`);
  }
}

const tauriConfig = JSON.parse(read(tauriConfigPath));
if (tauriConfig.build?.beforeBuildCommand !== 'node scripts/tauri-before-build.cjs') {
  fail('tauri.conf.json beforeBuildCommand must call scripts/tauri-before-build.cjs');
}

console.log('Release workflow hardening OK');
