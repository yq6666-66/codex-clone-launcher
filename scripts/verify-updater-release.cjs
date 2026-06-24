#!/usr/bin/env node

const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');

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

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function requestBody(url, options = {}) {
  const { accept = 'application/json', token, redirects = 5, originalHost } = options;
  const requestUrl = new URL(url);
  const firstHost = originalHost || requestUrl.hostname;

  return new Promise((resolve, reject) => {
    const request = https.get(
      requestUrl,
      {
        headers: {
          Accept: accept,
          'User-Agent': 'codex-clone-launcher-updater-check',
          ...(token && requestUrl.hostname === firstHost ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          body += chunk;
        });
        response.on('end', () => {
          if (
            response.statusCode &&
            [301, 302, 303, 307, 308].includes(response.statusCode) &&
            response.headers.location
          ) {
            if (redirects <= 0) {
              reject(new Error(`GET ${url} exceeded redirect limit`));
              return;
            }
            const redirectUrl = new URL(response.headers.location, requestUrl).toString();
            requestBody(redirectUrl, {
              accept,
              token,
              redirects: redirects - 1,
              originalHost: firstHost,
            }).then(resolve, reject);
            return;
          }
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

async function requestJson(url, token) {
  const body = await requestBody(url, {
    accept: 'application/vnd.github+json',
    token,
  });
  try {
    return JSON.parse(body);
  } catch (error) {
    throw new Error(`GET ${url} returned invalid JSON: ${error.message}`);
  }
}

async function getReleaseByTag({ owner, repo, tag, token, allowDraft }) {
  const encodedTag = encodeURIComponent(tag);
  const releaseUrl = `https://api.github.com/repos/${owner}/${repo}/releases/tags/${encodedTag}`;
  const attempts = allowDraft ? 8 : 1;
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await requestJson(releaseUrl, token);
    } catch (error) {
      if (!allowDraft || !/failed with 404\b/.test(error.message)) {
        throw error;
      }
      lastError = error;
    }

    const releasesUrl = `https://api.github.com/repos/${owner}/${repo}/releases?per_page=100`;
    const releases = await requestJson(releasesUrl, token);
    if (!Array.isArray(releases)) {
      throw new Error(`GET ${releasesUrl} returned non-array JSON`);
    }
    const release = releases.find((candidate) => candidate && candidate.tag_name === tag);
    if (release) {
      return release;
    }
    if (attempt < attempts) {
      await sleep(2000);
    }
  }

  throw new Error(
    `Release ${tag} was not found in published or draft releases after ${attempts} attempts: ${lastError.message}`,
  );
}

function requestText(url, token = '') {
  return requestBody(url, {
    accept: 'application/json',
    token,
  });
}

function getAssetApiUrl(asset) {
  return asset.url || asset.api_url || asset.apiUrl || '';
}

function requestAssetText(asset, fallbackUrl, token) {
  const apiUrl = getAssetApiUrl(asset);
  if (apiUrl) {
    return requestBody(apiUrl, {
      accept: 'application/octet-stream',
      token,
    });
  }
  return requestText(fallbackUrl, token);
}

function requireAsset(assets, predicate, message) {
  const asset = assets.find(predicate);
  if (!asset) throw new Error(message);
  return asset;
}

function readJsonFile(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8').replace(/^\uFEFF/, ''));
  } catch (error) {
    throw new Error(`${label} ${filePath} is not valid JSON: ${error.message}`);
  }
}

function parseJsonText(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} is invalid JSON: ${error.message}`);
  }
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

function platformFingerprint(platform) {
  if (!platform) return '';
  return JSON.stringify({
    name: platform.name,
    url: platform.value.url || '',
    signature: platform.value.signature || '',
  });
}

function platformPayloadFingerprint(platform) {
  if (!platform) return '';
  return JSON.stringify({
    url: platform.value.url || '',
    signature: platform.value.signature || '',
  });
}

function selectWindowsPlatform(windowsPlatforms) {
  return (
    windowsPlatforms.find((platform) => /^windows-[^-]+$/i.test(platform.name)) ||
    windowsPlatforms[0]
  );
}

function validatePubDate(latest, release, diagnostics) {
  if (!latest.pub_date) {
    fail('latest.json is missing pub_date', diagnostics);
  }
  const latestDate = Date.parse(latest.pub_date);
  if (Number.isNaN(latestDate)) {
    fail(`latest.json pub_date is not a valid ISO date: ${latest.pub_date}`, diagnostics);
  }
  if (release.published_at) {
    const releaseDate = Date.parse(release.published_at);
    if (!Number.isNaN(releaseDate)) {
      const driftMs = Math.abs(latestDate - releaseDate);
      if (driftMs > 24 * 60 * 60 * 1000) {
        fail(
          `latest.json pub_date ${latest.pub_date} is more than 24h from release published_at ${release.published_at}`,
          diagnostics,
        );
      }
    }
  }
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

function validateSignatureFormat(signature, assetName, version, diagnostics) {
  const trimmed = String(signature || '').trim();
  if (!trimmed) fail(`latest.json signature for ${assetName} is empty`, diagnostics);
  if (!/^[A-Za-z0-9+/=\r\n]+$/.test(trimmed)) {
    fail(`latest.json signature for ${assetName} is not base64 text`, diagnostics);
  }
  const decoded = Buffer.from(trimmed, 'base64').toString('utf8');
  if (!decoded.includes('untrusted comment:') || !decoded.includes('trusted comment:')) {
    fail(`latest.json signature for ${assetName} is not a minisign signature payload`, diagnostics);
  }
  const fileMatch = decoded.match(/\bfile:\s*([^\r\n]+)/i);
  if (fileMatch) {
    const signedFileName = fileMatch[1].trim().replace(/\s+hashed$/i, '');
    if (!signedFileName.includes(version) || getAssetExtension(signedFileName) !== getAssetExtension(assetName)) {
      fail(
        `latest.json signature file comment ${signedFileName} does not match Windows asset version/type ${assetName}`,
        diagnostics,
      );
    }
  }
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

function getSignatureAssetName(assetName) {
  return `${assetName}.sig`;
}

function requireNonEmptyAsset(asset, message) {
  if (typeof asset.size === 'number' && asset.size <= 0) {
    throw new Error(message);
  }
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
    githubAsset.tag === releaseInfo.tag;
  if (!isSameRelease) return undefined;
  return assets.find((asset) => asset.name === githubAsset.name);
}

function validateArtifactName(assetName, version, allowPortable, diagnostics) {
  const escapedVersion = String(version || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const semvers = assetName.match(/\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?/g) || [];
  if (!escapedVersion || !new RegExp(`(^|[^0-9])${escapedVersion}([^0-9]|$)`).test(assetName)) {
    fail(`Windows updater asset ${assetName} does not include latest.json version ${version}`, diagnostics);
  }
  if (semvers.length !== 1) {
    fail(`Windows updater asset ${assetName} should contain exactly one semver, found ${semvers.length}`, diagnostics);
  }
  if (allowPortable && getAssetExtension(assetName) === '.zip') return;
  if (!/(?:_x64-setup\.exe|\.msi)$/i.test(assetName)) {
    fail(`Windows updater asset ${assetName} should be an x64 setup .exe or .msi`, diagnostics);
  }
}

function validatePlatformAssetUrls(platforms, assets, releaseInfo, diagnostics) {
  for (const platform of platforms) {
    if (!platformHasUrl(platform)) {
      fail(`latest.json platform ${platform.name} is missing a downloadable URL`, diagnostics);
    }
    const url = getPlatformUrl(platform);
    const githubAsset = parseGithubReleaseAssetUrl(url);
    if (!githubAsset) {
      fail(`latest.json platform ${platform.name} URL is not a GitHub release asset URL: ${url}`, diagnostics);
    }
    const sameOwnerRepo =
      githubAsset.owner.toLowerCase() === releaseInfo.owner.toLowerCase() &&
      githubAsset.repo.toLowerCase() === releaseInfo.repo.toLowerCase();
    const sameTag = githubAsset.tag === releaseInfo.tag || githubAsset.tag === 'latest';
    if (!sameOwnerRepo || !sameTag) {
      fail(
        `latest.json platform ${platform.name} URL points outside ${releaseInfo.owner}/${releaseInfo.repo}@${releaseInfo.tag}: ${url}`,
        diagnostics,
      );
    }
    const asset = findAssetForUrl(assets, url, releaseInfo);
    if (!asset) {
      fail(`latest.json platform ${platform.name} URL does not match a release asset: ${url}`, diagnostics);
    }
    requireNonEmptyAsset(asset, `Release asset ${asset.name} for platform ${platform.name} is empty`);
  }
}

function validateSignatureAsset(assets, packageAsset, diagnostics) {
  const signatureAssetName = getSignatureAssetName(packageAsset.name);
  const signatureAsset = assets.find((asset) => asset.name === signatureAssetName);
  if (!signatureAsset) {
    fail(
      `Release asset ${packageAsset.name} is missing sibling updater signature asset ${signatureAssetName}`,
      diagnostics,
    );
  }
  requireNonEmptyAsset(signatureAsset, `Release signature asset ${signatureAssetName} is empty`);
  return signatureAsset;
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

function buildDiagnostics({
  release,
  assets,
  latest,
  platforms,
  windowsPlatform,
  allowPortable,
  latestUrl,
  skipLatestEndpoint,
}) {
  const platformKeys = platforms.map((platform) => platform.name);
  const windowsUrl = windowsPlatform ? getPlatformUrl(windowsPlatform) : '';
  const windowsAssetName = windowsUrl ? getUrlAssetName(windowsUrl) || '(unparseable)' : '(missing)';
  const windowsSigAssetName = windowsAssetName !== '(missing)' && windowsAssetName !== '(unparseable)'
    ? getSignatureAssetName(windowsAssetName)
    : '(missing)';
  return [
    `version/tag: latest.json=${latest && latest.version ? latest.version : '(missing)'}; release=${release && release.tag_name ? release.tag_name : '(missing)'}`,
    `asset names: ${formatList(assets.map((asset) => asset.name))}`,
    `platform keys: ${formatList(platformKeys)}`,
    `Windows platform: ${windowsPlatform ? windowsPlatform.name : '(missing)'}`,
    `Windows url asset: ${windowsAssetName}`,
    `Windows signature asset: ${windowsSigAssetName}`,
    `Windows signature: ${getSignatureStatus(windowsPlatform)}`,
    `package policy: ${getPackagePolicyMessage(allowPortable)}`,
    `release state: draft=${release && release.draft ? 'true' : 'false'}; prerelease=${
      release && release.prerelease ? 'true' : 'false'
    }`,
    `latest endpoint check: ${skipLatestEndpoint ? 'skipped' : 'enabled'}`,
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
  const allowDraft = boolArg(args['allow-draft']);
  const skipLatestEndpoint = boolArg(args['skip-latest-endpoint']);
  const ownerRepo = args['owner-repo'] || process.env.GITHUB_REPOSITORY || 'yq6666-66/codex-clone-launcher';
  const tag = args.tag || process.env.GITHUB_REF_NAME;
  const latestUrl =
    args['latest-url'] || `https://github.com/${ownerRepo}/releases/latest/download/latest.json`;
  const token = process.env.GITHUB_TOKEN || '';
  const [owner, repo] = ownerRepo.split('/');
  if (!owner || !repo) throw new Error(`Invalid owner/repo: ${ownerRepo}`);

  const release = args['release-json']
    ? readJsonFile(args['release-json'], '--release-json')
    : tag
      ? await getReleaseByTag({ owner, repo, tag, token, allowDraft })
      : await requestJson(`https://api.github.com/repos/${owner}/${repo}/releases/latest`, token);
  if (release.draft && !allowDraft) {
    throw new Error(`Release ${release.tag_name} is still a draft; pass --allow-draft only for pre-publish asset checks`);
  }
  if (release.prerelease) throw new Error(`Release ${release.tag_name} is marked prerelease`);

  const assets = Array.isArray(release.assets) ? release.assets : [];
  const assetNames = assets.map((asset) => asset.name);
  const latestAsset = requireAsset(
    assets,
    (asset) => asset.name === 'latest.json',
    `Release ${release.tag_name} is missing latest.json. Asset names: ${formatList(assetNames)}`,
  );

  const latestJsonUrl = latestAsset.browser_download_url || latestUrl;
  const latest = args['latest-json']
    ? readJsonFile(args['latest-json'], '--latest-json')
    : parseJsonText(
        await requestAssetText(latestAsset, latestJsonUrl, token),
        `latest.json from ${latestJsonUrl}`,
      );
  const endpointLatest =
    !args['latest-json'] && !skipLatestEndpoint && latestUrl && latestUrl !== latestJsonUrl
      ? parseJsonText(await requestText(latestUrl, token), `latest.json endpoint ${latestUrl}`)
      : latest;
  const releaseVersion = normalizeVersion(release.tag_name);
  const latestVersion = normalizeVersion(latest.version);
  const platforms = getPlatformEntries(latest);
  const windowsPlatforms = platforms.filter(isWindowsPlatform);
  const windowsPlatform = selectWindowsPlatform(windowsPlatforms);
  const diagnostics = buildDiagnostics({
    release,
    assets,
    latest,
    platforms,
    windowsPlatform,
    allowPortable,
    skipLatestEndpoint,
    latestUrl: latestJsonUrl,
  });
  if (releaseVersion && latestVersion && latestVersion !== releaseVersion) {
    fail(`latest.json version ${latest.version} does not match release ${release.tag_name}`, diagnostics);
  }
  if (!latest.version) fail('latest.json is missing version', diagnostics);
  validatePubDate(latest, release, diagnostics);
  if (platforms.length === 0) {
    fail('latest.json is missing platforms', diagnostics);
  }
  if (!windowsPlatform) {
    fail('latest.json is missing a Windows platform entry', diagnostics);
  }
  const distinctWindowsPayloads = new Set(windowsPlatforms.map(platformPayloadFingerprint));
  if (distinctWindowsPayloads.size > 1) {
    fail(
      `latest.json Windows platform entries point to different updater payloads, found ${windowsPlatforms.length} entries`,
      diagnostics,
    );
  }
  if (!skipLatestEndpoint) {
    const endpointPlatforms = getPlatformEntries(endpointLatest);
    const endpointWindowsPlatforms = endpointPlatforms.filter(isWindowsPlatform);
    const endpointWindowsPlatform = selectWindowsPlatform(endpointWindowsPlatforms);
    if (
      normalizeVersion(endpointLatest.version) !== latestVersion ||
      endpointWindowsPlatforms.length < 1 ||
      platformPayloadFingerprint(endpointWindowsPlatform) !== platformPayloadFingerprint(windowsPlatform)
    ) {
      fail(
        `Configured latest endpoint ${latestUrl} does not match release asset latest.json for ${release.tag_name}`,
        diagnostics,
      );
    }
  }
  if (!platformHasUrl(windowsPlatform)) {
    fail(`latest.json Windows platform ${windowsPlatform.name} is missing a downloadable URL`, diagnostics);
  }
  if (!platformHasSignature(windowsPlatform)) {
    fail(`latest.json Windows platform ${windowsPlatform.name} is missing an updater signature`, diagnostics);
  }
  validatePlatformAssetUrls(platforms, assets, { owner, repo, tag: release.tag_name }, diagnostics);

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
  validateArtifactName(windowsAsset.name, latest.version, allowPortable, diagnostics);
  validateSignatureFormat(windowsPlatform.value.signature, windowsAsset.name, latest.version, diagnostics);
  validateSignatureAsset(assets, windowsAsset, diagnostics);

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
