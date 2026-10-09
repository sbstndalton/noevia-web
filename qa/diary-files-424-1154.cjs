// #1154 — Diary root listing requested twice per load while storage rejects the read (HTTP 424).
// The overview effect and the file-pane effect both list the Diary root on mount; when the first
// read failed the request cache evicted it at once and the second reader fired a duplicate.
// Synthetic APIs only. Usage:
//   QA_DIST=<dist> QA_PORT=31488 PLAYWRIGHT_MODULE=~/noevia-local-test/node_modules/playwright-core node qa/diary-files-424-1154.cjs
const os = require('node:os');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || `${os.homedir()}/noevia-local-test/node_modules/playwright-core`);
const { withLocale } = require('./qa-locale.cjs');
const { createFixture } = require('./diary-fixture.cjs');
const PORT = Number(process.env.QA_PORT || 31488);
const origin = `http://localhost:${PORT}`;

(async () => {
  const fixture = createFixture(PORT);
  await fixture.listen();
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const failures = [];
  try {
    const page = await browser.newPage(withLocale({ viewport: { width: 1440, height: 900 } }));
    page.setDefaultTimeout(8000);
    let fail = true;
    const seen = [];
    page.on('request', (req) => { const u = new URL(req.url()); if (u.pathname === '/api/diary/files' && u.search === '?path=') seen.push(Date.now()); });
    await page.route(/\/api\/diary\/files\?/, (route) => fail
      ? route.fulfill({ status: 424, json: { error: 'Storage login rejected', code: 'storageLoginRejected' } })
      : route.fulfill({ json: { files: [{ path: 'MEMORY.md', name: 'MEMORY.md', isDir: false }] } }));
    await page.goto(`${origin}/diary`);
    await page.locator('#diary-draft').waitFor();
    await page.waitForTimeout(900);
    const onLoad = seen.length;
    if (onLoad !== 1) failures.push(`expected 1 root listing on a failing load, saw ${onLoad}`);
    // Retry must still refetch once storage recovers: the failure is not cached past an explicit retry.
    fail = false;
    const retry = page.getByRole('alert').getByRole('button', { name: 'Retry file list' });
    const hadRetry = await retry.count() > 0;
    if (hadRetry) { await retry.click(); await page.waitForTimeout(500); }
    console.log('diary-files-424-1154:', JSON.stringify({ onLoad, afterRetry: seen.length }));
    if (!hadRetry) failures.push('no retry control was shown for the failed listing');
    else if (seen.length < 2) failures.push('an explicit retry did not refetch the listing');
  } finally {
    await browser.close();
    await fixture.close?.();
  }
  if (failures.length) { console.log('diary-files-424-1154: FAIL'); failures.forEach((f) => console.log(' -', f)); process.exitCode = 1; }
  else console.log('diary-files-424-1154: ok');
})().catch((e) => { console.error(e); process.exitCode = 1; });
