// #1627 + #1628 (and #1527): two composer overlays, checked in a real browser on a finished-reply chat.
//  #1627: the "Add files and tools" (+) popover must be an opaque surface from the theme tokens in every
//         theme family, light and dark. Its entrance used to fade from opacity 0 over the page, so the
//         greeting and the Chat/Task mode-bar text printed through it for its first ~200 ms. Checked: the
//         entrance starts fully opaque, the settled fill and every ancestor's opacity compose to alpha 1,
//         and elementFromPoint inside the panel only ever returns the panel (never the text behind it).
//  #1628: the engine-metrics popover (the chevron at the end of the strip under the composer) must never
//         cover the composer or the send button, and opening it must not move the composer (#1548).
// Offline: the app is built from this checkout and every API is a synthetic stub; nothing reaches a server.
//
// Fails on a build without the change, passes with it:
//   npm run build -- --outDir ../dist-before     (a build of the parent commit)
//   QA_DIST=../dist-before node qa/composer-overlays-1627-1628.cjs     -> exits 1, lists the failing checks
//   npm run build                                                      (this checkout)
//   node qa/composer-overlays-1627-1628.cjs                            -> exits 0
// Environment: PLAYWRIGHT_MODULE (default 'playwright'), QA_DIST, QA_PORT (default 31627),
//              QA_SCREENSHOTS (default ~/noevia-work/web-fixA-shots, outside the repo).
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { createFixture } = require('./diary-fixture.cjs');
const { withLocale } = require('./qa-locale.cjs');

const PORT = Number(process.env.QA_PORT || 31627);
const SHOTS = process.env.QA_SCREENSHOTS || path.join(os.homedir(), 'noevia-work', 'web-fixA-shots');
const WIDTHS = [[1440, 900], [809, 900], [375, 812]];
const FAMILIES = ['editorial', 'contemporary', 'glass'];
const THEMES = ['light', 'dark'];

const ROUTE = { offered: [{ id: 'code', label: 'Synthetic code model' }], scores: { code: 0.8 }, selectedRole: 'code', effectiveRole: 'code', backend: 'decision-service', model: 'synthetic', calibrated: false, latencyMs: 35, status: 'accepted', fallbackReason: null };
// Every metrics pair has a value, so the widest popover (speed, first token, reply, engine total, GPU, draft acceptance) is shown.
const STATS = { up: true, tokensPerSecond: 40.3, timeToFirstToken: 0.42, inputTokens: 1400, outputTokens: 144, inputTokensTotal: 52000, outputTokensTotal: 9000, requestCount: 31, gpuPercent: null, vramGb: null, mtp: [{ model: 'Synthetic-draft', source: 'engine total', rate: 0.78, drafted: 100, accepted: 78 }] };
const HISTORY = [
  { role: 'user', content: 'Synthetic question.' },
  { role: 'assistant', content: 'Synthetic answer.', model: 'Synthetic-Chat-Q4', routingDecision: ROUTE, stats: { elapsedMs: 4100, promptTokens: 10, completionTokens: 90, totalTokens: 100, tokensPerSecond: 40.3 } },
];

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); };

// Alpha of a computed colour: rgb() is opaque, rgba() carries its own alpha.
const alphaOf = (colour) => {
  const m = /rgba?\(([^)]+)\)/.exec(colour || '');
  if (!m) return NaN;
  const parts = m[1].split(/[\s,/]+/).filter(Boolean);
  return parts.length === 4 ? parseFloat(parts[3]) : 1;
};

async function openChat(browser, { width, height, family, theme }) {
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
  await page.addInitScript(([f, t]) => { localStorage.setItem('noevia:theme-family', f); localStorage.setItem('cowork-theme', t); }, [family, theme]);
  await page.goto(`http://localhost:${PORT}/c/c-1`);
  await page.locator('.chat-composer-inner textarea').first().waitFor();
  // Wide screens show the strip under the composer; a phone shows it inside the model sheet instead (App.tsx).
  if (width >= 700) await page.locator('.stats-disclosure:visible').first().waitFor();
  await page.waitForTimeout(400);
  return { page, errors };
}

