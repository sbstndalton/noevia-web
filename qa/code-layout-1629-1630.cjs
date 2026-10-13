// #1629 and #1630: two layout faults in the Code views, measured in a real browser.
//
// #1629 (Code home, /code): the project card grid sat about 132 px left of its centred heading at
// 1440 px. phone.css's `.plugin-grid { margin: 0 }` loads after noevia.css's picker rule, so the
// picker's `margin: 0 auto` never applied. Check: the grid's horizontal centre is the heading's
// centre, within 2 px, at every width, with and without the Workspace side panel.
//
// #1630 (a project's Code tab): the "What this task may do" options wrapped as a flex line, so at
// some widths the last option ("Push to git") sat alone on its own row (3 + 3 + 1 at 1240 px on
// main; 4 + 3 at 1440 and 3 + 2 + 2 at 809 do not show the fault). Check: at 600 px and wider no
// option is alone on its row, and Push to git shares its row with siblings; below 600 px, or where
// the sidebar leaves too little room for four labels, the group stacks as one column.
//
// Synthetic projects and mocked APIs only (qa/diary-fixture.cjs). No harness, no repository, no
// real Diary or corpus. Run:
//   PLAYWRIGHT_MODULE=<playwright-module> QA_SCREENSHOTS=<dir> node qa/code-layout-1629-1630.cjs
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { createFixture } = require('./diary-fixture.cjs');
const { withLocale } = require('./qa-locale.cjs');

const PORT = 31630;
const origin = `http://localhost:${PORT}`;
const shots = process.env.QA_SCREENSHOTS || '';
const FLAGS = { previews: true, codeHarness: true };
const PUSH = 'Push to git';
const CAPABILITIES = ['read_repository', 'edit_file', 'execute_command', 'install_dependency', 'network', 'delete', 'git_push'];
const CODE_STATE = {
  repositories: [{ id: 'noevia' }], capabilities: CAPABILITIES, defaultCapabilities: ['read_repository'],
  harnesses: [{ id: 'opencode', label: 'OpenCode', version: '1.18.31' }],
  promptPreparation: [{ id: 'direct', label: 'Direct', available: true, reason: 'Direct' }],
  sandboxed: true, network: true, tasks: [],
};
const project = (id, name) => ({
  id, name, model: 'synthetic', goal: '', instructions: '', memories: [], files: [], assets: [],
  chats: [], toolboxes: ['core'], createdAt: 1000, updatedAt: 1000, modes: ['chat'],
});

