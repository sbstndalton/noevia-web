// #635: the account language was changed in another browser. This browser's cached preferences
// (localStorage "noevia:account-preferences") still say German, the server says the account follows the
// browser (English). On the first load the app renders from the cache, then the server's value arrives;
// every translated component must follow it at once. Before the fix the reply actions, the reasoning
// summary and the stats bar could stay in the old language until a second reload: a component that
// rendered from the cache and subscribed to the change only in an effect missed the account's answer
// when it landed in between (it copied the preferences with useState).
//
// The real application server and the real preferences route. The "other browser" is simulated the way
// it really happens: the stored account locale is changed SERVER-SIDE (PUT /api/account/preferences
// through the API, not through this page), so this page's cache is left stale. The chat history is
// seeded through the real history route (replies with reasoning and stats); many replies and a slowed
// CPU widen the render-to-effect window, and every case loads several times because one load can pass
// by luck.
//   1. cache de-DE, account system: after ONE load no German is left anywhere on the page
//   2. the last of those loads reads the same as a plain second reload
//   3. the other direction (cache system, account fr-FR) is French on the first load
//
// Run: [APP_DIR=<web dir of a built app>] [QA_SCREENSHOTS=<dir>] node qa/locale-second-browser-635.cjs
//      QA_CYCLES (loads per case, default 8), QA_TURNS (replies, default 30), QA_CPU_THROTTLE (default 20),
//      QA_PREFS_DELAY_MS (default 100)
const os = require('node:os');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || `${os.homedir()}/noevia-local-test/node_modules/playwright-core`);
const assert = require('node:assert/strict');
const { start, signedIn } = require('./sources-panel-lib.cjs');

const GERMAN = /Kopieren|Erneut generieren|Gedanken|Geschwindigkeit|Nicht gemeldet|Erstes Token|Letzte Antwort|Engine gesamt|Wörter/;
const ENGLISH = /\bCopy\b|\bRegenerate\b|\bThought\b/;
const FRENCH = /Copier[\s\S]*Régénérer/;

