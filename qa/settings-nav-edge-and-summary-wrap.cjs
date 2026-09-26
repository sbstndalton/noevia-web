// #374 / #423 — geometry proof against a real, headless render (synthetic APIs only, no
// inference/model/diary network calls). A companion to qa/spacing-rhythm.cjs's wider sweep, kept
// as its own small script so it can run fast and standalone against either the built `main` dist
// (to reproduce the two bugs) or this branch's dist (to prove the fix), the way this task's proof
// was captured.
//
//   #374  Settings nav, phone/narrow width (`data-layout` mobile via `@media (max-width: 820px)`
//         and via layout-mode.js's iPhone-UA mobile detection): the "Settings" title must share
//         its left edge with the nav rows' icons and the group labels ("Personal", "Account &
//         connections…") — not sit 12px further out, flush with the column's own outer edge.
//   #423  Settings → Models & routing summary card (`ModelsSummary.tsx`, `/settings/models`):
//         the long "Auto routing" value wraps at narrow widths; every wrapped line must start at
//         the same left edge (ordinary left-aligned paragraph text), not right-align each line
//         independently.
//
// Usage:
//   QA_DIST=/tmp/some-dist QA_SCREENSHOTS=/tmp/noevia-nav-edge-shots \
//   PLAYWRIGHT_MODULE=~/noevia-local-test/node_modules/playwright-core node qa/settings-nav-edge-and-summary-wrap.cjs
// Exits non-zero and prints every finding when either bug reproduces; prints "ok" and exits 0
// when both checks pass. Writes screenshots plus findings.json under QA_SCREENSHOTS for both
// "before" (built from origin/main) and "after" (built from this branch) runs.
const os = require('node:os');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || `${os.homedir()}/noevia-local-test/node_modules/playwright-core`);
const fs = require('node:fs'), path = require('node:path');
const { withLocale } = require('./qa-locale.cjs');
const { createFixture } = require('./diary-fixture.cjs');
const out = process.env.QA_SCREENSHOTS || '/tmp/noevia-nav-edge-shots';
const PORT = Number(process.env.QA_PORT || 31478);
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

// #374: the title's left edge vs. the first nav row's icon left edge and the first group
// label's left edge. All three must land within a hairline (sub-pixel rounding) of each other.
function probeNavEdge() {
  const title = document.querySelector('.settings-nav-title');
  const icon = document.querySelector('.settings-navigation nav button svg');
  const groupLabel = document.querySelector('.settings-navigation nav section h2');
  if (!title || !icon || !groupLabel) return { error: 'missing nav elements', hasTitle: !!title, hasIcon: !!icon, hasGroupLabel: !!groupLabel };
  const t = title.getBoundingClientRect(), i = icon.getBoundingClientRect(), g = groupLabel.getBoundingClientRect();
  return {
    titleLeft: Math.round(t.left * 10) / 10,
    iconLeft: Math.round(i.left * 10) / 10,
    groupLabelLeft: Math.round(g.left * 10) / 10,
    dataLayout: document.documentElement.getAttribute('data-layout'),
  };
}

