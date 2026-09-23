// UI-only fixture: no real models, accounts, inference or storage calls.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const { createFixture } = require('./diary-fixture.cjs');
const pending = (id, label) => ({ id, label, status: 'pending', steps: [{ id: id + '-one', label: label + ' test', status: 'pending' }] });
(async () => {
  const fixture = createFixture(31347); await fixture.listen();
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const errors = [], starts = [], resumes = []; let job = { id: 'legacy', model: 'Synthetic-Qwen', status: 'interrupted',
      phase: 'Interrupted', steps: [], queue: [{ model: 'Synthetic-Qwen', status: 'interrupted' }], error: 'Older run stopped.' }, tuned = false;
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/api/**', route => {
      const req = route.request(), p = new URL(req.url()).pathname;
      const json = (body, status = 200) => route.fulfill({ json: body, status });
      if (p === '/api/profile' || p === '/api/auth/session') return json({ user: { id: 'qa', username: 'admin', displayName: 'Synthetic admin', role: 'admin', diaryEnabled: false, onboarded: true }, passkeys: [] });
      if (p === '/api/models/capabilities') return json({ kind: 'llamacpp', admin: true, autotune: true, presets: true });
      if (p === '/api/models/installed') return json([{ name: 'Synthetic-Qwen', loaded: true, labels: [], sizeGB: 5, status: 'loaded' }]);
      if (p === '/api/auto-roles') return json({ configured: true, roles: { fast: 'Synthetic-Qwen', smart: 'Synthetic-Qwen' }, missing: [] });
      if (p === '/api/models/autotune/untuned') return json({ models: tuned ? [] : ['Synthetic-Qwen'], skipped: [{ model: 'embed', reason: 'Not a chat model' }] });
      if (p === '/api/models/autotune/cancel') {
        job.status = 'cancelled'; job.phase = 'Cancelled'; job.models[0].status = 'interrupted';
        job.models[0].phases[1].status = 'interrupted'; job.models[0].phases[1].reason = 'Cancelled after the KV commit';
        return json(job);
      }
      if (p === '/api/models/autotune/resume') {
        resumes.push(req.postDataJSON());
        job.status = 'running'; job.phase = 'Drafting'; job.models[0].status = 'running';
        job.models[0].phases[1].status = 'passed'; job.models[0].phases[1].value = { context: 16384 };
        job.models[0].phases[2].status = 'running';
        return json(job, 202);
      }
      if (p === '/api/models/autotune') {
        if (req.method() === 'POST') {
          starts.push(req.postDataJSON());
          job = { id: 't1', model: 'Synthetic-Qwen', status: 'running', phase: 'KV cache', startedAt: Date.now(),
            models: [{ model: 'Synthetic-Qwen', status: 'running', phases: [
              { ...pending('kv', 'KV cache'), status: 'passed', value: { kv: 'q8_0', generation: 48 }, steps: [{ id: 'q8_0', label: 'q8_0 KV cache', status: 'passed', generation: 48 }] },
              { ...pending('context', 'Context size'), status: 'running', steps: [{ id: 'load', label: 'Load 16,384', status: 'running', ctx: 16384 }] },
              pending('drafting', 'Drafting'), pending('batch', 'Batch and micro-batch'),
            ] }],
            queueProgress: { done: 0, total: 1 }, log: [{ at: Date.now(), text: 'Testing context size' }] };
          return json(job, 202);
        }
        return json({ job, history: [] });
      }
      if (p === '/api/model-manager/models') return json({ models: [], unregistered: [] });
      if (p === '/api/model-manager/models/updates') return json({ status: {} });
      if (p === '/api/model-manager/overview') return json({});
      if (p.startsWith('/api/model-manager/')) return json({});
      return route.continue();
    });
    await page.goto('http://localhost:31347');
    await page.getByTitle('Settings', { exact: true }).click();
    const settings = page.getByRole('region', { name: 'Settings' });
    await settings.getByRole('button', { name: 'Models & routing' }).click();
    await settings.getByRole('button', { name: 'Open model manager' }).click();
    const manager = page.locator('.model-manager-page');
    const open = manager.getByRole('button', { name: 'Tune untuned models', exact: true });
    await open.waitFor();
    assert.ok(await manager.getByRole('button', { name: 'Check for updates' }).isVisible());
    await open.focus(); await page.keyboard.press('Enter');
    const panel = page.locator('#library-autotune');
    await panel.getByText(/1 model need tuning/).waitFor();
    await panel.getByText(/Older run stopped/).waitFor();
    const start = panel.getByRole('button', { name: 'Tune untuned models and apply' });
    assert.ok(await start.isDisabled());
    await panel.getByLabel(/Chat pauses while each model/).check();
    await start.click();
    await panel.getByRole('button', { name: 'Cancel auto-tune' }).waitFor();
    assert.deepEqual(starts, [{ model: '', confirmPause: true, untuned: true }]);
    await panel.getByRole('region', { name: 'Synthetic-Qwen KV cache steps' }).getByText('48 tokens/s').waitFor();
    await panel.getByRole('region', { name: 'Synthetic-Qwen Context size steps' }).getByText('16384 tokens').waitFor();
    for (const width of [375, 768, 1440]) for (const theme of ['light', 'dark']) {
      await page.setViewportSize({ width, height: 950 });
      await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme);
      await panel.scrollIntoViewIfNeeded();
      assert.ok(await manager.evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'overflow ' + width + ' ' + theme);
      const cancel = panel.getByRole('button', { name: 'Cancel auto-tune' });
      await cancel.focus(); await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
      assert.ok(await cancel.evaluate(el => getComputedStyle(el).outlineStyle !== 'none'), 'focus ' + width + ' ' + theme);
      if (width === 375 && theme === 'light' || width === 1440 && theme === 'dark') {
        await panel.getByRole('heading', { name: 'Automatic tuning' }).scrollIntoViewIfNeeded();
        await page.screenshot({ path: (process.env.QA_SCREENSHOTS || '/tmp') + '/models-autotune-' + width + '-' + theme + '-top.png' });
        await cancel.scrollIntoViewIfNeeded();
        await page.screenshot({ path: (process.env.QA_SCREENSHOTS || '/tmp') + '/models-autotune-' + width + '-' + theme + '-bottom.png' });
      }
    }
    await panel.getByRole('button', { name: 'Cancel auto-tune' }).click();
    const resume = panel.getByRole('button', { name: 'Resume auto-tune' });
    await resume.waitFor();
    await panel.getByText(/Cancelled after the KV commit/).waitFor();
    await resume.click();
    await panel.getByRole('button', { name: 'Cancel auto-tune' }).waitFor();
    assert.deepEqual(resumes, [{ confirmPause: true }]);
    assert.ok(await panel.getByText(/context 16384/).isVisible());
    tuned = true;
    job = { ...job, status: 'passed', phase: 'Done', models: [{ ...job.models[0], status: 'passed',
      phases: job.models[0].phases.map(p => ({ ...p, status: 'passed' })),
      result: { specLabel: 'MTP deep drafts', generation: 60, kv: 'q8_0', context: 16384, acceptance: 65, ubatch: 1024, promptPerSecond: 800, extensions: [] } }] };
    await open.click(); await open.click();
    await panel.getByText(/KV cache: q8_0/).waitFor();
    await panel.getByText(/0 models need tuning/).waitFor();
    assert.ok(await panel.getByRole('button', { name: 'Tune untuned models and apply' }).isDisabled());
    assert.deepEqual(errors, []); assert.equal(fixture.requests.length, 0);
    console.log('PASS auto-tune UI: nested phases/values, confirm, cancel, Resume, completion, keyboard and six responsive/theme layouts.');
  } finally { await browser.close(); await fixture.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
