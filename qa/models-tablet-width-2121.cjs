'use strict';
// #2121: Settings → Models and routing → "What each service uses" at a tablet-width window (769 px and below
// down to the phone layout). The card switched to its stacked layout only at 720 px, but its four grid columns need
// ~780 px, so at 768 px the controls column collapsed to zero width and sat outside the card's right edge. Every
// service's controls (the reranking switch and picker, "Turn embedding off", the caption notes) must be visible and inside the card at every width.
//
// A real browser is needed: the collapse is only visible in computed layout. Offline: the app is built from this checkout over
// noevia-core's real routes with synthetic inputs (models-state-fixture.cjs). No model runs, no network.
//   PLAYWRIGHT_MODULE=<playwright-core> QA_DIST=<dist dir> [QA_CORE_SERVER=<core server/>] [QA_SHOTS=<dir>] node qa/models-tablet-width-2121.cjs
// Fails on a build without the change, passes with it.
const path = require('node:path');
const assert = require('node:assert/strict');
const { openModelsPage, openModelsTab } = require('./nav.cjs');
const { createState, openPage, run, SHOTS, TAG } = require('./models-state-fixture.cjs');

const WIDTHS = [1600, 1278, 1200, 1100, 1024, 900, 800, 768, 740, 721, 720, 600, 390];

run('models-tablet-width-2121', Number(process.env.QA_PORT || 32121), async (check, browser, origin) => {
  const state = await createState({ rerank: true });
  try {
    for (const width of WIDTHS) {
      const { page, errors } = await openPage(browser, state, { width, height: 1800, theme: 'light' });
      const root = await openModelsPage(page, origin, { direct: true });
      await openModelsTab(root, 'Your models');
      const overview = root.getByRole('region', { name: 'What each service uses' });
      const list = overview.locator('.mm-assign-list');
      await list.waitFor({ timeout: 15000 });
      await check(`${width} px: every row's controls are visible and inside the card`, async () => {
        const card = await list.boundingBox();
        const rows = await overview.locator('.mm-assign-row').count();
        assert.ok(rows >= 4, `${rows} rows`);
        const bad = await overview.locator('.mm-assign-row').evaluateAll((els) => els.flatMap((row) => {
          const card = row.closest('.mm-assign-list').getBoundingClientRect();
          return [...row.querySelectorAll('.mm-assign-control, .mm-assign-control select, .mm-assign-control .noevia-switch, .mm-assign-control button, .mm-assign-reranker')].flatMap((el) => {
            const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
            if (cs.display === 'none') return [];
            const out = [];
            if (r.width < 24 && !(el.matches('.mm-assign-control') && !el.textContent.trim() && !el.querySelector('select,button,input'))) out.push('too narrow');
            if (r.right > card.right + 1 || r.left < card.left - 1) out.push('outside the card');
            return out.length ? [`${row.dataset.service || row.dataset.role}: ${el.className || el.tagName} ${out.join(', ')} (${Math.round(r.left)}..${Math.round(r.right)} vs card ${Math.round(card.left)}..${Math.round(card.right)})`] : [];
          });
        }));
        assert.deepEqual(bad, []);
        assert.ok(card.width > 0);
      });
      await check(`${width} px: no horizontal scroll on the page`, async () => {
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
      });
      if (SHOTS && [1278, 1024, 768, 390].includes(width)) await overview.screenshot({ path: path.join(SHOTS, `2121-services-${TAG}-${width}.png`) });
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally { state.close(); }
});
