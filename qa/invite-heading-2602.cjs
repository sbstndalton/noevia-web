'use strict';
// sbstndalton/noevia#2602: at 375 px the invitation page's heading "Create your noevia account" wraps to two lines, and its
// computed line-height was 20 px for a 26 px font, so the lines nearly touched. The heading now keeps a line-height of
// at least 1.15 times its font size (the display face's own rhythm), at every width, light and dark, and on the sign-in and
// password-reset pages too. Offline: the fixture serves the build; the session answers 401 so the page shows the invitation form.
//   PLAYWRIGHT_MODULE=<playwright-core> QA_CHROME_PATH=<Chrome> QA_DIST=<dist> QA_CORE_SERVER=<core server/> [QA_SHOTS=<dir>] node qa/invite-heading-2602.cjs
const assert = require('node:assert/strict');
const { themedPage, shot, run } = require('./ui-batch-harness.cjs');

const VIEWS = [[375, 812, 'light'], [375, 812, 'dark'], [1280, 800, 'light'], [1280, 800, 'dark']];
const PAGES = [
  ['invitation', '/?invite=qa-2602-token', 'Create your noevia account'],
  ['sign-in', '/', 'Sign in to noevia'],
  ['password reset', '/?recovery=qa-2602-token', 'Reset your password'],
];

run('invite-heading-2602', Number(process.env.QA_PORT || 32602), async (check, browser, origin) => {
  for (const view of VIEWS) {
    for (const [label, route, heading] of PAGES) {
      await check(`${view[0]} px ${view[2]}: the ${label} heading keeps a readable line-height`, async () => {
        const page = await themedPage(browser, view);
        try {
          await page.route('**/api/auth/session', (r) => r.fulfill({ status: 401, json: { error: 'Not signed in' } }));
          await page.route('**/api/profile', (r) => r.fulfill({ status: 401, json: { error: 'Not signed in' } }));
          await page.goto(origin + route);
          const h1 = page.getByRole('heading', { level: 1, name: heading });
          await h1.waitFor({ timeout: 15000 });
          const m = await h1.evaluate((el) => {
            const cs = getComputedStyle(el), fontSize = parseFloat(cs.fontSize);
            const lineHeight = cs.lineHeight === 'normal' ? fontSize * 1.2 : parseFloat(cs.lineHeight);
            return { fontSize, lineHeight, lines: Math.round(el.getBoundingClientRect().height / lineHeight), box: el.getBoundingClientRect().width };
          });
          assert.ok(m.lineHeight >= m.fontSize * 1.15, `line-height ${m.lineHeight}px for a ${m.fontSize}px font (${m.lines} line${m.lines === 1 ? '' : 's'})`);
          if (label === 'invitation' && view[0] === 375) assert.equal(m.lines, 2, 'the heading wraps to two lines at 375 px, which is what the line-height has to carry');
          await shot(page, `invite-heading-${label.replace(/ /g, '-')}-${view[0]}-${view[2]}`);
        } finally { await page.close(); }
      });
    }
  }
});
