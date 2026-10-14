// #1545 (live on ab1445b0): Models > Performance > Recover named its engine row after the internal
// "Model loader" and could stay on "Checking model loader…" / "Checking jobs…" for good: the panel
// waited for five reads together, with no time limit, so one read that never answered held both rows.
// Checked in a real browser with synthetic APIs only (nothing reaches a server):
//  1. the row is called "Engines";
//  2. with the downloads read hanging, the engine line still shows as soon as its own read answers;
//  3. with the engine read hanging, the row shows "Health unavailable" after the bounded wait, and the
//     job list does not wait for it;
//  4. "Check again" while the engine read hangs: the newer answer shows, the older run's timeout never
//     flashes "Health unavailable" over it (#1545 review: runs are aborted and only the newest writes);
//  5. each model name is whole (one line, not clipped) and nothing scrolls sideways, at 2000px and 390px, light and dark.
//
// Fails on a build without the change, passes with it:
//   npm run build -- --outDir ../dist-before   (the parent commit)
//   QA_DIST=../dist-before node qa/recover-bounded-1545.cjs   -> exits 1
//   npm run build && node qa/recover-bounded-1545.cjs          -> exits 0
// Environment: PLAYWRIGHT_MODULE, QA_CHROME_PATH (else channel chrome), QA_DIST, QA_PORT (31545),
//              QA_SCREENSHOTS (screenshots are written only when set).
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { openModelsTab } = require('./nav.cjs');
const { createFixture } = require('./diary-fixture.cjs');
const { withLocale } = require('./qa-locale.cjs');

const PORT = Number(process.env.QA_PORT || 31545);
const SHOTS = process.env.QA_SCREENSHOTS || '';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const BACKENDS = [
  { name: 'cowork-llama-1', found: true, status: 'running', loaded_model: 'gemma-4-12b-it-qat-q4_0', probe_error: null, last_restart_error: null },
  { name: 'cowork-embed-1', found: true, status: 'running', loaded_model: 'nomic-embed-text-v1', probe_error: null, last_restart_error: null },
];

