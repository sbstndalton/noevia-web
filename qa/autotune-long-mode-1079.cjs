// #1079: a model's Tune panel offers Fast or Long. Fast keeps today's prompt time limit (120 s by
// default) and tunes the model's own settings; Long defaults to 1800 s (at most 1800) and tunes a
// separate long-context profile, `<model>-long`, that the help names. The time limit is checked
// before the start (an invalid one disables it and says why), the start sends mode and limit, a
// running Long tune of the model's profile shows on the model's own panel, and the profile's last
// result is reported. Synthetic fixtures only; the start is answered by the mock.
// QA_DIST serves a build elsewhere; QA_SCREENSHOTS is the screenshot directory.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { openSettings, openModelsTab } = require('./nav.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createFixture } = require('./diary-fixture.cjs');
const OUT = process.env.QA_SCREENSHOTS || '/tmp';
const NAME = 'synthetic-12b-it', LONG = NAME + '-long';
const step = (id, label, status = 'passed', extra = {}) => ({ id, label, status, ...extra });
const MODES = { fast: { defaultSeconds: 120, maxSeconds: 1800 }, long: { defaultSeconds: 1800, maxSeconds: 1800 } };
const longResult = { at: 1791360900000, kv: 'bf16', context: 98304, spec: 'off', specLabel: 'Off', generation: 18.2, acceptance: null, ubatch: 512, promptPerSecond: 160, extensions: [], quality: { passed: true, checks: [] } };
const running = {
  id: 'synthetic-1079', model: LONG, bulk: false, mode: 'long', promptBudgetSeconds: 900, status: 'running', phase: 'Context and KV cache: synthetic fill',
  startedAt: 1791360000000, queueProgress: { done: 0, total: 1 }, waiting: false,
  log: [{ at: 1791360001000, text: "Added the long-context profile synthetic-12b-it-long to models.ini, copied from synthetic-12b-it's settings. This tune changes only that profile." }],
  models: [{ model: LONG, base: NAME, mode: 'long', status: 'running', kv: ['bf16', 'q8_0'], phases: [
    { id: 'context', label: 'Context and KV cache', status: 'running', steps: [step('probe-0', 'Fill 131,072 · bf16 KV cache', 'running')] },
    { id: 'sampling', label: 'Sampling', status: 'pending', steps: [] },
  ] }],
};
const schema = [{ tier: 'Common', open: true, fields: [{ key: 'ctx-size', label: 'Context size', kind: 'int', choices: [], placeholder: '8192', help: '' }] }];
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const fixture = createFixture(31179); await fixture.listen();
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  let failed = null;
  try {
    for (const width of [375, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const errors = [], starts = [];
      let started = false;
      page.on('pageerror', e => errors.push(e.message));
      await page.route('**/api/**', async route => {
        const req = route.request(), p = new URL(req.url()).pathname;
        const json = (body, status = 200) => route.fulfill({ json: body, status });
        const status = () => ({ job: started ? running : null, history: [], kvCandidates: ['bf16', 'q8_0'], settings: { allowQ5Kv: false }, planImpl: 'wasm', loadAdvisor: 'off',
          modes: MODES, longId: LONG, longHistory: [longResult] });
        if (p === '/api/models/autotune' && req.method() === 'POST') { starts.push(req.postDataJSON()); started = true; return json(running, 202); }
        if (p === '/api/models/autotune/settings') return json(status());
        if (p === '/api/profile' || p === '/api/auth/session') return json({ user: { id: 'qa', username: 'admin', displayName: 'Synthetic admin', role: 'admin', diaryEnabled: false, onboarded: true }, passkeys: [] });
        if (p === '/api/models/capabilities') return json({ kind: 'llamacpp', admin: true, autotune: true, presets: true });
        if (p === '/api/models/installed') return json([{ name: NAME, loaded: true, labels: [], sizeGB: 7.3, status: 'loaded', longVariant: LONG, longLoaded: false }]);
        if (p === '/api/auto-roles') return json({ configured: true, roles: { fast: NAME, smart: NAME }, missing: [] });
        if (p === '/api/models/evidence') return json({ tracked: true, categories: [] });
        if (p === '/api/models/estimate') return json({ model: NAME, budgetGib: 16, chat: true, sizeable: true, arch: 'gemma3', nativeCtx: 131072, modelGib: 7, pinnedGib: 0, reserveGib: 1, safety: 1.05, moe: false, rows: [], current: { ctx: 16384, kv: 'bf16' } });
        if (p === '/api/models/hardware') return json({ source: 'model-manager', cpu: 'Synthetic CPU', systemGB: 64, gpus: [] });
        if (p === '/api/models/autotune') return json(status());
        if (p === '/api/models/autotune/untuned') return json({ models: [], skipped: [] });
        if (p === '/api/models/calibration') return json({ job: null, history: [] });
        if (p === '/api/model-manager/sections') return json({ revision: 'r1', schema, sections: [
          { name: NAME, items: [['ctx-size', '16384']], hasFile: true, file: NAME + '/' + NAME + '.gguf', cli: 'llama-server' },
        ], unregistered: [], backups: [] });
        if (p.startsWith('/api/model-manager/sections/') && p.endsWith('/autoconfig')) return json({});
        if (p.startsWith('/api/model-manager/sections/')) return json({ name: NAME, exists: true, values: { 'ctx-size': '16384', 'cache-type-k': 'bf16', 'cache-type-v': 'bf16' }, extras: '', hints: [], revision: 'r1', schema });
        if (p === '/api/model-manager/downloads') return json({ jobs: [] });
        if (p.startsWith('/api/model-manager/')) return json({});
        return route.continue();
      });
      await page.goto('http://localhost:31179');
      await openSettings(page);
      const settings = page.getByRole('dialog', { name: 'Settings' });
      await settings.getByRole('button', { name: 'Models & routing' }).click();
      await settings.getByRole('button', { name: 'Open model manager' }).click();
      const manager = page.locator('.model-manager-page');
      await openModelsTab(manager, 'Your models');
      await manager.getByRole('article', { name: NAME }).getByRole('button', { name: 'Tune' }).click();
      const panel = page.locator('.mm-easy-autotune');
      const problems = [];
      const check = async (label, fn) => { try { await fn(); } catch (e) { problems.push(label + ': ' + String(e.message).split('\n')[0]); } };
      try {
        const modeGroup = panel.getByRole('radiogroup', { name: 'Tune mode' });
        const limit = panel.getByRole('spinbutton', { name: 'Prompt time limit (seconds)' });
        await check('Fast and Long are offered, Fast by default with 120 s', async () => {
          await modeGroup.waitFor({ timeout: 5000 });
          assert.equal(await modeGroup.getByRole('radio', { name: 'Fast' }).getAttribute('aria-checked'), 'true');
          assert.equal(await limit.inputValue(), '120');
          assert.match((await panel.locator('.mm-autotune-mode').innerText()).replace(/\s+/g, ' '), /own settings/);
        });
        await panel.locator('.mm-autotune-mode').screenshot({ path: `${OUT}/autotune-long-mode-1079-fast-${width}.png` });
        await check('the last Long result is reported with its profile and context', async () => {
          const note = (await panel.locator('.mm-autotune-long-last').innerText()).replace(/\s+/g, ' ');
          assert.match(note, new RegExp(LONG));
          assert.match(note, /98,304 tokens/);
          assert.match(note, /bf16/);
        });
        await check('Long defaults to 1800 s and names the separate profile it saves', async () => {
          await modeGroup.getByRole('radio', { name: 'Long' }).click();
          assert.equal(await limit.inputValue(), '1800');
          const help = (await panel.locator('.mm-autotune-mode').innerText()).replace(/\s+/g, ' ');
          assert.match(help, new RegExp(LONG));
          assert.match(help, /Context: High/);
          assert.match(help, /own settings stay as they are/);
          assert.equal(await limit.getAttribute('max'), '1800');
        });
        await panel.locator('.mm-autotune-mode').screenshot({ path: `${OUT}/autotune-long-mode-1079-long-${width}.png` });
        const confirm = panel.locator('.mm-autotune-actions input[type="checkbox"]').first();
        const start = panel.getByRole('button', { name: 'Run Long tune' });
        await check('a limit over 1800 s is refused before the start, and says why', async () => {
          await confirm.check();
          await limit.fill('1801');
          await panel.getByRole('alert').filter({ hasText: 'from 15 to 1800' }).waitFor({ timeout: 3000 });
          assert.equal(await start.isDisabled(), true);
          assert.equal(await limit.getAttribute('aria-invalid'), 'true');
          await limit.fill('9.5');
          assert.equal(await start.isDisabled(), true);
        });
        await panel.locator('.mm-autotune-mode').screenshot({ path: `${OUT}/autotune-long-mode-1079-invalid-${width}.png` });
        await check('Fast keeps its own limit while Long is edited', async () => {
          await modeGroup.getByRole('radio', { name: 'Fast' }).click();
          assert.equal(await limit.inputValue(), '120');
          await modeGroup.getByRole('radio', { name: 'Long' }).click();
        });
        await check('the start sends Long with the chosen limit', async () => {
          await limit.fill('900');
          assert.equal(await start.isEnabled(), true);
          await start.click();
          await panel.getByText('Context and KV cache: synthetic fill').waitFor({ timeout: 5000 });
          assert.deepEqual(starts, [{ model: NAME, confirmPause: true, untuned: false, mode: 'long', promptBudgetSeconds: 900 }]);
        });
        await check("the running Long tune of the model's profile shows on the model's own panel", async () => {
          await panel.locator('.mm-autotune-model summary').filter({ hasText: LONG }).waitFor({ timeout: 3000 });
          assert.equal(await panel.getByRole('button', { name: 'Cancel auto-tune' }).isEnabled(), true);
          assert.equal(await modeGroup.count(), 0, 'the mode choice is hidden while a tune runs');
          assert.equal(await panel.getByRole('switch', { name: 'Allow q5 KV cache for more context' }).isDisabled(), true, 'the KV switch locks during its Long tune');
        });
        await panel.screenshot({ path: `${OUT}/autotune-long-mode-1079-running-${width}.png` });
        await check('no horizontal overflow in the panel', async () => {
          const over = await panel.evaluate(el => el.scrollWidth - el.clientWidth);
          assert.ok(over <= 1, 'overflows by ' + over + 'px');
        });
        await check('no page errors', async () => { assert.deepEqual(errors, []); });
        if (problems.length) throw Error(problems.length + ' problem(s):\n  ' + problems.join('\n  '));
        console.log(`PASS ${width}px`);
      } catch (e) { failed = e; console.log(`FAIL ${width}px: ${e.message}`); }
      await page.close();
    }
  } finally { await browser.close(); await fixture.close(); }
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
