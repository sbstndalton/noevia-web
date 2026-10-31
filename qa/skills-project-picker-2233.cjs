'use strict';
// #2233: Customise → Skills → "In a project": the Project picker with a 120-character project name (the longest the server
// allows, #398) ran past the select's box, out of the 730 px content column and, on a phone, off the screen.
// The picker must stay inside the content column and cut the name with an ellipsis.
// A real browser is needed (the spill only shows in the rendered page). Synthetic APIs: /api/workspace with one such project,
// that project's instruction-skills (none) and the directory (none); both shapes are those of the real routes.
//   PLAYWRIGHT_MODULE=<playwright-core> QA_DIST=<dist dir> [QA_CORE_SERVER=<core server/>] [QA_SHOTS=<dir>] node qa/skills-project-picker-2233.cjs
// Fails on a build without the change, passes with it.
const assert = require('node:assert/strict');
const { run, openPage, shot, IPHONE, DESKTOP } = require('./web-fixes-lib.cjs');

// Both shapes: one unbreakable word (the QA round's) and a long sentence.
const NAMES = ['x'.repeat(120), 'Zebra migration research programme — quarterly review of every herd, crossing, water source and fence line across the northern plains region'.slice(0, 120)];
const project = (id, name) => ({ id, name, model: 'qa-model', instructions: '', files: [], assets: [], toolboxes: [], chats: [] });

const mock = (NAME) => (page) => Promise.all([
  page.route('**/api/workspace', (r) => r.fulfill({ json: { projects: [project('p-long', NAME), project('p-short', 'Short')], freeChats: [] } })),
  page.route('**/api/projects/*/instruction-skills', (r) => r.fulfill({ json: { skills: [] } })),
  page.route('**/api/plugins/directory**', (r) => r.fulfill({ json: { items: [], source: { label: 'QA', home: 'https://example.invalid' } } })),
]);

run('skills-project-picker-2233', Number(process.env.QA_PORT || 32233), async (check, browser, origin) => {
  for (const NAME of NAMES) for (const view of [{ name: '1440', options: DESKTOP }, { name: 'iphone', options: IPHONE }]) {
    for (const theme of ['light', 'dark']) {
      await check(`${NAME.length} chars ${NAME.includes(' ') ? 'words' : 'one word'} ${view.name} ${theme}: the Project picker stays inside the content column, name cut with an ellipsis`, async () => {
        const { page, context, errors } = await openPage(browser, view, theme, { mock: mock(NAME) });
        await page.goto(`${origin}/customise/skills`);
        const select = page.locator('.plugins-project-picker select');
        await select.waitFor();
        await page.getByRole('status').filter({ hasText: /No skills|no skills/i }).first().waitFor({ timeout: 5000 }).catch(() => undefined);
        assert.equal(await select.locator('option:checked').textContent(), NAME);
        const m = await select.evaluate((el) => {
          const r = el.getBoundingClientRect(), col = el.closest('.plugins-directory').getBoundingClientRect(), cs = getComputedStyle(el);
          return { left: r.left, right: r.right, colLeft: col.left, colRight: col.right, vw: innerWidth, docW: document.documentElement.scrollWidth,
            overflow: cs.overflowX, to: cs.textOverflow, scrollW: el.scrollWidth, clientW: el.clientWidth };
        });
        assert.ok(m.right <= m.colRight + 1, `the picker ends at ${Math.round(m.right)} px, past its column's edge at ${Math.round(m.colRight)} px`);
        assert.ok(m.right <= m.vw, `the picker (and its chevron) ends at ${Math.round(m.right)} px, off the ${m.vw} px screen`);
        assert.ok(m.docW <= m.vw, `the page scrolls sideways (${m.docW} px of ${m.vw})`);
        // Nothing of the name is painted beyond the picker's right border: photograph the strip beside it with and without the picker.
        const box = await select.boundingBox(), edge = Math.min(m.colRight, m.vw);
        if (edge - (box.x + box.width) > 6) {
          const clip = { x: Math.ceil(box.x + box.width) + 2, y: Math.floor(box.y) + 2, width: Math.floor(edge - box.x - box.width) - 4, height: Math.floor(box.height) - 4 };
          const withPicker = await page.screenshot({ clip });
          await select.evaluate((el) => { el.style.visibility = 'hidden'; });
          const without = await page.screenshot({ clip });
          await select.evaluate((el) => { el.style.visibility = ''; });
          assert.ok(withPicker.equals(without), 'the name is painted outside the picker');
        }
        await shot(page, `2233-skills-picker-${NAME.includes(' ') ? 'words' : 'one-word'}-${view.name}-${theme}`);
        assert.deepEqual(errors, []);
        await context.close();
      });
    }
  }
});
