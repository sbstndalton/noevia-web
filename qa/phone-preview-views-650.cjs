// #650: every top-level view in the Layout setting's Phone preview. On a wide window the preview is a
// 430px column (data-layout="mobile"), but stacking rules keyed only to @media (max-width) never
// match there, so a view kept its desktop two-column layout inside the column: the project title was
// 0px wide, the project chat 106px. The same class of bug hit Settings (#630), the drawer (#640) and the
// Diary (#637); this sweep is what stops the next view from shipping it.
//
// It loops over every top-level view (new chat, chat, Projects, a project's Chats / Sources / Code tabs,
// Code, Customise's tabs, Models, Archived, Diary, Settings) and asserts, in the preview column:
//   1. no visible element with real text is narrower than 40px (a title one letter per line is the bug)
//   2. no horizontal overflow: nothing (except fixed overlays) past the column edge, no sideways page scroll
//   3. the two-column project layouts have stacked (the rail is under the content, not beside it)
//
// The real application server on synthetic data. The Diary sidecar is answered in the page with
// synthetic entries; no real journal and no Diary prompt is ever used.
//
// Run: [APP_DIR=<web dir of a built app>] [QA_SCREENSHOTS=<dir>] [QA_ONLY=<view id prefix>] node qa/phone-preview-views-650.cjs
const os = require('node:os');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || `${os.homedir()}/noevia-local-test/node_modules/playwright-core`);
const assert = require('node:assert/strict');
const { start, signedIn } = require('./sources-panel-lib.cjs');

const MIN_TEXT_WIDTH = 40;
// #660: in a project chat's header the project name (the breadcrumb's back link) and the chat title share
// one row; the name was squeezed to 19px ("q…") while the title kept the rest. Each keeps a readable share.
const MIN_CRUMB_WIDTH = 72;
const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

async function mockDiary(page) {
  await page.route('**/api/diary/**', async (route) => {
    const url = new URL(route.request().url()), json = (data) => route.fulfill({ json: data });
    if (url.pathname.endsWith('/external-sources')) return route.fulfill({ status: 403, json: { error: 'Forbidden' } });
    if (url.pathname.endsWith('/source')) return json({ source: 'synthetic', months: [{ id: '2026-09' }] });
    if (url.pathname.endsWith('/today')) return json({ todayLog: '# 2026-09-01\nSynthetic entry', standingSections: {} });
    if (url.pathname.endsWith('/files')) return json({ files: [] });
    return route.continue();
  });
}

// A project's Code tab needs the feature flag and the access answer; both are synthetic.
async function mockCode(page) {
  await page.route('**/api/projects/*/code**', (route) => route.fulfill({ json: {
    repositories: [{ id: 'synthetic-repo' }], capabilities: ['read_repository', 'edit_file'], defaultCapabilities: ['read_repository'],
    harnesses: [{ id: 'opencode', label: 'OpenCode', version: '1.0.0' }],
    promptPreparation: [{ id: 'direct', label: 'Direct', available: true, reason: 'Direct' }], sandboxed: true, network: false, tasks: [] } }));
}

