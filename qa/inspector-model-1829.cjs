// #1829: the chat side panel's "Model" line showed the first loaded model, which could be the embedding model
// (live QA on da2e18b9). It must show the model that answered the last turn, else the Auto summary (Auto) or the
// selected chat model (Manual), and never an embedding, reranking or system/sidecar model.
// Synthetic only: every /api read is stubbed, POST /api/chat is answered by this script. Fails on a build without the fix.
//   npm run build -- --outDir ../dist-after
//   PLAYWRIGHT_MODULE=<playwright-core> QA_CHROME_PATH=<Chrome> QA_DIST=../dist-after [QA_SHOTS=dir] node qa/inspector-model-1829.cjs
const os = require('node:os');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || `${os.homedir()}/noevia-local-test/node_modules/playwright-core`);
const { createFixture } = require('./diary-fixture.cjs');
const { withLocale } = require('./qa-locale.cjs');

const SHOTS = process.env.QA_SHOTS || '';
const roles = { fast: 'syn-fast-q4', smart: 'syn-smart-q4' };
const installed = [
  { name: 'syn-embed-q8', labels: ['embedding'], status: 'loaded', loaded: true },
  { name: 'syn-rank-q8', labels: ['reranking'], status: 'loaded', loaded: true },
  { name: 'syn-decider', labels: [], status: 'loaded', loaded: true, system: true },
  { name: 'syn-fast-q4', labels: [], status: 'loaded', loaded: true },
];
const NON_CHAT = /syn-embed|syn-rank|syn-decider/;

async function open(browser, origin, { routing, width = 1280, height = 860, theme = 'light', reply }) {
  const page = await browser.newPage(withLocale({ viewport: { width, height } }));
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((th) => { try { localStorage.setItem('cowork-theme', th); } catch { /* ignore */ } }, theme);
  const project = { id: 'qa-insp', name: 'Synthetic project', routing, ...(routing === 'manual' ? {} : {}), files: [], assets: [], toolboxes: [], memories: [], instructions: '',
    chats: [{ id: 'qa-chat', title: 'Synthetic chat', updatedAt: 1 }], createdAt: 1, updatedAt: 1 };
  await page.route('**/*', (route) => {
    const req = route.request(), url = new URL(req.url()), p = url.pathname, m = req.method();
    if (url.origin !== origin) return route.abort('blockedbyclient');
    if (!p.startsWith('/api/')) return route.continue();
    const json = (v) => route.fulfill({ json: v });
    const user = { id: 'qa-insp', username: 'synthetic', role: 'member', diaryEnabled: false, onboarded: true };
    if (p === '/api/chat' && m === 'POST') {
      const ev = (d) => `data: ${JSON.stringify(d)}\n\n`;
      return route.fulfill({ status: 200, headers: { 'Content-Type': 'text/event-stream' }, body:
        ev({ type: 'meta', model: reply }) + ev({ type: 'delta', text: 'Synthetic answer.' }) + ev({ type: 'telemetry', phase: 'complete', model: reply }) + ev({ type: 'done', model: reply }) });
    }
    if (m !== 'GET') return json({ ok: true, revision: `r${Date.now()}` });
    if (p === '/api/profile' || p === '/api/auth/session') return json({ user, passkeys: [] });
    if (p === '/api/account/preferences') return json({ notifications: { replyFinished: false, approvalNeeded: false }, sendKey: 'enter', locale: 'en-GB' });
    if (p === '/api/profile/appearance') return json({ theme, light: 'iris', dark: 'iris' });
    if (p === '/api/projects/qa-insp/skills') return json({ skills: [] });
    if (p === '/api/workspace') return json({ projects: [project], freeChats: [] });
    if (p === '/api/chats/qa-chat/context') return json({ project });
    if (p === '/api/chats/qa-chat/history') return json({ history: [], revision: 'r1' });
    if (p === '/api/auto-roles') return json({ configured: true, roles, missing: [] });
    if (p === '/api/models/installed') return json(installed);
    return route.continue();
  });
  await page.goto(`${origin}/projects`);
  await page.locator('.project-card-open').click();
  await page.locator('.chat-index-row').filter({ hasText: 'Synthetic chat' }).click();
  const value = page.locator('#noevia-inspector [data-testid="inspector-model"], #noevia-inspector .insp-section .insp-value').first();
  await value.waitFor({ state: 'attached' });
  return { page, value, errors };
}

