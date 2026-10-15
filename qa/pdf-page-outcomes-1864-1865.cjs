'use strict';
// #1864/#1865: a large PDF that stopped at the page limit says "stopped at page N (page limit)", and a page
// whose OCR retry failed says "OCR retry failed: <reason>", in the source's status line (Sources tab) and
// in the indexing-problems toast (#1858), in the interface language (en-GB and de-DE here). Synthetic APIs
// and names only. Fails before the change (neither line says either) and passes after it.
//   PLAYWRIGHT_MODULE=<playwright> QA_DIST=<dist> QA_CORE_SERVER=<core server/> [QA_SHOTS=<dir>] node qa/pdf-page-outcomes-1864-1865.cjs
const os = require('node:os');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || `${os.homedir()}/noevia-local-test/node_modules/playwright-core`);
const { createFixture } = require('./diary-fixture.cjs');
const PORT = Number(process.env.QA_PORT || 31864);
const SHOTS = process.env.QA_SHOTS || '';

const large = { name: 'Synthetic/large-report.pdf', source: '/Synthetic', chars: 180000, document: {
  state: 'partial', pages: 1200, truncated: true, indexing: 'ready', stoppedAt: { page: 1000, limit: 'pages' },
  pageStatus: [{ number: 1, status: 'native' }, { number: 2, status: 'native' }] } };
const form = { name: 'Synthetic/form.pdf', source: '/Synthetic', chars: 900, document: {
  state: 'partial', pages: 3, truncated: false, indexing: 'ready',
  pageStatus: [{ number: 1, status: 'degraded', reason: 'native-fallback', retry: { outcome: 'failed', error: 'OCR is busy; refresh to retry.' } }, { number: 2, status: 'native' }, { number: 3, status: 'native' }] } };
const recovered = { name: 'Synthetic/scan.pdf', source: '/Synthetic', chars: 500, document: {
  state: 'ready', pages: 1, truncated: false, indexing: 'ready', pageStatus: [{ number: 1, status: 'ocr', retry: { outcome: 'recovered' } }] } };
// What the server sends for the two partial documents (document-sources.cjs problem / problemNotes).
const skipped = [
  { folder: '/Synthetic', file: large.name, reason: 'partial; 1200 pages; summary/page extraction limits reached; stopped at page 1000 (page limit).',
    reasonBase: 'partial; 1200 pages; summary/page extraction limits reached.', notes: [{ id: 'stoppedAtPage', params: { page: 1000, limit: 'pages' } }], retained: false },
  { folder: '/Synthetic', file: form.name, reason: 'partial; 3 pages; incomplete pages 1 (degraded: native-fallback); pages 1: OCR retry failed: OCR is busy; refresh to retry.',
    reasonBase: 'partial; 3 pages; incomplete pages 1 (degraded: native-fallback).', notes: [{ id: 'ocrRetryFailed', params: { pages: '1', reason: 'OCR is busy; refresh to retry.' } }], retained: false },
];

const WORDS = {
  'en-GB': { stopped: 'stopped at page 1000 (page limit)', failed: 'pages 1: OCR retry failed: OCR is busy; refresh to retry.', recovered: 'pages 1: recovered by an OCR retry', show: 'Show', sources: 'Sources' },
  'de-DE': { stopped: 'bei Seite 1000 angehalten (Seitenlimit)', failed: 'Seiten 1: OCR-Wiederholung fehlgeschlagen: OCR is busy; refresh to retry.', recovered: 'Seiten 1: durch OCR-Wiederholung gelesen', show: null, sources: null },
};

