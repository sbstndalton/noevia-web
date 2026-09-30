// #679: reloading the page while a reply is still generating dropped the whole turn: the history
// came back [] (user message and reply gone), and an approved write that had already landed in
// the file left no record in the chat. A real server (server/index.cjs) with noevia's own MCP
// server on (Project documents), a synthetic WebDAV server as the connected storage and a
// synthetic model that streams slowly. Synthetic data only.
//
// A: reload mid-reply (plain answer). After the reload the user message and the partial reply
//    are there, with Regenerate.
// B: the model appends to a file, the person clicks Allow once, the write lands, and the page is
//    reloaded while the answer after it streams. After the reload the reply shows the applied
//    write and "1 change was saved before this reply ended.", with Regenerate; Regenerate tells
//    the model the change is done and does not write again.
// C: reload while the approval card is open. The write never runs; after the reload no card is
//    left and the call reads "not run".
//
// FAILS on origin/main (the reloaded chat is empty), PASSES with the fix.
// Run: PLAYWRIGHT_MODULE=<playwright-core> [APP_DIR=<web dir of another build>] [QA_SCREENSHOTS=<dir>]
//        node qa/reload-mid-reply-679.cjs
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const { spawn } = require('node:child_process'), { once } = require('node:events');
const { withLocale } = require('./qa-locale.cjs');

const PORT = 32679, UPSTREAM_PORT = 32680, INTERNAL_PORT = 32681, origin = `http://localhost:${PORT}`;
const web = path.resolve(process.env.APP_DIR || path.join(__dirname, '..'));
const shots = process.env.QA_SCREENSHOTS || path.join(os.tmpdir(), 'noevia-qa-679');
const FILE = 'qa-679-notes.md', ORIGINAL = 'Zahl: 1\n', APPEND = 'Zusatz: 3';
const DONE_NOTE = 'Already done earlier in this chat';
const SLOW = ['Steam ', 'rises ', 'from ', 'the ', 'cup, ', 'amber ', 'light ', 'at ', 'dawn, ', 'leaves ', 'unfold ', 'in ', 'quiet ', 'water, ', 'warmth ', 'returns.'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
        bodies[p] = Buffer.concat(c); etags[p] = `"qa679-${++serial}"`; link(p); res.writeHead(201); res.end();
      });
      return;
    }
    if (req.method === 'MKCOL') { if (tree[p] !== undefined) { res.writeHead(405); return res.end(); } tree[p] = []; link(p); res.writeHead(201); return res.end(); }
    res.writeHead(405); res.end();
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, port: server.address().port, bodies, puts })));
}

