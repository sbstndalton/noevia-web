// #1643: two tabs of one browser share the session cookie but not their in-memory state. Signing
// out and in as another user in tab 2 used to leave tab 1 showing the first account's open chat and
// unsent draft, with every request it made going out under the second account's cookie.
//
// Synthetic only: a static server for a built app and page.route mocks for every API. One browser
// context = one cookie jar and one localStorage, shared by both pages; `state.user` is whoever the
// session cookie names.
//   1. Tab 1 is signed in as A and has an unsent draft typed. Tab 2 logs A out and signs B in.
//      Tab 1 must reload into B's app: A's name and draft are gone from the page and from storage,
//      and no request made by tab 1 after the switch carries A's draft.
//   2. Tab 2 only logs A out. Tab 1 must land on the sign-in screen, not stay in A's chat.
//   3. Tab 1 is hidden with the storage event unusable (a marker that cannot be stored): when it is
//      looked at again it asks the server and reloads into B.
//
//   npm run build
//   [QA_DIST=/path/to/dist] PLAYWRIGHT_MODULE=/path/to/playwright-core \
//     [QA_CHROME_PATH=/path/to/chrome] node qa/cross-tab-account-1643.cjs
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const port = 31643;
const dist = path.resolve(process.env.QA_DIST || path.join(__dirname, '../dist'));
const DRAFT = 'SYNTHETIC-1643 unsent text typed under account A';
const users = {
  a: { id: 'qa-user-a', username: 'synthetic-a', displayName: 'Synthetic Account A', role: 'member', disabled: false, diaryEnabled: false, onboarded: true },
  b: { id: 'qa-user-b', username: 'synthetic-b', displayName: 'Synthetic Account B', role: 'member', disabled: false, diaryEnabled: false, onboarded: true },
};

function staticServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let file = path.join(dist, url.pathname === '/' ? 'index.html' : url.pathname);
    if (!file.startsWith(dist + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dist, 'index.html');
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.json') ? 'application/json' : file.endsWith('.svg') ? 'image/svg+xml' : 'text/html');
    fs.createReadStream(file).pipe(res);
  });
  return { listen: () => new Promise((r) => server.listen(port, '127.0.0.1', r)), close: () => new Promise((r) => server.close(r)) };
}

async function install(context, state) {
  await context.route('**/api/**', async (route) => {
    const req = route.request(), p = new URL(req.url()).pathname, method = req.method();
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (p === '/api/setup/status') return json({ configured: true, publicOrigin: `http://localhost:${port}` });
    if (p === '/api/auth/session' || p === '/api/profile') return state.user ? json({ user: state.user, passkeys: [] }) : json({ error: 'Not signed in' }, 401);
    if (p === '/api/auth/logout' && method === 'POST') { state.user = null; return json({ ok: true }); }
    if (p === '/api/auth/login/password' && method === 'POST') {
      if (req.postDataJSON().password === 'wrong-password') return json({ error: 'Invalid username or password' }, 401);
      state.user = req.postDataJSON().username === users.b.username ? users.b : users.a;
      return json({ user: state.user });
    }
    if (!state.user) return json({ error: 'Not signed in' }, 401);
    if (p === '/api/features') return json({ flags: { previews: false } });
    if (p === '/api/workspace') return json({ projects: [], freeChats: [] });
    if (p === '/api/health') return json({ inferenceUp: true, diaryUp: null });
    if (p === '/api/providers') return json({ providers: [] });
    if (p === '/api/toolboxes') return json({ toolboxes: [], mcp: { enabled: false } });
    if (p === '/api/freechats') return json(method === 'GET' ? { chats: [] } : { ok: true });
    if (p === '/api/account/preferences') return json({ notifications: { replyFinished: true, approvalNeeded: true }, sendKey: 'enter', locale: 'system' });
    if (p === '/api/account/instructions') return json({ text: '', style: 'default', advanced: {}, language: '', maxChars: 4000 });
    return json({ error: 'not in this synthetic fixture' }, 404);
  });
}