(async () => {
  const fixture = createFixture(PORT); await fixture.listen();
  const browser = await chromium.launch({ headless: true, ...(process.env.QA_CHROME_PATH ? { executablePath: process.env.QA_CHROME_PATH } : { channel: 'chrome' }) });
  let failed = 0;
  try {
    for (const [locale, width, theme] of [['en-GB', 2000, 'light'], ['en-GB', 390, 'dark'], ['de-DE', 2000, 'dark']]) {
      const tag = `${locale} ${width} px ${theme}`;
      const words = WORDS[locale];
      const page = await browser.newPage({ locale, viewport: { width, height: width < 600 ? 900 : 1150 }, isMobile: width < 768, hasTouch: width < 768 });
      const errors = []; page.on('pageerror', (e) => errors.push(e.message));
      await page.addInitScript((th) => { try { localStorage.setItem('cowork-theme', th); } catch { /* ignore */ } }, theme);
      const project = { id: 'p-syn', name: 'Synthetic 1864', goal: '', instructions: '', memories: [], files: [large, form, recovered], assets: [], sourceFolders: ['/Synthetic'],
        modes: ['chat'], toolboxes: ['core'], createdAt: 1000, updatedAt: 1000, chats: [{ id: 'c-syn', title: 'Synthetic chat', preview: 'hello', updatedAt: 2000 }] };
      await page.route('**/api/**', (route) => {
        const p = new URL(route.request().url()).pathname;
        const json = (b, status = 200) => route.fulfill({ status, json: b });
        if (p === '/api/workspace') return json({ projects: [project], freeChats: [] });
        if (p === '/api/projects/p-syn/sources/sync') return json({ files: project.files.map((f) => ({ name: f.name, source: f.source, bytes: f.chars, document: f.document })), skipped });
        if (p === '/api/projects/p-syn/skills') return json({ skills: [] });
        if (/^\/api\/chats\/[^/]+\/history$/.test(p)) return json({ history: [], revision: '0' });
        if (/^\/api\/chats\/[^/]+\/context$/.test(p)) return json({ project });
        return route.fallback();
      });
      const check = async (name, fn) => { try { await fn(); console.log(`PASS pdf-page-outcomes: ${tag}: ${name}`); } catch (e) { failed++; console.log(`FAIL pdf-page-outcomes: ${tag}: ${name}\n  ${String(e.message).split('\n').slice(0, 4).join('\n  ')}`); } };

      await page.goto(`http://localhost:${PORT}/c/c-syn`);
      const toast = page.locator('.save-error-storage');
      await check('the indexing-problems toast names where the large PDF stopped and why the OCR retry failed', async () => {
        await toast.waitFor({ timeout: 15000 });
        await toast.locator('.save-error-toggle').click();
        await toast.locator('.save-error-list li').first().waitFor({ timeout: 5000 });
        const items = await toast.locator('.save-error-list li').allInnerTexts();
        assert.equal(items.length, 2);
        assert.ok(items.some((t) => t.includes(large.name) && t.includes(words.stopped)), `stopped line in ${JSON.stringify(items)}`);
        assert.ok(items.some((t) => t.includes(form.name) && t.includes(words.failed)), `retry line in ${JSON.stringify(items)}`);
        assert.ok(items.every((t) => !t.endsWith('..')), 'one full stop at the end');
        if (locale !== 'en-GB') assert.ok(items.every((t) => !t.includes('stopped at page') && !t.includes('OCR retry failed')), 'no English notes in another locale');
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no sideways scroll');
        if (SHOTS) await page.screenshot({ path: `${SHOTS}/1864-toast-${locale}-${width}-${theme}.png` });
      });

      await page.goto(`http://localhost:${PORT}/p/p-syn`);
      await check('each source row says the same in its status line', async () => {
        const tab = page.getByRole('tab', { name: words.sources || /Sources|Quellen/ }).first();
        await tab.click().catch(async () => { await page.getByText(words.sources || 'Quellen', { exact: true }).first().click(); });
        const row = (name) => page.locator(`li[data-source-name="${name}"] small.source-status`).first();
        await row(large.name).waitFor({ timeout: 15000 });
        assert.match(await row(large.name).innerText(), new RegExp(words.stopped.replace(/[()]/g, '\\$&')));
        assert.ok((await row(form.name).innerText()).includes(words.failed), await row(form.name).innerText());
        assert.ok((await row(recovered.name).innerText()).includes(words.recovered), await row(recovered.name).innerText());
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no sideways scroll');
        await page.locator(`li[data-source-name="${form.name}"]`).scrollIntoViewIfNeeded();
        if (SHOTS) await page.screenshot({ path: `${SHOTS}/1864-sources-${locale}-${width}-${theme}.png` });
      });
      await check('no page errors', async () => assert.deepEqual(errors, []));
      await page.close();
    }
  } finally { await browser.close(); await fixture.close(); }
  console.log(failed ? `pdf-page-outcomes-1864-1865: ${failed} FAILED` : 'pdf-page-outcomes-1864-1865: all passed');
  if (failed) process.exitCode = 1;
})().catch((e) => { console.error(e); process.exitCode = 1; });
