'use strict';
// #1858: the PDF-indexing problems toast never covers the composer, is one line with a count until opened,
// and once dismissed stays away for the session (per-tab sessionStorage, which may be blocked). Synthetic APIs.
//   PLAYWRIGHT_MODULE=<playwright> QA_DIST=<dist> QA_CORE_SERVER=<core server/> [QA_SHOTS=<dir>] node qa/indexing-toast-1858.cjs
// Fails on a build without the change (the toast sits over the composer and lists every file), passes with it.
const os = require('node:os');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || `${os.homedir()}/noevia-local-test/node_modules/playwright-core`);
const { createFixture } = require('./diary-fixture.cjs');
const { withLocale } = require('./qa-locale.cjs');
const PORT = Number(process.env.QA_PORT || 31858);
const SHOTS = process.env.QA_SHOTS || '';
const skipped = (prefix) => ['a', 'b', 'c', 'd'].map((n) => ({ folder: '/Synthetic', file: `${prefix}-${n}.pdf`, reason: 'No text could be read from this PDF.' }));

const overlaps = (a, b) => a && b && a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

(async () => {
  const fixture = createFixture(PORT); await fixture.listen();
  const browser = await chromium.launch({ headless: true, ...(process.env.QA_CHROME_PATH ? { executablePath: process.env.QA_CHROME_PATH } : { channel: 'chrome' }) });
  let failed = 0;
  try {
    for (const [width, height, theme, blocked] of [[2000, 1250, 'light', false], [2000, 1250, 'dark', false], [390, 844, 'light', false], [390, 844, 'dark', true]]) {
      const tag = `${width} px ${theme}${blocked ? ' (sessionStorage blocked)' : ''}`;
      const page = await browser.newPage(withLocale({ viewport: { width, height } }));
      const errors = []; page.on('pageerror', (e) => errors.push(e.message));
      await page.addInitScript(([th, block]) => {
        try { localStorage.setItem('cowork-theme', th); } catch { /* ignore */ }
        if (block) {
          const real = Storage.prototype;
          const keep = new Set(['cowork-new-account']);
          const get = real.getItem, set = real.setItem;
          real.setItem = function (k, v) { if (String(k).startsWith('noevia:skipped-dismissed')) throw new DOMException('blocked', 'SecurityError'); return set.call(this, k, v); };
          real.getItem = function (k) { if (String(k).startsWith('noevia:skipped-dismissed')) throw new DOMException('blocked', 'SecurityError'); return get.call(this, k); };
          void keep;
        }
      }, [theme, blocked]);
      let syncs = 0, set = 'first';
      const project = { id: 'p-syn', name: 'Synthetic project', goal: '', instructions: '', memories: [], files: [], assets: [], sourceFolders: ['/Synthetic'], modes: ['chat'], toolboxes: ['core'], createdAt: 1000, updatedAt: 1000, chats: [{ id: 'c-syn', title: 'Synthetic chat', preview: 'hello', updatedAt: 2000 }] };
      await page.route('**/api/**', (route) => {
        const req = route.request(), p = new URL(req.url()).pathname;
        const json = (b, status = 200) => route.fulfill({ status, json: b });
        if (p === '/api/workspace') return json({ projects: [project], freeChats: [] });
        if (p === '/api/projects/p-syn/sources/sync') { syncs++; return json({ files: [], skipped: skipped(set) }); }
        if (/^\/api\/chats\/[^/]+\/history$/.test(p)) return json({ history: [], revision: '0' });
        if (/^\/api\/chats\/[^/]+\/context$/.test(p)) return json({ project });
        return route.fallback();
      });
      const check = async (name, fn) => { try { await fn(); console.log(`PASS indexing-toast-1858: ${tag}: ${name}`); } catch (e) { failed++; console.log(`FAIL indexing-toast-1858: ${tag}: ${name}\n  ${String(e.message).split('\n').slice(0, 4).join('\n  ')}`); } };
      await page.goto(`http://localhost:${PORT}/c/c-syn`);
      const composer = page.getByRole('textbox', { name: /message/i }).first();
      await composer.waitFor({ timeout: 15000 });
      const toast = page.locator('.save-error-storage');
      const composerBoxes = async () => page.evaluate(() => {
        const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; };
        return [r(document.querySelector('.composer')), r(document.querySelector('.composer textarea')), r(document.querySelector('.send-btn')), ...[...document.querySelectorAll('.composer-mode-row button, .composer-add')].map(r)].filter(Boolean);
      });
      await check('the toast is one line with a count and does not cover the composer', async () => {
        await toast.waitFor({ timeout: 10000 });
        assert.equal((await toast.locator('.save-error-summary').innerText()).trim(), '4 files have indexing problems');
        assert.equal(await toast.locator('.save-error-list').count(), 0, 'the list is collapsed');
        const box = await toast.boundingBox();
        assert.ok(box.height < 90, `one line, got ${box.height}px high`);
        for (const b of await composerBoxes()) assert.ok(!overlaps(box, b), `the toast ${JSON.stringify(box)} covers ${JSON.stringify(b)}`);
        if (SHOTS) await page.screenshot({ path: `${SHOTS}/1858-collapsed-${width}-${theme}.png` });
      });
      await check('opening it lists the files, still clear of the composer', async () => {
        await toast.getByRole('button', { name: 'Show' }).click();
        await toast.locator('.save-error-list li').first().waitFor();
        assert.equal(await toast.locator('.save-error-list li').count(), 4);
        const box = await toast.boundingBox();
        for (const b of await composerBoxes()) assert.ok(!overlaps(box, b), `the open toast ${JSON.stringify(box)} covers ${JSON.stringify(b)}`);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no sideways scroll');
        if (SHOTS) await page.screenshot({ path: `${SHOTS}/1858-open-${width}-${theme}.png` });
      });
      await check('dismissed, it does not come back in this session (new problems, focus, reload)', async () => {
        await toast.getByRole('button', { name: 'Dismiss' }).click();
        await toast.waitFor({ state: 'detached', timeout: 3000 });
        set = 'second'; const before = syncs;
        await page.evaluate(() => window.dispatchEvent(new Event('online')));
        await page.evaluate(() => window.dispatchEvent(new Event('focus')));
        for (let i = 0; i < 60 && syncs === before; i++) await page.waitForTimeout(50);
        await page.waitForTimeout(600);
        assert.equal(await toast.count(), 0, 'no toast after the next sync');
        await page.reload();
        await composer.waitFor({ timeout: 15000 });
        for (let i = 0; i < 40 && syncs <= before; i++) await page.waitForTimeout(50);
        await page.waitForTimeout(800);
        if (!blocked) assert.equal(await toast.count(), 0, 'no toast after a reload in the same session');
        assert.deepEqual(errors, []);
      });
      await page.close();
    }
  } finally { await browser.close(); await fixture.close(); }
  console.log(failed ? `indexing-toast-1858: ${failed} FAILED` : 'indexing-toast-1858: all passed');
  if (failed) process.exitCode = 1;
})().catch((e) => { console.error(e); process.exitCode = 1; });
