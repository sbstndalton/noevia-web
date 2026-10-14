// #1668: the embedding service is settings-driven, so every embedding model can be switched away
// from and deleted from the Models page, and embedding can be turned off. Synthetic APIs only.
// Fails on the pre-fix build:
//  - the overview's embedding row offers "Turn embedding off" for a managed service;
//  - a switch goes through 'service-switch' (the service loads the model before re-indexing), not
//    a bare set-next against a server that does not serve it;
//  - deleting the in-use model offers "Turn embedding off and delete", which stops the service and
//    then deletes, retrying while the service still holds the file for a moment;
//  - once off, the row reads "Off" and offers "Turn embedding on with", which turns it back on.
// QA_SCREENSHOTS (default /tmp/embedding-1668) receives desktop and narrow shots.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { openModelsTab } = require('./nav.cjs');
const assert = require('node:assert/strict');
const { createFixture } = require('./diary-fixture.cjs');
const { withLocale } = require('./qa-locale.cjs');
const shots = process.env.QA_SCREENSHOTS || '/tmp/embedding-1668';
const tag = process.env.QA_TAG || 'run';
require('node:fs').mkdirSync(shots, { recursive: true });

const base = (o) => ({ labels: [], loaded: false, maxContext: 32768, source: 'preset', canDelete: true, status: 'unloaded', suggested: false, ...o });
const initialModels = () => [
  base({ name: 'nomic-embed-text-v1', sizeGB: 0.3, labels: ['embeddings'] }),
  base({ name: 'embeddinggemma-2', sizeGB: 0.4, labels: ['embeddings'] }),
  base({ name: 'Qwen3.5-4B', sizeGB: 3, shape: { label: 'dense' } }),
  base({ name: 'Qwen3.5-9B', sizeGB: 6, loaded: true, status: 'loaded', shape: { label: 'dense' } }),
];

