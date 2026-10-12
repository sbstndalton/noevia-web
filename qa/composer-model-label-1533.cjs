// #1533: at 125% zoom the composer's model label read "A...ast/Smart)": the Thinking control kept its
// full width and the model pill's track was squeezed, so the Auto label was middle-truncated and
// neither its mode nor its tier could be read. The model label now keeps its full text, and the
// Thinking control gives way first (its label ellipsises; its level and the full name in the
// tooltip stay available).
//
// Three layouts: the 849 px desktop at 100%, the same window with body zoom 1.25 (how the visual
// tester reproduced it), and a 1024 px window at 125% device scale (a real zoomed desktop, tier 1).
//
// Offline: the app is built from this checkout and every API is a synthetic stub (diary-fixture.cjs).
//   PLAYWRIGHT_MODULE=<playwright-core> QA_DIST=<dist dir> node qa/composer-model-label-1533.cjs
// Fails on a build without the change, passes with it.
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || `${process.env.HOME}/noevia-local-test/node_modules/playwright-core`);
const assert = require('node:assert/strict');
const { createFixture } = require('./diary-fixture.cjs');
const { withLocale } = require('./qa-locale.cjs');

const PORT = Number(process.env.QA_PORT || 31533);
const SHOTS = process.env.QA_SHOTS || '';
const freeChats = [{ id: 'fc1', title: 'Short title', updatedAt: 5000, archived: false, pinned: false }];
const contextProject = { id: '__chat-fc1', name: '', goal: '', instructions: '', memories: [], files: [], chats: [], routing: 'auto', reasoningEffort: 'low', toolboxes: ['core'], modes: ['chat'], createdAt: 1, updatedAt: 1 };

async function openComposer(browser, { width, height, dpr = 1, bodyZoom = 1 }) {
  const page = await browser.newPage(withLocale({ viewport: { width, height }, deviceScaleFactor: dpr }));
  await page.addInitScript(() => { localStorage.setItem('cowork-theme', 'light'); });
  await page.route('**/api/workspace', (r) => r.fulfill({ json: { projects: [], freeChats } }));
  await page.route('**/api/chats/*/context', (r) => r.fulfill({ json: { project: contextProject } }));
  await page.route('**/api/chats/*/history', (r) => r.fulfill({ json: { history: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'Synthetic answer', model: 'Synthetic-Chat-Q4' }], revision: 'r1' } }));
  await page.goto(`http://localhost:${PORT}/c/fc1`);
  await page.locator('.composer-model').first().waitFor({ timeout: 20000 });
  if (bodyZoom !== 1) await page.evaluate((z) => { document.body.style.zoom = String(z); }, bodyZoom);
  await page.waitForTimeout(400);
  return page;
}

const measure = (page) => page.evaluate(() => {
  const pill = document.querySelector('.chat-composer-inner .composer-model');
  const head = pill.querySelector('.mid-trunc-head');
  const reasoning = document.querySelector('.chat-composer-inner > .reasoning-control');
  const send = document.querySelector('.chat-composer-inner > .send-btn');
  const value = reasoning?.querySelector('.reasoning-pill-value');
  const pr = pill.getBoundingClientRect(), rr = reasoning?.getBoundingClientRect(), sr = send.getBoundingClientRect();
  return {
    label: pill.getAttribute('aria-label'),
    // A truncated head clips its own text (scrollWidth past clientWidth); an untruncated label does not.
    headClipped: head ? head.scrollWidth > head.clientWidth + 1 : false,
    headText: head?.textContent, tailText: pill.querySelector('.mid-trunc-tail')?.textContent,
    pillLeft: Math.round(pr.left), pillRight: Math.round(pr.right),
    reasoningLeft: rr ? Math.round(rr.left) : null, reasoningRight: rr ? Math.round(rr.right) : null,
    sendLeft: Math.round(sr.left),
    valueVisible: value ? value.getBoundingClientRect().right <= (reasoning.getBoundingClientRect().right + 1) && value.scrollWidth <= value.clientWidth + 1 : null,
    composerRight: Math.round(document.querySelector('.chat-composer-inner').getBoundingClientRect().right),
  };
});

(async () => {
  const fixture = createFixture(PORT);
  await fixture.listen();
  const browser = await chromium.launch({ headless: true, ...(process.env.QA_CHROME_PATH ? { executablePath: process.env.QA_CHROME_PATH } : { channel: 'chrome' }) });
  const results = [];
  const check = async (name, fn) => {
    try { await fn(); results.push([name, null]); console.log(`PASS composer-model-label-1533: ${name}`); }
    catch (e) { results.push([name, e]); console.log(`FAIL composer-model-label-1533: ${name}\n  ${String(e.message).split('\n').slice(0, 8).join('\n  ')}`); }
  };
  const cases = [
    { name: '849 px at 100%', opts: { width: 849, height: 959 } },
    { name: '849 px with body zoom 1.25 (the tester\'s 125%)', opts: { width: 849, height: 959, bodyZoom: 1.25 }, shot: 'zoom125' },
    { name: '1024 px window at 125% device scale', opts: { width: 819, height: 767, dpr: 1.25 }, shot: 'dpr125' },
  ];
  try {
    for (const c of cases) {
      await check(`#1533 ${c.name}: the Auto label reads in full and nothing overlaps`, async () => {
        const page = await openComposer(browser, c.opts);
        const m = await measure(page);
        if (SHOTS && c.shot) await page.screenshot({ path: path.join(SHOTS, `composer-1533-${c.shot}.png`), clip: { x: 0, y: c.opts.height - 200, width: c.opts.width, height: 200 } });
        assert.ok(m.label.includes('Auto (Fast/Smart)'), `the accessible name carries the full label, got ${m.label}`);
        assert.equal(m.headClipped, false, `the label is not cut ("${m.headText}…${m.tailText}")`);
        assert.ok(m.pillRight <= m.reasoningLeft + 1, `the model label does not run under the Thinking control (${m.pillRight} vs ${m.reasoningLeft})`);
        if (m.reasoningRight !== null) assert.ok(m.reasoningRight <= m.sendLeft + 1, 'Thinking stays clear of the send button');
        assert.equal(m.valueVisible, true, 'the Thinking level stays whole');
        await page.close();
      });
    }
  } finally {
    await browser.close();
    await fixture.close();
  }
  const failed = results.filter(([, e]) => e);
  console.log(`\ncomposer-model-label-1533: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exitCode = 1;
})().catch((e) => { console.error(e); process.exitCode = 1; });