(async () => {
  const server = staticServer(); await server.listen();
  const browser = await chromium.launch({ headless: true, ...(process.env.QA_CHROME_PATH ? { executablePath: process.env.QA_CHROME_PATH } : { channel: process.env.QA_CHANNEL || 'chrome' }) });
  const failures = [], errors = [];
  const check = async (name, fn) => {
    try { await fn(); console.log(`ok   ${name}`); } catch (e) { failures.push(name); console.log(`FAIL ${name}\n     ${String(e.message).split('\n').slice(0, 6).join('\n     ')}`); }
  };
  const box = (page) => page.getByRole('textbox', { name: 'Message', exact: true });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  // Tab 1 signed in as A with an unsent draft; tab 2 open in the same browser.
  const open = async (init) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 820 }, reducedMotion: 'reduce' });
    if (init) await context.addInitScript(init);
    const state = { user: users.a };
    await install(context, state);
    const tab1 = await context.newPage();
    tab1.on('pageerror', (e) => errors.push(e.message));
    const sent = [];
    tab1.on('request', (r) => { if (/\/api\//.test(r.url())) sent.push({ at: Date.now(), method: r.method(), url: r.url(), body: r.postData() || '' }); });
    await tab1.goto(`http://localhost:${port}/`);
    await box(tab1).waitFor({ timeout: 20000 });
    await box(tab1).fill(DRAFT);
    await tab1.waitForFunction((text) => (localStorage.getItem('noevia:chat-drafts') || '').includes(text), DRAFT, { timeout: 5000 });
    await tab1.evaluate(() => { window.__tab1Alive = true; });
    const tab2 = await context.newPage();
    tab2.on('pageerror', (e) => errors.push(e.message));
    await tab2.goto(`http://localhost:${port}/`);
    await box(tab2).waitFor({ timeout: 20000 });
    return { context, state, tab1, tab2, sent };
  };
  const signOut = async (tab2) => {
    await tab2.locator('.account-trigger').click();
    await tab2.getByRole('menuitem', { name: 'Log out' }).click();
    await tab2.locator('#username').waitFor({ timeout: 20000 });
  };
  const signInAsB = async (tab2) => {
    await tab2.locator('#username').fill(users.b.username);
    await tab2.locator('#password').fill('synthetic-password-1643');
    await tab2.getByRole('button', { name: 'Sign in with password' }).click();
    await tab2.getByRole('button', { name: 'Set up later' }).click({ timeout: 20000 });
    await box(tab2).waitFor({ timeout: 20000 });
  };
  const reloaded = (tab1) => tab1.waitForFunction(() => !window.__tab1Alive, null, { timeout: 15000 });

  try {
    await check('#1643 another tab signs A out and B in: this tab reloads, shows nothing of A and sends nothing of A\'s', async () => {
      const { context, tab1, tab2, sent } = await open();
      await signOut(tab2);
      await signInAsB(tab2);
      const switchedAt = Date.now();
      await reloaded(tab1);
      // The sign-out already reloaded tab 1 to the sign-in screen; A's chat never comes back under B.
      await tab1.locator('#username, .account-trigger').first().waitFor({ timeout: 20000 });
      const text = await tab1.locator('body').innerText();
      assert.doesNotMatch(text, new RegExp(users.a.displayName), 'nothing of A is on the page');
      assert.ok(!(await tab1.evaluate(() => localStorage.getItem('noevia:chat-drafts') || '')).includes(DRAFT), 'A\'s draft is not in the shared storage');
      assert.equal(sent.filter((r) => r.at >= switchedAt && r.body.includes(DRAFT)).length, 0, 'no request after the switch carries A\'s draft');
      await context.close();
    });

    await check('#1643 B signs in over A\'s expired session in another tab: this tab reloads straight into B, without A\'s draft', async () => {
      const { context, state, tab1, tab2, sent } = await open();
      state.user = null; // A's session ends (no sign-out click anywhere); tab 1 has not made a request since
      await tab2.reload();
      await tab2.locator('#username').waitFor({ timeout: 20000 });
      await signInAsB(tab2);
      const switchedAt = Date.now();
      await reloaded(tab1);
      await box(tab1).waitFor({ timeout: 20000 });
      assert.equal(await box(tab1).inputValue(), '', 'A\'s unsent draft is not in B\'s composer');
      await tab1.locator('.account-trigger').click();
      const text = await tab1.locator('body').innerText();
      assert.match(text, new RegExp(users.b.displayName), 'tab 1 now shows B');
      assert.doesNotMatch(text, new RegExp(users.a.displayName), 'and nothing of A');
      assert.ok(!(await tab1.evaluate(() => localStorage.getItem('noevia:chat-drafts') || '')).includes(DRAFT), 'A\'s draft is not in the shared storage');
      assert.equal(sent.filter((r) => r.at >= switchedAt && r.body.includes(DRAFT)).length, 0, 'no request after the switch carries A\'s draft');
      await context.close();
    });

    await check('#1643 a refused password in another tab does not reload this one, and its draft survives', async () => {
      const { context, state, tab1, tab2, sent } = await open();
      state.user = null;
      await tab2.reload();
      await tab2.locator('#username').waitFor({ timeout: 20000 });
      await tab2.locator('#username').fill(users.b.username);
      await tab2.locator('#password').fill('wrong-password');
      await tab2.getByRole('button', { name: 'Sign in with password' }).click();
      await tab2.locator('.auth-error').waitFor({ timeout: 10000 });
      await wait(1500);
      assert.equal(await tab1.evaluate(() => window.__tab1Alive === true), true, 'tab 1 was not reloaded');
      assert.equal(await box(tab1).inputValue(), DRAFT, 'and still holds its own draft');
      assert.equal(await tab1.evaluate(() => localStorage.getItem('noevia:session-account')), users.a.id, 'the marker is A\'s again');
      void sent;
      await context.close();
    });

    await check('#1643 another tab signs A out: this tab leaves A\'s chat for the sign-in screen', async () => {
      const { context, tab1, tab2 } = await open();
      await signOut(tab2);
      await reloaded(tab1);
      await tab1.locator('#username').waitFor({ timeout: 20000 });
      assert.doesNotMatch(await tab1.locator('body').innerText(), new RegExp(users.a.displayName));
      assert.ok(!(await tab1.evaluate(() => localStorage.getItem('noevia:chat-drafts') || '')).includes(DRAFT), 'the draft left with the sign-out');
      await context.close();
    });

    await check('#1643 with the marker unusable, looking at the tab again asks the server and reloads it into B', async () => {
      // Writes to the shared marker are refused, so no storage event and no marker can tell the tab.
      const { context, state, tab1 } = await open(() => {
        const set = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) { if (key === 'noevia:session-account') throw new Error('quota'); return set.call(this, key, value); };
      });
      state.user = users.b; // the cookie now names B, as another tab's sign-in would have set it
      await tab1.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); });
      await reloaded(tab1);
      await box(tab1).waitFor({ timeout: 20000 });
      assert.equal(await box(tab1).inputValue(), '');
      await context.close();
    });

    const unexpected = errors.filter((e) => !/ResizeObserver/.test(e));
    if (unexpected.length) { failures.push('page errors'); console.log(`FAIL page errors\n     ${unexpected.join('\n     ')}`); }
    if (failures.length) { console.log(`FAIL cross-tab-account-1643: ${failures.length} check(s) failed`); process.exitCode = 1; }
    else console.log('PASS #1643 a tab never keeps one account\'s state under another account\'s session.');
  } finally { await browser.close(); await server.close(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
