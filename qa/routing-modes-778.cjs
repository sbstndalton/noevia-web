// #778 routing modes, in a real browser against the built client. The routing paths run on the
// REAL server modules: the chat loop (server/chat.cjs createChatHandler, flag on), the routing
// question and its owner check (approvals.cjs + routes/approvals.cjs), the account setting
// (routes/routing-mode.cjs) and the chat lists and transcripts (routes/chat-lists.cjs with the real
// merge). The local engine and the "cloud" provider are stub functions that record every request.
// Everything else the shell needs comes from the synthetic diary-fixture. No decision service is
// configured; the flagged turn below trips the deterministic pre-rule (a synthetic IBAN).
// (The full server/index.cjs needs the native better-sqlite3 module, which this harness avoids.)
//
//   Settings → Models & routing → Routing: choose Hybrid, the cloud provider and a model, save.
//   A free chat (Auto) with a sensitive-looking message → the "This looks sensitive" card before
//   anything is sent anywhere → Keep local → the reply comes from the local engine, the badge reads
//   Local (reason on hover), and the cloud provider received nothing.
//   The chat's Force local toggle → on; a second flagged message gets no card and stays local;
//   reload → the toggle is still on and both badges are still there.
//
// FAILS on origin/main (no routing section in Settings, no card), PASSES with #778.
// Run: npm run build, then
//   PLAYWRIGHT_MODULE=<npx cache>/node_modules/playwright-core QA_CHROME_PATH=<Brave or Chrome binary>
//   [QA_DIST=<build dir>] [QA_SCREENSHOTS=<dir>] node qa/routing-modes-778.cjs
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http'), crypto = require('node:crypto');
const { withLocale } = require('./qa-locale.cjs');
const { createFixture } = require('./diary-fixture.cjs');

const server = (m) => require(path.join(__dirname, '../server', m));
const shots = process.env.QA_SCREENSHOTS || path.join(os.tmpdir(), 'noevia-qa-778');
const USER = 'synthetic-diary-only'; // the fixture's signed-in user
const LOCAL = 'http://local.invalid', CLOUD = 'http://cloud.invalid';
// A checksum-valid synthetic IBAN (the standard example BBAN, check digits computed).
const IBAN = (() => {
  const bban = '370400440532013000';
  for (let c = 2; c < 99; c++) { const v = `DE${String(c).padStart(2, '0')}${bban}`; if (server('routing-modes.cjs').ibanValid(v)) return v; }
  throw Error('no IBAN');
})();

