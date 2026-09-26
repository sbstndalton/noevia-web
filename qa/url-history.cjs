// #359: the address bar follows in-app navigation. Offline: the page is served by the real
// server/spa-routes.cjs fallback over a built dist (so /c/<id> really gets index.html), and every
// /api call is a synthetic page.route mock — no inference, storage, Diary or network.
//
//   npm run build -- --outDir /tmp/noevia-url-dist
//   QA_DIST=/tmp/noevia-url-dist PLAYWRIGHT_MODULE=~/noevia-local-test/node_modules/playwright-core node qa/url-history.cjs
//
// Covers: chat A -> chat B -> Back -> chat A -> Forward; deep link + reload; Settings open /
// section / Escape and Back through them; a project's tab; another account's chat and project id
// (not found, no title); junk reached through history; sign-in returning to the deep link; the
// phone drawer with Back.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { createStaticFiles } = require('../server/static-files.cjs');
const { createStaticFallback } = require('../server/spa-routes.cjs');
const { json: sendJson } = require('../server/http.cjs');
const { withLocale } = require('./qa-locale.cjs');

const DIST = path.resolve(process.env.QA_DIST || path.join(__dirname, '../dist'));
const PORT = Number(process.env.QA_PORT || 31459);
const ORIGIN = `http://localhost:${PORT}`;

const now = Date.now();
const CHAT_A = { id: 'c-1727000000001-alpha1', title: 'Synthetic alpha chat', preview: 'alpha', updatedAt: now - 1000 };
const CHAT_B = { id: 'c-1727000000002-bravo2', title: 'Synthetic bravo chat', preview: 'bravo', updatedAt: now - 2000 };
const PROJECT_CHAT = { id: 'c-1727000000003-proj03', title: 'Synthetic project chat', preview: 'p', updatedAt: now - 3000 };
const PROJECT = { id: 'proj-1727000000000-qa0001', name: 'Synthetic QA project', goal: '', instructions: '', memories: [], files: [], assets: [], toolboxes: ['core'], modes: ['chat'], chats: [PROJECT_CHAT], createdAt: now, updatedAt: now };
// Ids that belong to "another account": the server scopes every read to the session, so for this
// account they are in no list and their history reads come back empty.
const FOREIGN_CHAT = 'c-1727000000009-other9';
const FOREIGN_PROJECT = 'proj-1727000000009-other9';
const FOREIGN_TITLE = 'Other account secret title';
const HISTORY = {
  [CHAT_A.id]: [{ role: 'user', content: 'alpha question' }, { role: 'assistant', content: 'Synthetic alpha reply' }],
  [CHAT_B.id]: [{ role: 'user', content: 'bravo question' }, { role: 'assistant', content: 'Synthetic bravo reply' }],
  [PROJECT_CHAT.id]: [{ role: 'user', content: 'project question' }, { role: 'assistant', content: 'Synthetic project reply' }],
};

function startServer() {
  const serve = createStaticFallback({ staticFiles: createStaticFiles(DIST), indexFile: path.join(DIST, 'index.html'), json: sendJson });
  const server = http.createServer((req, res) => {
    const p = new URL(req.url, ORIGIN).pathname;
    if (p.startsWith('/api/')) return sendJson(res, 599, { error: 'unmocked' }); // page.route answers these
    serve(req, res, p);
  });
  return new Promise((resolve) => server.listen(PORT, '127.0.0.1', () => resolve(server)));
}

