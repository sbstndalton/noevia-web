'use strict';
// Shared by the qa/*-22xx.cjs scripts: a synthetic UI fixture (diary-fixture.cjs serves the build and the basic APIs),
// plus page.route() mocks for the one endpoint a script is about. Mocks must match the real endpoint's shape.
//   PLAYWRIGHT_MODULE=<playwright-core> QA_DIST=<dist dir> [QA_CORE_SERVER=<noevia-core server/>] [QA_SHOTS=<dir>] node qa/<script>.cjs
// QA_CORE_SERVER is only needed for spa-routes.cjs (which paths get the shell).
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { createFixture } = require('./diary-fixture.cjs');
const { withLocale } = require('./qa-locale.cjs');
const playwright = require(process.env.PLAYWRIGHT_MODULE || `${os.homedir()}/noevia-local-test/node_modules/playwright-core`);

const SHOTS = process.env.QA_SHOTS || '';
const TAG = process.env.QA_TAG || 'after';
const ADMIN = { id: 'qa-admin', username: 'qa-admin', displayName: 'Synthetic admin', role: 'admin', diaryEnabled: false, onboarded: true };
// A real iPhone: Playwright's own device descriptor (user agent, touch, 3x scale) at 390x844.
const IPHONE = { ...playwright.devices['iPhone 14'], locale: 'en-GB' };
const DESKTOP = { viewport: { width: 1440, height: 900 } };

/** A page in `view` ({ name, options }) with the colour scheme `theme`, signed in as `user`, mocks applied by `mock(page)`. */
async function openPage(browser, view, theme, { user = ADMIN, mock, storedTheme = true } = {}) {
  const context = await browser.newContext(withLocale({ ...view.options, reducedMotion: 'reduce', colorScheme: theme }));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  if (storedTheme) await page.addInitScript((t) => { try { localStorage.setItem('cowork-theme', t); } catch { /* ignore */ } }, theme);
  await page.route('**/api/auth/session', (r) => r.fulfill({ json: { user, passkeys: [] } }));
  await page.route('**/api/profile', (r) => r.fulfill({ json: { user, passkeys: [] } }));
  if (mock) await mock(page);
  return { page, context, errors };
}

/** Runs `body(check, browser, origin)` against a fixture; prints PASS/FAIL lines and sets the exit code. */
async function run(name, port, body) {
  const fixture = createFixture(port);
  await fixture.listen();
  const browser = await playwright.chromium.launch({ headless: true, ...(process.env.QA_CHROME_PATH ? { executablePath: process.env.QA_CHROME_PATH } : { channel: 'chrome' }) });
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  const results = [];
  const check = async (label, fn) => {
    try { await fn(); results.push([label, null]); console.log(`PASS ${name}: ${label}`); }
    catch (e) { results.push([label, e]); console.log(`FAIL ${name}: ${label}\n  ${String(e.message).split('\n').slice(0, 6).join('\n  ')}`); }
  };
  try { await body(check, browser, `http://localhost:${port}`); }
  finally { await browser.close(); await fixture.close(); }
  const failed = results.filter(([, e]) => e);
  console.log(`\n${name}: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length || !results.length) process.exitCode = 1;
}

const shot = async (page, file, opts = {}) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${TAG}-${file}.png`), ...opts }); };

module.exports = { run, openPage, shot, ADMIN, IPHONE, DESKTOP, SHOTS, TAG, path };