function createApp(fixturePort) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'noevia-qa-778-'));
  const FREE_CHATS = [], histories = new Map(), engine = { local: [], cloud: [] };
  const kv = new Map(), store = { get: (k) => kv.get(k), set: (k, v) => kv.set(k, v) };
  const rm = server('routing-modes.cjs');
  const workspace = { userId: USER, dir, assetDir: () => dir };
  const providers = { default: { id: 'default', label: 'Local engine', baseUrl: LOCAL, isDefault: true }, 'cloud-qa': { id: 'cloud-qa', label: 'Synthetic cloud', baseUrl: CLOUD, shared: true } };
  const approvals = server('approvals.cjs').createApprovals();
  const scope = { getStore: () => ({ authn: { user: { id: USER, role: 'member' } }, workspace }) };
  const json = (res, status, body) => { if (!res.headersSent) res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); return true; };
  const readBody = async (req) => { let raw = ''; for await (const c of req) raw += c; return raw; };
  const sse = (text) => ({ ok: true, status: 200, body: (async function* () { yield Buffer.from(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`); })() });
  const fetchStub = async (url, init) => {
    const u = String(url);
    if (!u.endsWith('/chat/completions')) return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
    const body = JSON.parse(init.body);
    if (u.startsWith(CLOUD)) { engine.cloud.push(body); return sse('SYNTHETIC-CLOUD-REPLY'); }
    engine.local.push(body); return sse('SYNTHETIC-LOCAL-REPLY');
  };
  const { handleChat } = server('chat.cjs').createChatHandler({
    modelManager: { enabled: true, health: async () => ({ ok: true, body: { all_models_loaded: [{ model_name: 'synthetic-local', loaded: true, recipe_options: { ctx_size: 32768 } }] } }) },
    reasoningEffort: server('reasoning-effort.cjs'), authService: { audit() {}, diaryEnabled: () => false },
    crypto, path, fs, fetch: fetchStub, HISTORY_CAP: 20, DEFAULT_PROVIDER_ID: 'default', createToolExchange: server('tool-exchange.cjs').createToolExchange,
    currentWorkspace: () => workspace, getProject: () => null,
    skillsIndexFor: () => [], getProvider: (id) => providers[id] || providers.default, providerHeaders: () => ({}), autoRoles: () => ({ fast: 'synthetic-local', smart: 'synthetic-local' }),
    visionDescriptions: new Map(), visionProbe: async () => ({ supported: false, reason: 'synthetic' }),
    chatSkillRouter: { select: async () => ({ loaded: [] }) }, oauthServerIds: () => new Set(), accountReady: () => false,
    chatToolRouter: { select: async (ids) => ({ ids, routed: false }) }, DEFAULT_TOOLBOXES: [], CONNECTOR_BOXES: new Set(), connectedBoxes: () => [],
    toolPolicy: { mode: () => 'allow' }, requestScope: scope,
    resolveTools: () => ({ tools: [], dropped: [] }), isWriteTool: () => false,
    rag: { filesContext: async () => null }, prefill: { recordSample() {} }, reduceToolResult: (r) => ({ text: String(r) }), diaryExtras: server('diary-extras.cjs'),
    DIARY_BASE: 'http://diary.invalid', TOOL_RESULT_CAP: 8000, json, saveChats() {}, endpointApproved: () => true, diaryHeaders: () => ({}),
    lastLoadedModel: () => null, classifyFastOrSmart: async () => 'smart', servedCatalogue: async () => [], modelsInstalled: async () => [], missingRoles: () => [], staleRolesError: () => null,
    allToolboxes: () => [], chatWideApproved: approvals.chatWideApproved, awaitApproval: approvals.awaitApproval, recordUsage() {}, recordToolUse() {},
    executeToolCall: async () => 'SYNTHETIC', freeChats: () => Array.from(FREE_CHATS),
    routingModes: {
      enabled: () => true,
      settings: () => { const s = rm.read(dir); return { ...s, mode: rm.effectiveMode(s, rm.allowedModes(store)) }; },
      sensitivity: rm.createSensitivity({ decide: () => { throw Error('Decision service unavailable'); } }),
      awaitChoice: approvals.awaitRouteChoice,
      log: () => {},
      setChatFlags: (projectId, chatId, patch) => { const meta = FREE_CHATS.find((c) => c.id === chatId); if (!meta) return false; Object.assign(meta, patch); return true; },
    },
  });
  const approvalRoutes = server('routes/approvals.cjs').createApprovalRoutes({ json, readBody, pendingApprovals: approvals.pendingApprovals, requestScope: scope });
  const routingRoutes = server('routes/routing-mode.cjs').createRoutingModeRoutes({ json, readBody, enabled: () => true, currentWorkspace: () => workspace, store });
  const listRoutes = server('routes/chat-lists.cjs').createChatListRoutes({ json, readBody, currentWorkspace: () => workspace, PROJECTS: [], FREE_CHATS,
    diaryExtras: server('diary-extras.cjs'), crypto, STORED_HISTORY_BYTES: 4 * 1024 * 1024, STORED_HISTORY_CAP: 5000, chatLists: () => ({ freeChats: [], projects: [] }), removeChat: () => false,
    store: { sanitizeChats: (c) => c || [], saveFreeChats() {}, deleteFreeChat: () => false, readHistory: (id) => histories.get(id) || [], writeHistory: (id, h) => histories.set(id, h), moveChat: null } });

  const app = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost'), p = url.pathname;
    const ctx = { path: p, authn: { user: { id: USER, role: 'member' } }, url };
    if (p === '/api/features') return json(res, 200, { flags: { previews: false, routingModes: true } });
    if (p === '/api/providers' && req.method === 'GET') return json(res, 200, { providers: Object.values(providers) });
    if (p === '/api/auto-roles') return json(res, 200, { configured: true, roles: { fast: 'synthetic-local', smart: 'synthetic-local' }, missing: [] });
    if (p === '/api/workspace') return json(res, 200, { projects: [], freeChats: FREE_CHATS });
    if (p === '/api/chat' && req.method === 'POST') { const body = JSON.parse(await readBody(req)); return handleChat(req, res, body, ctx.authn); }
    if (await approvalRoutes(req, res, ctx)) return;
    if (await routingRoutes(req, res, ctx)) return;
    if (await listRoutes(req, res, ctx)) return;
    // Everything else: the synthetic fixture.
    const upstream = http.request({ host: '127.0.0.1', port: fixturePort, path: req.url, method: req.method, headers: req.headers }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    req.pipe(upstream);
  });
  return { app, engine, FREE_CHATS, dir };
}

(async () => {
  fs.mkdirSync(shots, { recursive: true });
  const fixture = createFixture(0); await fixture.listen();
  const { app, engine, FREE_CHATS, dir } = createApp(fixture.server.address().port);
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${app.address().port}`;
  const browser = await chromium.launch(process.env.QA_CHROME_PATH ? { headless: true, executablePath: process.env.QA_CHROME_PATH } : { headless: true, channel: 'chrome' });
  let failed = false;
  const errors = [];
  try {
    const page = await (await browser.newContext(withLocale({ viewport: { width: 1440, height: 950 } }))).newPage();
    page.on('pageerror', (e) => errors.push(e.message));

    // ── Settings → Models & routing → Routing: Hybrid, the cloud provider and a model ──
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await page.getByRole('textbox', { name: 'Message', exact: true }).waitFor({ timeout: 15000 });
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('noevia:open-model-settings', { detail: {} })));
    await page.getByRole('tab', { name: 'Routing', exact: true }).first().click({ timeout: 15000 });
    const section = page.locator('[data-testid="routing-mode-section"]');
    await section.waitFor({ timeout: 15000 });
    await section.getByLabel('Hybrid', { exact: true }).check();
    assert.equal(await section.getByLabel('Ask me', { exact: true }).isChecked(), true, '"Ask me" is the default when sensitive');
    await section.getByLabel('Cloud provider').selectOption({ label: 'Synthetic cloud' });
    await section.getByLabel('Cloud model for Smart').fill('synthetic-cloud');
    await section.getByRole('button', { name: 'Save routing mode' }).click();
    await section.getByText('Routing mode saved.').waitFor({ timeout: 10000 });
    await page.screenshot({ path: path.join(shots, '778-settings.png') });
    const saved = server('routing-modes.cjs').read(dir);
    assert.equal(saved.mode, 'hybrid'); assert.equal(saved.whenSensitive, 'ask'); assert.equal(saved.cloud.providerId, 'cloud-qa');
    console.log('PASS settings: Hybrid saved with "Ask me", a cloud provider and a model');

    // ── A flagged turn: the card, before anything is sent ──
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    const box = page.getByRole('textbox', { name: 'Message', exact: true });
    await box.waitFor({ timeout: 15000 });
    await box.fill(`Please check my synthetic transfer to ${IBAN} for typos.`);
    await page.keyboard.press('Enter');
    const card = page.locator('[data-testid="route-pending"]');
    await card.waitFor({ timeout: 20000 });
    assert.match(await card.innerText(), /This looks sensitive \(a bank account number\)\./);
    for (const label of ['Send to cloud', 'Keep local']) assert.equal(await card.getByRole('button', { name: label, exact: true }).count(), 1, `the card offers "${label}"`);
    assert.equal(await card.getByLabel('Remember for this chat').count(), 1, 'the card offers "Remember for this chat"');
    assert.equal(engine.local.length + engine.cloud.length, 0, 'nothing was sent anywhere while the card waits');
    await page.screenshot({ path: path.join(shots, '778-card.png') });
    await card.getByRole('button', { name: 'Keep local', exact: true }).click();
    await page.getByText('SYNTHETIC-LOCAL-REPLY').first().waitFor({ timeout: 20000 });
    assert.equal(await card.count(), 0, 'the card is gone once answered');
    const badge = page.locator('[data-testid="route-badge"]').last();
    assert.equal((await badge.innerText()).trim(), 'Local');
    assert.equal(await badge.getAttribute('title'), 'Sent to Local: your choice for this message');
    assert.equal(engine.cloud.length, 0, 'the cloud provider received nothing');
    assert.equal(engine.local.length, 1);
    await page.screenshot({ path: path.join(shots, '778-kept-local.png') });
    console.log('PASS card: "This looks sensitive (a bank account number)" before any request; Keep local → local reply, badge "Local", cloud untouched');

    // ── Force local: on, persisted, no question ──
    const toggle = page.locator('[data-testid="force-local"]');
    await toggle.waitFor({ timeout: 10000 });
    assert.equal(await toggle.isChecked(), false);
    const listSave = page.waitForResponse((r) => r.url().endsWith('/api/freechats') && r.request().method() === 'POST', { timeout: 10000 }).catch(() => null);
    await toggle.check();
    assert.ok(await listSave, 'the toggle saved the chat list');
    assert.equal(FREE_CHATS[0]?.forceLocal, true, 'stored on the chat meta through the list merge');
    await box.fill(`And my second synthetic account ${IBAN}?`);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="route-badge"]').length >= 2, null, { timeout: 20000 });
    assert.equal(await page.locator('[data-testid="route-pending"]').count(), 0, 'force local asks nothing');
    assert.equal(await page.locator('[data-testid="route-badge"]').last().getAttribute('title'), 'Sent to Local: Force local is on for this chat');
    assert.equal(engine.cloud.length, 0); assert.equal(engine.local.length, 2);
    console.log('PASS force local: a second flagged message gets no card and stays local');

    await page.waitForTimeout(800); // the transcript save after the reply
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('[data-testid="force-local"]').waitFor({ timeout: 15000 });
    assert.equal(await page.locator('[data-testid="force-local"]').isChecked(), true, 'Force local survives a reload');
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="route-badge"]').length >= 2, null, { timeout: 15000 });
    assert.deepEqual(await page.locator('[data-testid="route-badge"]').allInnerTexts(), ['Local', 'Local']);
    await page.screenshot({ path: path.join(shots, '778-after-reload.png') });
    assert.deepEqual(errors, []);
    console.log('PASS reload: Force local still on; both badges still read Local');
  } catch (e) {
    failed = true;
    console.log('FAIL #778 ' + String(e.message).split('\n').slice(0, 8).join('\n     '));
  } finally {
    await browser.close(); await new Promise((r) => app.close(r)); await fixture.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  process.exitCode = failed ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });
