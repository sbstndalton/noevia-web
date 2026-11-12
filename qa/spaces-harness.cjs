'use strict';
// Shared by the Spaces QA scripts (sbstndalton/noevia#2446). Offline and synthetic: the diary fixture serves the built
// app (QA_DIST) and answers the shell's own calls; spaces-mock below answers /api/spaces/** from memory with the
// revision rule of the design note (version = sha256 of the content, a stale write is a 409 carrying the current one).
//   PLAYWRIGHT_MODULE=<playwright-core> QA_CHROME_PATH=<Chrome> QA_DIST=<dist dir> QA_CORE_SERVER=<noevia-core/server> \
//   [QA_SHOTS=<dir>] node qa/<script>.cjs
// The fixture takes its list of client paths from noevia-core; /spaces and /coworkers are not in it yet (the native front
// needs the same entries, see the PR), so they are added here and nowhere else.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const realCore = path.resolve(process.env.QA_CORE_SERVER || path.join(__dirname, '../../noevia-core/server'));
const shim = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-spaces-core-'));
fs.writeFileSync(path.join(shim, 'spa-routes.cjs'), `'use strict';
const real = require(${JSON.stringify(path.join(realCore, 'spa-routes.cjs'))});
const AREA = /^\\/(spaces|coworkers)(\\/[A-Za-z0-9_-]{1,120}){0,2}\\/?$/;
module.exports = { ...real, isClientRoute: (p) => real.isClientRoute(p) || AREA.test(p) };
`);
process.env.QA_CORE_SERVER = shim;
process.on('exit', () => { try { fs.rmSync(shim, { recursive: true, force: true }); } catch { /* temp dir */ } });

const base = require('./ui-batch-harness.cjs');

// QA_WIDTHS=375,768 limits a run to those widths (a full sweep is long; the three widths can run side by side).
const WIDTHS = (process.env.QA_WIDTHS || '').split(',').filter(Boolean).map(Number);
const VIEWS = [[375, 812, 'light'], [375, 812, 'dark'], [768, 900, 'light'], [768, 900, 'dark'], [1280, 900, 'light'], [1280, 900, 'dark']].filter(([w]) => !WIDTHS.length || WIDTHS.includes(w));
const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');