// #1627 -----------------------------------------------------------------------------------------------
async function checkPopover(page, tag, shot) {
  // The entrance as the eye sees it: the composited alpha of the panel (its own opacity times every ancestor's)
  // on every animation frame for the first 300 ms, from the CSS entrance and the Motion spring alike.
  const frames = await page.evaluate(() => new Promise((resolve) => {
    const button = [...document.querySelectorAll('button.composer-add')].find((b) => b.getClientRects().length);
    const alpha = (el) => { let a = 1; for (let e = el; e; e = e.parentElement) a *= parseFloat(getComputedStyle(e).opacity); return a; };
    const samples = [];
    const t0 = performance.now();
    button.click();
    const tick = () => {
      const p = document.querySelector('.composer-actions-panel');
      if (p) samples.push(alpha(p));
      if (performance.now() - t0 < 300) requestAnimationFrame(tick); else resolve(samples);
    };
    requestAnimationFrame(tick);
  }));
  const panel = page.locator('.composer-actions-panel');
  await panel.waitFor();
  const lowest = frames.length ? Math.min(...frames) : 0;
  check(`${tag} popover is fully opaque from its first frame (${frames.length} frames, lowest composited alpha ${lowest.toFixed(3)})`, frames.length > 0 && lowest >= 0.999);
  await page.waitForTimeout(400);
  const settled = await page.evaluate(() => {
    const p = document.querySelector('.composer-actions-panel');
    const r = p.getBoundingClientRect();
    let composited = 1;
    for (let el = p; el; el = el.parentElement) composited *= parseFloat(getComputedStyle(el).opacity);
    const hits = [];
    for (const fx of [0.1, 0.5, 0.9]) for (const fy of [0.1, 0.5, 0.9]) {
      const el = document.elementFromPoint(r.left + r.width * fx, r.top + r.height * fy);
      hits.push(!!el && !!el.closest('.composer-actions-panel'));
    }
    // The page text the menu covers: the Chat/Task mode bar, where it overlaps the panel.
    const mb = document.querySelector('.composer-mode-bar')?.getBoundingClientRect();
    let textHit = null;
    if (mb && mb.width) {
      const x0 = Math.max(r.left, mb.left), x1 = Math.min(r.right, mb.right), y0 = Math.max(r.top, mb.top), y1 = Math.min(r.bottom, mb.bottom);
      if (x1 > x0 && y1 > y0) {
        const el = document.elementFromPoint((x0 + x1) / 2, (y0 + y1) / 2);
        textHit = !!el && !!el.closest('.composer-actions-panel');
      }
    }
    return { fill: getComputedStyle(p).backgroundColor, composited, insideHits: hits.filter(Boolean).length, insideTotal: hits.length, textHit, shadow: getComputedStyle(p).boxShadow !== 'none' };
  });
  check(`${tag} popover fill is opaque (background ${settled.fill})`, alphaOf(settled.fill) === 1);
  check(`${tag} popover composes to alpha 1 with its ancestors (${settled.composited.toFixed(3)})`, settled.composited === 1);
  check(`${tag} popover hit-tests as itself across its area (${settled.insideHits}/${settled.insideTotal})`, settled.insideHits === settled.insideTotal);
  check(`${tag} page text under the popover is not on top of it`, settled.textHit !== false, `mode-bar text hit: ${settled.textHit}`);
  check(`${tag} popover has an elevation shadow`, settled.shadow);
  await page.screenshot({ path: path.join(SHOTS, `${shot}-menu.png`) });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
}

