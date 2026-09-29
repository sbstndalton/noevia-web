// #640, #643, #644, #645 in a real browser against the real application server (synthetic upstream,
// synthetic account; the chat stream and the toolbox list are synthetic in the page, as in
// qa/locale-615-626-628.cjs). Nothing touches Diary or real storage. Fails on a build without the
// fixes and passes with them.
//   #640  the phone-layout preview on a wide window: the sidebar drawer and its backdrop open inside the
//         430px preview column, not at the window's left edge (375 / 768 / 1440, light and dark)
//   #643  German and French: the reply header and the stats bar say "Auto (Schnell/Smart)" /
//         "Auto (Rapide/Intelligent)" before routing, never "Auto (Fast/Smart)"
//   #644  the elapsed counter of a new reply starts at 0 s on its very first frame, even when the chat
//         was opened minutes earlier (the clock is skewed by two minutes in the page to prove it)
//   #645  French: "jetons/s" on the reply line, "discussion de projet"; German/French Nextcloud toolset names
//
// Run: [APP_DIR=<web dir of a built app>] [QA_SCREENSHOTS=<dir>] node qa/locale-640-645.cjs
const os = require('node:os');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || `${os.homedir()}/noevia-local-test/node_modules/playwright-core`);
const assert = require('node:assert/strict');
const { start, signedIn } = require('./sources-panel-lib.cjs');

const L = {
  'de-DE': { pending: 'Auto (Schnell/Smart)', nc: ['Nextcloud-Dateien', 'Nextcloud-Freigaben'], needsProject: /Projekt-Chat/, unit: /Tok\/s/ },
  'fr-FR': { pending: 'Auto (Rapide/Intelligent)', nc: ['Fichiers Nextcloud', 'Partage Nextcloud'], needsProject: /discussion de projet/, unit: /jetons\/s/ },
};
const box = (id, label, extra = {}) => ({ id, label, description: 'Synthetic.', source: 'mcp', inApp: true, state: 'available', reason: null, active: false, tools: [], ...extra });
const PERMITTED = [
  box('nextcloud-files', 'Nextcloud Files'),
  box('nextcloud-sharing', 'Nextcloud Sharing'),
  box('code', 'Coding harness', { source: 'code', state: 'unavailable', reason: 'Open a project chat to run a Cowork task.', reasonCode: 'codeNeedsProject' }),
];

