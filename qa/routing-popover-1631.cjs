// #1631: the routing details popover in the strip under the composer ("Decision service · Code") opened over
// the composer and covered the send button, the same defect #1628 fixed for the engine-metrics popover.
// Checked in a real browser on a finished-reply chat at desktop and narrow widths and in a short window:
// the open popover must not intersect the send button, the textarea or the composer block, must stay inside
// the window, and opening it must not move the composer (#1548). In a phone-sized window the strip is an announcer
// only (the details live in the model sheet), so there it checks that no routing popover sits over the chat.
// Offline: the app is built from this checkout and every API is a synthetic stub; nothing reaches a server.
//
// Fails on a build without the change, passes with it:
//   npm run build -- --outDir ../dist-before     (a build of the parent commit)
//   QA_DIST=../dist-before node qa/routing-popover-1631.cjs     -> exits 1, lists the failing checks
//   npm run build                                                -> this checkout
//   node qa/routing-popover-1631.cjs                             -> exits 0
// Environment: PLAYWRIGHT_MODULE (default 'playwright'), QA_DIST, QA_PORT (default 31631), QA_CHROME_PATH.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { createFixture } = require('./diary-fixture.cjs');
const { withLocale } = require('./qa-locale.cjs');

const PORT = Number(process.env.QA_PORT || 31631);
const SHOTS = process.env.QA_SCREENSHOTS || path.join(os.homedir(), 'noevia-work', 'web-1631-shots');
// Windows under 768 wide or 600 tall get the phone treatment (space-tier.ts): the strip is an announcer there.
const WIDTHS = [[1440, 900], [1440, 640], [809, 900], [768, 660], [375, 812], [1440, 520]];
const phoneTier = (width, height) => width < 768 || height < 600;
const FAMILIES = ['editorial', 'glass'];

const ROUTE = { offered: [{ id: 'fast', label: 'Synthetic fast model' }, { id: 'smart', label: 'Synthetic smart model' }, { id: 'code', label: 'Synthetic code model' }], scores: { fast: 0.1, smart: 0.2, code: 0.7 }, selectedRole: 'code', effectiveRole: 'code', backend: 'decision-service', model: 'synthetic', calibrated: false, latencyMs: 35, status: 'accepted', fallbackReason: null };
const STATS = { up: true, tokensPerSecond: 40.3, timeToFirstToken: 0.42, inputTokens: 1400, outputTokens: 144, inputTokensTotal: 52000, outputTokensTotal: 9000, requestCount: 31, gpuPercent: null, vramGb: null, mtp: [] };
const HISTORY = [
  { role: 'user', content: 'Synthetic question.' },
  { role: 'assistant', content: 'Synthetic answer.', model: 'Synthetic-Chat-Q4', routingDecision: ROUTE, stats: { elapsedMs: 4100, promptTokens: 10, completionTokens: 90, totalTokens: 100, tokensPerSecond: 40.3 } },
];

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); };
const inter = (a, b) => !!a && !!b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
const rectText = (r) => (r ? JSON.stringify([Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)]) : 'null');

