#!/usr/bin/env node

const fs = require('node:fs');
const https = require('node:https');
const path = require('node:path');

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

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8'));
}

function readCargoPackageVersion(relativePath) {
  const content = fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
  const lines = content.split(/\r?\n/);
  const packageLines = [];
  let inPackage = false;
  for (const line of lines) {
    if (/^\s*\[package\]\s*$/.test(line)) {
      inPackage = true;
      continue;
    }
    if (inPackage && /^\s*\[/.test(line)) {
      break;
    }
    if (inPackage) {
      packageLines.push(line);
    }
  }
  const source = packageLines.length > 0 ? packageLines.join('\n') : content;
  const version = source.match(/^version\s*=\s*"([^"]+)"/m);
  if (!version) throw new Error(`${relativePath} is missing [package].version`);
  return version[1];
}

function boolArg(value) {
  return value === true || ['true', '1', 'yes'].includes(String(value || '').toLowerCase());
}

function requestJson(url, token) {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'codex-clone-launcher-release-validator',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          body += chunk;
        });
        response.on('end', () => {
          if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error(`GET ${url} failed with ${response.statusCode}: ${body}`));
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch (error) {
            reject(new Error(`GET ${url} returned invalid JSON: ${error.message}`));
          }
        });
      },
    );
    request.on('error', reject);
    request.setTimeout(30000, () => {
      request.destroy(new Error(`GET ${url} timed out`));
    });
  });
}

function parseSemver(value) {
  const match = String(value || '').trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] || '',
  };
}

function compareSemver(left, right) {
  const parsedLeft = parseSemver(left);
  const parsedRight = parseSemver(right);
  if (!parsedLeft || !parsedRight) {
    throw new Error(`Cannot compare non-semver values: ${left} / ${right}`);
  }
  for (const key of ['major', 'minor', 'patch']) {
    if (parsedLeft[key] !== parsedRight[key]) return parsedLeft[key] - parsedRight[key];
  }
  if (parsedLeft.prerelease === parsedRight.prerelease) return 0;
  if (!parsedLeft.prerelease) return 1;
  if (!parsedRight.prerelease) return -1;
  return parsedLeft.prerelease.localeCompare(parsedRight.prerelease);
}

function normalizeRepoUrl(value) {
  return String(value || '')
    .replace(/^git\+/, '')
    .replace(/\.git$/, '')
    .replace(/^https:\/\/github\.com\//, '')
    .replace(/^git@github\.com:/, '')
    .toLowerCase();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const tag = args.tag || process.env.GITHUB_REF_NAME || '';
  const ownerRepo = args['owner-repo'] || process.env.GITHUB_REPOSITORY || process.env.UPDATER_OWNER_REPO || '';
  const requireNewerThanLatest = boolArg(args['require-newer-than-latest']);
  const latestTagOverride = args['latest-tag'] || process.env.LATEST_RELEASE_TAG || '';
  const versionFromTag = tag.replace(/^v/i, '');
  const errors = [];

  if (!/^v\d+\.\d+\.\d+(?:[-+].*)?$/i.test(tag)) {
    errors.push(`Tag must be a semver-like v* tag, got "${tag || '(empty)'}"`);
  }

  const pkg = readJson('package.json');
  const packageLock = readJson('package-lock.json');
  const tauriConfig = readJson('src-tauri/tauri.conf.json');
  const cargoVersion = readCargoPackageVersion('src-tauri/Cargo.toml');
  const versions = {
    'package.json': pkg.version,
    'package-lock.json': packageLock.version,
    'src-tauri/tauri.conf.json': tauriConfig.version,
    'src-tauri/Cargo.toml': cargoVersion,
  };

  for (const [file, version] of Object.entries(versions)) {
    if (version !== versionFromTag) {
      errors.push(`${file} version ${version} does not match tag ${tag}`);
    }
  }

  if (ownerRepo) {
    const normalizedOwnerRepo = ownerRepo.toLowerCase();
    const packageRepo = normalizeRepoUrl(pkg.repository && pkg.repository.url);
    if (packageRepo && packageRepo !== normalizedOwnerRepo) {
      errors.push(`package.json repository ${packageRepo} does not match workflow repo ${normalizedOwnerRepo}`);
    }

    const updaterEndpoints = tauriConfig.plugins?.updater?.endpoints || [];
    const expectedEndpointPrefix = `https://github.com/${ownerRepo}/releases/`.toLowerCase();
    const hasMatchingEndpoint = updaterEndpoints.some((endpoint) =>
      String(endpoint || '').toLowerCase().startsWith(expectedEndpointPrefix),
    );
    if (!hasMatchingEndpoint) {
      errors.push(`updater endpoint does not target workflow repo ${ownerRepo}`);
    }

    if (requireNewerThanLatest) {
      const [owner, repo] = ownerRepo.split('/');
      if (!owner || !repo) {
        errors.push(`Invalid owner/repo: ${ownerRepo}`);
      } else {
        try {
          const latestTag = latestTagOverride || (await requestJson(
            `https://api.github.com/repos/${owner}/${repo}/releases/latest`,
            process.env.GITHUB_TOKEN || '',
          ))?.tag_name;
          if (latestTag && compareSemver(versionFromTag, latestTag) <= 0) {
            errors.push(`tag ${tag} must be newer than latest GitHub release ${latestTag}`);
          }
        } catch (error) {
          errors.push(
            `could not verify latest GitHub release for ${ownerRepo}: ${error.message}; pass --latest-tag vX.Y.Z when doing an offline preflight`,
          );
        }
      }
    }
  }

  if (errors.length > 0) {
    console.error('Release version validation failed:');
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }

  console.log(
    `Release version validation passed: tag=${tag}, version=${versionFromTag}${
      ownerRepo ? `, ownerRepo=${ownerRepo}` : ''
    }`,
  );
}

main().catch((error) => {
  console.error(`Release version validation failed: ${error.message}`);
  process.exit(1);
});
