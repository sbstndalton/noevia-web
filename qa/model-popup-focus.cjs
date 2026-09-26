// #419: the composer's "Model and tools" dialog drops keyboard focus to <body> for one Tab stop
// when switching Auto/Manual (or picking a model, or any other busy-gated control in this panel)
// while its save is in flight. Offline: a real dialog, a synthetic /api/projects/*/config that
// only resolves once the test lets it, no inference/storage/network.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const { createFixture } = require('./diary-fixture.cjs');
const { withLocale } = require('./qa-locale.cjs');

const activeElement = (page) => page.evaluate(() => ({
  tag: document.activeElement?.tagName ?? null,
  cls: document.activeElement?.className ?? null,
  ariaPressed: document.activeElement?.getAttribute('aria-pressed') ?? null,
  isBody: document.activeElement === document.body,
}));

(async () => {
  const fixture = createFixture(31471);
  await fixture.listen();
  const browser = await chromium.launch({ headless: true, channel: process.env.QA_CHANNEL || 'chrome' });
  let passed = 0;
  const pass = (msg) => { passed += 1; console.log(`PASS model-popup-focus: ${msg}`); };
  try {
    const page = await browser.newPage(withLocale({ viewport: { width: 1440, height: 900 } }));
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));

    const project = { id: 'p1', name: 'Synthetic', model: 'Cold chat', routing: 'auto', files: [], assets: [], toolboxes: ['core'] };
    await page.route('**/api/chats/*/context', (r) => r.fulfill({ json: { project } }));
    await page.route('**/api/providers', (r) => r.fulfill({ json: { providers: [{ id: 'default', label: 'Native', baseUrl: 'http://synthetic.invalid/v1', managed: true, isDefault: true }] } }));
    await page.route('**/api/auto-roles', (r) => r.fulfill({ json: { configured: true, roles: { fast: 'Cold chat', smart: 'Cold chat' } } }));
    await page.route('**/api/models/capabilities', (r) => r.fulfill({ json: { kind: 'llamacpp', admin: false, presets: true, runtimeOptions: false, modelManagement: false } }));
    await page.route('**/api/toolboxes', (r) => r.fulfill({ json: { toolboxes: [{ id: 'core', label: 'Core', description: 'Clock and project files.', toolCount: 2, estTokens: 180, source: 'builtin', available: true }], mcp: { configured: false, servers: [] } } }));
    await page.route('**/api/models/installed', (r) => r.fulfill({ json: [{ name: 'Cold chat', labels: [], loaded: false }] }));
    // Held open until the test explicitly resolves it, so the assertion below is a genuine
    // observation of the "save in flight" window rather than a race against an instant response.
    let resolveSave;
    const savePending = new Promise((resolve) => { resolveSave = resolve; });
    let saveBody = null;
    await page.route('**/api/projects/*/config', async (r) => {
      saveBody = r.request().postDataJSON();
      await savePending;
      project.routing = saveBody.routing ?? project.routing;
      await r.fulfill({ json: { project } });
    });

    await page.goto('http://localhost:31471');
    await page.getByRole('button', { name: 'Choose model' }).filter({ hasText: 'Auto (Fast/Smart)' }).waitFor();
    await page.getByRole('button', { name: 'Choose model' }).click();
    const dialog = page.getByRole('dialog', { name: 'Model and tools' });
    await dialog.waitFor();

    const manual = dialog.getByRole('button', { name: /Manual/ });
    await manual.focus();
    await page.keyboard.press('Enter');

    // Confirm this is a genuine observation of the busy window, not a race against an instant
    // response: the save reached the server and the button this click activated is now
    // `disabled` (both mode buttons share one `busy` gate) — which is what force-blurs it.
    assert.equal(saveBody?.routing, 'manual', 'the save was actually sent for the Manual click');
    await page.waitForFunction(() => document.querySelector('.mp-mode-btn[aria-pressed="false"]')?.disabled === true);

    resolveSave();
    // Once the save resolves and the control is enabled again, focus must have been put back —
    // not left wherever the mid-flight disablement pushed it (or failed to push it).
    await page.waitForFunction(() => document.querySelector('.mp-mode-btn[aria-pressed="true"]')?.textContent?.includes('Manual'));
    const afterSave = await activeElement(page);
    assert.equal(afterSave.isBody, false, 'focus must not be left on <body> once the save resolves');
    assert.equal(afterSave.cls, 'mp-mode-btn', 'focus returns to the Manual button once the save resolves');
    assert.equal(afterSave.ariaPressed, 'true', 'the button focus returns to reflects the now-current mode');
    pass('focus returns to the Manual button once its save resolves and the control is enabled again');

    assert.deepEqual(errors, [], 'no page errors');
    console.log(`PASS model-popup-focus: all ${passed} scenarios.`);
    await page.close();
  } finally {
    await browser.close();
    await fixture.close();
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
