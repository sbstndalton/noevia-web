// #658: step supervision escalating right after an approved write that succeeded. A real server
// (server/index.cjs) with noevia's own MCP server on (Project documents), step supervision on with
// a synthetic decision service that answers "escalate" once, a synthetic WebDAV server as the
// connected storage and a synthetic model. Synthetic data only.
//
// Turn 1: the model appends to an uploaded file; the person clicks Allow once; the write lands;
// the supervisor escalates. The reply must end with the note that 1 change was saved, and must
// NOT show "Request failed" or a Retry button.
// Turn 2: the model (like the one in the issue) proposes the same append again. The history it
// was sent must say the change is already done, and the card must flag it as a repeat, with all
// three actions. Declining leaves exactly one append in storage.
//
// FAILS on origin/main ("Request failed — Step supervision requested review…" with Retry),
// PASSES with the fix.
// Run: PLAYWRIGHT_MODULE=<playwright-core> [APP_DIR=<web dir of another build>] [QA_SCREENSHOTS=<dir>]
//        node qa/supervision-after-write-658.cjs
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const { spawn } = require('node:child_process'), { once } = require('node:events');
const { withLocale } = require('./qa-locale.cjs');

const PORT = 32658, UPSTREAM_PORT = 32659, INTERNAL_PORT = 32660, DECISION_PORT = 32661, origin = `http://localhost:${PORT}`;
const web = path.resolve(process.env.APP_DIR || path.join(__dirname, '..'));
const shots = process.env.QA_SCREENSHOTS || path.join(os.tmpdir(), 'noevia-qa-658');
const FILE = 'qa-658-notes.md', ORIGINAL = 'Zahl: 1\n', APPEND = 'Zusatz: 2';
const DONE_NOTE = 'Already done earlier in this chat';

/** Minimal WebDAV with ETags and If-Match (412); records every PUT. */
function startDav() {
  const tree = { '': [] }, bodies = {}, puts = [], etags = {};
  let serial = 0;
  const parentOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : ''), nameOf = (p) => p.split('/').pop();
  const link = (p) => { const parent = parentOf(p); if (tree[parent] && !tree[parent].includes(nameOf(p))) tree[parent].push(nameOf(p)); };
  const server = http.createServer((req, res) => {
    const p = decodeURIComponent(req.url.split('?')[0]).replace(/^\/dav\/?/, '').replace(/\/+$/, '');
    if (req.method === 'PROPFIND') {
      if (tree[p] === undefined) {
        if (bodies[p] === undefined) { res.writeHead(404); return res.end(); }
        res.writeHead(207, { 'Content-Type': 'application/xml' });
        return res.end(`<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"><d:response><d:href>/dav/${encodeURI(p)}</d:href><d:propstat><d:prop><d:resourcetype/><d:getcontentlength>${bodies[p].length}</d:getcontentlength><d:getetag>${etags[p].replace(/"/g, '&quot;')}</d:getetag></d:prop></d:propstat></d:response></d:multistatus>`);
      }
      const rows = [`<d:response><d:href>/dav/${encodeURI(p)}/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>`];
      for (const name of tree[p]) {
        const child = p ? `${p}/${name}` : name, dir = tree[child] !== undefined;
        rows.push(`<d:response><d:href>/dav/${encodeURI(child)}${dir ? '/' : ''}</d:href><d:propstat><d:prop><d:resourcetype>${dir ? '<d:collection/>' : ''}</d:resourcetype>${dir ? '' : `<d:getcontentlength>${bodies[child].length}</d:getcontentlength>`}</d:prop></d:propstat></d:response>`);
      }
      res.writeHead(207, { 'Content-Type': 'application/xml' });
      return res.end(`<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">${rows.join('')}</d:multistatus>`);
    }
    if (req.method === 'GET') { if (bodies[p] === undefined) { res.writeHead(404); return res.end(); } res.writeHead(200); return res.end(bodies[p]); }
    if (req.method === 'PUT') {
      const c = []; req.on('data', (d) => c.push(d));
      req.on('end', () => {
        const ifMatch = req.headers['if-match'];
        puts.push({ path: p, ifMatch });
        if (ifMatch && etags[p] !== ifMatch) { res.writeHead(412); return res.end(); }
        bodies[p] = Buffer.concat(c); etags[p] = `"qa658-${++serial}"`; link(p); res.writeHead(201); res.end();
      });
      return;
    }
    if (req.method === 'MKCOL') { if (tree[p] !== undefined) { res.writeHead(405); return res.end(); } tree[p] = []; link(p); res.writeHead(201); return res.end(); }
    res.writeHead(405); res.end();
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, port: server.address().port, bodies, puts, etags })));
}

