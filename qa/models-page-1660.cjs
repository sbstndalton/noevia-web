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
    base({ name: 'nomic-embed-text-v2', sizeGB: 0.3, labels: ['embeddings'] }),
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
    const reset = () => { installed = initialModels(); roles = { fast: 'Qwen3.5-4B', smart: 'Qwen3.5-9B', code: 'Qwen3.5-9B', vision: 'gemma-4-12b-it-qat-q4_0' }; Object.assign(services, { embedding: 'nomic-embed-text-v1', reranker: 'qwen3-reranker-0.6b-q8_0', decision: 'laya_multilingual_f16', next: undefined }); };
    const calls = [];
    // Server behaviour switches: a re-index that is not ready once; a server that keeps the old model
    // protected after a switch (the refusal path); a slow delete (busy state); a member session.
    const mode = { notReadyOnce: false, keepProtected: false, deleteDelayMs: 0, member: false };
    const files = () => installed.filter((m) => !m.missingFile && !m.servedElsewhere).map((m) => ({ key: `f/${m.name}.gguf`, name: `${m.name}.gguf`, subdir: 'f', bytes: (m.sizeGB || 1) * 1e9, size: `${m.sizeGB} GB`, modified: '2026-09-01', sharded: false, parts: 1, projector: null, sections: [m.name], modelId: m.name, file: `f/${m.name}.gguf`, shape: null, loadedOn: [], fit: [], badges: [] }));
    const assignments = () => ({
      admin: !mode.member,
      services: [
        { id: 'embedding', model: services.embedding, state: services.next && services.next !== services.embedding ? 'switching' : 'active', ...(services.next && services.next !== services.embedding ? { next: services.next } : {}), options: installed.filter((m) => m.labels.includes('embeddings') && m.name !== services.embedding).map((m) => ({ model: m.name, profile: /gemma/.test(m.name) ? 'embeddinggemma-2' : 'nomic-v1' })), canChange: !mode.member, baseUrl: null },
        { id: 'reranker', model: services.reranker, state: installed.some((m) => m.name === services.reranker && !m.missingFile) ? 'active' : 'missing', options: installed.filter((m) => m.labels.includes('reranking')).map((m) => m.name), canChange: false },
        (() => { const laya = installed.find((m) => m.system); return { id: 'decision', model: laya ? laya.name : null, state: laya ? 'active' : 'missing', canChange: false }; })(),
      ],
      roles,
    });

    await page.route('**/api/**', async (route) => {
      const req = route.request(), url = new URL(req.url()), p = url.pathname, m = req.method();
      const json = (b, status = 200) => route.fulfill({ status, json: b });
      const body = () => { try { return req.postDataJSON() || {}; } catch { return {}; } };
      if (p === '/api/profile' || p === '/api/auth/session') return json({ user: { id: 'qa', username: mode.member ? 'member' : 'admin', displayName: mode.member ? 'Synthetic member' : 'Synthetic admin', role: mode.member ? 'member' : 'admin', diaryEnabled: true, onboarded: true }, passkeys: [] });
      if (p === '/api/models/capabilities') return json({ kind: 'llamacpp', admin: !mode.member, presets: true, download: true, runtimeOptions: false, modelManagement: true });
      if (p === '/api/models/installed') return json(installed);
      if (p === '/api/auto-roles' && m === 'GET') return json({ configured: true, roles, missing: [] });
      if (p === '/api/auto-roles' && m === 'PUT') { roles = { ...body() }; for (const k of Object.keys(roles)) if (!roles[k]) delete roles[k]; calls.push(['roles', roles]); return json({ configured: true }); }
      if (p === '/api/models/assignments') return json(assignments());
      if (p === '/api/embedding' && m === 'POST') {
        const b = body(); calls.push([`embedding-${b.action}`, b.target?.model || '']);
        if (b.action === 'set-next') services.next = b.target.model;
        if (b.action === 'switch') {
          if (mode.notReadyOnce) { mode.notReadyOnce = false; return json({ projects: { error: 'The new model has not finished indexing every project yet.', code: 'notReady', status: 409 } }, 409); }
          // core C1: once the saved configuration has switched away (and finished), the env-seeded
          // old model is no longer protected; keepProtected models a server that still protects it.
          const old = services.embedding; services.embedding = services.next; calls.push(['embedding', services.next]);
          for (const x of installed) x.sidecarProtected = x.name === services.embedding || (mode.keepProtected && x.name === old);
        }
        return json({ projects: {}, diary: {} });
      }
      if (p === '/api/models/delete' && m === 'POST') {
        const b = body(); calls.push(['delete', b.name]);
        if (mode.deleteDelayMs) await new Promise((r) => setTimeout(r, mode.deleteDelayMs));
        const mo = installed.find((x) => x.name === b.name);
        if (!mo) return json({ error: 'not found' }, 404);
        if (mo.sidecarProtected) return json({ error: 'in use', errorId: 'modelInUse' }, 409);
        if (mo.system && b.confirmSystem !== true) return json({ error: 'System routing model — not deleted', errorId: 'systemModel', service: 'decision' }, 400);
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
        if (mode.deleteDelayMs) await new Promise((r) => setTimeout(r, mode.deleteDelayMs));
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

    await check('#1662 overview rows line up: one column of pills, inline controls, no empty block under the last row', async () => {
      const overview = root.getByRole('region', { name: 'What each service uses' });
      const geo = await overview.evaluate((sec) => {
        const rows = [...sec.querySelectorAll('.mm-assign-row')];
        return { pills: rows.map((r) => Math.round(r.querySelector('.mm-state').getBoundingClientRect().left)),
          rowTops: rows.map((r) => Math.round(r.getBoundingClientRect().top)),
          embedHeight: Math.round(sec.querySelector('[data-service="embedding"]').getBoundingClientRect().height),
          fastHeight: Math.round(sec.querySelector('[data-role="fast"]').getBoundingClientRect().height),
          tail: Math.round(sec.getBoundingClientRect().bottom - rows[rows.length - 1].getBoundingClientRect().bottom) };
      });
      assert.equal(new Set(geo.pills).size, 1, `status pills start at ${[...new Set(geo.pills)].join(', ')}`);
      assert.equal(new Set(geo.rowTops).size, geo.rowTops.length, 'one row per line (no side-by-side columns to misalign)');
      assert.ok(Math.abs(geo.embedHeight - geo.fastHeight) <= 4, `Embedding row ${geo.embedHeight}px vs Fast ${geo.fastHeight}px: its switch is inline`);
      assert.ok(geo.tail <= 24, `${geo.tail}px of empty card under the last row`);
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
      root = await open();   // a real reload: a new document that asks the server again
      await root.getByText(/^9 of 9 models/).waitFor({ timeout: 3000 });
      assert.equal(await root.getByRole('article', { name }).count(), 0, 'card back after reload');
      assert.equal(await page.getByText(name, { exact: true }).count(), 0, 'the name is nowhere on the reloaded page');
    });

    await check('#1660/#1637 in-use embedding: switch first (re-index not ready, then finished), then delete (core C1)', async () => {
      const name = 'nomic-embed-text-v1';
      mode.notReadyOnce = true;
      const card = root.getByRole('article', { name });
      await card.getByRole('button', { name: `Delete ${name}`, exact: true }).click();
      const group = card.getByRole('group', { name: `Delete ${name}` });
      const picker = group.getByRole('combobox', { name: 'Switch embedding to' });
      await picker.waitFor({ timeout: 2000 });
      const offered = await picker.locator('option').allTextContents();
      assert.deepEqual(offered.sort(), ['embeddinggemma-2', 'nomic-embed-text-v2'], 'neither the model being deleted nor the active one is offered');
      await picker.selectOption('embeddinggemma-2');
      await page.screenshot({ path: `${shots}/${tag}-2000-confirm-inuse.png`, fullPage: true });
      await group.getByRole('button', { name: 'Switch and delete' }).click();
      await group.getByText(/Re-indexing for embeddinggemma-2 has started/).waitFor({ timeout: 2000 });
      assert.equal(await root.getByRole('article', { name }).count(), 1, 'nothing deleted while re-indexing');
      await group.getByRole('button', { name: 'Keep' }).click();
      // The re-index has finished: the next attempt finishes the switch instead of starting it again.
      await card.getByRole('button', { name: `Delete ${name}`, exact: true }).click();
      await group.getByRole('combobox', { name: 'Switch embedding to' }).selectOption('embeddinggemma-2');
      await group.getByRole('button', { name: 'Switch and delete' }).click();
      await root.getByRole('article', { name }).waitFor({ state: 'detached', timeout: 3000 });
      const seq = calls.filter(([k]) => k.startsWith('embedding-') || k === 'delete').map(([k, v]) => `${k}:${v}`);
      assert.deepEqual(seq.slice(-5), ['embedding-set-next:embeddinggemma-2', 'embedding-switch:', 'embedding-switch:', 'embedding-finish:', `delete:${name}`], seq.join(' '));
      await root.locator('[data-service="embedding"]').getByText('embeddinggemma-2').waitFor({ timeout: 2000 });
    });

    await check('#1660 review: a server that still protects the old model after the switch shows why (never a silent no-op)', async () => {
      const name = 'embeddinggemma-2';
      mode.keepProtected = true;
      const card = root.getByRole('article', { name });
      await card.getByRole('button', { name: `Delete ${name}`, exact: true }).click();
      const group = card.getByRole('group', { name: `Delete ${name}` });
      await group.getByRole('combobox', { name: 'Switch embedding to' }).selectOption('nomic-embed-text-v2');
      await group.getByRole('button', { name: 'Switch and delete' }).click();
      await group.getByRole('alert').getByText('The server still protects this model. Finish the embedding switch, then delete again.').waitFor({ timeout: 2000 });
      assert.equal(await root.getByRole('article', { name }).count(), 1);
      mode.keepProtected = false;
      await group.getByRole('button', { name: 'Keep' }).click();
    });

    await check('#1660 review: while a delete runs, Keep and the card\'s Delete are disabled', async () => {
      const name = 'gemma-4-E4B';
      mode.deleteDelayMs = 900;
      const card = root.getByRole('article', { name });
      await card.getByRole('button', { name: `Delete ${name}`, exact: true }).click();
      await card.getByRole('button', { name: 'Delete files' }).click();
      await card.getByRole('button', { name: 'Deleting…' }).waitFor({ timeout: 1000 });
      assert.equal(await card.getByRole('button', { name: 'Keep' }).isDisabled(), true, 'Keep disabled');
      await card.locator('.model-card-actions .model-card-danger[disabled]').waitFor({ timeout: 500 });   // the card's Delete toggle, while the confirm is busy
      await root.getByRole('article', { name }).waitFor({ state: 'detached', timeout: 3000 });
      mode.deleteDelayMs = 0;
    });

    await check('#1660 deleting Laya says what Auto loses, and Decision then reads missing', async () => {
      const name = 'laya_multilingual_f16';
      const card = root.getByRole('article', { name });
      await card.getByRole('button', { name: `Delete ${name}`, exact: true }).click();
      await card.getByText('Auto routing uses this model to check messages first. Without it, messages that need that check stay on this server. This cannot be undone.').waitFor({ timeout: 1000 });
      assert.equal(await card.getByText(/turns off/i).count(), 0, 'no claim that Decision turns off');
      await card.getByRole('button', { name: 'Delete files' }).click();
      await root.getByRole('article', { name }).waitFor({ state: 'detached', timeout: 2000 });
      const row = root.locator('[data-service="decision"]');
      await row.locator('.mm-state[data-tone="bad"]').waitFor({ timeout: 2000 });
      assert.match(await row.innerText(), /None/);
    });

    await check('#1662 a chat role can be changed in place from the overview', async () => {
      const overview = root.getByRole('region', { name: 'What each service uses' });
      await overview.getByRole('combobox', { name: 'Fast' }).selectOption('gemma-4-12b-it-qat-q4_0');
      await page.waitForTimeout(200);
      assert.equal(roles.fast, 'gemma-4-12b-it-qat-q4_0');
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

    // Dark mode (the owner's appearance): fresh state, each width, initial / details / delete confirm.
    // Every pill, read-only caption, danger button and confirm text must reach 4.5:1 against what is behind it.
    const contrastIssues = () => page.evaluate(() => {
      const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/) || c.match(/color\(srgb ([^)]+)\)/); if (!m) return null;
        const p = m[1].replace('/', ' ').split(/[ ,]+/).filter(Boolean).map(Number); const srgb = c.startsWith('color(');
        return { r: srgb ? p[0] * 255 : p[0], g: srgb ? p[1] * 255 : p[1], b: srgb ? p[2] * 255 : p[2], a: p[3] ?? 1 }; };
      const over = (top, under) => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1 });
      const bgOf = (el) => { const stack = []; for (let n = el; n; n = n.parentElement) { const c = parse(getComputedStyle(n).backgroundColor); if (c && c.a > 0) { stack.push(c); if (c.a >= 1) break; } }
        return stack.reverse().reduce((acc, c) => over(c, acc), { r: 255, g: 255, b: 255, a: 1 }); };
      const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
      const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
      const out = [];
      for (const el of document.querySelectorAll('.mm-state, .mm-assign-fixed, .mm-assign-label, .mm-assign-model, .model-card-danger, .model-card-confirm p, .model-card-name, .model-card-meta > span, .mm-facts dt, .mm-facts dd')) {
        if (!el.getClientRects().length) continue;
        const bg = bgOf(el), fg = over(parse(getComputedStyle(el).color), bg), r = ratio(fg, bg);
        if (r < 4.5) out.push(`${el.className || el.tagName} "${el.textContent.trim().slice(0, 24)}" ${r.toFixed(2)}:1`);
      }
      return [...new Set(out)];
    });
    reset(); mode.member = true;
    root = await open();
    await check('#1660 review: a member sees the page read-only (no Delete, Load, Tune, Switch or role pickers)', async () => {
      await root.getByRole('region', { name: 'What each service uses' }).getByText('Only an administrator can change these.', { exact: false }).waitFor({ timeout: 2000 });
      assert.equal(await root.getByRole('button', { name: /^Delete / }).count(), 0, 'no Delete');
      assert.equal(await root.getByRole('button', { name: /^(Load|Unload|Tune) / }).count(), 0, 'no engine controls');
      assert.equal(await root.getByRole('region', { name: 'What each service uses' }).getByRole('combobox').count(), 0, 'no Switch or role selects');
      assert.deepEqual(errors, []);
    });
    await page.screenshot({ path: `${shots}/${tag}-2000-member.png`, fullPage: true });
    mode.member = false;

    reset();
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 2000, height: 1250 });
    root = await open();
    await check('light 2000: overview, pills and cards are readable (4.5:1)', async () => { const bad = await contrastIssues(); assert.deepEqual(bad, [], bad.join('; ')); });
    for (const width of [2000, 390]) {
      reset();
      await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
      await page.setViewportSize({ width, height: width === 2000 ? 1250 : 844 });
      root = await open();
      await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
      await page.waitForTimeout(250);
      await page.screenshot({ path: `${shots}/${tag}-dark-${width}-initial.png`, fullPage: true });
      await check(`dark ${width}: overview, pills and cards are readable (4.5:1)`, async () => { const bad = await contrastIssues(); assert.deepEqual(bad, [], bad.join('; ')); });
      const nomic = root.getByRole('article', { name: 'nomic-embed-text-v1' });
      await nomic.getByRole('button', { name: 'Details for nomic-embed-text-v1' }).click();
      await nomic.locator('.mm-facts').waitFor({ timeout: 2000 });
      await nomic.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${shots}/${tag}-dark-${width}-details.png`, fullPage: true });
      await check(`dark ${width}: details are readable`, async () => { const bad = await contrastIssues(); assert.deepEqual(bad, [], bad.join('; ')); });
      for (const name of ['gemma-4-E4B', 'nomic-embed-text-v1']) await root.getByRole('article', { name }).getByRole('button', { name: `Delete ${name}`, exact: true }).click();
      await root.getByRole('article', { name: 'nomic-embed-text-v1' }).getByRole('combobox', { name: 'Switch embedding to' }).waitFor({ timeout: 2000 });
      await page.screenshot({ path: `${shots}/${tag}-dark-${width}-confirm.png`, fullPage: true });
      await check(`dark ${width}: delete confirms are readable`, async () => { const bad = await contrastIssues(); assert.deepEqual(bad, [], bad.join('; ')); });
    }
    await check('no page errors', async () => assert.deepEqual(errors, []));
  } finally {
    await browser.close();
    await fixture.close();
  }
  if (failures.length) { console.error(`FAIL models-page-1660: ${failures.length} check(s) failed`); process.exitCode = 1; }
  else console.log('PASS models-page-1660');
})().catch((e) => { console.error(e); process.exitCode = 1; });