// #423: every line of the wrapped "Auto routing" value's left edge. Right-aligned wrapped text
// gives each line a different left edge (only the right edges line up); left-aligned text gives
// every line the same left edge.
function probeSummaryWrap() {
  const rows = [...document.querySelectorAll('.mm-summary .model-row')];
  const row = rows.find((r) => /Fast:/.test(r.textContent || ''));
  if (!row) return { error: 'routing row not found', rowCount: rows.length, rowText: rows.map((r) => (r.textContent || '').slice(0, 60)) };
  const value = row.querySelector('.model-role');
  if (!value) return { error: 'model-role value not found in routing row' };
  // `.model-role` is a flex item, so its own getClientRects() collapses to one block-level
  // fragment regardless of how many lines its text wraps to — measure the text node's line
  // fragments through a Range instead, which reports one rect per actual line box.
  const textNode = [...value.childNodes].find((n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim());
  if (!textNode) return { error: 'no text node in model-role value' };
  const range = document.createRange();
  range.selectNodeContents(textNode);
  const rects = [...range.getClientRects()].map((r) => ({ left: Math.round(r.left * 10) / 10, right: Math.round(r.right * 10) / 10 }));
  return { lineCount: rects.length, rects, text: (value.textContent || '').slice(0, 140) };
}

async function withPage(browser, cfg, fn) {
  const page = await browser.newPage(withLocale({
    viewport: { width: cfg.width, height: cfg.height }, reducedMotion: 'reduce', deviceScaleFactor: 1,
    ...(cfg.phone ? { userAgent: IPHONE, isMobile: true, hasTouch: true } : {}),
  }));
  page.setDefaultTimeout(8000);
  await page.addInitScript(() => {
    localStorage.removeItem('noevia:last-view'); sessionStorage.removeItem('noevia-models-tab');
  });
  const user = { id: 'synthetic-nav-edge-qa', username: 'navedgeqa', displayName: 'Synthetic Nav Edge QA', role: 'admin', diaryEnabled: true, onboarded: true };
  await page.route(/\/api\/(auth\/session|profile)$/, (r) => r.fulfill({ json: { user, passkeys: [] } }));
  // Long model names, matching the live report (#423), long enough to force the routing
  // summary's value onto two lines at a 500px-class width.
  await page.route('**/api/auto-roles', (r) => r.fulfill({ json: {
    configured: true,
    roles: { fast: 'gemma-4-E2B_q4_0-it', smart: 'gemma-4-E4B-it-qat-UD-Q4_K_XL', vision: 'Qwen3.5-4B-UD-Q8_K_XL' },
  } }));
  try {
    return await fn(page);
  } finally {
    await page.close();
  }
}

async function run(browser, report) {
  // #374a: a narrow desktop window (no mobile UA) — the live report's own reproduction, purely
  // the `@media (max-width: 820px)` path, `data-layout` stays "desktop".
  await withPage(browser, { width: 500, height: 729 }, async (page) => {
    await page.goto(`http://localhost:${PORT}/settings/appearance`);
    await page.locator('.settings-detail-scroll').first().waitFor();
    await page.getByRole('button', { name: 'All settings' }).first().click();
    await page.getByRole('navigation', { name: 'Settings categories' }).waitFor();
    await page.waitForTimeout(200);
    const result = await page.evaluate(probeNavEdge);
    await page.screenshot({ path: path.join(out, 'nav-edge-narrow-desktop.png') });
    report.push({ check: '374-narrow-desktop-media-query', result });
  });
  // #374b: an iPhone UA — layout-mode.js's own device detection sets data-layout="mobile", the
  // `:root[data-layout="mobile"]` mirror path the CSS comment describes.
  await withPage(browser, { width: 390, height: 844, phone: true }, async (page) => {
    await page.goto(`http://localhost:${PORT}/settings/appearance`);
    await page.locator('.settings-detail-scroll').first().waitFor();
    await page.getByRole('button', { name: 'All settings' }).first().click();
    await page.getByRole('navigation', { name: 'Settings categories' }).waitFor();
    await page.waitForTimeout(200);
    const result = await page.evaluate(probeNavEdge);
    await page.screenshot({ path: path.join(out, 'nav-edge-iphone-ua.png') });
    report.push({ check: '374-iphone-ua-data-layout-mobile', result });
  });
  // #423: the live report's own viewport (500x729), where "Fast/Smart/Vision" wraps to a second
  // line on the Settings → Models & routing summary card.
  await withPage(browser, { width: 500, height: 729 }, async (page) => {
    await page.goto(`http://localhost:${PORT}/settings/models`);
    await page.locator('.mm-summary').first().waitFor();
    await page.waitForTimeout(300);
    const result = await page.evaluate(probeSummaryWrap);
    await page.screenshot({ path: path.join(out, 'summary-wrap-500.png') });
    report.push({ check: '423-summary-wrap-left-align', result });
  });
}

function evaluateFindings(report) {
  const findings = [];
  for (const { check, result } of report) {
    if (result.error) { findings.push({ check, kind: 'probe-error', detail: result }); continue; }
    if (check.startsWith('374-')) {
      const edges = [result.titleLeft, result.iconLeft, result.groupLabelLeft];
      const spread = Math.max(...edges) - Math.min(...edges);
      if (spread > 1) findings.push({ check, kind: 'nav-edge-mismatch', detail: result, spread });
    } else if (check.startsWith('423-')) {
      if (result.lineCount < 2) findings.push({ check, kind: 'no-wrap-in-test', detail: result });
      else {
        const lefts = result.rects.map((r) => r.left);
        const spread = Math.max(...lefts) - Math.min(...lefts);
        if (spread > 1) findings.push({ check, kind: 'summary-right-aligned-wrap', detail: result, spread });
      }
    }
  }
  return findings;
}

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const fixture = createFixture(PORT); await fixture.listen();
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const report = [];
  try {
    await run(browser, report);
  } finally {
    await browser.close(); await fixture.close?.();
  }
  fs.writeFileSync(path.join(out, 'findings.json'), JSON.stringify(report, null, 1));
  const findings = evaluateFindings(report);
  for (const r of report) console.log(`${r.check}:`, JSON.stringify(r.result));
  if (findings.length) {
    console.log(`settings-nav-edge-and-summary-wrap: FAIL (${findings.length} finding(s))`);
    for (const f of findings) console.log(' -', f.check, f.kind, JSON.stringify(f.detail));
    process.exitCode = 1;
  } else {
    console.log('settings-nav-edge-and-summary-wrap: ok — nav edges aligned, summary wrap left-aligned');
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
