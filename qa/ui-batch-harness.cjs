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
function themedPage(browser, [width, height, theme]) {
  return browser.newPage(withLocale({ viewport: { width, height }, colorScheme: theme }));
}

async function shot(page, name) { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); }

/** Runs `body(check, browser, origin)`; every `check` prints PASS or FAIL and a failure sets the exit code. */
async function run(name, port, body) {
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

module.exports = { VIEWS, themedPage, shot, run };
