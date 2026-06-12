#!/usr/bin/env node

const https = require('node:https');

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith('--')) continue;
    const key = value.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args[key] = 'true';
    } else {
      args[key] = next;
      index += 1;
    }
  }
  return args;
}

function requestJson(url, { token, method = 'GET', body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? Buffer.from(body) : undefined;
    const request = https.request(
      url,
      {
        method,
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'codex-clone-launcher-release',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(payload ? { 'Content-Length': payload.length } : {}),
          ...headers,
        },
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error(`${method} ${url} failed with ${response.statusCode}: ${raw}`));
            return;
          }
          if (!raw.trim()) {
            resolve({});
            return;
          }
          try {
            resolve(JSON.parse(raw));
          } catch (error) {
            reject(new Error(`${method} ${url} returned invalid JSON: ${error.message}`));
          }
        });
      },
    );
    request.on('error', reject);
    request.setTimeout(60000, () => request.destroy(new Error(`${method} ${url} timed out`)));
    if (payload) request.write(payload);
    request.end();
  });
}

function requestText(url, token) {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        headers: {
          Accept: 'application/octet-stream',
          'User-Agent': 'codex-clone-launcher-release',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
      (response) => {
        if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          requestText(response.headers.location, token).then(resolve, reject);
          return;
        }
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error(`GET ${url} failed with ${response.statusCode}: ${raw}`));
            return;
          }
          resolve(raw);
        });
      },
    );
    request.on('error', reject);
    request.setTimeout(60000, () => request.destroy(new Error(`GET ${url} timed out`)));
  });
}

function normalizeVersion(value) {
  return String(value || '').trim().replace(/^v/i, '');
}

function isWindowsInstaller(asset) {
  const name = String(asset.name || '').toLowerCase();
  return (name.endsWith('.exe') || name.endsWith('.msi')) && !name.endsWith('.sig');
}

function pickWindowsInstaller(assets) {
  const installers = assets.filter(isWindowsInstaller);
  return (
    installers.find((asset) => /setup\.exe$/i.test(asset.name || '')) ||
    installers.find((asset) => /\.exe$/i.test(asset.name || '')) ||
    installers[0]
  );
}

function uploadUrlFor(release, name) {
  const base = String(release.upload_url || '').replace(/\{.*$/, '');
  if (!base) throw new Error('Release upload_url is missing');
  return `${base}?name=${encodeURIComponent(name)}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const ownerRepo = args['owner-repo'] || process.env.GITHUB_REPOSITORY;
  const tag = args.tag || process.env.GITHUB_REF_NAME;
  const token = process.env.GITHUB_TOKEN || '';
  if (!ownerRepo || !ownerRepo.includes('/')) throw new Error(`Invalid --owner-repo: ${ownerRepo}`);
  if (!tag) throw new Error('Missing --tag or GITHUB_REF_NAME');
  const [owner, repo] = ownerRepo.split('/');

  const release = await requestJson(
    `https://api.github.com/repos/${owner}/${repo}/releases/tags/${encodeURIComponent(tag)}`,
    { token },
  );
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const installer = pickWindowsInstaller(assets);
  if (!installer) {
    throw new Error(`No Windows .exe or .msi installer asset found for ${tag}`);
  }
  const signatureAsset = assets.find((asset) => asset.name === `${installer.name}.sig`);
  if (!signatureAsset) {
    throw new Error(`No signature asset found for ${installer.name}`);
  }

  const signature = (await requestText(signatureAsset.browser_download_url, token)).trim();
  if (!signature) throw new Error(`Signature asset ${signatureAsset.name} is empty`);

  const latest = {
    version: normalizeVersion(release.tag_name),
    notes: release.body || release.name || release.tag_name,
    pub_date: release.published_at || release.created_at || new Date().toISOString(),
    platforms: {
      'windows-x86_64': {
        signature,
        url: installer.browser_download_url,
      },
    },
  };
  const latestJson = JSON.stringify(latest, null, 2) + '\n';

  const existingLatest = assets.find((asset) => asset.name === 'latest.json');
  if (existingLatest) {
    await requestJson(`https://api.github.com/repos/${owner}/${repo}/releases/assets/${existingLatest.id}`, {
      token,
      method: 'DELETE',
    });
  }

  await requestJson(uploadUrlFor(release, 'latest.json'), {
    token,
    method: 'POST',
    body: latestJson,
    headers: {
      'Content-Type': 'application/json',
    },
  });

  console.log(`Published latest.json for ${tag}: ${installer.name}`);
}

main().catch((error) => {
  console.error(`Failed to publish latest.json: ${error.message}`);
  process.exit(1);
});
