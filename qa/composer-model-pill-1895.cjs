// #1895: the composer model pill never names an embedding, reranking or system model. In a Manual chat with no model
// pinned the pill used to read the first LOADED installed model, which was the embedding model.
// Offline: the app is built from this checkout and every API is a synthetic stub (diary-fixture.cjs).
//   npm run build -- --outDir ../dist-after
//   PLAYWRIGHT_MODULE=<playwright-core> QA_CHROME_PATH=<Chrome> QA_DIST=<dist dir> [QA_SHOTS=<dir outside the repo>] node qa/composer-model-pill-1895.cjs
// Fails on a build of main (the pill reads the embedding model), passes with the change.
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || `${process.env.HOME}/noevia-local-test/node_modules/playwright-core`);
const { createFixture } = require('./diary-fixture.cjs');
const { withLocale } = require('./qa-locale.cjs');

const PORT = Number(process.env.QA_PORT || 31895);
const SHOTS = process.env.QA_SHOTS || '';
const freeChats = [{ id: 'fc1', title: 'Synthetic chat', updatedAt: 5000, archived: false, pinned: false }];
const manualContext = { id: '__chat-fc1', name: '', goal: '', instructions: '', memories: [], files: [], chats: [], routing: 'manual', reasoningEffort: 'low', toolboxes: ['core'], modes: ['chat'], createdAt: 1, updatedAt: 1 };
const installed = (chatLoaded) => [
  { name: 'syn-vectors-q8', labels: ['embedding'], status: 'loaded', loaded: true },
  { name: 'syn-order-q8', labels: ['reranking'], status: 'loaded', loaded: true },
  { name: 'syn-decider', labels: [], status: 'loaded', loaded: true, system: true },
  { name: 'syn-chat-q4', labels: [], status: chatLoaded ? 'loaded' : 'unloaded', loaded: chatLoaded },
];
const BANNED = /syn-vectors|syn-order|syn-decider|embedding|rerank/i;

async function open(browser, { width, height, theme, chatLoaded }) {
  const page = await browser.newPage(withLocale({ viewport: { width, height } }));
  await page.addInitScript((th) => { localStorage.setItem('cowork-theme', th); }, theme);
  await page.route('**/api/workspace', (r) => r.fulfill({ json: { projects: [], freeChats } }));
  await page.route('**/api/chats/*/context', (r) => r.fulfill({ json: { project: manualContext } }));
  await page.route('**/api/chats/*/history', (r) => r.fulfill({ json: { history: [], revision: 'r1' } }));
  await page.route('**/api/models/installed', (r) => r.fulfill({ json: installed(chatLoaded) }));
  await page.goto(`http://localhost:${PORT}/c/fc1`);
  await page.locator('.composer-model').first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(800); // the installed list arrives after the first paint
  return page;
}

(async () => {
  const fixture = createFixture(PORT);
  await fixture.listen();
  const browser = await chromium.launch({ headless: true, ...(process.env.QA_CHROME_PATH ? { executablePath: process.env.QA_CHROME_PATH } : { channel: 'chrome' }) });
  let failed = 0;
  const check = async (name, fn) => {
    try { await fn(); console.log(`PASS composer-model-pill-1895: ${name}`); }
    catch (e) { failed++; console.log(`FAIL composer-model-pill-1895: ${name}\n  ${String(e.message).split('\n').slice(0, 6).join('\n  ')}`); }
  };
  try {
    for (const theme of ['light', 'dark']) {
      for (const [width, height] of [[2000, 1100], [390, 844]]) {
        await check(`${theme} ${width}px: Manual with no model pinned, embedding/reranking/system models loaded`, async () => {
          const page = await open(browser, { width, height, theme, chatLoaded: false });
          try {
            const pill = page.locator('.chat-composer-inner .composer-model').first();
            const text = `${await pill.textContent()} | ${await pill.getAttribute('aria-label')} | ${await pill.getAttribute('title')}`;
            if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `composer-pill-1895-${theme}-${width}.png`) });
            assert.ok(!BANNED.test(text), `the pill names a non-chat model: ${text}`);
          } finally { await page.close(); }
        });
      }
    }
    await check('a loaded chat model is what the pill shows', async () => {
      const page = await open(browser, { width: 1280, height: 860, theme: 'light', chatLoaded: true });
      try {
        const pill = page.locator('.chat-composer-inner .composer-model').first();
        const text = (await pill.textContent()) + (await pill.getAttribute('aria-label'));
        assert.ok(text.includes('syn-chat-q4'), `got ${text}`);
        assert.ok(!BANNED.test(text), text);
      } finally { await page.close(); }
    });
  } finally { await browser.close(); await fixture.close(); }
  if (failed) process.exitCode = 1;
})().catch((e) => { console.error(e); process.exitCode = 1; });
