'use strict';
// #2242: GET /api/projects/:id/browser and /code now answer `networkState` ('unconfigured' | 'unavailable' | 'ready') beside `network`
// (noevia-core fix/2242-network-state). While a configured egress proxy is only not answering ('unavailable', often a restart) neither panel sends
// a person to an administrator: the Browser panel says to wait and reload, and shows no setting name to anyone; the Code panel's offline note says
// the proxy is not answering instead of "which this server does not run". 'unconfigured' keeps the setup wording, and a server that sends no state
// (an older core) keeps the wording that allows for both.
// Synthetic endpoints in the real shape.
//   PLAYWRIGHT_MODULE=<playwright-core> QA_DIST=<dist dir> [QA_SHOTS=<dir>] [QA_TAG=before|after] node qa/network-state-2242.cjs
// Fails on a build without the change, passes with it.
const assert = require('node:assert/strict');
const { run, openPage, shot, ADMIN, IPHONE, DESKTOP } = require('./web-fixes-lib.cjs');

const project = { id: 'p-qa', name: 'Zebra', model: 'qa-model', instructions: '', files: [], assets: [], toolboxes: [], chats: [], memories: [], modes: ['chat'], sourceFolders: [], goal: '', createdAt: 1, updatedAt: 1 };
const mock = (networkState) => (page) => Promise.all([
  page.route('**/api/features', (r) => r.fulfill({ json: { flags: { browserExecutor: true, codeHarness: true } } })),
  page.route('**/api/workspace', (r) => r.fulfill({ json: { projects: [project], freeChats: [] } })),
  page.route('**/api/projects/p-qa/browser', (r) => r.fulfill({ json: { capabilities: ['open_browser'], network: networkState === 'ready', ...(networkState ? { networkState } : {}), tasks: [] } })),
  page.route('**/api/projects/p-qa/code', (r) => r.fulfill({ json: { repositories: [{ id: 'noevia' }], capabilities: ['read_repository', 'edit_file', 'network', 'install_dependency'], defaultCapabilities: ['read_repository'],
    harnesses: [{ id: 'opencode', label: 'OpenCode', version: null }], promptPreparation: [{ id: 'direct', label: 'Direct', available: true, reason: 'Direct' }], sandboxed: true,
    network: networkState === 'ready', ...(networkState ? { networkState } : {}), tasks: [] } })),
  page.route('**/api/chats/*/history', (r) => r.fulfill({ json: { history: [], revision: 'r1' } })),
]);

run('network-state-2242', Number(process.env.QA_PORT || 32243), async (check, browser, origin) => {
  for (const view of [{ name: '1440', options: DESKTOP }, { name: 'iphone', options: IPHONE }]) {
    for (const [who, user] of [['member', { ...ADMIN, role: 'member' }], ['admin', ADMIN]]) {
      await check(`${view.name} ${who}: Browser panel, proxy configured but not answering: wait and reload, nobody is sent to an administrator`, async () => {
        const { page, context, errors } = await openPage(browser, view, 'light', { user, mock: mock('unavailable') });
        await page.goto(`${origin}/p/p-qa/browser`);
        const note = page.locator('.code-panel .code-note.is-error');
        await note.waitFor({ timeout: 15000 });
        const text = await note.first().textContent();
        assert.match(text, /not answering/i, text);
        assert.match(text, /restart/i, text);
        assert.doesNotMatch(text, /administrator|server configuration/i, `an outage sends a person to an administrator: ${text}`);
        assert.equal(await page.getByText('Technical detail: CODE_EGRESS_PORT').count(), 0, 'no setting name for a passing outage, even to an administrator');
        assert.equal(await page.locator('.code-panel button.btn-primary').first().isDisabled(), true, 'a task cannot be started while the proxy is down');
        await shot(page, `2242-state-browser-unavailable-${view.name}-${who}`);
        assert.deepEqual(errors, []); await context.close();
      });
      await check(`${view.name} ${who}: Browser panel, no proxy configured: an administrator sets it up (setting name for administrators only)`, async () => {
        const { page, context } = await openPage(browser, view, 'light', { user, mock: mock('unconfigured') });
        await page.goto(`${origin}/p/p-qa/browser`);
        const note = page.locator('.code-panel .code-note.is-error');
        await note.waitFor({ timeout: 15000 });
        assert.match(await note.first().textContent(), /administrator/i);
        assert.equal(await page.getByText('Technical detail: CODE_EGRESS_PORT').count(), who === 'admin' ? 1 : 0);
        await context.close();
      });
    }
    await check(`${view.name}: Code panel, proxy configured but not answering: the note says so`, async () => {
      const { page, context, errors } = await openPage(browser, view, 'light', { user: ADMIN, mock: mock('unavailable') });
      await page.goto(`${origin}/p/p-qa/code`);
      const note = page.locator('.code-panel fieldset.code-capabilities .code-note').last();
      await note.waitFor({ timeout: 15000 });
      const text = await note.textContent();
      assert.match(text, /not answering/i, text);
      assert.doesNotMatch(text, /does not run/i, `a restart is worded as a server without a proxy: ${text}`);
      await shot(page, `2242-state-code-unavailable-${view.name}`);
      assert.deepEqual(errors, []); await context.close();
    });
    await check(`${view.name}: Code panel, no proxy configured: the note keeps the setup wording`, async () => {
      const { page, context } = await openPage(browser, view, 'light', { user: ADMIN, mock: mock('unconfigured') });
      await page.goto(`${origin}/p/p-qa/code`);
      const note = page.locator('.code-panel fieldset.code-capabilities .code-note').last();
      await note.waitFor({ timeout: 15000 });
      assert.match(await note.textContent(), /does not run/i);
      await context.close();
    });
    await check(`${view.name}: a server that sends no state keeps the Browser wording that allows for both`, async () => {
      const { page, context } = await openPage(browser, view, 'light', { user: ADMIN, mock: mock(undefined) });
      await page.goto(`${origin}/p/p-qa/browser`);
      const note = page.locator('.code-panel .code-note.is-error');
      await note.waitFor({ timeout: 15000 });
      assert.match(await note.first().textContent(), /restarting[\s\S]*administrator/i);
      await context.close();
    });
  }
});
