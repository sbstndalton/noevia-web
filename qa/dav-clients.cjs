// DAV client emulation (docs/dav.md, "Interoperability matrix"; issue #263): raw-HTTP
// approximation of macOS Finder (WebDAVFS), Windows Explorer/WinSCP (Mini-Redirector) and iOS
// Files, against the real web server AND the real Diary companion, on a throwaway tenant. No
// Playwright, no browser: the admin bootstrap below drives /api/setup/complete etc. with plain
// fetch and a hand-rolled cookie jar, exactly like a script would. Nothing here reaches DaServer
// or any real Diary. Needs services/diary's Python deps (fastapi/uvicorn/httpx/pyyaml/jinja2/
// python-multipart). Finder/Explorer/WinSCP/iOS Files themselves are device-blocked
// (docs/dav.md); this approximates each client's HTTP pattern from public documentation and
// prior interop reports (cited per header below) against the real listener, so device runs only
// need to confirm. It is not a faithful reproduction of any client's exact wire behavior — only
// the parts cited have a source; anything else is a best-effort guess, marked "approximated".
// Obsidian sync is covered by dav-obsidian.cjs and only referenced here.
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const { spawn } = require('node:child_process'), { once } = require('node:events');

const origin = 'http://localhost:31289', dav = 'http://localhost:31290', companionUrl = 'http://127.0.0.1:31291';
const web = path.resolve(__dirname, '..'), diary = path.resolve(web, '../../services/diary');
const python = process.env.DIARY_PYTHON || (fs.existsSync(path.join(diary, '.venv/bin/python')) ? path.join(diary, '.venv/bin/python') : 'python3');

const wait = async (url, headers = {}) => {
  for (let i = 0; i < 200; i++) { try { if ((await fetch(url, { headers })).ok) return; } catch { /* retry */ } await new Promise(r => setTimeout(r, 100)); }
  throw Error('not up: ' + url);
};

// A tiny cookie jar over plain fetch: the whole point of this suite is raw HTTP with no browser.
function jar() {
  const cookies = new Map();
  const apply = res => { for (const line of res.headers.getSetCookie?.() ?? []) { const [kv] = line.split(';'); const i = kv.indexOf('='); if (i > 0) cookies.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim()); } };
  const header = () => [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  return { apply, header, get: k => cookies.get(k) };
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'noevia-dav-clients-')), results = [];
  const log = fs.openSync(path.join(dir, 'companion.log'), 'a');
  const companion = spawn(python, ['-m', 'uvicorn', 'agent.app:app', '--host', '127.0.0.1', '--port', '31291'], {
    cwd: diary, stdio: ['ignore', log, log], env: {
      ...process.env, DIARY_AUTH_TOKEN: 'synthetic-only', DB_PATH: path.join(dir, 'diary', 'index.db'),
      CORPUS_BACKEND: 'local', CORPUS_LOCAL_ROOT: path.join(dir, 'legacy-corpus'),
      LLM_BASE_URL: 'http://127.0.0.1:1', LLM_AUX_BASE_URL: 'http://127.0.0.1:1', DIARY_INDEX_ENABLED: 'true',
    },
  });
  fs.mkdirSync(path.join(dir, 'web'), { recursive: true });
  const server = spawn(process.execPath, ['server/index.cjs'], {
    cwd: web, stdio: 'ignore', env: {
      ...process.env, UI_DATA_DIR: path.join(dir, 'web'), UI_PORT: '31289', UI_HOST: '127.0.0.1', PUBLIC_ORIGIN: origin,
      LEGACY_AUTH_COMPAT: 'false', DIARY_AUTH_TOKEN: 'synthetic-only', INFERENCE_BASE_URL: 'http://127.0.0.1:1',
      DIARY_BASE_URL: companionUrl, MODEL_MANAGER_KIND: 'none', MCP_SERVERS: '', MCP_SERVER_URL: '',
      COWORK_DAV_PORT: '31290', COWORK_DAV_SCOPE: 'lan', COWORK_DAV_ORIGIN: dav,
    },
  });
  const cookies = jar();
  let csrfToken = '';
  async function admin(url, body, method = body === undefined ? 'GET' : 'POST') {
    const r = await fetch(origin + url, {
      method, headers: { 'Content-Type': 'application/json', 'Cookie': cookies.header(), ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    cookies.apply(r);
    return { status: r.status, body: await r.json().catch(() => null) };
  }
  // One row per assertion the emulation makes. Every row has an expected outcome (baked into
  // `pass` by the caller): a documented refusal counts as PASS only when the actual status
  // matches that expected refusal status, and any other status — including a 500, or a 2xx that
  // should never happen on a refused write — is a FAIL. `invariant: true` additionally fails the
  // whole run (non-zero exit), for checks whose violation (e.g. a write that must always be
  // refused — LOCK, PROPPATCH, a protected path — instead succeeding with 2xx) is not just a
  // per-client quirk but a break of a guarantee the whole suite relies on.
  const record = (client, name, pass, detail, { invariant = false } = {}) => results.push({ client, name, pass, detail: detail || '', invariant });
  const req = async (method, urlPath, { headers = {}, body } = {}) => {
    const r = await fetch(dav + urlPath, { method, headers, body });
    const text = method === 'HEAD' ? '' : await r.text().catch(() => '');
    return { status: r.status, headers: r.headers, text };
  };

  try {
    await wait(companionUrl + '/api/health', { Authorization: 'Bearer synthetic-only' });
    await wait(origin + '/api/setup/status');
    const setup = await admin('/api/setup/complete', {
      setupCode: fs.readFileSync(path.join(dir, 'web', 'first-run-setup-code'), 'utf8').trim(),
      publicOrigin: origin, username: 'clients', displayName: 'Synthetic clients', password: 'synthetic password clients', diaryEnabled: true,
    });
    assert.equal(setup.status, 201, JSON.stringify(setup.body));
    csrfToken = setup.body.csrfToken;
    assert.equal((await admin('/api/profile/onboarding', {})).status, 200);
    assert.equal((await admin('/api/profile/sharing', { scope: 'lan', acknowledgeCleartext: true }, 'PUT')).status, 200);
    const credential = (await admin('/api/profile/app-passwords', { name: 'client emulation', scope: 'lan' })).body;
    const auth = { Authorization: 'Basic ' + Buffer.from('clients:' + credential.password).toString('base64') };
    const wrongAuth = { Authorization: 'Basic ' + Buffer.from('clients:wrong password entirely').toString('base64') };

    // Seed through the web DAV PUT (the supported write path), including the protected index.
    for (const [p, body] of [['notes.md', '# Notes\n'], ['INDEX.md', '# Index\n']]) {
      const r = await req('PUT', `/dav/clients/${p}`, { headers: { ...auth, 'If-None-Match': '*' }, body });
      assert.ok([201, 204].includes(r.status), p + ' seed ' + r.status);
    }
    const indexBefore = (await req('GET', '/dav/clients/INDEX.md', { headers: auth })).text;
    const trashRecords = async () => (await admin('/api/diary/workspace-trash')).body?.records || [];

    // ── Authentication invariants, shared by every client emulation ──────────────────────────
    {
      const wrong = await req('GET', '/dav/clients/notes.md', { headers: wrongAuth });
      record('shared', 'wrong app password -> 401 with WWW-Authenticate realm', wrong.status === 401 && /realm="noevia diary files"/.test(wrong.headers.get('www-authenticate') || ''), `status=${wrong.status} WWW-Authenticate=${wrong.headers.get('www-authenticate')}`, { invariant: true });
      const none = await req('GET', '/dav/clients/notes.md');
      record('shared', 'missing credentials -> 401', none.status === 401, `status=${none.status}`, { invariant: true });
    }

    // ══════════════════════════════════════════════════════════════════════════════════════════
    // macOS Finder (WebDAVFS / mount_webdav)
    // ══════════════════════════════════════════════════════════════════════════════════════════
    {
      const c = 'Finder (WebDAVFS)';
      const opts = await req('OPTIONS', '/dav/clients/', { headers: auth });
      record(c, 'OPTIONS probe', opts.status === 200 && !!opts.headers.get('allow'), `status=${opts.status} Allow=${opts.headers.get('allow')} DAV=${opts.headers.get('dav')}`);
      // Approximated: WebDAVFS's exact PROPFIND property set is not publicly documented by Apple.
      // The `executable` property in the `http://apache.org/dav/props/` namespace it (and other
      // *nix-facing clients) queries is documented by Apache's mod_dav_fs. Whatever the exact set,
      // unknown namespaces must come back as 404 propstat entries, never break the response.
      const finderProps = `<?xml version="1.0" encoding="utf-8"?><D:propfind xmlns:D="DAV:"><D:prop>` +
        `<D:getlastmodified/><D:getcontentlength/><D:executable xmlns="http://apache.org/dav/props/"/>` +
        `<D:resourcetype/><D:getetag/><D:getcontenttype/></D:prop></D:propfind>`;
      const pf0 = await req('PROPFIND', '/dav/clients/', { headers: { ...auth, depth: '0' }, body: finderProps });
      record(c, 'PROPFIND Depth 0, Finder property set -> 207 multistatus', pf0.status === 207 && /<d:multistatus/i.test(pf0.text), `status=${pf0.status}`);
      const pf1 = await req('PROPFIND', '/dav/clients/', { headers: { ...auth, depth: '1' }, body: finderProps });
      record(c, 'PROPFIND Depth 1, Finder property set lists children', pf1.status === 207 && /notes\.md/.test(pf1.text), `status=${pf1.status} matches=${(pf1.text.match(/<d:href>/g) || []).length}`);
      // AppleDouble sidecar (._name) written before the data file, unconditionally (approximated:
      // WebDAVFS does not send If-None-Match on these writes). The endpoint only accepts .md, so
      // this is expected to be refused; Finder tolerates that (it treats the sidecar as best-effort).
      const sidecar = await req('PUT', '/dav/clients/._photo.md', { headers: auth, body: 'APPLEDOUBLE' });
      record(c, 'AppleDouble ._name sidecar PUT (dot-prefixed, refused)', sidecar.status === 400, `status=${sidecar.status}`);
      const dsstore = await req('PUT', '/dav/clients/.DS_Store', { headers: auth, body: 'DS' });
      record(c, '.DS_Store PUT (dot-prefixed, refused)', dsstore.status === 400, `status=${dsstore.status}`);
      // LOCK before PUT, UNLOCK after: not implemented (D6, class 1 only). Finder mounts such
      // servers read-only, which is why the interop note in docs/dav.md already predicts this.
      const lock = await req('LOCK', '/dav/clients/notes.md', { headers: auth, body: '<?xml version="1.0"?><D:lockinfo xmlns:D="DAV:"><D:lockscope><D:exclusive/></D:lockscope><D:locktype><D:write/></D:locktype></D:lockinfo>' });
      record(c, 'LOCK before PUT -> 405/501 (no class 2; Finder would then mount read-only)', [405, 501].includes(lock.status), `status=${lock.status} Allow=${lock.headers.get('allow')}`, { invariant: true });
      const unlock = await req('UNLOCK', '/dav/clients/notes.md', { headers: { ...auth, 'Lock-Token': '<opaquelocktoken:none>' } });
      record(c, 'UNLOCK after -> 405/501', [405, 501].includes(unlock.status), `status=${unlock.status}`, { invariant: true });
      // PUT with Expect: 100-continue and chunked transfer-encoding: standard HTTP (RFC 9110 §10.1.1
      // for Expect/100-continue, RFC 9112 §7.1 for chunked), which WebDAVFS is reported to use before
      // streaming a file's bytes (approximated: not independently verified against a real Mac here).
      // Node's fetch/undici refuses to send an Expect header at all, so this one goes over node:http
      // directly, which implements the 100-continue handshake.
      const chunkedPut = await new Promise((resolve, reject) => {
        const u = new URL(dav + '/dav/clients/finder-upload.md');
        const r = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, method: 'PUT', headers: { ...auth, Expect: '100-continue', 'If-None-Match': '*', 'Transfer-Encoding': 'chunked' } });
        r.on('continue', () => { r.write('# Finder upload\n'); r.end(); });
        r.on('response', res => { res.resume(); res.on('end', () => resolve({ status: res.statusCode, etag: res.headers.etag })); });
        r.on('error', reject);
      });
      record(c, 'PUT with Expect: 100-continue + chunked body', [201, 204].includes(chunkedPut.status), `status=${chunkedPut.status}`);
      const moveOverwriteF = await req('MOVE', '/dav/clients/finder-upload.md', { headers: { ...auth, Destination: `${dav}/dav/clients/finder-renamed.md`, Overwrite: 'F' } });
      record(c, 'MOVE rename with Overwrite: F', [201].includes(moveOverwriteF.status), `status=${moveOverwriteF.status}`);
      const del = await req('DELETE', '/dav/clients/finder-renamed.md', { headers: auth });
      record(c, 'DELETE', del.status === 204, `status=${del.status}`);
      const missing = await req('PROPFIND', '/dav/clients/does-not-exist.md', { headers: { ...auth, depth: '0' } });
      record(c, 'PROPFIND on non-existent path -> 404, not a 207 shape', missing.status === 404 && !/multistatus/i.test(missing.text), `status=${missing.status}`);
    }

    // ══════════════════════════════════════════════════════════════════════════════════════════
    // Windows Explorer (Mini-Redirector) and WinSCP
    // ══════════════════════════════════════════════════════════════════════════════════════════
    {
      const c = 'Windows Explorer / WinSCP';
      // MS-Author-Via is defined by RFC 4437 §5; the Mini-Redirector is documented to check for it
      // during its DAV capability probe.
      const opts = await req('OPTIONS', '/dav/clients/', { headers: auth });
      record(c, 'OPTIONS probes for MS-Author-Via: DAV', opts.status === 200, `status=${opts.status} MS-Author-Via=${opts.headers.get('ms-author-via') || '(absent)'} DAV=${opts.headers.get('dav')}`);
      // translate: f is documented by Microsoft (support.microsoft.com KB831981) to request raw
      // bytes instead of server-side-translated (e.g. ASP) content; IIS-facing WebDAV clients send it.
      const pf = await req('PROPFIND', '/dav/clients/', { headers: { ...auth, Depth: '1', translate: 'f' } });
      record(c, 'PROPFIND Depth: 1, translate: f -> 207 with children', pf.status === 207 && /notes\.md/.test(pf.text), `status=${pf.status}`);
      // PROPPATCH of Win32 file-time properties: unsupported (405) per docs/dav.md's method table.
      const proppatch = await req('PROPPATCH', '/dav/clients/notes.md', { headers: auth, body: `<?xml version="1.0"?><D:propertyupdate xmlns:D="DAV:" xmlns:Z="urn:schemas-microsoft-com:"><D:set><D:prop><Z:Win32CreationTime>Wed, 23 Sep 2026 00:00:00 GMT</Z:Win32CreationTime></D:prop></D:set></D:propertyupdate>` });
      record(c, 'PROPPATCH Win32 timestamps -> 405 (no dead properties stored)', proppatch.status === 405, `status=${proppatch.status} Allow=${proppatch.headers.get('allow')}`, { invariant: true });
      // Explorer's two-step create: zero-length PUT, then a second, unconditional PUT with the
      // real content (approximated: the Mini-Redirector does not send If-Match on step 2 — like
      // every client emulated here, it never sends a conditional header on an overwrite; see the
      // "unconditional overwrite" invariant below).
      const zero = await req('PUT', '/dav/clients/explorer-doc.md', { headers: { ...auth, 'If-None-Match': '*' }, body: '' });
      record(c, 'zero-length PUT (Explorer two-step create, step 1)', [201, 204].includes(zero.status), `status=${zero.status}`);
      const filled = await req('PUT', '/dav/clients/explorer-doc.md', { headers: auth, body: '# Explorer content\n' });
      record(c, 'PUT with content (Explorer two-step create, step 2, unconditional)', filled.status === 204, `status=${filled.status}`);
      const desktopIni = await req('PUT', '/dav/clients/desktop.ini', { headers: auth, body: '[.ShellClassInfo]' });
      record(c, 'desktop.ini write (not .md, refused)', desktopIni.status === 415, `status=${desktopIni.status}`);
      const thumbsDb = await req('PUT', '/dav/clients/Thumbs.db', { headers: auth, body: 'THUMBS' });
      record(c, 'Thumbs.db write (not .md, refused)', thumbsDb.status === 415, `status=${thumbsDb.status}`);
      const move = await req('MOVE', '/dav/clients/explorer-doc.md', { headers: { ...auth, Destination: `${dav}/dav/clients/explorer-renamed.md` } });
      record(c, 'MOVE rename (no Overwrite header, defaults to T per RFC 4918)', move.status === 201, `status=${move.status}`);
      const del = await req('DELETE', '/dav/clients/explorer-renamed.md', { headers: auth });
      record(c, 'DELETE', del.status === 204, `status=${del.status}`);
      const head = await req('HEAD', '/dav/clients/notes.md', { headers: auth });
      record(c, 'HEAD', head.status === 200 && !!head.headers.get('etag'), `status=${head.status} etag=${head.headers.get('etag')}`);
    }

    // ══════════════════════════════════════════════════════════════════════════════════════════
    // iOS Files (WebDAV via Files app / Documents app)
    // ══════════════════════════════════════════════════════════════════════════════════════════
    {
      const c = 'iOS Files';
      const seedPut = await req('PUT', '/dav/clients/ios-note.md', { headers: { ...auth, 'If-None-Match': '*' }, body: '# From iOS\n' });
      record(c, 'PUT with If-None-Match: * for create', seedPut.status === 201, `status=${seedPut.status}`);
      const iosEtag = seedPut.headers.get('etag');
      // Brief: t is a Mini-Redirector/Microsoft-WebDAV-MiniRedir header (Explorer/WinSCP), not
      // documented for iOS Files; iOS's plain PROPFIND Depth: 1 is exercised here instead.
      const pf = await req('PROPFIND', '/dav/clients/', { headers: { ...auth, Depth: '1' } });
      record(c, 'PROPFIND Depth: 1 -> 207 with children', pf.status === 207 && /ios-note\.md/.test(pf.text), `status=${pf.status}`);
      const conditionalMatch = await req('GET', '/dav/clients/ios-note.md', { headers: { ...auth, 'If-None-Match': iosEtag } });
      record(c, 'conditional GET, If-None-Match matches -> 304', conditionalMatch.status === 304, `status=${conditionalMatch.status}`);
      const conditionalStale = await req('GET', '/dav/clients/ios-note.md', { headers: { ...auth, 'If-None-Match': '"stale-etag-0000000000000000000000000000000000000000000000000000000000000"' } });
      record(c, 'conditional GET, If-None-Match differs -> 200', conditionalStale.status === 200, `status=${conditionalStale.status}`);
      // Range GET: the endpoint has no Range/Accept-Ranges support (docs/dav.md's supported-method
      // list omits it); a compliant server ignores Range and returns the whole body with 200, which
      // is what iOS Files' Quick Look preview falls back to.
      const range = await req('GET', '/dav/clients/ios-note.md', { headers: { ...auth, Range: 'bytes=0-3' } });
      record(c, 'GET with Range header (ignored, full body via 200)', range.status === 200 && range.text === '# From iOS\n', `status=${range.status} Accept-Ranges=${range.headers.get('accept-ranges') || '(absent)'}`);
      const move = await req('MOVE', '/dav/clients/ios-note.md', { headers: { ...auth, Destination: `${dav}/dav/clients/ios-renamed.md` } });
      record(c, 'MOVE', move.status === 201, `status=${move.status}`);
      const del = await req('DELETE', '/dav/clients/ios-renamed.md', { headers: auth });
      record(c, 'DELETE', del.status === 204, `status=${del.status}`);
    }

    // ── Invariants asserted across every client above ────────────────────────────────────────
    {
      // Overwriting an existing file unconditionally (every emulated client above did this at
      // least once via its two-step or replace-in-place pattern) must preserve the prior bytes.
      const overwrite = await req('PUT', '/dav/clients/notes.md', { headers: auth, body: '# Notes, edited by a client\n' });
      record('shared', 'unconditional overwrite succeeds (Finder/Explorer/iOS never send If-Match)', overwrite.status === 204, `status=${overwrite.status}`, { invariant: true });
      const trash = await trashRecords();
      record('shared', 'replaced file preserved in Trash', trash.some(r => /^notes \(replaced .*\)\.md$/.test(r.path)), trash.map(r => r.path).join(', '), { invariant: true });
      const clobberIndex = await req('PUT', '/dav/clients/INDEX.md', { headers: auth, body: '# clobbered\n' });
      record('shared', '428 for unconditional write to protected INDEX.md', clobberIndex.status === 428, `status=${clobberIndex.status}`, { invariant: true });
      const deleteIndex = await req('DELETE', '/dav/clients/INDEX.md', { headers: auth });
      record('shared', 'DELETE of protected INDEX.md refused', deleteIndex.status === 403, `status=${deleteIndex.status}`, { invariant: true });
      const moveIndex = await req('MOVE', '/dav/clients/INDEX.md', { headers: { ...auth, Destination: `${dav}/dav/clients/moved-index.md` } });
      record('shared', 'MOVE of protected INDEX.md refused', moveIndex.status === 403, `status=${moveIndex.status}`, { invariant: true });
      const indexAfter = (await req('GET', '/dav/clients/INDEX.md', { headers: auth })).text;
      record('shared', 'protected INDEX.md byte-identical throughout every client emulation', indexBefore === indexAfter, '', { invariant: true });
      const anyPlainPut = await req('PUT', '/dav/clients/unconditional-plain.md', { headers: auth, body: 'x' });
      record('shared', 'unconditional create (no If-None-Match) still succeeds, no 428 outside protected paths', anyPlainPut.status === 201, `status=${anyPlainPut.status}`, { invariant: true });

      // End-to-end regression for the workspace_ops.py protected()/list_months() fix (see
      // corpus_store.py's month_name_pattern()): a real month filename (matching the default
      // "{year}-{month02}.md" template) must stay protected over DAV, exactly like INDEX.md above,
      // while an ordinary hyphenated ".md" name at the same path is never mistaken for one. The
      // file has to exist first: an unconditional PUT to a path with nothing there yet is a create,
      // which (like any other create) isn't a protected-path check at all — only a replace or a
      // delete is, so the month file is seeded with a create-only PUT before exercising either.
      const monthSeed = await req('PUT', '/dav/clients/2026-09.md', { headers: { ...auth, 'If-None-Match': '*' }, body: '# a real month file\n' });
      record('shared', 'seed a real month filename (2026-09.md)', monthSeed.status === 201, `status=${monthSeed.status}`, { invariant: true });
      const monthPut = await req('PUT', '/dav/clients/2026-09.md', { headers: auth, body: '# clobbered month file\n' });
      record('shared', '428 for unconditional write (replace) of a real month filename (2026-09.md)', monthPut.status === 428, `status=${monthPut.status}`, { invariant: true });
      const monthDelete = await req('DELETE', '/dav/clients/2026-09.md', { headers: auth });
      record('shared', 'DELETE of a real month filename (2026-09.md) refused', monthDelete.status === 403, `status=${monthDelete.status}`, { invariant: true });
      const ordinaryHyphenated = await req('PUT', '/dav/clients/ordinary-hyphenated.md', { headers: { ...auth, 'If-None-Match': '*' }, body: '# not a month file\n' });
      record('shared', 'ordinary hyphenated filename is not mistaken for a month file (create succeeds)', ordinaryHyphenated.status === 201, `status=${ordinaryHyphenated.status}`, { invariant: true });
      const ordinaryHyphenatedOverwrite = await req('PUT', '/dav/clients/ordinary-hyphenated.md', { headers: auth, body: '# replaced\n' });
      record('shared', 'ordinary hyphenated filename unconditional overwrite succeeds (not protected)', ordinaryHyphenatedOverwrite.status === 204, `status=${ordinaryHyphenatedOverwrite.status}`, { invariant: true });
      const ordinaryHyphenatedDelete = await req('DELETE', '/dav/clients/ordinary-hyphenated.md', { headers: auth });
      record('shared', 'ordinary hyphenated filename DELETE succeeds (not protected)', ordinaryHyphenatedDelete.status === 204, `status=${ordinaryHyphenatedDelete.status}`, { invariant: true });

      // A second unconditional overwrite, on a different file, so "every overwrite preserved in
      // Trash" is backed by more than a single sample.
      const overwrite2 = await req('PUT', '/dav/clients/unconditional-plain.md', { headers: auth, body: '# overwritten a second time\n' });
      record('shared', 'second unconditional overwrite succeeds', overwrite2.status === 204, `status=${overwrite2.status}`, { invariant: true });
      const trash2 = await trashRecords();
      record('shared', 'second overwrite also preserved in Trash', trash2.some(r => /^unconditional-plain \(replaced .*\)\.md$/.test(r.path)), trash2.map(r => r.path).join(', '), { invariant: true });
    }

    console.log('See apps/web/qa/dav-obsidian.cjs for Obsidian sync (Remotely Save) coverage; not duplicated here.');
  } finally {
    server.kill('SIGTERM'); companion.kill('SIGTERM');
    await Promise.all([once(server, 'exit'), once(companion, 'exit')]).catch(() => {});
    let client = null;
    for (const r of results) {
      if (r.client !== client) { client = r.client; console.log(`\n== ${client} ==`); }
      const tag = r.pass ? 'PASS' : 'FAIL';
      console.log(`${tag}  ${r.name}${r.detail ? '  — ' + r.detail : ''}`);
    }
    const violated = results.filter(r => r.invariant && !r.pass);
    const failed = results.filter(r => !r.invariant && !r.pass);
    if (violated.length || failed.length) {
      process.exitCode = 1;
      console.log(`\n${violated.length} invariant violation(s), ${failed.length} other failure(s). companion log: ${path.join(dir, 'companion.log')}`);
    } else {
      console.log(`\n${results.length} checks, 0 invariant violations. Client rows needing a real device stay blocked (see docs/dav.md).`);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
