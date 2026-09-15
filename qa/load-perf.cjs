// Page-load timing against a disposable real server and synthetic account. Build first.
// Use an existing Playwright installation via PLAYWRIGHT_MODULE; no app dependency.
// Measures cold (empty cache) and warm (reload) loads at phone and desktop sizes under
// emulated latency/bandwidth. PERF_ORIGIN=https://… instead times an existing site up to
// its sign-in form without credentials (no account, prompt or write is sent).
// PERF_RUNS (default 3), PERF_RTT_MS (default 150 locally, 0 remote), PERF_KBPS (default 12000 / 0).
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const web = path.resolve(__dirname, '..');
const remote = process.env.PERF_ORIGIN || '';
const origin = remote || 'http://localhost:31241';
const runs = Number(process.env.PERF_RUNS) || (process.env.PERF_TRACE ? 1 : 3);
// A remote origin is measured on the real network unless latency is asked for.
const rtt = Number(process.env.PERF_RTT_MS ?? (remote ? 0 : 150));
const kbps = Number(process.env.PERF_KBPS ?? (remote ? 0 : 12000));
const password = 'synthetic load perf password';

async function throttle(page) {
  if (!rtt && !kbps) return;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  const bytes = kbps ? kbps * 1024 / 8 : -1;
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: rtt, downloadThroughput: bytes, uploadThroughput: bytes });
}

async function measure(page, ready) {
  const requests = [];
  const start = Date.now();
  page.on('requestfinished', async (req) => {
    const sizes = await req.sizes().catch(() => null);
    requests.push({ url: req.url(), bytes: sizes ? sizes.responseBodySize + sizes.responseHeadersSize : 0, at: Date.now() - start, timing: req.timing() });
  });
  await page.goto(origin, { waitUntil: 'commit' });
  // Checked every animation frame inside the page and timed from navigation
  // start; Playwright's own waitFor backs off to 500 ms polls and blurs this.
  const readyMs = Math.round(await (await page.waitForFunction(ready, null, { polling: 'raf', timeout: 60000 })).jsonValue());
  await page.waitForLoadState('networkidle').catch(() => undefined);
  const paint = await page.evaluate(() => {
    const fcp = performance.getEntriesByName('first-contentful-paint')[0];
    const nav = performance.getEntriesByType('navigation')[0];
    return { fcp: fcp ? Math.round(fcp.startTime) : null, dcl: nav ? Math.round(nav.domContentLoadedEventEnd) : null };
  });
  const own = requests.filter((r) => r.url.startsWith(origin));
  if (process.env.PERF_TRACE) for (const r of requests.sort((a, b) => a.timing.startTime - b.timing.startTime)) console.log(`  ${String(Math.round(r.timing.startTime - requests[0].timing.startTime)).padStart(6)}ms start  ${String(r.at).padStart(6)}ms done  ${String(Math.round(r.bytes / 1024)).padStart(4)}KB  ${r.url.replace(origin, '')}`);
  return { ...paint, readyMs, requests: requests.length, ownRequests: own.length, kb: Math.round(requests.reduce((n, r) => n + r.bytes, 0) / 1024) };
}

function median(values) { const v = values.filter((x) => typeof x === 'number').sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : null; }

async function signUp(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(origin);
  await page.getByRole('button', { name: 'Get started', exact: true }).click();
  await page.getByRole('button', { name: 'Chat only', exact: true }).click();
  await page.locator('#wiz-code').fill(fs.readFileSync(path.join(process.env.UI_DATA_DIR_PERF, 'first-run-setup-code'), 'utf8').trim());
  await page.locator('#wiz-username').fill('owner');
  await page.locator('#wiz-password').fill(password);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await page.getByRole('heading', { name: 'Connect an inference provider' }).waitFor();
  const status = await page.evaluate(async () => {
    const csrf = document.cookie.split(';').map((s) => s.trim()).find((s) => s.startsWith('cowork_csrf='))?.slice(12) || '';
    return (await fetch('/api/profile/onboarding', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': decodeURIComponent(csrf) }, body: '{}' })).status;
  });
  if (status !== 200) throw Error(`Could not complete synthetic onboarding: ${status}`);
  const state = await context.storageState();
  await context.close();
  return state;
}

(async () => {
  let server = null;
  const dir = process.env.UI_DATA_DIR_PERF = remote ? '' : (process.env.PERF_DATA_DIR ? fs.mkdtempSync(path.join(process.env.PERF_DATA_DIR, 'load-perf-')) : fs.mkdtempSync(path.join(os.tmpdir(), 'cowork-load-perf-')));
  if (!remote) {
    server = spawn(process.execPath, ['server/index.cjs'], { cwd: web, stdio: 'ignore', env: { ...process.env, UI_DATA_DIR: dir, UI_PORT: '31241', UI_HOST: '127.0.0.1', PUBLIC_ORIGIN: origin, LEGACY_AUTH_COMPAT: 'false', DIARY_AUTH_TOKEN: 'synthetic-only', INFERENCE_BASE_URL: 'http://127.0.0.1:1', DIARY_BASE_URL: 'http://127.0.0.1:1', MODEL_MANAGER_KIND: 'none', MCP_SERVERS: '', MCP_SERVER_URL: '' } });
    for (let i = 0; i < 100; i++) { try { if ((await fetch(origin + '/api/setup/status')).ok) break; } catch {} await new Promise((r) => setTimeout(r, 50)); }
  }
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const storageState = remote ? undefined : await signUp(browser);
    const ready = remote
      ? () => [...document.querySelectorAll('button')].some((b) => /sign in/i.test(b.textContent || '') && b.offsetParent) && performance.now()
      : () => !!document.querySelector('textarea[placeholder="Message noevia…"]')?.offsetParent && performance.now();
    console.log(`origin=${origin} runs=${runs} rtt=${rtt}ms bandwidth=${kbps ? kbps + 'kbps' : 'unthrottled'}`);
    for (const [label, viewport, mobile] of [['phone 375x667', { width: 375, height: 667 }, true], ['desktop 1440x900', { width: 1440, height: 900 }, false]]) {
      const cold = [], warm = [];
      for (let i = 0; i < runs; i++) {
        const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, storageState });
        const page = await context.newPage();
        await throttle(page);
        cold.push(await measure(page, ready));
        const again = await context.newPage();
        await throttle(again);
        warm.push(await measure(again, ready));
        await context.close();
      }
      for (const [kind, rows] of [['cold', cold], ['warm', warm]]) {
        console.log(`${label.padEnd(17)} ${kind}  fcp=${median(rows.map((r) => r.fcp))}ms  ready=${median(rows.map((r) => r.readyMs))}ms  requests=${median(rows.map((r) => r.requests))} (own ${median(rows.map((r) => r.ownRequests))})  transferred=${median(rows.map((r) => r.kb))}KB   [ready runs: ${rows.map((r) => r.readyMs).join(', ')}]`);
      }
    }
  } finally {
    await browser.close();
    if (server) server.kill();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