const modelLine = (page) => page.locator('#noevia-inspector .insp-section').filter({ has: page.locator('h3', { hasText: /^Model$/ }) }).locator('.insp-value').textContent();

async function send(page, text) {
  const box = page.getByRole('textbox', { name: 'Message', exact: true });
  await box.fill(text);
  await box.press('Enter');
  await page.locator('.msg[data-role=assistant]').last().getByText('Synthetic answer.').waitFor();
}

(async () => {
  const fixture = createFixture(0);
  let browser = null, failed = 0;
  const check = async (name, fn) => {
    try { await fn(); console.log(`PASS inspector-model-1829: ${name}`); }
    catch (e) { failed++; console.log(`FAIL inspector-model-1829: ${name}\n  ${String(e.message).split('\n').slice(0, 4).join('\n  ')}`); }
  };
  try {
    await fixture.listen();
    browser = await chromium.launch({ headless: true, ...(process.env.QA_CHROME_PATH ? { executablePath: process.env.QA_CHROME_PATH } : { channel: 'chrome' }) });
    const origin = `http://127.0.0.1:${fixture.server.address().port}`;

    await check('Auto, no reply yet: the Auto summary, not the embedding model', async () => {
      const { page, errors } = await open(browser, origin, { routing: 'auto', reply: roles.fast });
      await page.waitForFunction(() => /syn-fast-q4/.test(document.querySelector('#noevia-inspector')?.textContent || ''));
      const text = await modelLine(page);
      assert.doesNotMatch(text, NON_CHAT, `model line: ${text}`);
      assert.match(text, /syn-fast-q4/);
      assert.match(text, /syn-smart-q4/);
      assert.deepEqual(errors, []);
      await page.close();
    });

    await check('Manual with nothing selected: a loaded chat model, never the embedding, reranking or system model', async () => {
      const { page } = await open(browser, origin, { routing: 'manual', reply: roles.fast });
      await page.waitForTimeout(500);
      const text = await modelLine(page);
      assert.doesNotMatch(text, NON_CHAT, `model line: ${text}`);
      assert.equal(text.trim(), 'syn-fast-q4');
      await page.close();
    });

    for (const [width, height, theme] of [[2000, 1100, 'light'], [2000, 1100, 'dark'], [390, 844, 'light'], [390, 844, 'dark']]) {
      await check(`after a reply the line names the model that answered (${width} px ${theme})`, async () => {
        const { page, errors } = await open(browser, origin, { routing: 'auto', width, height, theme, reply: 'syn-answerer-q4' });
        await send(page, 'QA-1829 hello');
        await page.waitForFunction(() => /syn-answerer-q4/.test(document.querySelector('#noevia-inspector')?.textContent || ''));
        const text = await modelLine(page);
        assert.equal(text.trim(), 'syn-answerer-q4');
        assert.doesNotMatch(text, NON_CHAT);
        if (width <= 600) await page.locator('#noevia-inspector .insp-toggle').click();
        if (SHOTS) await page.screenshot({ path: `${SHOTS}/1829-inspector-${width}-${theme}.png`, fullPage: false });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no sideways scroll');
        assert.deepEqual(errors, []);
        await page.close();
      });
    }

    await check('a reply that names an embedding model is ignored', async () => {
      const { page } = await open(browser, origin, { routing: 'auto', reply: 'syn-embed-q8' });
      await send(page, 'QA-1829 odd');
      await page.waitForTimeout(500);
      assert.doesNotMatch(await modelLine(page), NON_CHAT);
      await page.close();
    });
  } finally {
    await Promise.allSettled([browser?.close(), fixture.close()]);
  }
  if (failed) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
