// #1198 — every "Retry file list" press must reach the Diary as its own GET /api/diary/files carrying
// X-Cowork-Storage-Retry: 1, while the load and the failure that follows it carry no such header.
// Live evidence: three presses produced one request at the Diary. Synthetic APIs only. Usage:
//   QA_DIST=<dist> QA_PORT=31489 QA_SPACING_MS=2000,2000 PLAYWRIGHT_MODULE=<playwright-core> node qa/diary-retry-file-list-1198.cjs
const os = require('node:os');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || `${os.homedir()}/noevia-local-test/node_modules/playwright-core`);
const { withLocale } = require('./qa-locale.cjs');
const { createFixture } = require('./diary-fixture.cjs');
const PORT = Number(process.env.QA_PORT || 31489);
const origin = `http://localhost:${PORT}`;
// Gaps between presses (live test: ~40 s, then <30 s; shortened here, still past the 1.5 s failure cache).
const gaps = (process.env.QA_SPACING_MS || '2000,2000').split(',').map(Number);

(async () => {
  const fixture = createFixture(PORT);
  await fixture.listen();
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const failures = [];
  try {
    const page = await browser.newPage(withLocale({ viewport: { width: 1440, height: 900 } }));
    page.setDefaultTimeout(8000);
    const seen = [];
    page.on('request', (req) => {
      const u = new URL(req.url());
      if (u.pathname === '/api/diary/files' && u.search === '?path=') seen.push(req.headers()['x-cowork-storage-retry'] ?? null);
    });
    // The fixture Diary keeps refusing the storage login, as it does live.
    await page.route(/\/api\/diary\/files\?/, (route) => route.fulfill({ status: 424, json: { error: 'Storage login rejected', code: 'storageLoginRejected' } }));
    await page.goto(`${origin}/diary`);
    await page.locator('#diary-draft').waitFor();
    await page.waitForTimeout(900);
    const onLoad = seen.length;
    const perPress = [];
    for (let press = 0; press < 3; press++) {
      if (press) await page.waitForTimeout(gaps[press - 1] ?? 2000);
      const button = page.getByRole('alert').getByRole('button', { name: 'Retry file list' });
      await button.waitFor();
      const before = seen.length;
      await button.click();
      await page.waitForTimeout(700);
      perPress.push(seen.slice(before));
    }
    console.log('diary-retry-file-list-1198:', JSON.stringify({ onLoad, headers: seen, perPress }));
    if (onLoad !== 1) failures.push(`expected 1 root listing on load, saw ${onLoad}`);
    if (seen.slice(0, onLoad).some((h) => h)) failures.push('the automatic load carried the storage-retry header');
    perPress.forEach((reqs, i) => {
      if (reqs.length !== 1) failures.push(`press ${i + 1} sent ${reqs.length} requests, expected 1`);
      else if (reqs[0] !== '1') failures.push(`press ${i + 1} did not carry X-Cowork-Storage-Retry: 1 (saw ${reqs[0]})`);
    });
  } finally {
    await browser.close();
    await fixture.close?.();
  }
  if (failures.length) { console.log('diary-retry-file-list-1198: FAIL'); failures.forEach((f) => console.log(' -', f)); process.exitCode = 1; }
  else console.log('diary-retry-file-list-1198: ok');
})().catch((e) => { console.error(e); process.exitCode = 1; });
