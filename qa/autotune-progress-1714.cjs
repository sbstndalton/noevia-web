// noevia#1714: the per-model tuning progress bar ('N of M settings saved', dbaa970) had no qa coverage
// after #1697 retired the old '50% of this model' checks in models-settings.cjs. This drives it with a
// mocked per-model tuning job (job.models with phases) at 2000 and 390 px, light and dark, and checks:
//  - the bar is a real progressbar named 'Auto-tune progress' whose value/max are the saved/total
//    setting counts (an optional 'sampling' phase only counts once it is saved),
//  - the visible 'N of M settings saved' text matches, and screen readers get the same words (not just
//    a bare percentage) through the bar's aria-valuetext,
//  - the bar fills the status column and stays inside the panel at 390 px,
//  - the filled part is visible against the track in both themes,
//  - the count follows the job as the poll reports more saved settings.
//
// Offline: the app is built from this checkout and every API is a synthetic stub (diary-fixture.cjs).
//   PLAYWRIGHT_MODULE=<playwright-core> QA_DIST=<dist dir> [QA_SHOTS=<dir>] node qa/autotune-progress-1714.cjs
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || `${process.env.HOME}/noevia-local-test/node_modules/playwright-core`);
const { createFixture } = require('./diary-fixture.cjs');
const { withLocale } = require('./qa-locale.cjs');

const PORT = Number(process.env.QA_PORT || 31714);
const SHOTS = process.env.QA_SHOTS || '';
const NAME = 'autotune-progress-1714';

const STARTED = Date.now() - 95000;
const phase = (id, status, value) => ({ id, label: id, status, steps: [], ...(value ? { value } : {}) });
// Synthetic per-model job: Model-A done (3 settings + skipped sampling), Model-B part way.
function jobAt(stage) {
  const b = stage === 0
    ? [phase('spec', 'passed', { applied: true, values: { 'spec-type': 'draft-mtp' } }), phase('kv', 'running'), phase('context', 'pending')]
    : [phase('spec', 'passed', { applied: true, values: { 'spec-type': 'draft-mtp' } }), phase('kv', 'passed', { applied: true, values: { kv: 'q8_0' } }), phase('context', 'running')];
  return {
    id: 'job-1714', model: 'Synthetic-B', status: 'running', phase: 'Measuring context', startedAt: STARTED,
    log: [{ at: STARTED, text: 'Starting auto-tune' }, { at: STARTED + 12000, text: 'Saved spec-type draft-mtp' }],
    models: [
      { model: 'Synthetic-A', status: 'passed', phases: [phase('spec', 'passed', { applied: true }), phase('kv', 'passed', { applied: true }), phase('context', 'passed', { applied: true }), phase('sampling', 'passed', { skipped: true })] },
      { model: 'Synthetic-B', status: 'running', phases: b },
    ],
  };
}

async function open(browser, { width, height, theme }) {
  const page = await browser.newPage(withLocale({ viewport: { width, height } }));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript((t) => { localStorage.setItem('cowork-theme', t); }, theme);
  const state = { stage: 0 };
  await page.route('**/api/**', (route) => {
    const url = new URL(route.request().url()), p = url.pathname;
    const json = (body, status = 200) => route.fulfill({ status, json: body });
    if (p === '/api/profile' || p === '/api/auth/session') return json({ user: { id: 'qa', username: 'admin', displayName: 'Synthetic admin', role: 'admin', diaryEnabled: true, onboarded: true }, passkeys: [] });
    if (p === '/api/models/capabilities') return json({ kind: 'llamacpp', admin: true, autotune: true, presets: true, download: false, runtimeOptions: false, modelManagement: true });
    if (p === '/api/models/installed') return json([
      { name: 'Synthetic-A', labels: [], loaded: false, sizeGB: 2, maxContext: 8192, source: 'preset', canDelete: false, status: 'unloaded' },
      { name: 'Synthetic-B', labels: [], loaded: true, sizeGB: 3, maxContext: 8192, source: 'preset', canDelete: false, status: 'loaded' }]);
    if (p === '/api/models/autotune') return json({ job: jobAt(state.stage), history: [] });
    if (p === '/api/models/autotune/untuned') return json({ models: [], skipped: [] });
    if (p.startsWith('/api/model-manager/')) {
      const r = p.slice('/api/model-manager/'.length);
      if (r === 'models') return json({ models: [], unregistered: [], revision: 'r1' });
      if (r === 'overview') return json({ modelsDir: { path: '/models', exists: true, disk: null }, models: 0, sections: 0, backends: [], activeDownloads: 0, revision: 'r1' });
      return json({});
    }
    if (p.startsWith('/api/models/')) return json([]);
    return route.continue();
  });
  await page.goto(`http://localhost:${PORT}/models`);
  const root = page.locator('.model-manager-page');
  await root.waitFor({ timeout: 20000 });
  await root.getByRole('button', { name: 'Tune untuned models' }).click();
  const panel = root.locator('#library-autotune');
  const bar = panel.getByRole('progressbar', { name: 'Auto-tune progress' });
  await bar.waitFor({ timeout: 10000 });
  await page.waitForTimeout(150);
  return { page, panel, bar, state };
}

