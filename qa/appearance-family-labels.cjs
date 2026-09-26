// #420: Settings -> Appearance's three theme-family radio tiles (Editorial/Contemporary/Glass)
// each carry a live preview (mock chat UI, in light and dark) inside them. The preview root is
// aria-hidden, but Chrome's real accessible-name computation still folded its text into the
// tile's name — ~200 characters of identical filler before the one word that actually
// distinguishes the three. Offline: synthetic Settings only, no inference/storage/network.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const { createFixture } = require('./diary-fixture.cjs');
const { withLocale } = require('./qa-locale.cjs');

(async () => {
  const fixture = createFixture(31472);
  await fixture.listen();
  const browser = await chromium.launch({ headless: true, channel: process.env.QA_CHANNEL || 'chrome' });
  let passed = 0;
  const pass = (msg) => { passed += 1; console.log(`PASS appearance-family-labels: ${msg}`); };
  try {
    const page = await browser.newPage(withLocale({ viewport: { width: 1440, height: 950 } }));
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/api/workspace', (r) => r.fulfill({ json: { projects: [], freeChats: [] } }));

    await page.goto('http://localhost:31472');
    await page.getByPlaceholder('Message noevia…').waitFor();
    await page.getByTitle('Settings', { exact: true }).click();
    const dialog = page.getByRole('region', { name: 'Settings' });
    await dialog.getByRole('button', { name: 'Appearance & language', exact: true }).click();
    await dialog.getByRole('heading', { name: 'Appearance & language', level: 1 }).waitFor();

    const group = dialog.getByRole('radiogroup', { name: 'Family' });
    await group.waitFor();
    const tiles = group.getByRole('radio');
    assert.equal(await tiles.count(), 3, 'three family tiles');

    // The whole point: each tile's accessible name is short and starts with its own label, not
    // ~200 characters of the two previews' shared mock chat text ("noevia Good evening
    // Summarise the notes Message noevia… Chat Cowork Save Cancel", doubled for light+dark).
    const expected = [
      { name: 'Editorial', hint: /serif display face/ },
      { name: 'Contemporary', hint: /tonal surfaces/ },
      { name: 'Glass', hint: /Frosted, translucent/ },
    ];
    // Playwright's getByRole already computes the real accessible name (per the accname spec,
    // aria-labelledby/aria-label take priority over name-from-content) to do its own matching
    // above; recompute it here the same way, rather than naively reading textContent, which
    // would ignore aria-labelledby entirely and always "see" the hidden preview text.
    const accessibleName = (el) => {
      const labelledBy = el.getAttribute('aria-labelledby');
      if (labelledBy) return labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent || '').join(' ').trim();
      return el.getAttribute('aria-label') || el.textContent;
    };
    for (const { name, hint } of expected) {
      const tile = dialog.getByRole('radio', { name });
      await tile.waitFor();
      const accName = await tile.evaluate(accessibleName);
      assert.ok(!/Good evening/.test(accName) && !/Summarise the notes/.test(accName) && !/Message noevia/.test(accName),
        `"${name}" tile's accessible name must not include the preview's mock chat text: ${JSON.stringify(accName)}`);
      assert.ok(accName.length < 200, `"${name}" tile's accessible name must be concise, got ${accName.length} chars: ${JSON.stringify(accName)}`);
      assert.match(accName, hint, `"${name}" tile's accessible name should still carry its real description`);
      // getByRole with an exact-enough name must actually resolve to exactly one tile — this is
      // the practical AT-navigation consequence of the bug: three tiles whose names all started
      // identically were not distinguishable by name-based lookup either.
      assert.equal(await dialog.getByRole('radio', { name }).count(), 1, `"${name}" must resolve to exactly one tile by name`);
    }
    pass('each family tile has a concise accessible name naming only itself, not the previews\' mock chat text');

    // The preview content itself must be excluded from the accessibility tree, not just styled
    // away — a screen reader arrowing through the group must never land inside a preview.
    const hiddenPreview = await group.locator('.family-tile-previews').first().getAttribute('aria-hidden');
    assert.equal(hiddenPreview, 'true', 'the previews wrapper must be aria-hidden');
    pass('the live preview content is aria-hidden');

    // Arrow-key roving still works and still lands on a tile whose accessible name is correct.
    await dialog.getByRole('radio', { name: 'Editorial' }).focus();
    await page.keyboard.press('ArrowRight');
    const focusedName = await page.evaluate(() => {
      const el = document.activeElement;
      const labelledBy = el?.getAttribute('aria-labelledby');
      if (labelledBy) return labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent || '').join(' ').trim();
      return el?.getAttribute('aria-label') || el?.textContent || '';
    });
    assert.match(focusedName, /Contemporary/, 'arrow-key roving still moves to the next tile, with its own accessible name');
    pass('arrow-key roving between tiles still works, each landing on its own correctly-named tile');

    assert.deepEqual(errors, [], 'no page errors');
    console.log(`PASS appearance-family-labels: all ${passed} scenarios.`);
    await page.close();
  } finally {
    await browser.close();
    await fixture.close();
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