(async () => {
  const fixture = createFixture(31368);
  await fixture.listen();
  const browser = await chromium.launch({ headless: true, channel: process.env.QA_CHANNEL || 'chrome' });
  const failures = [];
  const check = async (name, fn) => { try { await fn(); console.log(`ok   ${name}`); } catch (e) { failures.push(name); console.log(`FAIL ${name}: ${String(e.message).split('\n')[0]}`); } };
  try {
    const page = await browser.newPage(withLocale({ viewport: { width: 1600, height: 1100 } }));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));

    let installed = initialModels();
    const roles = { fast: 'Qwen3.5-4B', smart: 'Qwen3.5-9B' };
    // The managed service: what it serves (empty = off), what the router still holds for a moment.
    const svc = { models: ['nomic-embed-text-v1'], holding: [], active: 'nomic-embed-text-v1', next: null, holdOnDelete: 0 };
    const calls = [];
    const isProtected = (name) => svc.models.includes(name) || svc.holding.includes(name);
    const assignments = () => {
      const off = svc.models.length === 0;
      const embed = installed.filter((m) => m.labels.includes('embeddings'));
      return { admin: true, services: [
        { id: 'embedding', model: svc.active, state: svc.next ? 'switching' : off ? 'off' : 'active', ...(svc.next ? { next: svc.next } : {}), managed: true, canChange: true, canTurnOff: !off && !svc.next, baseUrl: 'http://embed:8080',
          options: embed.filter((m) => off || m.name !== svc.active).map((m) => ({ model: m.name, profile: /gemma/.test(m.name) ? 'embeddinggemma-2' : 'nomic-v1', served: true })) },
        { id: 'reranker', model: null, state: 'off', options: [], canChange: false },
        { id: 'decision', model: null, state: 'missing', canChange: false },
      ] };
    };

    await page.route('**/api/**', async (route) => {
      const req = route.request(), url = new URL(req.url()), p = url.pathname, m = req.method();
      const json = (b, status = 200) => route.fulfill({ status, json: b });
      const body = () => { try { return req.postDataJSON() || {}; } catch { return {}; } };
      if (p === '/api/profile' || p === '/api/auth/session') return json({ user: { id: 'qa', username: 'admin', displayName: 'Synthetic admin', role: 'admin', diaryEnabled: true, onboarded: true }, passkeys: [] });
      if (p === '/api/models/capabilities') return json({ kind: 'llamacpp', admin: true, presets: true, download: true, runtimeOptions: false, modelManagement: true });
      if (p === '/api/models/installed') return json(installed.map((x) => ({ ...x, sidecarProtected: isProtected(x.name) })));
      if (p === '/api/auto-roles' && m === 'GET') return json({ configured: true, roles, missing: [] });
      if (p === '/api/models/assignments') return json(assignments());
      if (p === '/api/embedding' && m === 'POST') {
        const b = body(); calls.push(['embedding', b.action, b.model || b.target?.model || '']);
        if (b.action === 'service-off') {
          svc.holding = [...svc.models]; svc.models = []; svc.holdOnDelete = 1; // the router lets go a moment later
          return json({ service: { managed: true, enabled: false } });
        }
        if (b.action === 'service-switch') {
          if (svc.models.length === 0 && b.model === svc.active) { svc.models = [b.model]; return json({ service: { enabled: true }, projects: {} }); }
          svc.models = [svc.active, b.model]; svc.next = b.model;
          return json({ projects: {}, diary: {}, service: { enabled: true } });
        }
        if (b.action === 'switch') {
          if (!svc.next) return json({ projects: { error: 'No re-index is under way.', code: 'noNext', status: 409 } }, 409);
          const old = svc.active; svc.active = svc.next; svc.next = null; svc.previous = old;
          return json({ projects: {}, diary: {} });
        }
        if (b.action === 'finish') { svc.holding = svc.models.filter((x) => x !== svc.active); svc.models = [svc.active]; svc.holdOnDelete = 1; return json({ projects: {}, diary: {} }); }
        return json({ projects: {}, diary: {} });
      }
      if (p === '/api/models/delete' && m === 'POST') {
        const b = body(); calls.push(['delete', b.name]);
        if (svc.models.includes(b.name)) return json({ error: 'in use', errorId: 'modelInUse' }, 409);
        if (svc.holding.includes(b.name)) {
          if (svc.holdOnDelete-- > 0) return json({ error: 'in use', errorId: 'modelInUse' }, 409);
          svc.holding = svc.holding.filter((x) => x !== b.name);
        }
        installed = installed.filter((x) => x.name !== b.name);
        return json({ ok: true, rolesCleared: [], presetRemoved: true });
      }
      if (!p.startsWith('/api/model-manager/')) return p.startsWith('/api/models/') ? json([]) : route.continue();
      const r = p.slice('/api/model-manager/'.length);
      if (r === 'models') return json({ models: [], unregistered: [], revision: 'r1' });
      if (r === 'sections') return json({ revision: 'r1', sections: [] });
      if (r === 'overview') return json({ modelsDir: { disk: { total: 1e12, free: 5e11, usedPct: 50, totalH: '1 TB', freeH: '500 GB' } }, revision: 'r1' });
      if (r === 'models/updates') return json({ status: {} });
      return json({});
    });

    const open = async () => {
      await page.goto('http://localhost:31368/models');
      const root = page.locator('.model-manager-page');
      await root.waitFor();
      await openModelsTab(root, 'Your models');
      await root.getByRole('article', { name: 'Qwen3.5-9B' }).waitFor();
      return root;
    };
    let root = await open();
    const overview = () => root.getByRole('region', { name: 'What each service uses' });
    const embedRow = () => overview().locator('[data-service="embedding"]');
    await page.screenshot({ path: `${shots}/${tag}-initial.png`, fullPage: true });

    await check('#1668 a managed embedding row offers "Turn embedding off" and every other installed embedding model', async () => {
      await embedRow().getByRole('button', { name: 'Turn embedding off' }).waitFor({ timeout: 2000 });
      const options = await embedRow().getByRole('combobox', { name: 'Switch embedding to' }).locator('option').allTextContents();
      assert.ok(options.includes('embeddinggemma-2'), options.join(', '));
    });

    await check('#1668 switching loads the model in the service first (service-switch), then finishes; the old model deletes', async () => {
      await embedRow().getByRole('combobox', { name: 'Switch embedding to' }).selectOption('embeddinggemma-2');
      await embedRow().getByRole('button', { name: 'Switch', exact: true }).click();
      await overview().getByText('Saved.').waitFor({ timeout: 4000 });
      const actions = calls.filter(([k]) => k === 'embedding').map(([, a]) => a);
      assert.deepEqual(actions.slice(0, 3), ['service-switch', 'switch', 'finish'], actions.join(' → '));
      assert.ok(!actions.includes('set-next'), 'never a bare set-next against a server that does not serve the model');
      await embedRow().getByText('embeddinggemma-2').first().waitFor({ timeout: 2000 });
      const card = root.getByRole('article', { name: 'nomic-embed-text-v1' });
      await card.getByRole('button', { name: 'Delete nomic-embed-text-v1', exact: true }).click();
      await card.getByText('letting go of it', { exact: false }).waitFor({ timeout: 3000 });
      await card.getByRole('button', { name: 'Delete files', exact: true }).click();
      await root.getByRole('article', { name: 'nomic-embed-text-v1' }).waitFor({ state: 'detached', timeout: 15000 });
      await embedRow().getByText('No other embedding model is installed.').waitFor({ timeout: 3000 });
    });
    await page.screenshot({ path: `${shots}/${tag}-after-switch.png`, fullPage: true });

    await check('#1668 deleting the last embedding model: "Turn embedding off and delete" stops the service, then deletes', async () => {
      const name = 'embeddinggemma-2';
      const card = root.getByRole('article', { name });
      await card.getByRole('button', { name: `Delete ${name}`, exact: true }).click();
      const offAndDelete = card.getByRole('button', { name: 'Turn embedding off and delete' });
      await offAndDelete.waitFor({ timeout: 3000 });
      await card.getByText('turn embedding off', { exact: false }).first().waitFor({ timeout: 1000 });
      await page.screenshot({ path: `${shots}/${tag}-confirm-off.png`, fullPage: true });
      await offAndDelete.click();
      await root.getByRole('article', { name }).waitFor({ state: 'detached', timeout: 15000 });
      const order = calls.filter(([k, a]) => (k === 'embedding' && a === 'service-off') || (k === 'delete' && a === name)).map(([k, a]) => `${k}:${a}`);
      assert.equal(order[0], 'embedding:service-off', order.join(' → '));
      assert.ok(order.filter((x) => x === `delete:${name}`).length >= 2, 'the delete was retried while the service still held the file');
    });

    await check('#1668 off: the row reads "Off" and offers "Turn embedding on with"', async () => {
      installed = [...installed, base({ name: 'nomic-embed-text-v1', sizeGB: 0.3, labels: ['embeddings'] })];
      svc.active = 'nomic-embed-text-v1';
      root = await open();
      await embedRow().getByText('Off', { exact: true }).waitFor({ timeout: 2000 });
      assert.equal(await embedRow().getByRole('button', { name: 'Turn embedding off' }).count(), 0);
      await embedRow().getByRole('combobox', { name: 'Turn embedding on with' }).selectOption('nomic-embed-text-v1');
      await embedRow().getByRole('button', { name: 'Turn on', exact: true }).click();
      await overview().getByText('Saved.').waitFor({ timeout: 4000 });
      assert.deepEqual(svc.models, ['nomic-embed-text-v1']);
    });
    await page.screenshot({ path: `${shots}/${tag}-back-on.png`, fullPage: true });

    await page.setViewportSize({ width: 390, height: 844 });
    root = await open();
    await check('390: the embedding row and its controls fit the width', async () => {
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(overflow <= 0, `${overflow}px horizontal overflow`);
      await embedRow().getByRole('button', { name: 'Turn embedding off' }).waitFor({ timeout: 2000 });
    });
    await page.screenshot({ path: `${shots}/${tag}-390.png`, fullPage: true });
    await check('no page errors', async () => assert.deepEqual(errors, []));
  } finally {
    await browser.close();
    await fixture.close();
  }
  if (failures.length) { console.error(`FAIL embedding-service-1668: ${failures.length} check(s) failed`); process.exitCode = 1; }
  else console.log('PASS embedding-service-1668');
})().catch((e) => { console.error(e); process.exitCode = 1; });