(async () => {
  let env;
  const browser = await chromium.launch({ headless: true, channel: process.env.QA_CHANNEL || 'chrome' });
  const errors = [], failures = [];
  const shots = process.env.QA_SCREENSHOTS;
  const check = async (name, fn) => {
    try { await fn(); console.log(`ok   ${name}`); } catch (e) { failures.push(name); console.log(`FAIL ${name}\n     ${String(e.message).split('\n').slice(0, 6).join('\n     ')}`); }
  };
  const cycles = Number(process.env.QA_CYCLES || 8), turns = Number(process.env.QA_TURNS || 30), throttle = Number(process.env.QA_CPU_THROTTLE || 20);
  try {
    for (const [width, theme] of [[375, 'light'], [768, 'dark'], [1440, 'light'], [1440, 'dark']]) {
      if (process.env.QA_ONLY && !`${width}:${theme}`.startsWith(process.env.QA_ONLY)) continue;
      const tag = `${width} ${theme}`, short = `${width}-${theme}`;
      env = await start({ port: 31635, name: 'second635' });
      const { ctx, page, api } = await signedIn(browser, env, { width, theme, projectName: `Zweit ${short}` });
      page.on('pageerror', (e) => errors.push(`${tag}: ${e.message}`));
      const project = JSON.parse((await api('/api/projects', { name: `Second ${short}`, model: 'synthetic', routing: 'manual', toolboxes: ['core'] })).text);
      const chatId = `l635-${short}`;
      assert.equal((await api(`/api/projects/${project.id}/chats`, { chats: [{ id: chatId, title: 'Plan' }] })).status, 200);
      const turn = (n) => [
        { role: 'user', content: `Synthetic question ${n}` },
        { role: 'assistant', content: `Synthetic answer ${n} with **bold** text.`, model: 'Assistant · Auto (fast)', reasoning: 'one two three four five six seven', reasoningMs: 4200,
          stats: { promptTokens: 120, completionTokens: 48, totalTokens: 168, tokensPerSecond: 21.5, elapsedMs: 5300 } },
      ];
      assert.equal((await api(`/api/chats/${chatId}/history`, { history: Array.from({ length: turns }, (_, i) => turn(i + 1)).flat() })).status, 200);
      if (throttle) await (await ctx.newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: throttle });

      // The account record answers a moment after the page starts drawing, as it does on a real link.
      const prefsDelay = Number(process.env.QA_PREFS_DELAY_MS || 100);
      await page.route('**/api/account/preferences', async (route) => { if (route.request().method() === 'GET') await new Promise((r) => setTimeout(r, prefsDelay)); await route.fallback(); });

      const KEY = 'noevia:account-preferences';
      const stale = (locale) => page.evaluate(([key, l]) => localStorage.setItem(key, JSON.stringify({ notifications: { replyFinished: true, approvalNeeded: true }, sendKey: 'enter', locale: l })), [KEY, locale]);
      const setAccountLocale = async (locale) => assert.equal((await api('/api/account/preferences', { locale }, 'PUT')).status, 200);
      const settle = async () => {
        await page.locator('.msg[data-role=assistant] .msg-actions').last().waitFor({ timeout: 60000 });
        // The preferences fetch has long since answered; give React a moment to settle.
        await new Promise((r) => setTimeout(r, 1500));
      };
      const pageText = async () => (await page.locator('body').innerText()).replace(/[\s  ]+/g, ' ').trim();
      // The stats bar is collapsed by default; open it so its labels are on the page too.
      const openStats = async () => { const d = page.locator('.stats-disclosure summary, .stats-disclosure button').first(); if (await d.count()) await d.click().catch(() => undefined); };

      await page.goto(`${env.origin}/c/${chatId}`);
      await settle();
      let lastLoad = '';
      await check(`#635 ${cycles} loads after the account language changed elsewhere leave no German (${tag})`, async () => {
        await setAccountLocale('system');
        for (let i = 1; i <= cycles; i++) {
          await stale('de-DE'); // this browser last used German
          await page.reload();
          await settle(); await openStats();
          lastLoad = await pageText();
          assert.equal(await page.evaluate(() => document.documentElement.lang), 'en-GB');
          const german = lastLoad.match(new RegExp(GERMAN.source, 'g'));
          assert.equal(german, null, `load ${i}: German left on the first load: ${german}\n${lastLoad.slice(0, 500)}`);
          for (const word of [/\bCopy\b/, /\bRegenerate\b/, /\bThought\b/]) assert.match(lastLoad, word, `load ${i}: ${word} (the reply actions and the reasoning summary are English)`);
        }
        if (shots) await page.screenshot({ path: `${shots}/second-browser-${short}.png`, fullPage: true });
      });
      await check(`#635 the last first load reads the same as a plain second reload (${tag})`, async () => {
        await page.reload();
        await settle(); await openStats();
        const second = await pageText();
        const words = (s) => new Set(s.split(' ').filter((w) => /^[A-Za-zÄÖÜäöüß]{4,}$/.test(w)));
        const onlyFirst = [...words(lastLoad)].filter((w) => !words(second).has(w));
        assert.deepEqual(onlyFirst, [], `words only on the first load: ${onlyFirst}`);
        assert.match(second, ENGLISH);
      });

      // The other way round: the cache says English (system), the account moved to French elsewhere.
      await check(`#635 ${cycles} loads of an account moved to French elsewhere are French at once (${tag})`, async () => {
        await setAccountLocale('fr-FR');
        for (let i = 1; i <= cycles; i++) {
          await stale('system');
          await page.reload();
          await settle(); await openStats();
          const text = await pageText();
          assert.equal(await page.evaluate(() => document.documentElement.lang), 'fr-FR');
          assert.match(text, FRENCH, `load ${i}: French`);
          const english = text.match(/\bCopy\b|\bRegenerate\b|\bThought\b/g);
          assert.equal(english, null, `load ${i}: English left on the first load: ${english}`);
        }
        if (shots) await page.screenshot({ path: `${shots}/second-browser-fr-${short}.png`, fullPage: true });
      });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no sideways scroll at ' + tag);
      await ctx.close(); await env.stop(); env = null;
    }
    assert.deepEqual(errors.filter((e) => !/ResizeObserver/.test(e)), [], 'page errors');
    if (failures.length) { console.log(`FAIL locale-second-browser-635: ${failures.length} check(s) failed`); process.exitCode = 1; }
    else console.log('PASS #635 a language changed in another browser applies on the first load; 375/768/1440, light and dark.');
  } finally { await browser.close(); if (env) await env.stop(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
