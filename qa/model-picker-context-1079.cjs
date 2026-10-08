// #1079: the chat's model picker offers "Context: Low / High" for a model that has a long-context
// profile (`<model>-long`, made by a Long tune). High is saved on the chat's project as
// contextProfile 'high' (the model pick and Auto's roles keep naming the model); Low clears it. The
// choice is shown only for a model with such a profile, in Manual and in Auto, and says that
// switching reloads the model. Offline: synthetic routes, a real dialog, 375 and 1440 px.
// QA_DIST serves a build elsewhere; QA_SCREENSHOTS is the screenshot directory.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createFixture } = require('./diary-fixture.cjs');
const { withLocale } = require('./qa-locale.cjs');

const OUT = process.env.QA_SCREENSHOTS || '/tmp';
const BASE = 'Synthetic-12B-it', OTHER = 'Synthetic-9B';

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const fixture = createFixture(31079);
  await fixture.listen();
  const browser = await chromium.launch({ headless: true, executablePath: process.env.QA_CHROME_PATH || undefined, channel: process.env.QA_CHROME_PATH ? undefined : 'chrome' });
  let failed = null;
  try {
    for (const width of [375, 1440]) {
      const page = await browser.newPage(withLocale({ viewport: { width, height: 900 } }));
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const errors = [], patches = [];
      page.on('pageerror', (e) => errors.push(e.message));
      const project = { id: 'p1', name: 'Synthetic', model: BASE, routing: 'manual', routingChosen: true, files: [], assets: [], toolboxes: ['core'] };
      await page.route('**/api/chats/*/context', (r) => r.fulfill({ json: { project: { ...project } } }));
      await page.route('**/api/providers', (r) => r.fulfill({ json: { providers: [{ id: 'default', label: 'Native', baseUrl: 'http://synthetic.invalid/v1', managed: true, isDefault: true }] } }));
      await page.route('**/api/auto-roles', (r) => r.fulfill({ json: { configured: true, roles: { fast: OTHER, smart: BASE } } }));
      await page.route('**/api/models/capabilities', (r) => r.fulfill({ json: { kind: 'llamacpp', admin: false, presets: true, runtimeOptions: false, modelManagement: false } }));
      await page.route('**/api/models/installed', (r) => r.fulfill({ json: [
        { name: BASE, labels: [], loaded: false, sizeGB: 7.3, longVariant: BASE + '-long', longLoaded: false },
        { name: OTHER, labels: [], loaded: true, sizeGB: 5.6 },
      ] }));
      await page.route('**/api/projects/*/config', async (r) => {
        const body = r.request().postDataJSON();
        patches.push(body);
        if ('contextProfile' in body) { if (body.contextProfile === 'high') project.contextProfile = 'high'; else delete project.contextProfile; }
        if (body.model) project.model = body.model;
        if (body.routing) project.routing = body.routing;
        await r.fulfill({ json: { ok: true } });
      });
      const problems = [];
      const check = async (label, fn) => { try { await fn(); } catch (e) { problems.push(label + ': ' + String(e.message).split('\n')[0]); } };
      try {
        await page.goto('http://localhost:31079');
        const pill = page.getByRole('button', { name: /^Choose model/ }).filter({ visible: true }).first();
        await pill.waitFor({ timeout: 10000 });
        await pill.click();
        const dialog = page.locator('dialog.model-dialog-backdrop');
        await dialog.locator('.mp-models').waitFor({ timeout: 5000 });
        const context = dialog.getByRole('radiogroup', { name: 'Context' });
        const radio = (name) => context.getByRole('radio', { name, exact: true });
        await check('Context is offered for a model with a long-context profile, Low by default', async () => {
          await context.waitFor({ timeout: 3000 });
          assert.equal(await radio('Low').getAttribute('aria-checked'), 'true');
          assert.equal(await radio('High').getAttribute('aria-checked'), 'false');
        });
        await check('the hint says High is the long-context profile and that switching reloads', async () => {
          const hint = (await dialog.locator('.mp-context .mp-hint').innerText()).replace(/\s+/g, ' ');
          assert.match(hint, /long-context profile/);
          assert.match(hint, /reloads/);
          assert.match(hint, /may take a moment/);
        });
        await dialog.locator('.mp-context').scrollIntoViewIfNeeded().catch(() => {});
        await dialog.locator('.mp-panel').screenshot({ path: `${OUT}/model-picker-context-1079-low-${width}.png` });
        await check('High saves contextProfile high for this chat, and keeps the model pick', async () => {
          await radio('High').click();
          await page.waitForFunction(() => document.querySelector('.mp-context [role="radio"][aria-checked="true"]')?.textContent === 'High', null, { timeout: 3000 });
          assert.deepEqual(patches.at(-1), { contextProfile: 'high' });
          assert.equal(project.model, BASE);
        });
        await check('the chosen segment is visibly marked, not only by aria-checked', async () => {
          const look = (name) => radio(name).evaluate((el) => { const c = getComputedStyle(el); return c.backgroundColor + '|' + c.boxShadow; });
          assert.notEqual(await look('High'), await look('Low'));
        });
        await dialog.locator('.mp-panel').screenshot({ path: `${OUT}/model-picker-context-1079-high-${width}.png` });
        await check('keyboard: arrow keys move the choice back to Low, which clears it', async () => {
          await radio('High').focus();
          await page.keyboard.press('ArrowLeft');
          await page.waitForFunction(() => document.querySelector('.mp-context [role="radio"][aria-checked="true"]')?.textContent === 'Low', null, { timeout: 3000 });
          assert.deepEqual(patches.at(-1), { contextProfile: 'low' });
          assert.equal('contextProfile' in project, false);
        });
        await check('a model without a long-context profile has no Context choice', async () => {
          await dialog.getByRole('button', { name: new RegExp(OTHER) }).first().click();
          await page.waitForFunction(() => document.querySelector('.mp-model[aria-pressed="true"]')?.textContent?.includes('Synthetic-9B'), null, { timeout: 3000 });
          await page.waitForTimeout(200);
          assert.equal(await context.count(), 0);
        });
        await check('in Auto, the choice is offered when a model Auto answers with has a profile', async () => {
          await dialog.locator('.mp-mode-btn').first().click();
          await context.waitFor({ timeout: 3000 });
          const hint = (await dialog.locator('.mp-context .mp-hint').innerText()).replace(/\s+/g, ' ');
          assert.match(hint, /each routed model/);
        });
        await dialog.locator('.mp-panel').screenshot({ path: `${OUT}/model-picker-context-1079-auto-${width}.png` });
        await check('no horizontal overflow in the dialog', async () => {
          const over = await dialog.locator('.mp-panel').evaluate((el) => el.scrollWidth - el.clientWidth);
          assert.ok(over <= 1, 'overflows by ' + over + 'px');
        });
        await check('no page errors', async () => { assert.deepEqual(errors, []); });
        if (problems.length) throw Error(problems.length + ' problem(s):\n  ' + problems.join('\n  '));
        console.log(`PASS ${width}px`);
      } catch (e) { failed = e; console.log(`FAIL ${width}px: ${e.message}`); }
      await page.close();
    }
  } finally { await browser.close(); await fixture.close(); }
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
