// #442/#443, synthetic model list and mocked APIs only (page.route fetch-mock pattern per
// docs/master-prompt.md); no real Diary prompts/corpus, no live inference or storage.
//
// #442: the Vision routing-role dropdown listed laya_multilingual_f16 (labels: []), the internal
// routing model, because it filtered with matchesModelUse(labels, 'all') — no concept of a
// system/routing model. This asserts the Vision <select> in Settings > Models & routing >
// Routing has no option for it, while a genuinely vision-capable chat model (labels: ['vision'])
// IS offered.
//
// #443: the composer's Manual model picker (InstalledModel.sizeGB, decimal GB) and the "Your
// models" card (previously the external Model Loader's own formatted string, most likely binary
// GiB mislabelled "GB") showed two different sizes for the identical file — reproduced here with
// gemma-4-E2B_q4_0-it: sizeGB: 3.3 (composer's source) vs a model-manager file-scan entry
// reporting "3.1 GB" (the mismatched external string), the exact ~7% gap #443 was filed against.
// This asserts both surfaces show the identical string for that model.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const { createFixture } = require('./diary-fixture.cjs');

const MODELS = [
  { name: 'chat-fast', labels: [], loaded: true, sizeGB: 4.2, maxContext: 32768, source: 'preset', canDelete: true, status: 'loaded' },
  // The exact model and size gap #443 was filed against.
  { name: 'gemma-4-E2B_q4_0-it', labels: [], loaded: false, sizeGB: 3.3, maxContext: 131072, source: 'preset', canDelete: true, status: 'unloaded' },
  { name: 'vision-chat', labels: ['vision'], loaded: false, sizeGB: 5.0, maxContext: 65536, source: 'preset', canDelete: true, status: 'unloaded' },
  // The internal routing model (#442): labels: [], never a chat/vision option anywhere.
  { name: 'laya_multilingual_f16', labels: [], loaded: false, sizeGB: 0.9, maxContext: 8192, source: 'preset', canDelete: false, status: 'unloaded' },
];

