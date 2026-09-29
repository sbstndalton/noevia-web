// Shared setup for the #586 / #588 Sources-panel browser checks: the real application server
// (server/index.cjs) with a synthetic OpenAI-compatible upstream, one signed-in browser context and
// one project. Synthetic data only; nothing here touches Diary or real storage.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const { spawn } = require('node:child_process'), { once } = require('node:events');
const { withLocale } = require('./qa-locale.cjs');

async function start({ port, name, env: extraEnv = {} }) {
  const origin = `http://localhost:${port}`;
  const web = path.resolve(process.env.APP_DIR || path.join(__dirname, '..'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `noevia-${name}-`));
  const requests = [];
  const upstream = http.createServer(async (req, res) => {
    let raw = ''; for await (const c of req) raw += c;
    const body = raw ? JSON.parse(raw) : {};
    if (req.url.endsWith('/models')) { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ data: [{ id: 'synthetic' }] })); }
    if (req.url.endsWith('/embeddings')) { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ data: (Array.isArray(body.input) ? body.input : [body.input]).map((_, index) => ({ index, embedding: [1, 0, 0] })) })); }
    if (req.url.endsWith('/chat/completions')) {
      requests.push(body); res.setHeader('Content-Type', 'text/event-stream');
      return res.end('data: ' + JSON.stringify({ choices: [{ delta: { content: 'Synthetic answer.' }, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n');
    }
    res.setHeader('Content-Type', 'application/json'); res.end('{}');
  });
  await new Promise(r => upstream.listen(port + 100, '127.0.0.1', r));
  const server = spawn(process.execPath, ['server/index.cjs'], { cwd: web, stdio: 'ignore', env: {
    ...process.env, UI_DATA_DIR: dir, UI_PORT: String(port), UI_HOST: '127.0.0.1', PUBLIC_ORIGIN: origin, LEGACY_AUTH_COMPAT: 'false',
    INFERENCE_BASE_URL: `http://127.0.0.1:${port + 100}`, MODEL_MANAGER_KIND: 'none', MCP_SERVERS: '', MCP_SERVER_URL: '', ...extraEnv } });
  for (let i = 0; i < 100; i++) { try { if ((await fetch(origin + '/api/setup/status')).ok) break; } catch { } await new Promise(r => setTimeout(r, 50)); }
  return { origin, dir, requests, async stop() { server.kill('SIGTERM'); await once(server, 'exit'); await new Promise(r => upstream.close(r)); fs.rmSync(dir, { recursive: true, force: true }); } };
}

// A browser context signed in as a fresh synthetic user, with `projectName` created.
async function signedIn(browser, env, { width, height = 950, theme = 'light', projectName }) {
  const ctx = await browser.newContext(withLocale({ viewport: { width, height }, isMobile: width < 768, hasTouch: width < 768 }));
  await ctx.addInitScript(t => localStorage.setItem('cowork-theme', t), theme);
  const page = await ctx.newPage();
  const api = (url, body, method = body === undefined ? 'GET' : 'POST') => page.evaluate(async ({ url, body, method }) => {
    const csrf = decodeURIComponent(document.cookie.split(';').map(s => s.trim()).find(s => s.startsWith('cowork_csrf='))?.slice(12) || '');
    const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, text: await r.text() };
  }, { url, body, method });
  await page.goto(env.origin);
  const codeFile = path.join(env.dir, 'first-run-setup-code');
  for (let i = 0; i < 100 && !fs.existsSync(codeFile); i++) await new Promise(r => setTimeout(r, 50));
  const code = fs.readFileSync(codeFile, 'utf8').trim();
  const done = await api('/api/setup/complete', { setupCode: code, publicOrigin: env.origin, username: 'sourcesqa', displayName: 'Synthetic Sources QA', password: 'synthetic sources qa password', diaryEnabled: false });
  if (done.status !== 201) throw new Error('setup failed: ' + done.text);
  await api('/api/profile/onboarding', {});
  const project = JSON.parse((await api('/api/projects', { name: projectName, model: 'synthetic', toolboxes: ['core'] })).text);
  await page.goto(`${env.origin}/p/${project.id}`);
  await page.getByRole('tab', { name: /Sources/ }).first().click().catch(async () => { await page.getByText('Sources', { exact: true }).first().click(); });
  await page.locator('.project-sources').waitFor();
  return { ctx, page, api, project };
}

async function upload(page, files, expectRows) {
  await page.locator('.project-sources input[type=file]').first().setInputFiles(files);
  await page.waitForFunction(n => (document.querySelector('.upload-progress')?.children.length || 0) >= n && !/Uploading files/.test(document.body.textContent), expectRows, { timeout: 20000 });
}

module.exports = { start, signedIn, upload };
