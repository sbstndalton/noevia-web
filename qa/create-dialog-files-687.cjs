// #687: a text file attached in the Create-project dialog can be edited in place. A real server
// with noevia's own MCP server on, a synthetic WebDAV server as storage and a synthetic model that
// asks project_append_file to add a line. Synthetic data only.
//
// 1. A project made in the Create-project dialog (the UI) with one text file: the approval card
//    names the file's storage path, and Allow once appends to it in storage.
// 2. A project left in the pre-fix shape (storage connected, so a folder was reserved, but the
//    file kept in noevia under its plain name and no project folder; made here by refusing MKCOL
//    while it is created): the card names the path the file is moved to, and Allow once stores it
//    there with the line appended, create-only.
//
// FAILS on origin/main (the card shows the bare name and the tool answers "saving now would write
// … instead of editing … in place; nothing was saved"), PASSES with the fix.
// Run: PLAYWRIGHT_MODULE=<playwright-core> [APP_DIR=<web dir of another build>] [QA_SCREENSHOTS=<dir>]
//        node qa/create-dialog-files-687.cjs
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const { spawn } = require('node:child_process'), { once } = require('node:events');
const { withLocale } = require('./qa-locale.cjs');

const PORT = 32687, UPSTREAM_PORT = 32688, INTERNAL_PORT = 32689, origin = `http://localhost:${PORT}`;
const web = path.resolve(process.env.APP_DIR || path.join(__dirname, '..'));
const shots = process.env.QA_SCREENSHOTS || path.join(os.tmpdir(), 'noevia-qa-687');
const ORIGINAL = 'Zeile eins\nZeile zwei\nZeile drei\n';

/** Minimal WebDAV with ETags, If-Match and If-None-Match (412); records every PUT. `refuseMkcol`
 *  makes folder creation fail, as a storage outage would. */
function startDav() {
  const tree = { '': [] }, bodies = {}, puts = [], etags = {}, state = { refuseMkcol: false };
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
        const ifMatch = req.headers['if-match'], ifNoneMatch = req.headers['if-none-match'];
        puts.push({ path: p, ifMatch, ifNoneMatch });
        if (ifMatch && etags[p] !== ifMatch) { res.writeHead(412); return res.end(); }
        if (ifNoneMatch === '*' && bodies[p] !== undefined) { res.writeHead(412); return res.end(); }
        if (tree[parentOf(p)] === undefined) { res.writeHead(409); return res.end(); }
        bodies[p] = Buffer.concat(c); etags[p] = `"qa687-${++serial}"`; link(p); res.writeHead(201); res.end();
      });
      return;
    }
    if (req.method === 'MKCOL') {
      if (state.refuseMkcol) { res.writeHead(503); return res.end(); }
      if (tree[p] !== undefined) { res.writeHead(405); return res.end(); }
      tree[p] = []; link(p); res.writeHead(201); return res.end();
    }
    res.writeHead(405); res.end();
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, port: server.address().port, bodies, puts, etags, state })));
}

/** The synthetic model: "append <line> to <file>" calls project_append_file; after a tool result
 *  it repeats what the tool said. */
function startModel() {
  const calls = [];
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
    const ask = String(messages[lastUser]?.content || '');
    const tool = messages.slice(lastUser + 1).find((m) => m.role === 'tool');
    const offered = (body.tools || []).map((t) => (t.function || {}).name);
    const m = ask.match(/append the line "([^"]+)" to (\S+?\.md)/);
    let delta;
    if (tool) delta = { content: `TOOL-SAID ${String(tool.content).replace(/\s+/g, ' ').slice(0, 400)}` };
    else if (m && offered.includes('project_append_file')) delta = { tool_calls: [{ index: 0, id: `qa687-${calls.length}`, type: 'function', function: { name: 'project_append_file', arguments: JSON.stringify({ name: m[2], text: m[1] }) } }] };
    else delta = { content: 'NO-EDIT-TOOL' };
    if (delta.tool_calls) calls.push(delta.tool_calls[0].function.arguments);
    res.end('data: ' + JSON.stringify({ choices: [{ delta, finish_reason: delta.tool_calls ? 'tool_calls' : 'stop' }] }) + '\n\ndata: [DONE]\n\n');
  });
  return new Promise((r) => server.listen(UPSTREAM_PORT, '127.0.0.1', () => r({ server, calls })));
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'noevia-qa-687-'));
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
    for (let i = 0; i < 200; i++) { try { if ((await fetch(origin + '/api/setup/status')).ok) break; } catch { } await new Promise((r) => setTimeout(r, 50)); }
    const ctx = await browser.newContext(withLocale({ viewport: { width: 1440, height: 950 } }));
    const page = await ctx.newPage();
    await page.goto(origin);
    assert.equal((await api(page, '/api/setup/complete', { setupCode: fs.readFileSync(path.join(dir, 'first-run-setup-code'), 'utf8').trim(), publicOrigin: origin, username: 'qa687', displayName: 'Synthetic 687 QA', password: 'synthetic qa 687 password', diaryEnabled: false })).status, 201);
    await api(page, '/api/profile/onboarding', {});
    let r = await api(page, '/api/integrations/storage', { kind: 'webdav', baseUrl: `http://127.0.0.1:${dav.port}/dav`, username: 'u', secret: 's' }, 'PUT');
    assert.equal(r.status, 200, 'connect synthetic storage: ' + JSON.stringify(r.body));
    // A project already exists, so the Projects page shows its "New project" button.
    await api(page, '/api/projects', { name: 'QA 687 Placeholder' });
    const me = (await api(page, '/api/profile')).body;
    const userId = me?.user?.id || me?.id || null;
    const openView = async (view) => {
      await page.evaluate(([user, v]) => localStorage.setItem('noevia:last-view', JSON.stringify({ user, view: v, settings: null })), [userId, view]);
      await page.goto(origin);
    };
    const workspaceProject = async (id) => (await api(page, '/api/workspace')).body.projects.find((p) => p.id === id);

    // An edit through the chat: returns the card text and what the tool said after Allow once.
    const editInChat = async (projectId, chatId, file, line, tag) => {
      await api(page, `/api/projects/${projectId}/chats`, { chats: [{ id: chatId, title: `QA 687 ${tag}` }] });
      await openView({ kind: 'chat', chatId, projectId });
      const box = page.getByRole('textbox', { name: 'Message', exact: true });
      await box.waitFor({ timeout: 15000 });
      await box.fill(`Please append the line "${line}" to ${file} using the project_append_file tool`);
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.querySelector('.tool-approval') || /NO-EDIT-TOOL|TOOL-SAID/.test(document.querySelector('.transcript')?.innerText || ''), null, { timeout: 30000 });
      await page.screenshot({ path: path.join(shots, `687-${tag}-card.png`) });
      const card = page.locator('.tool-approval').last();
      assert.ok(await card.count(), 'an approval card appears: ' + (await page.locator('.transcript').innerText()).slice(-400));
      const cardText = await card.innerText();
      for (const label of ['Allow once', 'Decline', 'Allow for this chat']) assert.ok(await card.getByRole('button', { name: label, exact: true }).count(), `the card keeps "${label}"`);
      await card.getByRole('button', { name: 'Allow once', exact: true }).click();
      await page.waitForFunction(() => /TOOL-SAID/.test(document.querySelector('.transcript')?.innerText || ''), null, { timeout: 30000 });
      await page.screenshot({ path: path.join(shots, `687-${tag}-result.png`) });
      const said = (await page.locator('.transcript').innerText()).match(/TOOL-SAID[^\n]*/)?.[0] || '';
      return { cardText, said };
    };

    // ── 1. Create project through the dialog, with a Knowledge file ──
    const FILE1 = 'qa-687-notes.md', LINE1 = 'Zusatz: 687';
    await openView({ kind: 'projects' });
    await page.getByRole('button', { name: 'New project' }).first().click();
    const dialog = page.getByRole('dialog', { name: /Create a project|New project/ });
    await dialog.locator('#proj-name').fill('QA 687 Project');
    await dialog.locator('input[type=file]').setInputFiles({ name: FILE1, mimeType: 'text/markdown', buffer: Buffer.from(ORIGINAL) });
    await dialog.getByText(FILE1).waitFor({ timeout: 10000 });
    await page.screenshot({ path: path.join(shots, '687-dialog.png') });
    await dialog.getByRole('button', { name: 'Create project', exact: true }).click();
    await dialog.waitFor({ state: 'hidden', timeout: 15000 });
    const created = (await api(page, '/api/workspace')).body.projects.find((p) => p.name === 'QA 687 Project');
    assert.ok(created, 'the project was created');
    const stored1 = `noevia projects/QA 687 Project/Text/${FILE1}`;
    const one = await editInChat(created.id, 'qa-687-chat-1', FILE1, LINE1, 'dialog');
    assert.match(one.cardText, /File this changes:/, 'the card has the "File this changes:" line: ' + one.cardText);
    assert.ok(one.cardText.includes(stored1), `the card names the storage path "${stored1}": ${one.cardText.replace(/\s+/g, ' ').slice(0, 300)}`);
    assert.doesNotMatch(one.said, /ERROR/, 'the tool did not refuse: ' + one.said);
    assert.equal(String(dav.bodies[stored1]), `${ORIGINAL}${LINE1}`, 'the line was appended to the stored file');
    const after1 = await workspaceProject(created.id);
    assert.deepEqual(after1.files.map((f) => f.name), [stored1], 'one file, at its storage path');
    console.log(`PASS dialog project: card names "${stored1}", Allow once appended in place`);

    // ── 2. A project in the pre-fix shape: reserved folder, plain-named file, no project folder ──
    const FILE2 = 'qa-687-legacy.md', LINE2 = 'Zusatz: legacy';
    dav.state.refuseMkcol = true;
    r = await api(page, '/api/projects', { name: 'QA 687 Legacy', files: [{ name: FILE2, content: ORIGINAL }] });
    dav.state.refuseMkcol = false;
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const legacy = await workspaceProject((r.body.project || r.body).id);
    assert.deepEqual(legacy.files.map((f) => f.name), [FILE2], 'the file is kept in noevia under its plain name');
    assert.equal(legacy.projectFolder, undefined, 'no project folder yet');
    const stored2 = `noevia projects/QA 687 Legacy/Text/${FILE2}`;
    const putsBefore = dav.puts.length;
    const two = await editInChat(legacy.id, 'qa-687-chat-2', FILE2, LINE2, 'legacy');
    assert.ok(two.cardText.includes(stored2), `the card names where the file will be stored, "${stored2}": ${two.cardText.replace(/\s+/g, ' ').slice(0, 300)}`);
    assert.doesNotMatch(two.said, /ERROR/, 'the tool did not refuse: ' + two.said);
    assert.equal(String(dav.bodies[stored2]), `${ORIGINAL}${LINE2}`, 'stored with the line appended');
    assert.deepEqual(dav.puts.slice(putsBefore).map((p) => [p.path, p.ifNoneMatch]), [[stored2, '*']], 'one create-only PUT, nowhere else');
    const after2 = await workspaceProject(legacy.id);
    assert.deepEqual(after2.files.map((f) => f.name), [stored2], 'the plain-named copy was replaced by the stored file');
    assert.equal(after2.projectFolder, 'noevia projects/QA 687 Legacy');
    console.log(`PASS pre-fix project: card names "${stored2}", Allow once stored it there with the line appended (If-None-Match: *)`);
  } catch (e) {
    failed = true;
    console.log('FAIL #687 ' + String(e.message).split('\n').slice(0, 8).join('\n     '));
    if (process.env.QA_DEBUG) console.log(stderr.slice(-4000));
  } finally {
    await browser.close(); server.kill('SIGTERM'); await once(server, 'exit').catch(() => {});
    await new Promise((r) => dav.server.close(r)); await new Promise((r) => model.server.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
  }
  process.exitCode = failed ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });
