'use strict';
// sbstndalton/noevia#2459 and #2460: the Models page tab strip. At 375 px 'Advanced' ran past the strip edge (scrollWidth 359 > clientWidth
// 343) with no cue, and the tabs did not move with the arrow keys. Now all four tabs fit at 375 px in en-GB; where a locale's labels
// still overflow, the strip scrolls with an edge fade and the selected tab is fully visible. ArrowLeft/ArrowRight wrap, Home/End jump,
// only the selected tab is in the Tab order. Offline, synthetic admin (ui-batch-harness.cjs). Fails on a build of main, passes with the change.
const assert = require('node:assert/strict');
const { VIEWS, themedPage, shot, run, mockModelsApi } = require('./ui-batch-harness.cjs');
const { withLocale } = require('./qa-locale.cjs');
const { openModelsPage } = require('./nav.cjs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const LOCALES = ['en-GB', 'en-US', 'de-DE', 'es-ES', 'fr-FR', 'it-IT', 'nb-NO', 'nl-NL', 'pt-BR', 'sv-SE'];
const ROW = '.mm-tabs-row';

/** Per tab: is it inside the strip's visible box? (a 1 px tolerance for rounding) */
const clipped = (page) => page.evaluate((sel) => {
  const row = document.querySelector(sel), box = row.getBoundingClientRect();
  return [...row.querySelectorAll('[role=tab]')].map((tab) => { const r = tab.getBoundingClientRect(); return { label: tab.textContent, clipped: r.left < box.left - 1 || r.right > box.right + 1 }; });
}, ROW);

async function open(page, origin) {
  await mockModelsApi(page);
  const root = await openModelsPage(page, origin, { direct: true });
  await root.locator(ROW).waitFor();
  return root;
}

run('models-tabs-2459-2460', Number(process.env.QA_PORT || 32459), async (check, browser, origin) => {
  for (const view of VIEWS) {
    await check(`${view[0]} px ${view[2]}: all four tabs are inside the strip (en-GB)`, async () => {
      const page = await themedPage(browser, view);
      try {
        await open(page, origin);
        const tabs = await clipped(page);
        assert.equal(tabs.length, 4);
        assert.deepEqual(tabs.filter((t) => t.clipped).map((t) => t.label), [], 'no tab is clipped');
        await shot(page, `models-tabs-${view[0]}-${view[2]}`);
      } finally { await page.close(); }
    });
  }
  for (const locale of LOCALES) {
    await check(`375 px ${locale}: the last tab, once selected, is fully visible; an overflowing strip shows the fade`, async () => {
      const page = await browser.newPage(withLocale({ viewport: { width: 375, height: 812 }, locale }));
      try {
        await open(page, origin);
        await page.locator(`${ROW} [role=tab]`).last().click();
        await page.waitForTimeout(150);
        const state = await page.evaluate((sel) => { const row = document.querySelector(sel); return { over: row.scrollWidth > row.clientWidth, fadeStart: row.dataset.fadeStart, fadeEnd: row.dataset.fadeEnd }; }, ROW);
        const selected = (await clipped(page))[3];
        assert.equal(selected.clipped, false, `selected tab "${selected.label}" is fully visible`);
        if (state.over) assert.equal(state.fadeStart, 'true', 'overflowing strip fades the scrolled-off start');
        else assert.notEqual(state.fadeEnd, 'true');
        console.log(`  ${locale}: overflow=${state.over}`);
      } finally { await page.close(); }
    });
  }
  await check('arrow keys: right/left wrap, Home/End jump, selection and focus follow, only the selected tab is tabbable', async () => {
    const page = await themedPage(browser, [1280, 800, 'light']);
    try {
      await open(page, origin);
      const tabs = page.locator(`${ROW} [role=tab]`);
      const selectedLabel = async () => page.locator(`${ROW} [role=tab][aria-selected=true]`).textContent();
      const focused = async () => page.evaluate(() => document.activeElement?.textContent);
      assert.deepEqual(await tabs.evaluateAll((els) => els.map((e) => e.tabIndex)), [0, -1, -1, -1], 'roving tab stop');
      await tabs.first().focus();
      for (const [key, want] of [['ArrowRight', 'Routing'], ['ArrowRight', 'Performance'], ['ArrowRight', 'Advanced'], ['ArrowRight', 'Models'], ['ArrowLeft', 'Advanced'], ['Home', 'Models'], ['End', 'Advanced']]) {
        await page.keyboard.press(key);
        assert.equal(await focused(), want, `${key}: focus on ${want}`);
        assert.equal(await selectedLabel(), want, `${key}: ${want} selected`);
      }
      assert.deepEqual(await tabs.evaluateAll((els) => els.map((e) => e.tabIndex)), [-1, -1, -1, 0]);
      await page.keyboard.press('Tab');
      assert.notEqual(await page.evaluate(() => document.activeElement?.getAttribute('role')), 'tab', 'Tab leaves the tab list');
    } finally { await page.close(); }
  });
});
