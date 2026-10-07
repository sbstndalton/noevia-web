// #862: two quick toolbox toggles undo each other. Since #1006 the toolboxes are picked in the
// composer's + menu (Tools: Manual), so the race is checked there. The first save used to
// clear `busy` before the parent had re-read the project, so the second toggle sent the whole
// list built from the stale selection and switched the first box back on. Offline: a real
// dialog, synthetic routes, the project re-read held open until the test releases it.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const { createFixture } = require('./diary-fixture.cjs');
const { withLocale } = require('./qa-locale.cjs');

(async () => {
  const fixture = createFixture(31472);
  await fixture.listen();
  const browser = await chromium.launch({ headless: true, executablePath: process.env.QA_CHROME_PATH || undefined, channel: process.env.QA_CHROME_PATH ? undefined : 'chrome' });
  try {
    const page = await browser.newPage(withLocale({ viewport: { width: 1440, height: 900 } }));
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const project = { id: 'p1', name: 'Synthetic', model: 'Cold chat', routing: 'auto', files: [], assets: [], toolboxes: ['core', 'search'] };
    const box = (id, label) => ({ id, label, description: `${label} synthetic.`, toolCount: 1, estTokens: 50, source: 'builtin', available: true });
    let holdContext = false, releaseContext;
    const contextGate = new Promise((r) => { releaseContext = r; });
    const patches = [];
    await page.route('**/api/chats/*/context', async (r) => { if (holdContext) await contextGate; await r.fulfill({ json: { project: { ...project } } }); });
    await page.route('**/api/providers', (r) => r.fulfill({ json: { providers: [{ id: 'default', label: 'Native', baseUrl: 'http://synthetic.invalid/v1', managed: true, isDefault: true }] } }));
    await page.route('**/api/auto-roles', (r) => r.fulfill({ json: { configured: true, roles: { fast: 'Cold chat', smart: 'Cold chat' } } }));
    await page.route('**/api/models/capabilities', (r) => r.fulfill({ json: { kind: 'llamacpp', admin: false, presets: true, runtimeOptions: false, modelManagement: false } }));
    await page.route('**/api/toolboxes', (r) => r.fulfill({ json: { toolboxes: [box('core', 'Core'), box('search', 'Web search'), box('notes', 'Notes')], mcp: { configured: false, servers: [] } } }));
    await page.route('**/api/models/installed', (r) => r.fulfill({ json: [{ name: 'Cold chat', labels: [], loaded: false }] }));
    await page.route('**/api/projects/*/config', async (r) => {
      const body = r.request().postDataJSON();
      patches.push(body);
      holdContext = true; // from now the project re-read is slow
      if (body.toolboxes) project.toolboxes = body.toolboxes;
      await r.fulfill({ json: { project } });
    });

    await page.goto('http://localhost:31472');
    await page.getByRole('button', { name: 'Choose model' }).filter({ hasText: 'Auto (Fast/Smart)' }).waitFor();
    const plus = page.getByRole('button', { name: /^Add files and tools/ });
    await plus.click();
    const menu = page.getByRole('region', { name: /files and tools/i });
    await menu.waitFor();
    const tool = (name) => menu.getByRole('menuitemcheckbox', { name: new RegExp(name) });

    await tool('Web search').click();
    await page.waitForFunction(() => document.querySelectorAll('[role="menuitemcheckbox"]').length > 0);
    assert.deepEqual(patches[0].toolboxes, ['core'], 'the first toggle switched web search off');
    await page.waitForTimeout(300);
    await tool('Notes').click({ timeout: 800 }).catch(() => undefined);
    releaseContext();
    await page.waitForFunction(() => [...document.querySelectorAll('[role="menuitemcheckbox"]')].some((i) => !i.disabled));
    if (patches.length < 2) await tool('Notes').click();
    await page.waitForTimeout(300);

    const last = patches[patches.length - 1].toolboxes;
    assert.ok(patches.slice(1).every((p) => !p.toolboxes.includes('search')), `a later toggle put web search back on: ${JSON.stringify(patches.map((p) => p.toolboxes))}`);
    assert.deepEqual([...last].sort(), ['core', 'notes'], 'the final selection keeps both changes');
    assert.equal(await tool('Web search').getAttribute('aria-checked'), 'false', 'web search is still off');
    assert.equal(await tool('Notes').getAttribute('aria-checked'), 'true');
    console.log('PASS quick second toggle keeps the first change', JSON.stringify(patches.map((p) => p.toolboxes)));
    assert.deepEqual(errors, [], 'no page errors');
  } finally {
    await browser.close();
    await fixture.close();
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
