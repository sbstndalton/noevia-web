// #1660/#1661/#1662/#1663/#1637: the Models settings page with the owner's live model set
// (2461e63b screenshot), synthetic APIs only. Fails on the pre-fix build:
//  - the page opens with the "What each service uses" overview (#1662);
//  - every card, including the in-use embedding model, Laya and "File missing" presets, has Delete (#1660/#1637);
//  - an in-use model's Delete offers "switch the service first", then deletes (#1660);
//  - deleting a "File missing" preset removes the card, and after a reload the list no longer has it (#1661);
//  - cards keep their own height in a row, details and the delete confirm stay inside their card,
//    and a mouse click leaves no focus ring (#1663).
// QA_SCREENSHOTS (default /tmp/models-1660) receives desktop (2000px) and narrow (390px) shots.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { openModelsTab } = require('./nav.cjs');
const assert = require('node:assert/strict');
const { createFixture } = require('./diary-fixture.cjs');
const { withLocale } = require('./qa-locale.cjs');
const shots = process.env.QA_SCREENSHOTS || '/tmp/models-1660';
const tag = process.env.QA_TAG || 'run';
require('node:fs').mkdirSync(shots, { recursive: true });

const base = (o) => ({ labels: [], loaded: false, maxContext: 32768, source: 'preset', canDelete: true, status: 'unloaded', suggested: false, ...o });
function initialModels() {
  return [
    base({ name: 'gemma-4-12b-it-qat-q4_0', sizeGB: 7, shape: { label: 'dense' }, labels: ['vision'] }),
    base({ name: 'gemma-4-E2B_q4_0-it', sizeGB: null, missingFile: true, failed: true, status: 'failed' }),
    base({ name: 'gemma-4-E4B', sizeGB: 4, shape: { label: 'dense' } }),
    base({ name: 'laya_multilingual_f16', sizeGB: 0.6, system: true, servedElsewhere: true, labels: [] }),
    base({ name: 'nomic-embed-text-v1', sizeGB: 0.3, loaded: true, status: 'loaded', sidecarProtected: true, labels: ['embeddings'] }),
    base({ name: 'embeddinggemma-2', sizeGB: 0.4, labels: ['embeddings'] }),
    base({ name: 'qwen3-reranker-0.6b-q8_0', sizeGB: null, missingFile: true, failed: true, status: 'failed', labels: ['reranking'] }),
    base({ name: 'Qwen3.5-4B', sizeGB: 3, shape: { label: 'dense' } }),
    base({ name: 'Qwen3.5-9B', sizeGB: 6, loaded: true, status: 'loaded', shape: { label: 'dense' } }),
  ];
}

