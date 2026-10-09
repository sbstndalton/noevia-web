// #1168 — a storage throttle (503 storageThrottled, retryAfter) is worded with its wait, an
// explicit Retry press sends X-Cowork-Storage-Retry: 1, and no automatic read ever does.
// Synthetic APIs only.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const { withLocale } = require('./qa-locale.cjs');
const { createFixture } = require('./diary-fixture.cjs');
const PORT = Number(process.env.QA_PORT || 31489);

(async () => {
  const fixture = createFixture(PORT); await fixture.listen();
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const page = await browser.newPage(withLocale({ viewport: { width: 1440, height: 900 } }));
    page.setDefaultTimeout(8000);
    let throttled = true;
    const reads = [];
    await page.route(/\/api\/diary\/files\?/, (route) => {
      reads.push(route.request().headers()['x-cowork-storage-retry'] || null);
      return throttled
        ? route.fulfill({ status: 503, headers: { 'Retry-After': '42' }, json: { error: 'Storage is limiting sign-ins.', code: 'storageThrottled', retryAfter: 42 } })
        : route.fulfill({ json: { files: [{ path: 'MEMORY.md', name: 'MEMORY.md', isDir: false }] } });
    });
    await page.goto(`http://localhost:${PORT}/diary`);
    await page.locator('#diary-draft').waitFor();
    const alert = page.getByRole('alert').filter({ has: page.getByRole('button', { name: 'Retry file list' }) });
    await alert.waitFor();
    assert.match(await alert.innerText(), /Try again in 42 seconds/, 'the wait is shown');
    assert.ok(reads.length >= 1 && reads.every((h) => h === null), 'automatic reads sent no retry header: ' + JSON.stringify(reads));
    const before = reads.length;
    await alert.getByRole('button', { name: 'Retry file list' }).click();
    await page.waitForTimeout(600);
    assert.equal(reads.length, before + 1, 'the Retry press made one read');
    assert.equal(reads.at(-1), '1', 'and it carried X-Cowork-Storage-Retry: 1');
    // After the explicit read, later automatic reads (a folder change, a revision bump) go without it.
    throttled = false;
    await alert.getByRole('button', { name: 'Retry file list' }).click();
    await page.waitForTimeout(600);
    assert.equal(reads.at(-1), '1');
    const marker = reads.length;
    await page.reload(); await page.locator('#diary-draft').waitFor(); await page.waitForTimeout(600);
    assert.ok(reads.length > marker && reads.slice(marker).every((h) => h === null), 'a fresh load is automatic again: ' + JSON.stringify(reads.slice(marker)));
    console.log('PASS diary-storage-throttle-1168');
  } finally { await browser.close(); await fixture.close?.(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