async function mockApi(page, state) {
  await page.route('**/api/**', (route) => {
    const req = route.request(), url = new URL(req.url()), p = url.pathname;
    const json = (body, status = 200) => route.fulfill({ status, json: body });
    const user = { id: 'qa-url', username: 'fixture', displayName: 'Synthetic URL QA', role: 'member', diaryEnabled: false, onboarded: true };
    if (p === '/api/setup/status') return json({ configured: true, publicOrigin: ORIGIN });
    if (p === '/api/auth/session' || p === '/api/profile') return state.signedIn ? json({ user, passkeys: [] }) : json({ error: 'unauthorized' }, 401);
    if (p === '/api/auth/login/password') { state.signedIn = true; return json({ user }); }
    if (!state.signedIn) return json({ error: 'unauthorized' }, 401);
    if (p === '/api/features') return json({ flags: { previews: false } });
    if (p === '/api/workspace') return json({ projects: [PROJECT], freeChats: [CHAT_A, CHAT_B] });
    const history = p.match(/^\/api\/chats\/([^/]+)\/history$/);
    if (history && req.method() === 'GET') {
      const id = decodeURIComponent(history[1]);
      state.historyReads.push(id);
      return json({ history: HISTORY[id] || [], revision: 'r-' + id });
    }
    if (history) return json({ ok: true, revision: 'r2' });
    if (p === '/api/freechats') return json({ ok: true });
    if (p === '/api/chat') {
      const events = [{ type: 'delta', text: 'Synthetic streamed reply' }, { type: 'done' }];
      return route.fulfill({ status: 200, headers: { 'Content-Type': 'text/event-stream' }, body: events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('') });
    }
    if (p === '/api/health') return json({ inferenceUp: true, diaryUp: false });
    if (p === '/api/models/installed') return json([]);
    if (p === '/api/auto-roles') return json({ configured: false, roles: {}, missing: [] });
    if (p === '/api/stats') return json({ up: true, mtp: [] });
    if (p === '/api/providers') return json({ providers: [] });
    if (p === '/api/toolboxes') return json({ toolboxes: [], mcp: { enabled: false } });
    if (p === '/api/integrations/storage') return json({ kind: 'local', corpusRoot: '' });
    if (p === '/api/connectors') return json({ connectors: [] });
    if (/^\/api\/projects\/[^/]+\/(code|research|browser)/.test(p)) return json({ error: 'not enabled' }, 404);
    if (p.startsWith(`/api/projects/${FOREIGN_PROJECT}`) || p.startsWith(`/api/chats/${FOREIGN_CHAT}`)) return json({ error: 'not found' }, 404);
    return json({});
  });
}

const pathOf = (page) => new URL(page.url()).pathname;
async function atPath(page, expected, label) {
  await page.waitForURL((u) => u.pathname === expected, { timeout: 5000 }).catch(() => undefined);
  assert.equal(pathOf(page), expected, label || `expected ${expected}`);
}
const nav = (page) => page.locator('#app-navigation');

