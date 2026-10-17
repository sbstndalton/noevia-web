'use strict';
// noevia#1978: a finished auto-tune run could not be cleared from the Recover card, and "Stopped at" had to be dug
// out of models[].phases because the server overwrites job.phase. The card now has a Dismiss button that POSTs
// /api/models/autotune/clear and refreshes, and prefers the server's failedPhase/failedStep. Mocked API only: the one
// write the script allows is that clear call; a Resume/Restart POST fails it.
//   QA_DIST=<dist dir> QA_CORE_SERVER=<core server/> [QA_SHOTS=<dir>] [QA_SHOT=<file name>] node qa/models-recover-dismiss-autotune-1978.cjs
const path = require('node:path');
const assert = require('node:assert/strict');
const { openModelsTab } = require('./nav.cjs');
const { createFixture } = require('./diary-fixture.cjs');
const { withLocale } = require('./qa-locale.cjs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || `${process.env.HOME}/noevia-local-test/node_modules/playwright-core`);

const PORT = Number(process.env.QA_PORT || 31978);
const SHOTS = process.env.QA_SHOTS;
const MODEL = 'Qwen3.5-4B-UD-Q8_K_XL';
const admin = { id: 'qa-admin', username: 'qa-admin', displayName: 'Synthetic admin', role: 'admin', diaryEnabled: false, onboarded: true };
const GENERIC = 'The model server request failed.';
const phases = (stepReason) => [
  { id: 'sampling', label: 'Sampling', status: 'passed', steps: [{ id: 'apply', label: 'Recommended sampling', status: 'passed' }] },
  { id: 'kv', label: 'KV cache', status: 'failed', reason: GENERIC, steps: [{ id: 'q8_0', label: 'q8_0 KV cache', status: 'failed', reason: stepReason }] },
  { id: 'context', label: 'Context', status: 'pending', steps: [] },
];
const job = (extra = {}) => ({ id: 'job-1', model: MODEL, status: 'failed', phase: 'Failed', error: GENERIC, startedAt: Date.now() - 3.2 * 3600e3, finishedAt: Date.now() - 3 * 3600e3,
  models: [{ model: MODEL, status: 'failed', phases: phases(GENERIC) }], ...extra });

async function open(browser, autotuneJob, posts, clearStatus = 200) {
  let current = autotuneJob;
  const page = await browser.newPage(withLocale({ viewport: { width: 1440, height: 1000 } }));
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/api/**', async (route) => {
    const req = route.request(), pathname = new URL(req.url()).pathname;
    if (req.method() === 'POST' && pathname === '/api/models/autotune/clear') {
      posts.push(`POST ${pathname}`);
      if (clearStatus !== 200) return route.fulfill({ status: clearStatus, json: { error: 'Auto-tune is running. Cancel it before clearing.' } });
      current = null; return route.fulfill({ json: { cleared: true } });
    }
    if (req.method() !== 'GET') { posts.push(`${req.method()} ${pathname}`); return route.fulfill({ status: 500, json: { error: 'QA: no writes' } }); }
    if (pathname === '/api/profile' || pathname === '/api/auth/session') return route.fulfill({ json: { user: admin, passkeys: [] } });
    if (pathname === '/api/models/capabilities') return route.fulfill({ json: { kind: 'llamacpp', admin: true, presets: true, download: true, runtimeOptions: false, modelManagement: true } });
    if (pathname === '/api/models/autotune') return route.fulfill({ json: { job: current, history: [] } });
    if (pathname === '/api/models/calibration') return route.fulfill({ json: { job: null } });
    if (pathname === '/api/models/installed') return route.fulfill({ json: [{ name: MODEL, labels: [] }] });
    if (pathname === '/api/model-manager/backends') return route.fulfill({ json: { backends: [{ name: 'cowork-llama-1', found: true, status: 'running', loaded_model: null, probe_error: null, last_restart_error: null }] } });
    if (pathname === '/api/model-manager/downloads') return route.fulfill({ json: { jobs: [] } });
    if (pathname.startsWith('/api/model-manager/')) return route.fulfill({ json: { models: [], unregistered: [], sections: [], revision: 'r1' } });
    if (pathname.startsWith('/api/models/')) return route.fulfill({ json: [] });
    return route.continue();
  });
  await page.goto(`http://localhost:${PORT}/models`);
  await openModelsTab(page, 'Overview');
  return { page, errors };
}

(async () => {
  const fixture = createFixture(PORT);
  await fixture.listen();
  const browser = await chromium.launch({ headless: true, ...(process.env.QA_CHROME_PATH ? { executablePath: process.env.QA_CHROME_PATH } : { channel: process.env.QA_CHANNEL || 'chrome' }) });
  let failed = 0;
  const check = async (label, fn) => { try { await fn(); console.log(`PASS 1978: ${label}`); } catch (e) { failed++; console.log(`FAIL 1978: ${label}\n  ${String(e.message).split('\n').slice(0, 5).join('\n  ')}`); } };
  try {
    await check('Dismiss clears a finished failed run through the server and the card goes away', async () => {
      const posts = [];
      const { page, errors } = await open(browser, job(), posts);
      const panel = page.getByRole('region', { name: 'Recover' });
      const row = panel.locator('.mm-recover-list li');
      await row.waitFor({ timeout: 15000 });
      if (SHOTS) { await panel.scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(SHOTS, process.env.QA_SHOT || '1978.png') }); }
      const dismiss = row.getByRole('button', { name: 'Dismiss' });
      await dismiss.waitFor({ timeout: 2000 });
      assert.equal(await dismiss.isEnabled(), true, 'Dismiss needs no confirm tick');
      await dismiss.click();
      await panel.getByText('No failed or stuck tuning, calibration or download jobs.').waitFor({ timeout: 5000 });
      assert.equal(await row.count(), 0, 'the card is gone after the refresh');
      assert.deepEqual(posts, ['POST /api/models/autotune/clear']);
      assert.deepEqual(errors, []); await page.close();
    });
    await check('Stopped at prefers the server\'s failedPhase/failedStep over the phases dug out of models[]', async () => {
      const posts = [];
      const { page } = await open(browser, job({ failedPhase: 'Drafting', failedStep: 'n-gram drafting', models: [] }), posts);
      const row = page.locator('.mm-recover-list li');
      await row.getByText('Stopped at: Drafting — n-gram drafting').waitFor({ timeout: 15000 });
      assert.deepEqual(posts, []); await page.close();
    });
    await check('a refused clear keeps the card and says why', async () => {
      const posts = [];
      const { page } = await open(browser, job(), posts, 409);
      const row = page.locator('.mm-recover-list li');
      await row.getByRole('button', { name: 'Dismiss' }).click();
      await page.getByRole('alert').getByText('Auto-tune is running. Cancel it before clearing.').waitFor({ timeout: 5000 });
      assert.equal(await row.count(), 1);
      assert.deepEqual(posts, ['POST /api/models/autotune/clear']); await page.close();
    });
  } finally { await browser.close(); await fixture.close(); }
  if (failed) process.exitCode = 1;
})().catch((e) => { console.error(e); process.exitCode = 1; });