/** The decision service: "escalate" the first time it is asked, "continue" after that. */
function startDecision() {
  const asked = [];
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const c of req) raw += c;
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/health') return res.end(JSON.stringify({ ready: true }));
    if (req.url !== '/v1/decisions') { res.statusCode = 404; return res.end('{}'); }
    asked.push(JSON.parse(raw || '{}'));
    const selected = asked.length === 1 ? 'escalate' : 'continue';
    const scores = { continue: 0.1, verify: 0.1, escalate: 0.1 }; scores[selected] = 0.8;
    res.end(JSON.stringify({ selected, scores }));
  });
  return new Promise((r) => server.listen(DECISION_PORT, '127.0.0.1', () => r({ server, asked })));
}

/** A model that appends by the bare name whenever the latest user turn has no tool result yet
 *  (so on turn 2 it proposes the same append again, as in the issue), and records whether the
 *  history it was sent says the change is already done. */
function startModel() {
  const seen = [];
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const c of req) raw += c;
    const body = raw ? JSON.parse(raw) : {};
    res.setHeader('Content-Type', 'application/json');
    if (req.url.includes('health')) return res.end(JSON.stringify({ all_models_loaded: [{ loaded: true, model_name: 'synthetic-model', recipe_options: { ctx_size: 32768 } }] }));
    if (req.url.includes('models')) return res.end(JSON.stringify({ data: [{ id: 'synthetic-model' }] }));
    if (req.url.endsWith('/embeddings')) return res.end(JSON.stringify({ data: (Array.isArray(body.input) ? body.input : [body.input]).map((_, index) => ({ index, embedding: [1, 0, 0] })) }));
    if (!req.url.endsWith('/chat/completions')) return res.end('{}');
    if (!body.stream) return res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: 'Synthetic title' } }] }));
    res.setHeader('Content-Type', 'text/event-stream');
    const messages = body.messages || [];
    const lastUser = messages.map((m) => m.role).lastIndexOf('user');
    const toolAfter = messages.slice(lastUser + 1).find((m) => m.role === 'tool');
    seen.push({ sawDoneNote: messages.some((m) => typeof m.content === 'string' && m.content.includes(DONE_NOTE)), toolAfter: !!toolAfter });
    const names = (body.tools || []).map((t) => t.function?.name);
    const delta = !toolAfter && names.includes('project_append_file')
      ? { tool_calls: [{ index: 0, id: `qa658-${seen.length}`, type: 'function', function: { name: 'project_append_file', arguments: JSON.stringify({ name: FILE, text: APPEND }) } }] }
      : { content: 'SYNTHETIC-TURN-OVER' };
    res.end('data: ' + JSON.stringify({ choices: [{ delta, finish_reason: delta.tool_calls ? 'tool_calls' : 'stop' }] }) + '\n\ndata: [DONE]\n\n');
  });
  return new Promise((r) => server.listen(UPSTREAM_PORT, '127.0.0.1', () => r({ server, seen })));
}

async function api(page, url, body, method = body === undefined ? 'GET' : 'POST') {
  return page.evaluate(async ({ url, body, method }) => {
    const csrf = decodeURIComponent(document.cookie.split(';').map((s) => s.trim()).find((s) => s.startsWith('cowork_csrf='))?.slice(12) || '');
    const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: await r.json().catch(() => null) };
  }, { url, body, method });
}