async function openChat(browser, { width, height, family }) {
  const page = await browser.newPage(withLocale({ viewport: { width, height }, hasTouch: width < 500, isMobile: width < 500 }));
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/api/**', (route) => {
    const p = new URL(route.request().url()).pathname;
    const json = (body) => route.fulfill({ json: body });
    if (p === '/api/stats') return json(STATS);
    if (/\/history$/.test(p)) return json({ history: HISTORY, revision: 'r1' });
    if (/\/context$/.test(p)) return json({ project: null, freeContext: null });
    if (p === '/api/toolboxes') return json({ toolboxes: [], mcp: { enabled: false } });
    if (p === '/api/workspace') return json({ projects: [], freeChats: [{ id: 'c-1', title: 'Synthetic chat', updatedAt: Date.now(), messages: [] }] });
    return route.fallback();
  });
  await page.addInitScript((f) => { localStorage.setItem('noevia:theme-family', f); localStorage.setItem('cowork-theme', 'light'); }, family);
  await page.goto(`http://localhost:${PORT}/c/c-1`);
  await page.locator('.chat-composer-inner textarea').first().waitFor();
  if (!phoneTier(width, height)) await page.locator('.stats-disclosure:visible').first().waitFor();
  await page.waitForTimeout(400);
  return { page, errors };
}

const measure = (page) => page.evaluate(() => {
  const plain = (el) => { const b = el ? el.getBoundingClientRect() : null; return b ? { left: b.left, top: b.top, right: b.right, bottom: b.bottom } : null; };
  const composer = document.querySelector('.chat-composer-inner')?.closest('.composer');
  return {
    panel: plain(document.querySelector('.stats-disclosure > .routing-details[open]')),
    send: plain(document.querySelector('.send-btn')),
    textarea: plain(document.querySelector('.chat-composer-inner textarea')),
    composer: plain(composer),
    innerHeight, innerWidth,
  };
});

async function checkRouting(page, tag, shot, width, height) {
  if (phoneTier(width, height)) {
    const stray = await page.locator('.stats-disclosure > .routing-details:visible').count();
    check(`${tag} no routing popover is on the phone chat (details live in the model sheet)`, stray === 0, `${stray} visible`);
    return;
  }
  const summary = page.locator('.stats-disclosure > .routing-details > summary:visible').first();
  if (!(await summary.count())) { check(`${tag} the routing summary is in the strip`, false); return; }
  const before = (await measure(page)).composer.top;
  await summary.click();
  await page.waitForTimeout(450);
  const m = await measure(page);
  if (!m.panel) { check(`${tag} the routing popover opened`, false); return; }
  check(`${tag} popover does not cover the send button (panel ${rectText(m.panel)}, send ${rectText(m.send)})`, !inter(m.panel, m.send));
  check(`${tag} popover does not cover the textarea`, !inter(m.panel, m.textarea));
  check(`${tag} popover does not cover the composer block (composer ${rectText(m.composer)})`, !inter(m.panel, m.composer));
  check(`${tag} the composer does not move when the popover opens (#1548: ${Math.round(before)} -> ${Math.round(m.composer.top)})`, Math.abs(before - m.composer.top) <= 1);
  check(`${tag} popover stays inside the window (${rectText(m.panel)} in ${m.innerWidth}x${m.innerHeight})`, m.panel.top >= -0.5 && m.panel.bottom <= m.innerHeight + 0.5 && m.panel.left >= -0.5 && m.panel.right <= m.innerWidth + 0.5);
  await page.screenshot({ path: path.join(SHOTS, `${shot}.png`) });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  const closed = await page.locator('.stats-disclosure > .routing-details[open]').count();
  check(`${tag} Escape closes it`, closed === 0);
  const after = (await measure(page)).composer.top;
  check(`${tag} the composer is where it was after closing`, Math.abs(before - after) <= 1);
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const fixture = createFixture(PORT);
  await fixture.listen();
  const browser = await chromium.launch({ headless: true, ...(process.env.QA_CHROME_PATH ? { executablePath: process.env.QA_CHROME_PATH } : { channel: 'chrome' }) });
  const pageErrors = [];
  try {
    for (const [width, height] of WIDTHS) for (const family of FAMILIES) {
      const tag = `${width}x${height} ${family}`;
      const { page, errors } = await openChat(browser, { width, height, family });
      try { await checkRouting(page, `#1631 ${tag}`, `routing-1631-${width}x${height}-${family}`, width, height); }
      finally { pageErrors.push(...errors.map((e) => `${tag}: ${e}`)); await page.close(); }
    }
  } finally {
    await browser.close();
    await fixture.close?.();
  }
  check('no page errors while the popover opens and closes', pageErrors.length === 0, pageErrors.join('; '));
  let failed = 0;
  for (const r of results) {
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${!r.ok && r.detail ? `  [${r.detail}]` : ''}`);
    if (!r.ok) failed += 1;
  }
  console.log(`\nrouting-popover-1631: ${results.length - failed}/${results.length} checks passed, screenshots in ${SHOTS}`);
  if (failed) { console.error(`${failed} check(s) failed`); process.exit(1); }
  console.log('routing-popover-1631: all checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
