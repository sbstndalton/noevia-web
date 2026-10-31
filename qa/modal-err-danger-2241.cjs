'use strict';
// Review follow-up: `.modal-err` was painted in --accent-text (the link colour), so inline errors read as links. It now uses --status-danger, as
// the machines page already did. Checked on real error lines: Settings → Users when the list cannot be read (HTTP 500), light and dark,
// desktop and phone: the text is the danger colour, differs from the link colour, and has at least 4.5:1 contrast on what it sits on.
//   PLAYWRIGHT_MODULE=<playwright-core> QA_DIST=<dist dir> [QA_CORE_SERVER=<core server/>] [QA_SHOTS=<dir>] node qa/modal-err-danger-2241.cjs
// Fails on a build without the change, passes with it.
const assert = require('node:assert/strict');
const { run, openPage, shot, IPHONE, DESKTOP } = require('./web-fixes-lib.cjs');

const mock = (page) => page.route('**/api/admin/users', (r) => r.fulfill({ status: 500, json: { error: 'Server error' } }));
const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

run('modal-err-danger-2241', Number(process.env.QA_PORT || 32241), async (check, browser, origin) => {
  for (const view of [{ name: '1440', options: DESKTOP }, { name: 'iphone', options: IPHONE }]) {
    for (const theme of ['light', 'dark']) {
      await check(`${view.name} ${theme}: an inline error is the danger colour, not the link colour, and readable`, async () => {
        const { page, context, errors } = await openPage(browser, view, theme, { mock });
        await page.goto(`${origin}/settings/users`);
        const err = page.locator('.settings-users .modal-err');
        await err.waitFor({ timeout: 15000 });
        await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
        await page.waitForTimeout(700);
        const m = await err.evaluate((el) => {
          const rgb = (s) => s.match(/[\d.]+/g).map(Number);
          let bgEl = el, bg = null;
          while (bgEl && !bg) { const c = rgb(getComputedStyle(bgEl).backgroundColor); if (c.length < 4 || c[3] > 0.99) { if (c.some((n) => n > 0) || c.length === 3) bg = c.slice(0, 3); } bgEl = bgEl.parentElement; }
          const probe = document.createElement('span'); document.body.append(probe);
          probe.style.color = 'var(--status-danger)'; const danger = getComputedStyle(probe).color;
          probe.style.color = 'var(--accent-text)'; const link = getComputedStyle(probe).color; probe.remove();
          return { color: getComputedStyle(el).color, danger, link, fg: rgb(getComputedStyle(el).color).slice(0, 3), bg: bg || [255, 255, 255] };
        });
        assert.equal(m.color, m.danger, 'the error is not the danger colour');
        assert.notEqual(m.color, m.link, 'the error is still the link colour');
        const ratio = contrast(m.fg, m.bg);
        assert.ok(ratio >= 4.5, `contrast ${ratio.toFixed(2)}:1 against ${m.bg}`);
        await shot(page, `2241-modal-err-${view.name}-${theme}`);
        assert.deepEqual(errors, []);
        await context.close();
      });
    }
  }
});
