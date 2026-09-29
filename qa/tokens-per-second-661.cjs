// #661: a locale writes tokens per second one way. Spanish showed "24,4 tok/s" (the stats bar) and
// "24,4 tokens/s" (elsewhere in the same view); German called the fast role "Fast" in one description
// and "Schnell" everywhere else.
//   1. with the engine reporting 24.4 tokens per second (answered in the page: synthetic), one project chat's
//      stats bar and reply footer, and Settings -> Models & routing, show the same unit and no other spelling
//   2. every text the page holds for the locale (its catalogue chunks, read back in page memory) uses one
//      tokens-per-second spelling, and the de-DE routing description says "Schnell", not "Fast"
//
// The real application server on synthetic data. Nothing here touches Diary or real storage.
//
// Run: [APP_DIR=<web dir of a built app>] [QA_SCREENSHOTS=<dir>] node qa/tokens-per-second-661.cjs
const os = require('node:os');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || `${os.homedir()}/noevia-local-test/node_modules/playwright-core`);
const assert = require('node:assert/strict');
const { start, signedIn } = require('./sources-panel-lib.cjs');

const CASES = [
  { locale: 'es-ES', unit: 'tokens/s', value: '24,4', wrong: /\btok\/s\b/i, rate: /24,4 tokens\/s/ },
  { locale: 'de-DE', unit: 'Token/s', value: '24,4', wrong: /\bTok\/s\b/, rate: /24,4 Token\/s/ },
];
const ANY_UNIT = /(?:tok|tokens?|jetons?)\/s\b/gi;