/** An in-memory Spaces server. `capability`: 'on' answers the routes, 'absent' answers 404, 'broken' answers 500. */
function createSpacesServer({ capability = 'on' } = {}) {
  const st = {
    revision: 1, spaces: [], pages: new Map(), calls: [], capability,
    listDelay: 0, forceSaveFailure: false, forceTruncated: false, hangSave: false, pageLimit: false,
    next: 1,
  };
  const id = (p) => `${p}-0000-4000-8000-${String(st.next++).padStart(12, '0')}`;
  const now = () => Date.now();
  st.addSpace = (name) => { const s = { id: id('5a5a5a5a'), name, createdAt: now(), updatedAt: now() }; st.spaces.push(s); st.pages.set(s.id, []); st.revision++; return s; };
  st.addPage = (spaceId, title, content, savedBy = 'you') => {
    const p = { id: id('9e9e9e9e'), title, content, version: sha(content), createdAt: now(), updatedAt: now(), savedBy };
    st.pages.get(spaceId).push(p); return p;
  };
  st.pageRow = (p) => ({ id: p.id, title: p.title, version: p.version, bytes: Buffer.byteLength(p.content), createdAt: p.createdAt, updatedAt: p.updatedAt, savedBy: p.savedBy });
  /** Another tab or a coworker changes the page behind the editor's back. */
  st.changeElsewhere = (spaceId, pageId, content) => { const p = st.pages.get(spaceId).find((x) => x.id === pageId); p.content = content; p.version = sha(content); p.updatedAt = now(); return p; };

  st.handle = async (route) => {
    const req = route.request(), url = new URL(req.url()), method = req.method();
    const parts = url.pathname.replace(/^\/api\/spaces\/?/, '').split('/').filter(Boolean);
    const json = (body, status = 200) => route.fulfill({ status, json: body });
    const body = method === 'GET' ? null : (() => { try { return JSON.parse(req.postData() || 'null'); } catch { return null; } })();
    st.calls.push({ method, path: url.pathname + url.search, body });
    if (st.capability === 'absent') return json({ error: 'Not found' }, 404);
    if (st.capability === 'broken') return json({ error: 'boom' }, 500);
    const [sid, kind, pid] = parts;
    if (!sid) {
      if (method === 'GET') { if (st.listDelay) await new Promise((r) => setTimeout(r, st.listDelay)); return json({ revision: st.revision, spaces: st.spaces }); }
      if (method === 'POST') { if (!body?.name || [...body.name].length > 80) return json({ error: 'Bad name', code: 'invalid_request' }, 400); const made = st.addSpace(body.name); return json({ revision: st.revision, space: made }, 201); }
    }
    const space = st.spaces.find((s) => s.id === sid);
    if (!space) return json({ error: 'Not found', code: 'not_found' }, 404);
    if (!kind) {
      if (method === 'GET') return json({ revision: st.revision, space });
      if (method === 'PATCH') {
        if (body.revision !== st.revision) return json({ error: 'Changed elsewhere', code: 'stale_revision', revision: st.revision }, 409);
        space.name = body.name; space.updatedAt = now(); st.revision++; return json({ revision: st.revision, space });
      }
      if (method === 'DELETE') {
        if (body?.revision !== st.revision) return json({ error: 'Changed elsewhere', code: 'stale_revision', revision: st.revision }, 409);
        if (st.pages.get(sid).length && !body.withPages) return json({ error: 'Space is not empty', code: 'space_not_empty' }, 409);
        st.spaces = st.spaces.filter((s) => s.id !== sid); st.pages.delete(sid); st.revision++; return json({ ok: true, revision: st.revision });
      }
    }
    if (kind !== 'pages') return json({ error: 'Not found', code: 'not_found' }, 404);
    const pages = st.pages.get(sid);
    if (!pid) {
      if (method === 'GET') {
        const q = (url.searchParams.get('q') || '').toLowerCase(), limit = Number(url.searchParams.get('limit') || 100);
        if ([...q].length > 200) return json({ error: 'Search for at most 200 characters.', code: 'invalid_request' }, 400);
        const hits = pages.filter((p) => !q || `${p.title}\n${p.content}`.toLowerCase().includes(q)).sort((a, b) => b.updatedAt - a.updatedAt);
        const cut = st.forceTruncated && q ? Math.max(1, hits.length - 1) : limit;
        return json({ pages: hits.slice(0, cut).map(st.pageRow), truncated: hits.length > cut, total: pages.length });
      }
      if (method === 'POST') {
        if (st.pageLimit) return json({ error: 'Space is full', code: 'page_limit' }, 409);
        return json({ page: st.pageRow(st.addPage(sid, body.title, body.content ?? '')) }, 201);
      }
    }
    const page = pages.find((p) => p.id === pid);
    if (!page) return json({ error: 'Not found', code: 'not_found' }, 404);
    if (method === 'GET') return json({ page: st.pageRow(page), content: page.content });
    if (method === 'PUT') {
      if (st.hangSave) return new Promise(() => undefined);
      if (st.forceSaveFailure) return json({ error: 'Storage unavailable' }, 503);
      if (body.version !== page.version) return json({ error: 'Page changed', code: 'stale_revision', version: page.version }, 409);
      if (Buffer.byteLength(body.content) > 512 * 1024) return json({ error: 'Too large', code: 'page_too_large' }, 413);
      page.title = body.title ?? page.title; page.content = body.content; page.version = sha(body.content); page.updatedAt = now();
      return json({ page: st.pageRow(page), changed: true });
    }
    if (method === 'DELETE') { st.pages.set(sid, pages.filter((p) => p.id !== pid)); return json({ ok: true }); }
    return json({ error: 'Not found' }, 404);
  };
  return st;
}

/** Mounts the mock on a page. Everything else under /api/ falls through to the fixture. */
async function mountSpaces(page, server) {
  await page.route('**/api/spaces**', (route) => server.handle(route));
}

/** Opens `route` (a path) in a signed-in shell and waits until the chat shell has painted. */
async function open(page, origin, route = '/') {
  await page.goto(origin + route);
  await page.getByRole('button', { name: 'Send', exact: true }).waitFor({ timeout: 20000 }).catch(() => undefined);
}

/** The phone shows the sidebar as a drawer. */
async function openNav(page) {
  const toggle = page.getByRole('button', { name: 'Open navigation', exact: true });
  if (await toggle.isVisible().catch(() => false)) await toggle.click();
}

module.exports = { ...base, VIEWS, createSpacesServer, mountSpaces, open, openNav, sha };
