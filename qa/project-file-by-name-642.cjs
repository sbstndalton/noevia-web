// #642: in a project chat the model opens an uploaded file by its bare name. A real application
// server (server/index.cjs), a real browser, a synthetic WebDAV server standing in for connected
// storage (so the upload is stored under `noevia projects/<project>/Text/<name>`, the shape that
// broke), and a synthetic OpenAI-compatible model that calls read_project_file with the BARE name
// and then answers with exactly what the tool returned. The file text also reaches the prompt as a
// retrieval excerpt, so the model's answer is built from the tool result only, never the prompt.
// Synthetic data only.
//
// FAILS on origin/main (the tool answers "no project file named ..."), PASSES with the fix.
// Run: PLAYWRIGHT_MODULE=<playwright-core> [APP_DIR=<web dir of another build>] [QA_SCREENSHOTS=<dir>]
//        node qa/project-file-by-name-642.cjs
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const { spawn } = require('node:child_process'), { once } = require('node:events');
const { withLocale } = require('./qa-locale.cjs');

const PORT = 31642, UPSTREAM_PORT = 31643, origin = `http://localhost:${PORT}`;
const web = path.resolve(process.env.APP_DIR || path.join(__dirname, '..'));
const shots = process.env.QA_SCREENSHOTS || path.join(os.tmpdir(), 'noevia-qa-642');
const FILE = 'qa-642-notes.md', CANARY = 'QA642-CANARY: the synthetic launch moved to Thursday';

/** Minimal WebDAV: PROPFIND/GET/PUT/MKCOL over an in-memory tree. */
function startDav() {
  const tree = { '': [] }, bodies = {};
  const parentOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : ''), nameOf = (p) => p.split('/').pop();
  const link = (p) => { const parent = parentOf(p); if (tree[parent] && !tree[parent].includes(nameOf(p))) tree[parent].push(nameOf(p)); };
  const server = http.createServer((req, res) => {
    const p = decodeURIComponent(req.url.split('?')[0]).replace(/^\/dav\/?/, '').replace(/\/+$/, '');
    if (req.method === 'PROPFIND') {
      if (tree[p] === undefined) {
        if (bodies[p] === undefined) { res.writeHead(404); return res.end(); }
        res.writeHead(207, { 'Content-Type': 'application/xml' });
        return res.end(`<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"><d:response><d:href>/dav/${encodeURI(p)}</d:href><d:propstat><d:prop><d:resourcetype/><d:getcontentlength>${bodies[p].length}</d:getcontentlength></d:prop></d:propstat></d:response></d:multistatus>`);
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
    if (req.method === 'PUT') { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => { bodies[p] = Buffer.concat(c); link(p); res.writeHead(201); res.end(); }); return; }
    if (req.method === 'MKCOL') { if (tree[p] !== undefined) { res.writeHead(405); return res.end(); } tree[p] = []; link(p); res.writeHead(201); return res.end(); }
    res.writeHead(405); res.end();
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, port: server.address().port, bodies })));
}

