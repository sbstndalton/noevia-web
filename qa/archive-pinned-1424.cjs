// #1424: archiving a pinned chat kept it pinned, so restoring it brought it back in the Pinned group.
// An archived chat is now never pinned: archiving takes the pin away, Undo of a quick archive puts back
// the pin the chat had, and restoring from the Archived page returns the chat unpinned (including a chat
// that was archived while still pinned before this change).
//
// Offline: the app is built from this checkout and every API is a synthetic stub (diary-fixture.cjs). The
// chat-list save is captured and applied to the stub's workspace, as the server would.
//   PLAYWRIGHT_MODULE=<playwright-core> QA_DIST=<dist dir> node qa/archive-pinned-1424.cjs
// Fails on a build without the change, passes with it.
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || `${process.env.HOME}/noevia-local-test/node_modules/playwright-core`);
const assert = require('node:assert/strict');
const { createFixture } = require('./diary-fixture.cjs');
const { withLocale } = require('./qa-locale.cjs');

const PORT = Number(process.env.QA_PORT || 31424);
const SHOTS = process.env.QA_SHOTS || '';
const seed = () => [
  { id: 'fc-pinned', title: 'Pinned synthetic chat', updatedAt: 9000, archived: false, pinned: true },
  { id: 'fc-plain', title: 'Plain synthetic chat', updatedAt: 8000, archived: false, pinned: false },
];

async function setup(browser, freeSeed) {
  const page = await browser.newPage(withLocale({ viewport: { width: 1440, height: 900 } }));
  await page.addInitScript(() => { localStorage.setItem('cowork-theme', 'light'); });
  const state = { freeChats: freeSeed ?? seed(), saves: [] };
  await page.route('**/api/workspace', (r) => r.fulfill({ json: { projects: [], freeChats: state.freeChats } }));
  await page.route('**/api/freechats', async (r) => {
    if (r.request().method() !== 'POST') return r.continue();
    const body = r.request().postDataJSON();
    state.saves.push(body.chats.map((c) => ({ id: c.id, archived: !!c.archived, pinned: !!c.pinned })));
    state.freeChats = body.chats;
    return r.fulfill({ json: { ok: true } });
  });
  await page.route('**/api/chats/*/history', (r) => r.fulfill({ json: { history: [], revision: 'r1' } }));
  await page.goto(`http://localhost:${PORT}/c/fc-plain`);
  await page.locator('.side-footer-search').waitFor({ timeout: 20000 });
  return { page, state };
}

const lastSaved = (state, id) => state.saves.at(-1)?.find((c) => c.id === id);

(async () => {
  const fixture = createFixture(PORT);
  await fixture.listen();
  const browser = await chromium.launch({ headless: true, ...(process.env.QA_CHROME_PATH ? { executablePath: process.env.QA_CHROME_PATH } : { channel: 'chrome' }) });
  const results = [];
  const check = async (name, fn) => {
    try { await fn(); results.push([name, null]); console.log(`PASS archive-pinned-1424: ${name}`); }
    catch (e) { results.push([name, e]); console.log(`FAIL archive-pinned-1424: ${name}\n  ${String(e.message).split('\n').slice(0, 8).join('\n  ')}`); }
  };
  try {
    await check('#1424 archiving a pinned chat from its row un-pins it', async () => {
      const { page, state } = await setup(browser);
      await page.locator('.chat-row', { hasText: 'Pinned synthetic chat' }).hover();
      await page.getByRole('button', { name: 'Archive Pinned synthetic chat' }).click();
      await page.waitForTimeout(400);
      assert.deepEqual(lastSaved(state, 'fc-pinned'), { id: 'fc-pinned', archived: true, pinned: false }, 'the saved chat is archived and not pinned');
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'archive-1424-toast.png') });
      await page.close();
    });

    await check('#1424 Undo of a quick archive brings the chat back pinned, as it was', async () => {
      const { page, state } = await setup(browser);
      await page.locator('.chat-row', { hasText: 'Pinned synthetic chat' }).hover();
      await page.getByRole('button', { name: 'Archive Pinned synthetic chat' }).click();
      // Pressed with a real mouse click: the toast must not be covered by the main pane (#1424, adjacent).
      await page.locator('.save-error.is-notice').getByRole('button', { name: 'Undo', exact: true }).click();
      await page.waitForTimeout(400);
      assert.deepEqual(lastSaved(state, 'fc-pinned'), { id: 'fc-pinned', archived: false, pinned: true }, 'undo restores the pin too');
      await page.close();
    });

    await check('#1424 archive a pinned chat, then restore it from the Archived page: it comes back unpinned', async () => {
      const { page, state } = await setup(browser);
      await page.locator('.chat-row', { hasText: 'Pinned synthetic chat' }).hover();
      await page.getByRole('button', { name: 'Archive Pinned synthetic chat' }).click();
      await page.waitForTimeout(400);
      await page.locator('.side-archived').click();
      await page.getByRole('button', { name: 'Restore Pinned synthetic chat' }).waitFor({ timeout: 10000 });
      await page.getByRole('button', { name: 'Restore Pinned synthetic chat' }).click();
      await page.waitForTimeout(400);
      assert.deepEqual(lastSaved(state, 'fc-pinned'), { id: 'fc-pinned', archived: false, pinned: false }, 'restored unpinned');
      await page.close();
    });

    await check('#1424 a chat archived while pinned before this change comes back unpinned when restored', async () => {
      const { page, state } = await setup(browser, [
        { id: 'fc-legacy', title: 'Legacy pinned archive', updatedAt: 9000, archived: true, pinned: true },
        { id: 'fc-plain', title: 'Plain synthetic chat', updatedAt: 8000, archived: false, pinned: false },
      ]);
      await page.locator('.side-archived').click();
      await page.getByRole('button', { name: 'Restore Legacy pinned archive' }).waitFor({ timeout: 10000 });
      await page.getByRole('button', { name: 'Restore Legacy pinned archive' }).click();
      await page.waitForTimeout(400);
      assert.deepEqual(lastSaved(state, 'fc-legacy'), { id: 'fc-legacy', archived: false, pinned: false }, 'restored without the old pin');
      await page.close();
    });
  } finally {
    await browser.close();
    await fixture.close();
  }
  const failed = results.filter(([, e]) => e);
  console.log(`\narchive-pinned-1424: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exitCode = 1;
})().catch((e) => { console.error(e); process.exitCode = 1; });
