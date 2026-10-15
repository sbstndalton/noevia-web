// #1849: the composer's Model dialog, Manual mode, lists the models a chat role's Inference machine serves after this
// machine's own, labelled with the machine ("On <machine>"), and picking one saves it as the chat's Manual model (the
// server then answers it on that machine). A name this machine also lists is shown once, as this machine's row. With
// nothing on a machine the list is this machine's models only. Offline: synthetic /api answers, no inference, no
// storage, no network. QA_SHOTS=<dir> saves light and dark screenshots at 2000 and 390 px.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const { createFixture } = require('./diary-fixture.cjs');
const { withLocale } = require('./qa-locale.cjs');

const REMOTE = 'synthetic-remote-chat';
const SHARED = 'Local chat';

/** Screenshots wait for the dialog's open transition to finish. */
const settle = (page) => page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'), null, { timeout: 5000 }).catch(() => {});

async function open(browser, { width, theme, machineModels }) {
  const page = await browser.newPage(withLocale({ viewport: { width, height: width < 768 ? 844 : 900 }, colorScheme: theme, isMobile: width < 768, hasTouch: width < 768 }));
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const project = { id: 'p1', name: 'Synthetic', model: SHARED, routing: 'manual', files: [], assets: [], toolboxes: ['core'] };
  const saves = [];
  await page.route('**/api/chats/*/context', (r) => r.fulfill({ json: { project } }));
  await page.route('**/api/providers', (r) => r.fulfill({ json: { providers: [{ id: 'default', label: 'Native', baseUrl: 'http://synthetic.invalid/v1', managed: true, isDefault: true }] } }));
  await page.route('**/api/auto-roles', (r) => r.fulfill({ json: { configured: true, roles: { fast: SHARED, smart: SHARED }, missing: [], ...(machineModels ? { machineModels } : {}) } }));
  await page.route('**/api/models/capabilities', (r) => r.fulfill({ json: { kind: 'llamacpp', admin: false, presets: true, runtimeOptions: false, modelManagement: false } }));
  await page.route('**/api/toolboxes', (r) => r.fulfill({ json: { toolboxes: [], mcp: { configured: false, servers: [] } } }));
  await page.route('**/api/models/installed', (r) => r.fulfill({ json: [{ name: SHARED, labels: [], loaded: true }] }));
  await page.route('**/api/projects/*/config', async (r) => {
    const body = r.request().postDataJSON();
    saves.push(body);
    Object.assign(project, body);
    await r.fulfill({ json: { project } });
  });
  await page.goto('http://localhost:31849');
  const chooser = page.getByRole('button', { name: 'Choose model' }).first();
  await chooser.waitFor();
  await chooser.click();
  const dialog = page.getByRole('dialog', { name: 'Model' });
  await dialog.waitFor();
  await dialog.locator('.mp-model', { hasText: SHARED }).first().waitFor();
  return { page, dialog, saves, errors };
}

(async () => {
  const fixture = createFixture(31849);
  await fixture.listen();
  const browser = await chromium.launch({ headless: true, channel: process.env.QA_CHANNEL || 'chrome' });
  const shots = process.env.QA_SHOTS || '';
  let passed = 0;
  const pass = (msg) => { passed += 1; console.log(`PASS model-popup-machine-models-1849: ${msg}`); };
  const machineModels = [
    { model: REMOTE, machine: { id: 'm1', name: 'Synthetic Pi' }, roles: ['smart'] },
    { model: SHARED, machine: { id: 'm1', name: 'Synthetic Pi' }, roles: ['fast'] },
  ];
  try {
    for (const width of [2000, 390]) {
      for (const theme of ['light', 'dark']) {
        const { page, dialog, saves, errors } = await open(browser, { width, theme, machineModels });
        const row = dialog.locator('.mp-model', { hasText: REMOTE });
        await row.waitFor({ timeout: 5000 });
        assert.match(await row.innerText(), /On Synthetic Pi/, 'the machine model is labelled with its machine');
        assert.equal(await dialog.locator('.mp-model', { hasText: SHARED }).count(), 1, 'a name this machine lists is shown once');
        assert.equal(await dialog.locator('.mp-model', { hasText: SHARED }).filter({ hasText: 'On Synthetic Pi' }).count(), 0, 'and as this machine\'s row');
        if (shots) { await settle(page); await page.screenshot({ path: `${shots}/1849-manual-list-${width}-${theme}.png` }); }
        await row.click();
        await page.waitForFunction((name) => [...document.querySelectorAll('.mp-model[aria-pressed="true"]')].some((b) => b.textContent.includes(name)), REMOTE);
        assert.deepEqual(saves.at(-1), { model: REMOTE, routing: 'manual' }, 'the pick is saved as the Manual model by name');
        if (shots) { await settle(page); await page.screenshot({ path: `${shots}/1849-manual-picked-${width}-${theme}.png` }); }
        assert.deepEqual(errors, [], 'no page errors');
        pass(`${width}px ${theme}: the machine model is listed with its machine and can be picked`);
        await page.close();
      }
    }
    const { page, dialog, errors } = await open(browser, { width: 2000, theme: 'light', machineModels: null });
    assert.equal(await dialog.locator('.mp-model').count(), 1, 'nothing on a machine: only this machine\'s models');
    assert.equal(await dialog.getByText(/On Synthetic Pi/).count(), 0);
    assert.deepEqual(errors, []);
    pass('nothing on a machine: the Manual list is unchanged');
    await page.close();
    console.log(`PASS model-popup-machine-models-1849: all ${passed} scenarios.`);
  } finally {
    await browser.close();
    await fixture.close();
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
