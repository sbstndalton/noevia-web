// #1828: Settings -> Models -> Routing (/models?section=routing) showed the Creative row without the note the overview
// has (#1816): "Used only when it's already loaded, to avoid swapping models." The Routing panel must show the same text.
// Synthetic only: every /api read is stubbed. Fails on a build without the fix.
//   npm run build -- --outDir ../dist-after
//   PLAYWRIGHT_MODULE=<playwright-core> QA_CHROME_PATH=<Chrome> QA_DIST=../dist-after [QA_SHOTS=dir] node qa/routing-creative-note-1828.cjs
const os = require('node:os');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || `${os.homedir()}/noevia-local-test/node_modules/playwright-core`);
const { createFixture } = require('./diary-fixture.cjs');
const { withLocale } = require('./qa-locale.cjs');

const SHOTS = process.env.QA_SHOTS || '';
const NOTE = "Used only when it's already loaded, to avoid swapping models.";
const installed = ['syn-fast-q4', 'syn-smart-q4', 'syn-creative-q4'].map((name) => ({ name, labels: [], loaded: name === 'syn-fast-q4', sizeGB: 3, source: 'cache', status: name === 'syn-fast-q4' ? 'loaded' : 'unloaded' }));

async function open(browser, origin, { width, height, theme }) {
  const page = await browser.newPage(withLocale({ viewport: { width, height } }));
  page.setDefaultTimeout(10000);
  await page.addInitScript((th) => { try { localStorage.setItem('cowork-theme', th); } catch { /* ignore */ } }, theme);
  await page.route('**/api/**', (route) => {
    const p = new URL(route.request().url()).pathname;
    const json = (b, status = 200) => route.fulfill({ status, json: b });
    if (p === '/api/profile' || p === '/api/auth/session') return json({ user: { id: 'qa', username: 'admin', displayName: 'Synthetic admin', role: 'admin', diaryEnabled: false, onboarded: true }, passkeys: [] });
    if (p === '/api/auto-roles') return json({ configured: true, roles: { fast: 'syn-fast-q4', smart: 'syn-smart-q4', creative: 'syn-creative-q4' }, missing: [] });
    if (p === '/api/routing-default') return json({ routing: 'auto' });
    if (p === '/api/routing-mode') return json({ enabled: false });
    if (p === '/api/models/capabilities') return json({ kind: 'llamacpp', admin: true, presets: true, download: true, runtimeOptions: false, modelManagement: true });
    if (p === '/api/models/installed') return json(installed);
    if (p.startsWith('/api/model-manager/') || p.startsWith('/api/models/')) return json({});
    return route.continue();
  });
  await page.goto(`${origin}/models?section=routing`);
  const root = page.locator('.model-manager-page');
  await root.waitFor();
  return { page, root };
}

(async () => {
  const fixture = createFixture(0);
  let browser = null, failed = 0;
  try {
    await fixture.listen();
    browser = await chromium.launch({ headless: true, ...(process.env.QA_CHROME_PATH ? { executablePath: process.env.QA_CHROME_PATH } : { channel: 'chrome' }) });
    const origin = `http://127.0.0.1:${fixture.server.address().port}`;
    for (const [width, height, theme] of [[2000, 1100, 'light'], [2000, 1100, 'dark'], [390, 844, 'light'], [390, 844, 'dark']]) {
      const name = `Routing panel Creative row carries the swap note (${width} px ${theme})`;
      try {
        const { page, root } = await open(browser, origin, { width, height, theme });
        const row = root.locator('.route-roles label').filter({ hasText: /^\s*Creative/ });
        await row.locator('select').waitFor();
        const note = row.getByTestId('routing-creative-note');
        assert.equal(await note.count(), 1, 'the Creative row has the note');
        assert.equal((await note.textContent()).trim(), NOTE);
        assert.equal(await root.locator('.route-roles').getByText(NOTE).count(), 1, 'only the Creative row has it');
        await note.scrollIntoViewIfNeeded();
        assert.ok(await note.isVisible(), 'the note is visible');
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no sideways scroll');
        if (SHOTS) await row.screenshot({ path: `${SHOTS}/1828-routing-creative-${width}-${theme}.png` });
        if (SHOTS) await page.screenshot({ path: `${SHOTS}/1828-routing-page-${width}-${theme}.png` });
        await page.close();
        console.log(`PASS routing-creative-note-1828: ${name}`);
      } catch (e) { failed++; console.log(`FAIL routing-creative-note-1828: ${name}\n  ${String(e.message).split('\n').slice(0, 3).join('\n  ')}`); }
    }
  } finally { await Promise.allSettled([browser?.close(), fixture.close()]); }
  if (failed) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
