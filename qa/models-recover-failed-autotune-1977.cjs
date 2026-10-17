'use strict';
// noevia#1977: the Recover card's failed Auto-tune row said only "The model server request failed." with
// no time, no place, and no word on what Resume does. It now shows when the run ended (relative, absolute
// on hover), where it stopped (the phase and step the server marked failed, plus their reason when it says
// more than the job's error), and explains Resume. The server has no way to clear a finished run, so there
// is no dismiss control. Mocked API only; no Resume/Restart is ever pressed (any POST fails the script).
//   QA_DIST=<dist dir> QA_CORE_SERVER=<core server/> [QA_SHOTS=<dir>] [QA_SHOT=<file name>] node qa/models-recover-failed-autotune-1977.cjs
const path = require('node:path');
const assert = require('node:assert/strict');
const { openModelsTab } = require('./nav.cjs');
const { createFixture } = require('./diary-fixture.cjs');
const { withLocale } = require('./qa-locale.cjs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || `${process.env.HOME}/noevia-local-test/node_modules/playwright-core`);

const PORT = Number(process.env.QA_PORT || 31977);
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

async function open(browser, autotuneJob, posts) {
  const page = await browser.newPage(withLocale({ viewport: { width: 1440, height: 1000 } }));
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/api/**', async (route) => {
    const req = route.request(), pathname = new URL(req.url()).pathname;
    if (req.method() !== 'GET') { posts.push(`${req.method()} ${pathname}`); return route.fulfill({ status: 500, json: { error: 'QA: no writes' } }); }
    if (pathname === '/api/profile' || pathname === '/api/auth/session') return route.fulfill({ json: { user: admin, passkeys: [] } });
    if (pathname === '/api/models/capabilities') return route.fulfill({ json: { kind: 'llamacpp', admin: true, presets: true, download: true, runtimeOptions: false, modelManagement: true } });
    if (pathname === '/api/models/autotune') return route.fulfill({ json: { job: autotuneJob, history: [] } });
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
  const check = async (label, fn) => { try { await fn(); console.log(`PASS 1977: ${label}`); } catch (e) { failed++; console.log(`FAIL 1977: ${label}\n  ${String(e.message).split('\n').slice(0, 5).join('\n  ')}`); } };
  try {
    await check('a failed run shows when it ended (relative, absolute on hover), where it stopped, and what Resume does', async () => {
      const posts = [];
      const { page, errors } = await open(browser, job(), posts);
      const panel = page.getByRole('region', { name: 'Recover' });
      const row = panel.locator('.mm-recover-list li');
      await row.waitFor({ timeout: 15000 });
      if (SHOTS) { await panel.scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(SHOTS, process.env.QA_SHOT || '1977.png') }); }
      assert.match(await row.innerText(), /Auto-tune · Qwen3\.5-4B-UD-Q8_K_XL · failed/);
      const when = row.locator('time');
      await when.waitFor({ timeout: 2000 });
      assert.match(await when.innerText(), /Ended 3 hours ago\./);
      assert.ok((await when.getAttribute('title')).length > 8, 'the absolute time is on hover');
      await row.getByText('Stopped at: KV cache — q8_0 KV cache').waitFor({ timeout: 2000 });
      await row.getByText(/Resume carries on this run/).waitFor({ timeout: 2000 });
      assert.equal(await row.getByRole('button', { name: /dismiss|clear/i }).count(), 0, 'the server cannot clear a finished run');
      assert.deepEqual(posts, []); assert.deepEqual(errors, []); await page.close();
    });
    await check('a step reason that says more than the job error is shown', async () => {
      const posts = [];
      const specific = 'The model did not finish loading: out of memory.';
      const { page } = await open(browser, job({ models: [{ model: MODEL, status: 'failed', phases: phases(specific) }] }), posts);
      const row = page.locator('.mm-recover-list li');
      await row.getByText(`Stopped at: KV cache — q8_0 KV cache: ${specific}`).waitFor({ timeout: 15000 });
      assert.deepEqual(posts, []); await page.close();
    });
    await check('a job record without a time or phases still renders the row, without invented lines', async () => {
      const posts = [];
      const { page, errors } = await open(browser, job({ finishedAt: undefined, models: [{ model: MODEL, status: 'failed', phases: [] }] }), posts);
      const row = page.locator('.mm-recover-list li');
      await row.waitFor({ timeout: 15000 });
      assert.equal(await row.locator('time').count(), 0);
      assert.equal(await row.getByText(/Stopped at/).count(), 0);
      await row.getByText(/Resume carries on this run/).waitFor({ timeout: 2000 });
      assert.deepEqual(errors, []); await page.close();
    });
  } finally { await browser.close(); await fixture.close(); }
  if (failed) process.exitCode = 1;
})().catch((e) => { console.error(e); process.exitCode = 1; });
