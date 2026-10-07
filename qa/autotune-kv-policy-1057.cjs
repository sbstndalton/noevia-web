// #1057: the owner's KV cache policy on a model's Tune panel. Checks the per-model switch "Allow q5
// KV cache for more context" (off by default, a real role=switch that saves through
// POST /api/models/autotune/settings and shows the server's answer, a failed save reported and not
// faked), that the floor note names q8_0 and the types this server tries for the model, that a
// bf16 quality baseline is named, and that a run where the engine rejected bf16 says f16 stood in.
// Last, a start whose reply is slow while the switch is saved: the start must still land (busy
// clears, the running job shows). Synthetic fixtures only; that start is answered by the mock.
// QA_DIST serves a build elsewhere; QA_SCREENSHOTS is the screenshot directory.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { openSettings, openModelsTab } = require('./nav.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createFixture } = require('./diary-fixture.cjs');
const OUT = process.env.QA_SCREENSHOTS || '/tmp';
const NAME = 'synthetic-12b-it';
const step = (id, label, status = 'passed', extra = {}) => ({ id, label, status, ...extra });
// A finished planned run on an engine without a bf16 cache: the first fill was refused, f16 ran.
const job = {
  id: 'synthetic-1057', model: NAME, bulk: false, promptBudgetSeconds: 120, status: 'passed', phase: 'Done',
  startedAt: 1791360000000, finishedAt: 1791360900000, queueProgress: { done: 1, total: 1 }, waiting: false,
  log: [{ at: 1791360001000, text: 'This engine does not support a bf16 KV cache, so auto-tune uses f16 (also unquantized) in its place.' }],
  models: [{ model: NAME, status: 'passed', kv: ['f16', 'q8_0'],
    baseline: { reference: 'bf16', probes: ['arithmetic', 'extraction', 'reasoning'], skipped: [] },
    phases: [
      { id: 'context', label: 'Context and KV cache', status: 'passed', value: { context: 32768, kv: 'f16', probes: 2 }, steps: [
        step('probe-0', 'Fill 65,536 · bf16 KV cache', 'failed', { reason: 'This engine does not support a bf16 KV cache, so auto-tune uses f16 (also unquantized) in its place.' }),
        step('probe-1', 'Fill 65,536 · f16 KV cache', 'failed', { reason: 'The engine ran out of memory at this setting.' }),
        step('probe-2', 'Fill 32,768 · f16 KV cache')] },
      { id: 'sampling', label: 'Sampling', status: 'passed', value: { skipped: true, reason: 'No recommended sampling values.' }, steps: [step('apply', 'Recommended sampling', 'skipped')] },
      { id: 'drafting', label: 'Drafting', status: 'passed', value: { spec: 'off', specLabel: 'Off' }, steps: [step('off', 'Off')] },
      { id: 'batch', label: 'Batch and micro-batch', status: 'passed', value: { ubatch: 512, promptPerSecond: 600 }, steps: [step('512', 'Micro-batch 512')] },
      { id: 'verify', label: 'Final fill check', status: 'passed', value: { context: 32768 }, steps: [step('verify-5', 'Final fill 32,768 · f16 KV cache')] },
    ],
    result: { kv: 'f16', context: 32768, plan: 'wasm', probes: 3, kvFallback: { from: 'bf16', to: 'f16', at: 65536 }, spec: 'off', specLabel: 'Off',
      generation: 21.4, acceptance: null, ubatch: 512, promptPerSecond: 600, extensions: [], quality: { passed: true, checks: [] },
      baseline: { reference: 'bf16', probes: ['arithmetic', 'extraction', 'reasoning'], skipped: [] } } }],
};
const schema = [{ tier: 'Common', open: true, fields: [{ key: 'ctx-size', label: 'Context size', kind: 'int', choices: [], placeholder: '8192', help: '' }] }];
const candidates = allow => ['bf16', 'q8_0', ...(allow ? ['q5_1', 'q5_0'] : [])];
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const fixture = createFixture(31057); await fixture.listen();
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  let failed = null;
  try {
    for (const width of [375, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const errors = [], posts = [], saves = [];
      let allow = false, failNextSave = false, started = false;
      const running = { ...job, status: 'running', phase: 'Synthetic tuning phase', finishedAt: undefined,
        models: [{ ...job.models[0], status: 'pending', result: undefined }] };
      page.on('pageerror', e => errors.push(e.message));
      await page.route('**/api/**', async route => {
        const req = route.request(), p = new URL(req.url()).pathname;
        const json = (body, status = 200) => route.fulfill({ json: body, status });
        if (req.method() !== 'GET') posts.push(req.method() + ' ' + p);
        const status = () => ({ job: started ? running : job, history: [{ at: 1791360900000, ...job.models[0].result }], kvCandidates: candidates(allow), settings: { allowQ5Kv: allow }, planImpl: 'wasm', loadAdvisor: 'off' });
        if (p === '/api/models/autotune/settings' && req.method() === 'POST') {
          const body = req.postDataJSON();
          saves.push(body);
          if (failNextSave) { failNextSave = false; return json({ error: 'Synthetic save failure.' }, 500); }
          allow = body.allowQ5Kv === true;
          return json(status());
        }
        if (p === '/api/models/autotune' && req.method() === 'POST') {
          // A slow start reply, so a switch save lands in between.
          await new Promise(r => setTimeout(r, 1500));
          started = true;
          return json(running, 202);
        }
        if (p === '/api/profile' || p === '/api/auth/session') return json({ user: { id: 'qa', username: 'admin', displayName: 'Synthetic admin', role: 'admin', diaryEnabled: false, onboarded: true }, passkeys: [] });
        if (p === '/api/models/capabilities') return json({ kind: 'llamacpp', admin: true, autotune: true, presets: true });
        if (p === '/api/models/installed') return json([{ name: NAME, loaded: true, labels: [], sizeGB: 7.3, status: 'loaded' }]);
        if (p === '/api/auto-roles') return json({ configured: true, roles: { fast: NAME, smart: NAME }, missing: [] });
        if (p === '/api/models/evidence') return json({ tracked: true, categories: [] });
        if (p === '/api/models/estimate') return json({ model: NAME, budgetGib: 16, chat: true, sizeable: true, arch: 'gemma3', nativeCtx: 131072, modelGib: 7, pinnedGib: 0, reserveGib: 1, safety: 1.05, moe: false, rows: [], current: { ctx: 32768, kv: 'f16' } });
        if (p === '/api/models/hardware') return json({ source: 'model-manager', cpu: 'Synthetic CPU', systemGB: 64, gpus: [] });
        if (p === '/api/models/autotune') return json(status());
        if (p === '/api/models/autotune/untuned') return json({ models: [], skipped: [] });
        if (p === '/api/models/calibration') return json({ job: null, history: [] });
        if (p === '/api/model-manager/sections') return json({ revision: 'r1', schema, sections: [
          { name: NAME, items: [['ctx-size', '32768']], hasFile: true, file: NAME + '/' + NAME + '.gguf', cli: 'llama-server' },
        ], unregistered: [], backups: [] });
        if (p.startsWith('/api/model-manager/sections/') && p.endsWith('/autoconfig')) return json({});
        if (p.startsWith('/api/model-manager/sections/')) return json({ name: NAME, exists: true, values: { 'ctx-size': '32768', 'cache-type-k': 'f16', 'cache-type-v': 'f16' }, extras: '', hints: [], revision: 'r1', schema });
        if (p === '/api/model-manager/downloads') return json({ jobs: [] });
        if (p.startsWith('/api/model-manager/')) return json({});
        return route.continue();
      });
      await page.goto('http://localhost:31057');
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
        await panel.locator('.mm-autotune-model').first().waitFor({ state: 'attached', timeout: 5000 });
        const toggle = panel.getByRole('switch', { name: 'Allow q5 KV cache for more context' });
        await check('switch present, off by default', async () => {
          await toggle.waitFor({ timeout: 3000 });
          assert.equal(await toggle.getAttribute('aria-checked'), 'false');
          assert.ok(await toggle.isEnabled(), 'switch disabled with no run in progress');
        });
        await check('switch explained', async () => {
          const help = (await panel.locator('.mm-autotune-option').innerText()).replace(/\s+/g, ' ');
          assert.match(help, /bf16/, 'help does not name bf16: ' + help);
          assert.match(help, /q8_0/, 'help does not name the q8_0 floor: ' + help);
          assert.match(help, /twice/, 'help does not state the about-2x rule: ' + help);
          assert.match(help, /next tune/i, 'help does not say when it applies: ' + help);
        });
        await panel.screenshot({ path: `${OUT}/autotune-kv-policy-1057-off-${width}.png` });
        await check('turning it on saves for this model and shows the saved state', async () => {
          await toggle.click();
          await page.waitForFunction(() => document.querySelector('.mm-easy-autotune [role="switch"]')?.getAttribute('aria-checked') === 'true', null, { timeout: 3000 });
          assert.deepEqual(saves.at(-1), { model: NAME, allowQ5Kv: true });
        });
        await panel.screenshot({ path: `${OUT}/autotune-kv-policy-1057-on-${width}.png` });
        await check('a failed save is reported and the switch keeps the saved state', async () => {
          failNextSave = true;
          await toggle.click();
          await panel.getByRole('alert').filter({ hasText: 'Synthetic save failure.' }).waitFor({ timeout: 3000 });
          assert.equal(await toggle.getAttribute('aria-checked'), 'true');
          assert.deepEqual(saves.at(-1), { model: NAME, allowQ5Kv: false });
        });
        await panel.screenshot({ path: `${OUT}/autotune-kv-policy-1057-error-${width}.png` });
        await check('keyboard: Space toggles it off again', async () => {
          await toggle.focus();
          await page.keyboard.press('Space');
          await page.waitForFunction(() => document.querySelector('.mm-easy-autotune [role="switch"]')?.getAttribute('aria-checked') === 'false', null, { timeout: 3000 });
          assert.deepEqual(saves.at(-1), { model: NAME, allowQ5Kv: false });
          assert.equal(await panel.getByRole('alert').count(), 0, 'the old error stays after a successful save');
        });
        // A finished model's details start collapsed; open them as a reader would.
        await panel.locator('details.mm-autotune-model').first().evaluate((d) => { d.open = true; });
        await check('bf16 baseline is named', async () => {
          const tune = (await panel.innerText()).replace(/\s+/g, ' ');
          assert.match(tune, /bf16 KV cache with drafting off/, 'bf16 reference not named');
        });
        await check('f16 stand-in is explained on the result', async () => {
          const tune = (await panel.innerText()).replace(/\s+/g, ' ');
          assert.match(tune, /does not support a bf16 KV cache, so f16, also full precision, was used instead/, 'no fallback note on the result');
        });
        await check('floor note names q8_0 and the tried types', async () => {
          await page.locator('details.mm-guided').first().evaluate((d) => { d.open = true; });
          const floor = page.locator('.mm-guided [role="note"]').filter({ hasText: 'q8_0' }).first();
          await floor.waitFor({ timeout: 5000 });
          const text = (await floor.innerText()).replace(/\s+/g, ' ');
          assert.match(text, /bf16 and q8_0/, 'does not list the tried candidates: ' + text);
          assert.doesNotMatch(text, /Q5 floor/, 'still describes the old Q5 floor: ' + text);
        });
        await check('no tune started before this point', async () => { assert.deepEqual(posts.filter(x => /\/api\/models\/autotune(\/resume)?$/.test(x)), []); });
        await check('a switch save during a slow start does not freeze the panel', async () => {
          const confirm = panel.locator('.mm-autotune-actions input[type="checkbox"]').first();
          await confirm.evaluate(el => el.scrollIntoView({ block: 'center' }));
          // The switch's hit area must stay on the switch: nothing else in the panel may be covered.
          const covered = await confirm.evaluate(el => { const r = el.getBoundingClientRect(); return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('.glass-switch') != null; });
          assert.equal(covered, false, 'the switch hit area covers the confirm checkbox');
          await confirm.check();
          const apply = panel.getByRole('button', { name: 'Auto-tune and apply' });
          await apply.evaluate(el => el.scrollIntoView({ block: 'center' }));
          await apply.click();
          await panel.getByRole('button', { name: 'Starting…' }).waitFor({ timeout: 3000 }).catch(() => {});
          await toggle.evaluate(el => el.scrollIntoView({ block: 'center' }));
          await toggle.click();
          await page.waitForFunction(() => document.querySelector('.mm-easy-autotune [role="switch"]')?.getAttribute('aria-checked') === 'true', null, { timeout: 3000 });
          assert.ok(!started, 'the switch was saved after the start had already answered');
          await panel.getByText('Synthetic tuning phase').waitFor({ timeout: 5000 });
          const cancel = panel.getByRole('button', { name: 'Cancel auto-tune' });
          await cancel.waitFor({ timeout: 3000 });
          assert.ok(await cancel.isEnabled(), 'the panel stayed busy after the start answered');
          assert.equal(await toggle.isDisabled(), true, 'the switch is locked while this model tunes');
        });
        await panel.screenshot({ path: `${OUT}/autotune-kv-policy-1057-running-${width}.png` });
        await check('no page errors', async () => { assert.deepEqual(errors, []); });
        if (problems.length) throw Error(problems.length + ' problem(s):\n  ' + problems.join('\n  '));
        console.log(`PASS ${width}px`);
      } catch (e) { failed = e; console.log(`FAIL ${width}px: ${e.message}`); }
      await page.close();
    }
  } finally { await browser.close(); await fixture.close(); }
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
