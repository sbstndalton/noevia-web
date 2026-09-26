// #429/#430 regression guard: every view has exactly one visible <h1>, and no visible heading
// level is skipped (h1 -> h2 -> h3 -> h4, never straight from h1 to h3). Against synthetic APIs
// only (no model, no inference, no live services). Serves the built app from ../dist.
//   PLAYWRIGHT_MODULE=~/noevia-local-test/node_modules/playwright-core node qa/heading-hierarchy.cjs
// Reproduces the exact live-tester repro steps from both issues: querying every h1-h4, filtered
// to elements that are actually visible (offsetHeight > 0, visibility !== 'hidden').
const os = require('node:os');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || `${os.homedir()}/noevia-local-test/node_modules/playwright-core`);
const assert = require('node:assert/strict');
const { createFixture } = require('./diary-fixture.cjs');
const PORT = 31497;

function collectHeadings() {
  return [...document.querySelectorAll('h1,h2,h3,h4')]
    .filter((h) => h.offsetHeight > 0 && getComputedStyle(h).visibility !== 'hidden')
    .map((h) => ({ level: Number(h.tagName[1]), text: (h.textContent || '').trim().slice(0, 60) }));
}

// #429: exactly one visible h1 identifying the page.
function assertOneH1(headings, tag) {
  const h1s = headings.filter((h) => h.level === 1);
  assert.equal(h1s.length, 1, `${tag}: expected exactly one visible h1, found ${h1s.length} (${JSON.stringify(headings)})`);
}

// #430: no skipped level once headings start (h1 -> h3 with no h2 in between is the reported bug).
function assertNoSkippedLevel(headings, tag) {
  let prev = headings[0]?.level ?? 1;
  for (const h of headings.slice(1)) {
    assert.ok(h.level <= prev + 1, `${tag}: heading level jumps from h${prev} to h${h.level} (${JSON.stringify(headings)})`);
    prev = h.level;
  }
}

(async () => {
  const fixture = createFixture(PORT); await fixture.listen();
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce', deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const user = { id: 'synthetic-heading-qa', username: 'headingqa', displayName: 'Heading QA', role: 'admin', diaryEnabled: true, onboarded: true };
    await page.route(/\/api\/(auth\/session|profile)$/, (r) => r.fulfill({ json: { user, passkeys: [] } }));
    await page.route('**/api/workspace', (r) => r.fulfill({ json: { projects: [], freeChats: [] } }));
    // #430's fixture: several installed models, so LibraryTab actually renders model cards
    // (the reported h1 -> h3 skip only shows up once there is something to render below the
    // page title — an empty "Your models" list has no h3 at all).
    const models = [
      { name: 'gemma-4-E2B_q4_0-it', labels: [], loaded: true, sizeGB: 3, maxContext: 131072, source: 'preset', canDelete: false, status: 'loaded' },
      { name: 'Qwen3.5-9B-UD-Q4_K_XL', labels: ['vision'], loaded: false, sizeGB: 5.6, maxContext: 262144, source: 'preset', canDelete: false, status: 'unloaded' },
    ];
    await page.route('**/api/**', (route) => {
      const p = new URL(route.request().url()).pathname;
      const json = (body) => route.fulfill({ json: body });
      if (p === '/api/models/installed') return json(models);
      if (p === '/api/models/capabilities') return json({ kind: 'llamacpp', admin: true, presets: true, download: true, runtimeOptions: false, modelManagement: true });
      if (p.startsWith('/api/model-manager/')) return json({});
      if (p.startsWith('/api/models/')) return json([]);
      return route.continue();
    });

    // #429: Home / new-chat view (/) — no <h1> at all on main, only the empty-state H2 and the
    // "Recent chats" H2.
    await page.goto(`http://localhost:${PORT}/`);
    await page.getByText("What’s on your mind?").waitFor({ timeout: 8000 });
    await page.waitForTimeout(300);
    const home = await page.evaluate(collectHeadings);
    assertOneH1(home, '/');
    assertNoSkippedLevel(home, '/');
    assert.equal(home[0]?.level, 1, `/: first visible heading should be the h1, got ${JSON.stringify(home[0])}`);

    // #430: /models (Your models tab) — h1 "Models & routing" followed directly by h3 model
    // cards, no h2 anywhere.
    await page.goto(`http://localhost:${PORT}/models`);
    await page.locator('.model-card-name').first().waitFor({ timeout: 8000 });
    await page.waitForTimeout(300);
    const models_ = await page.evaluate(collectHeadings);
    assertOneH1(models_, '/models');
    assertNoSkippedLevel(models_, '/models');
    assert.ok(models_.some((h) => h.level === 3), `/models: expected at least one visible h3 (model cards): ${JSON.stringify(models_)}`);

    assert.deepEqual(errors, []);
    console.log(`PASS heading-hierarchy: / (${home.length} headings), /models (${models_.length} headings) — one h1, no skipped level.`);
  } finally { await browser.close(); await fixture.close?.(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