(async () => {
  fs.mkdirSync(shots, { recursive: true });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'noevia-qa-658-'));
  const dav = await startDav(), model = await startModel(), decision = await startDecision();
  const server = spawn(process.execPath, ['server/index.cjs'], { cwd: web, stdio: ['ignore', 'ignore', 'pipe'], env: {
    ...process.env, UI_DATA_DIR: dir, UI_PORT: String(PORT), UI_HOST: '127.0.0.1', PUBLIC_ORIGIN: origin, LEGACY_AUTH_COMPAT: 'false',
    INFERENCE_BASE_URL: `http://127.0.0.1:${UPSTREAM_PORT}`, MODEL_MANAGER_BASE_URL: `http://127.0.0.1:${UPSTREAM_PORT}`, MODEL_MANAGER_KIND: 'lemonade',
    MCP_INTERNAL_PORT: String(INTERNAL_PORT), MCP_SERVERS: `noevia|http://127.0.0.1:${INTERNAL_PORT}/mcp|internal`, MCP_SERVER_URL: '',
    COWORK_DECISION_URL: `http://127.0.0.1:${DECISION_PORT}`, NOEVIA_FEATURE_STEP_SUPERVISION: 'true',
    ENABLED_TOOLBOXES: '', DOCLING_BASE_URL: '', DIARY_BASE_URL: 'http://127.0.0.1:1' } });
  let stderr = ''; server.stderr.on('data', (c) => { stderr += c; });
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  let failed = false;
  try {
    for (let i = 0; i < 200; i++) { try { if ((await fetch(origin + '/api/setup/status')).ok) break; } catch { } await new Promise((r) => setTimeout(r, 50)); }
    const ctx = await browser.newContext(withLocale({ viewport: { width: 1440, height: 950 } }));
    const page = await ctx.newPage();
    await page.goto(origin);
    assert.equal((await api(page, '/api/setup/complete', { setupCode: fs.readFileSync(path.join(dir, 'first-run-setup-code'), 'utf8').trim(), publicOrigin: origin, username: 'qa658', displayName: 'Synthetic 658 QA', password: 'synthetic qa 658 password', diaryEnabled: false })).status, 201);
    await api(page, '/api/profile/onboarding', {});
    let r = await api(page, '/api/integrations/storage', { kind: 'webdav', baseUrl: `http://127.0.0.1:${dav.port}/dav`, username: 'u', secret: 's' }, 'PUT');
    assert.equal(r.status, 200, 'connect synthetic storage: ' + JSON.stringify(r.body));
    r = await api(page, '/api/projects', { name: 'QA 658 Project', model: 'synthetic-model', toolboxes: ['core', 'project-docs'] });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const project = r.body.project || r.body;
    const features = (await api(page, '/api/features')).body;
    assert.equal(JSON.stringify(features).includes('"stepSupervision"'), true, 'the step supervision flag is known');

    await page.reload();
    await page.getByText('QA 658 Project', { exact: true }).first().click();
    await page.getByRole('tab', { name: /Sources/ }).first().click().catch(async () => { await page.getByText('Sources', { exact: true }).first().click(); });
    await page.locator('.project-sources input[type=file]').first().setInputFiles({ name: FILE, mimeType: 'text/markdown', buffer: Buffer.from(ORIGINAL) });
    await page.getByText(/Upload results \(1\)/).waitFor({ timeout: 20000 });
    const saved = (await api(page, '/api/workspace')).body.projects.find((p) => p.id === project.id);
    const storedPath = `${saved.projectFolder}/Text/${FILE}`;
    assert.equal(String(dav.bodies[storedPath]), ORIGINAL);
    console.log(`PASS setup: upload stored as "${storedPath}", step supervision on`);

    await api(page, `/api/projects/${project.id}/chats`, { chats: [{ id: 'qa-658-chat', title: 'QA 658 chat' }] });
    const me = (await api(page, '/api/profile')).body;
    await ctx.addInitScript(([user, projectId]) => {
      localStorage.setItem('noevia:last-view', JSON.stringify({ user, view: { kind: 'chat', chatId: 'qa-658-chat', projectId }, settings: null }));
    }, [me?.user?.id || me?.id || null, project.id]);
    await page.goto(origin);
    const box = page.getByRole('textbox', { name: 'Message', exact: true });
    await box.waitFor({ timeout: 15000 });
    const transcript = () => page.locator('.transcript').innerText();

    // ── Turn 1: approve, the write lands, the supervisor escalates ──
    await box.fill(`Please add the line "${APPEND}" at the end of ${FILE}.`);
    await page.keyboard.press('Enter');
    const card = page.locator('.tool-approval').last();
    await card.waitFor({ timeout: 30000 });
    await card.getByRole('button', { name: 'Allow once', exact: true }).click();
    await page.waitForFunction(() => {
      const text = document.querySelector('.transcript')?.innerText || '';
      return /Request failed|change was saved|changes were saved|paused this reply/.test(text) && !document.querySelector('.tool-approval');
    }, null, { timeout: 30000 });
    await page.waitForFunction(() => !document.querySelector('.msg-meta .typing, .typing'), null, { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(shots, '658-after-escalation.png') });
    assert.equal(String(dav.bodies[storedPath]), `${ORIGINAL}${APPEND}`, 'the approved write landed');
    assert.equal(decision.asked.length >= 1, true, 'the supervisor was asked');
    const afterTurn1 = await transcript();
    assert.doesNotMatch(afterTurn1, /Request failed/, 'no "Request failed" after a write that succeeded: ' + afterTurn1.slice(-400));
    assert.equal(await page.locator('.msg-retry').count(), 0, 'no Retry button that would repeat the write');
    const note = page.locator('[data-testid="reply-paused"]');
    assert.equal(await note.count(), 1, 'the reply carries the paused note');
    assert.equal((await note.innerText()).trim(), '1 change was saved. Step supervision paused this reply before any further steps.');
    console.log('PASS turn 1: the approved write landed; the reply ends with "1 change was saved…", no "Request failed", no Retry');

    // ── Turn 2: the model proposes the same append again ──
    await box.fill(`What does ${FILE} say now?`);
    await page.keyboard.press('Enter');
    const again = page.locator('.tool-approval').last();
    await again.waitFor({ timeout: 30000 });
    await page.screenshot({ path: path.join(shots, '658-repeat-card.png') });
    const turn2 = model.seen.filter((s) => !s.toolAfter).at(-1);
    assert.equal(turn2.sawDoneNote, true, 'the history sent with the next turn says the append is already done');
    const againText = await again.innerText();
    assert.match(againText, /This looks like the change you just approved\./, 'the repeat is flagged on the card: ' + againText);
    assert.ok(againText.includes(storedPath), 'the card still names the file');
    for (const label of ['Allow once', 'Decline', 'Allow for this chat']) assert.ok(await again.getByRole('button', { name: label, exact: true }).count(), `the card keeps "${label}"`);
    await again.getByRole('button', { name: 'Decline', exact: true }).click();
    // #666: a decline ends the reply with a fixed note; the model is not asked for more text.
    await page.waitForFunction(() => /No change was made: you declined project_append_file\./.test(document.querySelector('.transcript')?.innerText || ''), null, { timeout: 30000 });
    assert.equal(String(dav.bodies[storedPath]), `${ORIGINAL}${APPEND}`, 'exactly one append in storage');
    assert.equal(dav.puts.filter((p) => p.path === storedPath).length, 2, 'the upload and the one approved append, nothing else');
    console.log('PASS turn 2: the model was told the change is done; the repeat proposal is flagged on the card with all three actions; declining leaves one append');

    // A reload keeps the note (it is saved with the chat), still not an error.
    await page.reload();
    await page.locator('[data-testid="reply-paused"]').first().waitFor({ timeout: 15000 });
    assert.doesNotMatch(await transcript(), /Request failed/);
    console.log('PASS after a reload the note is still there and nothing reads "Request failed"');
  } catch (e) {
    failed = true;
    console.log('FAIL #658 ' + String(e.message).split('\n').slice(0, 8).join('\n     '));
    if (process.env.QA_DEBUG) console.log(stderr.slice(-4000));
  } finally {
    await browser.close(); server.kill('SIGTERM'); await once(server, 'exit').catch(() => {});
    await new Promise((r) => dav.server.close(r)); await new Promise((r) => model.server.close(r)); await new Promise((r) => decision.server.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
  }
  process.exitCode = failed ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });
