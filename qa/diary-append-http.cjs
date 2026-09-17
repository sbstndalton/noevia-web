// D10: diary_append over noevia's own MCP server with features.diaryMcpWrite on. Real app, stub sidecar.
//
// Synthetic accounts and a synthetic diary stub only — never the real Diary,
// never production. Closes a genuine gap: no qa suite exercised MCP discovery
// over a socket at all, and this server is the one where a mistake means
// acting as the wrong user.
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const { spawn } = require('node:child_process');

const PORT = 31362, INTERNAL_PORT = 31363, DIARY_PORT = 31364;
const appends = [];
const origin = `http://127.0.0.1:${PORT}`;
const internal = `http://127.0.0.1:${INTERNAL_PORT}/mcp`;
const web = path.resolve(__dirname, '..');

// ── a diary that is not the user's diary ─────────────────────────────────
function diaryStub() {
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const send = (body) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    // Tenant header, echoed back so the test can prove which corpus was asked for.
    const who = req.headers['x-cowork-user-id'] || '';
    if (url.pathname === '/api/day' && url.searchParams.get('month')) return send({ month: url.searchParams.get('month'), log: `SYNTHETIC month for ${who}` });
    if (url.pathname === '/api/day') return send({ day: '2026-09-15', today_log: `SYNTHETIC today for ${who}`, standing: '' });
    if (url.pathname === '/api/months') return send({ months: ['2026-08', '2026-09'] });
    if (url.pathname === '/api/entries/append' && req.method === 'POST') {
      let raw = ''; req.on('data', (c) => { raw += c; }); req.on('end', () => { const body = JSON.parse(raw); appends.push({ who, body }); send({ ok: true, xid: body.requestId, day: body.entryTime.slice(0, 10) }); });
      return;
    }
    res.writeHead(404); res.end('{}');
  });
}

async function rpc(url, token, body) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  let parsed = null;
  try { parsed = JSON.parse(await r.text()); } catch {}
  return { status: r.status, body: parsed };
}

const call = (name, args) => ({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });

// Cookie-jar fetch, so two accounts can be driven independently.
function client() {
  const jar = new Map();
  return async function req(url, { method = 'GET', body } = {}) {
    const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const csrf = jar.get('cowork_csrf') ? decodeURIComponent(jar.get('cowork_csrf')) : '';
    const r = await fetch(origin + url, {
      method,
      headers: { 'Content-Type': 'application/json', origin, ...(cookie ? { cookie } : {}), ...(csrf ? { 'X-CSRF-Token': csrf } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
    });
    for (const raw of (r.headers.getSetCookie ? r.headers.getSetCookie() : [])) {
      const [pair] = raw.split(';');
      const eq = pair.indexOf('=');
      jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
    let parsed = null;
    try { parsed = JSON.parse(await r.text()); } catch {}
    return { status: r.status, body: parsed };
  };
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'noevia-diary-append-'));
  const diary = diaryStub();
  await new Promise((r) => diary.listen(DIARY_PORT, '127.0.0.1', r));
  const env = (extra) => ({ ...process.env,
    UI_DATA_DIR: dir, UI_PORT: String(PORT), UI_HOST: '127.0.0.1', PUBLIC_ORIGIN: origin,
    LEGACY_AUTH_COMPAT: 'false', MODEL_MANAGER_KIND: 'none', INFERENCE_BASE_URL: 'http://127.0.0.1:1',
    DIARY_BASE_URL: `http://127.0.0.1:${DIARY_PORT}`, DIARY_AUTH_TOKEN: 'synthetic-only',
    MCP_INTERNAL_PORT: String(INTERNAL_PORT), MCP_SERVERS: `noevia|${internal}|internal`, MCP_SERVER_URL: '', ...extra });
  const start = async (extra) => {
    const child = spawn(process.execPath, ['server/index.cjs'], { cwd: web, stdio: 'ignore', env: env(extra) });
    for (let i = 0; i < 200; i++) { try { if ((await fetch(origin + '/api/setup/status')).ok) break; } catch {} await new Promise((r) => setTimeout(r, 50)); }
    return child;
  };
  let server = await start({});
  try {
    const admin = client();
    await admin('/api/setup/status');
    assert.equal((await admin('/api/setup/complete', { method: 'POST', body: { setupCode: fs.readFileSync(path.join(dir, 'first-run-setup-code'), 'utf8').trim(), publicOrigin: origin, username: 'adminqa', displayName: 'Synthetic admin', password: 'synthetic password QA', diaryEnabled: true } })).status, 201);
    const { createSecretStore } = require(path.join(web, 'server/secrets.cjs'));
    const mcpInternal = require(path.join(web, 'server/mcp-internal.cjs'));
    const KEY = createSecretStore(dir).derive('mcp-internal-token');
    const names = async () => (await rpc(internal, mcpInternal.mintToken(KEY, { discovery: true }), { jsonrpc: '2.0', id: 1, method: 'tools/list' })).body.result.tools.map((t) => t.name);

    // Off by default: no write tool anywhere.
    assert.ok(!(await names()).includes('diary_append'), 'diary_append offered with the feature off');
    const adminUser = (await admin('/api/auth/session')).body.user;
    const off = await rpc(internal, mcpInternal.mintToken(KEY, { uid: adminUser.id, w: 1 }), call('diary_append', { text: 'x' }));
    assert.ok(off.body.error || off.body.result?.isError, 'unknown tool must fail with the feature off');
    assert.equal(appends.length, 0);

    // The admin toggle is locked when the env var is set; restart with it on.
    server.kill('SIGKILL');
    server = await start({ NOEVIA_FEATURE_DIARY_MCP_WRITE: 'true' });
    const again = client();
    assert.equal((await again('/api/auth/login/password', { method: 'POST', body: { username: 'adminqa', password: 'synthetic password QA' } })).status, 200);
    const flags = (await again('/api/admin/features')).body.features.find((f) => f.name === 'diaryMcpWrite');
    assert.deepEqual([flags.enabled, flags.locked], [true, true]);
    assert.ok((await names()).includes('diary_append'), 'diary_append missing with the feature on');
    const box = (await again('/api/toolboxes')).body.toolboxes.find((b) => b.id === 'diary');
    assert.ok(box, 'diary box offered');

    // Without approval (w:0) the internal server refuses; nothing reaches the sidecar.
    const unapproved = await rpc(internal, mcpInternal.mintToken(KEY, { uid: adminUser.id }), call('diary_append', { text: 'not approved' }));
    assert.ok(unapproved.status === 403 || unapproved.body?.error, 'unapproved write accepted');
    assert.equal(appends.length, 0);

    // Approved: exactly one append, for this tenant, today, with no day/xid from the model.
    const ok = await rpc(internal, mcpInternal.mintToken(KEY, { uid: adminUser.id, w: 1 }), call('diary_append', { text: 'A synthetic calm walk.', title: 'Walk', timezone: 'UTC', day: '2020-01-01', requestId: 'forged' }));
    assert.match(ok.body.result.content[0].text, /Added a note to the diary for \d{4}-\d{2}-\d{2}/);
    assert.equal(appends.length, 1);
    const sent = appends[0];
    assert.equal(sent.who, adminUser.id);
    assert.deepEqual(Object.keys(sent.body).sort(), ['entryTime', 'requestId', 'text', 'title']);
    assert.notEqual(sent.body.requestId, 'forged');
    assert.match(sent.body.entryTime, /\+00:00$/);
    assert.ok(Math.abs(new Date(sent.body.entryTime) - Date.now()) < 60000);
    console.log('PASS diary append: off by default, env-locked flag, approval required, tenant header, today only, no model-chosen day or id.');
  } finally {
    server.kill('SIGKILL');
    diary.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e); process.exit(1); });
