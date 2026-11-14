'use strict';
// sbstndalton/noevia#2644: for a member the Models page (Your models) said "File details, downloads and settings need the model management
// service, which is not available on this server." and offered "Check for updates", while the requests behind them (GET
// /api/model-manager/models, /models/updates, /overview) answered 403: the account is not an administrator, the service is fine.
// A 403 now reads "File details, downloads and settings are for administrators." and the administrators' "Check for updates" is gone;
// a service that really is down (502) keeps the old sentence and an administrator keeps the button.
// Offline: the fixture serves the build; the Models endpoints are stubs.
//   PLAYWRIGHT_MODULE=<playwright-core> QA_CHROME_PATH=<Chrome> QA_DIST=<dist> QA_CORE_SERVER=<core server/> [QA_SHOTS=<dir>] node qa/models-member-403-2644.cjs
const assert = require('node:assert/strict');
const { openModelsPage, openModelsTab } = require('./nav.cjs');
const { run, openPage, shot, ADMIN } = require('./web-fixes-lib.cjs');

const MEMBER = { id: 'qa-member', username: 'qa-member', displayName: 'QA member', role: 'member', diaryEnabled: false, onboarded: true };
const VIEWS = [{ name: '375', options: { viewport: { width: 375, height: 812 } } }, { name: '1280', options: { viewport: { width: 1280, height: 900 } } }];
const NO_SERVICE = 'File details, downloads and settings need the model management service, which is not available on this server.';
const ADMIN_ONLY = 'File details, downloads and settings are for administrators.';

/** `managerStatus`: what every /api/model-manager/* answers (403 for a member, 502 for a service that is down, 200 for an administrator). */
const mock = ({ admin, managerStatus }) => async (page) => {
  await page.route('**/api/models/installed', (r) => r.fulfill({ json: [{ name: 'QA-Synthetic-Q4', labels: [], loaded: true }] }));
  await page.route('**/api/models/capabilities', (r) => r.fulfill({ json: { kind: 'llamacpp', admin, presets: true, download: true, runtimeOptions: false, modelManagement: admin } }));
  await page.route('**/api/auto-roles', (r) => r.fulfill({ json: { configured: false, roles: null } }));
  await page.route('**/api/model-manager/**', (r) => {
    if (managerStatus === 200) {
      const sub = new URL(r.request().url()).pathname.slice('/api/model-manager/'.length);
      if (sub === 'models') return r.fulfill({ json: { models: [], unregistered: [], revision: 'r1' } });
      if (sub === 'models/updates') return r.fulfill({ json: { status: {} } });
      return r.fulfill({ json: {} });
    }
    return r.fulfill({ status: managerStatus, json: { error: managerStatus === 403 ? 'Administrator required' : 'Model manager unavailable' } });
  });
};

run('models-member-403-2644', Number(process.env.QA_PORT || 32644), async (check, browser, origin) => {
  for (const view of VIEWS) {
    for (const theme of ['light', 'dark']) {
      const tag = `${view.name} px ${theme}`;
      const library = async (page) => {
        const root = await openModelsPage(page, origin, { direct: true });
        await openModelsTab(root, 'Your models');
        const tab = root.locator('.mm-tab').filter({ has: page.locator('.mm-library-bar') });
        await tab.getByText(/1 of 1 model|1 model/).first().waitFor({ timeout: 15000 });
        return tab;
      };

      await check(`${tag}: a member (403) is told this is for administrators, and gets no Check for updates`, async () => {
        const { page, context, errors } = await openPage(browser, view, theme, { user: MEMBER, mock: mock({ admin: false, managerStatus: 403 }) });
        const tab = await library(page);
        await tab.getByText(ADMIN_ONLY, { exact: true }).waitFor({ timeout: 15000 });
        assert.equal(await page.getByText(NO_SERVICE).count(), 0, 'the page still says the service is unavailable');
        assert.equal(await tab.getByRole('button', { name: 'Check for updates' }).count(), 0, 'a member is offered Check for updates');
        await shot(page, `2644-member-${view.name}-${theme}`, { fullPage: true });
        assert.deepEqual(errors, []);
        await context.close();
      });

      await check(`${tag}: a model manager that is really down (502) still says so, and an administrator keeps Check for updates`, async () => {
        const { page, context } = await openPage(browser, view, theme, { user: ADMIN, mock: mock({ admin: true, managerStatus: 502 }) });
        const tab = await library(page);
        await tab.getByText(NO_SERVICE, { exact: true }).waitFor({ timeout: 15000 });
        assert.equal(await page.getByText(ADMIN_ONLY).count(), 0);
        await tab.getByRole('button', { name: 'Check for updates' }).waitFor({ timeout: 5000 });
        await shot(page, `2644-down-${view.name}-${theme}`, { fullPage: true });
        await context.close();
      });
    }
  }
});
