// #345 (reopened): the Tools catalogue's close() used to call onOpenChange(false) — which
// unmounts the focused search input synchronously, in the same event — and only defer the
// trigger's own .focus() to the next animation frame. The browser resolves the focused input's
// removal by moving focus to <body> immediately; the deferred rAF landed too late to matter live
// (reproduced 2/2 there), even though a lighter synthetic frame here didn't always lose the race
// on a plain timed check. Offline: synthetic /api/toolboxes/permitted, no inference/storage/net.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const { createFixture } = require('./diary-fixture.cjs');
const { withLocale } = require('./qa-locale.cjs');

const BOXES = [{ id: 'core', label: 'Core', description: 'Clock and project files.', source: 'builtin', state: 'available', reason: null, active: true,
  tools: [{ name: 'clock', description: 'Current time', write: false, permission: 'allowed', reason: null }] }];

(async () => {
  const fixture = createFixture(31473);
  await fixture.listen();
  const browser = await chromium.launch({ headless: true, channel: process.env.QA_CHANNEL || 'chrome' });
  let passed = 0;
  const pass = (msg) => { passed += 1; console.log(`PASS tool-catalogue-escape-focus: ${msg}`); };
  try {
    const page = await browser.newPage(withLocale({ viewport: { width: 1440, height: 900 } }));
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/api/workspace', (r) => r.fulfill({ json: { projects: [], freeChats: [] } }));
    await page.route('**/api/toolboxes/permitted*', (r) => r.fulfill({ json: { boxes: BOXES } }));

    await page.goto('http://localhost:31473');
    await page.getByPlaceholder('Message noevia…').waitFor();
    await page.getByRole('button', { name: /^Tools/ }).click();
    await page.locator('.tool-catalogue-search').waitFor();
    // Wait for the panel's own open effect to actually land focus in the search input before
    // testing Escape, or this would be exercising a still-focused trigger, never displaced.
    await page.waitForFunction(() => document.activeElement?.className === 'tool-catalogue-search');

    // A deterministic version of the live race: dispatch Escape in-page and let a few
    // microtasks run (no full animation frame — rAF never fires within a microtask queue), so
    // this reflects exactly the window between the input's synchronous removal and the old
    // code's deferred rAF, without depending on real wall-clock/paint timing to expose it.
    const info = await page.evaluate(async () => {
      const input = document.querySelector('.tool-catalogue-search');
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
      const el = document.activeElement;
      return { tag: el?.tagName, cls: el?.className, isBody: el === document.body, panelPresent: !!document.querySelector('.tool-catalogue-panel') };
    });
    assert.equal(info.panelPresent, false, 'the panel must actually have closed');
    assert.equal(info.isBody, false, 'Escape must not leave focus on <body>, even for a moment shorter than one animation frame');
    assert.equal(info.cls, 'tool-catalogue-trigger btn btn-ghost', 'focus must already be on the trigger button');
    pass('Escape closes the catalogue and moves focus to the trigger synchronously, with no window where it falls to <body>');

    // The ordinary, real-keypress path (CDP-dispatched, with actual paint/rAF ticks in between)
    // must land on, and stay on, the trigger too.
    await page.getByRole('button', { name: /^Tools/ }).click();
    await page.waitForFunction(() => document.activeElement?.className === 'tool-catalogue-search');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    const afterReal = await page.evaluate(() => ({ cls: document.activeElement?.className, isBody: document.activeElement === document.body }));
    assert.equal(afterReal.isBody, false, 'a real Escape keypress must not leave focus on <body> even after settling');
    assert.equal(afterReal.cls, 'tool-catalogue-trigger btn btn-ghost', 'focus returns to the Tools trigger button');
    pass('a real Escape keypress returns focus to the Tools trigger button, confirmed after settling');

    assert.deepEqual(errors, [], 'no page errors');
    console.log(`PASS tool-catalogue-escape-focus: all ${passed} scenarios.`);
    await page.close();
  } finally {
    await browser.close();
    await fixture.close();
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
