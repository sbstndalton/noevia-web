'use strict';
// sbstndalton/noevia#2115, #2117: while another chat's model is in use, a turn waits in the local model's queue (the
// inference gate) instead of unloading that model mid-answer. Browser proof of what the person sees:
//  - the reply's status line says it is waiting, for which model and role, its place in the queue and the wait so far;
//  - a turn the queue refused (timed out) reads as a plain sentence that says to try again;
//  - Models page: unloading a model that is answering a request says so, and an admin can unload it anyway.
// Offline: synthetic stubs only (diary-fixture.cjs behind a small front that streams /api/chat slowly), synthetic
// model names. Fails on a build of main (the line shows the server's English, the refusal the server's text, and the
// in-use unload is a bare error), passes with the change.
//   npm run build -- --outDir ../dist-after
//   PLAYWRIGHT_MODULE=<playwright-core> QA_CHROME_PATH=<Chrome> QA_DIST=<dist dir> [QA_CORE_SERVER=<core server/>] node qa/waiting-for-model-2115.cjs
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { createFixture } = require('./diary-fixture.cjs');
const { withLocale } = require('./qa-locale.cjs');
const { openModelsPage, openModelsTab } = require('./nav.cjs');

const PORT = Number(process.env.QA_PORT || 32115), INNER = PORT + 1;
const MODEL = 'Synthetic-Route-Smart-Q4', BUSY_MODEL = 'Synthetic-Route-Code-Q4';
const freeChats = [{ id: 'fc2115', title: 'Waiting for the local model', updatedAt: 5000, archived: false, pinned: false }];
let chatMode = 'wait';

// The built app, from QA_DIST (any platform's paths); a client route gets the shell.
function serveApp(req, res) {
  const dist = path.resolve(process.env.QA_DIST || path.join(__dirname, '../dist'));
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  let file = path.resolve(dist, '.' + (pathname === '/' ? '/index.html' : pathname));
  const inside = path.relative(dist, file);
  if (inside.startsWith('..') || path.isAbsolute(inside)) { res.writeHead(404); return res.end(); }
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) file = path.join(dist, 'index.html');
  const type = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.svg') ? 'image/svg+xml' : file.endsWith('.json') || file.endsWith('.webmanifest') ? 'application/json' : file.endsWith('.png') ? 'image/png' : 'text/html';
  res.writeHead(200, { 'Content-Type': type });
  fs.createReadStream(file).pipe(res);
}

