// #651: the Code workspace header's title ("New task") sat under the floating navigation-drawer button on
// phones, so it read "w task". The chat and Diary headers clear that button; the Code header did not.
//   1. a real phone (mobile user agent, 375px, touch): the title starts to the right of the drawer button
//   2. the Layout setting's Phone preview on a wide window: the same
//   3. the Code header keeps the same left inset the chat and Diary headers use
//   4. on a desktop window (no drawer button) the header keeps its own padding
// Every page of the Code workspace (New task, Plugins) is checked, in light and dark.
//
// The real application server on synthetic data; the Code switch needs the previews feature.
//
// Run: [APP_DIR=<web dir of a built app>] [QA_SCREENSHOTS=<dir>] node qa/code-header-inset-651.cjs
const os = require('node:os');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || `${os.homedir()}/noevia-local-test/node_modules/playwright-core`);
const assert = require('node:assert/strict');
const { start, signedIn } = require('./sources-panel-lib.cjs');

const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

(async () => {
  let env;
  const browser = await chromium.launch({ headless: true, channel: process.env.QA_CHANNEL || 'chrome' });
  const failures = [], errors = [];
  const shots = process.env.QA_SCREENSHOTS;
  const check = async (name, fn) => {
    try { await fn(); console.log(`ok   ${name}`); } catch (e) { failures.push(name); console.log(`FAIL ${name}\n     ${String(e.message).split('\n').slice(0, 6).join('\n     ')}`); }
  };
  try {
    env = await start({ port: 31651, name: 'codeheader651', env: { NOEVIA_FEATURE_PREVIEWS: 'true' } });
    const first = await signedIn(browser, env, { width: 1440, theme: 'light', projectName: 'Synthetic header' });
    const storage = await first.ctx.storageState();
    await first.ctx.close();

    const scenarios = [
      ['real phone 375 (mobile UA)', { viewport: { width: 375, height: 812 }, userAgent: MOBILE_UA, isMobile: true, hasTouch: true }, null, true],
      ['phone preview, 1440 window', { viewport: { width: 1440, height: 900 } }, 'mobile', true],
      ['desktop 1440', { viewport: { width: 1440, height: 900 } }, 'desktop', false],
    ];
    for (const theme of ['light', 'dark']) {
      for (const [label, opts, mode, hasToggle] of scenarios) {
        const ctx = await browser.newContext({ locale: 'en-GB', storageState: storage, ...opts });
        await ctx.addInitScript(([t, m]) => { localStorage.setItem('cowork-theme', t); localStorage.removeItem('noevia:last-view'); if (m) localStorage.setItem('cowork-layout-mode', m); }, [theme, mode]);
        const page = await ctx.newPage();
        page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
        await page.goto(`${env.origin}/code`);
        await page.locator('.coding-header').waitFor({ timeout: 20000 });
        await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
        await check(`#651 ${label} (${theme}): Code header title clears the drawer button`, async () => {
          const m = await page.evaluate(() => {
            const rect = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, width: r.width }; };
            const header = document.querySelector('.coding-header'), title = header.querySelector(':scope > span');
            const toggle = document.querySelector('.nav-drawer-toggle');
            const chat = document.querySelector('.chat-header');
            return { title: rect(title), text: title.textContent, toggle: toggle && getComputedStyle(toggle).display !== 'none' ? rect(toggle) : null, header: rect(header), padLeft: parseFloat(getComputedStyle(header).paddingLeft) };
          });
          if (hasToggle) {
            assert.ok(m.toggle, 'the drawer button is showing');
            assert.ok(m.title.left >= m.toggle.right + 4, `"${m.text}" starts at x ${Math.round(m.title.left)}, under the drawer button (ends x ${Math.round(m.toggle.right)})`);
            assert.ok(m.padLeft >= 60, `the Code header's left padding is ${m.padLeft}px, not the 60px inset the chat and Diary headers use`);
          } else {
            assert.equal(m.toggle, null, 'no drawer button on a desktop window');
            assert.ok(m.padLeft >= 16 && m.padLeft < 60, `the desktop header keeps its own padding (${m.padLeft}px)`);
          }
          if (shots) await page.screenshot({ path: `${shots}/code-header-${label.replace(/[^a-z0-9]+/gi, '-')}-${theme}.png` });
        });
        if (hasToggle) {
          // The Plugins page of the same workspace shares the header.
          await check(`#651 ${label} (${theme}): the Plugins page header too`, async () => {
            await page.goto(`${env.origin}/code`);
            await page.locator('.coding-header').waitFor();
            const toggle = page.getByRole('button', { name: 'Open navigation', exact: true });
            await toggle.click();
            await page.getByRole('dialog', { name: 'Navigation' }).waitFor();
            const plugins = page.locator('.coding-sidebar, .sidebar').getByRole('button', { name: /Plugins/ }).first();
            if (!(await plugins.count())) return; // the page is not offered in this build
            await plugins.click();
            await page.locator('.coding-header').waitFor();
            const m = await page.evaluate(() => { const t = document.querySelector('.coding-header > span').getBoundingClientRect(), b = document.querySelector('.nav-drawer-toggle'); return { left: t.left, toggleRight: b && getComputedStyle(b).display !== 'none' ? b.getBoundingClientRect().right : 0 }; });
            assert.ok(m.left >= m.toggleRight + 4, `title starts at ${Math.round(m.left)}, toggle ends ${Math.round(m.toggleRight)}`);
          });
        }
        await ctx.close();
      }
    }
    assert.deepEqual(errors.filter((e) => !/ResizeObserver/.test(e)), [], 'page errors');
    if (failures.length) { console.log(`FAIL code-header-inset-651: ${failures.length} check(s) failed`); process.exitCode = 1; }
    else console.log('PASS #651 the Code header clears the drawer button on a phone and in the preview.');
  } finally { await browser.close(); if (env) await env.stop(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
