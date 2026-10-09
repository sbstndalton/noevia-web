// Live-tester bugs, synthetic APIs only (no model runs, no real credentials):
//  #1167 the sidebar project hover card stays inside a 508px-wide viewport
//  #1173 a Planner review of "no_change" never says "Nobody answered in time"
//  #1174 the inference memory budget refuses -1 inline, beside the field, and sends nothing
//  #1175 the locked "Always allow" status region exists before the first click
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { openSettings, openModelsTab, navClick } = require('./nav.cjs');
const assert = require('node:assert/strict');
const { createFixture } = require('./diary-fixture.cjs');
const { withLocale } = require('./qa-locale.cjs');
const PORT = Number(process.env.QA_PORT || 31181);
const NAME = 'synthetic-12b-it';
(async () => {
  const fixture = createFixture(PORT); await fixture.listen();
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const problems = [];
  const check = async (label, fn) => { try { await fn(); console.log('ok  ', label); } catch (e) { problems.push(label); console.log('FAIL', label, String(e.message).split('\n')[0]); } };
  const fresh = async (viewport) => { const page = await browser.newPage(withLocale({ viewport })); await page.emulateMedia({ reducedMotion: 'reduce' }); return page; };
  try {
    // #1175
    await check('#1175 the Always allow status region is mounted before the first click', async () => {
      const page = await fresh({ width: 1440, height: 900 });
      await page.goto(`http://localhost:${PORT}`); await page.getByPlaceholder('Message noevia…').waitFor();
      await page.getByRole('button', { name: 'Customise', exact: true }).click();
      const s = page.locator('.plugins-page'); await s.getByRole('button', { name: 'Nextcloud' }).click();
      await s.getByRole('heading', { name: 'Nextcloud', level: 1 }).waitFor();
      const group = s.getByRole('radiogroup', { name: 'nc_notes_create permission' });
      const region = group.locator('xpath=following-sibling::*[@role="status"]');
      assert.equal(await region.count(), 1, 'live region present before any click');
      assert.equal((await region.textContent()).trim(), '', 'and empty');
      await group.getByRole('radio', { name: /Always allow/ }).click({ force: true });
      await region.filter({ hasText: /Writes always need your approval/ }).waitFor({ timeout: 2000 });
      await page.close();
    });

    // #1167
    await check('#1167 the project hover card stays inside a 508px viewport', async () => {
      const page = await fresh({ width: 508, height: 689 });
      const base = { goal: 'Keep the household accounts', instructions: '', memories: [], files: [], sourceFolders: [], modes: ['chat'], assets: [], toolboxes: [], createdAt: 1, updatedAt: 1, chats: [] };
      await page.route('**/api/workspace', r => r.fulfill({ json: { projects: [{ ...base, id: 'fin', name: 'Finance' }], freeChats: [] } }));
      await page.goto(`http://localhost:${PORT}`);
      const toggle = page.getByRole('button', { name: 'Open navigation', exact: true });
      await toggle.waitFor(); await toggle.click(); await page.waitForTimeout(800);
      const row = page.getByRole('button', { name: 'Open Finance', exact: true }); await row.waitFor({ timeout: 5000 });
      await row.hover();
      const card = page.locator('.row-card'); await card.waitFor({ timeout: 5000 });
      await page.waitForTimeout(250);
      const box = await card.boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= 508, `card ${Math.round(box.x)}..${Math.round(box.x + box.width)} fits 508`);
      await page.close();
    });

    // #1173
    await check('#1173 a no_change review does not claim a timeout', async () => {
      const page = await fresh({ width: 1440, height: 900 });
      const TASK = '12345678-1234-4234-8234-123456789012', SHA = 'a'.repeat(40);
      const base = { goal: '', instructions: '', memories: [], files: [], assets: [], chats: [], toolboxes: ['core'], createdAt: 1000, updatedAt: 1000, modes: ['chat'] };
      await page.route('**/api/workspace', r => r.fulfill({ json: { projects: [{ ...base, id: 'p1', name: 'Snake' }], freeChats: [] } }));
      await page.route('**/api/projects/*/skills', r => r.fulfill({ json: { skills: [] } }));
      await page.route('**/api/features', r => r.fulfill({ json: { flags: { codeHarness: true, plannerReview: true } } }));
      const review = { status: 'failed', reviewer: 'planner', baseSha: SHA, headSha: SHA, code: 'no_change', reason: 'The task made no commits, so there is nothing to review.' };
      const timeoutTask = { ...review, code: 'timeout', reason: 'The review did not finish within 180 seconds.' };
      const task = (id, name, r) => ({ id, status: 'completed', stage: null, error: null, createdAt: 1, updatedAt: 2, task: name, branch: 'noevia/' + id.slice(0, 4), meta: null, identityHash: null,
        capabilities: ['read_repository'], steps: [], plan: null, assistantOutput: null, approval: null, review: r,
        result: { tools: 1, allowed: 1, refused: 0, denied: 0, review: { reviewed: false, verdict: null, accepted: false, decision: 'timeout', headSha: SHA } } });
      await page.route('**/api/projects/p1/code**', r => r.fulfill({ json: { repositories: [{ id: 'scratch' }], capabilities: ['read_repository'], defaultCapabilities: ['read_repository'],
        harnesses: [{ id: 'opencode', label: 'OpenCode', version: '1.18.31' }], promptPreparation: [{ id: 'direct', label: 'Direct', available: true, reason: 'Direct' }], sandboxed: true, network: false,
        tasks: [task(TASK, 'create a python snake game', review), task('22222222-2222-4222-8222-222222222222', 'slow review', timeoutTask)] } }));
      await page.goto(`http://localhost:${PORT}`); await page.getByPlaceholder('Message noevia…').waitFor();
      await navClick(page, 'Projects'); await page.locator('.project-card').filter({ hasText: 'Snake' }).first().click();
      await page.getByRole('tab', { name: 'Code' }).click();
      const outcomes = page.getByRole('region', { name: 'Planner review' });
      await outcomes.first().waitFor();
      assert.equal(await outcomes.count(), 2);
      const noChange = outcomes.filter({ hasText: 'made no commits' });
      await noChange.getByText('There was no change to accept.').waitFor();
      assert.equal(await noChange.getByText(/Nobody answered in time/).count(), 0);
      // A real timeout still says so.
      await outcomes.filter({ hasText: 'did not finish' }).getByText(/Nobody answered in time/).waitFor();
      await page.close();
    });

    // #1174
    await check('#1174 -1 as the memory budget is refused inline and nothing is sent', async () => {
      const page = await fresh({ width: 1440, height: 1000 });
      const puts = [];
      const budget = { budgetGib: 16, source: 'admin', defaultGib: 16, minGib: 2, maxGib: 25, models: [] };
      await page.route('**/api/**', async route => {
        const req = route.request(), p = new URL(req.url()).pathname;
        const json = (body, status = 200) => route.fulfill({ json: body, status });
        if (p === '/api/models/inference-budget') { if (req.method() === 'PUT') { puts.push(req.postDataJSON()); return json({ ...budget, budgetGib: req.postDataJSON().budgetGib }); } return json(budget); }
        if (p === '/api/profile' || p === '/api/auth/session') return json({ user: { id: 'qa', username: 'admin', displayName: 'Synthetic admin', role: 'admin', diaryEnabled: false, onboarded: true }, passkeys: [] });
        if (p === '/api/models/capabilities') return json({ kind: 'llamacpp', admin: true, autotune: true, presets: true, download: true, modelManagement: true });
        if (p === '/api/models/installed') return json([{ name: NAME, loaded: false, labels: [], sizeGB: 7.3, status: 'unloaded' }]);
        if (p === '/api/auto-roles') return json({ configured: true, roles: { fast: NAME, smart: NAME }, missing: [] });
        if (p === '/api/models/evidence') return json({ tracked: true, categories: [] });
        if (p === '/api/models/hardware') return json({ source: 'model-manager', cpu: 'Synthetic CPU', systemGB: 64, gpus: [] });
        if (p === '/api/models/autotune/settings' || (p === '/api/models/autotune' && req.method() === 'GET')) return json({ job: null, history: [], kvCandidates: ['bf16'], settings: { allowQ5Kv: false }, planImpl: 'wasm', loadAdvisor: 'off', modes: { fast: { defaultSeconds: 120, maxSeconds: 1800 }, long: { defaultSeconds: 1800, maxSeconds: 1800 } } });
        if (p === '/api/models/autotune/untuned') return json({ models: [], skipped: [] });
        if (p === '/api/models/calibration') return json({ job: null, history: [] });
        if (p === '/api/model-manager/sections') return json({ revision: 'r1', schema: [], sections: [], unregistered: [], backups: [] });
        if (p.startsWith('/api/model-manager/downloads')) return json({ jobs: [] });
        if (p.startsWith('/api/model-manager/')) return json({});
        return route.continue();
      });
      await page.goto(`http://localhost:${PORT}`);
      await openSettings(page);
      const settings = page.getByRole('dialog', { name: 'Settings' });
      await settings.getByRole('button', { name: 'Models & routing' }).click();
      await settings.getByRole('button', { name: 'Open model manager' }).click();
      const manager = page.locator('.model-manager-page');
      await openModelsTab(manager, 'Overview');
      const field = manager.getByLabel('Budget (GiB)');
      await field.waitFor({ timeout: 5000 });
      assert.equal((await manager.locator('#mm-budget-problem').textContent()).trim(), '', 'no complaint about the saved 16');
      await field.fill('-1');
      // #1185 nit: the live-typing refusal is a polite live region, not an assertive alert.
      const alert = manager.locator('#mm-budget-problem[aria-live="polite"]').filter({ hasText: /Enter a budget from/ });
      await alert.waitFor({ timeout: 3000 });
      assert.equal(await field.getAttribute('aria-invalid'), 'true');
      const save = manager.getByRole('button', { name: 'Save budget' });
      assert.equal(await save.isDisabled(), true);
      await save.click({ force: true }); await page.waitForTimeout(200);
      assert.equal(puts.length, 0, 'no PUT was sent');
      await field.fill('20');
      assert.equal((await manager.locator('#mm-budget-problem').textContent()).trim(), '', 'a valid value clears the message');
      assert.equal(await manager.getByRole('alert').filter({ hasText: /Enter a budget from/ }).count(), 0, 'not role=alert');
      await save.click(); await manager.getByText('Saved.', { exact: false }).first().waitFor({ timeout: 3000 }).catch(() => {});
      assert.deepEqual(puts, [{ budgetGib: 20 }]);
      await page.close();
    });
  } finally { await browser.close(); await fixture.close?.(); }
  if (problems.length) { console.log(problems.length + ' problem(s)'); process.exitCode = 1; } else console.log('PASS live-bugs-1167-1173-1174-1175');
})().catch(e => { console.error(e); process.exitCode = 1; });
