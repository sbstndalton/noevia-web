// #1797: after noevia-core#119 the chat stream ends `telemetry complete`, `done`, then an optional `title` up to 8 s
// later, and only then closes. The client ended its "generating" state when the connection closed, so the first reply of
// every new chat looked like it was still streaming for seconds after the text was finished. Now `done` ends it
// (Stop gone, composer ready, Copy and Regenerate shown) and the stream is still read for the trailing title.
//
// Offline: the app is built from this checkout, every API is a synthetic stub (diary-fixture.cjs), and the page answers
// POST /api/chat itself: tokens, `done`, then `title` TITLE_DELAY ms later, then the stream closes.
//   PLAYWRIGHT_MODULE=<playwright-core> QA_DIST=<dist dir> [QA_SHOTS=<dir>] node qa/chat-done-ends-streaming-1797.cjs
// Fails on a build without the change, passes with it.
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || `${process.env.HOME}/noevia-local-test/node_modules/playwright-core`);
const assert = require('node:assert/strict');
const { createFixture } = require('./diary-fixture.cjs');
const { withLocale } = require('./qa-locale.cjs');

const PORT = Number(process.env.QA_PORT || 31797);
const SHOTS = process.env.QA_SHOTS || '';
const TITLE_DELAY = 3000;
const TEXT = 'Synthetic answer, finished before the title arrives.';
const GENERATED = 'Synthetic Generated Title';
const FIRST = 'QA-1797 hello there';
const SECOND = 'QA-1797 second message';
const freeChats = [{ id: 'fc1797', title: FIRST, preview: FIRST, updatedAt: 5000, archived: false, pinned: false }];

// Runs in the page. Each /api/chat streams tokens and `done`; the first one then sends the title after TITLE_DELAY ms.
function installChat({ text, title, delay }) {
  const realFetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.origin);
    if (url.pathname !== '/api/chat' || (init.method || 'GET') !== 'POST') return realFetch(input, init);
    const calls = Number(sessionStorage.getItem('qa1797-calls') || 0);
    sessionStorage.setItem('qa1797-calls', String(calls + 1));
    window.__qa1797 = window.__qa1797 || [];
    const enc = new TextEncoder();
    const event = (c, data) => c.enqueue(enc.encode(`data: ${JSON.stringify(data)}\n\n`));
    const stream = new ReadableStream({
      start(c) {
        event(c, { type: 'meta', model: 'Synthetic-Chat-Q4' });
        for (const word of text.split(' ')) event(c, { type: 'delta', text: word + ' ' });
        event(c, { type: 'telemetry', phase: 'complete', model: 'Synthetic-Chat-Q4' });
        event(c, { type: 'done', model: 'Synthetic-Chat-Q4' });
        window.__qa1797.push({ call: calls, doneAt: performance.now() });
        if (calls === 0) setTimeout(() => { event(c, { type: 'title', title }); c.close(); }, delay);
        else c.close();
      },
    });
    return Promise.resolve(new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }));
  };
}

async function open(browser, { width, height, theme }) {
  const page = await browser.newPage(withLocale({ viewport: { width, height } }));
  await page.addInitScript((t) => { localStorage.setItem('cowork-theme', t); }, theme);
  await page.addInitScript(installChat, { text: TEXT, title: GENERATED, delay: TITLE_DELAY });
  await page.route('**/api/workspace', (r) => r.fulfill({ json: { projects: [], freeChats } }));
  await page.route('**/api/chats/*/history', async (r) => {
    if (r.request().method() === 'POST') return r.fulfill({ json: { ok: true, revision: `r${Date.now()}` } });
    return r.fulfill({ json: { history: [], revision: 'r1' } });
  });
  await page.goto(`http://localhost:${PORT}/c/fc1797`);
  const box = page.getByRole('textbox', { name: 'Message', exact: true });
  await box.waitFor({ timeout: 20000 });
  return { page, box };
}

const lastReply = (page) => page.locator('.msg[data-role=assistant]').last();
const sidebarTitles = (page) => page.evaluate(() => [...document.querySelectorAll('.nav-item, .nested-chat-title')].map((n) => n.textContent.trim()));

