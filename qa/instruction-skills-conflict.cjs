// Synthetic browser/API regression for the real Sources component. No live model or storage.
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { createFixture } = require('./diary-fixture.cjs');
const { navClick } = require('./nav.cjs');
const skills = require('../server/instruction-skills.cjs');

const file = 'review.md';
const content = version => `---\nname: Weekly review\ndescription: Review synthetic notes\nversion: ${version}\n---\nINSTRUCTIONS ${version}`;
const project = (id, body) => ({ id, name: `Project ${id}`, goal: '', instructions: '', memories: [], assets: [],
  sourceFolders: [], toolboxes: ['core'], modes: ['chat'], chats: [], createdAt: 1, updatedAt: 1,
  files: [{ name: file, content: body }], instructionSkills: {} });

(async () => {
  const fixture = createFixture(31425); await fixture.listen();
  const browser = await chromium.launch({ headless: true, channel: process.env.QA_CHANNEL || 'chrome' });
  try {
    for (const [width, theme] of [[375, 'dark'], [375, 'light'], [1440, 'dark'], [1440, 'light']]) {
      const first = project('first', content('one'));
      const second = project('second', 'Ordinary synthetic source text');
      const projects = { first, second };
      let failNextGet = false, failNextPut = false, holdNextGet = false, releaseGet;
      const puts = [], errors = [];
      const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: width < 768 });
      await context.addInitScript(t => localStorage.setItem('cowork-theme', t), theme);
      await context.route('**/api/workspace', route => route.fulfill({ json: { projects: Object.values(projects), freeChats: [] } }));
      await context.route('**/api/projects/*/instruction-skills', async route => {
        const id = new URL(route.request().url()).pathname.split('/')[3];
        const state = projects[id];
        if (!state) return route.fulfill({ status: 404, json: { error: 'No such project' } });
        if (route.request().method() === 'GET') {
          const snapshot = skills.list(state);
          if (holdNextGet && id === 'first') {
            holdNextGet = false;
            await new Promise(resolve => { releaseGet = resolve; });
          }
          if (failNextGet && id === 'first') {
            failNextGet = false;
            return route.fulfill({ status: 503, json: { error: 'Synthetic temporary load failure' } });
          }
          return route.fulfill({ json: { skills: snapshot } });
        }
        if (route.request().method() !== 'PUT') return route.fulfill({ status: 405 });
        const body = route.request().postDataJSON(); puts.push({ id, ...body });
        if (failNextPut) {
          failNextPut = false;
          return route.fulfill({ status: 503, json: { error: 'Synthetic temporary action failure' } });
        }
        try { skills.setSelection(state, body); return route.fulfill({ json: { skills: skills.list(state) } }); }
        catch (error) { return route.fulfill({ status: error.status || 400, json: { error: error.message } }); }
      });
      // A separate browser client changes the project without updating the first tab's workspace prop.
      await context.route('**/api/qa/replace-skill', route => {
        first.files[0].content = content(route.request().postDataJSON().version);
        route.fulfill({ json: { ok: true } });
      });
      const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
      await page.goto('http://localhost:31425');
      await page.getByPlaceholder('Message noevia…').waitFor();
      await navClick(page, 'Projects');
      await page.locator('.project-card').filter({ hasText: 'Project first' }).first().click();
      await page.getByRole('tab', { name: /Sources/ }).click();
      const panel = page.getByRole('region', { name: 'Instruction skills' });
      await panel.locator('summary').first().click();
      await panel.getByText('INSTRUCTIONS one').waitFor();
      const other = await context.newPage();
      await other.goto('http://localhost:31425');
      const replace = version => other.evaluate(async v => {
        const response = await fetch('/api/qa/replace-skill', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: v }) });
        if (!response.ok) throw Error('Synthetic second-client edit failed');
      }, version);

      await replace('two');
      await panel.getByRole('button', { name: 'Enable this version' }).click();
      await panel.getByText('INSTRUCTIONS two').waitFor();
      assert.match(await panel.getByRole('alert').innerText(), /file changed.*current version is now shown/i);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${width}/${theme}: conflict layout overflows`);
      assert.equal(skills.list(first)[0].status, 'review');
      assert.equal(puts.length, 1);
      const newHash = skills.list(first)[0].hash;
      await panel.getByRole('button', { name: 'Enable this version' }).click();
      await panel.locator('summary').first().getByText('Enabled').waitFor();
      assert.equal(puts.length, 2);
      assert.equal(puts[1].hash, newHash);
      assert.equal(skills.list(first)[0].status, 'enabled');

      // An ordinary action failure remains visible and can be retried without a reload.
      failNextPut = true;
      await panel.getByRole('button', { name: 'Disable' }).click();
      assert.match(await panel.getByRole('alert').innerText(), /Synthetic temporary action failure/);
      assert.equal(skills.list(first)[0].status, 'enabled');
      assert.equal(await panel.getByRole('button', { name: 'Reload current version' }).count(), 0);

      // A failed recovery GET leaves stale approval blocked and offers a visible retry.
      await panel.getByRole('button', { name: 'Disable' }).click();
      await replace('three'); failNextGet = true;
      await panel.getByRole('button', { name: 'Enable this version' }).click();
      await panel.getByRole('button', { name: 'Reload current version' }).waitFor();
      assert.match(await panel.getByRole('alert').innerText(), /Could not load the current version.*Synthetic temporary load failure/i);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${width}/${theme}: recovery error layout overflows`);
      assert.equal(await panel.getByRole('button', { name: 'Enable this version' }).isDisabled(), true);
      const beforeRetry = puts.length;
      await panel.getByRole('button', { name: 'Reload current version' }).click();
      await panel.getByText('INSTRUCTIONS three').waitFor();
      assert.equal(puts.length, beforeRetry);
      assert.equal(skills.list(first)[0].status, 'updated');

      // A same-project prop refresh invalidates a pending recovery without leaving the action busy.
      await replace('four'); holdNextGet = true;
      await panel.getByRole('button', { name: 'Enable this version' }).click();
      for (let i = 0; !releaseGet && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 10));
      assert.ok(releaseGet, 'same-project recovery GET was pending');
      first.updatedAt++;
      await page.evaluate(() => dispatchEvent(new Event('noevia:workspace-changed')));
      await panel.getByText('INSTRUCTIONS four').waitFor();
      releaseGet(); releaseGet = undefined;
      await panel.getByRole('button', { name: 'Enable this version' }).waitFor({ state: 'visible' });
      assert.equal(await panel.getByRole('button', { name: 'Enable this version' }).isDisabled(), false);
      assert.equal(await panel.getByRole('button', { name: 'Enable this version' }).getAttribute('aria-disabled'), 'false');
      const afterPropRefresh = puts.length;
      await panel.getByRole('button', { name: 'Enable this version' }).click();
      await panel.locator('summary').first().getByText('Enabled').waitFor();
      assert.equal(puts.length, afterPropRefresh + 1, 'action guard cleared after same-project refresh');
      await panel.getByRole('button', { name: 'Disable' }).click();
      await panel.locator('summary').first().getByText('Disabled').waitFor();

      // An older effect GET snapshot must not overwrite the newer conflict refresh.
      holdNextGet = true; first.updatedAt++;
      await page.evaluate(() => dispatchEvent(new Event('noevia:workspace-changed')));
      for (let i = 0; !releaseGet && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 10));
      assert.ok(releaseGet, 'old list GET was pending');
      await replace('five');
      await panel.getByRole('button', { name: 'Enable this version' }).click();
      await panel.getByText('INSTRUCTIONS five').waitFor();
      releaseGet(); releaseGet = undefined;
      await page.waitForTimeout(100);
      await panel.getByText('INSTRUCTIONS five').waitFor();
      assert.equal(await panel.getByText('INSTRUCTIONS four').count(), 0);

      // A delayed recovery response for the old project must not label the new project's source as a skill.
      await replace('six'); holdNextGet = true;
      await panel.getByRole('button', { name: 'Enable this version' }).click();
      for (let i = 0; !releaseGet && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 10));
      assert.ok(releaseGet, 'old-project recovery GET was pending');
      await navClick(page, 'Projects');
      await page.locator('.project-card').filter({ hasText: 'Project second' }).first().click();
      await page.getByRole('tab', { name: /Sources/ }).click();
      await page.getByText('Text ready').waitFor();
      releaseGet();
      await page.waitForTimeout(100);
      await page.getByText('Text ready').waitFor();
      assert.equal(await page.getByText('Instruction skill · review and enable above').count(), 0);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${width}/${theme}: horizontal overflow`);
      assert.deepEqual(errors, [], `${width}/${theme}: browser errors`);
      await context.close();
    }
    console.log('PASS instruction skills conflict: current review, explicit second approval, refresh failure/retry, same-project refresh and navigation guards, 375/1440 light/dark.');
  } finally { await browser.close(); await fixture.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