/** A model that appends when asked to (and no tool ran yet for that turn, and it was not told the
 *  change is done), otherwise streams a poem one word every 400 ms, so a reload lands mid-reply. */
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
    const userText = String(messages[lastUser]?.content || '');
    const toolAfter = messages.slice(lastUser + 1).some((m) => m.role === 'tool');
    const sawDoneNote = messages.some((m) => typeof m.content === 'string' && m.content.includes(DONE_NOTE));
    seen.push({ userText, toolAfter, sawDoneNote });
    const names = (body.tools || []).map((t) => t.function?.name);
    if (/append/i.test(userText) && !toolAfter && !sawDoneNote && names.includes('project_append_file')) {
      return res.end('data: ' + JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: `qa679-${seen.length}`, type: 'function', function: { name: 'project_append_file', arguments: JSON.stringify({ name: FILE, text: APPEND }) } }] }, finish_reason: 'tool_calls' }] }) + '\n\ndata: [DONE]\n\n');
    }
    if (sawDoneNote) return res.end('data: ' + JSON.stringify({ choices: [{ delta: { content: 'SYNTHETIC-ALREADY-DONE' }, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n');
    let closed = false; res.on('close', () => { closed = true; });
    for (const word of SLOW) {
      if (closed) return;
      res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: word } }] }) + '\n\n');
      await sleep(400);
    }
    if (!closed) res.end('data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n');
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'noevia-qa-679-'));
  const dav = await startDav(), model = await startModel();
  const server = spawn(process.execPath, ['server/index.cjs'], { cwd: web, stdio: ['ignore', 'ignore', 'pipe'], env: {
    ...process.env, UI_DATA_DIR: dir, UI_PORT: String(PORT), UI_HOST: '127.0.0.1', PUBLIC_ORIGIN: origin, LEGACY_AUTH_COMPAT: 'false',
    INFERENCE_BASE_URL: `http://127.0.0.1:${UPSTREAM_PORT}`, MODEL_MANAGER_BASE_URL: `http://127.0.0.1:${UPSTREAM_PORT}`, MODEL_MANAGER_KIND: 'lemonade',
    MCP_INTERNAL_PORT: String(INTERNAL_PORT), MCP_SERVERS: `noevia|http://127.0.0.1:${INTERNAL_PORT}/mcp|internal`, MCP_SERVER_URL: '',
    ENABLED_TOOLBOXES: '', DOCLING_BASE_URL: '', DIARY_BASE_URL: 'http://127.0.0.1:1' } });
  let stderr = ''; server.stderr.on('data', (c) => { stderr += c; });
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  let failed = false;
  try {
    for (let i = 0; i < 200; i++) { try { if ((await fetch(origin + '/api/setup/status')).ok) break; } catch { } await sleep(50); }
    const ctx = await browser.newContext(withLocale({ viewport: { width: 1440, height: 950 } }));
    const page = await ctx.newPage();
    await page.goto(origin);
    assert.equal((await api(page, '/api/setup/complete', { setupCode: fs.readFileSync(path.join(dir, 'first-run-setup-code'), 'utf8').trim(), publicOrigin: origin, username: 'qa679', displayName: 'Synthetic 679 QA', password: 'synthetic qa 679 password', diaryEnabled: false })).status, 201);
    await api(page, '/api/profile/onboarding', {});
    let r = await api(page, '/api/integrations/storage', { kind: 'webdav', baseUrl: `http://127.0.0.1:${dav.port}/dav`, username: 'u', secret: 's' }, 'PUT');
    assert.equal(r.status, 200, 'connect synthetic storage: ' + JSON.stringify(r.body));
    r = await api(page, '/api/projects', { name: 'QA 679 Project', model: 'synthetic-model', toolboxes: ['core', 'project-docs'] });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const project = r.body.project || r.body;

    await page.reload();
    await page.getByText('QA 679 Project', { exact: true }).first().click();
    await page.getByRole('tab', { name: /Sources/ }).first().click().catch(async () => { await page.getByText('Sources', { exact: true }).first().click(); });
    await page.locator('.project-sources input[type=file]').first().setInputFiles({ name: FILE, mimeType: 'text/markdown', buffer: Buffer.from(ORIGINAL) });
    await page.getByText(/Upload results \(1\)/).waitFor({ timeout: 20000 });
    const saved = (await api(page, '/api/workspace')).body.projects.find((p) => p.id === project.id);
    const storedPath = `${saved.projectFolder}/Text/${FILE}`;
    assert.equal(String(dav.bodies[storedPath]), ORIGINAL);
    const me = (await api(page, '/api/profile')).body;
    const userId = me?.user?.id || me?.id || null;
    console.log(`PASS setup: upload stored as "${storedPath}"`);

    const box = page.getByRole('textbox', { name: 'Message', exact: true });
    const transcript = () => page.locator('.transcript').innerText();
    /** Open a fresh chat in the project (as the last view, so a reload returns to it). */
    async function openChat(id) {
      await api(page, `/api/projects/${project.id}/chats`, { chats: [...((await api(page, '/api/workspace')).body.projects.find((p) => p.id === project.id).chats || []), { id, title: id }] });
      await page.evaluate(([user, view]) => localStorage.setItem('noevia:last-view', JSON.stringify({ user, view, settings: null })), [userId, { kind: 'chat', chatId: id, projectId: project.id }]);
      await page.goto(origin);
      await box.waitFor({ timeout: 15000 });
    }
    const history = async (id) => (await api(page, `/api/chats/${id}/history`)).body.history;
    /** Reload, then wait for the reloaded chat to show `text`. */
    async function reloadAndWait(text) {
      await page.reload();
      await box.waitFor({ timeout: 15000 });
      await page.waitForFunction((t) => (document.querySelector('.transcript')?.innerText || '').includes(t), text, { timeout: 15000 });
    }
    const regenerate = () => page.locator('.msg[data-role="assistant"]').last().getByRole('button', { name: 'Regenerate', exact: true });

    // ── A: plain reply, reloaded mid-stream ──
    const poem = 'qa-679 reload test: write a four-line poem about tea.';
    await openChat('qa-679-plain');
    await box.fill(poem);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => /Steam rises from/.test(document.querySelector('.transcript')?.innerText || ''), null, { timeout: 30000 });
    assert.doesNotMatch(await transcript(), /warmth returns/, 'still mid-reply when reloading');
    await reloadAndWait(poem);
    await page.waitForFunction(() => /Steam rises from/.test(document.querySelector('.transcript')?.innerText || ''), null, { timeout: 15000 });
    await page.screenshot({ path: path.join(shots, '679-plain-after-reload.png') });
    const plain = await history('qa-679-plain');
    assert.deepEqual(plain.map((e) => e.role), ['user', 'assistant'], 'history after the reload: ' + JSON.stringify(plain));
    assert.equal(plain[0].content, poem);
    assert.match(plain[1].content, /^Steam rises from/);
    assert.doesNotMatch(plain[1].content, /warmth returns/, 'the partial reply, not a finished one');
    assert.equal(await regenerate().count(), 1, 'Regenerate is offered on the kept reply');
    console.log('PASS A: after a mid-reply reload the user message and the partial reply are kept, with Regenerate');

    // ── B: approved write, reloaded while the answer after it streams ──
    const ask = `Please append "${APPEND}" to ${FILE}.`;
    await openChat('qa-679-write');
    await box.fill(ask);
    await page.keyboard.press('Enter');
    const card = page.locator('.tool-approval').last();
    await card.waitFor({ timeout: 30000 });
    for (const label of ['Allow once', 'Decline', 'Allow for this chat']) assert.ok(await card.getByRole('button', { name: label, exact: true }).count(), `the card keeps "${label}"`);
    await card.getByRole('button', { name: 'Allow once', exact: true }).click();
    await page.waitForFunction(() => /Steam rises from/.test(document.querySelector('.transcript')?.innerText || ''), null, { timeout: 30000 });
    assert.equal(String(dav.bodies[storedPath]), `${ORIGINAL}${APPEND}`, 'the approved write landed');
    await reloadAndWait(ask);
    await page.locator('[data-testid="reply-paused"]').first().waitFor({ timeout: 15000 });
    await page.screenshot({ path: path.join(shots, '679-write-after-reload.png') });
    assert.equal((await page.locator('[data-testid="reply-paused"]').last().innerText()).trim(), '1 change was saved before this reply ended.');
    const written = await history('qa-679-write');
    assert.deepEqual(written.map((e) => e.role), ['user', 'assistant'], JSON.stringify(written));
    const call = (written[1].toolCalls || [])[0];
    assert.equal(call?.name, 'project_append_file');
    assert.equal(call?.applied, true, 'the applied-write record is kept');
    assert.equal(await page.locator('.msg-retry').count(), 0, 'no Retry that would repeat the write');
    assert.equal(await regenerate().count(), 1, 'Regenerate is offered');
    const putsBefore = dav.puts.filter((p) => p.path === storedPath).length;
    await regenerate().click();
    await page.waitForFunction(() => /SYNTHETIC-ALREADY-DONE/.test(document.querySelector('.transcript')?.innerText || ''), null, { timeout: 30000 });
    assert.equal(model.seen.at(-1).sawDoneNote, true, 'Regenerate told the model the change is already done');
    assert.equal(await page.locator('.tool-approval').count(), 0, 'no new approval card');
    assert.equal(dav.puts.filter((p) => p.path === storedPath).length, putsBefore, 'Regenerate did not write again');
    assert.equal(String(dav.bodies[storedPath]), `${ORIGINAL}${APPEND}`, 'exactly one append in storage');
    console.log('PASS B: after a reload the approved write is kept with "1 change was saved…"; Regenerate does not replay it');

    // ── C: reload while the approval card is open ──
    const ask2 = `Please append "${APPEND}" to ${FILE} once more.`;
    await openChat('qa-679-pending');
    await box.fill(ask2);
    await page.keyboard.press('Enter');
    await page.locator('.tool-approval').last().waitFor({ timeout: 30000 });
    const putsAtCard = dav.puts.filter((p) => p.path === storedPath).length;
    await reloadAndWait(ask2);
    await page.waitForFunction(() => (document.querySelectorAll('.msg[data-role="assistant"]').length > 0), null, { timeout: 15000 });
    await sleep(1000);
    await page.screenshot({ path: path.join(shots, '679-pending-after-reload.png') });
    assert.equal(await page.locator('.tool-approval').count(), 0, 'no dead approval card after the reload');
    assert.equal(dav.puts.filter((p) => p.path === storedPath).length, putsAtCard, 'the pending write never ran');
    const pending = await history('qa-679-pending');
    assert.deepEqual(pending.map((e) => e.role), ['user', 'assistant'], JSON.stringify(pending));
    assert.equal(pending[1].toolCalls?.[0]?.status, 'stopped', 'the call reads not run, not declined');
    assert.equal(pending[1].toolCalls?.[0]?.applied, undefined);
    assert.equal(await regenerate().count(), 1, 'Regenerate is offered');
    console.log('PASS C: reloading while a card is open leaves the write unrun and the call as "not run"');
  } catch (e) {
    failed = true;
    console.log('FAIL #679 ' + String(e.message).split('\n').slice(0, 8).join('\n     '));
    await (async () => { try { const p = browser.contexts()[0]?.pages()[0]; if (p) await p.screenshot({ path: path.join(shots, '679-failure.png') }); } catch { } })();
    if (process.env.QA_DEBUG) console.log(stderr.slice(-4000));
  } finally {
    await browser.close(); server.kill('SIGTERM'); await once(server, 'exit').catch(() => {});
    await new Promise((r) => dav.server.close(r)); await new Promise((r) => model.server.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
  }
  process.exitCode = failed ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });
