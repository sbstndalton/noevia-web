'use strict';
// A stand-in for Google's device sign-in and the Drive v3 API, just enough of both for noevia's
// backend: device/code, token (device and refresh grants), revoke, files list/get/create/delete,
// and multipart upload. Approve a pending sign-in with POST /__approve (or ?deny=1).
// Used by server/gdrive.test.cjs, qa/wizard-backup.cjs and local test instances. Never real data.
const http = require('node:http');
const crypto = require('node:crypto');

function startFakeGoogle({ port = 0, autoApprove = false } = {}) {
  const files = new Map(); // id -> {id,name,parents,mimeType,body,trashed}
  const state = { device: null, approved: false, denied: false, refresh: new Set(), access: new Set(), revoked: [], uploads: 0, deletes: 0 };
  const id = () => crypto.randomBytes(8).toString('hex');
  const body = (req) => new Promise((r) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => r(Buffer.concat(c))); });
  const send = (res, status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const raw = await body(req);
    const form = Object.fromEntries(new URLSearchParams(raw.toString()));
    if (url.pathname === '/__approve') { if (url.searchParams.get('deny')) state.denied = true; else state.approved = true; return send(res, 200, {}); }
    if (url.pathname === '/device/code') {
      if (!/drive\.file/.test(form.scope)) return send(res, 400, { error: 'invalid_scope' });
      state.device = id(); state.approved = autoApprove; state.denied = false;
      return send(res, 200, { device_code: state.device, user_code: 'WDJB-MJHT', verification_url: 'https://www.google.com/device', expires_in: 1800, interval: 1 });
    }
    if (url.pathname === '/token') {
      if (form.grant_type === 'refresh_token') {
        if (!state.refresh.has(form.refresh_token)) return send(res, 400, { error: 'invalid_grant' });
        const a = id(); state.access.add(a); return send(res, 200, { access_token: a, expires_in: 3600 });
      }
      if (form.device_code !== state.device) return send(res, 400, { error: 'invalid_grant' });
      if (state.denied) return send(res, 403, { error: 'access_denied' });
      if (!state.approved) return send(res, 428, { error: 'authorization_pending' });
      const r = id(), a = id(); state.refresh.add(r); state.access.add(a); state.device = null;
      const idToken = `x.${Buffer.from(JSON.stringify({ email: 'backup-owner@example.com' })).toString('base64url')}.x`;
      return send(res, 200, { access_token: a, refresh_token: r, expires_in: 3600, id_token: idToken });
    }
    if (url.pathname === '/revoke') { state.refresh.delete(form.token); state.revoked.push(form.token); return send(res, 200, {}); }
    const auth = String(req.headers.authorization || '').replace(/^Bearer /, '');
    if (!state.access.has(auth)) return send(res, 401, { error: { code: 401 } });
    if (url.pathname === '/upload/files' && req.method === 'POST') {
      const boundary = /boundary=(.+)$/.exec(req.headers['content-type'])[1];
      const parts = raw.toString('latin1').split(`--${boundary}`);
      const meta = JSON.parse(parts[1].split('\r\n\r\n')[1]);
      const data = Buffer.from(parts[2].split('\r\n\r\n').slice(1).join('\r\n\r\n').replace(/\r\n$/, ''), 'latin1');
      const f = { id: id(), name: meta.name, parents: meta.parents, body: data, trashed: false };
      files.set(f.id, f); state.uploads++;
      return send(res, 200, { id: f.id });
    }
    if (url.pathname === '/drive/files' && req.method === 'POST') {
      const meta = JSON.parse(raw.toString()); const f = { id: id(), ...meta, parents: meta.parents || ['root'], trashed: false, body: Buffer.alloc(0) };
      files.set(f.id, f); return send(res, 200, { id: f.id });
    }
    if (url.pathname === '/drive/files' && req.method === 'GET') {
      const q = url.searchParams.get('q') || '';
      let list = [...files.values()].filter((f) => !f.trashed);
      const byName = /name='([^']+)'/.exec(q), inParent = /'([^']+)' in parents/.exec(q);
      if (byName) list = list.filter((f) => f.name === byName[1] && f.mimeType === 'application/vnd.google-apps.folder');
      if (inParent) list = list.filter((f) => f.parents?.includes(inParent[1]));
      return send(res, 200, { files: list.map((f) => ({ id: f.id, name: f.name, size: String(f.body.length) })) });
    }
    const one = /^\/drive\/files\/([^/]+)$/.exec(url.pathname);
    if (one) {
      const f = files.get(decodeURIComponent(one[1]));
      if (!f) return send(res, 404, { error: { code: 404 } });
      if (req.method === 'DELETE') { files.delete(f.id); state.deletes++; res.writeHead(204); return res.end(); }
      return send(res, 200, { id: f.id, trashed: f.trashed });
    }
    send(res, 404, { error: 'not found' });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => {
    const base = `http://127.0.0.1:${server.address().port}`;
    resolve({ base, env: { GOOGLE_OAUTH_CLIENT_ID: 'fake-client', GOOGLE_OAUTH_CLIENT_SECRET: 'fake-secret', GOOGLE_OAUTH_BASE_URL: base, GOOGLE_DRIVE_API_BASE_URL: `${base}/drive`, GOOGLE_DRIVE_UPLOAD_BASE_URL: `${base}/upload` },
      files, state, approve: () => { state.approved = true; }, deny: () => { state.denied = true; }, close: () => new Promise((r) => server.close(r)) });
  }));
}

module.exports = { startFakeGoogle };
if (require.main === module) {
  startFakeGoogle({ port: Number(process.env.FAKE_GOOGLE_PORT || 31401) }).then((g) => console.log(`fake Google on ${g.base}; approve with: curl -X POST ${g.base}/__approve`));
}
