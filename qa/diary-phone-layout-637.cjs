// #637: the Diary in the Layout setting's Phone preview. On a wide browser the preview is a 430px column
// (data-layout="mobile"), but the Diary's own phone rules were keyed to @media (max-width) only, so it kept
// its two-column desktop grid inside that column: the prompt and the composer were squeezed to ~60px, the
// calendar was gone and the context rail took the width. The Diary now follows the same attribute as the
// shell, Settings and Models (#630), and the Layout setting's note names it among the views the preview covers.
//   1. Diary in the phone preview: one column, the prompt / calendar / composer use the width of the column
//   2. nothing inside the Diary scrolls sideways or overflows its column; no sideways page scroll
//   3. faithful: the layout rules in the preview compute the same as in a real 430px viewport
//   4. Settings -> Appearance: the Layout note lists the Diary (English and French)
//
// The real application server (real account with the Diary switched on); the Diary sidecar is answered
// in the page with synthetic entries (no real journal, no Diary prompt is ever sent).
//
// Run: [APP_DIR=<web dir of a built app>] [QA_SCREENSHOTS=<dir>] node qa/diary-phone-layout-637.cjs
const os = require('node:os');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || `${os.homedir()}/noevia-local-test/node_modules/playwright-core`);
const assert = require('node:assert/strict');
const { start, signedIn } = require('./sources-panel-lib.cjs');
const { navClick } = require('./nav.cjs');

async function mockDiary(page) {
  const files = { 'MEMORY.md': 'Synthetic root memory', 'AI Memory/notes.md': 'Synthetic durable memory' };
  await page.route('**/api/diary/**', async (route) => {
    const url = new URL(route.request().url()), json = (data) => route.fulfill({ json: data });
    if (url.pathname.endsWith('/external-sources')) return route.fulfill({ status: 403, json: { error: 'Forbidden' } });
    if (url.pathname.endsWith('/source')) return json({ source: 'synthetic', months: [{ id: '2026-09' }, { id: '2026-08' }] });
    if (url.pathname.endsWith('/today')) { const month = url.searchParams.get('month'); return json({ todayLog: month ? `# ${month}-01\nSynthetic entry\n# ${month}-02\nEarlier entry` : '', standingSections: {} }); }
    if (url.pathname.endsWith('/files')) { const p = url.searchParams.get('path') || ''; return json({ files: p ? Object.keys(files).filter((f) => f.startsWith(p + '/')).map((f) => ({ path: f, name: f.split('/').pop(), isDir: false })) : [{ path: 'MEMORY.md', name: 'MEMORY.md', isDir: false }, { path: 'AI Memory', name: 'AI Memory', isDir: true }] }); }
    if (url.pathname.endsWith('/file')) { const p = route.request().postDataJSON().path; return json({ path: p, content: files[p], version: 'fixture' }); }
    return route.continue();
  });
}

// What the Diary's phone rules decide, read back from the page.
const measure = (page) => page.evaluate(() => {
  const css = (sel, props) => { const el = document.querySelector(sel); if (!el) return null; const s = getComputedStyle(el); return Object.fromEntries(props.map((p) => [p, s[p]])); };
  return {
    layout: css('.diary-layout', ['display', 'flexDirection', 'overflowY']),
    primary: css('.diary-primary', ['flexGrow', 'flexShrink']),
    context: css('.diary-context', ['display', 'borderLeftWidth', 'borderTopWidth', 'maxHeight', 'overflowY']),
    day: css('.calendar-day', ['height', 'paddingTop']),
    calendar: css('.diary-calendar', ['columnGap']),
  };
});

