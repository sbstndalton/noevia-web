'use strict';
// noevia#1863: the chat-model idle unload time is an administrator setting on the Models page
// (Performance, beside the inference memory budget). Default 30 minutes; Never warns about memory;
// a save reaches the engine at once when nothing is running; otherwise the card says it is not live
// yet and offers "Apply now", also after the page is reloaded (review of web#87).
//
// Offline: the app is built from this checkout; /api/models/idle-unload and /api/models/presets/reload
// go through noevia-core's REAL route and idle-unload-setting.cjs over a synthetic model manager that
// keeps noevia-rs's GET/PUT /api/v1/idle-unload contract. No engine, no model.
//   PLAYWRIGHT_MODULE=<playwright-core> QA_DIST=<dist dir> [QA_CORE_SERVER=<core server/>] [QA_SHOTS=<dir>] node qa/models-idle-unload-1863.cjs
// Fails on a build (or a core) without the change, passes with it.
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { openModelsPage, openModelsTab } = require('./nav.cjs');
const { openPage, run, VIEWS, SHOTS, TAG, CORE } = require('./models-state-fixture.cjs');

const core = (file) => require(path.join(CORE, file));

/** A model manager with the noevia-rs idle-unload contract, and a router with `running` models. */
function createState({ member = false, running = [] } = {}) {
  const loader = { stored: undefined, ini: 1800, puts: [] };
  const view = () => ({ seconds: loader.stored ?? 1800, source: loader.stored === undefined ? 'default' : 'setting', fallbackSeconds: 1800, fallbackSource: 'default', defaultSeconds: 1800, minSeconds: 300, maxSeconds: 86400 });
  const loaderFetch = async (url, init = {}) => {
    if (!url.endsWith('/api/v1/idle-unload')) return { ok: false, status: 404, body: {} };
    if ((init.method || 'GET') === 'GET') return { ok: true, status: 200, body: view() };
    const { seconds } = JSON.parse(init.body);
    loader.puts.push(seconds);
    loader.stored = seconds === null ? undefined : seconds;
    const before = loader.ini; loader.ini = view().seconds;
    return { ok: true, status: 200, body: { ...view(), preset: before === loader.ini ? 'unchanged' : 'written' } };
  };
  const live = [...running], reloads = [];
  // What the router last read: [*] as the model manager writes it. A plain reload is refused while
  // any model runs (a sleeping one too), so the saved value is not live until "Apply now".
  const ini = (seconds) => (seconds ? `[*]\nsleep-idle-seconds = ${seconds}\n` : '[*]\n');
  const router = { text: ini(1800) };
  const modelManager = {
    enabled: true, kind: 'llamacpp', capabilities: {}, requireEnabled() {},
    listModels: async () => ({ ok: true, status: 200, body: { data: [] } }),
    health: async () => ({ ok: true, body: { all_models_loaded: [] } }),
    presetsInRouter: async () => router.text,
    reloadPresets: async ({ unload = false } = {}) => {
      reloads.push(unload);
      if (live.length && !unload) return { ok: false, status: 409, body: { error: 'A model is loaded. Unload it to apply the new settings.', loaded: [...live] } };
      const unloaded = live.splice(0);
      router.text = ini(loader.ini);
      return { ok: true, status: 200, body: { reloaded: true, unloaded } };
    },
  };
  const env = { MODEL_LOADER_URL: 'http://model-loader.invalid' };
  const audits = [];
  const has = fs.existsSync(path.join(CORE, 'idle-unload-setting.cjs'));
  const idleUnload = has ? core('idle-unload-setting.cjs').createIdleUnloadSetting({ env, fetchJson: loaderFetch, reloadPresets: (o) => modelManager.reloadPresets(o), presetsInRouter: () => modelManager.presetsInRouter(), audit: (...a) => audits.push(a) }) : null;
  const workspace = { userId: 'qa-admin', autoRoles: {}, saveAutoRoles() {} };
  const service = core('models.cjs').createModelService({ fetchJson: loaderFetch, env, modelManager, currentWorkspace: () => workspace, listWorkspaces: () => [] });
  const respond = (out) => (res, status, body) => { out.status = status; out.body = body; };
  const routes = (out) => core('routes/models.cjs').createModelRoutes({
    json: respond(out), readBody: async (req) => (req.body === undefined ? '' : JSON.stringify(req.body)), readJson: async (req) => req.body || {},
    fetchJson: loaderFetch, env, modelManager, getProvider: () => ({}), providerHeaders: () => ({}), DEFAULT_PROVIDER_ID: 'default',
    createVisionProbe: () => async () => ({ supported: true }), reportedTokenRate: () => null, missingRoles: () => [],
    currentWorkspace: () => workspace, service, ...(idleUnload ? { idleUnload } : {}),
  });
  const user = member ? { id: 'qa-member', username: 'qa-member', displayName: 'Synthetic member', role: 'member', diaryEnabled: true, onboarded: true }
    : { id: 'qa-admin', username: 'qa-admin', displayName: 'Synthetic admin', role: 'admin', diaryEnabled: true, onboarded: true };
  async function handle(method, pathname, body) {
    if (pathname === '/api/profile' || pathname === '/api/auth/session') return { status: 200, body: { user, passkeys: [] } };
    if (pathname === '/api/models/capabilities') return { status: 200, body: { kind: 'llamacpp', admin: !member, presets: true, download: true, runtimeOptions: false, modelManagement: !member } };
    if (pathname.startsWith('/api/model-manager/')) return { status: 200, body: { models: [], unregistered: [], sections: [], revision: 'r1' } };
    if (pathname === '/api/models/idle-unload' || pathname === '/api/models/presets/reload') {
      const out = {};
      const req = { method, body, headers: {}, [Symbol.asyncIterator]: async function* () { if (body !== undefined) yield Buffer.from(JSON.stringify(body)); } };
      await routes(out)(req, { setHeader() {} }, { path: pathname, authn: { user }, url: new URL(`http://localhost${pathname}`) });
      return out.status ? out : { status: 404, body: { error: 'Not found' } };
    }
    if (pathname === '/api/models/inference-budget') return { status: 404, body: {} };
    if (pathname.startsWith('/api/models/')) return { status: 200, body: [] };
    return null;
  }
  return { handle, loader, audits, reloads, live, router };
}