(async () => {
  let env;
  const browser = await chromium.launch({ headless: true, channel: process.env.QA_CHANNEL || 'chrome' });
  const failures = [], errors = [];
  const shots = process.env.QA_SCREENSHOTS;
  const check = async (name, fn) => {
    try { await fn(); console.log(`ok   ${name}`); } catch (e) { failures.push(name); console.log(`FAIL ${name}\n     ${String(e.message).split('\n').slice(0, 8).join('\n     ')}`); }
  };
  try {
    env = await start({ port: 31661, name: 'tps661' });
    const first = await signedIn(browser, env, { width: 1440, theme: 'light', projectName: 'Synthetic speed' });
    await first.api(`/api/projects/${first.project.id}/chats`, { chats: [{ id: 'c-tps-1', title: 'Speed', updatedAt: Date.now() }] });
    await first.api('/api/chats/c-tps-1/history', { history: [{ role: 'user', content: 'Hello' }, { role: 'assistant', content: 'Synthetic answer.', stats: { elapsedMs: 4100, promptTokens: 10, completionTokens: 90, totalTokens: 100, tokensPerSecond: 24.4 } }] });
    const storage = await first.ctx.storageState();
    await first.ctx.close();

    for (const theme of ['light', 'dark']) {
      for (const { locale, unit, value, wrong, rate } of CASES) {
        const ctx = await browser.newContext({ locale, viewport: { width: 1440, height: 900 }, storageState: storage });
        await ctx.addInitScript((t) => localStorage.setItem('cowork-theme', t), theme);
        const page = await ctx.newPage();
        page.on('pageerror', (e) => errors.push(`${locale}: ${e.message}`));
        // The engine reports 24.4 tokens per second; the same answer feeds the stats bar and the Models summary.
        await page.route('**/api/stats', (route) => route.fulfill({ json: { up: true, tokensPerSecond: 24.4, timeToFirstToken: 0.4, inputTokens: 10, outputTokens: 20, mtp: [] } }));

        await check(`#661 ${locale} (${theme}): the chat stats bar and Models & routing use one unit (${unit})`, async () => {
          await page.goto(`${env.origin}/c/c-tps-1`);
          await page.locator('.msg-meta').first().waitFor({ timeout: 20000 });
          await page.locator('.stats-details').waitFor({ timeout: 20000 });
          await page.waitForFunction(() => /24[.,]4/.test(document.querySelector('.stats-details')?.innerText || ''), null, { timeout: 15000 });
          const bar = (await page.locator('.msg-meta').first().innerText() + '\n' + await page.locator('.stats-details').innerText()).replace(/[ \t]+/g, ' ');
          if (shots) await page.screenshot({ path: `${shots}/tps-chat-${locale}-${theme}.png` });
          assert.match(bar, rate, `stats bar: ${bar}`);
          assert.match(await page.locator('.msg-meta').first().innerText(), rate, 'the reply footer');
          await page.goto(`${env.origin}/settings/models`);
          await page.locator('.mm-summary .model-row').first().waitFor({ timeout: 20000 });
          await page.waitForFunction(() => /24[.,]4/.test(document.querySelector('.mm-summary')?.innerText || ''), null, { timeout: 15000 });
          const summary = await page.locator('.mm-summary').innerText();
          if (shots) await page.screenshot({ path: `${shots}/tps-models-${locale}-${theme}.png` });
          assert.match(summary, rate, `models summary: ${summary}`);
          assert.doesNotMatch(bar + '\n' + summary, wrong, 'the abbreviated spelling is still shown next to the full one');
          assert.deepEqual([...new Set((bar + '\n' + summary).match(ANY_UNIT))], [unit], 'more than one spelling in the same views');
        });

        await check(`#661 ${locale} (${theme}): the catalogue text held in page memory uses one spelling`, async () => {
          await page.goto(`${env.origin}/settings/models`);
          await page.locator('.mm-summary').waitFor({ timeout: 20000 });
          await page.goto(`${env.origin}/settings/general`);
          await page.locator('.settings-detail').waitFor({ timeout: 20000 });
          const held = await page.evaluate(async () => {
            const urls = performance.getEntriesByType('resource').map((r) => r.name).filter((u) => /\.js(\?|$)/.test(u));
            return (await Promise.all(urls.map((u) => fetch(u).then((r) => r.text()).catch(() => '')))).join('\n');
          });
          const lines = held.split('\n');
          // The locale's own chunks are the ones carrying its stats unit and its routing wording.
          const own = lines.filter((l) => /stats\.tokPerSecUnit|models\.rate|systemOneRouting/.test(l));
          assert.ok(own.length, 'no catalogue text found in the loaded chunks');
          if (locale === 'de-DE') {
            assert.match(held, /Schnell, Smart oder Code/, 'the de-DE routing description names the fast role Schnell');
            assert.doesNotMatch(held, /gerouteten Nachrichten Fast\b/, 'the de-DE routing description still says Fast');
          }
          const forms = new Set();
          for (const line of own) {
            // Only the strings of this locale (the English strings share the chunk graph, but not these keys' values).
            for (const m of line.matchAll(/(?:stats\.tokPerSecUnit|models\.rate|stats\.tokensPerSecond|mm\.tokensPerSecond)["']?\s*:\s*["'`]([^"'`]*)["'`]/g)) {
              for (const u of m[1].matchAll(ANY_UNIT)) forms.add(u[0]);
            }
          }
          assert.ok(forms.has(unit), `${unit} not found among ${[...forms]}`);
          assert.ok(![...forms].some((f) => wrong.test(f)), `abbreviation still present among ${[...forms]}`);
          assert.ok([...forms].every((f) => f === unit || f === 'tokens/s'), `unexpected spellings ${[...forms]}`);
        });
        await ctx.close();
      }
    }
    assert.deepEqual(errors.filter((e) => !/ResizeObserver/.test(e)), [], 'page errors');
    if (failures.length) { console.log(`FAIL tokens-per-second-661: ${failures.length} check(s) failed`); process.exitCode = 1; }
    else console.log('PASS #661 Spanish and German write tokens per second one way; German says Schnell.');
  } finally { await browser.close(); if (env) await env.stop(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
