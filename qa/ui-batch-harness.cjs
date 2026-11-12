'use strict';
// Shared by the small-fault QA scripts of the 2026-11-11 interface batch (noevia #2136, #2326, #2397, #2399, #2400, #2401).
// Offline: diary-fixture.cjs serves the built app (QA_DIST) and answers the shell's own calls; each script mocks the
// calls it is about with page.route. Synthetic names only.
//   PLAYWRIGHT_MODULE=<playwright-core> QA_CHROME_PATH=<Chrome> QA_DIST=<dist dir> QA_CORE_SERVER=<core server/> \
//   [QA_SHOTS=<dir>] node qa/<script>.cjs
const fs = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { createFixture } = require('./diary-fixture.cjs');
const { withLocale } = require('./qa-locale.cjs');

const VIEWS = [[375, 812, 'light'], [375, 812, 'dark'], [768, 900, 'light'], [768, 900, 'dark']];
const SHOTS = process.env.QA_SHOTS || '';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

/** A page at `width` x `height`; the theme follows the device (the default preference), so colorScheme picks it. */
let scriptName = 'qa', closed = 0;
async function themedPage(browser, [width, height, theme]) {
  const page = await browser.newPage(withLocale({ viewport: { width, height }, colorScheme: theme }));
  // QA_SHOT_ON_CLOSE=1: a picture of the page as it ends, for a run against a build that fails before the script's own screenshot.
  const close = page.close.bind(page);
  page.close = async (...args) => {
    if (SHOTS && process.env.QA_SHOT_ON_CLOSE) await page.screenshot({ path: `${SHOTS}/${scriptName}-end-${++closed}-${width}-${theme}.png` }).catch(() => undefined);
    return close(...args);
  };
  return page;
}

async function shot(page, name) { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); }

/** Runs `body(check, browser, origin)`; every `check` prints PASS or FAIL and a failure sets the exit code. */
async function run(name, port, body) {
  scriptName = name;
  const fixture = createFixture(port);
  await fixture.listen();
  const browser = await chromium.launch({ headless: true, ...(process.env.QA_CHROME_PATH ? { executablePath: process.env.QA_CHROME_PATH } : { channel: 'chrome' }) });
  let failed = 0;
  const check = async (label, fn) => {
    try { await fn(); console.log(`PASS ${name}: ${label}`); }
    catch (e) { failed++; console.log(`FAIL ${name}: ${label}\n  ${String(e.message).split('\n').slice(0, 6).join('\n  ')}`); }
  };
  try { await body(check, browser, `http://localhost:${port}`); }
  finally { await browser.close(); await fixture.close(); }
  if (failed) process.exitCode = 1;
}

/** Models page over synthetic calls: an administrator, `installed` models and whatever `extra(path, request, json)` answers first
 *  (return undefined to fall through to the quiet defaults). Everything else under /api/ the page asks for gets an empty answer. */
async function mockModelsApi(page, { installed = () => [], extra = () => undefined, roles = { fast: 'Synthetic-Fast-Q4', smart: 'Synthetic-Fast-Q4' } } = {}) {
  await page.route('**/api/**', (route) => {
    const req = route.request(), p = new URL(req.url()).pathname;
    const json = (b, status = 200) => route.fulfill({ status, json: b });
    const own = extra(p, req, json);
    if (own !== undefined) return own;
    if (p === '/api/profile' || p === '/api/auth/session') return json({ user: { id: 'qa', username: 'admin', displayName: 'Synthetic admin', role: 'admin', diaryEnabled: false, onboarded: true }, passkeys: [] });
    if (p === '/api/models/capabilities') return json({ kind: 'llamacpp', admin: true, autotune: true, presets: true, download: true, runtimeOptions: false, modelManagement: true });
    if (p === '/api/models/installed') return json(installed());
    if (p === '/api/auto-roles' && req.method() === 'GET') return json({ configured: true, roles, missing: [] });
    if (p === '/api/models/autotune' || p === '/api/models/calibration') return json({ job: null, history: [] });
    if (p === '/api/models/autotune/untuned') return json({ models: [], skipped: [] });
    if (p === '/api/model-manager/downloads') return json({ jobs: [] });
    if (p === '/api/model-manager/backends') return json({ backends: [] });
    if (p === '/api/model-manager/models') return json({ models: [], unregistered: [] });
    if (p === '/api/model-manager/models/updates') return json({ status: {} });
    if (p.startsWith('/api/model-manager/') || p.startsWith('/api/models/')) return json({});
    return route.continue();
  });
}

module.exports = { VIEWS, themedPage, shot, run, mockModelsApi };