(async () => {
  const server = await startServer();
  const browser = await chromium.launch({ headless: true, channel: process.env.QA_CHANNEL || 'chrome' });
  let passed = 0;
  const pass = (msg) => { passed += 1; console.log(`PASS url-history: ${msg}`); };
  try {
    const state = { signedIn: true, historyReads: [] };
    const context = await browser.newContext(withLocale({ viewport: { width: 1440, height: 950 }, reducedMotion: 'reduce' }));
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await mockApi(page, state);

    // ── chat A -> chat B -> Back -> chat A -> Forward -> chat B
    await page.goto(`${ORIGIN}/`);
    await page.getByRole('textbox', { name: 'Message', exact: true }).waitFor();
    await atPath(page, '/', 'a new chat has no address of its own');
    await nav(page).getByRole('button', { name: CHAT_A.title }).first().click();
    await page.getByText('Synthetic alpha reply').waitFor();
    await atPath(page, `/c/${CHAT_A.id}`);
    await nav(page).getByRole('button', { name: CHAT_B.title }).first().click();
    await page.getByText('Synthetic bravo reply').waitFor();
    await atPath(page, `/c/${CHAT_B.id}`);
    await page.goBack();
    await atPath(page, `/c/${CHAT_A.id}`, 'Back returns to chat A');
    await page.getByText('Synthetic alpha reply').waitFor();
    assert.equal(await page.getByText('Synthetic bravo reply').count(), 0, 'chat B is no longer on screen');
    await page.goForward();
    await atPath(page, `/c/${CHAT_B.id}`, 'Forward returns to chat B');
    await page.getByText('Synthetic bravo reply').waitFor();
    pass('chat A -> chat B -> Back -> chat A -> Forward -> chat B');

    // ── a new chat gets its address when its first message is sent, without a history entry
    await nav(page).getByRole('button', { name: 'New chat', exact: true }).first().click();
    await atPath(page, '/');
    const before = await page.evaluate(() => history.length);
    await page.getByRole('textbox', { name: 'Message', exact: true }).fill('synthetic first message');
    await page.keyboard.press('Enter');
    await page.getByText('Synthetic streamed reply').waitFor();
    await page.waitForURL((u) => /^\/c\/c-[A-Za-z0-9_-]+$/.test(u.pathname), { timeout: 5000 });
    assert.equal(await page.evaluate(() => history.length), before, 'the address was replaced, not pushed');
    await page.goBack();
    await atPath(page, `/c/${CHAT_B.id}`, 'Back from the new chat skips its empty `/` entry');
    pass('a new chat gets /c/<id> on its first send by replacing, so Back skips the empty entry');

    // ── deep link and reload
    await page.goto(`${ORIGIN}/c/${CHAT_A.id}`);
    await page.getByText('Synthetic alpha reply').waitFor();
    await page.reload();
    await page.getByText('Synthetic alpha reply').waitFor();
    await atPath(page, `/c/${CHAT_A.id}`, 'a reload keeps the chat address');
    // A project chat opened by address finds its project from the chat list.
    await page.goto(`${ORIGIN}/c/${PROJECT_CHAT.id}`);
    await page.getByText('Synthetic project reply').waitFor();
    pass('deep link to a chat, reload, and a project chat by address');

    // ── Settings: open, change section, Escape, then Back through all of it
    await page.goto(`${ORIGIN}/c/${CHAT_A.id}`);
    await page.getByText('Synthetic alpha reply').waitFor();
    await page.getByTitle('Settings', { exact: true }).click();
    const settings = page.getByRole('region', { name: 'Settings', exact: true });
    await settings.waitFor();
    await atPath(page, '/settings/appearance', 'opening Settings gives it an address');
    await settings.getByRole('button', { name: 'Usage', exact: true }).click();
    await atPath(page, '/settings/usage', 'a Settings section has its own address');
    await page.keyboard.press('Escape');
    await settings.waitFor({ state: 'detached' });
    await atPath(page, `/c/${CHAT_A.id}`, 'Escape restores the address of the view underneath');
    await page.goBack();
    await page.getByRole('region', { name: 'Settings', exact: true }).waitFor();
    await atPath(page, '/settings/usage');
    await page.getByRole('region', { name: 'Settings', exact: true }).getByRole('heading', { name: 'Usage', exact: true }).first().waitFor();
    await page.goBack();
    await atPath(page, '/settings/appearance');
    await page.getByRole('region', { name: 'Settings', exact: true }).getByRole('heading', { name: 'Appearance & language', exact: true }).first().waitFor();
    await page.goBack();
    await atPath(page, `/c/${CHAT_A.id}`);
    await page.getByRole('region', { name: 'Settings', exact: true }).waitFor({ state: 'detached' });
    await page.getByText('Synthetic alpha reply').waitFor();
    // A Settings deep link opens Settings on that section; closing lands on a real view.
    await page.goto(`${ORIGIN}/settings/general`);
    await page.getByRole('region', { name: 'Settings', exact: true }).waitFor();
    await atPath(page, '/settings/appearance', 'an old section id is normalised in place');
    await page.getByRole('region', { name: 'Settings', exact: true }).getByRole('button', { name: 'Close settings' }).click();
    await page.getByRole('region', { name: 'Settings', exact: true }).waitFor({ state: 'detached' });
    assert.ok(!pathOf(page).startsWith('/settings'), 'closing Settings leaves its address');
    pass('Settings open / section / Escape, Back through them, and a Settings deep link');

    // ── a project and its tab
    await page.goto(`${ORIGIN}/p/${PROJECT.id}`);
    await page.getByRole('tab', { name: /Sources/ }).click();
    await atPath(page, `/p/${PROJECT.id}/sources`);
    await page.getByRole('tab', { name: /Chats/ }).click();
    await atPath(page, `/p/${PROJECT.id}`);
    await page.goBack();
    await atPath(page, `/p/${PROJECT.id}/sources`);
    assert.equal(await page.getByRole('tab', { name: /Sources/ }).getAttribute('aria-selected'), 'true', 'Back restores the Sources tab');
    await page.reload();
    await page.getByRole('tab', { name: /Sources/, selected: true }).waitFor();
    pass('a project tab is in the address, Back restores it, and it survives a reload');

    // ── Customise tabs
    await page.goto(`${ORIGIN}/customise/skills`);
    await page.getByRole('radio', { name: 'Skills', exact: true, checked: true }).waitFor();
    await page.getByRole('radio', { name: 'Plugins', exact: true }).click();
    await atPath(page, '/customise/plugins');
    await page.goBack();
    await atPath(page, '/customise/skills');
    await page.getByRole('radio', { name: 'Skills', exact: true, checked: true }).waitFor();
    pass('a Customise tab is in the address and Back restores it');

    // ── another account's ids: not found, nothing about them shown
    await page.goto(`${ORIGIN}/c/${FOREIGN_CHAT}`);
    await page.getByText("This chat isn't available").waitFor();
    assert.equal(await page.getByText(FOREIGN_TITLE).count(), 0);
    assert.equal(await page.getByRole('textbox', { name: 'Message', exact: true }).count(), 0, 'no composer to write into a chat that is not yours');
    await page.getByRole('button', { name: 'New chat', exact: true }).last().click();
    await atPath(page, '/', 'the not-found view starts a new chat');
    await page.goto(`${ORIGIN}/p/${FOREIGN_PROJECT}`);
    await page.getByText("This project isn't available").waitFor();
    await page.goto(`${ORIGIN}/p/${FOREIGN_PROJECT}/new`);
    await page.getByText("This project isn't available").waitFor();
    assert.equal(await page.getByRole('textbox', { name: 'Message', exact: true }).count(), 0, 'no composer for a new chat in a project that is not yours');
    pass("another account's chat or project id behaves as not found, with no title");

    // ── junk reached through history does not crash
    await page.goto(`${ORIGIN}/c/${CHAT_A.id}`);
    await page.getByText('Synthetic alpha reply').waitFor();
    await page.evaluate(() => { history.pushState({}, '', '/definitely/not/a/place'); dispatchEvent(new PopStateEvent('popstate')); });
    await page.getByRole('textbox', { name: 'Message', exact: true }).waitFor();
    // A path the server does not know is its usual JSON 404, never the app shell.
    const junk = await page.request.get(`${ORIGIN}/definitely/not/a/place`);
    assert.equal(junk.status(), 404);
    assert.match(junk.headers()['content-type'] || '', /application\/json/, 'an unknown top-level path is still JSON, never HTML');
    pass('a junk path reached through history opens a new chat; the server still 404s it');

    // ── #406: /c/, /p/, /c and /p (a truncated or id-stripped chat/project link) get the SPA
    // shell — same as /c/<bogus-id> — instead of breaking out to a raw JSON 404. /api/* keeps
    // its own contract regardless (never HTML), and an unrelated unknown path keeps its 404.
    for (const p of ['/c/', '/p/', '/c', '/p']) {
      const direct = await page.request.get(`${ORIGIN}${p}`);
      assert.equal(direct.status(), 200, `${p}: direct request`);
      assert.match(direct.headers()['content-type'] || '', /text\/html/, `${p}: served as HTML`);
    }
    await page.goto(`${ORIGIN}/c/`);
    await page.getByRole('textbox', { name: 'Message', exact: true }).waitFor();
    // The shell loads, then the client's own routing (routes.ts) reads the empty id as a new
    // chat and normalises the address to '/' — same as any other alternative spelling.
    await atPath(page, '/', 'a truncated /c/ link is read as a new chat and the address normalises');
    await page.goto(`${ORIGIN}/p`);
    await page.getByRole('textbox', { name: 'Message', exact: true }).waitFor();
    const apiStillJson = await page.request.get(`${ORIGIN}/api/nope`);
    assert.match(apiStillJson.headers()['content-type'] || '', /application\/json/, '/api/* is never HTML, even alongside the new /c //p fallback');
    const stillUnknown = await page.request.get(`${ORIGIN}/definitely-not-a-route-xyz`);
    assert.equal(stillUnknown.status(), 404, 'an unrelated unknown top-level path keeps its JSON 404');
    pass('/c/, /p/, /c and /p serve the SPA shell (a new chat) instead of a raw JSON 404; /api/* and other unknown paths are unaffected');

    // ── signed out at a deep link -> sign in -> back at the deep link
    state.signedIn = false;
    await page.goto(`${ORIGIN}/c/${CHAT_B.id}`);
    await page.getByRole('heading', { name: 'Sign in to noevia' }).waitFor();
    await page.locator('#username').fill('fixture');
    await page.locator('#password').fill('synthetic-password-123');
    await page.getByRole('button', { name: 'Sign in with password' }).click();
    // The member path goes through "Secure your account" first; skip it.
    await page.getByRole('button', { name: 'Set up later' }).click();
    await page.getByText('Synthetic bravo reply').waitFor();
    await atPath(page, `/c/${CHAT_B.id}`, 'sign-in returns to the deep link');
    pass('a signed-out deep link returns to the same chat after sign-in');

    // ── phone: the drawer closes on navigation, Back still steps through chats
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`${ORIGIN}/c/${CHAT_A.id}`);
    await page.getByText('Synthetic alpha reply').waitFor();
    await page.locator('.nav-drawer-toggle').click();
    await nav(page).getByRole('button', { name: CHAT_B.title }).first().click();
    await page.getByText('Synthetic bravo reply').waitFor();
    await atPath(page, `/c/${CHAT_B.id}`);
    assert.equal(await page.locator('.nav-drawer-toggle').getAttribute('aria-expanded'), 'false', 'the drawer closed on navigation');
    await page.goBack();
    await atPath(page, `/c/${CHAT_A.id}`);
    await page.getByText('Synthetic alpha reply').waitFor();
    pass('phone: navigating from the drawer closes it, and Back returns to the previous chat');

    assert.deepEqual(errors, [], 'no page errors');
    console.log(`PASS url-history: all ${passed} scenarios.`);
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