async function openPerformance(page, origin, { direct = true } = {}) {
  const root = await openModelsPage(page, origin, { direct });
  await openModelsTab(root, 'Performance');
  return root;
}

run('models-idle-unload-1863', Number(process.env.QA_PORT || 31863), async (check, browser, origin) => {
  for (const [width, height, theme] of VIEWS) {
    const tag = `${width} px ${theme}`;
    const state = createState({ running: ['Qwen3.5-9B'] });
    const { page, errors } = await openPage(browser, state, { width, height, theme });
    // The first view arrives the way an administrator does: Settings → Models → Open model manager.
    const root = await openPerformance(page, origin, { direct: tag !== '2000 px light' });
    const card = root.getByRole('region', { name: 'Unload idle chat models' });
    const select = card.getByRole('combobox', { name: 'Unload after' });

    await check(`${tag}: the card shows the 30 minute default`, async () => {
      await card.waitFor({ timeout: 15000 });
      assert.equal(await select.inputValue(), '1800');
      assert.equal((await select.locator('option:checked').textContent()).trim(), '30 minutes (default)');
      await card.getByText('Using the default.').waitFor({ timeout: 2000 });
      assert.equal(await card.getByRole('button', { name: 'Save' }).isDisabled(), true, 'nothing to save yet');
      const values = await select.locator('option').evaluateAll((o) => o.map((x) => x.value));
      assert.deepEqual(values, ['300', '600', '900', '1800', '3600', '7200', '14400', '28800', '43200', '86400', '0']);
      if (SHOTS) { await card.scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(SHOTS, `1863-default-${TAG}-${width}-${theme}.png`) }); }
    });

    await check(`${tag}: Never warns about memory before it is saved`, async () => {
      await select.selectOption('0');
      await card.getByRole('note').filter({ hasText: 'graphics memory is shared with system memory' }).waitFor({ timeout: 2000 });
      if (SHOTS) { await card.scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(SHOTS, `1863-never-${TAG}-${width}-${theme}.png`) }); }
      await select.selectOption('3600');
      assert.equal(await card.getByRole('note').count(), 0);
    });

    const pendingLine = card.getByTestId('idle-pending');
    await check(`${tag}: saving while a model runs says it is not live yet and offers Apply now`, async () => {
      assert.equal(await pendingLine.count(), 0, 'the default is live before any save');
      await card.getByRole('button', { name: 'Save' }).click();
      await pendingLine.filter({ hasText: 'Saved — applies after the next reload.' }).waitFor({ timeout: 5000 });
      assert.match(await pendingLine.textContent(), /including one asleep after its idle time/);
      await card.getByRole('button', { name: 'Apply now' }).waitFor({ timeout: 2000 });
      assert.deepEqual(state.loader.puts, [3600]);
      assert.equal(state.loader.ini, 3600, 'the model manager rewrote the preset key');
      assert.deepEqual(state.reloads, [false], 'the router was asked to reload without unloading');
      assert.deepEqual(state.live, ['Qwen3.5-9B']);
      assert.equal(state.audits.length, 1);
      await card.getByText('Set by an administrator. The deployment default is 30 minutes.').waitFor({ timeout: 3000 });
      assert.equal(await card.getByText('keeps its current timer').count(), 0, 'the old, wrong copy is gone');
    });

    await check(`${tag}: after a page reload the value is still pending and Apply now is still offered`, async () => {
      await page.reload(); await openModelsTab(root, 'Performance');
      assert.equal(await select.inputValue(), '3600');
      await pendingLine.filter({ hasText: 'Saved — applies after the next reload.' }).waitFor({ timeout: 5000 });
      await card.getByRole('button', { name: 'Apply now' }).waitFor({ timeout: 2000 });
      if (SHOTS) { await card.scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(SHOTS, `1863-pending-${TAG}-${width}-${theme}.png`) }); }
    });

    await check(`${tag}: Apply now reloads with unload and the new time is live`, async () => {
      await card.getByRole('button', { name: 'Apply now' }).click();
      await card.getByRole('status').filter({ hasText: 'Applied. The model loads again with the next message.' }).waitFor({ timeout: 5000 });
      assert.deepEqual(state.reloads, [false, true]);
      assert.deepEqual(state.live, []);
      await card.getByRole('button', { name: 'Apply now' }).waitFor({ state: 'detached', timeout: 3000 });
      assert.equal(await pendingLine.count(), 0);
    });

    await check(`${tag}: with nothing running a change applies at once, and the default comes back`, async () => {
      await page.reload(); await openModelsTab(root, 'Performance');
      assert.equal(await select.inputValue(), '3600', 'the saved value persists across a reload');
      assert.equal(await pendingLine.count(), 0, 'applied stays applied after a reload');
      await card.getByRole('button', { name: 'Use deployment default' }).click();
      await card.getByRole('status').filter({ hasText: 'Saved. The next model load uses it.' }).waitFor({ timeout: 5000 });
      assert.equal(state.loader.ini, 1800);
      assert.equal(await select.inputValue(), '1800');
      await card.getByText('Using the default.').waitFor({ timeout: 3000 });
      assert.equal(await card.getByRole('button', { name: 'Use deployment default' }).count(), 0);
      assert.equal(await pendingLine.count(), 0);
    });
    assert.deepEqual(errors, []);
    await page.close();
  }

  await check('a member never sees the card, and the route refuses them', async () => {
    const state = createState({ member: true });
    const { page } = await openPage(browser, state, { width: 2000, height: 1250, theme: 'light' });
    await page.goto(`${origin}/models`);
    await page.waitForLoadState('networkidle');
    assert.equal(await page.getByRole('region', { name: 'Unload idle chat models' }).count(), 0);
    const r = await state.handle('PUT', '/api/models/idle-unload', { seconds: 600 });
    assert.equal(r.status, 403);
    assert.deepEqual(state.loader.puts, []);
    await page.close();
  });
});
