'use strict';
// #2242: GET /api/projects/:id/browser answers { capabilities, network, tasks }. Since core#287 `network` is false both when no egress proxy is
// configured and while a configured one is temporarily unavailable, and the route sends nothing that tells the two apart. The Browser panel
// used to say only "An administrator sets it up", so a member could be sent to an admin for a passing outage. The note now says a task cannot
// open right now, that the proxy may only be restarting, and that an administrator sets it up if it stays unavailable. The setting name
// (CODE_EGRESS_PORT) is still shown to administrators only. The missing field is reported on the issue: a route field such as `network` as
// 'unconfigured' | 'unavailable' | 'ready' would let the panel show a separate outage state.
// Synthetic endpoint in the real shape.
//   PLAYWRIGHT_MODULE=<playwright-core> QA_DIST=<dist dir> [QA_CORE_SERVER=<core server/>] [QA_SHOTS=<dir>] node qa/browser-egress-outage-2242.cjs
// Fails on a build without the change, passes with it.
const assert = require('node:assert/strict');
const { run, openPage, shot, ADMIN, IPHONE, DESKTOP } = require('./web-fixes-lib.cjs');

const project = { id: 'p-qa', name: 'Zebra', model: 'qa-model', instructions: '', files: [], assets: [], toolboxes: [], chats: [], memories: [], modes: ['chat'], sourceFolders: [], goal: '', createdAt: 1, updatedAt: 1 };
const mock = (page) => Promise.all([
  page.route('**/api/features', (r) => r.fulfill({ json: { flags: { browserExecutor: true } } })),
  page.route('**/api/workspace', (r) => r.fulfill({ json: { projects: [project], freeChats: [] } })),
  page.route('**/api/projects/p-qa/browser', (r) => r.fulfill({ json: { capabilities: ['open_browser'], network: false, tasks: [] } })),
  page.route('**/api/chats/*/history', (r) => r.fulfill({ json: { history: [], revision: 'r1' } })),
]);

run('browser-egress-outage-2242', Number(process.env.QA_PORT || 32242), async (check, browser, origin) => {
  for (const view of [{ name: '1440', options: DESKTOP }, { name: 'iphone', options: IPHONE }]) {
    for (const [who, user] of [['member', { ...ADMIN, role: 'member' }], ['admin', ADMIN]]) {
      for (const theme of ['light', 'dark']) {
        await check(`${view.name} ${who} ${theme}: with network false the note allows for a temporary outage`, async () => {
          const { page, context, errors } = await openPage(browser, view, theme, { user, mock });
          await page.goto(`${origin}/p/p-qa/browser`);
          const note = page.locator('.code-panel .code-note.is-error');
          await note.waitFor({ timeout: 15000 });
          const text = await note.textContent();
          assert.match(text, /not available/i);
          assert.match(text, /restarting/i, `the note does not allow for a temporary outage: ${text}`);
          assert.match(text, /administrator/i);
          const detail = page.getByText('Technical detail: CODE_EGRESS_PORT');
          assert.equal(await detail.count(), who === 'admin' ? 1 : 0, 'the setting name is for administrators only');
          assert.equal(await page.locator('.code-panel button.btn-primary').first().isDisabled(), true, 'a task can be started while the proxy is down');
          await shot(page, `2242-browser-outage-${view.name}-${who}-${theme}`);
          assert.deepEqual(errors, []);
          await context.close();
        });
      }
    }
  }
});
