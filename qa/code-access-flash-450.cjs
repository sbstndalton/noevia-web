// #450: the top-level Code workspace ("New task", /code) briefly showed the honest-but-wrong
// "not connected yet" stub on every load, before flipping to the real project picker — because
// useCodeAccess probed the placeholder project id '-' (a 404) before the real project list
// arrived, and its result defaulted to `allowed:false` with no "checking" state. Fixed by giving
// useCodeAccess a tri-state ('checking' | 'allowed' | 'denied'); CodingWorkspace now renders a
// neutral loading skeleton while checking, never the stub, for as long as the real answer is
// still in flight.
//
// #458 (same branch, same hook): CodingWorkspace and Sidebar both mount useCodeAccess for the same
// project id on /code, so without a shared cache each fires its own /api/projects/<id>/code probe
// — this script also counts that request and asserts it fires exactly once.
//
// Synthetic fixture only (qa/diary-fixture.cjs): no harness, no repository, no real Diary/corpus.
// A delayed /api/workspace (page.route) stands in for a real network round trip, long enough that
// polling the DOM during the delay reliably catches a stub that would otherwise only flash for a
// second or two in production.
//
// Run: PLAYWRIGHT_MODULE=<playwright-core> QA_DIST=<built dist dir> QA_SCREENSHOTS=<dir> node qa/code-access-flash-450.cjs
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const { createFixture } = require('./diary-fixture.cjs');
const { withLocale } = require('./qa-locale.cjs');

const PORT = 31450;
const origin = `http://localhost:${PORT}`;
const shots = process.env.QA_SCREENSHOTS || '';

const project = (id, name) => ({
  id, name, model: 'synthetic', goal: '', instructions: '', memories: [], files: [], assets: [],
  chats: [], toolboxes: ['core'], createdAt: 1000, updatedAt: 1000, modes: ['chat'],
});

const CODE_STATE = { repositories: [{ id: 'noevia' }], capabilities: [], defaultCapabilities: [], harnesses: [{ id: 'opencode', label: 'OpenCode', version: null }], promptPreparation: [], sandboxed: true, network: false, tasks: [] };

/** A returning admin: feature flags already cached from an earlier visit (App.tsx paints
 *  `showPreviews` from this cache before the /api/features fetch even resolves), the same
 *  condition the live bug report describes ("admin session in Chrome") — a genuinely fresh,
 *  never-visited browser bounces `/code` back to Chat while flags are unknown, a separate,
 *  pre-existing behavior this script does not exercise. */
async function seedFlagsCache(page, flags) {
  await page.addInitScript((f) => localStorage.setItem('noevia:feature-flags', JSON.stringify(f)), flags);
}

/** Polls the DOM for up to `ms`, recording whether `text` was ever present. Used instead of a
 *  single post-hoc check because after settling the stub is gone either way — the point is to
 *  catch it *during* the load, the way the live tester's screenshot-immediately repro did. */
async function watchFor(page, text, ms, stepMs = 40) {
  let seen = false;
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await page.evaluate((t) => document.body && document.body.textContent.includes(t), text)) { seen = true; break; }
    await page.waitForTimeout(stepMs);
  }
  return seen;
}