(async () => {
  let env;
  const browser = await chromium.launch({ headless: true, channel: process.env.QA_CHANNEL || 'chrome' });
  const errors = [], failures = [];
  const shots = process.env.QA_SCREENSHOTS;
  const check = async (name, fn) => {
    try { await fn(); console.log(`ok   ${name}`); } catch (e) { failures.push(name); console.log(`FAIL ${name}\n     ${String(e.message).split('\n').slice(0, 6).join('\n     ')}`); }
  };
  try {
    env = await start({ port: 31637, name: 'diary637' });
    // One real account for every viewport below; Diary switched on through the real profile route.
    const first = await signedIn(browser, env, { width: 1440, theme: 'light', projectName: 'Diary layout' });
    assert.equal((await first.api('/api/profile/features', { diaryEnabled: true }, 'PUT')).status, 200);
    const storage = await first.ctx.storageState();
    await first.ctx.close();

    const open = async (width, theme, { preview }) => {
      const ctx = await browser.newContext({ locale: 'en-GB', viewport: { width, height: 950 }, storageState: storage, isMobile: width < 768 && !preview, hasTouch: width < 768 && !preview });
      await ctx.addInitScript(([t, mode]) => { localStorage.setItem('cowork-theme', t); if (mode) localStorage.setItem('cowork-layout-mode', mode); }, [theme, preview ? 'mobile' : '']);
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(`${width} ${theme}: ${e.message}`));
      await mockDiary(page);
      await page.goto(env.origin);
      await navClick(page, 'Diary');
      await page.locator('.diary-layout').waitFor({ timeout: 20000 });
      await page.locator('#diary-draft').waitFor({ timeout: 20000 });
      await page.waitForFunction(() => !document.querySelector('#diary-draft').disabled);
      await page.locator('.calendar-day').first().waitFor({ timeout: 20000 });
      // The account remembers the theme it was created with; the check wants this one.
      await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
      return { ctx, page };
    };

    for (const [width, theme] of [[375, 'light'], [768, 'dark'], [1440, 'light'], [1440, 'dark']]) {
      if (process.env.QA_ONLY && !`${width}:${theme}`.startsWith(process.env.QA_ONLY)) continue;
      const tag = `${width} ${theme}`;
      const { ctx, page } = await open(width, theme, { preview: true });
      const column = await page.evaluate(() => document.querySelector('#root').getBoundingClientRect().width);
      await check(`#637 the Diary fills the phone column in one column (${tag}, column ${Math.round(column)}px)`, async () => {
        assert.equal(await page.evaluate(() => document.documentElement.dataset.layout), 'mobile');
        const m = await measure(page);
        assert.equal(m.layout.display, 'flex', `diary-layout display ${m.layout.display}`);
        assert.equal(m.layout.flexDirection, 'column');
        const box = (sel) => page.locator(sel).first().boundingBox();
        const primary = await box('.diary-primary'), draft = await box('#diary-draft'), calendar = await box('.diary-calendar');
        // The prompt / composer / calendar use the column, not a ~60px sliver.
        assert.ok(primary.width >= column * 0.85, `the Diary column is ${Math.round(primary.width)}px of ${Math.round(column)}px`);
        assert.ok(draft.width >= column * 0.6, `the composer is ${Math.round(draft.width)}px wide`);
        assert.ok(calendar.width >= column * 0.7, `the calendar is ${Math.round(calendar.width)}px wide`);
        const heading = page.locator('.diary-calendar-heading h1, .diary-landing h1').first();
        if (await heading.count()) assert.ok((await heading.boundingBox()).width >= column * 0.3, 'the heading is not broken one syllable per line');
      });
      await check(`#637 nothing in the Diary overflows the column (${tag})`, async () => {
        const overflow = await page.evaluate(() => {
          const col = document.querySelector('#root').getBoundingClientRect(), bad = [];
          for (const el of document.querySelectorAll('.diary-layout *')) {
            const r = el.getBoundingClientRect();
            if (r.width > 0 && r.height > 0 && r.right > col.right + 1 && getComputedStyle(el).position !== 'fixed') bad.push(`${el.className || el.tagName} right ${Math.round(r.right)} > ${Math.round(col.right)}`);
          }
          const scroll = document.querySelector('.diary-content-scroll');
          return { bad: bad.slice(0, 4), scroller: scroll ? [scroll.scrollWidth, scroll.clientWidth] : null, page: document.documentElement.scrollWidth <= innerWidth + 1 };
        });
        assert.deepEqual(overflow.bad, [], 'elements past the column edge');
        if (overflow.scroller) assert.ok(overflow.scroller[0] <= overflow.scroller[1] + 1, `the day scroller scrolls sideways: ${overflow.scroller}`);
        assert.ok(overflow.page, 'no sideways page scroll');
        if (shots) await page.screenshot({ path: `${shots}/diary-preview-${width}-${theme}.png`, fullPage: true });
      });
      if (width === 1440 && theme === 'light') {
        // The preview is only honest if it computes what a real phone-width viewport computes.
        const real = await open(430, 'light', { preview: false });
        await check(`#637 the preview computes the same layout rules as a real 430px viewport (${tag})`, async () => {
          const a = await measure(page), b = await measure(real.page);
          // The rail's own paddings differ by design (a real phone has the drawer); the structure must not.
          for (const key of ['layout', 'primary', 'context', 'calendar']) assert.deepEqual(a[key], b[key], `${key}: preview ${JSON.stringify(a[key])} vs real ${JSON.stringify(b[key])}`);
          assert.equal(a.day.height, b.day.height, 'calendar day height');
        });
        await real.ctx.close();
      }
      await ctx.close();
    }

    // The Layout setting's note names the Diary, so the preview's promise matches what it does.
    for (const [locale, word] of [['en-GB', /the shell, Settings, Models and the Diary/], ['fr-FR', /les Réglages, les Modèles et le Journal/]]) {
      if (process.env.QA_ONLY) break;
      const ctx = await browser.newContext({ locale: 'en-GB', viewport: { width: 1440, height: 950 }, storageState: storage });
      await ctx.addInitScript(() => localStorage.setItem('cowork-layout-mode', 'auto'));
      const page = await ctx.newPage();
      await page.route('**/api/account/preferences', async (route) => {
        if (route.request().method() !== 'GET') return route.continue();
        const response = await route.fetch();
        return route.fulfill({ response, json: { ...(await response.json()), locale } });
      });
      await page.goto(`${env.origin}/settings/appearance`);
      await check(`#637 the Layout note lists the Diary (${locale})`, async () => {
        await page.getByText(word).first().waitFor({ timeout: 20000 });
      });
      await ctx.close();
    }
    assert.deepEqual(errors.filter((e) => !/ResizeObserver/.test(e)), [], 'page errors');
    if (failures.length) { console.log(`FAIL diary-phone-layout-637: ${failures.length} check(s) failed`); process.exitCode = 1; }
    else console.log('PASS #637 the Diary follows the phone-layout preview; 375/768/1440, light and dark.');
  } finally { await browser.close(); if (env) await env.stop(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
