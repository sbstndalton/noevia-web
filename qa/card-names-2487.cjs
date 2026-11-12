'use strict';
// sbstndalton/noevia#2487: the Spaces library cards cut a name at about 14 characters at 1280 px because the rename and delete
// buttons sat beside the name. Now the name has the card's width (actions on the second row), wraps to two lines, then ends in an
// ellipsis with the full name as its title; the same for coworker cards. Mocked /api/spaces and /api/specialists. Fails on main.
const assert = require('node:assert/strict');
const { themedPage, shot, run, VIEWS, createSpacesServer, mountSpaces, addSpecialists, mountSpecialists, open } = require('./spaces-harness.cjs');

const NAME24 = 'QA-2487 Quarterly review'; // 24 characters
const LONG = 'QA-2487 ' + 'a very long name that has to wrap past two lines and then end in an ellipsis '.repeat(2).trim();
assert.equal([...NAME24].length, 24);

/** How the name button lays out: every line shown (scrollHeight fits), the lines it uses, and its title. */
const nameBox = (page, name) => page.evaluate((n) => {
  const el = [...document.querySelectorAll('.space-card-open')].find((b) => b.textContent === n);
  const cs = getComputedStyle(el), lh = parseFloat(cs.lineHeight), pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
  return { whole: el.scrollHeight <= el.clientHeight + 1, lines: Math.round((el.clientHeight - pad) / lh), title: el.getAttribute('title'), touch: el.getBoundingClientRect().height };
}, name);

async function library(browser, origin, view, route, seed) {
  const page = await themedPage(browser, view);
  const server = createSpacesServer();
  addSpecialists(server);
  seed(server);
  await mountSpaces(page, server);
  await mountSpecialists(page, server);
  await open(page, origin, route);
  return page;
}

run('card-names-2487', Number(process.env.QA_PORT || 32487), async (check, browser, origin) => {
  for (const view of VIEWS) {
    const tag = `${view[0]} px ${view[2]}`;
    await check(`${tag}: a 24-character Space name is shown whole; a very long one wraps to two lines, then an ellipsis, with the full name as title`, async () => {
      const page = await library(browser, origin, view, '/spaces', (s) => { s.addSpace(NAME24); s.addSpace(LONG); s.addSpace('QA-2487 short'); });
      try {
        await page.getByRole('button', { name: `Open ${NAME24}` }).waitFor({ timeout: 15000 });
        const whole = await nameBox(page, NAME24);
        assert.equal(whole.whole, true, 'the 24-character name is cut');
        assert.equal(whole.lines <= 2, true);
        assert.equal(whole.title, NAME24);
        const long = await nameBox(page, LONG);
        assert.equal(long.lines, 2, 'a very long name uses two lines');
        assert.equal(long.whole, false, 'and then ends in an ellipsis');
        assert.equal(long.title, LONG, 'the full name is the title');
        // The actions stay reachable and 44 px tall.
        for (const label of [`Rename: ${NAME24}`, `Delete: ${NAME24}`]) {
          const box = await page.getByRole('button', { name: label }).boundingBox();
          assert.ok(box && box.height >= 44 && box.width >= 44, `${label} is ${box && box.width}x${box && box.height}`);
        }
        await shot(page, `library-names-${view[0]}-${view[2]}`);
      } finally { await page.close(); }
    });
    await check(`${tag}: a 24-character coworker name is shown whole`, async () => {
      const page = await library(browser, origin, view, '/coworkers', (s) => { s.sp.add({ name: NAME24 }); s.sp.add({ name: LONG.slice(0, 60) }); });
      try {
        await page.getByRole('button', { name: `Open ${NAME24}` }).waitFor({ timeout: 15000 });
        const whole = await nameBox(page, NAME24);
        assert.equal(whole.whole, true);
        assert.equal(whole.title, NAME24);
        await shot(page, `coworkers-names-${view[0]}-${view[2]}`);
      } finally { await page.close(); }
    });
  }
});