(async () => {
  const fixture = createFixture(31900);
  await fixture.listen();
  const browser = await chromium.launch({ headless: true, channel: process.env.QA_CHANNEL || 'chrome' });
  const errors = [];
  try {
    // ── Part A: the composer's Manual model picker ──────────────────────────────────────────
    const composerPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    composerPage.on('pageerror', (e) => errors.push(e.message));
    const project = { id: 'synthetic-442-443', name: 'Synthetic', model: 'chat-fast', routing: 'manual', files: [], assets: [], toolboxes: ['core'] };
    await composerPage.route('**/api/chats/*/context', (r) => r.fulfill({ json: { project } }));
    await composerPage.route('**/api/providers', (r) => r.fulfill({ json: { providers: [{ id: 'default', label: 'Native', baseUrl: 'http://synthetic.invalid/v1', managed: true, isDefault: true }] } }));
    await composerPage.route('**/api/auto-roles', (r) => r.fulfill({ json: { configured: true, roles: { fast: 'chat-fast', smart: 'chat-fast' } } }));
    await composerPage.route('**/api/models/capabilities', (r) => r.fulfill({ json: { kind: 'llamacpp', admin: false, presets: false, runtimeOptions: false, modelManagement: false } }));
    await composerPage.route('**/api/toolboxes', (r) => r.fulfill({ json: { toolboxes: [{ id: 'core', label: 'Core', description: 'Clock and project files.', toolCount: 2, estTokens: 180, source: 'builtin', available: true }], mcp: { configured: false, servers: [] } } }));
    await composerPage.route('**/api/models/installed', (r) => r.fulfill({ json: MODELS }));

    await composerPage.goto('http://localhost:31900');
    await composerPage.getByRole('button', { name: 'Choose model' }).filter({ hasText: 'chat-fast' }).waitFor();
    await composerPage.getByRole('button', { name: 'Choose model' }).click();
    const composerDialog = composerPage.getByRole('dialog', { name: 'Model and tools' });
    await composerDialog.waitFor();
    await composerDialog.getByRole('button', { name: /Manual/ }).click();
    const composerRow = composerDialog.locator('.mp-model-item').filter({ hasText: 'gemma-4-E2B_q4_0-it' });
    await composerRow.waitFor();
    // Laya is never a pickable chat model here either (#409, still true after #442).
    assert.equal(await composerDialog.getByText('laya_multilingual_f16', { exact: true }).count(), 0, 'Laya offered as a Manual chat model');
    const composerSize = (await composerRow.locator('.model-quant').innerText()).trim();
    assert.match(composerSize, /GB$/, `composer size string missing a unit: "${composerSize}"`);
    await composerPage.close();

    // ── Part B: Settings > Models & routing ─────────────────────────────────────────────────
    const settingsPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    settingsPage.on('pageerror', (e) => errors.push(e.message));
    // Orchestrator follow-up (2026-09-26): the saved vision role starts pointed at Laya — an
    // installed model that #442 now excludes from the Vision <select>'s normal option list. The
    // select must still show it (with a "not suitable" label, not silently fall back to
    // "— none —" while still sending "laya_multilingual_f16" on Save), and switching it to none
    // must actually clear the saved value.
    let visionRole = 'laya_multilingual_f16';
    const autoRolesPuts = [];
    await settingsPage.route('**/api/**', (route) => {
      const req = route.request(), url = new URL(req.url()), p = url.pathname, m = req.method();
      const json = (body, status = 200) => route.fulfill({ status, json: body });
      if (p === '/api/profile' || p === '/api/auth/session') return json({ user: { id: 'qa', username: 'admin', displayName: 'Synthetic admin', role: 'admin', diaryEnabled: true, onboarded: true }, passkeys: [] });
      if (p === '/api/models/capabilities') return json({ kind: 'llamacpp', admin: true, presets: false, download: false, runtimeOptions: false, modelManagement: true });
      if (p === '/api/models/installed') return json(MODELS);
      if (p === '/api/auto-roles' && m === 'GET') return json({ configured: true, roles: { fast: 'chat-fast', smart: 'chat-fast', vision: visionRole }, missing: [] });
      if (p === '/api/auto-roles' && m === 'PUT') { const body = req.postDataJSON(); autoRolesPuts.push(body); visionRole = body.vision || ''; return json({ configured: true }); }
      if (p === '/api/stats') return json({ up: true, tokensPerSecond: null, requestCount: 0, cpuPercent: null, gpuPercent: null, vramGb: null });
      if (!p.startsWith('/api/model-manager/')) return p.startsWith('/api/models/') ? json([]) : route.continue();
      const r = p.slice('/api/model-manager/'.length);
      if (r === 'models') return json({
        models: [
          // The mismatch #443 was filed against: the external service's own size string is
          // binary-GiB-based (~3.1 for the same file InstalledModel.sizeGB correctly calls 3.3
          // decimal GB) — the fixed card must ignore this string entirely, not reconcile it.
          { key: 'g/gemma.gguf', name: 'gemma-4-E2B_q4_0-it.gguf', subdir: 'g', bytes: 3100000000, size: '3.1 GB', modified: '2026-09-01', sharded: false, parts: 1, projector: null, sections: ['gemma-4-E2B_q4_0-it'], modelId: 'gemma-4-E2B_q4_0-it', file: 'g/gemma.gguf', shape: null, loadedOn: [], fit: [], badges: [] },
        ], unregistered: [], revision: 'r1',
      });
      if (r === 'overview') return json({ modelsDir: { path: '/models', hostPath: '/mnt/user/ai-models', exists: true, disk: { total: 5e11, free: 1.5e11, usedPct: 70, totalH: '465.7 GB', freeH: '139.7 GB' } }, models: 4, sections: 1, backends: [], activeDownloads: 0, revision: 'r1' });
      if (r === 'models/updates') return json({ status: {} });
      return json({});
    });
    await settingsPage.goto('http://localhost:31900');
    await settingsPage.getByTitle('Settings', { exact: true }).click();
    const settings = settingsPage.getByRole('region', { name: 'Settings' });
    await settings.getByRole('button', { name: 'Models & routing' }).click();
    await settings.getByRole('button', { name: 'Open model manager' }).click();
    await settings.waitFor({ state: 'detached' });
    const manager = settingsPage.locator('.model-manager-page');
    await manager.waitFor();

    // "Your models": read the size the card shows for the same file the composer just showed.
    await manager.getByRole('tab', { name: 'Your models', exact: true }).click();
    const card = manager.getByRole('article', { name: 'gemma-4-E2B_q4_0-it' });
    await card.waitFor();
    const cardSize = (await card.locator('.model-card-meta span').first().innerText()).trim();
    assert.match(cardSize, /GB$/, `Your-models card size string missing a unit: "${cardSize}"`);
    assert.equal(cardSize, composerSize, `composer ("${composerSize}") and Your-models card ("${cardSize}") disagree on gemma-4-E2B_q4_0-it's size`);

    // Routing tab: Vision has no NORMAL Laya option, but does offer the vision-capable chat model.
    await manager.getByRole('tab', { name: 'Routing', exact: true }).click();
    const routingPanel = manager.locator('.route-roles');
    const visionSelect = manager.getByLabel(/^Vision/);
    await visionSelect.waitFor();
    const visionOptions = await visionSelect.locator('option').allTextContents();
    assert.ok(visionOptions.some((t) => t.includes('vision-chat')), `Vision select is missing the vision-capable model: ${JSON.stringify(visionOptions)}`);

    // The saved role (Laya) is still selectable — as the "not suitable" fallback, never as a
    // plain, unlabelled option (which would mean it slipped back into the normal chat/vision
    // list) — and it is genuinely the SELECTED option, not a silent fall-back to "— none —".
    assert.ok(!visionOptions.includes('laya_multilingual_f16'), `Vision select offers Laya as a normal option: ${JSON.stringify(visionOptions)}`);
    assert.ok(visionOptions.some((t) => t === 'laya_multilingual_f16 · not suitable for this role'), `Vision select has no "not suitable" fallback for Laya: ${JSON.stringify(visionOptions)}`);
    assert.equal(await visionSelect.inputValue(), 'laya_multilingual_f16', 'the Vision select silently fell back to none instead of showing the saved (unsuitable) value');
    await routingPanel.getByText('laya_multilingual_f16 is not suitable for this role. Choose another model or set it to none, then save.').waitFor();

    // Switching it to none and saving must actually clear the saved value — not resend Laya.
    await visionSelect.selectOption({ label: '— none —' });
    await manager.getByRole('button', { name: 'Save routing' }).click();
    await manager.getByText('Saved. Models load on demand.').waitFor();
    assert.equal(autoRolesPuts.length, 1, `expected exactly one PUT /api/auto-roles, got ${autoRolesPuts.length}`);
    assert.equal(autoRolesPuts[0].vision, '', `Save sent vision=${JSON.stringify(autoRolesPuts[0].vision)} instead of clearing it`);
    await settingsPage.close();

    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await fixture.close();
  }
  console.log('PASS vision-role-and-model-size: #442 Vision role excludes Laya and offers a vision-capable model; #443 composer and Your-models agree on model size.');
})().catch((e) => { console.error(e); process.exit(1); });
