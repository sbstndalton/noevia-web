'use strict';
// #2114: Settings → Models and routing → "What each service uses": a long reranker model name ran past the right border of
// its picker and was cut off at the card edge. The name now stays inside the picker (cut with an ellipsis) and its full text
// is the picker's title; the other pickers on the card still show their names whole.
//
// A real browser is needed: the spill is only visible in the rendered page (a source-text test cannot see it). The check
// photographs the strip between the picker's right border and the card edge, hides the picker and photographs the strip
// again; any ink of the picker's text in the strip makes the two pictures differ.
//
// Offline: the app is built from this checkout; the overview and the reranker switch are noevia-core's REAL routes over an
// in-memory store with synthetic everything (models-state-fixture.cjs). No reranker, no model runs, no network.
//   PLAYWRIGHT_MODULE=<playwright-core> QA_DIST=<dist dir> [QA_CORE_SERVER=<core server/>] [QA_SHOTS=<dir>] node qa/models-reranker-overflow-2114.cjs
// Fails on a build without the change, passes with it.
const path = require('node:path');
const assert = require('node:assert/strict');
const { openModelsPage, openModelsTab } = require('./nav.cjs');
const { createState, openPage, run, SHOTS, TAG, RERANK_ENV } = require('./models-state-fixture.cjs');

// The fixture's reranker id (fits a wide screen, not a 200 px picker) and a longer synthetic one.
const NAMES = [RERANK_ENV.RERANK_MODEL, 'synthetic-multilingual-reranker-large-v2-instruct-q8_0'];
const VIEWS = [[1278, 1276, 'light'], [2000, 1250, 'dark'], [1440, 900, 'dark'], [390, 844, 'light']];

/** The strip between the picker's border and the card's inner edge, with and without the picker painted. */
const stripWithAndWithoutPicker = async (page, pick, list) => {
  const handle = await pick.elementHandle();   // a hidden picker drops out of role queries, so keep the element itself
  await handle.scrollIntoViewIfNeeded();
  const box = await handle.boundingBox(), card = await list.boundingBox();
  const x = Math.ceil(box.x + box.width) + 2, right = Math.floor(card.x + card.width) - 2;
  const clip = { x, y: Math.floor(box.y) + 2, width: Math.max(1, right - x), height: Math.floor(box.height) - 4 };
  await page.mouse.move(0, 0);
  const withPicker = await page.screenshot({ clip });
  await handle.evaluate((el) => { el.style.visibility = 'hidden'; });
  const without = await page.screenshot({ clip });
  await handle.evaluate((el) => { el.style.visibility = ''; });
  return { withPicker, without, clip };
};

run('models-reranker-overflow-2114', Number(process.env.QA_PORT || 32114), async (check, browser, origin) => {
  for (const name of NAMES) {
    for (const [width, height, theme] of VIEWS) {
      const tag = `${name.length} chars ${width} px ${theme}`;
      const state = await createState({ rerank: true, rerankModel: name });
      try {
        const { page, errors } = await openPage(browser, state, { width, height, theme });
        const root = await openModelsPage(page, origin, { direct: true });
        await openModelsTab(root, 'Your models');
        const overview = root.getByRole('region', { name: 'What each service uses' });
        const list = overview.locator('.mm-assign-list');
        await list.waitFor({ timeout: 15000 });
        const row = overview.locator('[data-service="reranker"]');
        const pick = row.getByRole('combobox', { name: 'Reranker model' });
        await pick.scrollIntoViewIfNeeded();

        await check(`${tag}: the name does not run past the picker's border into the card edge`, async () => {
          assert.equal(await pick.locator('option:checked').textContent(), name);
          const { withPicker, without, clip } = await stripWithAndWithoutPicker(page, pick, list);
          assert.ok(withPicker.equals(without), `the picker's text is painted outside its box (strip ${JSON.stringify(clip)})`);
          // Whatever does not fit is cut by the picker itself, not by the card.
          const m = await pick.evaluate((el) => ({ overflow: getComputedStyle(el).overflowX, to: getComputedStyle(el).textOverflow, right: el.getBoundingClientRect().right,
            card: el.closest('.mm-assign-list').getBoundingClientRect().right, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
          assert.ok(m.right <= m.card, 'the picker itself stays inside the card');
          if (m.scrollWidth > m.clientWidth) assert.deepEqual([m.overflow, m.to], ['hidden', 'ellipsis'], 'a name that does not fit is truncated with an ellipsis');
        });
        await check(`${tag}: the full name is the picker's title (hover) and the open list`, async () => {
          assert.equal(await pick.getAttribute('title'), name);
          assert.equal(await pick.locator('option').allTextContents().then((all) => all.includes(name)), true);
        });
        await check(`${tag}: the other pickers on the card still show their names whole`, async () => {
          for (const role of ['fast', 'smart', 'code']) {
            const sel = overview.locator(`[data-role="${role}"] select`);
            // The selected name, measured as rendered (the picker's own font), against the room inside the picker
            // (its width less padding and the chevron) ...
            const m = await sel.evaluate((el) => {
              const cs = getComputedStyle(el), c = document.createElement('canvas').getContext('2d');
              c.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
              return { text: c.measureText(el.options[el.selectedIndex].text).width, room: el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 24 };
            });
            assert.ok(m.text <= m.room, `${role} picker has no room for its name (${Math.round(m.text)} px of ${Math.round(m.room)})`);
            // ... and nothing of it is painted outside the picker's box.
            const strip = await stripWithAndWithoutPicker(page, sel, list);
            assert.ok(strip.withPicker.equals(strip.without), `${role} picker paints outside its box`);
          }
        });
        if (SHOTS) {
          // The open list of this picker is the browser's own select list (it is not the themed one the other pickers have).
          await pick.click();
          await page.screenshot({ path: path.join(SHOTS, `2114-reranker-open-${TAG}-${name.length}-${width}-${theme}.png`) });
          await page.keyboard.press('Escape');
        }
        if (SHOTS) await row.screenshot({ path: path.join(SHOTS, `2114-reranker-${TAG}-${name.length}-${width}-${theme}.png`) });
        assert.deepEqual(errors, []);
        await page.close();
      } finally { state.close(); }
    }
  }
});