// What the page looks like from the sweep's point of view, read back in one pass.
const inspect = (min) => {
  const col = document.querySelector('#root').getBoundingClientRect();
  const narrow = [], past = [];
  for (const el of document.querySelectorAll('#root *')) {
    if (!el.checkVisibility()) continue;
    const s = getComputedStyle(el), r = el.getBoundingClientRect();
    if (s.position === 'fixed') continue;
    // Off-screen and clipped helpers (screen-reader text, 1px anchors) are not text a person reads.
    if (s.clip !== 'auto' && s.clip !== 'rect(auto, auto, auto, auto)') continue;
    if (r.width <= 1 && r.height <= 1) continue;
    const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').replace(/\s+/g, ' ').trim();
    // Short labels ("Add", "1 chat", "noevia") are narrow by nature, and an ellipsis is a deliberate cut;
    // a heading, a paragraph or a phrase of 10+ characters squeezed under `min` is a collapsed column.
    const prose = own.length >= 10 || (own.length >= 3 && /^(H[1-6]|P)$/.test(el.tagName));
    if (prose && s.textOverflow !== 'ellipsis' && r.width < min) narrow.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} ${Math.round(r.width)}x${Math.round(r.height)} "${own.slice(0, 24)}"`);
    if (r.width > 0 && r.height > 0 && r.right > col.right + 1 && r.left < col.right + 400) {
      // A scroller inside the page may hold wider content on purpose; only its own box counts.
      let clipped = false;
      for (let p = el.parentElement; p && p.id !== 'root'; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o !== 'visible') { clipped = true; break; } }
      if (!clipped) past.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} right ${Math.round(r.right)} > ${Math.round(col.right)}`);
    }
  }
  const rail = document.querySelector('.project-rail'), main = document.querySelector('.project-main');
  const insp = document.querySelector('.noevia-inspector'), appMain = document.querySelector('.app-main');
  const crumbName = document.querySelector('.crumb-back > span'), crumbTitle = document.querySelector('.header-crumbs .header-title');
  const crumbBox = crumbName && crumbName.checkVisibility() ? crumbName.getBoundingClientRect() : null;
  return {
    crumbName: crumbBox ? Math.round(crumbBox.width) : null,
    crumbTitle: crumbTitle && crumbTitle.checkVisibility() ? Math.round(crumbTitle.getBoundingClientRect().width) : null,
    narrow: narrow.slice(0, 6), past: past.slice(0, 6),
    pageScroll: document.documentElement.scrollWidth - innerWidth,
    column: col.width,
    // Stacked = the rail starts below the content instead of beside it.
    railStacked: rail && main ? rail.getBoundingClientRect().top >= main.getBoundingClientRect().bottom - 1 : null,
    inspectorStacked: insp && appMain ? insp.getBoundingClientRect().top >= appMain.getBoundingClientRect().bottom - 1 : null,
  };
};

