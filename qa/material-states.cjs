// Exercise the production styles with synthetic controls; no live APIs or data.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const { createFixture } = require('./diary-fixture.cjs');
(async () => {
  const fixture = createFixture(31453); await fixture.listen();
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    for (const theme of ['light', 'dark']) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
      await page.addInitScript(theme => localStorage.setItem('cowork-theme', theme), theme);
      await page.route('**/api/profile/appearance', r => r.fulfill({ json: { theme, light: 'iris', dark: 'iris' } }));
      await page.goto('http://localhost:31453');
      await page.getByPlaceholder('Message noevia…').waitFor();
      await page.evaluate(() => {
        const panel = document.createElement('section'); panel.id = 'state-fixture';
        panel.style.cssText = 'position:fixed;inset:100px 200px;z-index:99999;background:var(--md-surface);padding:24px';
        panel.innerHTML = `<div class="app-mode-switch"><button class="is-selected">Selected mode</button><button>Other mode</button></div>
          <div class="glass-seg" data-wrapped="true"><button aria-checked="true">Selected segment</button><button aria-checked="false">Other segment</button></div>
          <div class="aero"><button class="glass is-primary">Liquid primary</button></div>
          <button class="btn-secondary">Secondary</button><button class="btn-danger">Delete fixture</button>`;
        document.body.append(panel);
      });
      const state = async (selector) => {
        const button = page.locator('#state-fixture ' + selector);
        await page.mouse.move(0, 0); await page.waitForTimeout(250);
        const read = () => button.evaluate(e => ({ background: getComputedStyle(e).backgroundColor, color: getComputedStyle(e).color }));
        const rest = await read(); await button.hover(); await page.waitForTimeout(250);
        const hover = await read(); await page.mouse.down(); await page.waitForTimeout(250);
        const pressed = await read(); await page.mouse.move(0, 0); await page.mouse.up();
        assert.notEqual(hover.background, rest.background, `${theme} ${selector}: hover layer`);
        assert.notEqual(pressed.background, hover.background, `${theme} ${selector}: pressed layer`);
        assert.equal(pressed.color, rest.color, `${theme} ${selector}: foreground preserved`);
      };
      await page.evaluate(() => document.documentElement.dataset.family = 'contemporary');
      for (const selector of ['.app-mode-switch .is-selected', '.glass-seg [aria-checked="true"]', '.btn-secondary', '.btn-danger']) await state(selector);
      assert.match(await page.locator('#state-fixture .glass-seg [aria-checked="false"]').evaluate(e => getComputedStyle(e).boxShadow), /inset/);
      await page.evaluate(() => {
        const panel = document.querySelector('#state-fixture'); panel.classList.add('app');
        const rail = document.createElement('div'); rail.className = 'sidebar pane is-collapsed';
        rail.style.cssText = 'position:relative;height:auto;min-height:0';
        rail.append(panel.querySelector('.app-mode-switch')); panel.prepend(rail);
      });
      await state('.app-mode-switch .is-selected');
      await page.evaluate(() => document.documentElement.dataset.family = 'glass');
      await state('.aero .is-primary');
      await page.screenshot({ path: `/tmp/noevia-parity-states-${theme}.png` });
      await page.close();
    }
    console.log('PASS Material selected/secondary/destructive and Liquid nested primary hover/press states in both themes.');
  } finally { await browser.close(); await fixture.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