(async () => {
  const fixture = createFixture(PORT);
  await fixture.listen();
  const browser = await chromium.launch({ headless: true, ...(process.env.QA_CHROME_PATH ? { executablePath: process.env.QA_CHROME_PATH } : { channel: 'chrome' }) });
  const results = [];
  const check = async (name, fn) => {
    try { await fn(); results.push([name, null]); console.log(`PASS chat-done-ends-streaming-1797: ${name}`); }
    catch (e) { results.push([name, e]); console.log(`FAIL chat-done-ends-streaming-1797: ${name}\n  ${String(e.message).split('\n').slice(0, 8).join('\n  ')}`); }
  };
  try {
    for (const [width, height, theme] of [[2000, 1100, 'light'], [2000, 1100, 'dark'], [390, 844, 'light'], [390, 844, 'dark']]) {
      const tag = `${width} px ${theme}`;
      const { page, box } = await open(browser, { width, height, theme });
      await box.fill(FIRST);
      await box.press('Enter');
      await lastReply(page).locator('.bubble').filter({ hasText: 'before the title arrives' }).waitFor({ timeout: 15000 });
      const sentAt = Date.now();

      await check(`#1797 ${tag}: within 500 ms of done the generating state is over and the title is still pending`, async () => {
        // The stub's done is immediate; give the app the 500 ms the issue allows, then look.
        await page.waitForTimeout(500);
        assert.ok(Date.now() - sentAt < TITLE_DELAY, 'still before the title event');
        assert.equal(await page.getByTitle('Stop generating').count(), 0, 'no Stop button: generation is over');
        assert.ok(await box.isEditable(), 'the composer is enabled');
        assert.ok(await box.isEnabled());
        const reply = lastReply(page);
        assert.equal(await reply.getByRole('button', { name: 'Copy' }).count(), 1, 'Copy is offered');
        assert.equal(await reply.getByRole('button', { name: 'Regenerate' }).count(), 1, 'Regenerate is offered');
        assert.equal(await page.locator('.nested-chat-title, .nav-item').filter({ hasText: '···' }).count(), 0, 'the sidebar row no longer says it is generating');
        if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `1797-done-before-title-${width}-${theme}.png`) });
      });

      await check(`#1797 ${tag}: the trailing title is still adopted`, async () => {
        await page.waitForFunction((t) => [...document.querySelectorAll('.nav-item, .nested-chat-title')].some((n) => n.textContent.includes(t)), GENERATED, { timeout: TITLE_DELAY + 5000 });
        assert.ok(Date.now() - sentAt >= TITLE_DELAY - 600, 'the title appeared only after the delay');
        if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `1797-title-adopted-${width}-${theme}.png`) });
      });
      await page.close();
    }

    // A new message sent before the title arrives breaks and duplicates nothing.
    const { page, box } = await open(browser, { width: 1280, height: 800, theme: 'light' });
    await check('#1797: a message sent before the title arrives is answered once and the title is still adopted', async () => {
      await box.fill(FIRST);
      await box.press('Enter');
      await lastReply(page).locator('.bubble').filter({ hasText: 'before the title arrives' }).waitFor({ timeout: 15000 });
      await page.waitForTimeout(500);
      await box.fill(SECOND);
      await box.press('Enter');
      await page.waitForFunction(() => document.querySelectorAll('.msg[data-role=assistant] .bubble').length === 2
        && [...document.querySelectorAll('.msg[data-role=assistant] .bubble')].every((b) => b.textContent.includes('before the title arrives')), null, { timeout: 15000 });
      await page.getByTitle('Stop generating').waitFor({ state: 'detached', timeout: 10000 });
      await page.waitForTimeout(TITLE_DELAY + 500);
      assert.equal(await page.locator('.msg[data-role=user]').count(), 2, 'two user messages, none duplicated');
      assert.equal(await page.locator('.msg[data-role=assistant]').count(), 2, 'two replies, none duplicated');
      assert.equal(await page.getByTitle('Stop generating').count(), 0);
      assert.ok(await box.isEditable(), 'the composer is usable');
      assert.equal(await page.evaluate(() => window.__qa1797.length), 2, 'the server was asked twice');
    });
    await page.close();
  } finally {
    await browser.close();
    await fixture.close();
  }
  const failed = results.filter(([, e]) => e);
  console.log(`\nchat-done-ends-streaming-1797: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exitCode = 1;
})().catch((e) => { console.error(e); process.exitCode = 1; });