(async () => {
  let env;
  const browser = await chromium.launch({ headless: true, channel: process.env.QA_CHANNEL || 'chrome' });
  const errors = [], failures = [];
  const shots = process.env.QA_SCREENSHOTS;
  const check = async (name, fn) => {
    try { await fn(); console.log(`ok   ${name}`); } catch (e) { failures.push(name); console.log(`FAIL ${name}\n     ${String(e.message).split('\n').slice(0, 8).join('\n     ')}`); }
  };
  try {
    env = await start({ port: 31650, name: 'phoneviews650', env: { NOEVIA_FEATURE_PREVIEWS: 'true', NOEVIA_FEATURE_CODE_HARNESS: 'true' } });
    const first = await signedIn(browser, env, { width: 1440, theme: 'light', projectName: 'Synthetic battery notes' });
    assert.equal((await first.api('/api/profile/features', { diaryEnabled: true }, 'PUT')).status, 200);
    const pid = first.project.id;
    // A chat with a short transcript, so the chat view and its context rail have something in them.
    await first.api(`/api/projects/${pid}/chats`, { chats: [{ id: 'c-sweep-1', title: 'Please add the line "Synthetic marker" to the notes file', updatedAt: Date.now() }] });
    await first.api('/api/chats/c-sweep-1/history', { history: [{ role: 'user', content: 'Which chemistry should the pack use?' }, { role: 'assistant', content: 'Synthetic answer about lithium iron phosphate cells.' }] });
    const storage = await first.ctx.storageState();
    await first.ctx.close();

    const views = [
      ['new-chat', '/'], ['chat', '/c/c-sweep-1'], ['projects', '/projects'],
      ['project-chats', `/p/${pid}`], ['project-sources', `/p/${pid}/sources`], ['project-code', `/p/${pid}/code`],
      ['code', '/code'], ['customise-skills', '/customise/skills'], ['customise-connectors', '/customise/connectors'], ['customise-plugins', '/customise/plugins'],
      ['models', '/models'], ['archived', '/archived'], ['diary', '/diary'], ['settings', '/settings/appearance'],
    ];
    for (const [width, theme] of [[375, 'light'], [768, 'dark'], [1440, 'light'], [1440, 'dark']]) {
      const ctx = await browser.newContext({ locale: 'en-GB', viewport: { width, height: 950 }, storageState: storage });
      await ctx.addInitScript(([t]) => { localStorage.setItem('cowork-theme', t); localStorage.setItem('cowork-layout-mode', 'mobile'); }, [theme]);
      for (const [id, path] of views) {
        if (process.env.QA_ONLY && !id.startsWith(process.env.QA_ONLY)) continue;
        const tag = `${id}, ${width} ${theme}`;
        // A page per view: the app restores the last place visited, which would blur which view is measured.
        const page = await ctx.newPage();
        page.on('pageerror', (e) => errors.push(`${width} ${theme}: ${e.message}`));
        await page.addInitScript(() => localStorage.removeItem('noevia:last-view'));
        await mockDiary(page); await mockCode(page);
        await check(`#650 phone preview: ${tag}`, async () => {
          await page.goto(env.origin + path);
          await page.waitForFunction(() => document.querySelector('#root > *') && !document.querySelector('.coding-checking'), null, { timeout: 20000 });
          await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
          if (id === 'project-code') await page.locator('.code-panel, .code-tab, [class*="code-"]').first().waitFor({ timeout: 15000 }).catch(() => {});
          await page.waitForTimeout(400);
          assert.equal(await page.evaluate(() => document.documentElement.dataset.layout), 'mobile');
          const m = await page.evaluate(inspect, MIN_TEXT_WIDTH);
          if (shots) await page.screenshot({ path: `${shots}/phone-view-${id}-${width}-${theme}.png` });
          if (id === 'chat') {
            assert.notEqual(m.crumbName, null, 'a project chat shows its project name in the header');
            assert.ok(m.crumbName >= MIN_CRUMB_WIDTH, `the project name in the chat header is ${m.crumbName}px wide (under ${MIN_CRUMB_WIDTH}px); the chat title has ${m.crumbTitle}px`);
            assert.ok(m.crumbTitle >= MIN_CRUMB_WIDTH, `the chat title in the header is ${m.crumbTitle}px wide (under ${MIN_CRUMB_WIDTH}px)`);
          }
          assert.deepEqual(m.narrow, [], `text narrower than ${MIN_TEXT_WIDTH}px (column ${Math.round(m.column)}px)`);
          assert.deepEqual(m.past, [], 'elements past the column edge');
          assert.ok(m.pageScroll <= 1, `sideways page scroll of ${m.pageScroll}px`);
          if (m.railStacked !== null) assert.ok(m.railStacked, 'the project rail sits beside the content instead of under it');
          if (m.inspectorStacked !== null) assert.ok(m.inspectorStacked, 'the chat context rail sits beside the chat instead of under it');
        });
        await page.close();
      }
      await ctx.close();
    }
    // #660: a real phone (mobile user agent, 375px, touch, Layout on Automatic) gets the same project chat header.
    for (const theme of ['light', 'dark']) {
      if (process.env.QA_ONLY && !'chat'.startsWith(process.env.QA_ONLY)) continue;
      const ctx = await browser.newContext({ locale: 'en-GB', viewport: { width: 375, height: 812 }, userAgent: MOBILE_UA, isMobile: true, hasTouch: true, storageState: storage });
      await ctx.addInitScript(([t]) => { localStorage.setItem('cowork-theme', t); localStorage.removeItem('cowork-layout-mode'); }, [theme]);
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(`real phone ${theme}: ${e.message}`));
      await page.addInitScript(() => localStorage.removeItem('noevia:last-view'));
      await check(`#660 real phone chat header: 375 ${theme}`, async () => {
        await page.goto(env.origin + '/c/c-sweep-1');
        await page.locator('.crumb-back').waitFor({ timeout: 20000 });
        await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
        await page.waitForTimeout(400);
        const m = await page.evaluate(inspect, MIN_TEXT_WIDTH);
        if (shots) await page.screenshot({ path: `${shots}/phone-real-chat-375-${theme}.png` });
        assert.ok(m.crumbName >= MIN_CRUMB_WIDTH, `the project name in the chat header is ${m.crumbName}px wide (under ${MIN_CRUMB_WIDTH}px)`);
        assert.ok(m.crumbTitle >= MIN_CRUMB_WIDTH, `the chat title in the header is ${m.crumbTitle}px wide (under ${MIN_CRUMB_WIDTH}px)`);
        assert.ok(m.pageScroll <= 1, `sideways page scroll of ${m.pageScroll}px`);
      });
      await ctx.close();
    }
    assert.deepEqual(errors.filter((e) => !/ResizeObserver/.test(e)), [], 'page errors');
    if (failures.length) { console.log(`FAIL phone-preview-views-650: ${failures.length} check(s) failed`); process.exitCode = 1; }
    else console.log('PASS #650 every top-level view fits the phone-preview column; 375/768/1440, light and dark.');
  } finally { await browser.close(); if (env) await env.stop(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
