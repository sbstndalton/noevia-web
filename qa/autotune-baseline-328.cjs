// #328: the Tune panel after a run shaped like the 2026-09-30 E2B auto-tune (job bb20d010,
// structure only; synthetic model name and values). Checks that an optional step which did not
// apply reads "not applied" (never "passed" with an empty "Saved:"), that progress counts only
// applied settings, that the KV floor note names the candidates the server actually tries, that
// the failure note has no doubled full stop, that the model picker lists each model once, and
// that a probe the model fails at its reference settings is shown as skipped.
// Synthetic fixtures only; no tune is ever started (any POST fails the run).
// QA_DIST serves a build elsewhere; QA_SCREENSHOTS is the screenshot directory.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const {openSettings, openModelsTab } = require('./nav.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createFixture } = require('./diary-fixture.cjs');
const OUT = process.env.QA_SCREENSHOTS || '/tmp';
const NAME = 'synthetic-e2b_q4_0-it';
const FAIL = 'Quality checks failed: arithmetic (mismatch). Answered arithmetic: "69".';
const step = (id, label, status = 'pending', extra = {}) => ({ id, label, status, ...extra });
// Mirrors native-autotune-*.json for job bb20d010: sampling "passed" with a failure reason and a
// skipped/failed value, every KV candidate failed, later phases pending.
const job = {
  id: 'synthetic-bb20', model: NAME, bulk: false, promptBudgetSeconds: 120, status: 'failed', phase: 'Failed',
  startedAt: 1790788903505, finishedAt: 1790788930283, queueProgress: { done: 0, total: 1 }, waiting: false,
  error: 'No KV cache type passed quality and throughput checks.',
  log: [{ at: 1790788903571, text: 'Applying recommended sampling (synthetic family table).' }],
  models: [{ model: NAME, status: 'failed', error: 'No KV cache type passed quality and throughput checks.',
    baseline: { reference: 'f16', probes: ['extraction', 'reasoning'], skipped: [{ id: 'arithmetic', reason: 'mismatch', answer: '69' }] },
    phases: [
      { id: 'sampling', label: 'Sampling', status: 'passed', restored: true, reason: FAIL, value: { skipped: true, failed: true, reason: FAIL },
        steps: [step('apply', 'Recommended sampling', 'failed', { reason: FAIL })] },
      { id: 'kv', label: 'KV cache', status: 'failed', restored: true, reason: 'No KV cache type passed quality and throughput checks.',
        steps: ['f16', 'q8_0', 'q5_1', 'q5_0'].map(k => step(k, k + ' KV cache', 'failed', { reason: FAIL })) },
      { id: 'context', label: 'Context size', status: 'pending', steps: [step('capacity', 'Load and long-prompt recall')] },
      { id: 'drafting', label: 'Drafting', status: 'pending', steps: [step('off', 'Off')] },
      { id: 'batch', label: 'Batch and micro-batch', status: 'pending', steps: [step('512', 'Micro-batch 512')] },
    ] }],
};
const schema = [{ tier: 'Common', open: true, fields: [{ key: 'ctx-size', label: 'Context size', kind: 'int', choices: [], placeholder: '8192', help: '' }] }];
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const fixture = createFixture(31328); await fixture.listen();
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  let failed = null;
  try {
    for (const width of [375, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const errors = [], posts = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.route('**/api/**', route => {
        const req = route.request(), p = new URL(req.url()).pathname;
        const json = (body, status = 200) => route.fulfill({ json: body, status });
        if (req.method() !== 'GET') posts.push(req.method() + ' ' + p);
        if (p === '/api/profile' || p === '/api/auth/session') return json({ user: { id: 'qa', username: 'admin', displayName: 'Synthetic admin', role: 'admin', diaryEnabled: false, onboarded: true }, passkeys: [] });
        if (p === '/api/models/capabilities') return json({ kind: 'llamacpp', admin: true, autotune: true, presets: true });
        if (p === '/api/models/installed') return json([{ name: NAME, loaded: true, labels: [], sizeGB: 3.2, status: 'loaded' }, { name: 'synthetic-9b', loaded: false, labels: [], sizeGB: 6.1, status: 'unloaded' }]);
        if (p === '/api/auto-roles') return json({ configured: true, roles: { fast: NAME, smart: 'synthetic-9b' }, missing: [] });
        if (p === '/api/models/evidence') return json({ tracked: true, categories: [] });
        if (p === '/api/models/estimate') return json({ model: NAME, budgetGib: null, chat: true, sizeable: true, arch: 'gemma4', nativeCtx: 131072, modelGib: 3, pinnedGib: 0, reserveGib: 1, safety: 1.05, moe: false, rows: [], current: { ctx: 106496, kv: 'q8_0' } });
        if (p === '/api/models/hardware') return json({ source: 'model-manager', cpu: 'Synthetic CPU', systemGB: 64, gpus: [] });
        if (p === '/api/models/autotune') return json({ job, history: [], kvCandidates: ['f16', 'q8_0', 'q5_1', 'q5_0'] });
        if (p === '/api/models/autotune/untuned') return json({ models: [], skipped: [] });
        if (p === '/api/models/calibration') return json({ job: null, history: [] });
        if (p === '/api/model-manager/sections') return json({ revision: 'r1', schema, sections: [
          { name: 'synthetic-9b', items: [['ctx-size', '16384']], hasFile: true, file: 'synthetic-9b/synthetic-9b.gguf', cli: 'llama-server' },
          { name: NAME, items: [['ctx-size', '106496']], hasFile: true, file: NAME + '/' + NAME + '.gguf', cli: 'llama-server' },
        ], unregistered: [], backups: [] });
        if (p.startsWith('/api/model-manager/sections/') && p.endsWith('/autoconfig')) return json({});
        if (p.startsWith('/api/model-manager/sections/')) return json({ name: NAME, exists: true, values: { 'ctx-size': '106496', 'cache-type-k': 'q8_0', 'cache-type-v': 'q8_0' }, extras: '', hints: [], revision: 'r1', schema });
        if (p === '/api/model-manager/downloads') return json({ jobs: [] });
        if (p.startsWith('/api/model-manager/')) return json({});
        return route.continue();
      });
      await page.goto('http://localhost:31328');
      await openSettings(page);
      const settings = page.getByRole('dialog', { name: 'Settings' });
      await settings.getByRole('button', { name: 'Models & routing' }).click();
      await settings.getByRole('button', { name: 'Open model manager' }).click();
      const manager = page.locator('.model-manager-page');
      await openModelsTab(manager, 'Your models');
      await manager.getByRole('article', { name: NAME }).getByRole('button', { name: 'Tune' }).click();
      const panel = page.locator('.mm-easy-autotune');
      try {
        await panel.locator('.mm-autotune-phase').first().waitFor({ state: 'attached', timeout: 5000 });
        // #1008: the guided steps are a collapsed panel that mounts its steps once opened.
        await page.locator('details.mm-guided').first().evaluate((d) => { d.open = true; });
        await page.locator('.mm-guided').getByText('The last run').waitFor({ timeout: 5000 });
        const guided = await page.locator('.mm-guided').innerText();
        const tune = await panel.innerText();
        // Every item is checked and reported, so a run on an older build names each regression.
        const problems = [];
        const check = async (label, fn) => { try { await fn(); } catch (e) { problems.push(label + ': ' + String(e.message).split('\n')[0]); } };
        await check('(e) model once under the picker', async () => {
          // One option, and the editor below does not repeat the picked name as a visible heading
          // (it stays a heading for screen readers).
          const picker = page.locator('.mm-tab label.mm-grow select');
          await picker.waitFor();
          const options = await picker.locator('option').allInnerTexts();
          assert.equal(options.filter(o => o.includes(NAME)).length, 1, 'picker lists ' + NAME + ' once: ' + JSON.stringify(options));
          assert.equal(await picker.inputValue(), NAME);
          await page.locator('#mm-section-title').waitFor({ state: 'attached' });
          const repeats = await page.locator('.mm-tab').evaluate((root, name) => [...root.querySelectorAll('*')]
            .filter(el => el.tagName !== 'OPTION' && el.tagName !== 'SELECT' && !el.closest('.mm-autotune') && el.textContent.trim() === name && el.getBoundingClientRect().width > 1)
            .map(el => el.tagName), NAME);
          assert.deepEqual(repeats, [], 'the picked name is repeated visibly under the picker: ' + repeats.join(', '));
          assert.equal(await page.getByRole('heading', { name: NAME, level: 3 }).count(), 1, 'the editor keeps its accessible heading');
        });
        await check('(a) sampling row', async () => {
          const samplingText = (await panel.locator('.mm-autotune-phase').first().locator('summary').innerText()).replace(/\s+/g, ' ');
          assert.doesNotMatch(samplingText, /\bpassed\b/, 'reads passed: ' + samplingText);
          assert.match(samplingText, /not applied/, 'does not read not applied: ' + samplingText);
          assert.doesNotMatch(tune, /Saved:\s*(\n|$)/, 'empty "Saved:" line');
        });
        await check('(c) progress', async () => {
          assert.match(tune, /0 of 4 settings saved/, 'counts a setting that was not applied: ' + (tune.match(/\d+ of \d+ settings saved/) || [''])[0]);
        });
        await check('(b) failure note', async () => {
          assert.doesNotMatch(guided, /\.\./, 'doubled full stop: ' + (guided.match(/[^\n]*\.\.[^\n]*/) || [''])[0]);
        });
        // #1057: the floor is q8_0 now; the note still names exactly the list the server sends.
        await check('(d) KV floor note', async () => {
          const floor = (await page.locator('.mm-guided [role="note"]').filter({ hasText: 'never goes below q8_0' }).innerText()).replace(/\s+/g, ' ');
          assert.match(floor, /f16, q8_0, q5_1,? and q5_0/, 'does not list the tried candidates: ' + floor);
          assert.doesNotMatch(floor, /q4_0/, 'claims q4_0: ' + floor);
        });
        await check('baseline', async () => {
          assert.match(tune, /arithmetic: skipped — the model gets this wrong at its reference settings/i, 'skipped probe not shown');
        });
        await check('no tune writes', async () => { assert.deepEqual(posts.filter(x => /\/api\/model/.test(x)), []); });
        await check('no page errors', async () => { assert.deepEqual(errors, []); });
        await panel.screenshot({ path: `${OUT}/autotune-baseline-328-${width}.png` });
        if (problems.length) throw Error(problems.length + ' problem(s):\n  ' + problems.join('\n  '));
        console.log(`PASS ${width}px`);
      } catch (e) { failed = e; console.log(`FAIL ${width}px: ${e.message}`); }
      await page.close();
    }
  } finally { await browser.close(); await fixture.close(); }
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
