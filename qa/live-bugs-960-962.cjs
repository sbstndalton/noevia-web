// Live bugs from the release 7baecb40 live test (UI redo #951). Synthetic APIs only
// (qa/diary-fixture.cjs): no model, no inference, no real Diary, no live server.
//   npm run build && PLAYWRIGHT_MODULE=~/noevia-local-test/node_modules/playwright-core node qa/live-bugs-960-962.cjs
// QA_SHOTS=<dir> writes a screenshot of each bug's state.
//   #960  Glass: the composer's + menu (and every popover that sits inside a frosted pane) is
//         opaque enough to read: elementFromPoint at each menu row's centre hits the row, and the
//         menu's own fill has an alpha of at least 0.9.
//   #961  The forced phone layout on a wide window (Settings → Layout → Phone preview): Settings
//         opens as the phone sheet inside the phone frame, not the ~1021px desktop window.
//   #962  Closing Settings hands pointer input back at once: a click on the account button
//         within 50ms of the close opens the account menu.
const os = require('node:os');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || `${os.homedir()}/noevia-local-test/node_modules/playwright-core`);
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { createFixture } = require('./diary-fixture.cjs');
const { openSettings } = require('./nav.cjs');
const PORT = 31960;
const shots = process.env.QA_SHOTS || '';
const alphaOf = (c) => { const m = String(c).match(/[\d.]+/g); if (!m) return 0; if (/^rgba?\(/.test(c)) return m.length >= 4 ? Number(m[3]) : 1; if (/^color\(/.test(c)) return /\//.test(c) ? Number(m[m.length - 1]) : 1; return 1; };

(async () => {
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const fixture = createFixture(PORT); await fixture.listen();
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const errors = [], failures = [];
  const check = async (name, fn) => { try { await fn(); console.log(`PASS ${name}`); } catch (e) { failures.push(name); console.log(`FAIL ${name}: ${e.message}`); } };
  const fresh = async (theme, family, viewport = { width: 1440, height: 900 }) => {
    const ctx = await browser.newContext({ viewport, locale: 'en-GB' });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(({ t, f }) => { localStorage.setItem('cowork-theme', t); localStorage.setItem('noevia:theme-family', f); }, { t: theme, f: family });
    await page.goto(`http://localhost:${PORT}/`);
    await page.getByPlaceholder('Message noevia…').waitFor();
    return { ctx, page };
  };
  try {
    for (const theme of ['light', 'dark']) await check(`#960 glass ${theme}: the + menu is opaque and its rows are hit`, async () => {
      const { ctx, page } = await fresh(theme, 'glass');
      assert.equal(await page.evaluate(() => document.documentElement.dataset.family), 'glass');
      await page.locator('.composer-add').first().click();
      const panel = page.locator('.composer-actions-panel');
      await panel.waitFor();
      await page.waitForTimeout(400); // the entrance has settled
      const probe = await panel.evaluate((p) => {
        const rows = [...p.querySelectorAll('.composer-menu-row, button, [role="menuitem"], [role="menuitemcheckbox"]')].filter((r) => r.getBoundingClientRect().height > 0);
        const hits = rows.map((r) => { const b = r.getBoundingClientRect(); const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return { label: (r.textContent || '').trim().slice(0, 30), ok: !!hit && (r === hit || r.contains(hit)), hit: hit ? `${hit.tagName}.${hit.className}` : null }; });
        return { bg: getComputedStyle(p).backgroundColor, hits };
      });
      if (shots) await page.screenshot({ path: path.join(shots, `960-glass-${theme}-plus-menu.png`) });
      assert.ok(probe.hits.length > 0, 'the + menu has rows');
      for (const h of probe.hits) assert.ok(h.ok, `row "${h.label}" is not the top element at its centre (hit ${h.hit})`);
      assert.ok(alphaOf(probe.bg) >= 0.9, `the + menu fill is see-through: ${probe.bg} (alpha ${alphaOf(probe.bg)})`);
      // The other popovers that open over frosted panes share the same fill.
      const fills = await page.evaluate(() => {
        const out = {};
        for (const cls of ['ctx-menu', 'account-popover', 'popup', 'tool-catalogue-panel', 'mp-panel aero']) {
          const el = document.createElement('div'); el.className = cls; (document.querySelector('.app') || document.body).append(el);
          out[cls] = getComputedStyle(el).backgroundColor; el.remove();
        }
        return out;
      });
      for (const [cls, bg] of Object.entries(fills)) assert.ok(alphaOf(bg) >= 0.9, `glass ${theme} .${cls} fill is see-through: ${bg}`);
      await ctx.close();
    });

    await check('#961 forced phone layout: the settings stage fits the phone frame', async () => {
      const { ctx, page } = await fresh('light', 'editorial');
      await page.evaluate(() => { window.noeviaLayout.set('mobile'); });
      await page.waitForFunction(() => document.documentElement.dataset.layout === 'mobile');
      await openSettings(page);
      const stage = page.locator('.settings-stage');
      await stage.waitFor();
      await page.waitForTimeout(1200); // the entrance fade has settled
      const box = await page.evaluate(() => {
        const r = document.getElementById('root').getBoundingClientRect(), s = document.querySelector('.settings-stage').getBoundingClientRect();
        const scrim = document.querySelector('.settings-scrim');
        return { frame: { l: r.left, w: r.width, r: r.right }, stage: { l: s.left, w: s.width, r: s.right }, scrim: scrim ? getComputedStyle(scrim).display : 'none' };
      });
      if (shots) await page.screenshot({ path: path.join(shots, '961-phone-preview-settings.png') });
      assert.ok(box.stage.w <= box.frame.w + 0.5, `settings stage ${box.stage.w}px is wider than the phone frame ${box.frame.w}px`);
      assert.ok(box.stage.l >= box.frame.l - 0.5 && box.stage.r <= box.frame.r + 0.5, `settings stage ${JSON.stringify(box.stage)} spills outside the phone frame ${JSON.stringify(box.frame)}`);
      assert.equal(box.scrim, 'none', 'the phone sheet has no desktop scrim over the whole window');
      await ctx.close();
    });

    await check('#962 a click within 50ms of closing Settings opens the account menu', async () => {
      const { ctx, page } = await fresh('light', 'editorial');
      const account = page.getByRole('button', { name: /Account menu for/ }).filter({ visible: true }).first();
      await account.waitFor();
      await openSettings(page);
      await page.locator('.settings-stage').waitFor();
      await page.waitForTimeout(600); // fully open
      const b = await account.boundingBox();
      await page.keyboard.press('Escape');
      const t0 = Date.now();
      await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
      const dt = Date.now() - t0;
      assert.ok(dt < 50, `the click landed ${dt}ms after the close`);
      await page.locator('.account-popover').waitFor({ timeout: 1500 }).catch(() => {});
      if (shots) await page.screenshot({ path: path.join(shots, '962-account-after-close.png') });
      assert.ok(await page.locator('.account-popover').isVisible(), 'the account menu did not open: the click after closing Settings was lost');
      // Focus return still works: closing Settings with no click focuses the opener again.
      await page.keyboard.press('Escape');
      await ctx.close();
    });
    await check('#962 focus returns to the opener after closing Settings', async () => {
      const { ctx, page } = await fresh('light', 'editorial');
      await openSettings(page);
      await page.locator('.settings-stage').waitFor();
      await page.waitForTimeout(600);
      await page.keyboard.press('Escape');
      await page.locator('.settings-stage').waitFor({ state: 'detached' });
      await page.waitForTimeout(100);
      const focused = await page.evaluate(() => { const a = document.activeElement; return a && a !== document.body ? `${a.tagName} ${a.getAttribute('aria-label') || a.title || a.className}` : null; });
      assert.ok(focused, 'focus was dropped to <body> after closing Settings');
      assert.equal(await page.locator('[inert]').count(), 0, 'nothing is left inert after Settings closes');
      await ctx.close();
    });
    assert.deepEqual(errors, [], `page errors: ${errors.join(' | ')}`);
  } finally {
    await browser.close(); await fixture.close?.();
  }
  if (failures.length) { console.log(`FAILED ${failures.length}: ${failures.join('; ')}`); process.exit(1); }
  console.log('PASS live bugs #960 #961 #962');
})().catch((e) => { console.error(e); process.exit(1); });