// #1628 -----------------------------------------------------------------------------------------------
const measure = (page) => page.evaluate(() => {
  const plain = (el) => { const b = el ? el.getBoundingClientRect() : null; return b ? { left: b.left, top: b.top, right: b.right, bottom: b.bottom } : null; };
  const composer = document.querySelector('.chat-composer-inner')?.closest('.composer');
  return {
    composerTop: Math.round(plain(composer)?.top ?? -1),
    details: plain(document.querySelector('.stats-details')),
    send: plain(document.querySelector('.send-btn')),
    textarea: plain(document.querySelector('.chat-composer-inner textarea')),
    composer: plain(composer),
  };
});
// Intersection of two plain rectangles (a zero-size box never intersects).
const inter = (a, b) => !!a && !!b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
const rectText = (rect) => (rect ? JSON.stringify([Math.round(rect.left), Math.round(rect.top), Math.round(rect.right), Math.round(rect.bottom)]) : 'null');

async function checkMetrics(page, tag, shot, width) {
  // On a phone the chat strip is an announcer only; the metrics panel is in the model sheet, a modal over the
  // composer. So the composer-overlap rule is checked on the wide strip, and at phone width that no metrics
  // panel is open over the chat composer.
  if (width < 700) {
    const open = await page.locator('.stats-details:visible').count();
    check(`${tag} no metrics panel is open over the phone composer`, open === 0, `${open} visible`);
    return;
  }
  const toggle = page.locator('.stats-disclosure .stats-more:visible').first();
  if (!(await toggle.count())) { check(`${tag} metrics toggle is present`, false); return; }
  const before = await page.evaluate(() => {
    const composer = document.querySelector('.chat-composer-inner')?.closest('.composer');
    return Math.round(composer.getBoundingClientRect().top);
  });
  await toggle.click();
  await page.waitForTimeout(450);
  const m = await measure(page);
  if (!m.details) { check(`${tag} metrics panel opened`, false); return; }
  const overlapsSend = inter(m.details, m.send);
  const overlapsTextarea = inter(m.details, m.textarea);
  const overlapsComposer = inter(m.details, m.composer);
  check(`${tag} metrics panel does not cover the send button (panel ${rectText(m.details)}, send ${rectText(m.send)})`, !overlapsSend);
  check(`${tag} metrics panel does not cover the textarea`, !overlapsTextarea);
  check(`${tag} metrics panel does not cover the composer block (composer top ${m.composerTop})`, !overlapsComposer);
  check(`${tag} the composer does not move when the metrics panel opens (#1548: ${before} -> ${m.composerTop})`, Math.abs(before - m.composerTop) <= 1);
  const innerH = await page.evaluate(() => innerHeight);
  check(`${tag} metrics panel stays inside the window`, m.details.top >= 0 && m.details.bottom <= innerH + 0.5);
  await page.screenshot({ path: path.join(SHOTS, `${shot}-metrics.png`) });
  await toggle.click();
  await page.waitForTimeout(150);
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const fixture = createFixture(PORT);
  await fixture.listen();
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const pageErrors = [];
  try {
    for (const [width, height] of WIDTHS) for (const family of FAMILIES) for (const theme of THEMES) {
      const tag = `${width}px ${family}/${theme}`;
      const slug = `${width}-${family}-${theme}`;
      const { page, errors } = await openChat(browser, { width, height, family, theme });
      try {
        await checkPopover(page, `#1627 ${tag}`, `composer-1627-${slug}`);
        await checkMetrics(page, `#1628 ${tag}`, `composer-1628-${slug}`, width);
      } finally {
        pageErrors.push(...errors.map((e) => `${tag}: ${e}`));
        await page.close();
      }
    }
  } finally {
    await browser.close();
    await fixture.close?.();
  }
  check('no page errors while the overlays open and close', pageErrors.length === 0, pageErrors.join('; '));
  let failed = 0;
  for (const r of results) {
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${!r.ok && r.detail ? `  [${r.detail}]` : ''}`);
    if (!r.ok) failed += 1;
  }
  console.log(`\ncomposer-overlays-1627-1628: ${results.length - failed}/${results.length} checks passed, screenshots in ${SHOTS}`);
  if (failed) { console.error(`${failed} check(s) failed`); process.exit(1); }
  console.log('composer-overlays-1627-1628: all checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
