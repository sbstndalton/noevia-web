'use strict';
// Reproduces, with synthetic fixtures only, the class of bug the 2026-09-21
// storage-path fix addressed (docling.cjs sending a project/folder path as the
// document name, which the worker refuses with HTTP 400 -- see docling.cjs
// and docling.test.cjs "a storage path is sent as a file name") and the
// Latin-1-header defect this session found and fixed alongside it
// (docling.cjs headerSafeName). No real project, no live Docling worker, no
// tax-folder documents: a synthetic WebDAV server stands in for the user's
// storage, and a synthetic HTTP server stands in for services/docling.
//
// Part of #262 -- see docs/handoffs/2026-09-25-verify-262-docling.md for what
// only a live run against the real worker and the real tax folder can prove.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { once } = require('node:events');

const web = path.resolve(__dirname, '..');

// ── a synthetic WebDAV server: the project's own folder, plus one externally
//    "linked" folder whose name itself has the nested/space/unicode shape
//    that caused the original bug ──────────────────────────────────────────
function startFakeDav() {
  const tree = { '': [] };
  const bodies = {};
  function parentOf(p) { return p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : ''; }
  function nameOf(p) { return p.split('/').pop(); }
  const server = http.createServer((req, res) => {
    const decoded = decodeURIComponent(req.url.split('?')[0]).replace(/^\/dav\/?/, '').replace(/\/+$/, '');
    if (req.method === 'PROPFIND') {
      const children = tree[decoded];
      if (children === undefined) { res.writeHead(404); res.end(); return; }
      const xml = children.map((name) => {
        const childPath = decoded ? `${decoded}/${name}` : name;
        const isDir = tree[childPath] !== undefined;
        const size = isDir ? '' : `<getcontentlength>${(bodies[childPath] || Buffer.alloc(0)).length}</getcontentlength>`;
        return `<d:response><d:href>/dav/${encodeURI(childPath)}${isDir ? '/' : ''}</d:href>` +
          `<d:propstat><d:prop><d:resourcetype>${isDir ? '<d:collection/>' : ''}</d:resourcetype>${size}</d:prop></d:propstat></d:response>`;
      }).join('');
      res.writeHead(207, { 'Content-Type': 'application/xml' });
      res.end(`<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">${xml}</d:multistatus>`);
      return;
    }
    if (req.method === 'GET') {
      const body = bodies[decoded];
      if (body === undefined) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Length': body.length });
      res.end(body);
      return;
    }
    if (req.method === 'PUT') {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        bodies[decoded] = Buffer.concat(chunks);
        const parent = parentOf(decoded), name = nameOf(decoded);
        if (tree[parent] && !tree[parent].includes(name)) tree[parent].push(name);
        res.writeHead(201); res.end();
      });
      return;
    }
    if (req.method === 'MKCOL') {
      if (tree[decoded] !== undefined) { res.writeHead(405); res.end(); return; }
      tree[decoded] = [];
      const parent = parentOf(decoded), name = nameOf(decoded);
      if (tree[parent] && !tree[parent].includes(name)) tree[parent].push(name);
      res.writeHead(201); res.end();
      return;
    }
    res.writeHead(405); res.end();
  });
  // Directly mutate a file's bytes as if it changed on the storage server
  // between syncs -- there is no client API for editing a linked-folder file
  // in place, and that is exactly the case a re-sync has to notice.
  function ensureDir(p) {
    if (tree[p] !== undefined) return;
    const parent = parentOf(p), name = nameOf(p);
    if (parent) ensureDir(parent);
    tree[p] = [];
    if (!tree[parent].includes(name)) tree[parent].push(name);
  }
  function setFile(p, bytes) {
    ensureDir(parentOf(p));
    const parent = parentOf(p), name = nameOf(p);
    if (!tree[parent].includes(name)) tree[parent].push(name);
    bodies[p] = bytes;
  }
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, setFile })));
}

// ── a synthetic Docling worker: asserts the request it receives is
//    well-formed (bare filename, no path, no 400-triggering shape) and
//    returns a canned document keyed by name ─────────────────────────────
function startFakeDocling() {
  const calls = []; // { name } for every accepted request, in order
  const malformed = []; // any request that looks like the pre-fix bug would have sent
  let failNext = null; // name -> HTTP status to answer once
  const responses = new Map(); // name -> () => body
  const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/extract') { res.writeHead(404); res.end('{}'); return; }
    const name = req.headers['x-document-name'];
    // What the real worker (services/docling/server.py) itself checks: no
    // slash, no backslash, a plain header value, at most 200 characters.
    if (!name || name.includes('/') || name.includes('\\') || name.length > 200) {
      malformed.push({ name, headers: req.headers });
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid document size or name.' }));
      return;
    }
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      calls.push({ name, bytes: Buffer.concat(chunks).length });
      if (failNext && failNext.name === name) {
        const status = failNext.status;
        failNext = null;
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'synthetic failure' }));
        return;
      }
      const build = responses.get(name);
      const body = build ? build() : { pages: [{ number: 1, text: '(unconfigured fixture)', status: 'native', truncated: false }], total: 1 };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    server, port: server.address().port, calls, malformed,
    respond: (name, build) => responses.set(name, build),
    failOnce: (name, status) => { failNext = { name, status }; },
  })));
}

// A byte-identical stand-in for a PDF: docling.cjs never parses bytes itself
// (that is the private worker's job, faked above), it only forwards them, so
// the %PDF- magic is enough to satisfy noevia's own upload validation.
const pdfBytes = (label) => Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from(`synthetic fixture: ${label}`)]);

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'noevia-docling-qa-'));
  const dav = await startFakeDav();
  const docling = await startFakeDocling();
  const origin = 'http://127.0.0.1:31249';
  const server = spawn(process.execPath, ['server/index.cjs'], {
    cwd: web, stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env, UI_DATA_DIR: dir, UI_PORT: '31249', UI_HOST: '127.0.0.1', PUBLIC_ORIGIN: origin,
      LEGACY_AUTH_COMPAT: 'false', DIARY_AUTH_TOKEN: 'synthetic', DIARY_BASE_URL: 'http://127.0.0.1:1',
      INFERENCE_BASE_URL: 'http://127.0.0.1:1/v1', MODEL_MANAGER_KIND: 'none', MCP_SERVERS: '', MCP_SERVER_URL: '',
      DOCLING_BASE_URL: `http://127.0.0.1:${docling.port}`,
    },
  });
  let serverStderr = '';
  server.stderr.on('data', (c) => { serverStderr += c; });
  server.stdout.on('data', () => {});

  // Every request against the spawned server carries its own hard timeout,
  // so a server that stops answering (rather than refusing the connection)
  // fails fast instead of hanging the script -- this is what left the
  // reviewer's run at exit 143 after a 120s external timeout.
  const REQUEST_TIMEOUT_MS = 10000;
  const DEADLINE_MS = 60000;
  const deadlineAt = Date.now() + DEADLINE_MS;
  const deadlineTimer = setTimeout(() => {
    console.error(`FAIL docling-storage-path: overall ${DEADLINE_MS}ms deadline exceeded`);
    if (serverStderr) console.error('server stderr:\n' + serverStderr);
    process.exit(1);
  }, DEADLINE_MS);
  deadlineTimer.unref();

  let session = '', csrf = '';
  function cookieHeader() { return `cowork_session=${session}; cowork_csrf=${csrf}`; }
  function absorbCookies(res) {
    for (const line of res.headers.getSetCookie?.() || []) {
      const m1 = /^cowork_session=([^;]*)/.exec(line); if (m1) session = m1[1];
      const m2 = /^cowork_csrf=([^;]*)/.exec(line); if (m2) csrf = m2[1];
    }
  }
  async function api(urlPath, body, method = body === undefined ? 'GET' : 'POST') {
    const res = await fetch(origin + urlPath, {
      method, headers: { 'Content-Type': 'application/json', Cookie: cookieHeader(), 'X-CSRF-Token': csrf },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    absorbCookies(res);
    const text = await res.text();
    let parsed; try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = { raw: text }; }
    return { status: res.status, body: parsed };
  }
  try {
    let booted = false;
    while (Date.now() < deadlineAt) {
      try {
        if ((await fetch(origin + '/api/setup/status', { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })).ok) { booted = true; break; }
      } catch { /* still booting */ }
      if (server.exitCode !== null) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    if (!booted) {
      throw new Error(
        `server never answered /api/setup/status (exitCode=${server.exitCode})\nserver stderr:\n${serverStderr || '(empty)'}`,
      );
    }
    const setupCode = fs.readFileSync(path.join(dir, 'first-run-setup-code'), 'utf8').trim();
    let res = await fetch(origin + '/api/setup/complete', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ setupCode, publicOrigin: origin, username: 'doclingqa', displayName: 'Synthetic Docling QA', password: 'synthetic docling password', diaryEnabled: false }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    assert.equal(res.status, 201, 'setup');
    absorbCookies(res);
    await api('/api/profile/onboarding', {});

    // The user's own storage: a browsable WebDAV connection pointed at the
    // fake server, which is what makes a project's own folder (and any
    // attached folder) an *actual path*, not a bare local id.
    res = await api('/api/integrations/storage', { kind: 'webdav', baseUrl: `http://127.0.0.1:${dav.port}/dav`, username: 'u', secret: 's' }, 'PUT');
    assert.equal(res.status, 200, JSON.stringify(res.body));

    // A project name with a space AND a character outside Latin-1: its own
    // folder becomes "noevia projects/Récépissés 📎 2024", two levels deep,
    // with exactly the characteristics the 2026-09-21 fix and this session's
    // header fix both target.
    res = await api('/api/projects', { name: 'Récépissés 📎 2024', model: 'synthetic-model', toolboxes: [] });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const project = res.body;
    assert.match(project.projectFolder, /^noevia projects\/Récépissés/, 'the folder keeps the space and the unicode character');

    // Pre-populate a second, externally "linked" folder -- also nested, also
    // with a space and a non-ASCII character in its own name -- with two
    // documents already sitting in it, the way a folder from the user's own
    // storage would arrive already populated on the first sync.
    const linked = 'Tax Docs 2024 – Récépissés';
    dav.setFile(`${linked}/W-2 (clean copy).pdf`, pdfBytes('clean text-only page'));
    dav.setFile(`${linked}/Scanned receipt.pdf`, pdfBytes('image-bearing page, v1'));

    docling.respond(`W-2 (clean copy).pdf`, () => ({ pages: [{ number: 1, text: 'Wages: 1000', status: 'native', truncated: false }], total: 1 }));
    // A page whose text hit the extractor's own cap -- the shape Docling
    // actually emits for a heavy, OCR-costly page (extract.py never emits an
    // "ocr" status of its own; "truncated" is the real signal of an
    // incompletely-recovered page) -- yields the "flagged, partial" status
    // the task calls out, without inventing a status the worker cannot send.
    docling.respond('Scanned receipt.pdf', () => ({
      pages: [
        { number: 1, text: 'Store: Synthetic Mart', status: 'native', truncated: false },
        { number: 2, text: 'x'.repeat(50), status: 'truncated', truncated: true },
      ], total: 2,
    }));

    res = await api(`/api/projects/${project.id}/config`, { sourceFolders: [project.projectFolder, linked] });
    assert.equal(res.status, 200, JSON.stringify(res.body));

    // ── the actual reproduction: sync the attached folders ────────────────
    res = await api(`/api/projects/${project.id}/sources/sync`, {}, 'POST');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(docling.malformed, [], 'the worker must never see a path-shaped or non-Latin-1 name');

    let workspace = (await api('/api/workspace')).body;
    let proj = workspace.projects.find((p) => p.id === project.id);
    const byBase = (name) => proj.files.find((f) => f.name.endsWith('/' + name));
    const clean = byBase('W-2 (clean copy).pdf');
    const scanned = byBase('Scanned receipt.pdf');
    assert.ok(clean && scanned, 'both synced files reached the project');
    assert.equal(clean.document.state, 'ready', 'a clean text page extracts cleanly');
    assert.ok(clean.content.includes('Wages: 1000'));
    assert.equal(scanned.document.state, 'partial', 'a page the worker could not fully recover is reported, not hidden');
    assert.equal(scanned.document.stale, false);

    const callsAfterFirstSync = docling.calls.length;
    assert.equal(callsAfterFirstSync, 2, 'exactly the two new documents were sent to the worker');

    // ── re-sync with nothing changed: cached by content hash, not re-read ──
    res = await api(`/api/projects/${project.id}/sources/sync`, {}, 'POST');
    assert.equal(res.status, 200);
    assert.equal(docling.calls.length, callsAfterFirstSync, 'an unchanged file is not re-sent to the worker on re-sync');

    // ── change one file's bytes, then have the worker fail on the reread:
    //    the API must show a FAILED, STALE file that still serves the last
    //    good text, and only the changed file must have been re-sent ──────
    dav.setFile(`${linked}/W-2 (clean copy).pdf`, pdfBytes('clean text-only page, corrected amount'));
    docling.failOnce('W-2 (clean copy).pdf', 503);
    res = await api(`/api/projects/${project.id}/sources/sync`, {}, 'POST');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(docling.calls.length, callsAfterFirstSync + 1, 'only the changed file was re-read');

    workspace = (await api('/api/workspace')).body;
    proj = workspace.projects.find((p) => p.id === project.id);
    const failedFile = proj.files.find((f) => f.name.endsWith('/W-2 (clean copy).pdf'));
    assert.equal(failedFile.document.state, 'failed', 'a worker failure on reread is reported as failed');
    assert.equal(failedFile.document.stale, true, 'stale reaches the API alongside failed');
    assert.ok(failedFile.content.includes('Wages: 1000'), 'the last good text is kept, not blanked, while stale');

    // ── recovering: the next sync re-reads the same (still-changed) file
    //    and clears the failed/stale state once the worker succeeds ───────
    docling.respond('W-2 (clean copy).pdf', () => ({ pages: [{ number: 1, text: 'Wages: 1200 (corrected)', status: 'native', truncated: false }], total: 1 }));
    res = await api(`/api/projects/${project.id}/sources/sync`, {}, 'POST');
    assert.equal(res.status, 200);
    workspace = (await api('/api/workspace')).body;
    proj = workspace.projects.find((p) => p.id === project.id);
    const recovered = proj.files.find((f) => f.name.endsWith('/W-2 (clean copy).pdf'));
    assert.equal(recovered.document.state, 'ready');
    assert.equal(recovered.document.stale, false);
    assert.ok(recovered.content.includes('Wages: 1200 (corrected)'));

    // ── the project's OWN folder, uploaded into directly (the other path
    //    into documentSources.ingest), with a plain-ASCII upload name but a
    //    unicode+space folder ahead of it -- the header-safety fix's own
    //    regression target ────────────────────────────────────────────────
    docling.respond('invoice.pdf', () => ({ pages: [{ number: 1, text: 'Invoice total: 42', status: 'native', truncated: false }], total: 1 }));
    res = await api(`/api/projects/${project.id}/upload`, { name: 'invoice.pdf', dataBase64: pdfBytes('own-folder upload').toString('base64') });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(docling.malformed, []);

    console.log('PASS nested/space/unicode storage paths reach Docling without a 400, per-file extracted/partial status, failed+stale reaches the API, and re-sync re-reads only changed files.');
  } finally {
    clearTimeout(deadlineTimer);
    server.kill('SIGTERM');
    await once(server, 'exit').catch(() => {});
    await new Promise((r) => dav.server.close(r));
    await new Promise((r) => docling.server.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
