'use strict';
// sbstndalton/noevia#2486: a route change moves focus to the Space, page and coworker headings (screen readers), and the heading
// drew a focus ring on every arrival. Now the ring shows only when the keyboard was the last input (Enter on a card) or once a key
// is pressed on the heading; a click or a direct load draws none. Mocked /api/spaces and /api/specialists. Fails on a build of main.
const assert = require('node:assert/strict');
const { themedPage, shot, run, VIEWS, createSpacesServer, mountSpaces, addSpecialists, mountSpecialists, open } = require('./spaces-harness.cjs');

const ring = (page) => page.evaluate(() => {
  const el = document.activeElement, cs = getComputedStyle(el);
  return { tag: el.tagName, text: (el.textContent || '').trim().slice(0, 40), style: cs.outlineStyle, width: parseFloat(cs.outlineWidth) };
});
const hasRing = (r) => r.style !== 'none' && r.width > 0;
const onHeading = (page, text) => page.waitForFunction((t) => document.activeElement?.tagName === 'H1' && document.activeElement.textContent.trim() === t, text, { timeout: 8000 });

async function seeded(browser, origin, view, route) {
  const page = await themedPage(browser, view);
  const server = createSpacesServer();
  const space = server.addSpace('QA-2486 Space');
  const seededPage = server.addPage(space.id, 'QA-2486 Plan', 'text');
  addSpecialists(server);
  const coworker = server.sp.add({ name: 'QA-2486 Coworker' });
  await mountSpaces(page, server);
  await mountSpecialists(page, server);
  await page.route('**/api/chats/**/history', (r) => r.fulfill({ json: { history: [], revision: null } }));
  await open(page, origin, route({ space, seededPage, coworker }));
  return { page, space, seededPage, coworker };
}

run('heading-focus-2486', Number(process.env.QA_PORT || 32486), async (check, browser, origin) => {
  for (const view of VIEWS) {
    const tag = `${view[0]} px ${view[2]}`;
    await check(`${tag}: a direct load of a Space focuses the heading and draws no ring; a key press brings the ring`, async () => {
      const { page } = await seeded(browser, origin, view, ({ space }) => `/spaces/${space.id}`);
      try {
        await onHeading(page, 'QA-2486 Space');
        const r = await ring(page);
        assert.equal(hasRing(r), false, `the heading draws an outline (${r.style} ${r.width}px)`);
        await shot(page, `space-direct-${view[0]}-${view[2]}`);
        await page.keyboard.press('ArrowDown');
        assert.equal(hasRing(await ring(page)), true, 'the ring returns once the keyboard is used on the heading');
        await shot(page, `space-direct-keyboard-${view[0]}-${view[2]}`);
      } finally { await page.close(); }
    });
    await check(`${tag}: opening a Space by click draws no ring; by the keyboard (Enter on the card) it does`, async () => {
      const { page } = await seeded(browser, origin, view, () => '/spaces');
      try {
        const card = page.getByRole('button', { name: 'Open QA-2486 Space' });
        await card.waitFor({ timeout: 15000 });
        await card.click();
        await onHeading(page, 'QA-2486 Space');
        assert.equal(hasRing(await ring(page)), false, 'click arrival');
        await page.goBack();
        await card.waitFor({ timeout: 15000 });
        await card.focus();
        await page.keyboard.press('Enter');
        await onHeading(page, 'QA-2486 Space');
        assert.equal(hasRing(await ring(page)), true, 'keyboard arrival keeps the ring');
      } finally { await page.close(); }
    });
    await check(`${tag}: the coworker heading draws no ring on a direct load`, async () => {
      const { page } = await seeded(browser, origin, view, ({ coworker }) => `/coworkers/${coworker.id}`);
      try {
        await onHeading(page, 'QA-2486 Coworker');
        const r = await ring(page);
        assert.equal(hasRing(r), false, `the heading draws an outline (${r.style} ${r.width}px)`);
        await shot(page, `coworker-direct-${view[0]}-${view[2]}`);
        await page.keyboard.press('ArrowDown');
        assert.equal(hasRing(await ring(page)), true);
      } finally { await page.close(); }
    });
    await check(`${tag}: the page heading draws no ring on a direct load`, async () => {
      const { page } = await seeded(browser, origin, view, ({ space, seededPage }) => `/spaces/${space.id}/${seededPage.id}`);
      try {
        await onHeading(page, 'QA-2486 Plan');
        const r = await ring(page);
        assert.equal(hasRing(r), false, `the heading draws an outline (${r.style} ${r.width}px)`);
      } finally { await page.close(); }
    });
  }
});
