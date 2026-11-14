'use strict';
// sbstndalton/noevia#2579: two tabs of one browser opened on `/` both adopted the saved new-chat id, so messages sent from both landed in
// one chat and each tab's history save answered 409. A tab showing an empty new chat now leases it; a second tab starts its own. Also: a
// reload of the only tab keeps its new chat (the unsent draft comes back). 375 and 1280 px, light and dark. Offline (diary-fixture.cjs).
// Fails on a build of main (both messages are sent for one chat id).
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { createFixture } = require('./diary-fixture.cjs');
const { withLocale } = require('./qa-locale.cjs');
const fs = require('node:fs');

const VIEWS = [[375, 812, 'light'], [375, 812, 'dark'], [1280, 900, 'light'], [1280, 900, 'dark']];
const SHOTS = process.env.QA_SHOTS || '';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const PORT = Number(process.env.QA_PORT || 32579), origin = `http://localhost:${PORT}`;

/** Every chat id a page sent a message or saved a history for. */
function watch(page, ids) {
  page.on('request', (r) => {
    const u = new URL(r.url());
    const m = /^\/api\/chats\/([^/]+)\/history$/.exec(u.pathname);
    if (m && r.method() === 'POST') ids.add(decodeURIComponent(m[1]));
  });
}

(async () => {
  const fixture = createFixture(PORT); await fixture.listen();
  const browser = await chromium.launch({ headless: true, ...(process.env.QA_CHROME_PATH ? { executablePath: process.env.QA_CHROME_PATH } : { channel: 'chrome' }) });
  let failed = 0;
  const check = async (label, fn) => {
    try { await fn(); console.log(`PASS two-tabs-new-chat-2579: ${label}`); }
    catch (e) { failed++; console.log(`FAIL two-tabs-new-chat-2579: ${label}\n  ${String(e.message).split('\n').slice(0, 6).join('\n  ')}`); }
  };
  try {
    for (const [width, height, theme] of VIEWS) {
      await check(`${width} px ${theme}: two tabs on / send into two chats`, async () => {
        const context = await browser.newContext(withLocale({ viewport: { width, height }, colorScheme: theme }));
        try {
          const a = await context.newPage(), b = await context.newPage();
          const idsA = new Set(), idsB = new Set();
          watch(a, idsA); watch(b, idsB);
          await a.goto(origin);
          await a.getByRole('textbox', { name: 'Message', exact: true }).waitFor();
          // Tab A has saved its place and holds its empty new chat before tab B loads.
          await a.waitForFunction(() => { try { return !!JSON.parse(localStorage.getItem('noevia:last-view') || 'null')?.view; } catch { return false; } }, null, { timeout: 10000 });
          await a.waitForTimeout(800);
          await b.goto(origin);
          await b.getByRole('textbox', { name: 'Message', exact: true }).waitFor();
          const boxA = a.getByRole('textbox', { name: 'Message', exact: true }), boxB = b.getByRole('textbox', { name: 'Message', exact: true });
          await boxA.fill('synthetic message from tab A');
          await boxB.fill('synthetic message from tab B');
          await Promise.all([boxA.press('Enter'), boxB.press('Enter')]);
          await a.waitForFunction(() => document.body.innerText.includes('synthetic message from tab A'), null, { timeout: 10000 });
          await b.waitForFunction(() => document.body.innerText.includes('synthetic message from tab B'), null, { timeout: 10000 });
          await a.waitForTimeout(2500);
          if (SHOTS) { await a.screenshot({ path: `${SHOTS}/two-tabs-new-chat-2579-A-${width}-${theme}.png` }); await b.screenshot({ path: `${SHOTS}/two-tabs-new-chat-2579-B-${width}-${theme}.png` }); }
          assert.ok(idsA.size >= 1 && idsB.size >= 1, `both tabs saved a history (A ${[...idsA]}, B ${[...idsB]})`);
          assert.equal([...idsA].filter((id) => idsB.has(id)).length, 0, `the two tabs saved into different chats (A ${[...idsA]}, B ${[...idsB]})`);
        } finally { await context.close(); }
      });
    }
    await check('1280 px: reloading the only tab keeps its new chat (the unsent draft is back)', async () => {
      const context = await browser.newContext(withLocale({ viewport: { width: 1280, height: 900 } }));
      try {
        const page = await context.newPage();
        await page.goto(origin);
        const box = page.getByRole('textbox', { name: 'Message', exact: true });
        await box.fill('synthetic unsent draft');
        await page.waitForFunction(() => (localStorage.getItem('noevia:chat-drafts') || '').includes('synthetic unsent draft'), null, { timeout: 10000 });
        await page.waitForTimeout(800);
        await page.reload();
        await box.waitFor();
        assert.equal(await box.inputValue(), 'synthetic unsent draft');
      } finally { await context.close(); }
    });
  } finally { await browser.close(); await fixture.close(); }
  if (failed) process.exitCode = 1;
})().catch((e) => { console.error(e); process.exitCode = 1; });