/** A model that reads the file by its bare name, then reports what the tool returned. */
function startModel() {
  const toolResults = [];
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
    const offered = (body.tools || []).some((t) => t.function?.name === 'read_project_file');
    let delta;
    if (!tool && offered) delta = { tool_calls: [{ index: 0, id: 'qa642-read', type: 'function', function: { name: 'read_project_file', arguments: JSON.stringify({ name: FILE }) } }] };
    else {
      const text = String(tool?.content || '');
      toolResults.push(text);
      const hit = text.match(/QA642-CANARY:[^\n<]*/);
      delta = { content: hit ? `TOOL-READ-OK ${hit[0]}` : `TOOL-READ-FAILED ${text.replace(/\s+/g, ' ').slice(0, 300) || '(read_project_file not offered)'}` };
    }
    res.end('data: ' + JSON.stringify({ choices: [{ delta, finish_reason: delta.tool_calls ? 'tool_calls' : 'stop' }] }) + '\n\ndata: [DONE]\n\n');
  });
  return new Promise((r) => server.listen(UPSTREAM_PORT, '127.0.0.1', () => r({ server, toolResults })));
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'noevia-qa-642-'));
  const dav = await startDav(), model = await startModel();
  const server = spawn(process.execPath, ['server/index.cjs'], { cwd: web, stdio: ['ignore', 'ignore', 'pipe'], env: {
    ...process.env, UI_DATA_DIR: dir, UI_PORT: String(PORT), UI_HOST: '127.0.0.1', PUBLIC_ORIGIN: origin, LEGACY_AUTH_COMPAT: 'false',
    INFERENCE_BASE_URL: `http://127.0.0.1:${UPSTREAM_PORT}`, MODEL_MANAGER_BASE_URL: `http://127.0.0.1:${UPSTREAM_PORT}`, MODEL_MANAGER_KIND: 'lemonade',
    MCP_SERVERS: '', MCP_SERVER_URL: '', DOCLING_BASE_URL: '', DIARY_BASE_URL: 'http://127.0.0.1:1' } });
  let stderr = ''; server.stderr.on('data', (c) => { stderr += c; });
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  let failed = false;
  try {
    for (let i = 0; i < 200; i++) { try { if ((await fetch(origin + '/api/setup/status')).ok) break; } catch { } await new Promise((r) => setTimeout(r, 50)); }
    const ctx = await browser.newContext(withLocale({ viewport: { width: 1440, height: 950 } }));
    const page = await ctx.newPage();
    await page.goto(origin);
    assert.equal((await api(page, '/api/setup/complete', { setupCode: fs.readFileSync(path.join(dir, 'first-run-setup-code'), 'utf8').trim(), publicOrigin: origin, username: 'qa642', displayName: 'Synthetic 642 QA', password: 'synthetic qa 642 password', diaryEnabled: false })).status, 201);
    await api(page, '/api/profile/onboarding', {});
    let r = await api(page, '/api/integrations/storage', { kind: 'webdav', baseUrl: `http://127.0.0.1:${dav.port}/dav`, username: 'u', secret: 's' }, 'PUT');
    assert.equal(r.status, 200, 'connect synthetic storage: ' + JSON.stringify(r.body));
    r = await api(page, '/api/projects', { name: 'QA 642 Project', model: 'synthetic-model', toolboxes: ['core'] });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const project = r.body.project || r.body;

    // Upload through the Sources page, the way the user did.
    await page.reload();
    await page.getByText('QA 642 Project', { exact: true }).first().click();
    await page.getByRole('tab', { name: /Sources/ }).first().click().catch(async () => { await page.getByText('Sources', { exact: true }).first().click(); });
    await page.locator('.project-sources input[type=file]').first().setInputFiles({ name: FILE, mimeType: 'text/markdown', buffer: Buffer.from(`# Synthetic notes\n\n${CANARY}.\n`) });
    await page.getByText(/Upload results \(1\)/).waitFor({ timeout: 20000 });
    const saved = (await api(page, '/api/workspace')).body.projects.find((p) => p.id === project.id);
    const stored = saved.files.find((f) => f.name.endsWith('/' + FILE));
    assert.ok(stored, 'the upload is stored under its folder path: ' + JSON.stringify(saved.files.map((f) => f.name)));
    // The project folder is created on first upload (#589).
    assert.match(String(saved.projectFolder), /^noevia projects\/QA 642 Project/, 'the project got its own storage folder');
    assert.equal(stored.name, `${saved.projectFolder}/Text/${FILE}`);
    await page.screenshot({ path: path.join(shots, '642-sources.png') });
    console.log(`PASS setup: upload stored as "${stored.name}"`);

    // Ask in a project chat. The model calls read_project_file with the bare name.
    await api(page, `/api/projects/${project.id}/chats`, { chats: [{ id: 'qa-642-chat', title: 'QA 642 chat' }] });
    const me = (await api(page, '/api/profile')).body;
    await ctx.addInitScript(([user, projectId]) => {
      localStorage.setItem('noevia:last-view', JSON.stringify({ user, view: { kind: 'chat', chatId: 'qa-642-chat', projectId }, settings: null }));
    }, [me?.user?.id || me?.id || null, project.id]);
    await page.goto(origin);
    const box = page.getByRole('textbox', { name: 'Message', exact: true });
    await box.waitFor({ timeout: 15000 });
    await box.fill(`What does ${FILE} say about the launch?`);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => /TOOL-READ-(OK|FAILED)/.test(document.querySelector('.transcript')?.innerText || ''), null, { timeout: 30000 });
    const transcript = await page.locator('.transcript').innerText();
    await page.screenshot({ path: path.join(shots, '642-chat.png') });
    assert.equal(model.toolResults.length, 1, 'the model got exactly one tool result');
    assert.doesNotMatch(model.toolResults[0], /no project file named/, 'read_project_file by bare name must not fail: ' + model.toolResults[0].slice(0, 300));
    assert.match(model.toolResults[0], /QA642-CANARY/, 'the tool result carries the file contents');
    assert.match(transcript, /TOOL-READ-OK QA642-CANARY: the synthetic launch moved to Thursday/, 'the reply shows the content the tool returned');
    console.log('PASS read_project_file with the bare name returned the uploaded file, and the answer shows its contents');
  } catch (e) {
    failed = true;
    console.log('FAIL #642 ' + String(e.message).split('\n').slice(0, 8).join('\n     '));
    if (process.env.QA_DEBUG) console.log(stderr.slice(-4000));
  } finally {
    await browser.close(); server.kill('SIGTERM'); await once(server, 'exit').catch(() => {});
    await new Promise((r) => dav.server.close(r)); await new Promise((r) => model.server.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
  }
  process.exitCode = failed ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });
