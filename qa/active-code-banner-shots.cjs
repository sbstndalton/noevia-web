// #282 follow-up: dark/light screenshots of the account-wide active Code task banner
// (ActiveCodeTasks, src/components/code/ActiveCodeTasks.tsx) at phone and desktop widths.
// Synthetic fixture only: /api/code/active is route-mocked, exactly like other UI-only
// qa scripts (features.cjs, code-mode.cjs) mock their endpoints against diary-fixture.cjs.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createFixture } = require('./diary-fixture.cjs');
const { withLocale } = require('./qa-locale.cjs');

const OUT = process.env.QA_SCREENSHOTS || '/tmp/claude-0/qa-c-shots';
fs.mkdirSync(OUT, { recursive: true });

const LONG_NAME = 'The Extremely Long Synthetic Project Name For Truncation Testing In The Active Code Task Banner';

const TASKS = [
  { id: 't1', projectId: 'p1', projectName: 'Battery notes', title: 'Fix the median bug', status: 'waiting_approval', stage: null, updatedAt: Date.now(), approvalAction: 'edit_file' },
  { id: 't2', projectId: 'p2', projectName: LONG_NAME, title: 'Refactor the ingest pipeline end to end', status: 'running', stage: 'Reading the repository', updatedAt: Date.now(), approvalAction: null },
];

(async () => {
  const fixture = createFixture(31378);
  await fixture.listen();
  const browser = await chromium.launch({ headless: true, channel: process.env.QA_CHANNEL || undefined });
  const errors = [];
  const checks = [];
  const check = async (name, fn) => { try { await fn(); checks.push([name, null]); } catch (e) { checks.push([name, e]); } };
  try {
    for (const [width, height] of [[375, 812], [1440, 900]]) {
      for (const theme of ['light', 'dark']) {
        const page = await browser.newPage(withLocale({ viewport: { width, height }, isMobile: width < 768, hasTouch: width < 768 }));
        page.on('pageerror', (e) => errors.push(e.message));
        await page.addInitScript((t) => localStorage.setItem('cowork-theme', t), theme);
        await page.route('**/api/features', (r) => r.fulfill({ json: { flags: { codeHarness: true } } }));
        await page.route('**/api/code/active', (r) => r.fulfill({ json: { tasks: TASKS, total: TASKS.length } }));
        await page.goto('http://localhost:31378');
        await page.getByPlaceholder('Message noevia…').waitFor();
        const banner = page.locator('.active-code-entry');
        await banner.waitFor();
        // Expand it so the long project name and both task rows are visible in the shot.
        await banner.locator('summary').click();
        await page.getByText(LONG_NAME).first().waitFor();

        await check(`${width}x${height} ${theme}: banner is in normal document flow, not floating over the header`, async () => {
          const found = await page.evaluate(() => {
            const b = document.querySelector('.active-code-entry');
            const header = document.querySelector('.chat-header, header, .app-header, .shell-header');
            if (!b || !header) return null;
            const br = b.getBoundingClientRect(), hr = header.getBoundingClientRect();
            const overlaps = !(br.bottom <= hr.top || br.top >= hr.bottom);
            const floating = getComputedStyle(b).position !== 'static' && getComputedStyle(b).position !== 'relative';
            return { overlap: overlaps && floating };
          });
          // Neither element existing is itself a failure, not a silent pass: the check would
          // otherwise report "ok" without ever having looked at anything.
          assert.ok(found, 'could not find both .active-code-entry and a header element to compare');
          assert.equal(found.overlap, false);
        });
        await check(`${width}x${height} ${theme}: no horizontal overflow`, async () => {
          const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
          assert.ok(noOverflow, `horizontal overflow at ${width} ${theme}`);
        });
        // The screenshot itself is viewport-sized (not full-page), so a tall expanded task list
        // can look "cut off" at the bottom of the shot even when it is entirely fine: the list
        // has its own scroll region. Distinguish that from a genuine clip (overflow:hidden or a
        // hard-clipped fixed height, which would silently swallow content with no way to reach
        // it) rather than just eyeballing the PNG.
        await check(`${width}x${height} ${theme}: an overflowing task list scrolls, it is not clipped`, async () => {
          const info = await page.evaluate(() => {
            const list = document.querySelector('.active-code-entry ul');
            if (!list) return null;
            const style = getComputedStyle(list);
            return { scrollHeight: list.scrollHeight, clientHeight: list.clientHeight, overflowY: style.overflowY };
          });
          assert.ok(info, 'could not find the .active-code-entry task list to check');
          if (info.scrollHeight > info.clientHeight) {
            assert.ok(['auto', 'scroll'].includes(info.overflowY), `task list content overflows its box but overflow-y is "${info.overflowY}": content is clipped, not reachable by scrolling`);
          }
        });

        await page.screenshot({ path: `${OUT}/active-code-banner-${width}x${height}-${theme}.png` });
        await page.close();
      }
    }
    assert.deepEqual(errors, []);
    let failed = 0;
    for (const [name, error] of checks) {
      if (!error) console.log('ok  ', name); else { failed++; console.log('FAIL', name, '—', error.message); }
    }
    console.log(failed ? `FAIL ${failed} of ${checks.length}` : 'PASS active-code-banner-shots: screenshots captured, no page errors, no horizontal overflow.');
    console.log(`Screenshots in ${OUT}`);
    process.exitCode = failed ? 1 : 0;
  } finally {
    await browser.close();
    await fixture.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
