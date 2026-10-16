// #1886: viewing a project and pressing "Refresh from storage" must make zero POST /config calls;
// changing one setting makes exactly one. Offline: every API is a synthetic stub.
//   PLAYWRIGHT_MODULE=<playwright-core> QA_DIST=<dist dir> node qa/project-config-no-write-on-view-1886.cjs
// Fails on a build without the fix (the refresh POSTs the unchanged folder list), passes with it.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || `${process.env.HOME}/noevia-local-test/node_modules/playwright-core`);
const assert = require('node:assert/strict');
const { createFixture } = require('./diary-fixture.cjs');
const { navClick } = require('./nav.cjs');

(async () => {
  const fixture = createFixture(0);
  await fixture.listen();
  const origin = `http://127.0.0.1:${fixture.server.address().port}`;
  const browser = await chromium.launch({ headless: true, ...(process.env.QA_CHROME_PATH ? { executablePath: process.env.QA_CHROME_PATH } : { channel: 'chrome' }) });
  let failed = false;
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const project = { id: 'fin', name: 'Synthetic finance', goal: '', instructions: 'Synthetic instructions', memories: [], files: [], chats: [], sourceFolders: ['Synthetic folder'], createdAt: 1, updatedAt: 1 };
    const configPosts = [], syncs = [];
    await page.route('**/api/**', (route) => {
      const req = route.request(), path = new URL(req.url()).pathname;
      if (path === '/api/workspace') return route.fulfill({ json: { projects: [project], freeChats: [] } });
      if (path === '/api/projects/fin/skills') return route.fulfill({ json: { skills: [] } });
      if (path === '/api/projects/fin/config' && req.method() === 'POST') { configPosts.push(req.postDataJSON()); Object.assign(project, req.postDataJSON()); return route.fulfill({ json: { ok: true } }); }
      if (path === '/api/projects/fin/sources/sync') { syncs.push(1); return route.fulfill({ json: { files: [], skipped: [] } }); }
      return route.continue();
    });
    await page.goto(origin);
    await page.locator('.sidebar').waitFor({ state: 'attached' });
    await navClick(page, 'Projects');
    await page.locator('.projects-grid').getByRole('button', { name: `Open project ${project.name}`, exact: true }).click();
    await page.getByRole('tab', { name: /^Sources(?: \(\d+\))?$/ }).click();
    const syncsBefore = syncs.length;
    await page.getByRole('button', { name: 'Refresh from storage', exact: true }).click();
    await page.waitForFunction(() => !document.body.innerText.includes('Refreshing'), null, { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1200); // past the 600 ms debounce
    assert.ok(syncs.length > syncsBefore, 'the refresh still syncs sources');
    assert.equal(configPosts.length, 0, `a view plus refresh made config writes: ${JSON.stringify(configPosts)}`);
    console.log('PASS 1886: view + refresh made zero config POSTs');

    await page.getByRole('tab', { name: /^Chats(?: \(\d+\))?$/ }).click().catch(() => {});
    await page.locator('.rail-row-btn', { hasText: 'Instructions' }).click();
    const box = page.locator('.project-rail textarea').first();
    await box.fill('Synthetic changed instructions');
    await page.waitForTimeout(1500);
    assert.equal(configPosts.length, 1, `one setting change should make exactly one POST, got ${configPosts.length}`);
    assert.equal(configPosts[0].instructions, 'Synthetic changed instructions');
    console.log('PASS 1886: one changed setting made exactly one config POST');
  } catch (e) { failed = true; console.log('FAIL 1886:', String(e.message).split('\n').slice(0, 8).join('\n')); }
  finally { await browser.close(); await fixture.close?.(); fixture.server.close(); }
  process.exit(failed ? 1 : 0);
})();