(async () => {
  const fixture = createFixture(31360);
  await fixture.listen();
  const browser = await chromium.launch({ headless: true, channel: process.env.QA_CHANNEL || 'chrome' });
  const failures = [];
  const check = async (name, fn) => { try { await fn(); console.log(`ok   ${name}`); } catch (e) { failures.push(name); console.log(`FAIL ${name}: ${String(e.message).split('\n')[0]}`); } };
  try {
    const page = await browser.newPage(withLocale({ viewport: { width: 2000, height: 1250 } }));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));

    let installed = initialModels();
    let roles = { fast: 'Qwen3.5-4B', smart: 'Qwen3.5-9B', code: 'Qwen3.5-9B', vision: 'gemma-4-12b-it-qat-q4_0' };
    const services = { embedding: 'nomic-embed-text-v1', reranker: 'qwen3-reranker-0.6b-q8_0', decision: 'laya_multilingual_f16' };
    const calls = [];
    const files = () => installed.filter((m) => !m.missingFile && !m.servedElsewhere).map((m) => ({ key: `f/${m.name}.gguf`, name: `${m.name}.gguf`, subdir: 'f', bytes: (m.sizeGB || 1) * 1e9, size: `${m.sizeGB} GB`, modified: '2026-09-01', sharded: false, parts: 1, projector: null, sections: [m.name], modelId: m.name, file: `f/${m.name}.gguf`, shape: null, loadedOn: [], fit: [], badges: [] }));
    const assignments = () => ({
      admin: true,
      services: [
        { id: 'embedding', model: services.embedding, state: 'active', options: installed.filter((m) => m.labels.includes('embeddings') && m.name !== services.embedding).map((m) => ({ model: m.name, profile: /gemma/.test(m.name) ? 'embeddinggemma-2' : 'nomic-v1' })), canChange: true, baseUrl: null },
        { id: 'reranker', model: services.reranker, state: installed.some((m) => m.name === services.reranker && !m.missingFile) ? 'active' : 'missing', options: installed.filter((m) => m.labels.includes('reranking')).map((m) => m.name), canChange: false },
        { id: 'decision', model: services.decision, state: 'active', options: [], canChange: false },
      ],
      roles,
    });

    await page.route('**/api/**', (route) => {
      const req = route.request(), url = new URL(req.url()), p = url.pathname, m = req.method();
      const json = (b, status = 200) => route.fulfill({ status, json: b });
      const body = () => { try { return req.postDataJSON() || {}; } catch { return {}; } };
      if (p === '/api/profile' || p === '/api/auth/session') return json({ user: { id: 'qa', username: 'admin', displayName: 'Synthetic admin', role: 'admin', diaryEnabled: true, onboarded: true }, passkeys: [] });
      if (p === '/api/models/capabilities') return json({ kind: 'llamacpp', admin: true, presets: true, download: true, runtimeOptions: false, modelManagement: true });
      if (p === '/api/models/installed') return json(installed);
      if (p === '/api/auto-roles' && m === 'GET') return json({ configured: true, roles, missing: [] });
      if (p === '/api/auto-roles' && m === 'PUT') { roles = { ...body() }; for (const k of Object.keys(roles)) if (!roles[k]) delete roles[k]; calls.push(['roles', roles]); return json({ configured: true }); }
      if (p === '/api/models/assignments') return json(assignments());
      if (p === '/api/embedding' && m === 'POST') {
        const b = body(); calls.push([`embedding-${b.action}`, b.target?.model || '']);
        if (b.action === 'set-next') services.next = b.target.model;
        if (b.action === 'switch') { services.embedding = services.next; calls.push(['embedding', services.next]); for (const x of installed) x.sidecarProtected = x.name === services.embedding; }
        return json({ projects: {}, diary: {} });
      }
      if (p === '/api/models/delete' && m === 'POST') {
        const b = body(); calls.push(['delete', b.name]);
        const mo = installed.find((x) => x.name === b.name);
        if (!mo) return json({ error: 'not found' }, 404);
        if (mo.sidecarProtected) return json({ error: 'in use', errorId: 'modelInUse' }, 409);
        installed = installed.filter((x) => x.name !== b.name);
        if (services.reranker === b.name) services.reranker = '';
        if (services.decision === b.name) services.decision = '';
        const rolesCleared = [];
        for (const r of Object.keys(roles)) if (roles[r] === b.name) { rolesCleared.push(r); delete roles[r]; }
        return json({ ok: true, rolesCleared, presetRemoved: true });
      }
      if (!p.startsWith('/api/model-manager/')) return p.startsWith('/api/models/') ? json([]) : route.continue();
      const r = p.slice('/api/model-manager/'.length);
      if (r === 'models') return json({ models: files(), unregistered: [], revision: 'r1' });
      if (r === 'models/delete' && m === 'POST') {
        const key = body().models[0]; calls.push(['proxy-delete', key]);
        const mo = installed.find((x) => `f/${x.name}.gguf` === key);
        if (mo) installed = installed.filter((x) => x !== mo);
        return json({ results: [{ key, ok: !!mo, message: mo ? 'deleted' : 'no file' }], rolesCleared: [] });
      }
      if (r === 'sections') return json({ revision: 'r1', sections: [] });
      if (r.startsWith('sections/') && m === 'DELETE') { calls.push(['section-delete', decodeURIComponent(r.slice(9).split('?')[0])]); return json({ revision: 'r2' }); }
      if (r === 'overview') return json({ modelsDir: { disk: { total: 1e12, free: 5e11, usedPct: 50, totalH: '1 TB', freeH: '500 GB' } }, revision: 'r1' });
      if (r === 'models/updates') return json({ status: {} });
      if (r.startsWith('models/detail')) return json({ ...files()[0], path: '/models/f/a-very-long-folder-name/with/nested/parts/nomic-embed-text-v1.Q8_0.gguf', file: 'f/a-very-long-folder-name/with/nested/parts/nomic-embed-text-v1.Q8_0.gguf', summary: { arch: 'nomic-bert', general: { params: '137M', quant: 'Q8_0' }, model: { context_length: 8192, block_count: 12, attention_head_count: 12, attention_head_count_kv: 12 }, chat_template_features: {} } });
      return json({});
    });

    const open = async () => {
      await page.goto('http://localhost:31360/models');
      const root = page.locator('.model-manager-page');
      await root.waitFor();
      await openModelsTab(root, 'Your models');
      await root.getByRole('article', { name: 'Qwen3.5-9B' }).waitFor();
      return root;
    };
    let root = await open();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${shots}/${tag}-2000-initial.png`, fullPage: true });

    await check('#1662 the page opens with the service overview, above the model cards', async () => {
      const overview = root.getByRole('region', { name: 'What each service uses' });
      await overview.waitFor({ timeout: 2000 });
      for (const row of ['Embedding', 'Reranker', 'Decision', 'Fast', 'Smart', 'Code', 'Vision']) await overview.getByText(row, { exact: true }).first().waitFor({ timeout: 1000 });
      await overview.getByText('nomic-embed-text-v1').first().waitFor({ timeout: 1000 });
      const [o, g] = await Promise.all([overview.boundingBox(), root.locator('.model-grid').boundingBox()]);
      assert.ok(o.y < g.y, 'overview sits above the grid');
    });

    await check('#1660 every card has Delete (in-use embedding, Laya, missing presets)', async () => {
      for (const name of ['nomic-embed-text-v1', 'laya_multilingual_f16', 'gemma-4-E2B_q4_0-it', 'qwen3-reranker-0.6b-q8_0', 'Qwen3.5-9B']) {
        await root.getByRole('article', { name }).getByRole('button', { name: `Delete ${name}`, exact: true }).waitFor({ timeout: 1000 });
      }
    });

    await check('#1663 cards in a row keep their own height (no stretch gap)', async () => {
      // The empty space inside a card: between consecutive children, and under the last one.
      const gaps = await root.locator('.model-grid > .model-card').evaluateAll((cards) => cards.map((c) => {
        const kids = [...c.children].filter((x) => x.getBoundingClientRect().height > 0).map((x) => x.getBoundingClientRect());
        let worst = c.getBoundingClientRect().bottom - kids[kids.length - 1].bottom;
        for (let i = 1; i < kids.length; i++) worst = Math.max(worst, kids[i].top - kids[i - 1].bottom);
        return worst;
      }));
      assert.ok(Math.max(...gaps) < 32, `largest empty space inside a card is ${Math.round(Math.max(...gaps))}px`);
    });

    await check('#1663 Details stays inside its card and no focus ring lingers after a click', async () => {
      const card = root.getByRole('article', { name: 'nomic-embed-text-v1' });
      const before = await card.boundingBox();
      await card.getByRole('button', { name: 'Details for nomic-embed-text-v1' }).click();
      await card.locator('.mm-facts').waitFor({ timeout: 2000 });
      const after = await card.boundingBox();
      assert.ok(Math.abs(after.width - before.width) < 2, `card width changed ${Math.round(before.width)} → ${Math.round(after.width)}`);
      const btn = card.getByRole('button', { name: 'Hide details for nomic-embed-text-v1' });
      const ring = await btn.evaluate((b) => { const s = getComputedStyle(b); return `${s.outlineStyle} ${s.outlineWidth} ${s.boxShadow}`; });
      assert.ok(/^none|^\w+ 0px/.test(ring) && !/rgb.*0px 0px 0px [1-9]/.test(ring), `focus ring after mouse click: ${ring}`);
      const fileLines = await card.locator('.mm-facts .mm-mono').evaluate((d) => Math.round(d.getBoundingClientRect().height / parseFloat(getComputedStyle(d).lineHeight)));
      assert.ok(fileLines <= 1, `file path wraps over ${fileLines} lines`);
    });
    await page.screenshot({ path: `${shots}/${tag}-2000-details.png`, fullPage: true });

    await check('#1661 deleting a "File missing" preset removes the card, and it stays gone after reload', async () => {
      const name = 'gemma-4-E2B_q4_0-it';
      const card = root.getByRole('article', { name });
      const width = (await card.boundingBox()).width;
      await card.getByRole('button', { name: `Delete ${name}`, exact: true }).click();
      const confirm = card.getByRole('button', { name: 'Remove preset' });
      await confirm.waitFor({ timeout: 1000 });
      assert.ok(Math.abs((await card.boundingBox()).width - width) < 2, 'the confirm keeps the card width');
      await page.screenshot({ path: `${shots}/${tag}-2000-confirm-missing.png`, fullPage: true });
      await confirm.click();
      await root.getByRole('article', { name }).waitFor({ state: 'detached', timeout: 2000 });
      assert.ok(calls.some(([k, v]) => k === 'delete' && v === name), 'the delete reached /api/models/delete');
      root = await open();
      assert.equal(await root.getByRole('article', { name }).count(), 0, 'card back after reload');
      const listed = await page.evaluate(() => fetch('/api/models/installed').then((r) => r.json()));
      assert.ok(!listed.some((x) => x.name === name), 'the models list API still has it');
    });

    await check('#1660/#1637 deleting the in-use embedding model offers a switch first, then deletes', async () => {
      const name = 'nomic-embed-text-v1';
      const card = root.getByRole('article', { name });
      await card.getByRole('button', { name: `Delete ${name}`, exact: true }).click();
      const group = card.getByRole('group', { name: `Delete ${name}` });
      await group.getByText(/The embedding service uses this model/).waitFor({ timeout: 1000 });
      await group.getByRole('combobox', { name: 'Switch embedding to' }).selectOption('embeddinggemma-2');
      await page.screenshot({ path: `${shots}/${tag}-2000-confirm-inuse.png`, fullPage: true });
      await group.getByRole('button', { name: 'Switch and delete' }).click();
      await root.getByRole('article', { name }).waitFor({ state: 'detached', timeout: 3000 });
      const order = calls.filter(([k]) => k === 'embedding' || k === 'delete').map(([k, v]) => `${k}:${v}`);
      assert.deepEqual(order.slice(-2), ['embedding:embeddinggemma-2', `delete:${name}`], 'switch happens before delete');
      await root.getByRole('region', { name: 'What each service uses' }).getByText('embeddinggemma-2').first().waitFor({ timeout: 2000 });
    });

    await check('#1662 a chat role can be changed in place from the overview', async () => {
      const overview = root.getByRole('region', { name: 'What each service uses' });
      await overview.getByRole('combobox', { name: 'Fast' }).selectOption('gemma-4-E4B');
      await page.waitForTimeout(200);
      assert.equal(roles.fast, 'gemma-4-E4B');
      assert.equal(roles.smart, 'Qwen3.5-9B', 'other roles untouched');
    });

    await page.screenshot({ path: `${shots}/${tag}-2000-after.png`, fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(200);
    await check('#1663 narrow width: no horizontal page scroll', async () => {
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(over <= 1, `page scrolls ${over}px sideways`);
    });
    await page.screenshot({ path: `${shots}/${tag}-390.png`, fullPage: true });
    await check('no page errors', async () => assert.deepEqual(errors, []));
  } finally {
    await browser.close();
    await fixture.close();
  }
  if (failures.length) { console.error(`FAIL models-page-1660: ${failures.length} check(s) failed`); process.exitCode = 1; }
  else console.log('PASS models-page-1660');
})().catch((e) => { console.error(e); process.exitCode = 1; });