async function open(browser, { width, theme, hang, backends }) {
  const page = await browser.newPage(withLocale({ viewport: { width, height: 950 } }));
  await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
  await page.addInitScript((t) => { try { localStorage.setItem('cowork-theme', t); } catch { /* ignore */ } }, theme);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/api/**', (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p === '/api/profile' || p === '/api/auth/session') return route.fulfill({ json: { user: { id: 'qa', username: 'admin', displayName: 'Synthetic admin', role: 'admin', diaryEnabled: false, onboarded: true }, passkeys: [] } });
    // A read that never answers: the route is left pending for the life of the page.
    if (p === `/api/model-manager/${hang}`) return undefined;
    // A scripted engine read: each request takes the next answer; `null` never answers.
    if (p === '/api/model-manager/backends' && backends) { const next = backends.shift(); return next === null ? undefined : route.fulfill({ json: { backends: next } }); }
    if (p === '/api/model-manager/backends') return route.fulfill({ json: { backends: BACKENDS } });
    if (p === '/api/model-manager/downloads') return route.fulfill({ json: { jobs: [] } });
    if (p === '/api/models/installed') return route.fulfill({ json: [] });
    if (p.startsWith('/api/models/autotune') || p.startsWith('/api/models/calibration')) return route.fulfill({ json: { job: null } });
    return route.continue();
  });
  await page.goto(`http://localhost:${PORT}/models`);
  await openModelsTab(page, 'Overview');
  await page.locator('.mm-loader-row').waitFor();
  return { page, errors };
}

const textOf = (page, sel) => page.locator(sel).first().innerText().catch(() => '');
async function waitText(page, sel, re, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (re.test(await textOf(page, sel))) return true; await page.waitForTimeout(150); }
  return false;
}

(async () => {
  const fixture = createFixture(PORT);
  await fixture.listen();
  const browser = await chromium.launch({ headless: true, ...(process.env.QA_CHROME_PATH ? { executablePath: process.env.QA_CHROME_PATH } : { channel: 'chrome' }) });
  const failures = [];
  let passed = 0;
  const check = (name, ok, detail = '') => { if (ok) passed++; else { failures.push(name); console.log(`FAIL ${name}${detail ? `: ${detail}` : ''}`); } };
  try {
    for (const width of [2000, 390]) for (const theme of ['light', 'dark']) {
      const at = `${width} ${theme}`;
      {
        const { page, errors } = await open(browser, { width, theme, hang: 'downloads' });
        check(`${at} the row is called Engines`, (await textOf(page, '.mm-loader-row strong')) === 'Engines', await textOf(page, '.mm-loader-row strong'));
        const shown = await waitText(page, '.mm-loader-state', /Engine 1 running · gemma-4-12b-it-qat-q4_0 loaded/, 4000);
        check(`${at} a hanging downloads read does not hold the engine line`, shown, await textOf(page, '.mm-loader-state'));
        // Each model name is whole: on one line and not clipped, at every width.
        const names = await page.evaluate(() => [...document.querySelectorAll('.mm-loader-item')].map((item) => {
          const text = item.textContent || '';
          const model = /(gemma-4-12b-it-qat-q4_0|nomic-embed-text-v1)/.exec(text)?.[1];
          if (!model) return `${text}: no model`;
          const range = document.createRange(); const node = [...item.querySelectorAll('*'), item].flatMap((el) => [...el.childNodes]).find((n) => n.nodeType === 3 && n.textContent.includes(model));
          if (!node) return `${model}: not one text node`;
          const start = node.textContent.indexOf(model); range.setStart(node, start); range.setEnd(node, start + model.length);
          const lines = new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size;
          const host = node.parentElement; const clipped = host.scrollWidth > host.clientWidth + 1 && getComputedStyle(host).overflow === 'hidden';
          return lines === 1 && !clipped ? '' : `${model}: ${lines} lines${clipped ? ', clipped' : ''}`;
        }).filter(Boolean));
        check(`${at} model names are whole`, !names.length, names.join(' | '));
        const overflow = await page.locator('.model-manager-page').evaluate((el) => el.scrollWidth - el.clientWidth);
        check(`${at} nothing scrolls sideways`, overflow <= 1, `${overflow}px`);
        if (SHOTS) await page.locator('.mm-loader-row').first().scrollIntoViewIfNeeded().catch(() => {});
        if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `recover-${width}-${theme}.png`) });
        check(`${at} no page errors`, !errors.length, errors.join(' | '));
        await page.close();
      }
      if (width === 2000) {
        const { page } = await open(browser, { width, theme, hang: 'backends' });
        const jobs = await waitText(page, '.mm-panel', /No failed or stuck tuning, calibration or download jobs\./, 4000);
        check(`${at} a hanging engine read does not hold the job list`, jobs);
        const ended = await waitText(page, '.mm-loader-state', /^Health unavailable$/, 16000);
        check(`${at} a hanging engine read ends as Health unavailable`, ended, await textOf(page, '.mm-loader-state'));
        await page.close();
      }
      if (width === 2000) {
        const second = [{ ...BACKENDS[0], loaded_model: 'qa-second-answer-model' }];
        const { page, errors } = await open(browser, { width, theme, backends: [null, second] });
        await page.waitForTimeout(6000);
        await page.getByRole('button', { name: 'Check again' }).click();
        const fresh = await waitText(page, '.mm-loader-state', /qa-second-answer-model/, 4000);
        check(`${at} Check again shows the newer engine answer`, fresh, await textOf(page, '.mm-loader-state'));
        // Watch past the first run's 12 s limit: its timeout must not replace the newer answer.
        const seen = new Set();
        const end = Date.now() + 10000;
        while (Date.now() < end) { seen.add(await textOf(page, '.mm-loader-state')); await page.waitForTimeout(100); }
        const flashed = [...seen].filter((text) => !/qa-second-answer-model/.test(text));
        check(`${at} the older run never overwrites the newer answer`, !flashed.length, flashed.join(' | '));
        check(`${at} no page errors after Check again`, !errors.length, errors.join(' | '));
        await page.close();
      }
    }
  } finally {
    await browser.close();
    await fixture.close?.();
  }
  console.log(`\nrecover-bounded-1545: ${passed}/${passed + failures.length} checks passed${SHOTS ? `, screenshots in ${SHOTS}` : ''}`);
  process.exit(failures.length ? 1 : 0);
})();
