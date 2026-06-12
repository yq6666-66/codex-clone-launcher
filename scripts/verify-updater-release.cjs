#!/usr/bin/env node

const https = require('node:https');

const INSTALLER_EXTENSIONS = ['.exe', '.msi'];
const PORTABLE_EXTENSIONS = ['.zip'];

class VerificationError extends Error {
  constructor(message, diagnostics) {
    super(message);
    this.diagnostics = diagnostics;
  }
}

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
          'User-Agent': 'codex-clone-launcher-updater-check',
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

function requestText(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'codex-clone-launcher-updater-check',
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
          resolve(body);
        });
      },
    );
    request.on('error', reject);
    request.setTimeout(30000, () => {
      request.destroy(new Error(`GET ${url} timed out`));
    });
  });
}

function requireAsset(assets, predicate, message) {
  const asset = assets.find(predicate);
  if (!asset) throw new Error(message);
  return asset;
}

function formatList(values) {
  if (!values || values.length === 0) return '(none)';
  return values.join(', ');
}

function normalizeVersion(value) {
  return String(value || '').trim().replace(/^v/i, '');
}

function getPlatformEntries(latest) {
  if (!latest.platforms || typeof latest.platforms !== 'object') return [];
  return Object.entries(latest.platforms).map(([name, value]) => ({
    name,
    value: value && typeof value === 'object' ? value : {},
  }));
}

function platformHasSignature(platform) {
  const signature = platform.value.signature;
  return typeof signature === 'string' && signature.trim().length > 0;
}

function platformHasUrl(platform) {
  const url = platform.value.url;
  return typeof url === 'string' && /^https?:\/\//i.test(url);
}

function getPlatformUrl(platform) {
  return typeof platform.value.url === 'string' ? platform.value.url.trim() : '';
}

function getSignatureStatus(platform) {
  if (!platform) return 'missing platform';
  return platformHasSignature(platform) ? 'present' : 'missing';
}

function isWindowsPlatform(platform) {
  const name = platform.name.toLowerCase();
  const url = getPlatformUrl(platform).toLowerCase();
  const assetName = (getUrlAssetName(url) || '').toLowerCase();
  const windowsNamePattern = /(^|[-_.])(windows|win32|win64)([-_.]|$)/i;
  return (
    windowsNamePattern.test(name) ||
    name.includes('pc-windows') ||
    /\.(exe|msi)(\?|$)/i.test(url) ||
    windowsNamePattern.test(assetName)
  );
}

function getUrlAssetName(url) {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split('/').filter(Boolean);
    return parts.length > 0 ? decodeURIComponent(parts[parts.length - 1]) : '';
  } catch {
    return '';
  }
}

function normalizeAssetUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return '';
  }
}

function parseGithubReleaseAssetUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.toLowerCase() !== 'github.com') return null;
    const parts = parsed.pathname.split('/').filter(Boolean).map((part) => decodeURIComponent(part));
    if (parts.length < 6 || parts[2] !== 'releases' || parts[3] !== 'download') return null;
    return {
      owner: parts[0],
      repo: parts[1],
      tag: parts[4],
      name: parts.slice(5).join('/'),
    };
  } catch {
    return null;
  }
}

function getAssetExtension(nameOrUrl) {
  const name = getUrlAssetName(nameOrUrl) || String(nameOrUrl || '');
  const cleanName = name.split('?')[0].split('#')[0].toLowerCase();
  const match = cleanName.match(/(\.[a-z0-9]+)$/i);
  return match ? match[1] : '';
}

function findAssetForUrl(assets, url, releaseInfo) {
  const normalizedUrl = normalizeAssetUrl(url);
  const exactAsset = assets.find((asset) => {
    const assetUrl = normalizeAssetUrl(asset.browser_download_url || '');
    return normalizedUrl && assetUrl && normalizedUrl === assetUrl;
  });
  if (exactAsset) return exactAsset;

  const githubAsset = parseGithubReleaseAssetUrl(url);
  if (!githubAsset || !releaseInfo) return undefined;
  const isSameRelease =
    githubAsset.owner === releaseInfo.owner &&
    githubAsset.repo === releaseInfo.repo &&
    (githubAsset.tag === releaseInfo.tag || githubAsset.tag === 'latest');
  if (!isSameRelease) return undefined;
  return assets.find((asset) => asset.name === githubAsset.name);
}

function isAllowedWindowsPackage(url, allowPortable) {
  const extension = getAssetExtension(url);
  if (INSTALLER_EXTENSIONS.includes(extension)) return true;
  if (allowPortable && PORTABLE_EXTENSIONS.includes(extension)) return true;
  return false;
}

function getPackagePolicyMessage(allowPortable) {
  if (allowPortable) {
    return 'Windows updater URL may point to .exe, .msi, or portable .zip because --allow-portable is set';
  }
  return 'Windows updater URL must point to a .exe or .msi release asset; portable .zip packages are not valid auto-update packages by default';
}

