const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const PORT = Number(process.env.UI_WORKFLOW_PORT || 5178);
const targetUrl = process.env.UI_WORKFLOW_URL || `http://127.0.0.1:${PORT}/`;
const outDir =
  process.env.UI_WORKFLOW_OUT_DIR ||
  path.join(os.tmpdir(), 'codex-clone-ui-workflows', new Date().toISOString().replace(/[:.]/g, '-'));

const browserFallbackReason =
  'Browser invocation failed: codex/sandbox-state-meta: missing field sandboxPolicy; using Playwright against Vite with Tauri mock IPC.';

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

async function closeViteServer(server) {
  if (!server) return;
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

async function ensureServer() {
  if (await waitForServer(targetUrl, 1500)) return null;
  const url = new URL(targetUrl);
  if (url.hostname !== '127.0.0.1' || Number(url.port) !== PORT) {
    throw new Error(`No server is running at ${targetUrl}; auto-start only supports ${PORT}`);
  }
  process.env.VITE_TAURI_E2E_MOCKS = '1';
  const { createServer } = await import('vite');
  const server = await createServer({
    server: {
      host: '127.0.0.1',
      port: PORT,
      strictPort: true,
    },
  });
  await server.listen();
  if (!(await waitForServer(targetUrl, 20000))) {
    await closeViteServer(server);
    throw new Error(`Timed out waiting for ${targetUrl}`);
  }
  return server;
}

async function screenshot(page, name) {
  const file = path.join(outDir, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  return file;
}

async function bodyText(page) {
  return (await page.locator('body').innerText()).replace(/\s+/g, ' ').trim();
}

async function clickButton(pageOrLocator, name) {
  const button = pageOrLocator.getByRole('button', { name });
  const count = await button.count();
  if (count !== 1) throw new Error(`Expected one button ${JSON.stringify(name)}, found ${count}`);
  await button.click();
}

async function clickFirstButton(pageOrLocator, name) {
  const button = pageOrLocator.getByRole('button', { name }).first();
  await button.waitFor({ state: 'visible', timeout: 8000 });
  await button.click();
}

async function waitForText(page, text, timeout = 10000) {
  await page.getByText(text).first().waitFor({ state: 'visible', timeout });
}

async function runDesktopWorkflow(chromium, consoleEvents, screenshots) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('console', (message) => {
    if (['error', 'warning'].includes(message.type())) {
      consoleEvents.push(`desktop: ${message.type()}: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => consoleEvents.push(`desktop: pageerror: ${error.message}`));

  try {
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await waitForText(page, 'Codex 分身启动器');
    screenshots.push(await screenshot(page, 'desktop-dashboard'));

    await clickFirstButton(page, 'Codex 列表');
    await clickFirstButton(page, '提取/刷新本体');
    await waitForText(page, '同步包就绪');
    await clickFirstButton(page, 'Preflight');
    await waitForText(page, 'manifest path');
    screenshots.push(await screenshot(page, 'desktop-sync-package-ready'));

    await clickFirstButton(page, '创建 Codex');
    await page.locator('input[name="clone-name"]').fill('E2E Clone');
    await page.locator('input[name="clone-base-url"]').fill('http://127.0.0.1:65535/v1');
    await page.locator('input[name="clone-api-key"]').fill('sk-e2e-test-key-000000000000');
    await page.locator('input[name="clone-inherit-local-data"]').check();
    await clickFirstButton(page, '创建并启动 Codex');
    await waitForText(page, 'E2E Clone');
    screenshots.push(await screenshot(page, 'desktop-created-clone'));

    const row = page.locator('.table-row').filter({ hasText: 'E2E Clone' });
    await row.waitFor({ state: 'visible', timeout: 10000 });
    await clickButton(row, '同步/修复');
    await waitForText(page, '已应用本体同步包');
    screenshots.push(await screenshot(page, 'desktop-sync-repaired'));

    await clickButton(row, '更多操作');
    await clickFirstButton(page, '导出能力快照');
    await waitForText(page, '分身能力快照已导出');

    await clickFirstButton(page, '设置');
    await clickFirstButton(page, '检查更新');
    await waitForText(page, '检查更新失败');
    await waitForText(page, 'latest.json missing updater signature');
    await page.locator('.settings-diagnostics button').first().click();
    await waitForText(page, '[redacted-api-key]');
    await waitForText(page, 'Bearer [redacted]');
    screenshots.push(await screenshot(page, 'desktop-update-failure'));

    const state = await page.evaluate(() => window.__CODEX_CLONE_E2E_STATE__);
    const commands = state?.calls?.map((call) => call.cmd) ?? [];
    for (const expected of [
      'codex_extract_sync_package',
      'codex_sync_package_preflight',
      'codex_create_clone_and_launch',
      'codex_history_repair',
      'codex_export_clone_capability_snapshot',
      'plugin:updater|check',
    ]) {
      if (!commands.includes(expected)) throw new Error(`Missing mocked Tauri command call: ${expected}`);
    }

    const text = await bodyText(page);
    for (const secret of [
      'sk-e2e-diagnostics-000000000000',
      'sk-e2e-standalone-000000000000',
      'e2e-secret-token-000000000000',
    ]) {
      if (text.includes(secret)) throw new Error(`Diagnostics UI leaked secret token: ${secret}`);
    }
    return {
      title: await page.title(),
      textLength: text.length,
      commandCount: commands.length,
      exercisedCommands: commands.filter((cmd) =>
        [
          'codex_extract_sync_package',
          'codex_sync_package_preflight',
          'codex_create_clone_and_launch',
          'codex_history_repair',
          'codex_export_clone_capability_snapshot',
          'plugin:updater|check',
        ].includes(cmd),
      ),
    };
  } finally {
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

async function runMobileSmoke(chromium, consoleEvents, screenshots) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('console', (message) => {
    if (['error', 'warning'].includes(message.type())) {
      consoleEvents.push(`mobile: ${message.type()}: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => consoleEvents.push(`mobile: pageerror: ${error.message}`));

  try {
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await waitForText(page, 'Codex 分身启动器');
    await clickFirstButton(page, 'Codex 列表');
    await waitForText(page, '本体同步包');
    await clickFirstButton(page, '设置');
    await waitForText(page, '应用更新');
    screenshots.push(await screenshot(page, 'mobile-settings'));

    const horizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    if (horizontalOverflow) throw new Error('mobile viewport has horizontal overflow');
    return {
      title: await page.title(),
      horizontalOverflow,
      textLength: (await bodyText(page)).length,
    };
  } finally {
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
    const screenshots = [];
    const desktop = await runDesktopWorkflow(chromium, consoleEvents, screenshots);
    const mobile = await runMobileSmoke(chromium, consoleEvents, screenshots);
    const relevantConsoleEvents = consoleEvents.filter((line) => !line.includes('Download the React DevTools'));
    if (relevantConsoleEvents.length) {
      throw new Error(`Console issues:\n${relevantConsoleEvents.join('\n')}`);
    }
    console.log(
      JSON.stringify(
        {
          ok: true,
          url: targetUrl,
          outDir,
          browserFallbackReason,
          desktop,
          mobile,
          screenshots,
        },
        null,
        2,
      ),
    );
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