const failures = [];
const errors = [];
let passed = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` -- ${detail}` : ''}`);
  if (ok) passed += 1; else failures.push(label);
}

/** A fresh page with the synthetic app state; `theme` is light or dark. */
async function openPage(browser, { width, height, theme }) {
  const phone = width < 768;
  const page = await browser.newPage(withLocale({ viewport: { width, height }, isMobile: phone, hasTouch: phone, colorScheme: theme }));
  page.on('pageerror', (e) => errors.push(`${width}/${theme}: ${e.message}`));
  await page.addInitScript(([t, flags]) => {
    localStorage.setItem('cowork-theme', t);
    localStorage.setItem('noevia:material', 'soft');
    localStorage.setItem('noevia:feature-flags', JSON.stringify(flags));
  }, [theme, FLAGS]);
  await page.route('**/api/features', (r) => r.fulfill({ json: { flags: FLAGS } }));
  await page.route('**/api/workspace', (r) => r.fulfill({ json: {
    projects: Array.from({ length: 6 }, (_, i) => project(`p${i}`, `Synthetic project ${i}`)), freeChats: [],
  } }));
  await page.route('**/api/projects/*/skills', (r) => r.fulfill({ json: { skills: [] } }));
  await page.route('**/api/projects/*/code**', (r) => r.fulfill({ json: CODE_STATE }));
  return page;
}

/** #1629: the picker's grid centre against the heading's centre. */
const homeGeometry = (page) => page.evaluate(() => {
  const grid = document.querySelector('.coding-project-picker').getBoundingClientRect();
  const heading = document.querySelector('.coding-welcome h1').getBoundingClientRect();
  return {
    gridCentre: grid.left + grid.width / 2, headingCentre: heading.left + heading.width / 2,
    cards: document.querySelectorAll('.coding-project-picker > li').length,
    overflow: document.documentElement.scrollWidth > window.innerWidth,
  };
});

/** #1630: each option's box, in document order. */
const capabilityBoxes = (page) => page.evaluate(() => [...document.querySelectorAll('.code-capability-list > .code-capability')]
  .map((el) => { const r = el.getBoundingClientRect(); return { label: el.textContent.trim(), top: Math.round(r.top), left: Math.round(r.left) }; }));

/** Group options into rows by top edge (2 px tolerance) and say whether the whole group is one column. */
function analyseGroup(items) {
  const rows = [];
  for (const item of items) {
    const row = rows.find((r) => Math.abs(r[0].top - item.top) <= 2);
    if (row) row.push(item); else rows.push([item]);
  }
  const stacked = rows.length === items.length && items.every((i) => Math.abs(i.left - items[0].left) <= 2);
  return { rows, stacked, shape: rows.map((r) => r.length).join('+') };
}

(async () => {
  const fixture = createFixture(PORT);
  await fixture.listen();
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  if (shots) fs.mkdirSync(shots, { recursive: true });
  try {
    // ── #1629: the Code home project grid is centred under its heading ──
    for (const theme of ['light', 'dark']) for (const width of [1440, 809, 375]) {
      const page = await openPage(browser, { width, height: width === 375 ? 812 : 900, theme });
      await page.goto(`${origin}/code`);
      await page.locator('.coding-project-picker').waitFor();
      const g = await homeGeometry(page);
      const gap = Math.abs(g.gridCentre - g.headingCentre);
      check(`#1629 home ${width} ${theme}: grid centre under heading`, g.cards === 6 && gap <= 2 && !g.overflow,
        `grid centre ${g.gridCentre.toFixed(1)}, heading centre ${g.headingCentre.toFixed(1)}, off by ${gap.toFixed(1)} px, cards ${g.cards}`);
      if (shots) await page.screenshot({ path: path.join(shots, `home-${width}-${theme}.png`) });
      await page.close();
    }
    // The Workspace side panel narrows the page; the grid must still sit under the heading.
    for (const theme of ['light', 'dark']) {
      const page = await openPage(browser, { width: 1440, height: 900, theme });
      await page.goto(`${origin}/code`);
      await page.locator('.coding-project-picker').waitFor();
      await page.getByRole('button', { name: 'Toggle coding side panel', exact: true }).click();
      await page.locator('.coding-side-panel').waitFor();
      const g = await homeGeometry(page);
      check(`#1629 home 1440 side panel open ${theme}: grid centre under heading`, Math.abs(g.gridCentre - g.headingCentre) <= 2,
        `off by ${Math.abs(g.gridCentre - g.headingCentre).toFixed(1)} px`);
      if (shots) await page.screenshot({ path: path.join(shots, `home-1440-panel-${theme}.png`) });
      await page.close();
    }

    // ── #1630: the capability options never leave one option alone on a row ──
    // 1240 is where main wraps Push to git alone (3 + 3 + 1); the other widths are the ones the
    // report named and are kept as regressions.
    for (const theme of ['light', 'dark']) for (const width of [1440, 1240, 809, 375]) {
      const page = await openPage(browser, { width, height: width === 375 ? 812 : 900, theme });
      await page.goto(`${origin}/p/p1/code`);
      await page.locator('.code-capability').nth(CAPABILITIES.length - 1).waitFor();
      const boxes = await capabilityBoxes(page);
      const { rows, stacked, shape } = analyseGroup(boxes);
      const push = boxes.find((b) => b.label === PUSH);
      const pushRow = rows.find((r) => r.includes(push));
      if (width >= 600) {
        const ok = !!push && (stacked || rows.every((r) => r.length >= 2));
        check(`#1630 ${width} ${theme}: no option alone on a row, Push to git with its row`, ok,
          `rows ${shape}${stacked ? ' (one column)' : ''}; Push to git row of ${pushRow ? pushRow.length : 0}, top ${push?.top}`);
      } else {
        check(`#1630 ${width} ${theme}: phone stacks the group as one column`, stacked, `rows ${shape}`);
      }
      // The project pane scrolls on its own, so bring the group to the middle of the viewport first.
      if (shots) {
        await page.locator('.code-capabilities').evaluate((el) => el.scrollIntoView({ block: 'center' }));
        await page.waitForTimeout(100);
        await page.screenshot({ path: path.join(shots, `caps-${width}-${theme}.png`) });
      }
      await page.close();
    }
  } finally {
    await browser.close();
    await fixture.close?.();
  }
  for (const e of errors) console.log(`FAIL page error -- ${e}`);
  console.log(`\n${passed} passed, ${failures.length + errors.length} failed${shots ? `; screenshots in ${shots}` : ''}`);
  if (failures.length || errors.length) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