// In the page: a skewable clock, and a synthetic /api/chat answered from the message text.
function installPage() {
  const realNow = Date.now.bind(Date);
  window.__skew = 0;
  Date.now = () => realNow() + window.__skew;
  const realFetch = window.fetch.bind(window);
  const sse = (events) => events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');
  window.fetch = (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.origin);
    if (url.pathname !== '/api/chat' || (init.method || 'GET') !== 'POST') return realFetch(input, init);
    const { message } = JSON.parse(init.body);
    const headers = { 'Content-Type': 'text/event-stream' };
    if (message === 'ONE') return Promise.resolve(new Response(sse([{ type: 'meta', route: 'fast' }, { type: 'delta', text: 'Synthetic answer one.' },
      { type: 'usage', promptTokens: 10, completionTokens: 20, totalTokens: 30, tokensPerSecond: 19.7 }, { type: 'done' }]), { status: 200, headers }));
    // QUIET: nothing arrives, so the reply stays "pending" (before the route decision). Stop ends it.
    const stream = new ReadableStream({ start(controller) { init.signal?.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError'))); } });
    return Promise.resolve(new Response(stream, { status: 200, headers }));
  };
}

(async () => {
  let env;
  const browser = await chromium.launch({ headless: true, channel: process.env.QA_CHANNEL || 'chrome' });
  const failures = [], errors = [];
  const shots = process.env.QA_SCREENSHOTS;
  const check = async (name, fn) => {
    try { await fn(); console.log(`ok   ${name}`); } catch (e) { failures.push(name); console.log(`FAIL ${name}\n     ${String(e.message).split('\n').slice(0, 6).join('\n     ')}`); }
  };
  const flat = (s) => s.replace(/[\s  ]+/g, ' ').trim();
  try {
    env = await start({ port: 31640, name: 'locale640' });
    const first = await signedIn(browser, env, { width: 1440, theme: 'light', projectName: 'Locale 640' });
    const project = JSON.parse((await first.api('/api/projects', { name: 'Auto 640', model: 'synthetic', routing: 'auto', toolboxes: ['core'] })).text);
    const chats = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l'].map((s) => `l640-${s}`);
    assert.equal((await first.api(`/api/projects/${project.id}/chats`, { chats: chats.map((id) => ({ id, title: 'Plan ' + id })) })).status, 200);
    const storage = await first.ctx.storageState();
    await first.ctx.close();
    let chatIndex = 0;

    // ---- #640: the drawer in the phone-layout preview ----
    for (const [width, theme] of [[375, 'light'], [768, 'dark'], [1440, 'light'], [1440, 'dark']]) {
      if (process.env.QA_ONLY && !`${width}:${theme}`.startsWith(process.env.QA_ONLY)) continue;
      const ctx = await browser.newContext({ locale: 'en-GB', viewport: { width, height: 900 }, storageState: storage });
      await ctx.addInitScript(([t]) => { localStorage.setItem('cowork-theme', t); localStorage.setItem('cowork-layout-mode', 'mobile'); }, [theme]);
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(`drawer ${width} ${theme}: ${e.message}`));
      await page.goto(`${env.origin}/c/${chats[0]}`);
      await page.locator('textarea').first().waitFor({ timeout: 20000 });
      await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
      await check(`#640 the drawer opens inside the phone preview column (${width} ${theme})`, async () => {
        assert.equal(await page.evaluate(() => document.documentElement.dataset.layout), 'mobile');
        await page.locator('.nav-drawer-toggle').first().click();
        const drawer = page.locator('.sidebar.is-expanded').first();
        await drawer.waitFor({ timeout: 10000 });
        await page.waitForTimeout(500);
        const m = await page.evaluate(() => {
          const r = (el) => { const b = el.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: b.width }; };
          const back = document.querySelector('.nav-drawer-backdrop');
          return { column: r(document.querySelector('#root')), drawer: r(document.querySelector('.sidebar.is-expanded')), backdrop: back ? r(back) : null, vw: innerWidth, vh: innerHeight };
        });
        const near = (a, b) => Math.abs(a - b) <= 1.5;
        assert.ok(m.drawer.left >= m.column.left - 1.5, `drawer left ${Math.round(m.drawer.left)} is left of the column (${Math.round(m.column.left)})`);
        assert.ok(m.drawer.right <= m.column.right + 1.5, `drawer right ${Math.round(m.drawer.right)} is past the column (${Math.round(m.column.right)})`);
        assert.ok(near(m.drawer.top, m.column.top) && near(m.drawer.bottom, m.column.bottom), `drawer fills the column height: ${JSON.stringify(m.drawer)} vs ${JSON.stringify(m.column)}`);
        assert.ok(m.backdrop, 'the backdrop is drawn');
        assert.ok(m.backdrop.left >= m.column.left - 1.5 && m.backdrop.right <= m.column.right + 1.5, `backdrop ${Math.round(m.backdrop.left)}..${Math.round(m.backdrop.right)} stays in the column ${Math.round(m.column.left)}..${Math.round(m.column.right)}`);
        if (shots) await page.screenshot({ path: `${shots}/drawer-preview-${width}-${theme}.png` });
      });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `no sideways scroll at ${width}`);
      await ctx.close();
    }

    // ---- #643 #644 #645 in German and French ----
    for (const locale of Object.keys(L)) {
      const l = L[locale];
      for (const [width, theme] of [[375, 'light'], [768, 'dark'], [1440, 'light'], [1440, 'dark']]) {
        if (process.env.QA_ONLY && !`${locale}:${width}:${theme}`.startsWith(process.env.QA_ONLY)) continue;
        const tag = `${locale} ${width} ${theme}`, short = `${locale.slice(0, 2)}-${width}-${theme}`;
        const ctx = await browser.newContext({ locale: 'en-GB', viewport: { width, height: 900 }, storageState: storage, isMobile: width < 768, hasTouch: width < 768 });
        await ctx.addInitScript(([t]) => localStorage.setItem('cowork-theme', t), [theme]);
        const page = await ctx.newPage();
        page.on('pageerror', (e) => errors.push(`${tag}: ${e.message}`));
        await page.route('**/api/account/preferences', async (route) => {
          if (route.request().method() !== 'GET') return route.continue();
          const response = await route.fetch();
          return route.fulfill({ response, json: { ...(await response.json()), locale } });
        });
        await page.route('**/api/toolboxes/permitted**', (route) => route.fulfill({ json: { mode: 'chat', boxes: PERMITTED } }));
        await page.addInitScript(installPage);
        await page.goto(`${env.origin}/c/${chats[chatIndex++ % chats.length]}`);
        await page.locator('textarea').first().waitFor({ timeout: 20000 });
        await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
        const send = async (text) => { await page.locator('textarea').first().fill(text); await page.keyboard.press('Enter'); };

        // ---- #643 (idle) then #644 (the first frame) and #643 (pending) ----
        // Two minutes pass in the page before the message is sent; the counter must still start at zero.
        await page.evaluate(() => {
          window.__skew += 120000;
          window.__seen = { timer: [], sender: [], stats: [] };
          const note = () => {
            const timers = [...document.querySelectorAll('.msg-meta > span')].map((e) => e.textContent.trim());
            if (timers.length) window.__seen.timer.push(timers.at(-1));
            const senders = [...document.querySelectorAll('.msg-sender.is-assistant')].map((e) => e.textContent.replace(/\s+/g, ' ').trim());
            if (senders.length) window.__seen.sender.push(senders.at(-1));
            const stats = document.querySelector('.stats-bar');
            if (stats) window.__seen.stats.push(stats.textContent.replace(/\s+/g, ' ').trim());
          };
          new MutationObserver(note).observe(document.body, { subtree: true, childList: true, characterData: true });
        });
        await send('QUIET');
        await page.locator('.msg-meta').last().waitFor({ timeout: 10000 });
        await page.waitForTimeout(700);
        const seen = await page.evaluate(() => window.__seen);
        await check(`#644 the counter of a new reply starts at 0 s on its first frame (${tag})`, async () => {
          assert.ok(seen.timer.length, 'a timer was drawn');
          const firstFrames = seen.timer.slice(0, 3);
          for (const text of firstFrames) {
            assert.doesNotMatch(text, /min|h\b|\d{2,} ?s/, `first frames ${JSON.stringify(firstFrames)} show the time since the chat opened`);
            assert.ok(parseFloat(text.replace(',', '.')) < 1, `first frames ${JSON.stringify(firstFrames)} start near zero`);
          }
        });
        await check(`#643 the pending reply header and the stats bar say ${l.pending} (${tag})`, async () => {
          const sender = seen.sender.at(-1) || '';
          assert.ok(sender.endsWith(l.pending), `sender "${sender}" ends with ${l.pending}`);
          assert.ok(seen.sender.every((s) => !/Fast\/Smart/.test(s)), `English in a sender frame: ${JSON.stringify([...new Set(seen.sender)])}`);
          assert.ok(seen.stats.every((s) => !/Fast\/Smart/.test(s)), `English in a stats frame: ${JSON.stringify([...new Set(seen.stats)].slice(0, 3))}`);
          // On a phone the stats live in the model sheet, closed here; the wide layouts show the bar.
          if (width >= 768) {
            const now = flat(await page.locator('.stats-bar').innerText());
            assert.ok(now.includes(l.pending), `stats bar "${now}" names ${l.pending}`);
          }
          if (shots) await page.screenshot({ path: `${shots}/pending-${short}.png` });
        });
        await page.getByRole('button', { name: /Stop|Stopp|Arrêt|Arrêter|stopp/i }).first().click().catch(() => undefined);
        await page.locator('.composer-inner textarea, textarea').first().waitFor();

        // ---- #645: the reply line and the tool catalogue ----
        await send('ONE');
        await page.getByText('Synthetic answer one.').waitFor({ timeout: 15000 });
        await check(`#645 the reply line uses the ${locale} tokens-per-second unit (${tag})`, async () => {
          const meta = flat(await page.locator('.msg-meta').last().innerText());
          assert.match(meta, l.unit, meta);
          assert.doesNotMatch(meta, /tok\/s/, meta);
          if (width >= 768) {
            const bar = flat(await page.locator('.stats-bar').innerText());
            assert.doesNotMatch(bar, /tok\/s|\((fast|smart|code)\)|Fast\/Smart|Assistant/, `stats bar after the reply: ${bar}`);
          }
        });
        await check(`#645 the tool catalogue names the Nextcloud toolsets and the project chat in ${locale} (${tag})`, async () => {
          await page.locator('textarea').first().fill('/');
          const list = page.locator('.tool-catalogue-list');
          await list.waitFor({ timeout: 10000 });
          await list.locator('li[data-kind=box]').first().waitFor();
          const rows = (await list.locator('li[data-kind=box]').allInnerTexts()).map(flat);
          for (const name of l.nc) assert.ok(rows.some((r) => r.startsWith(name)), `${name} in ${JSON.stringify(rows)}`);
          assert.ok(!rows.some((r) => /^Nextcloud (Files|Sharing)/.test(r)), `English toolset name in ${JSON.stringify(rows)}`);
          assert.ok(rows.some((r) => l.needsProject.test(r)), `project chat wording in ${JSON.stringify(rows)}`);
          assert.ok(!rows.some((r) => /chat de projet/.test(r)), 'no "chat de projet"');
          if (shots) await page.screenshot({ path: `${shots}/catalogue-${short}.png` });
          await page.keyboard.press('Escape');
        });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `no sideways scroll at ${tag}`);
        await ctx.close();
      }
    }
    assert.deepEqual(errors.filter((e) => !/ResizeObserver/.test(e)), [], 'page errors');
    if (failures.length) { console.log(`FAIL locale-640-645: ${failures.length} check(s) failed`); process.exitCode = 1; }
    else console.log('PASS #640 #643 #644 #645; 375/768/1440, light and dark.');
  } finally { await browser.close(); if (env) await env.stop(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
