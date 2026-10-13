// #1417: after Projects -> New project -> Create project the app opened /p/<new id> and showed "This
// project isn't available" until a reload. The page reads the project from the workspace list, and
// the list was only refreshed after the navigation, so the new project was not there yet. Now the
// created project is listed as soon as the create succeeds, and it stays listed while the server's
// workspace read has not caught up with it. A failed create still stays on the Projects page with the
// error shown.
//
// The workspace read is stubbed to lag the create by two responses (the case the report describes),
// so the check fails on a build without the change and passes with it.
//
// Offline: the app is built from this checkout and every API is a synthetic stub (diary-fixture.cjs).
//   PLAYWRIGHT_MODULE=<playwright-core> QA_DIST=<dist dir> node qa/project-create-1417.cjs
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || `${process.env.HOME}/noevia-local-test/node_modules/playwright-core`);
const assert = require('node:assert/strict');
const { createFixture } = require('./diary-fixture.cjs');
const { withLocale } = require('./qa-locale.cjs');

const PORT = Number(process.env.QA_PORT || 31417);
const SHOTS = process.env.QA_SHOTS || '';
const NAME = 'Synthetic new project';
const newProject = { id: 'p-new-1417', name: NAME, goal: '', instructions: '', memories: [], files: [], chats: [], createdAt: 1, updatedAt: 1, modes: ['chat'] };

async function setup(browser, { createStatus = 200, lagReads = 2 } = {}) {
  const page = await browser.newPage(withLocale({ viewport: { width: 1440, height: 900 } }));
  await page.addInitScript(() => { localStorage.setItem('cowork-theme', 'light'); });
  const state = { created: false, lag: lagReads, reads: 0 };
  await page.route('**/api/workspace', (r) => {
    state.reads += 1;
    // Before the create the workspace is empty. After it, the first `lagReads` reads do not list the project yet.
    const listed = state.created && state.lag <= 0;
    if (state.created && state.lag > 0) state.lag -= 1;
    return r.fulfill({ json: { projects: listed ? [newProject] : [], freeChats: [] } });
  });
  await page.route('**/api/projects', async (r) => {
    if (r.request().method() !== 'POST') return r.continue();
    if (createStatus !== 200) return r.fulfill({ status: createStatus, json: { error: 'Synthetic create failure' } });
    state.created = true;
    return r.fulfill({ json: newProject });
  });
  await page.route('**/api/chats/*/history', (r) => r.fulfill({ json: { history: [], revision: 'r1' } }));
  await page.goto(`http://localhost:${PORT}/projects`);
  await page.getByRole('button', { name: 'New project' }).first().waitFor({ timeout: 20000 });
  return { page, state };
}

async function createFromDialog(page) {
  await page.getByRole('button', { name: 'New project' }).first().click();
  await page.locator('#proj-name').waitFor();
  await page.locator('#proj-name').fill(NAME);
  await page.getByRole('button', { name: 'Create project' }).click();
}

(async () => {
  const fixture = createFixture(PORT);
  await fixture.listen();
  const browser = await chromium.launch({ headless: true, ...(process.env.QA_CHROME_PATH ? { executablePath: process.env.QA_CHROME_PATH } : { channel: 'chrome' }) });
  const results = [];
  const check = async (name, fn) => {
    try { await fn(); results.push([name, null]); console.log(`PASS project-create-1417: ${name}`); }
    catch (e) { results.push([name, e]); console.log(`FAIL project-create-1417: ${name}\n  ${String(e.message).split('\n').slice(0, 8).join('\n  ')}`); }
  };
  try {
    await check('#1417 a new project opens at once and stays open while the workspace read lags the create', async () => {
      const { page, state } = await setup(browser, { lagReads: 2 });
      await createFromDialog(page);
      await page.waitForURL(/\/p\/p-new-1417/, { timeout: 10000 });
      await page.locator('h1.project-title').waitFor({ timeout: 3000 });
      // Let the lagging reads come back, then check again: the project must not drop out.
      await page.waitForTimeout(1500);
      assert.ok(state.reads >= 2, `the workspace was read after the create (${state.reads} reads)`);
      assert.equal(await page.getByText("This project isn't available").count(), 0, 'no "not available" message');
      assert.equal(await page.locator('h1.project-title').textContent().then((t) => t.includes(NAME)), true, 'the project name is shown');
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'project-create-1417.png') });
      await page.close();
    });

    await check('#1417 a failed create keeps the dialog open with the error and does not navigate', async () => {
      const { page } = await setup(browser, { createStatus: 500 });
      await createFromDialog(page);
      await page.getByText('Synthetic create failure').waitFor({ timeout: 10000 });
      assert.equal(new URL(page.url()).pathname, '/projects', 'the app stays on the Projects page');
      assert.equal(await page.locator('#proj-name').count(), 1, 'the dialog is still open, so the name can be retried');
      await page.close();
    });
  } finally {
    await browser.close();
    await fixture.close();
  }
  const failed = results.filter(([, e]) => e);
  console.log(`\nproject-create-1417: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exitCode = 1;
})().catch((e) => { console.error(e); process.exitCode = 1; });