function buildDiagnostics({ release, assets, latest, platforms, windowsPlatform, allowPortable, latestUrl }) {
  const platformKeys = platforms.map((platform) => platform.name);
  const windowsUrl = windowsPlatform ? getPlatformUrl(windowsPlatform) : '';
  const windowsAssetName = windowsUrl ? getUrlAssetName(windowsUrl) || '(unparseable)' : '(missing)';
  return [
    `version/tag: latest.json=${latest && latest.version ? latest.version : '(missing)'}; release=${release && release.tag_name ? release.tag_name : '(missing)'}`,
    `asset names: ${formatList(assets.map((asset) => asset.name))}`,
    `platform keys: ${formatList(platformKeys)}`,
    `Windows platform: ${windowsPlatform ? windowsPlatform.name : '(missing)'}`,
    `Windows url asset: ${windowsAssetName}`,
    `Windows signature: ${getSignatureStatus(windowsPlatform)}`,
    `package policy: ${getPackagePolicyMessage(allowPortable)}`,
    `latest.json source: ${latestUrl}`,
  ];
}

function printDiagnostics(diagnostics, stream = console.log) {
  diagnostics.forEach((line) => stream(`  - ${line}`));
}

function fail(message, diagnostics) {
  throw new VerificationError(message, diagnostics);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const allowPortable = boolArg(args['allow-portable']);
  const ownerRepo = args['owner-repo'] || process.env.GITHUB_REPOSITORY || 'yq6666-66/codex-clone-launcher';
  const tag = args.tag || process.env.GITHUB_REF_NAME;
  const latestUrl =
    args['latest-url'] || `https://github.com/${ownerRepo}/releases/latest/download/latest.json`;
  const token = process.env.GITHUB_TOKEN || '';
  const [owner, repo] = ownerRepo.split('/');
  if (!owner || !repo) throw new Error(`Invalid owner/repo: ${ownerRepo}`);

  const releaseUrl = tag
    ? `https://api.github.com/repos/${owner}/${repo}/releases/tags/${encodeURIComponent(tag)}`
    : `https://api.github.com/repos/${owner}/${repo}/releases/latest`;
  const release = await requestJson(releaseUrl, token);
  if (release.draft) throw new Error(`Release ${release.tag_name} is still a draft`);
  if (release.prerelease) throw new Error(`Release ${release.tag_name} is marked prerelease`);

  const assets = Array.isArray(release.assets) ? release.assets : [];
  const assetNames = assets.map((asset) => asset.name);
  const latestAsset = requireAsset(
    assets,
    (asset) => asset.name === 'latest.json',
    `Release ${release.tag_name} is missing latest.json. Asset names: ${formatList(assetNames)}`,
  );

  const latestJsonUrl = latestAsset.browser_download_url || latestUrl;
  const latestText = await requestText(latestJsonUrl);
  let latest;
  try {
    latest = JSON.parse(latestText);
  } catch (error) {
    throw new Error(`latest.json from ${latestJsonUrl} is invalid JSON: ${error.message}`);
  }
  const releaseVersion = normalizeVersion(release.tag_name);
  const latestVersion = normalizeVersion(latest.version);
  const platforms = getPlatformEntries(latest);
  const windowsPlatform = platforms.find(isWindowsPlatform);
  const diagnostics = buildDiagnostics({
    release,
    assets,
    latest,
    platforms,
    windowsPlatform,
    allowPortable,
    latestUrl: latestJsonUrl,
  });
  if (releaseVersion && latestVersion && latestVersion !== releaseVersion) {
    fail(`latest.json version ${latest.version} does not match release ${release.tag_name}`, diagnostics);
  }
  if (!latest.version) fail('latest.json is missing version', diagnostics);
  if (platforms.length === 0) {
    fail('latest.json is missing platforms', diagnostics);
  }
  if (!windowsPlatform) {
    fail('latest.json is missing a Windows platform entry', diagnostics);
  }
  if (!platformHasUrl(windowsPlatform)) {
    fail(`latest.json Windows platform ${windowsPlatform.name} is missing a downloadable URL`, diagnostics);
  }
  if (!platformHasSignature(windowsPlatform)) {
    fail(`latest.json Windows platform ${windowsPlatform.name} is missing an updater signature`, diagnostics);
  }

  const windowsUrl = getPlatformUrl(windowsPlatform);
  const windowsAsset = findAssetForUrl(assets, windowsUrl, { owner, repo, tag: release.tag_name });
  if (!windowsAsset) {
    fail(
      `latest.json Windows URL does not point to a release asset: ${windowsUrl}`,
      diagnostics,
    );
  }
  if (!isAllowedWindowsPackage(windowsUrl, allowPortable)) {
    const extension = getAssetExtension(windowsUrl) || '(unknown)';
    if (PORTABLE_EXTENSIONS.includes(extension)) {
      fail(
        `latest.json Windows URL points to portable ${extension} asset ${windowsAsset.name}; portable zip files are not automatic updater packages. Use --allow-portable only when this release intentionally publishes a portable updater URL.`,
        diagnostics,
      );
    }
    fail(
      `latest.json Windows URL points to ${extension} asset ${windowsAsset.name}; expected .exe or .msi${allowPortable ? ' or .zip' : ''}.`,
      diagnostics,
    );
  }

  const portableNote = PORTABLE_EXTENSIONS.includes(getAssetExtension(windowsUrl))
    ? ' (portable allowed by --allow-portable)'
    : '';
  console.log(`Updater release OK: ${release.tag_name}${portableNote}`);
  printDiagnostics(diagnostics);
}

main().catch((error) => {
  console.error(`Updater release verification failed: ${error.message}`);
  if (Array.isArray(error.diagnostics)) {
    console.error('Diagnostics:');
    printDiagnostics(error.diagnostics, console.error);
  }
  process.exit(1);
});
