'use strict';
// sbstndalton/noevia#2461: at 375 px the chat/code switch in the open navigation drawer's header drew as a faded double box over the
// close-button row. The phone tap-target rule made its buttons 44 px tall inside a 30 px track, so the glass thumb and the buttons
// spilled out of the track. The drawer's own switch (the only one on the page) now sizes its track to its 44 px buttons: thumb and buttons
// sit inside the track, the track clears the close button and logo, and a tap inside the track lands on a switch button.
// Offline (diary-fixture.cjs serves the build). Fails on a build of main, passes with the change.
const assert = require('node:assert/strict');
const { themedPage, shot, run } = require('./ui-batch-harness.cjs');

run('phone-drawer-mode-switch-2461', Number(process.env.QA_PORT || 32461), async (check, browser, origin) => {
  for (const view of [[375, 812, 'light'], [375, 812, 'dark'], [320, 640, 'light']]) {
    await check(`${view[0]} px ${view[2]}: the open drawer's mode switch is drawn inside its track, clear of the header controls`, async () => {
      const page = await themedPage(browser, view);
      try {
        await page.route('**/api/features', (r) => r.fulfill({ json: { flags: { previews: true } } }));
        await page.goto(origin);
        await page.getByPlaceholder('Message noevia…').waitFor();
        await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
        const drawer = page.getByRole('dialog', { name: 'Navigation' });
        await drawer.waitFor();
        await page.waitForTimeout(700);
        const m = await page.evaluate(() => {
          const sw = document.querySelector('.sidebar .app-mode-switch'), box = sw.getBoundingClientRect(), r = (e) => e.getBoundingClientRect();
          const inside = (e) => { const q = r(e); return q.left >= box.left - 1 && q.right <= box.right + 1 && q.top >= box.top - 1 && q.bottom <= box.bottom + 1; };
          const head = document.querySelector('.sidebar .shell-sidebar-head'), close = head.querySelector('.side-expand'), logo = head.querySelector('.side-logo');
          const apart = (e) => { const q = r(e); return q.right <= box.left + 1 || q.left >= box.right - 1; };
          const centre = (e) => { const q = r(e); const hit = document.elementFromPoint(q.x + q.width / 2, q.y + q.height / 2); return !!hit && e.contains(hit); };
          return {
            count: document.querySelectorAll('.app-mode-switch').length,
            buttons: [...sw.querySelectorAll('button')].map(inside), thumbInside: inside(sw.querySelector('.glass-thumb')),
            clearOfClose: apart(close), clearOfLogo: apart(logo), hits: [...sw.querySelectorAll('button')].map(centre),
            headBottom: r(head).bottom, track: [box.top, box.bottom],
          };
        });
        assert.equal(m.count, 1, 'one mode switch on the page');
        assert.deepEqual(m.buttons, [true, true], 'both segments inside the track');
        assert.equal(m.thumbInside, true, 'the glass thumb stays inside the track');
        assert.equal(m.clearOfClose && m.clearOfLogo, true, 'the track does not overlap the close button or logo');
        assert.deepEqual(m.hits, [true, true], 'the centre of each segment hits that segment');
        await shot(page, `drawer-mode-switch-${view[0]}-${view[2]}`);
        // The switch still works from the drawer: Code closes the drawer and opens the Code workspace.
        await page.getByRole('button', { name: 'Code', exact: true }).first().click();
        await drawer.waitFor({ state: 'hidden', timeout: 5000 });
      } finally { await page.close(); }
    });
  }
});
