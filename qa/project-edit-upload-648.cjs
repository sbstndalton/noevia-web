// #648: in a project chat the model appends to an uploaded file by its bare name, and the edit lands
// in place. A real application server (server/index.cjs) with noevia's own MCP server switched on
// (the Project documents box), a real browser, a synthetic WebDAV server standing in for connected
// storage (so the upload is stored under `noevia projects/<project>/Text/<name>`), and a synthetic
// OpenAI-compatible model that calls project_append_file with the BARE name and then answers with
// exactly what the tool returned. The approval card must show the resolved full path; after
// "Allow once" the storage object holds the appended text and no second copy exists anywhere.
// Synthetic data only.
//
// FAILS on origin/main (the card shows only the bare name and the tool refuses to edit uploads),
// PASSES with the fix.
// Run: PLAYWRIGHT_MODULE=<playwright-core> [APP_DIR=<web dir of another build>] [QA_SCREENSHOTS=<dir>]
//        node qa/project-edit-upload-648.cjs
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const { spawn } = require('node:child_process'), { once } = require('node:events');
const { withLocale } = require('./qa-locale.cjs');

const PORT = 32648, UPSTREAM_PORT = 32649, INTERNAL_PORT = 32650, origin = `http://localhost:${PORT}`;
const web = path.resolve(process.env.APP_DIR || path.join(__dirname, '..'));
const shots = process.env.QA_SCREENSHOTS || path.join(os.tmpdir(), 'noevia-qa-648');
const FILE = 'qa-648-notes.md', ORIGINAL = '# Synthetic notes\n\nQA648 day one: arrive.\n', APPEND = 'QA648-APPENDED: day two, museum.';

/** Minimal WebDAV: PROPFIND/GET/PUT/MKCOL over an in-memory tree, with ETags and If-Match (412).
 *  Records every PUT with the If-Match it carried. */
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
        bodies[p] = Buffer.concat(c); etags[p] = `"qa648-${++serial}"`; link(p); res.writeHead(201); res.end();
      });
      return;
    }
    if (req.method === 'MKCOL') { if (tree[p] !== undefined) { res.writeHead(405); return res.end(); } tree[p] = []; link(p); res.writeHead(201); return res.end(); }
    res.writeHead(405); res.end();
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, port: server.address().port, bodies, puts, etags })));
}

