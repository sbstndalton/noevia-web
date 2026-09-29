// #659: a fresh project (default toolboxes) with Google Drive connected. After a file is uploaded
// through Sources, an edit request about it goes to the project's own tool, whose card names the
// stored file, and not to drive_update_file. A real server with noevia's own MCP server on, the
// fake Google server (Drive connected for the account), a synthetic WebDAV server as storage and
// a synthetic model that picks a write tool the way the tool descriptions steer it: a tool whose
// description says it is not for project files is not used for one. Synthetic data only.
//
// Then a Drive write aimed at the project path is refused before any approval card.
//
// FAILS on origin/main (the project has only Core, so the request goes to drive_update_file with a
// raw-JSON card), PASSES with the fix.
// Run: PLAYWRIGHT_MODULE=<playwright-core> [APP_DIR=<web dir of another build>] [QA_SCREENSHOTS=<dir>]
//        node qa/fresh-project-edit-659.cjs
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const { spawn } = require('node:child_process'), { once } = require('node:events');
const { withLocale } = require('./qa-locale.cjs');
const { startFakeGoogle } = require('./fake-google.cjs');

const PORT = 32662, UPSTREAM_PORT = 32663, INTERNAL_PORT = 32664, origin = `http://localhost:${PORT}`;
const web = path.resolve(process.env.APP_DIR || path.join(__dirname, '..'));
const shots = process.env.QA_SCREENSHOTS || path.join(os.tmpdir(), 'noevia-qa-659');
const FILE = 'qa-659-notes.md', ORIGINAL = 'Zahl: 1\n', APPEND = 'Zusatz: 2';

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
        bodies[p] = Buffer.concat(c); etags[p] = `"qa659-${++serial}"`; link(p); res.writeHead(201); res.end();
      });
      return;
    }
    if (req.method === 'MKCOL') { if (tree[p] !== undefined) { res.writeHead(405); return res.end(); } tree[p] = []; link(p); res.writeHead(201); return res.end(); }
    res.writeHead(405); res.end();
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, port: server.address().port, bodies, puts, etags })));
}

/** The synthetic model. For "append … to <file>" it uses the first offered write tool, in the
 *  order a model would weigh them, whose description does not rule out project files: the
 *  project's append tool, else drive_update_file with the listed path as its id and the whole
 *  file rewritten (what the issue saw). For "drive:" it calls drive_update_file on the project
 *  path directly. After a tool result it repeats what the tool said. */
function startModel() {
  const offered = [], calls = [];
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
    const tools = (body.tools || []).map((t) => t.function || {});
    offered.push(tools.map((t) => t.name));
    const projectPath = (String(messages.find((m) => m.role === 'system')?.content || '').match(/noevia projects\/[^\n"]*?qa-659-notes\.md/) || [`noevia projects/QA 659 Project/Text/${FILE}`])[0];
    let delta;
    if (tool) delta = { content: `TOOL-SAID ${String(tool.content).replace(/\s+/g, ' ').slice(0, 400)}` };
    else if (/^drive:/.test(ask)) delta = { tool_calls: [{ index: 0, id: 'qa659-drive', type: 'function', function: { name: 'drive_update_file', arguments: JSON.stringify({ fileId: projectPath, content: `${ORIGINAL}${APPEND}` }) } }] };
    else {
      const usable = tools.filter((t) => ['project_append_file', 'drive_update_file'].includes(t.name) && !/Not for files uploaded to this project/.test(t.description || ''));
      const pick = usable.find((t) => t.name === 'project_append_file') || usable[0];
      const args = !pick ? null : pick.name === 'project_append_file' ? { name: FILE, text: APPEND } : { fileId: projectPath, content: `${ORIGINAL}${APPEND}` };
      delta = pick ? { tool_calls: [{ index: 0, id: 'qa659-edit', type: 'function', function: { name: pick.name, arguments: JSON.stringify(args) } }] } : { content: 'NO-EDIT-TOOL' };
    }
    if (delta.tool_calls) calls.push(delta.tool_calls[0].function.name);
    res.end('data: ' + JSON.stringify({ choices: [{ delta, finish_reason: delta.tool_calls ? 'tool_calls' : 'stop' }] }) + '\n\ndata: [DONE]\n\n');
  });
  return new Promise((r) => server.listen(UPSTREAM_PORT, '127.0.0.1', () => r({ server, offered, calls })));
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'noevia-qa-659-'));
  const dav = await startDav(), model = await startModel(), google = await startFakeGoogle({ autoApprove: true });
  const server = spawn(process.execPath, ['server/index.cjs'], { cwd: web, stdio: ['ignore', 'ignore', 'pipe'], env: {
    ...process.env, ...google.env, UI_DATA_DIR: dir, UI_PORT: String(PORT), UI_HOST: '127.0.0.1', PUBLIC_ORIGIN: origin, LEGACY_AUTH_COMPAT: 'false',
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
    assert.equal((await api(page, '/api/setup/complete', { setupCode: fs.readFileSync(path.join(dir, 'first-run-setup-code'), 'utf8').trim(), publicOrigin: origin, username: 'qa659', displayName: 'Synthetic 659 QA', password: 'synthetic qa 659 password', diaryEnabled: false })).status, 201);
    await api(page, '/api/profile/onboarding', {});
    let r = await api(page, '/api/integrations/storage', { kind: 'webdav', baseUrl: `http://127.0.0.1:${dav.port}/dav`, username: 'u', secret: 's' }, 'PUT');
    assert.equal(r.status, 200, 'connect synthetic storage: ' + JSON.stringify(r.body));
    assert.ok((await api(page, '/api/connectors/gdrive/connect', {})).status < 300, 'start the Drive sign-in');
    for (let i = 0; i < 100; i++) { if ((await api(page, '/api/connectors')).body.connectors[0].state === 'connected') break; await new Promise((res) => setTimeout(res, 100)); }
    assert.equal((await api(page, '/api/connectors')).body.connectors[0].state, 'connected', 'Google Drive is connected for this account');
    // A fresh project with the default toolboxes, as the New project flow makes it.
    r = await api(page, '/api/projects', { name: 'QA 659 Project', model: 'synthetic-model' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const project = r.body.project || r.body;
    assert.deepEqual(project.toolboxes, ['core'], 'a fresh project starts with Core only');

    await page.reload();
    await page.getByText('QA 659 Project', { exact: true }).first().click();
    await page.getByRole('tab', { name: /Sources/ }).first().click().catch(async () => { await page.getByText('Sources', { exact: true }).first().click(); });
    await page.locator('.project-sources input[type=file]').first().setInputFiles({ name: FILE, mimeType: 'text/markdown', buffer: Buffer.from(ORIGINAL) });
    await page.getByText(/Upload results \(1\)/).waitFor({ timeout: 20000 });
    const saved = (await api(page, '/api/workspace')).body.projects.find((p) => p.id === project.id);
    const storedPath = `${saved.projectFolder}/Text/${FILE}`;
    assert.equal(String(dav.bodies[storedPath]), ORIGINAL);
    // Checked after the chat, so a failure here shows what the chat itself did.
    const docsOn = saved.toolboxes.includes('project-docs');
    console.log(`PASS setup: fresh project, Drive connected, upload stored as "${storedPath}"; toolboxes now ${JSON.stringify(saved.toolboxes)}`);

    await api(page, `/api/projects/${project.id}/chats`, { chats: [{ id: 'qa-659-chat', title: 'QA 659 chat' }] });
    const me = (await api(page, '/api/profile')).body;
    await ctx.addInitScript(([user, projectId]) => {
      localStorage.setItem('noevia:last-view', JSON.stringify({ user, view: { kind: 'chat', chatId: 'qa-659-chat', projectId }, settings: null }));
    }, [me?.user?.id || me?.id || null, project.id]);
    await page.goto(origin);
    const box = page.getByRole('textbox', { name: 'Message', exact: true });
    await box.waitFor({ timeout: 15000 });

    // The edit request: the project tool, with the path card.
    await box.fill(`Please append the line "${APPEND}" to the end of ${FILE}.`);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('.tool-approval') || /NO-EDIT-TOOL|TOOL-SAID/.test(document.querySelector('.transcript')?.innerText || ''), null, { timeout: 30000 });
    await page.screenshot({ path: path.join(shots, '659-card.png') });
    assert.ok(model.offered.at(-1).includes('drive_update_file'), 'the connected Drive tools are offered too');
    const card = page.locator('.tool-approval').last();
    const cardText = await card.innerText();
    assert.equal(model.calls[0], 'project_append_file', `the request went to the project tool, not ${model.calls[0]}; the card read: ${cardText.replace(/\s+/g, ' ').slice(0, 300)}`);
    assert.ok(docsOn, 'the upload turned on Project documents: ' + JSON.stringify(saved.toolboxes));
    assert.match(cardText, /project_append_file/);
    assert.match(cardText, /File this changes:/, 'the card has the "File this changes:" line: ' + cardText);
    assert.ok(cardText.includes(storedPath), 'the card names the stored file');
    for (const label of ['Allow once', 'Decline', 'Allow for this chat']) assert.ok(await card.getByRole('button', { name: label, exact: true }).count(), `the card keeps "${label}"`);
    await card.getByRole('button', { name: 'Allow once', exact: true }).click();
    await page.waitForFunction(() => /TOOL-SAID/.test(document.querySelector('.transcript')?.innerText || ''), null, { timeout: 30000 });
    assert.equal(String(dav.bodies[storedPath]), `${ORIGINAL}${APPEND}`, 'the append landed in the stored file');
    assert.equal(google.state.updates || 0, 0, 'nothing was written to Google Drive');
    console.log('PASS the edit request went to project_append_file; its card names the stored file; Allow once appended in place; Drive untouched');

    // A Drive write aimed at the project path is refused before any card.
    await box.fill(`drive: overwrite ${FILE}`);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => (document.querySelector('.transcript')?.innerText.match(/TOOL-SAID/g) || []).length >= 2 || document.querySelector('.tool-approval'), null, { timeout: 30000 });
    await page.screenshot({ path: path.join(shots, '659-drive-refused.png') });
    assert.equal(await page.locator('.tool-approval').count(), 0, 'no approval card for a Drive write to a project path');
    // (The model's copy of a tool result is framed as untrusted data, so the error sits inside the frame.)
    assert.match(await page.locator('.transcript').innerText(), /TOOL-SAID [^\n]*ERROR: [^\n]*is not a Google Drive file id/);
    assert.equal(google.state.updates || 0, 0);
    assert.equal(String(dav.bodies[storedPath]), `${ORIGINAL}${APPEND}`);
    console.log('PASS drive_update_file on the project path is refused before a card, nothing written');
  } catch (e) {
    failed = true;
    console.log('FAIL #659 ' + String(e.message).split('\n').slice(0, 8).join('\n     '));
    if (process.env.QA_DEBUG) console.log(stderr.slice(-4000));
  } finally {
    await browser.close(); server.kill('SIGTERM'); await once(server, 'exit').catch(() => {});
    await new Promise((r) => dav.server.close(r)); await new Promise((r) => model.server.close(r)); await google.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  process.exitCode = failed ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });
