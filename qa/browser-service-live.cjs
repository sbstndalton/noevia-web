// #280 follow-up: the browser executor exercised end to end through the real service and HTTP
// routes (server/browser-service.cjs, server/routes/browser.cjs), not just directly against
// browser-executor.cjs the way qa/browser-executor.cjs does.
//
// Route factories in this codebase are built to be driven with fakes for their collaborators
// (docs/agent-brief.md: "both are factories that take their collaborators as parameters, so
// their tests build them with fakes and never boot the server"). This script follows that
// pattern one level up: it mounts the real, unmodified createBrowserRoutes over a real
// createBrowserService, a real createBrowserExecutor and a real createJobs store (so the on-disk
// job journal is the genuine article), behind a minimal HTTP server with a fake session layer
// (two synthetic users, admin and member — no cookies/CSRF, which live in index.cjs and are
// already covered by qa/diary-append-http.cjs's pattern). `launch` calls
// `require('playwright').chromium.launch({ headless: true })` exactly as server/index.cjs's real
// browser-service wiring does.
//
// One thing this harness cannot exercise: the real egress proxy (server/code-egress.cjs), which
// production always puts in front of a browser task. Its SSRF guard correctly refuses loopback
// destinations by design (see server/ssrf.cjs isPrivateIp) — there is no env-controlled bypass
// for it, and adding one was tried and is deliberately not present here (it would weaken a
// security boundary for a QA convenience). Testing this task type against a synthetic, local-only
// fixture and testing it behind the real anti-SSRF egress proxy are mutually exclusive without a
// genuinely public target, which this sandbox is not allowed to use. `browser-service.cjs`'s own
// `direct: true` escape hatch — a real, first-class constructor option, not something invented for
// this script — is used instead, exactly the way qa/browser-executor.cjs's own "control" case at
// its end uses it. `browser-policy.cjs`'s own allow/needs_approval/blocked rules (private IPs,
// localhost, unlisted hosts) still run unmodified; only the network-layer SSRF proxy is out of
// scope for this run, and that gap is called out again in the results at the bottom.
//
// Synthetic fixture page only, served by a local HTTP server this script starts and closes.
// Never a real network target.
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http'), crypto = require('node:crypto');
const web = path.resolve(__dirname, '..');

const { createBrowserService } = require(path.join(web, 'server/browser-service.cjs'));
const { createBrowserRoutes } = require(path.join(web, 'server/routes/browser.cjs'));

// ── a local fixture "site" the browser task is allowed to reach ──────────────────────────────
function fixtureSite() {
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end(`<!doctype html><title>Fixture</title><body>
        <h1>Fixture shop</h1>
        <p id="note">hello from the fixture</p>
        <form method="post" action="/order"><button id="buy" aria-label="Buy now">Buy now</button></form>
      </body>`);
    }
    if (url.pathname === '/order' && req.method === 'POST') {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end('<title>Thanks</title><body>Thanks</body>');
    }
    if (url.pathname === '/blocked-target') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<title>should never be reached</title>'); }
    res.writeHead(404); res.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, { tries = 100, delay = 100 } = {}) {
  for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(delay); }
  throw Error('timed out waiting for condition');
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'noevia-browser-live-'));
  const site = fixtureSite();
  await new Promise((r) => site.listen(0, '127.0.0.1', r));
  // localtest.me is a public DNS name that resolves to 127.0.0.1: a genuinely public hostname
  // (checkNavigation only inspects the hostname and its resolved-when-literal IP form; it does
  // not itself do a DNS lookup) that still lands the browser on this script's local fixture.
  const SITE = `http://fixture.localtest.me:${site.address().port}`;
  const OTHER_HOST = `http://other.localtest.me:${site.address().port}`; // allowed-list mismatch target

  const projects = new Map([['proj-1', { id: 'proj-1', name: 'Browser QA project' }]]);
  const workspaceDir = path.join(dir, 'workspace');
  fs.mkdirSync(workspaceDir, { recursive: true });
  // The service keys its per-tenant job store on workspace object identity (a WeakMap): the
  // caller must hand back the *same* object every time, exactly as index.cjs's currentWorkspace()
  // does, or every call looks like a fresh tenant whose prior job was abandoned mid-run.
  const workspaceObj = { dir: workspaceDir };
  const workspace = () => workspaceObj;
  const getProject = (id) => projects.get(id) || null;
  const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  const readJson = (req) => new Promise((resolve, reject) => {
    let raw = ''; req.on('data', (c) => raw += c);
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { reject(Object.assign(new SyntaxError('bad json'), e)); } });
  });
  const features = { enabled: (name) => name === 'browserExecutor' };

  const pwModule = process.env.PLAYWRIGHT_MODULE;
  if (!pwModule) throw Error('Set PLAYWRIGHT_MODULE to a Playwright (or playwright-core) install for this live QA run.');
  const launch = async () => {
    // Exactly server/index.cjs's browser-service wiring: `require('playwright').chromium.launch(...)`.
    // This sandbox ships playwright-core, not the `playwright` package by that exact name, so
    // PLAYWRIGHT_MODULE substitutes the equivalent installed package — the launch call and every
    // line downstream of it in browser-executor.cjs is untouched production code.
    const pw = require(pwModule);
    return pw.chromium.launch({ headless: true, channel: process.env.QA_CHANNEL || undefined });
  };

  const service = createBrowserService({ launch, egress: null, direct: true, log: () => {} });
  const browserRoutes = createBrowserRoutes({ service, features, getProject, workspace, json, readJson });

  const USERS = { admin: { id: 'u-admin', role: 'admin' }, member: { id: 'u-member', role: 'member' } };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const who = req.headers['x-qa-user'] === 'member' ? USERS.member : req.headers['x-qa-user'] === 'none' ? null : USERS.admin;
    const authn = who ? { user: who } : null;
    try {
      const handled = await browserRoutes(req, res, { path: url.pathname, authn });
      if (!handled) { res.writeHead(404); res.end(); }
    } catch (e) { json(res, 500, { error: String(e?.message || e) }); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;

  const call = (who, p, { method = 'GET', body } = {}) => fetch(origin + p, {
    method, headers: { 'content-type': 'application/json', 'x-qa-user': who }, body: body === undefined ? undefined : JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

  const checks = [];
  const check = (name, fn) => { try { fn(); checks.push([name, null]); } catch (e) { checks.push([name, e]); } };
  const gaps = [
    'the real egress proxy (server/code-egress.cjs) is not in this run\'s path (direct:true is used instead); ' +
    'its own SSRF guard correctly refuses loopback destinations by design, and a live test against a ' +
    'local-only fixture through that guard is not possible without a genuinely public target. The ' +
    'proxy layer itself has its own dedicated real-Chromium coverage in qa/browser-executor.cjs, ' +
    'and unit coverage in server/code-egress.test.cjs.',
    'the approval timeout (5 min) and idle timeout (10 min) were not exercised live — waiting that ' +
    'long in a QA run is impractical. Both are covered with a fake clock in server/browser-service.test.cjs.',
  ];

  try {
    const projectId = 'proj-1';
    const browserBase = `/api/projects/${projectId}/browser`;

    // ── feature gate ───────────────────────────────────────────────────────────────────────
    const off = { enabled: () => false };
    const routesOff = createBrowserRoutes({ service, features: off, getProject, workspace, json, readJson });
    const serverOff = http.createServer((req, res) => { const url = new URL(req.url, 'http://x'); routesOff(req, res, { path: url.pathname, authn: { user: USERS.admin } }).then((h) => { if (!h) { res.writeHead(404); res.end(); } }); });
    await new Promise((r) => serverOff.listen(0, '127.0.0.1', r));
    const offOrigin = `http://127.0.0.1:${serverOff.address().port}`;
    const offResp = await fetch(offOrigin + browserBase);
    check('browser mode is 404 when features.browserExecutor is off', () => assert.equal(offResp.status, 404));
    serverOff.close();

    // ── capabilities probe ───────────────────────────────────────────────────────────────────
    const probe = await call('admin', browserBase);
    check('GET /browser reports capabilities', () => { assert.equal(probe.status, 200); assert.ok(Array.isArray(probe.body.capabilities)); });
    const memberProbe = await call('member', browserBase);
    check('a non-admin cannot even see the capabilities probe', () => assert.equal(memberProbe.status, 403));

    // ── starting a task needs at least one domain ───────────────────────────────────────────
    const noDomains = await call('admin', browserBase, { method: 'POST', body: { domains: [] } });
    check('starting without a domain is refused', () => assert.equal(noDomains.status, 400));

    // ── the real task, against the local fixture ────────────────────────────────────────────
    const domain = new URL(SITE).hostname;
    const start = await call('admin', browserBase, { method: 'POST', body: { domains: [domain] } });
    check('a browser task starts against the fixture site', () => { assert.equal(start.status, 202); assert.ok(start.body.taskId); });
    if (start.status !== 202) {
      gaps.push(`could not start a browser task: ${JSON.stringify(start.body)}`);
    } else {
      const taskId = start.body.taskId;
      const actBase = `${browserBase}/${taskId}/act`;

      // Read-only actions: allowed without any card.
      const nav = await call('admin', actBase, { method: 'POST', body: { type: 'navigate', url: SITE + '/' } });
      check('navigating to the allowed fixture site succeeds without approval', () => assert.equal(nav.body.status, 'done'));
      const extract = await call('admin', actBase, { method: 'POST', body: { type: 'extract', selector: '#note' } });
      check('a read-only extract runs immediately and returns the page text', () => { assert.equal(extract.body.status, 'done'); assert.equal(extract.body.evidence.text, 'hello from the fixture'); });

      // ── policy gate: a host outside the task's domain allowlist is blocked, never reached ──
      const offAllowlist = await call('admin', actBase, { method: 'POST', body: { type: 'navigate', url: OTHER_HOST + '/blocked-target' } });
      check('navigating to a host outside this task\'s allowed domains is blocked', () => assert.equal(offAllowlist.body.status, 'blocked'));
      const localBlocked = await call('admin', actBase, { method: 'POST', body: { type: 'navigate', url: 'http://localhost/should-not-load' } });
      check('navigating to localhost is blocked regardless of the allowlist', () => assert.equal(localBlocked.body.status, 'blocked'));

      await call('admin', actBase, { method: 'POST', body: { type: 'navigate', url: SITE + '/' } });

      // ── consequential action: must raise a card, never auto-approve ────────────────────────
      const clickPromise = call('admin', actBase, { method: 'POST', body: { type: 'click', selector: '#buy' } });
      clickPromise.then((r) => { if (process.env.QA_DEBUG) console.error('DEBUG click settled', JSON.stringify(r)); });
      const pendingTask = await waitFor(async () => {
        const g = await call('admin', `${browserBase}/${taskId}`);
        if (process.env.QA_DEBUG) console.error('DEBUG poll1', JSON.stringify(g));
        return g.body?.status === 'waiting_approval' && g.body.approval ? g.body : null;
      });
      check('a consequential action (a form submit) is never auto-approved: it raises a card and the task waits', () => {
        assert.equal(pendingTask.status, 'waiting_approval'); assert.ok(pendingTask.approval); assert.equal(pendingTask.approval.action, 'click');
      });

      // ── journal: approval.requested is on the job's own event log ─────────────────────────
      const journalPath = path.join(workspaceDir, 'jobs', `${taskId}.jsonl`);
      const journalLines = () => fs.existsSync(journalPath) ? fs.readFileSync(journalPath, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
      check('the job journal records approval.requested', () => assert.ok(journalLines().some((e) => e.type === 'approval.requested')));

      // Deny it: the click reports blocked, nothing submitted, journal records the decision.
      const deny = await call('admin', `${browserBase}/${taskId}/approve`, { method: 'POST', body: { decision: 'deny', approvalId: pendingTask.approval.id } });
      check('deny is accepted', () => assert.equal(deny.status, 200));
      const clickResultDenied = await clickPromise;
      check('a denied action reports blocked', () => assert.equal(clickResultDenied.body.status, 'blocked'));
      check('the job journal records approval.decided: deny', () => assert.ok(journalLines().some((e) => e.type === 'approval.decided' && e.data?.decision === 'deny')));

      // ── ask again, this time approve ────────────────────────────────────────────────────────
      const clickPromise2 = call('admin', actBase, { method: 'POST', body: { type: 'click', selector: '#buy' } });
      const pendingTask2 = await waitFor(async () => {
        const g = await call('admin', `${browserBase}/${taskId}`);
        return g.body?.status === 'waiting_approval' && g.body.approval ? g.body : null;
      });
      const approve = await call('admin', `${browserBase}/${taskId}/approve`, { method: 'POST', body: { decision: 'approve', approvalId: pendingTask2.approval.id } });
      check('approve is accepted', () => assert.equal(approve.status, 200));
      const clickResultApproved = await clickPromise2;
      check('an approved action completes', () => assert.equal(clickResultApproved.body.status, 'done'));
      check('the job journal records approval.decided: approve', () => assert.ok(journalLines().some((e) => e.type === 'approval.decided' && e.data?.decision === 'approve')));

      // ── a second, non-admin user cannot see or act on this admin's job ──────────────────────
      const memberGet = await call('member', `${browserBase}/${taskId}`);
      check('a second, non-admin user cannot see the job', () => assert.equal(memberGet.status, 403));
      const memberAct = await call('member', actBase, { method: 'POST', body: { type: 'extract', selector: '#note' } });
      check('...and cannot act on it either', () => assert.equal(memberAct.status, 403));
      const memberCancel = await call('member', `${browserBase}/${taskId}/cancel`, { method: 'POST' });
      check('...and cannot cancel it either', () => assert.equal(memberCancel.status, 403));

      // ── cancel, by the owner ────────────────────────────────────────────────────────────────
      const cancel = await call('admin', `${browserBase}/${taskId}/cancel`, { method: 'POST' });
      if (process.env.QA_DEBUG) console.error('DEBUG cancel', JSON.stringify(cancel));
      check('cancel ends the task', () => assert.equal(cancel.status, 200));
      await waitFor(async () => {
        const g = await call('admin', `${browserBase}/${taskId}`);
        if (process.env.QA_DEBUG) console.error('DEBUG post-cancel poll', JSON.stringify(g));
        return g.body?.status !== 'running';
      }, { tries: 30, delay: 100 });
      const afterCancel = await call('admin', actBase, { method: 'POST', body: { type: 'extract', selector: '#note' } });
      check('acting on a cancelled task is refused', () => assert.equal(afterCancel.status, 409));
    }
  } finally {
    site.close();
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }

  let failed = 0;
  for (const [name, error] of checks) {
    if (!error) console.log('ok  ', name); else { failed++; console.log('FAIL', name, '—', error.message); }
  }
  for (const gap of gaps) console.log('GAP ', gap);
  console.log(failed ? `FAIL ${failed} of ${checks.length}` : `PASS browser-service-live: ${checks.length} checks through the real service and routes, real Chromium, loopback fixture only.`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
