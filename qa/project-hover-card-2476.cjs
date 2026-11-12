'use strict';
// sbstndalton/noevia#2476: the sidebar's project hover card was drawn under the main pane (it sat in the sidebar's stacking
// context), so a long name was cut off at the sidebar's edge. The card now keeps inside the viewport, is not hidden behind
// another pane and does not cover its row. First and last sidebar project, 375/768 px, light and dark.
// Fails on a build of main, passes with the change.
const assert = require('node:assert/strict');
const { VIEWS, themedPage, shot, run } = require('./ui-batch-harness.cjs');

const LONG = 'QA-2476 ' + 'quarterly planning workstream '.repeat(4).trim().slice(0, 112);
const projects = Array.from({ length: 6 }, (_, i) => ({
  id: `qa2476-${i}`, name: i === 0 || i === 5 ? LONG + ` ${i}` : `QA-2476 project ${i}`, goal: 'Synthetic goal for the hover card', instructions: '', memories: [],
  files: [{ name: 'qa-notes-one.md' }, { name: 'qa-notes-two.md' }], chats: [], updatedAt: 9000 - i,
}));

run('project-hover-card-2476', Number(process.env.QA_PORT || 32476), async (check, browser, origin) => {
  for (const view of VIEWS) {
    await check(`${view[0]} px ${view[2]}: card inside the viewport, visible, off its row (first and last project)`, async () => {
      const page = await themedPage(browser, view);
      try {
        await page.route('**/api/workspace', (r) => r.fulfill({ json: { projects, freeChats: [] } }));
        await page.goto(origin);
        await page.getByRole('button', { name: 'Send', exact: true }).waitFor({ timeout: 20000 });
        const toggle = page.getByRole('button', { name: 'Open navigation', exact: true });
        if (await toggle.isVisible()) await toggle.click();
        const rows = page.locator('.project-disclosure').filter({ visible: true });
        await rows.first().waitFor({ timeout: 15000 });
        const n = await rows.count();
        for (const [label, row] of [['first', rows.first()], ['last', rows.nth(n - 1)]]) {
          await row.scrollIntoViewIfNeeded();
          await page.mouse.move(1, 1);
          await row.hover();
          await page.locator('.row-card').waitFor({ timeout: 4000 });
          await page.waitForTimeout(400); // past the enter animation
          const r = await page.evaluate(() => {
            const card = document.querySelector('.row-card'), c = card.getBoundingClientRect(), a = document.querySelector('.project-disclosure:hover');
            const row = (a || document.querySelector('.project-disclosure')).getBoundingClientRect();
            // The card ignores the pointer, so turn that off for a moment: the element found at each point must be the card itself.
            card.style.pointerEvents = 'auto';
            const pts = [[c.left + 4, c.top + 4], [c.right - 4, c.top + 4], [c.left + 4, c.bottom - 4], [c.right - 4, c.bottom - 4], [(c.left + c.right) / 2, (c.top + c.bottom) / 2]];
            const hidden = pts.filter(([x, y]) => !card.contains(document.elementFromPoint(x, y))).length;
            card.style.pointerEvents = '';
            const overlap = c.left < row.right && c.right > row.left && c.top < row.bottom && c.bottom > row.top;
            return { c: { l: c.left, t: c.top, r: c.right, b: c.bottom }, vw: innerWidth, vh: innerHeight, hidden, overlap };
          });
          assert.ok(r.c.l >= 0 && r.c.t >= 0 && r.c.r <= r.vw && r.c.b <= r.vh, `${label}: card ${JSON.stringify(r.c)} outside ${r.vw}x${r.vh}`);
          assert.equal(r.hidden, 0, `${label}: ${r.hidden} of 5 points of the card are covered by another element`);
          assert.equal(r.overlap, false, `${label}: the card covers its row`);
          await shot(page, `hover-card-${label}-${view[0]}-${view[2]}`);
        }
      } finally { await page.close(); }
    });
  }
  // The 1280 px layout from the issue, one theme.
  await check('1280 px light: card beside the row, inside the viewport, not hidden', async () => {
    const page = await themedPage(browser, [1280, 800, 'light']);
    try {
      await page.route('**/api/workspace', (r) => r.fulfill({ json: { projects, freeChats: [] } }));
      await page.goto(origin);
      const row = page.locator('.project-disclosure').filter({ visible: true }).first();
      await row.waitFor({ timeout: 20000 });
      await row.hover();
      await page.locator('.row-card').waitFor({ timeout: 4000 });
      await page.waitForTimeout(400);
      const r = await page.evaluate(() => {
        const card = document.querySelector('.row-card'), c = card.getBoundingClientRect();
        card.style.pointerEvents = 'auto';
        const hidden = [[c.right - 4, c.top + 4], [c.right - 4, c.bottom - 4]].filter(([x, y]) => !card.contains(document.elementFromPoint(x, y))).length;
        return { r: c.right, b: c.bottom, hidden, vw: innerWidth, vh: innerHeight };
      });
      assert.ok(r.r <= r.vw && r.b <= r.vh, 'inside the viewport');
      assert.equal(r.hidden, 0, 'right-hand corners of the card are covered by another element');
      await shot(page, 'hover-card-first-1280-light');
    } finally { await page.close(); }
  });
});