(async () => {
  const fixture = createFixture(PORT);
  await fixture.listen();
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const errors = [];
  try {
    // ── (a) admin with real Code access: never the stub, never a '-' probe, exactly one request per id ──
    for (const [width, theme] of [[1440, 'light'], [390, 'dark']]) {
      const page = await browser.newPage(withLocale({ viewport: { width, height: width < 768 ? 844 : 900 }, colorScheme: theme, isMobile: width < 768, hasTouch: width < 768 }));
      page.on('pageerror', (e) => errors.push(e.message));
      await seedFlagsCache(page, { previews: true, codeHarness: true });
      const requests = [];
      page.on('request', (req) => { const u = new URL(req.url()); if (u.pathname.startsWith('/api/')) requests.push(u.pathname); });

      let flags = { previews: true, codeHarness: true };
      await page.route('**/api/features', (r) => r.fulfill({ json: { flags } }));
      // A slow, realistic project-list load. Generous on purpose: this script's own steps
      // (evaluates, a screenshot) must fit comfortably inside the window even on a loaded
      // machine, or a slow step — not a real regression — could let the delay elapse first.
      const WORKSPACE_DELAY_MS = 2500;
      await page.route('**/api/workspace', async (r) => {
        await new Promise((res) => setTimeout(res, WORKSPACE_DELAY_MS));
        await r.fulfill({ json: { projects: [project('p1', 'Battery notes'), project('p2', 'Field notes')], freeChats: [] } });
      });
      await page.route('**/api/projects/p1/code**', (r) => r.fulfill({ json: CODE_STATE }));
      await page.route('**/api/projects/p2/code**', (r) => r.fulfill({ json: CODE_STATE }));

      await page.goto(`${origin}/code`);

      // Early in the delay window the project list is still loading: confirm the neutral
      // checking skeleton is what's showing — never the stub, never the (not-yet-real) picker —
      // before doing anything slower (like a screenshot).
      const main = page.locator('.coding-content');
      await page.locator('.coding-checking').waitFor({ timeout: 2000 });
      assert.equal(await page.getByText('not connected yet').count(), 0, `[${width}/${theme}] the stub must not be present while the skeleton shows`);
      assert.equal(await main.getByText('Open a project to run Code').count(), 0, `[${width}/${theme}] the picker must not render before access resolves`);
      if (shots) await page.screenshot({ path: `${shots}/code-access-loading-${width}-${theme}.png` });

      // Keep polling for the rest of the window: the stub must never appear at any point, not
      // just at the one instant checked above.
      const sawStub = await watchFor(page, 'not connected yet', WORKSPACE_DELAY_MS - 300);
      assert.equal(sawStub, false, `[${width}/${theme}] the "not connected yet" stub must never appear while access is checking`);

      // Settle: the real picker with both projects, the confirmed badge, no lingering skeleton.
      // Both the main panel's CodeProjectPicker and Sidebar's own CodingProjectList (#415) now
      // list the same real projects — scope to the main panel to disambiguate.
      await main.getByText('Open a project to run Code').waitFor({ timeout: 5000 });
      await main.getByText('Battery notes').waitFor();
      await main.getByText('Field notes').waitFor();
      // The header badge is hidden on narrow widths (phone.css), so check its text rather than
      // visibility.
      assert.equal(await page.locator('.coding-header .preview-badge').textContent(), 'Runs in a project', `[${width}/${theme}] badge must confirm access once resolved`);
      assert.equal(await page.locator('.coding-checking').count(), 0, `[${width}/${theme}] the checking skeleton must not remain once access resolved`);
      assert.equal(await page.getByText('not connected yet').count(), 0, `[${width}/${theme}] the stub must never have appeared, even after settling`);
      if (shots) await page.screenshot({ path: `${shots}/code-access-loaded-${width}-${theme}.png` });

      assert.ok(!requests.includes('/api/projects/-/code'), `[${width}/${theme}] a placeholder-id probe must never fire, saw: ${requests.join(', ')}`);
      // #458: CodingWorkspace and Sidebar both mount useCodeAccess('p1', ...) here — without the
      // shared cache this would be 2.
      const p1Probes = requests.filter((p) => p === '/api/projects/p1/code').length;
      assert.equal(p1Probes, 1, `[${width}/${theme}] expected exactly one /api/projects/p1/code request (CodingWorkspace + Sidebar deduped), saw ${p1Probes}: ${requests.join(', ')}`);

      console.log(`PASS (a) [${width}/${theme}]: no stub flash, no '-' probe, exactly one /api/projects/p1/code request`);
      await page.close();
    }

    // ── (b) a mocked no-access user: the stub legitimately appears once access resolves to denied ──
    {
      const page = await browser.newPage(withLocale({ viewport: { width: 1440, height: 900 } }));
      page.on('pageerror', (e) => errors.push(e.message));
      await seedFlagsCache(page, { previews: true, codeHarness: true });
      await page.route('**/api/features', (r) => r.fulfill({ json: { flags: { previews: true, codeHarness: true } } }));
      await page.route('**/api/workspace', (r) => r.fulfill({ json: { projects: [project('p1', 'Battery notes')], freeChats: [] } }));
      // The server says no for this real id (a non-admin, or #368's role check) — a genuine denial,
      // not a placeholder-id artifact.
      await page.route('**/api/projects/p1/code**', (r) => r.fulfill({ status: 403, json: { error: 'forbidden' } }));

      await page.goto(`${origin}/code`);
      await page.getByText('not connected yet').waitFor({ timeout: 5000 });
      await page.getByText('Interface preview · no execution').waitFor();
      assert.equal(await page.getByText('Open a project to run Code').count(), 0, 'a denied viewer must never see the project picker');
      console.log('PASS (b) a mocked no-access user (403 for a real id) still sees the honest stub once access resolves');
      await page.close();
    }

    // ── (c) zero projects, once the workspace has actually loaded: denied (the stub), not stuck checking forever ──
    {
      const page = await browser.newPage(withLocale({ viewport: { width: 1440, height: 900 } }));
      page.on('pageerror', (e) => errors.push(e.message));
      await seedFlagsCache(page, { previews: true, codeHarness: true });
      await page.route('**/api/features', (r) => r.fulfill({ json: { flags: { previews: true, codeHarness: true } } }));
      await page.route('**/api/workspace', (r) => r.fulfill({ json: { projects: [], freeChats: [] } }));

      await page.goto(`${origin}/code`);
      await page.getByText('not connected yet').waitFor({ timeout: 5000 });
      console.log('PASS (c) zero projects (workspace loaded, empty) settles to the honest stub, not an endless checking state');
      await page.close();
    }

    assert.deepEqual(errors, [], 'no uncaught page errors');
    console.log('PASS code-access-flash-450: #450 (checking state, no stub flash, no placeholder probe) and #458 (one request per id) — 1440/390, light/dark');
  } finally {
    await browser.close();
    await fixture.close();
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