// Luminance of the filled part and of the empty track, sampled from a real screenshot of the bar.
async function barColours(page, bar) {
  const box = await bar.boundingBox();
  const png = await page.screenshot({ clip: { x: box.x, y: box.y, width: box.width, height: box.height } });
  return page.evaluate(async (b64) => {
    const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
    const y = Math.floor(img.height / 2);
    const at = (fx) => { const d = ctx.getImageData(Math.floor(img.width * fx), y, 1, 1).data; return [d[0], d[1], d[2]]; };
    return { filled: at(0.1), empty: at(0.95) };
  }, png.toString('base64'));
}
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

(async () => {
  const fixture = createFixture(PORT);
  await fixture.listen();
  const browser = await chromium.launch({ headless: true, ...(process.env.QA_CHROME_PATH ? { executablePath: process.env.QA_CHROME_PATH } : { channel: 'chrome' }) });
  const results = [];
  const check = async (name, fn) => {
    try { await fn(); results.push([name, null]); console.log(`PASS ${NAME}: ${name}`); }
    catch (e) { results.push([name, e]); console.log(`FAIL ${NAME}: ${name}\n  ${String(e.message).split('\n').slice(0, 8).join('\n  ')}`); }
  };
  const cases = [[2000, 1100, 'light'], [2000, 1100, 'dark'], [390, 844, 'light'], [390, 844, 'dark']];
  try {
    for (const [width, height, theme] of cases) {
      await check(`${width} px ${theme}: 'N of M settings saved' bar counts, reads and fits`, async () => {
        const { page, panel, bar } = await open(browser, { width, height, theme });
        // Model-A: spec, kv, context saved; skipped sampling does not count. Model-B: spec saved of 3.
        assert.equal(await bar.getAttribute('value'), '4', 'saved settings so far');
        assert.equal(await bar.getAttribute('max'), '6', 'settings this run will save');
        await panel.getByText('4 of 6 settings saved', { exact: true }).waitFor();
        assert.equal(await bar.getAttribute('aria-valuetext'), '4 of 6 settings saved', 'screen readers hear the count, not a bare percentage');
        const geo = await page.evaluate(() => {
          const bar = document.querySelector('#library-autotune progress').getBoundingClientRect();
          const status = document.querySelector('#library-autotune .mm-autotune-status').getBoundingClientRect();
          const panel = document.querySelector('#library-autotune').getBoundingClientRect();
          return { bar: [bar.left, bar.right, bar.height], status: [status.left, status.right], panel: [panel.left, panel.right], vw: innerWidth, sw: document.documentElement.scrollWidth };
        });
        assert.ok(geo.bar[2] >= 6, `the bar has height (${geo.bar[2]})`);
        assert.ok(geo.bar[0] >= geo.panel[0] && geo.bar[1] <= geo.panel[1] + 0.5, `the bar stays inside the panel (${geo.bar} in ${geo.panel})`);
        assert.ok(geo.bar[1] - geo.bar[0] >= (geo.status[1] - geo.status[0]) * 0.9, `the bar fills the status column (${geo.bar} vs ${geo.status})`);
        assert.ok(geo.sw <= geo.vw, `no sideways scroll (${geo.sw} > ${geo.vw})`);
        const c = await barColours(page, bar);
        assert.ok(dist(c.filled, c.empty) > 40, `the filled part stands out from the track (${c.filled} vs ${c.empty})`);
        if (SHOTS) {
          await panel.scrollIntoViewIfNeeded();
          await page.screenshot({ path: path.join(SHOTS, `1714-progress-${width}-${theme}.png`) });
        }
        await page.close();
      });
    }

    await check('the count follows the job as the poll reports another saved setting', async () => {
      const { page, panel, bar, state } = await open(browser, { width: 2000, height: 1100, theme: 'light' });
      state.stage = 1;
      await panel.getByText('5 of 6 settings saved', { exact: true }).waitFor({ timeout: 5000 });
      assert.equal(await bar.getAttribute('value'), '5');
      assert.equal(await bar.getAttribute('aria-valuetext'), '5 of 6 settings saved');
      await page.close();
    });
  } finally {
    await browser.close();
    await fixture.close();
  }
  const failed = results.filter(([, e]) => e);
  console.log(`\n${NAME}: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exitCode = 1;
})().catch((e) => { console.error(e); process.exitCode = 1; });
