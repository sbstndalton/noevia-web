'use strict';
// #2235: three small spacing defects.
//  1. Settings → Users at 390 px: in a member's row the remove (x) button did not fit beside Disable and Recovery and wrapped
//     alone onto its own line, leaving an empty band under the row. The three actions now stay together on one line.
//  2. First-run wizard, "Secure your account": "Create a passkey" and "Set up later" touched, with no gap between them.
//  3. A new chat in a project: the heading's folder icon sat against the project name with no space.
// A real browser is needed: all three are rendered-layout facts. Synthetic APIs only; shapes are the real routes' (users list,
// session of an administrator who has not finished onboarding, workspace with one project).
//   PLAYWRIGHT_MODULE=<playwright-core> QA_DIST=<dist dir> [QA_CORE_SERVER=<core server/>] [QA_SHOTS=<dir>] node qa/spacing-defects-2235.cjs
// Fails on a build without the change, passes with it.
const assert = require('node:assert/strict');
const { run, openPage, shot, ADMIN, IPHONE, DESKTOP } = require('./web-fixes-lib.cjs');

const member = { id: 'qa-member', username: 'qamember', displayName: 'QA Member', role: 'member', diaryEnabled: false, onboarded: true, disabled: false };
const usersMock = (page) => page.route('**/api/admin/users', (r) => r.fulfill({ json: { users: [{ ...ADMIN, disabled: false }, member] } }));
const project = { id: 'p-zebra', name: 'Zebra migration research', model: 'qa-model', instructions: '', files: [], assets: [], toolboxes: [], chats: [], memories: [], modes: ['chat'], sourceFolders: [], goal: '', createdAt: 1, updatedAt: 1 };
const projectMock = (page) => Promise.all([
  page.route('**/api/workspace', (r) => r.fulfill({ json: { projects: [project], freeChats: [] } })),
  page.route('**/api/chats/*/history', (r) => r.fulfill({ json: { history: [], revision: 'r1' } })),
]);
const unfinished = { ...ADMIN, onboarded: false };
const wizardMock = (page) => Promise.all([
  page.route('**/api/setup/status', (r) => r.fulfill({ json: { configured: true } })),
  page.route('**/api/offsite-backup**', (r) => r.fulfill({ json: { enabled: false } })),
  page.route('**/api/admin/offsite-backup', (r) => r.fulfill({ json: { enabled: false } })),
]);

run('spacing-defects-2235', Number(process.env.QA_PORT || 32235), async (check, browser, origin) => {
  for (const theme of ['light', 'dark']) {
    await check(`iphone ${theme}: the member row keeps Disable, Recovery and remove on one line, with no empty band`, async () => {
      const { page, context, errors } = await openPage(browser, { options: IPHONE }, theme, { mock: usersMock });
      await page.goto(`${origin}/settings/users`);
      const row = page.locator('.settings-users .model-row').filter({ hasText: '@qamember' });
      await row.waitFor({ timeout: 15000 });
      const m = await row.evaluate((el) => {
        const row = el.getBoundingClientRect();
        const btns = [...el.querySelectorAll('button')].map((b) => { const r = b.getBoundingClientRect(); return { top: Math.round(r.top), bottom: r.bottom, h: Math.round(r.height) }; });
        const cs = getComputedStyle(el);
        return { btns, rowBottom: row.bottom, pad: parseFloat(cs.paddingBottom) };
      });
      assert.equal(m.btns.length, 3);
      assert.equal(new Set(m.btns.map((b) => b.top)).size, 1, `the three buttons are on different lines (tops: ${m.btns.map((b) => b.top)})`);
      const lowest = Math.max(...m.btns.map((b) => b.bottom));
      assert.ok(m.rowBottom - lowest <= m.pad + 2, `an empty band of ${Math.round(m.rowBottom - lowest - m.pad)} px under the buttons`);
      await shot(page, `2235-users-iphone-${theme}`, { fullPage: true });
      assert.deepEqual(errors, []);
      await context.close();
    });
  }
  for (const view of [{ name: '1440', options: DESKTOP }, { name: 'iphone', options: IPHONE }]) {
    for (const theme of ['light', 'dark']) {
      await check(`${view.name} ${theme}: "Create a passkey" and "Set up later" have a gap between them`, async () => {
        const { page, context, errors } = await openPage(browser, view, theme, { user: unfinished, mock: wizardMock });
        await page.goto(origin);
        await page.getByRole('button', { name: 'Skip — set up later in Settings' }).click();
        await page.getByRole('button', { name: 'Continue' }).click();
        await page.getByRole('button', { name: 'Skip — set up later' }).click();
        await page.getByRole('heading', { name: 'Secure your account' }).waitFor();
        const create = page.getByRole('button', { name: 'Create a passkey' }), later = page.getByRole('button', { name: 'Set up later' });
        const a = await create.boundingBox(), b = await later.boundingBox();
        // Side by side or stacked, the two buttons' boxes must not touch.
        const gapX = Math.max(b.x - (a.x + a.width), a.x - (b.x + b.width)), gapY = Math.max(b.y - (a.y + a.height), a.y - (b.y + b.height));
        assert.ok(Math.max(gapX, gapY) >= 6, `the buttons are ${Math.round(Math.max(gapX, gapY))} px apart`);
        await shot(page, `2235-wizard-passkey-${view.name}-${theme}`);
        assert.deepEqual(errors, []);
        await context.close();
      });
      await check(`${view.name} ${theme}: the heading's project icon has room on both sides of it`, async () => {
        const { page, context, errors } = await openPage(browser, view, theme, { mock: projectMock });
        await page.goto(`${origin}/p/p-zebra/new`);
        const h1 = page.locator('.empty-state h1');
        await h1.waitFor({ timeout: 15000 });
        const m = await h1.evaluate((el) => {
          const icon = el.querySelector('.project-icon').getBoundingClientRect();
          const walk = (node) => [...node.childNodes];
          const kids = walk(el);
          const iconAt = kids.findIndex((n) => n.nodeType === 1);
          const before = document.createRange(), after = document.createRange();
          const lead = kids[iconAt - 1]; // "Let's work on " ends in a space: measure from the last letter, so the space counts as part of the gap
          before.setStart(lead, 0); before.setEnd(lead, lead.textContent.replace(/\s+$/, '').length); after.selectNodeContents(kids[iconAt + 1]);
          // the name may wrap onto further lines: its first line box is the one beside the icon
          const b = [...before.getClientRects()].pop(), a = after.getClientRects()[0];
          return { left: icon.left - b.right, right: a.left - icon.right };
        });
        await shot(page, `2235-project-heading-${view.name}-${theme}`);
        assert.ok(m.left >= 3, `${m.left.toFixed(1)} px between "Let's work on" and the icon`);
        assert.ok(m.right >= 3, `${m.right.toFixed(1)} px between the icon and the project name`);
        assert.deepEqual(errors, []);
        await context.close();
      });
    }
  }
});
