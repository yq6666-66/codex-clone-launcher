const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const DEFAULT_URL = 'http://127.0.0.1:5177/';
const targetUrl = process.env.UI_REGRESSION_URL || DEFAULT_URL;
const outDir =
  process.env.UI_REGRESSION_OUT_DIR ||
  path.join(os.tmpdir(), 'codex-clone-ui-regression', new Date().toISOString().replace(/[:.]/g, '-'));

const labels = {
  title: '\u672c\u5730\u5206\u8eab\u5de5\u4f5c\u53f0',
  app: 'Codex \u5206\u8eab\u542f\u52a8\u5668',
  createNav: '\u521b\u5efa Codex',
  listNav: 'Codex \u5217\u8868',
  settingsNav: '\u8bbe\u7f6e',
  guideNav: '\u64cd\u4f5c\u8bf4\u660e',
  create: '\u521b\u5efa',
  account: '\u8d26\u53f7',
  syncPackage: '\u540c\u6b65\u5305',
  update: '\u66f4\u65b0',
  diagnostics: '\u8bca\u65ad',
  dark: '\u6df1\u8272',
  light: '\u6d45\u8272',
  guideA: '\u64cd\u4f5c',
  guideB: '\u8bf4\u660e',
};

function requestOnce(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(res.statusCode && res.statusCode >= 200 && res.statusCode < 500);
    });
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
    req.on('error', () => resolve(false));
  });
}

async function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await requestOnce(url)) return true;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return false;
}

async function ensureServer() {
  if (await waitForServer(targetUrl, 1500)) return null;
  const url = new URL(targetUrl);
  if (url.hostname !== '127.0.0.1' || url.port !== '5177') {
    throw new Error(`No server is running at ${targetUrl}; auto-start only supports ${DEFAULT_URL}`);
  }
  const { createServer, preview } = await import('vite');
  const distIndex = path.join(process.cwd(), 'dist', 'index.html');
  const usePreview = fs.existsSync(distIndex);
  const server = usePreview
    ? await preview({
        preview: {
          host: '127.0.0.1',
          port: 5177,
          strictPort: true,
        },
      })
    : await createServer({
        server: {
          host: '127.0.0.1',
          port: 5177,
          strictPort: true,
        },
      });
  if (!usePreview) await server.listen();
  if (!(await waitForServer(targetUrl, 20000))) {
    await closeViteServer(server);
    throw new Error(`Timed out waiting for ${targetUrl}`);
  }
  return server;
}

async function closeViteServer(server) {
  if (typeof server.close === 'function') {
    await server.close();
    return;
  }
  if (server.httpServer && typeof server.httpServer.close === 'function') {
    await new Promise((resolve, reject) => {
      server.httpServer.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

async function snapshotPage(page, name) {
  await page.screenshot({ path: path.join(outDir, `${name}.png`), fullPage: true });
  return (await page.locator('body').innerText()).replace(/\s+/g, ' ').trim();
}

async function visibleClick(page, text) {
  const locator = page.getByRole('button', { name: text }).first();
  await locator.waitFor({ state: 'visible', timeout: 5000 });
  await locator.click();
  await page.waitForTimeout(400);
}

async function runViewport(chromium, name, viewport, consoleEvents) {
  const page = await chromium.launch({ headless: true }).then((browser) => browser.newPage({ viewport }).then((newPage) => {
    newPage.__browser = browser;
    return newPage;
  }));
  page.on('console', (message) => {
    if (['error', 'warning'].includes(message.type())) {
      consoleEvents.push(`${name}: ${message.type()}: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => consoleEvents.push(`${name}: pageerror: ${error.message}`));

  try {
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.getByText(labels.app).first().waitFor({ state: 'visible', timeout: 15000 });
    const title = await page.title();
    const dashboardText = await snapshotPage(page, `${name}-dashboard`);
    if (!title.includes(labels.title)) throw new Error(`${name}: unexpected title ${JSON.stringify(title)}`);
    if (!dashboardText.includes(labels.app) || dashboardText.length < 100) {
      throw new Error(`${name}: dashboard did not render meaningful app content`);
    }

    await visibleClick(page, labels.createNav);
    const createText = await snapshotPage(page, `${name}-create`);
    if (!createText.includes(labels.create) || !createText.includes(labels.account)) {
      throw new Error(`${name}: create page missing expected content`);
    }

    await visibleClick(page, labels.listNav);
    const listText = await snapshotPage(page, `${name}-list`);
    if (!listText.includes('Codex') || !listText.includes(labels.syncPackage)) {
      throw new Error(`${name}: list page missing expected content`);
    }

    await visibleClick(page, labels.settingsNav);
    const settingsText = await snapshotPage(page, `${name}-settings`);
    if (!settingsText.includes(labels.update) || !settingsText.includes(labels.diagnostics)) {
      throw new Error(`${name}: settings page missing updater or diagnostics content`);
    }

    await visibleClick(page, labels.dark);
    const darkTheme = await page.locator('html').evaluate((element) => element.getAttribute('data-theme'));
    await page.screenshot({ path: path.join(outDir, `${name}-dark-theme.png`), fullPage: true });
    if (darkTheme !== 'dark') throw new Error(`${name}: dark theme did not apply; data-theme=${darkTheme}`);

    await visibleClick(page, labels.light);
    const lightTheme = await page.locator('html').evaluate((element) => element.getAttribute('data-theme'));
    if (lightTheme !== 'light') throw new Error(`${name}: light theme did not apply; data-theme=${lightTheme}`);

    await visibleClick(page, labels.guideNav);
    const guideText = await snapshotPage(page, `${name}-guide`);
    if (!guideText.includes(labels.guideA) && !guideText.includes(labels.guideB)) {
      throw new Error(`${name}: guide page missing expected content`);
    }

    const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    return {
      name,
      viewport,
      title,
      dashboardTextLength: dashboardText.length,
      horizontalOverflow,
      url: page.url(),
    };
  } finally {
    const browser = page.__browser;
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  let server = null;
  try {
    server = await ensureServer();
    const { chromium } = require('playwright');
    const consoleEvents = [];
    const results = [
      await runViewport(chromium, 'desktop', { width: 1440, height: 1000 }, consoleEvents),
      await runViewport(chromium, 'mobile', { width: 390, height: 844 }, consoleEvents),
    ];
    const relevantConsoleEvents = consoleEvents.filter((line) => !line.includes('Download the React DevTools'));
    if (relevantConsoleEvents.length) {
      throw new Error(`Console issues:\n${relevantConsoleEvents.join('\n')}`);
    }
    console.log(JSON.stringify({ ok: true, url: targetUrl, outDir, results }, null, 2));
  } finally {
    if (server) await closeViteServer(server);
  }
}

main().catch((error) => {
  const message = String(error && error.stack ? error.stack : error);
  if (message.includes('Executable doesn')) {
    console.error(`${message}\n\nInstall Playwright browsers with: npx playwright install chromium`);
  } else {
    console.error(message);
  }
  process.exit(1);
});
