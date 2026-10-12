// #1443: the Diary storage block said "Your existing diary still uses its original storage" and offered
// "Preview import into noevia" even when the diary already lives on connected Nextcloud (owner decision
// 2026-10-12/13: WebDAV and S3 too). The offer is shown only for old local storage.
// Synthetic UI only: the storage connection and the sidecar status are stubbed; no real server is reached.
//   PLAYWRIGHT_MODULE=<playwright-core> QA_DIST=<dist dir> node qa/diary-import-offer-1443.cjs
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || `${process.env.HOME}/noevia-local-test/node_modules/playwright-core`);
const { navClick } = require('./nav.cjs');
const { createFixture } = require('./diary-fixture.cjs');

const PORT = Number(process.env.QA_PORT || 31443);
const SHOTS = process.env.QA_SHOTS || '';
const connection = {
  local: { kind: 'local', corpusRoot: '' },
  nextcloud: { kind: 'nextcloud', baseUrl: 'https://cloud.example.invalid/remote.php/dav/files/synthetic', username: 'synthetic', corpusRoot: 'Documents/Diary', secretConfigured: true },
  webdav: { kind: 'webdav', baseUrl: 'https://dav.example.invalid/files', username: 'synthetic', corpusRoot: 'Diary', secretConfigured: true },
  s3: { kind: 's3', baseUrl: 'https://s3.example.invalid', bucket: 'synthetic-bucket', region: 'us-east-1', username: 'synthetic', corpusRoot: 'Diary', secretConfigured: true },
};

(async () => {
  const fixture = createFixture(PORT);
  await fixture.listen();
  const browser = await chromium.launch({ headless: true, ...(process.env.QA_CHROME_PATH ? { executablePath: process.env.QA_CHROME_PATH } : { channel: 'chrome' }) });
  const results = [];
  const check = async (name, fn) => {
    try { await fn(); results.push([name, null]); console.log(`PASS diary-import-offer-1443: ${name}`); }
    catch (e) { results.push([name, e]); console.log(`FAIL diary-import-offer-1443: ${name}\n  ${String(e.message).split('\n').slice(0, 8).join('\n  ')}`); }
  };
  const open = async (kind) => {
    const page = await browser.newPage();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.route('**/api/integrations/storage', (r) => r.request().method() === 'GET' ? r.fulfill({ json: connection[kind] }) : r.continue());
    let statusReads = 0;
    await page.route('**/api/diary/storage-status', (r) => { statusReads += 1; return r.fulfill({ json: { mode: 'legacy', backup: 'not_configured', lastBackedUp: null } }); });
    await page.goto(`http://localhost:${PORT}`);
    await navClick(page, 'Diary');
    // The block renders nothing when the offer is hidden, so wait for it to exist, not to be visible.
    await page.locator('.diary-backup-status').waitFor({ state: 'attached', timeout: 20000 });
    // Both reads must have happened before "hidden" means anything.
    await page.waitForFunction(() => document.body.innerText.length > 0);
    for (let i = 0; i < 100 && statusReads === 0; i += 1) await page.waitForTimeout(100);
    assert.ok(statusReads > 0, 'the sidecar status was read');
    await page.waitForTimeout(1500);
    return page;
  };
  try {
    await check('#1443 an old local diary is offered the import', async () => {
      const page = await open('local');
      const panel = page.locator('.diary-backup-status');
      await panel.getByText('Your existing diary still uses its original storage').waitFor({ timeout: 10000 });
      assert.equal(await panel.getByRole('button', { name: 'Preview import into noevia' }).count(), 1);
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'diary-import-offer-local.png') });
      await page.close();
    });
    for (const kind of ['nextcloud', 'webdav', 's3']) {
      await check(`#1443 a diary on connected ${kind} storage is not offered the import`, async () => {
        const page = await open(kind);
        const panel = page.locator('.diary-backup-status');
        assert.equal(await panel.getByText('Your existing diary still uses its original storage').count(), 0, 'no "original storage" prompt');
        assert.equal(await panel.getByRole('button', { name: 'Preview import into noevia' }).count(), 0, 'no Preview import button');
        assert.equal(await panel.getByText('Copy it into noevia').count(), 0, 'no copy note');
        if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `diary-import-offer-${kind}.png`) });
        await page.close();
      });
    }
  } finally {
    await browser.close();
    await fixture.close();
  }
  const failed = results.filter(([, e]) => e);
  console.log(`\ndiary-import-offer-1443: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exitCode = 1;
})().catch((e) => { console.error(e); process.exitCode = 1; });
