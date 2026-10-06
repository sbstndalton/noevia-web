// #905: the cached account preferences (localStorage "noevia:account-preferences": language, Enter
// behaviour, notification choices) belonged to whoever used the browser last. User B signing in after
// A got A's choices until B's own record loaded, and for the whole session when that request failed.
//
// Synthetic only: a static server for a built app and page.route mocks for every API. No live
// account, Diary, model or storage.
//   1. A (sendKey mod-enter) is signed in and the hint says "Enter for a new line"; A logs out through
//      the account menu; B signs in with /api/account/preferences aborted -> the hint is the
//      Enter-to-send default, and A's cache is gone from localStorage.
//   2. No sign-out click (A's session simply ended): B's session is found on load with the
//      preferences request aborted -> still the default, not A's.
//
//   npm run build -- --outDir /tmp/prefs-905-dist
//   QA_DIST=/tmp/prefs-905-dist PLAYWRIGHT_MODULE=/path/to/playwright-core \
//     [QA_CHROME_PATH=/path/to/chrome] node qa/prefs-cache-905.cjs
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { isClientRoute } = require('../server/spa-routes.cjs');

const port = 31905;
const dist = path.resolve(process.env.QA_DIST || path.join(__dirname, '../dist'));
const KEY = 'noevia:account-preferences';
const DEFAULT_HINT = /Enter to send · (⇧Enter|Shift\+Enter) for a new line/;
const MOD_HINT = /(⌘|Ctrl\+)Enter to send · Enter for a new line/;
const users = {
  a: { id: 'qa-user-a', username: 'synthetic-a', displayName: 'Synthetic A', role: 'member', disabled: false, diaryEnabled: false, onboarded: true },
  b: { id: 'qa-user-b', username: 'synthetic-b', displayName: 'Synthetic B', role: 'member', disabled: false, diaryEnabled: false, onboarded: true },
};

function staticServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let file = path.join(dist, url.pathname === '/' ? 'index.html' : url.pathname);
    if ((!file.startsWith(dist + '/') || !fs.existsSync(file)) && isClientRoute(url.pathname)) file = path.join(dist, 'index.html');
    if (!file.startsWith(dist + '/') || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
    fs.createReadStream(file).pipe(res);
  });
  return { listen: () => new Promise((r) => server.listen(port, '127.0.0.1', r)), close: () => new Promise((r) => server.close(r)) };
}

// One synthetic backend per browser context: `state.user` is whoever the session cookie names.
async function install(context, state) {
  await context.route('**/api/**', async (route) => {
    const req = route.request(), url = new URL(req.url()), p = url.pathname, method = req.method();
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (p === '/api/account/preferences') {
      state.prefRequests.push(state.user?.id || null);
      if (state.user?.id === users.a.id) return json({ notifications: { replyFinished: false, approvalNeeded: false }, sendKey: 'mod-enter', locale: 'system' });
      return route.abort(); // B's record never arrives
    }
    if (p === '/api/setup/status') return json({ configured: true, publicOrigin: `http://localhost:${port}` });
    if (p === '/api/auth/session' || p === '/api/profile') return state.user ? json({ user: state.user, passkeys: [] }) : json({ error: 'Not signed in' }, 401);
    if (p === '/api/auth/logout' && method === 'POST') { state.user = null; state.logouts += 1; return json({ ok: true }); }
    if (p === '/api/auth/login/password' && method === 'POST') {
      const body = req.postDataJSON();
      state.user = body.username === users.b.username ? users.b : users.a;
      return json({ user: state.user });
    }
    if (!state.user) return json({ error: 'Not signed in' }, 401);
    if (p === '/api/features') return json({ flags: { previews: false } });
    if (p === '/api/workspace') return json({ projects: [], freeChats: [] });
    if (p === '/api/health') return json({ inferenceUp: true, diaryUp: null });
    if (p === '/api/providers') return json({ providers: [] });
    if (p === '/api/toolboxes') return json({ toolboxes: [], mcp: { enabled: false } });
    if (p === '/api/freechats') return json(method === 'GET' ? { chats: [] } : { ok: true });
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
  const hint = (page) => page.locator('.composer-hint').first();
  const signedInAsA = async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 820 }, reducedMotion: 'reduce' });
    const state = { user: users.a, prefRequests: [], logouts: 0 };
    await install(context, state);
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`http://localhost:${port}/`);
    await hint(page).waitFor({ state: 'attached', timeout: 20000 });
    await page.waitForFunction((key) => JSON.parse(localStorage.getItem(key) || '{}').sendKey === 'mod-enter', KEY, { timeout: 10000 });
    assert.match(await hint(page).textContent(), MOD_HINT, 'A sees their own Mod+Enter choice');
    return { context, page, state };
  };
  try {
    await check('#905 A logs out, B signs in with the preferences request aborted: Enter-to-send default', async () => {
      const { context, page, state } = await signedInAsA();
      await page.locator('.account-trigger').click();
      await page.getByRole('menuitem', { name: 'Log out' }).click();
      await page.locator('#username').waitFor({ timeout: 20000 });
      assert.equal(state.logouts, 1, 'logged out through the app');
      await page.locator('#username').fill(users.b.username);
      await page.locator('#password').fill('synthetic-password-905');
      await page.getByRole('button', { name: 'Sign in with password' }).click();
      // A password sign-in offers a passkey first; this synthetic account sets it up later.
      await page.getByRole('button', { name: 'Set up later' }).click({ timeout: 20000 });
      await hint(page).waitFor({ state: 'attached', timeout: 20000 });
      await new Promise((r) => setTimeout(r, 800)); // the aborted preferences request has settled
      assert.ok(state.prefRequests.includes(users.b.id), 'B\'s own record was asked for (and aborted)');
      const text = await hint(page).textContent();
      assert.match(text, DEFAULT_HINT, `B sees the default hint, got "${text}"`);
      assert.doesNotMatch(text, MOD_HINT);
      assert.notEqual(JSON.parse((await page.evaluate((key) => localStorage.getItem(key), KEY)) || '{}').sendKey, 'mod-enter', 'A\'s choice is not left on the device');
      await context.close();
    });
    await check('#905 A\'s session ends without a sign-out click; B\'s session loads with preferences aborted: default', async () => {
      const { context, page, state } = await signedInAsA();
      state.user = users.b; // the cookie now names B (A's session expired, B signed in elsewhere in this browser)
      await page.reload();
      await hint(page).waitFor({ state: 'attached', timeout: 20000 });
      await new Promise((r) => setTimeout(r, 800));
      assert.ok(state.prefRequests.includes(users.b.id), 'B\'s own record was asked for (and aborted)');
      const text = await hint(page).textContent();
      assert.match(text, DEFAULT_HINT, `B sees the default hint, got "${text}"`);
      assert.notEqual(JSON.parse((await page.evaluate((key) => localStorage.getItem(key), KEY)) || '{}').sendKey, 'mod-enter', 'A\'s choice is not kept for B');
      await context.close();
    });
    const unexpected = errors.filter((e) => !/ResizeObserver/.test(e));
    if (unexpected.length) { failures.push('page errors'); console.log(`FAIL page errors\n     ${unexpected.join('\n     ')}`); }
    if (failures.length) { console.log(`FAIL prefs-cache-905: ${failures.length} check(s) failed`); process.exitCode = 1; }
    else console.log('PASS #905 account preferences do not carry from one account to the next on this browser.');
  } finally { await browser.close(); await server.close(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