/** A model that appends to the file by its bare name, then reports what the tool returned. */
function startModel() {
  const toolResults = [], offeredTools = [];
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
    const tool = (body.messages || []).find((m) => m.role === 'tool');
    const names = (body.tools || []).map((t) => t.function?.name);
    offeredTools.push(names);
    let delta;
    if (!tool && names.includes('project_append_file')) delta = { tool_calls: [{ index: 0, id: 'qa648-append', type: 'function', function: { name: 'project_append_file', arguments: JSON.stringify({ name: FILE, text: APPEND }) } }] };
    else {
      const text = String(tool?.content || '(project_append_file not offered)');
      toolResults.push(text);
      delta = { content: /Appended \d+ chars/.test(text) ? 'EDIT-DONE' : `EDIT-FAILED ${text.replace(/\s+/g, ' ').slice(0, 300)}` };
    }
    res.end('data: ' + JSON.stringify({ choices: [{ delta, finish_reason: delta.tool_calls ? 'tool_calls' : 'stop' }] }) + '\n\ndata: [DONE]\n\n');
  });
  return new Promise((r) => server.listen(UPSTREAM_PORT, '127.0.0.1', () => r({ server, toolResults, offeredTools })));
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'noevia-qa-648-'));
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
    assert.equal((await api(page, '/api/setup/complete', { setupCode: fs.readFileSync(path.join(dir, 'first-run-setup-code'), 'utf8').trim(), publicOrigin: origin, username: 'qa648', displayName: 'Synthetic 648 QA', password: 'synthetic qa 648 password', diaryEnabled: false })).status, 201);
    await api(page, '/api/profile/onboarding', {});
    let r = await api(page, '/api/integrations/storage', { kind: 'webdav', baseUrl: `http://127.0.0.1:${dav.port}/dav`, username: 'u', secret: 's' }, 'PUT');
    assert.equal(r.status, 200, 'connect synthetic storage: ' + JSON.stringify(r.body));
    r = await api(page, '/api/projects', { name: 'QA 648 Project', model: 'synthetic-model', toolboxes: ['core', 'project-docs'] });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const project = r.body.project || r.body;

    // Upload through the Sources page, the way the user does.
    await page.reload();
    await page.getByText('QA 648 Project', { exact: true }).first().click();
    await page.getByRole('tab', { name: /Sources/ }).first().click().catch(async () => { await page.getByText('Sources', { exact: true }).first().click(); });
    await page.locator('.project-sources input[type=file]').first().setInputFiles({ name: FILE, mimeType: 'text/markdown', buffer: Buffer.from(ORIGINAL) });
    await page.getByText(/Upload results \(1\)/).waitFor({ timeout: 20000 });
    let saved = (await api(page, '/api/workspace')).body.projects.find((p) => p.id === project.id);
    const storedPath = `${saved.projectFolder}/Text/${FILE}`;
    assert.match(String(saved.projectFolder), /^noevia projects\/QA 648 Project/, 'the project got its own storage folder');
    assert.deepEqual(saved.files.map((f) => f.name), [storedPath], 'the upload is stored under its folder path');
    assert.equal(String(dav.bodies[storedPath]), ORIGINAL);
    const putsBefore = dav.puts.length, etagBefore = dav.etags[storedPath];
    console.log(`PASS setup: upload stored as "${storedPath}"`);

    // A project chat: the model calls project_append_file with the bare name.
    await api(page, `/api/projects/${project.id}/chats`, { chats: [{ id: 'qa-648-chat', title: 'QA 648 chat' }] });
    const me = (await api(page, '/api/profile')).body;
    await ctx.addInitScript(([user, projectId]) => {
      localStorage.setItem('noevia:last-view', JSON.stringify({ user, view: { kind: 'chat', chatId: 'qa-648-chat', projectId }, settings: null }));
    }, [me?.user?.id || me?.id || null, project.id]);
    await page.goto(origin);
    const box = page.getByRole('textbox', { name: 'Message', exact: true });
    await box.waitFor({ timeout: 15000 });
    await box.fill(`Add day two to ${FILE}.`);
    await page.keyboard.press('Enter');

    // Either the approval card appears, or the reply ends without one (a refusal before the card).
    await page.waitForFunction(() => document.querySelector('.tool-approval') || /EDIT-(DONE|FAILED)/.test(document.querySelector('.transcript')?.innerText || ''), null, { timeout: 30000 });
    assert.ok(model.offeredTools.some((names) => names.includes('project_append_file')), 'the Project documents box was offered: ' + JSON.stringify(model.offeredTools));
    const card = page.locator('.tool-approval').last();
    assert.ok(await card.count(), 'an approval card was shown; the reply instead said: ' + (await page.locator('.transcript').innerText()).slice(-300));
    const cardText = await card.innerText();
    await page.screenshot({ path: path.join(shots, '648-approval.png') });
    assert.ok(cardText.includes(`"name": "${FILE}"`), 'the model\'s own argument is shown in full: ' + cardText);
    assert.ok(cardText.includes(storedPath), `the card shows the resolved full path "${storedPath}": ${cardText.replace(/\s+/g, ' ').slice(0, 400)}`);
    for (const label of ['Allow once', 'Decline', 'Allow for this chat']) assert.ok(await card.getByRole('button', { name: label, exact: true }).count(), `the card keeps "${label}"`);
    console.log('PASS the approval card shows the resolved path beside the raw argument, with all three actions');

    await card.getByRole('button', { name: 'Allow once', exact: true }).click();
    await page.waitForFunction(() => /EDIT-(DONE|FAILED)/.test(document.querySelector('.transcript')?.innerText || ''), null, { timeout: 30000 });
    await page.screenshot({ path: path.join(shots, '648-done.png') });
    assert.equal(model.toolResults.length, 1, 'the model got exactly one tool result');
    assert.match(model.toolResults[0], new RegExp(`Appended ${APPEND.length} chars to "${storedPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`), 'the tool edited the stored file: ' + model.toolResults[0].slice(0, 300));
    assert.equal(String(dav.bodies[storedPath]), `${ORIGINAL}${APPEND}`, 'the storage object holds the appended text');
    assert.deepEqual(dav.puts.slice(putsBefore), [{ path: storedPath, ifMatch: etagBefore }], 'exactly one write, to the same storage object, conditional on the ETag it had');
    assert.deepEqual(Object.keys(dav.bodies).filter((k) => k.endsWith(FILE)), [storedPath], 'no duplicate file in storage');
    saved = (await api(page, '/api/workspace')).body.projects.find((p) => p.id === project.id);
    assert.deepEqual(saved.files.map((f) => f.name), [storedPath], 'no duplicate in the source list');
    assert.equal(saved.files[0].content, `${ORIGINAL}${APPEND}`, 'the source list carries the new text');
    console.log('PASS Allow once: the storage object has the appended text, with no duplicate file in storage or the source list');
  } catch (e) {
    failed = true;
    console.log('FAIL #648 ' + String(e.message).split('\n').slice(0, 8).join('\n     '));
    if (process.env.QA_DEBUG) console.log(stderr.slice(-4000));
  } finally {
    await browser.close(); server.kill('SIGTERM'); await once(server, 'exit').catch(() => {});
    await new Promise((r) => dav.server.close(r)); await new Promise((r) => model.server.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
  }
  process.exitCode = failed ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });
