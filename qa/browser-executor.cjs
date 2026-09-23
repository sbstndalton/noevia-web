// Opt-in, synthetic: the BrowserExecutor driving real Chromium (PLAYWRIGHT_MODULE, or `playwright`
// on the path), behind noevia's real egress proxy (code-egress.cjs) holding a grant for the task,
// against two local HTTP servers: `shop.example.test` (the task's only allowed host) and
// `evil.test` (everything else). The proxy's resolver and connector are pointed at loopback, so
// nothing leaves this machine. The evil server counts every hit, WebSocket upgrades included, so
// "never reached" is measured, not inferred.
// Proves: a submit disguised as "Show details" asks; Decline sends nothing; Allow sends the real
// secret to the right site while no result, card or log ever contains it; a secret bound to
// another site is refused; subresources, redirects and links to other hosts are blocked; only
// given files upload; downloads land in the task's directory; Enter in a form asks; a WebSocket
// to another host never connects.
const http = require('node:http'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { createBrowserExecutor } = require('../server/browser-executor.cjs');
const { createEgressProxy } = require('../server/code-egress.cjs');

const SECRET = 'hunter2-synthetic-9f31';
const page = (body) => `<!doctype html><html><head><title>Shop</title></head><body>${body}</body></html>`;
const FIXTURES = {
  '/': page(`
    <h1>Synthetic shop</h1>
    <img src="EVIL/pixel.png" alt="">
    <a id="next" href="/page2">Next page</a>
    <a id="offsite" href="EVIL/">Partner</a>
    <a id="redirect" href="/go">Go</a>
    <a id="report" href="/report.csv">Report</a>
    <form id="order" method="post" action="/order">
      <input id="user" name="user" type="text" aria-label="User">
      <input id="pass" name="pass" type="password" aria-label="Password">
      <input id="note" name="note" type="text" aria-label="Note">
      <button id="disguised" aria-label="Show details">Show details</button>
    </form>
    <form id="files" method="post" action="/upload" enctype="multipart/form-data">
      <input id="file" name="file" type="file">
    </form>`),
  '/page2': page('<h1>Page two</h1><p id="p">second page text</p>'),
  '/ws': page('<p id="w">socket</p><script>try { new WebSocket("EVIL_WS/socket"); } catch {}</script>'),
};

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'noevia-browser-qa-'));
  const downloadsDir = path.join(root, 'downloads');
  const given = path.join(root, 'given.txt'); fs.writeFileSync(given, 'a file the task was given\n');
  const other = path.join(root, 'other.txt'); fs.writeFileSync(other, 'not given\n');
  const posts = [], cards = [], logs = [], evilHits = [];
  let answers = [];
  const evil = http.createServer((req, res) => { evilHits.push(req.url); res.end('evil'); });
  evil.on('upgrade', (req, socket) => { evilHits.push('upgrade ' + req.url); socket.destroy(); });
  await new Promise((r) => evil.listen(0, '127.0.0.1', r));
  const EVIL = `http://evil.test:${evil.address().port}`;
  const shop = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'POST') {
      let body = ''; req.on('data', (d) => body += d);
      return req.on('end', () => { posts.push({ path: url.pathname, body }); res.writeHead(200, { 'content-type': 'text/html' }); res.end(page('<h1>Thanks</h1>')); });
    }
    if (url.pathname === '/go') { res.writeHead(302, { location: `${EVIL}/landing` }); return res.end(); }
    if (url.pathname === '/hop') { res.writeHead(302, { location: '/page2', 'set-cookie': 'hop=1; Path=/' }); return res.end(); }
    if (url.pathname === '/report.csv') { res.writeHead(200, { 'content-type': 'text/csv', 'content-disposition': 'attachment; filename="../../report.csv"' }); return res.end('a,b\n1,2\n'); }
    const body = FIXTURES[url.pathname];
    res.writeHead(body ? 200 : 404, { 'content-type': 'text/html' });
    res.end(body ? body.replace(/EVIL_WS/g, EVIL.replace('http', 'ws')).replace(/EVIL/g, EVIL) : '');
  });
  await new Promise((r) => shop.listen(0, '127.0.0.1', r));
  const SHOP = `http://shop.example.test:${shop.address().port}`;
  // The real proxy, with its resolver pointed at loopback: both names resolve to this machine,
  // loopback counts as public only because it stands in for the internet, and the two servers'
  // ports stand in for 80/443.
  const hosts = new Set(['shop.example.test', 'evil.test']);
  const proxyLog = [];
  const egress = createEgressProxy({ log: (e) => proxyLog.push(e),
    lookup: async (host) => (hosts.has(host) ? ['127.0.0.1'] : []), isPublicAddress: () => true,
    allowedPorts: [shop.address().port, evil.address().port] });
  await new Promise((r) => egress.server.listen(0, '127.0.0.1', r));
  const grant = egress.grant({ taskId: 'qa-job', domains: ['shop.example.test'] });
  const executor = createBrowserExecutor({
    launch: () => chromium.launch({ channel: process.env.QA_CHANNEL || undefined }),
    askApproval: async (card) => { cards.push(card); return answers.shift() || 'deny'; },
    secrets: { shop_password: { value: SECRET, domains: ['shop.example.test'] }, bank: { value: 'bank-synthetic-1', domains: ['bank.example.test'] } },
    log: (entry) => logs.push(entry),
    timeoutMs: 5000,
  });
  const checks = [];
  // Judged immediately: later actions reuse `r`.
  const check = (name, fn) => { try { fn(); checks.push([name, null]); } catch (error) { checks.push([name, error]); } };
  let refused = null;
  await executor.open({ jobId: 'qa-none', allowedDomains: ['shop.example.test'], downloadsDir }).catch((e) => { refused = e; });
  check('a session without an egress grant is refused', () => assert.equal(refused?.status, 409));
  const s = await executor.open({ jobId: 'qa-job', allowedDomains: ['shop.example.test'], downloadsDir, uploadFiles: [given],
    proxy: { server: `http://127.0.0.1:${egress.server.address().port}`, username: 'task', password: grant.token } });
  const act = (a) => executor.act(s, a);

  let r = await act({ type: 'navigate', url: SHOP + '/' });
  check('opens the allowed site', () => assert.equal(r.status, 'done') || assert.equal(r.origin, SHOP));
  check('a third-party subresource is blocked at the network layer', () => assert.ok(executor.state(s).blocked.some((b) => b.url.startsWith(EVIL + '/pixel.png'))));

  for (const url of [EVIL + '/', 'http://127.0.0.1:8080/', 'file:///etc/passwd', 'https://shop.example.test.evil.test/']) {
    const nav = await act({ type: 'navigate', url });
    check(`navigating to ${url} is blocked`, () => assert.equal(nav.status, 'blocked'));
  }

  // Typing is allowed and sends nothing; the secret resolves only on its own site.
  r = await act({ type: 'type', selector: '#user', text: 'qa-user' });
  check('typing into a field needs no approval', () => assert.equal(r.status, 'done'));
  r = await act({ type: 'type', selector: '#pass', text: '{{secret:shop_password}}' });
  check('a secret bound to this site is typed', () => assert.equal(r.status, 'done'));
  r = await act({ type: 'type', selector: '#note', text: 'pin {{secret:bank}}' });
  check("another site's secret is refused, not typed", () => assert.equal(r.status, 'blocked') || assert.match(r.reason, /not for shop\.example\.test/));

  // The model calls it "Show details"; it is a submit button in a POST form.
  answers = ['deny'];
  r = await act({ type: 'click', selector: '#disguised', text: 'just shows details' });
  check('a submit disguised as "Show details" asks', () => assert.equal(cards.at(-1).action, 'click') || assert.match(cards.at(-1).reason, /Submits a form/));
  check('the card carries the origin, the real element and a screenshot', () => {
    const c = cards.at(-1); assert.equal(c.origin, SHOP); assert.equal(c.element.tag, 'button'); assert.equal(c.element.formMethod, 'post'); assert.ok(c.screenshot && c.screenshot.length > 100);
  });
  check('Decline sends nothing', () => assert.equal(r.status, 'blocked') || assert.equal(posts.length, 0));

  answers = ['deny'];
  r = await act({ type: 'press', selector: '#user', key: 'Enter' });
  check('Enter in a form asks', () => assert.equal(r.status, 'blocked') || assert.match(cards.at(-1).reason, /Enter submits/));
  check('...and declined Enter sends nothing', () => assert.equal(posts.length, 0));

  answers = ['approve'];
  r = await act({ type: 'click', selector: '#disguised' });
  check('Allow once submits, with the real secret, to the right site', () => {
    assert.equal(r.status, 'done'); assert.equal(posts.length, 1); assert.equal(posts[0].path, '/order');
    assert.ok(posts[0].body.includes(`pass=${SECRET}`));
  });

  r = await act({ type: 'navigate', url: SHOP + '/' });
  r = await act({ type: 'click', selector: '#offsite' });
  check('a link to another host is blocked, and the page stays on the shop', () => { assert.equal(r.status, 'blocked'); assert.equal(r.origin, SHOP); assert.ok(executor.state(s).blocked.some((b) => b.url.startsWith(EVIL + '/'))); });
  r = await act({ type: 'click', selector: '#redirect' });
  check('a redirect to another host is blocked', () => { assert.equal(r.status, 'blocked'); assert.equal(r.origin, SHOP); assert.ok(executor.state(s).blocked.some((b) => b.url.startsWith(EVIL + '/landing'))); });

  r = await act({ type: 'navigate', url: SHOP + '/hop' });
  const hop = r;
  check('a redirect within the site is followed to its target', () => { assert.equal(hop.status, 'done'); assert.equal(hop.origin, SHOP); });
  r = await act({ type: 'extract', selector: '#p' });
  check('...and the target page is the one shown', () => assert.equal(r.evidence.text, 'second page text'));

  r = await act({ type: 'navigate', url: SHOP + '/ws' });
  await new Promise((res) => setTimeout(res, 500));
  check('a WebSocket to another host never connects', () => assert.ok(executor.state(s).blocked.some((b) => b.url.includes('/socket'))));

  r = await act({ type: 'navigate', url: SHOP + '/' });
  r = await act({ type: 'upload', selector: '#file', file: other });
  check('a file the task was not given cannot be uploaded', () => assert.equal(r.status, 'blocked'));
  answers = ['approve'];
  const before = cards.length;
  r = await act({ type: 'upload', selector: '#file', file: given });
  check('a given file uploads only after asking', () => assert.equal(r.status, 'done') || assert.equal(cards.length, before + 1) || assert.equal(cards.at(-1).file, 'given.txt'));

  r = await act({ type: 'click', selector: '#report' });
  await new Promise((res) => setTimeout(res, 1000));
  check("a download lands in the task's directory, whatever name the site asks for", () => {
    const { downloads } = executor.state(s); assert.equal(downloads.length, 1);
    // The site asked for "../../report.csv"; it lands inside the task's directory regardless.
    assert.equal(path.dirname(downloads[0].path), downloadsDir); assert.match(downloads[0].name, /report\.csv$/); assert.ok(!downloads[0].name.includes('/'));
    assert.equal(fs.readFileSync(downloads[0].path, 'utf8'), 'a,b\n1,2\n');
  });

  r = await act({ type: 'navigate', url: SHOP + '/page2' });
  r = await act({ type: 'extract', selector: '#p' });
  check('extract returns page text', () => assert.equal(r.evidence.text, 'second page text'));
  r = await act({ type: 'teleport' });
  check('an unknown action is blocked', () => assert.equal(r.status, 'blocked'));

  check('the secret appears in no result, card or log', () => {
    const everything = JSON.stringify({ cards: cards.map(({ screenshot, ...c }) => c), logs, state: executor.state(s) });
    assert.ok(!everything.includes(SECRET)); assert.ok(!everything.includes('bank-synthetic-1'));
  });

  check('the refused host was never reached, by anything', () => assert.deepEqual(evilHits, []));
  check('the proxy refused the redirect hop the browser followed unrouted', () => assert.ok(proxyLog.some((e) => JSON.stringify(e).includes('evil.test'))));

  await executor.close(s);
  r = await act({ type: 'screenshot' });
  check('a closed session does nothing', () => assert.equal(r.status, 'blocked'));
  await executor.shutdown();

  // Control: the same redirect without the proxy. This is why a session needs a grant.
  const hitsBefore = evilHits.length;
  const bare = createBrowserExecutor({ launch: () => chromium.launch({ channel: process.env.QA_CHANNEL || undefined,
      args: ['--host-resolver-rules=MAP shop.example.test 127.0.0.1, MAP evil.test 127.0.0.1, MAP * ~NOTFOUND'] }),
    askApproval: async () => 'deny', direct: true, timeoutMs: 5000 });
  const d = await bare.open({ jobId: 'qa-direct', allowedDomains: ['shop.example.test'], downloadsDir: path.join(root, 'direct') });
  await bare.act(d, { type: 'navigate', url: SHOP + '/' });
  const direct = await bare.act(d, { type: 'click', selector: '#redirect' });
  await bare.shutdown();
  check('control: without the proxy the redirect reaches the refused host, and is still reported blocked', () => {
    assert.ok(evilHits.length > hitsBefore); assert.equal(direct.status, 'blocked');
  });

  let failed = 0;
  for (const [name, error] of checks) {
    if (!error) console.log('ok  ', name); else { failed++; console.log('FAIL', name, '—', error.message.split('\n')[0]); }
  }
  fs.rmSync(root, { recursive: true, force: true });
  shop.close(); evil.close(); egress.server.close();
  console.log(failed ? `FAIL ${failed} of ${checks.length}` : `PASS browser executor: ${checks.length} checks against real Chromium, loopback only`);
  process.exit(failed ? 1 : 0);
}
main().catch((error) => { console.error('FAIL', error); process.exit(1); });
