// noevia's own MCP server, over a real socket, against a real app.
//
// Synthetic accounts and a synthetic diary stub only — never the real Diary,
// never production. Closes a genuine gap: no qa suite exercised MCP discovery
// over a socket at all, and this server is the one where a mistake means
// acting as the wrong user.
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const { spawn } = require('node:child_process');

const PORT = 31352, INTERNAL_PORT = 31353, DIARY_PORT = 31354;
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'noevia-mcp-internal-'));
  const diary = diaryStub();
  await new Promise((r) => diary.listen(DIARY_PORT, '127.0.0.1', r));
  const server = spawn(process.execPath, ['server/index.cjs'], { cwd: web, stdio: 'ignore', env: {
    ...process.env,
    UI_DATA_DIR: dir, UI_PORT: String(PORT), UI_HOST: '127.0.0.1', PUBLIC_ORIGIN: origin,
    LEGACY_AUTH_COMPAT: 'false', MODEL_MANAGER_KIND: 'none',
    INFERENCE_BASE_URL: 'http://127.0.0.1:1',
    DIARY_BASE_URL: `http://127.0.0.1:${DIARY_PORT}`, DIARY_AUTH_TOKEN: 'synthetic-only',
    MCP_INTERNAL_PORT: String(INTERNAL_PORT),
    MCP_SERVERS: `noevia|${internal}|internal`,
    MCP_SERVER_URL: '',
  } });
  try {
    for (let i = 0; i < 200; i++) { try { if ((await fetch(origin + '/api/setup/status')).ok) break; } catch {} await new Promise((r) => setTimeout(r, 50)); }

    // Two tenants.
    const admin = client();
    await admin('/api/setup/status');
    assert.equal((await admin('/api/setup/complete', { method: 'POST', body: { setupCode: fs.readFileSync(path.join(dir, 'first-run-setup-code'), 'utf8').trim(), publicOrigin: origin, username: 'adminqa', displayName: 'Synthetic admin', password: 'synthetic password QA', diaryEnabled: true } })).status, 201);
    await admin('/api/profile/onboarding', { method: 'POST', body: {} });
    const invitation = await admin('/api/admin/invitations', { method: 'POST', body: { role: 'member' } });
    const member = client();
    await member('/api/setup/status');
    assert.equal((await member('/api/auth/invitations/accept', { method: 'POST', body: { token: invitation.body.token, username: 'memberqa', displayName: 'Synthetic member', password: 'synthetic password QA', diaryEnabled: true } })).status, 201);
    await member('/api/profile/onboarding', { method: 'POST', body: {} });

    // A project each, with a file only its owner should ever see.
    const adminProject = (await admin('/api/projects', { method: 'POST', body: { name: 'Admin project', files: [{ name: 'secret.md', content: 'ADMIN ONLY CONTENT' }] } })).body;
    const memberProject = (await member('/api/projects', { method: 'POST', body: { name: 'Member project', files: [{ name: 'notes.md', content: 'member alpha beta' }] } })).body;
    assert.ok(adminProject.id && memberProject.id, 'projects were not created');

    // ── The catalogue the app discovered over the socket ──────────────────
    const boxes = (await admin('/api/toolboxes')).body;
    const ours = (boxes.toolboxes || []).filter((b) => ['diary', 'project-docs'].includes(b.id));
    assert.deepEqual(ours.map((b) => b.id).sort(), ['diary', 'project-docs'], 'the internal boxes were not discovered over the socket');
    assert.equal(boxes.mcp.configured, true);
    const state = (boxes.mcp.servers || []).find((s) => s.id === 'noevia');
    assert.equal(state.auth, 'internal');
    assert.equal(state.error, null, `discovery failed: ${state.error}`);
    assert.equal(state.discovered, 9, 'the discovered tool count drifted');
    assert.equal(state.missingCurated, 0);

    // ── The internal port is not the app's port ───────────────────────────
    // Reachable on loopback here because the test IS on the box; what must
    // hold is that it is a SEPARATE listener, never served by the app origin
    // and never in compose `ports:`.
    assert.equal((await fetch(`${origin}/mcp`, { method: 'POST', body: '{}' })).status, 404, 'the internal RPC path answered on the published origin');
    // No compose file may publish it. Read the `ports:` list of every service
    // rather than grepping the whole file, which the env block would match.
    for (const rel of ['../../compose.yaml', '../../deploy/examples/unraid-compose-manager.yml']) {
      const text = fs.readFileSync(path.resolve(web, rel), 'utf8');
      const published = text.split('\n').reduce((acc, line) => {
        if (/^ {4}ports:\s*$/.test(line)) return { inPorts: true, lines: acc.lines };
        if (acc.inPorts && /^ {6}-/.test(line)) return { inPorts: true, lines: [...acc.lines, line] };
        return { inPorts: false, lines: acc.lines };
      }, { inPorts: false, lines: [] }).lines;
      assert.ok(published.length, `${rel}: no ports: entries found, so this guard is not checking anything`);
      for (const line of published) {
        assert.ok(!line.includes('MCP_INTERNAL_PORT'), `${rel} publishes MCP_INTERNAL_PORT: ${line.trim()}`);
      }
    }

    // ── Tokens ────────────────────────────────────────────────────────────
    // The test holds the same key material the server derives, so it can mint
    // exactly the tokens an attacker could not.
    const { createSecretStore } = require(path.join(web, 'server/secrets.cjs'));
    const mcpInternal = require(path.join(web, 'server/mcp-internal.cjs'));
    const KEY = createSecretStore(dir).derive('mcp-internal-token');

    for (const [label, token] of [
      ['no token', ''],
      ['garbage', 'not-a-token'],
      ['wrong key', mcpInternal.mintToken(Buffer.alloc(32, 7), { uid: 'adminqa' })],
      ['expired', mcpInternal.mintToken(KEY, { uid: 'adminqa', ttlMs: -1000 })],
    ]) {
      const out = await rpc(internal, token, call('diary_read_today', {}));
      assert.equal(out.status, 401, `${label} was accepted`);
    }

    // ── Tenant isolation ──────────────────────────────────────────────────
    const adminUser = (await admin('/api/profile')).body.user;
    const memberUser = (await member('/api/profile')).body.user;

    // The member's token, aimed at the admin's project id. The project is
    // resolved in the ADMIN's workspace only, so it does not exist here.
    const crossToken = mcpInternal.mintToken(KEY, { uid: memberUser.id, pid: adminProject.id });
    const cross = await rpc(internal, crossToken, call('project_read_file', { name: 'secret.md' }));
    assert.equal(cross.status, 200);
    const crossText = cross.body.result.content[0].text;
    assert.doesNotMatch(crossText, /ADMIN ONLY CONTENT/, "member B read member A's project file");
    assert.match(crossText, /not in a project|no project file/);

    // …and the member's OWN project reads fine, so the refusal above is real.
    const own = await rpc(internal, mcpInternal.mintToken(KEY, { uid: memberUser.id, pid: memberProject.id }), call('project_read_file', { name: 'notes.md' }));
    assert.match(own.body.result.content[0].text, /member alpha beta/);

    // Arguments naming another user or project are ignored entirely.
    const spoofed = await rpc(internal, mcpInternal.mintToken(KEY, { uid: memberUser.id, pid: memberProject.id }),
      call('project_list_files', { userId: adminUser.id, projectId: adminProject.id, tenant: 'adminqa' }));
    assert.match(spoofed.body.result.content[0].text, /notes\.md/);
    assert.doesNotMatch(spoofed.body.result.content[0].text, /secret\.md/);

    // The diary is resolved by the tenant header the server builds, not by
    // anything the caller can say.
    const diaryOut = await rpc(internal, mcpInternal.mintToken(KEY, { uid: memberUser.id }), call('diary_read_today', { userId: adminUser.id }));
    assert.match(diaryOut.body.result.content[0].text, new RegExp(`SYNTHETIC today for ${memberUser.id}`));

    // ── The write capability ──────────────────────────────────────────────
    // w:0 is what an unapproved write looks like. It must fail even though the
    // token is otherwise perfectly valid.
    const unapproved = await rpc(internal, mcpInternal.mintToken(KEY, { uid: memberUser.id, pid: memberProject.id, w: 0 }),
      call('project_create_file', { name: 'from-model.md', text: 'written by a tool' }));
    assert.equal(unapproved.status, 403, 'an unapproved write was executed');
    assert.match(unapproved.body.error.message, /was not approved/);
    assert.ok(!((await member('/api/workspace')).body.projects.find((p) => p.id === memberProject.id).files || []).some((f) => f.name === 'from-model.md'),
      'the refused write still created a file');

    // w:1 is what the approval gate produces, and it really does write.
    const approvedToken = mcpInternal.mintToken(KEY, { uid: memberUser.id, pid: memberProject.id, w: 1 });
    const approved = await rpc(internal, approvedToken, call('project_create_file', { name: 'from-model.md', text: 'written by a tool' }));
    assert.equal(approved.status, 200);
    assert.match(approved.body.result.content[0].text, /Created "from-model\.md"/);
    const after = (await member('/api/workspace')).body.projects.find((p) => p.id === memberProject.id);
    assert.equal(after.files.find((f) => f.name === 'from-model.md').content, 'written by a tool');

    // That authorization is spent; a captured token cannot repeat the write.
    const replay = await rpc(internal, approvedToken, call('project_create_file', { name: 'again.md', text: 'x' }));
    assert.equal(replay.status, 401);
    assert.match(replay.body.error.message, /already been used/);

    // ── Find/replace guards the file rather than rewriting it ─────────────
    const mismatch = await rpc(internal, mcpInternal.mintToken(KEY, { uid: memberUser.id, pid: memberProject.id, w: 1 }),
      call('project_replace_text', { name: 'notes.md', find: 'zzz', replace: 'q' }));
    assert.match(mismatch.body.result.content[0].text, /nothing was changed/);
    assert.equal((await member('/api/workspace')).body.projects.find((p) => p.id === memberProject.id).files.find((f) => f.name === 'notes.md').content, 'member alpha beta');

    const edited = await rpc(internal, mcpInternal.mintToken(KEY, { uid: memberUser.id, pid: memberProject.id, w: 1 }),
      call('project_replace_text', { name: 'notes.md', find: 'alpha', replace: 'GAMMA' }));
    assert.match(edited.body.result.content[0].text, /Replaced 1 occurrence/);
    assert.equal((await member('/api/workspace')).body.projects.find((p) => p.id === memberProject.id).files.find((f) => f.name === 'notes.md').content, 'member GAMMA beta');

    // ── A discovery token lists but cannot act ────────────────────────────
    const discovery = mcpInternal.mintToken(KEY, { discovery: true });
    const listed = await rpc(internal, discovery, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    assert.equal(listed.status, 200);
    assert.deepEqual(listed.body.result.tools.map((t) => t.name).sort(), [
      'diary_list_months', 'diary_read_month', 'diary_read_today',
      'project_append_file', 'project_create_file', 'project_list_files',
      'project_read_file', 'project_replace_text', 'project_search',
    ]);
    assert.equal((await rpc(internal, discovery, call('project_list_files', {}))).status, 403);

    console.log('PASS internal mcp: discovery over a socket, separate listener, token rejection, tenant isolation across two accounts, spoofed identity arguments ignored, unapproved writes refused, replay refused, find/replace count guard.');
  } finally {
    server.kill('SIGKILL');
    diary.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e); process.exit(1); });