// /api/chat streams from here (a status, a pause, then the answer); other API calls go to the fixture.
function front() {
  return http.createServer((req, res) => {
    if (!req.url.startsWith('/api/')) return serveApp(req, res);
    if (req.url === '/api/chat' && req.method === 'POST') {
      req.resume();
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      const ev = (d) => res.write(`data: ${JSON.stringify(d)}\n\n`);
      ev({ type: 'meta', model: MODEL });
      if (chatMode === 'refused') {
        ev({ type: 'error', text: 'Server English: the queue timed out.', code: 'inference_queue_timeout', retryable: true });
        return res.end();
      }
      ev({ type: 'status', id: 'waitingForModel', text: 'Server English: waiting.', detail: { model: MODEL, role: 'smart', position: 1, waitedSeconds: 4 } });
      const timer = setTimeout(() => { ev({ type: 'delta', text: 'Synthetic answer after the wait.' }); ev({ type: 'done', model: MODEL }); res.end(); }, 4000);
      res.on('close', () => clearTimeout(timer));
      return;
    }
    const up = http.request({ host: '127.0.0.1', port: INNER, path: req.url, method: req.method, headers: req.headers }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    up.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    req.pipe(up);
  });
}

async function chatPage(browser) {
  const page = await browser.newPage(withLocale({ viewport: { width: 1280, height: 860 } }));
  await page.route('**/api/workspace', (r) => r.fulfill({ json: { projects: [], freeChats } }));
  await page.route('**/api/chats/*/history', (r) => r.fulfill({ json: r.request().method() === 'POST' ? { ok: true, revision: `r${Date.now()}` } : { history: [], revision: 'r1' } }));
  await page.goto(`http://localhost:${PORT}/c/fc2115`);
  const box = page.getByRole('textbox', { name: 'Message', exact: true });
  await box.waitFor({ timeout: 20000 });
  return { page, box };
}

(async () => {
  const fixture = createFixture(INNER);
  await fixture.listen();
  const server = front();
  await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, ...(process.env.QA_CHROME_PATH ? { executablePath: process.env.QA_CHROME_PATH } : { channel: 'chrome' }) });
  let failed = 0;
  const check = async (name, fn) => {
    try { await fn(); console.log(`PASS waiting-for-model-2115: ${name}`); }
    catch (e) { failed++; console.log(`FAIL waiting-for-model-2115: ${name}\n  ${String(e.message).split('\n').slice(0, 6).join('\n  ')}`); }
  };
  try {
    await check('a turn waiting for the local model says so, with the model, its role, its place and the wait so far', async () => {
      chatMode = 'wait';
      const { page, box } = await chatPage(browser);
      try {
        await box.fill('QA-2115 a question while another chat answers');
        await box.press('Enter');
        await page.getByText(`Waiting for another chat to finish before ${MODEL} (Smart) can answer (place 1 in the queue)… Waited 4 s so far.`).waitFor({ timeout: 3500 });
        assert.equal(await page.getByText('Server English: waiting.').count(), 0, 'not the server\'s English');
        await page.locator('.msg[data-role=assistant] .bubble').filter({ hasText: 'Synthetic answer after the wait.' }).waitFor({ timeout: 10000 });
        assert.equal(await page.getByText(/Waiting for another chat/).count(), 0, 'the waiting line goes once the answer arrives');
      } finally { await page.close(); }
    });
    await check('a turn the queue refused reads as a plain sentence that says to try again', async () => {
      chatMode = 'refused';
      const { page, box } = await chatPage(browser);
      try {
        await box.fill('QA-2115 a question the queue refuses');
        await box.press('Enter');
        await page.getByText('Another chat was still using the local model, so this reply did not start. Try again when it has finished.').first().waitFor({ timeout: 10000 });
        assert.equal(await page.getByText('Server English: the queue timed out.').count(), 0, 'not the server\'s text');
      } finally { await page.close(); }
    });
    await check('Models page: a model answering a request is not unloaded; the admin may unload it anyway', async () => {
      const page = await browser.newPage(withLocale({ viewport: { width: 1440, height: 950 } }));
      const errors = [], unloads = [];
      page.on('pageerror', (e) => errors.push(e.message));
      let loaded = true;
      try {
        await page.route('**/api/**', (route) => {
          const req = route.request(), p = new URL(req.url()).pathname;
          const json = (b, status = 200) => route.fulfill({ status, json: b });
          if (p === '/api/profile' || p === '/api/auth/session') return json({ user: { id: 'qa', username: 'admin', displayName: 'Synthetic admin', role: 'admin', diaryEnabled: false, onboarded: true }, passkeys: [] });
          if (p === '/api/models/capabilities') return json({ kind: 'llamacpp', admin: true, autotune: true, presets: true, download: true, runtimeOptions: false, modelManagement: true });
          if (p === '/api/models/installed') return json([{ name: BUSY_MODEL, labels: [], loaded, sizeGB: 4, source: 'preset', canDelete: true, status: loaded ? 'loaded' : 'unloaded' }]);
          if (p === '/api/models/unload' && req.method() === 'POST') {
            const body = JSON.parse(req.postData() || '{}');
            unloads.push(body);
            if (body.force !== true) return json({ error: 'The model is answering a request. Unload it when it is idle, or unload it anyway as an admin.', code: 'model_in_use', retryable: true, canForce: true }, 409);
            loaded = false;
            return json({ ok: true, forced: true });
          }
          if (p === '/api/auto-roles' && req.method() === 'GET') return json({ configured: true, roles: { fast: BUSY_MODEL, smart: BUSY_MODEL }, missing: [] });
          if (p === '/api/models/autotune') return json({ job: null, history: [] });
          if (p === '/api/models/calibration') return json({ job: null, history: [] });
          if (p === '/api/models/autotune/untuned') return json({ models: [], skipped: [] });
          if (p === '/api/model-manager/downloads') return json({ jobs: [] });
          if (p === '/api/model-manager/backends') return json({ backends: [] });
          if (p === '/api/model-manager/models') return json({ models: [], unregistered: [] });
          if (p === '/api/model-manager/models/updates') return json({ status: {} });
          if (p.startsWith('/api/model-manager/')) return json({});
          if (p.startsWith('/api/models/')) return json({});
          return route.continue();
        });
        const manager = await openModelsPage(page, `http://localhost:${PORT}`);
        await openModelsTab(manager, 'Your models');
        const card = manager.getByRole('article', { name: BUSY_MODEL });
        await card.waitFor({ timeout: 15000 });
        await card.getByRole('button', { name: `Unload ${BUSY_MODEL}`, exact: true }).click();
        const inUse = card.getByTestId('model-in-use');
        await inUse.getByText(`${BUSY_MODEL} is answering a request. Unloading it anyway stops that reply.`).waitFor({ timeout: 5000 });
        assert.deepEqual(unloads, [{ name: BUSY_MODEL }], 'the first unload is a plain one');
        await inUse.getByRole('button', { name: 'Unload anyway', exact: true }).click();
        await manager.getByText(`${BUSY_MODEL} was unloaded.`).waitFor({ timeout: 5000 });
        assert.deepEqual(unloads, [{ name: BUSY_MODEL }, { name: BUSY_MODEL, force: true }], 'unload anyway asks once, with force');
        assert.equal(await card.getByTestId('model-in-use').count(), 0, 'the notice goes once it is unloaded');
        // Keep: a second refusal can be dismissed without forcing anything.
        loaded = true;
        await page.reload();
        const again = (await openModelsPage(page, `http://localhost:${PORT}`));
        await openModelsTab(again, 'Your models');
        const card2 = again.getByRole('article', { name: BUSY_MODEL });
        await card2.getByRole('button', { name: `Unload ${BUSY_MODEL}`, exact: true }).click();
        await card2.getByTestId('model-in-use').getByRole('button', { name: 'Keep', exact: true }).click();
        assert.equal(await card2.getByTestId('model-in-use').count(), 0);
        assert.equal(unloads.filter((u) => u.force).length, 1, 'Keep forces nothing');
        assert.deepEqual(errors, []);
      } finally { await page.close(); }
    });
  } finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); await fixture.close(); }
  if (failed) process.exitCode = 1;
})().catch((e) => { console.error(e); process.exitCode = 1; });
