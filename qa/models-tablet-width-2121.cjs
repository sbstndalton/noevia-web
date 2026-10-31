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
//
// #2252 (review of web#110): Settings -> Inference machines reuses the same card, and its own four-column rule
// (`.inference-machines .mm-assign-list`, machines.css) out-ranked the container rule, so the Settings card kept four columns
// while its rows took the stacked placement: the status pill sat mid-row. The Settings widths below check the pill is on the label's
// line and at the card's right edge whenever the card is in the stacked layout.
const path = require('node:path');
const assert = require('node:assert/strict');
const { openModelsPage, openModelsTab } = require('./nav.cjs');
const { createState, openPage, run, SHOTS, TAG } = require('./models-state-fixture.cjs');

const SERVICES = ['chatFast', 'chatSmart', 'chatCode', 'vision', 'decision', 'sensitivity', 'embedding', 'reranker', 'ocr', 'documents'];
const MACHINES = {
  machines: [{ id: 'local', builtIn: true, name: null, address: null, services: SERVICES }],
  services: SERVICES.map((id) => ({ id, mode: id.startsWith('chat') ? 'chat' : 'runtime', machine: 'local', enabled: true, url: null })),
  health: { services: { embedding: { state: 'up' } }, machines: { local: 'up' }, reasons: {}, failing: {} },
};
const SETTINGS_WIDTHS = [1600, 1278, 1024, 900, 768, 600, 390];

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
    for (const width of SETTINGS_WIDTHS) {
      const { page, errors } = await openPage(browser, state, { width, height: 1800, theme: 'light' });
      await page.route(/\/api\/models\/machines(\?.*)?$/, (r) => r.fulfill({ json: MACHINES }));
      await page.goto(`${origin}/settings/machines`);
      const list = page.locator('.inference-machines .mm-assign-list');
      await list.waitFor({ timeout: 15000 });
      await check(`Settings ${width} px: each row's status pill is on its label's line, at the card's right edge when stacked`, async () => {
        const bad = await list.evaluate((ul) => {
          const card = ul.getBoundingClientRect();
          // The card's own width decides (the container rule in phone.css stacks it at 900 px and below), not the columns it ended with.
          const stacked = card.width <= 900;
          return [...ul.querySelectorAll('.mm-assign-row')].flatMap((row) => {
            const label = row.querySelector('.mm-assign-label'), pill = row.querySelector(':scope > .mm-state');
            if (!label || !pill) return [];
            const l = label.getBoundingClientRect(), p = pill.getBoundingClientRect();
            const out = [];
            if (Math.abs((p.top + p.bottom) / 2 - (l.top + l.bottom) / 2) > 14) out.push('not on the label line');
            if (p.left < l.right) out.push('left of the label');
            if (stacked && card.right - p.right > 24) out.push(`mid-row (${Math.round(card.right - p.right)} px short of the card edge)`);
            if (p.right > card.right + 1) out.push('outside the card');
            return out.length ? [`${row.dataset.service}: ${out.join(', ')} (${stacked ? 'stacked' : 'wide'} grid ${getComputedStyle(ul).gridTemplateColumns})`] : [];
          });
        });
        assert.deepEqual(bad, []);
      });
      await check(`Settings ${width} px: no horizontal scroll on the page`, async () => {
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
      });
      await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
      await page.waitForTimeout(700);
      if (SHOTS && [1278, 768, 390].includes(width)) await list.screenshot({ path: path.join(SHOTS, `2252-settings-machines-${TAG}-${width}.png`) });
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally { state.close(); }
});
