// #634: the Stopped placeholder is drawn in the language active NOW, not the one active when Stop was
// pressed. Before the fix the translated sentence was saved as the message body ("Gestoppt, bevor eine
// Antwort geschrieben wurde." in the chat history), so it stayed German after switching to English.
//
// The real application server and the real chat-history route; only the model stream is synthetic
// (the page answers POST /api/chat, holding it open until Stop). The account language is set by
// answering the preferences GET (page memory only).
//   1. stop in German, read the stored history: the placeholder is a language-neutral token, not a sentence
//   2. switch to English and reload: the body and the sender are English, no German is left
//   3. a chat saved by the old build (German sentence stored as the body) is worded in the active
//      language too, in English and in French
//   4. Copy and Regenerate are still offered on a stopped reply
//
// Run: [APP_DIR=<web dir of a built app>] [QA_SCREENSHOTS=<dir>] node qa/stopped-language-634.cjs
const os = require('node:os'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || `${os.homedir()}/noevia-local-test/node_modules/playwright-core`);
const assert = require('node:assert/strict');
const ts = require('typescript');
const { start, signedIn } = require('./sources-panel-lib.cjs');

const SRC = path.join(__dirname, '../src'), cache = {};
function load(file) {
  file = path.posix.normalize(file);
  if (cache[file]) return cache[file];
  const exports_ = {}; cache[file] = exports_;
  const code = ts.transpileModule(fs.readFileSync(path.join(SRC, file + '.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const here = path.posix.dirname(file);
  vm.runInNewContext(code, { exports: exports_, Intl, Map, Number, Object, console, Promise, require: (m) => load(path.posix.join(here, m)) });
  return exports_;
}
const core = load('i18n/core');
for (const [l, name] of [['de-DE', 'DE_DE'], ['fr-FR', 'FR_FR'], ['en-GB', 'EN_GB']]) if (l !== 'en-GB') core.registerCatalogue(l, load(`i18n/${l}`)[name]);
const tr = (locale, key) => core.translate(locale, key);
const GERMAN_BODY = tr('de-DE', 'chat.stopped.content');

// A model stream that never produces text: the page answers /api/chat and Stop ends it.
function installChat() {
  const realFetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.origin);
    if (url.pathname !== '/api/chat' || (init.method || 'GET') !== 'POST') return realFetch(input, init);
    const stream = new ReadableStream({ start(controller) { init.signal?.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError'))); } });
    return Promise.resolve(new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }));
  };
}

(async () => {
  let env;
  const browser = await chromium.launch({ headless: true, channel: process.env.QA_CHANNEL || 'chrome' });
  const errors = [], failures = [];
  const shots = process.env.QA_SCREENSHOTS;
  const check = async (name, fn) => {
    try { await fn(); console.log(`ok   ${name}`); } catch (e) { failures.push(name); console.log(`FAIL ${name}\n     ${String(e.message).split('\n').slice(0, 6).join('\n     ')}`); }
  };
  const flat = (s) => s.replace(/[\s  ]+/g, ' ').trim();
  try {
    for (const [width, theme] of [[375, 'light'], [768, 'dark'], [1440, 'light'], [1440, 'dark']]) {
      if (process.env.QA_ONLY && !`${width}:${theme}`.startsWith(process.env.QA_ONLY)) continue;
      const tag = `${width} ${theme}`, short = `${width}-${theme}`;
      env = await start({ port: 31634, name: 'stopped634' });
      const { ctx, page, api } = await signedIn(browser, env, { width, theme, projectName: `Stop ${short}` });
      page.on('pageerror', (e) => errors.push(`${tag}: ${e.message}`));
      const project = JSON.parse((await api('/api/projects', { name: `Stopped ${short}`, model: 'synthetic', routing: 'manual', toolboxes: ['core'] })).text);
      let locale = 'de-DE';
      await page.route('**/api/account/preferences', async (route) => {
        if (route.request().method() !== 'GET') return route.continue();
        const response = await route.fetch();
        return route.fulfill({ response, json: { ...(await response.json()), locale } });
      });
      await page.addInitScript(installChat);
      const history = async (chatId) => JSON.parse((await api(`/api/chats/${chatId}/history`)).text).history;
      const chatId = `s634-${short}`;
      assert.equal((await api(`/api/projects/${project.id}/chats`, { chats: [{ id: chatId, title: 'Plan' }] })).status, 200);
      await page.goto(`${env.origin}/c/${chatId}`);
      await page.locator('textarea').first().waitFor({ timeout: 20000 });
      await page.locator('textarea').first().fill('QUIET');
      await page.keyboard.press('Enter');
      await page.getByRole('button', { name: tr('de-DE', 'composer.stop') }).click({ timeout: 15000 });

      await check(`#634 stopping in German shows the German placeholder (${tag})`, async () => {
        await page.getByText(GERMAN_BODY).waitFor({ timeout: 10000 });
        const sender = flat(await page.locator('.msg-sender.is-assistant').last().textContent());
        assert.ok(sender.endsWith(tr('de-DE', 'chat.stopped.sender')), sender);
      });
      await check(`#634 the saved history holds a language-neutral token, not the German sentence (${tag})`, async () => {
        let stored = [];
        for (let i = 0; i < 60; i++) { stored = await history(chatId); if (stored.some((m) => m.role === 'assistant')) break; await new Promise((r) => setTimeout(r, 250)); }
        const reply = stored.find((m) => m.role === 'assistant');
        assert.ok(reply, 'the stopped reply was saved');
        assert.equal(reply.model, 'Stopped', 'the sender token');
        assert.ok(!/Gestoppt|Stopped before|Arrêté/.test(reply.content), `the body must not be a translated sentence: ${JSON.stringify(reply.content)}`);
      });

      locale = 'en-GB';
      await page.reload();
      await page.locator('.msg[data-role=assistant]').first().waitFor({ timeout: 20000 });
      await check(`#634 after switching to English the placeholder is English (${tag})`, async () => {
        await page.getByText(tr('en-GB', 'chat.stopped.content')).waitFor({ timeout: 10000 });
        const shown = flat(await page.locator('.transcript').innerText());
        assert.ok(!/Gestoppt/.test(shown), shown);
        const sender = flat(await page.locator('.msg-sender.is-assistant').last().textContent());
        assert.ok(sender.endsWith(tr('en-GB', 'chat.stopped.sender')), sender);
        if (shots) await page.screenshot({ path: `${shots}/stopped-en-${short}.png`, fullPage: true });
      });
      await check(`#634 Copy and Regenerate are still offered on a stopped reply (${tag})`, async () => {
        const actions = page.locator('.msg[data-role=assistant] .msg-actions').last();
        await actions.waitFor({ timeout: 5000 });
        assert.ok((await actions.locator('button').count()) >= 2);
      });

      // A chat saved by the build before the fix: the German sentence is the stored body.
      const legacyId = `s634-old-${short}`;
      assert.equal((await api(`/api/projects/${project.id}/chats`, { chats: [{ id: chatId, title: 'Plan' }, { id: legacyId, title: 'Old' }] })).status, 200);
      assert.equal((await api(`/api/chats/${legacyId}/history`, { history: [{ role: 'user', content: 'Frage' }, { role: 'assistant', content: GERMAN_BODY, model: 'Stopped' }] })).status, 200);
      for (const loc of ['en-GB', 'fr-FR']) {
        locale = loc;
        await page.goto(`${env.origin}/c/${legacyId}`);
        await page.locator('.msg[data-role=assistant]').first().waitFor({ timeout: 20000 });
        await check(`#634 a chat saved before the fix is worded in ${loc} (${tag})`, async () => {
          await page.getByText(tr(loc, 'chat.stopped.content')).waitFor({ timeout: 10000 });
          assert.ok(!/Gestoppt, bevor/.test(await page.locator('.transcript').innerText()));
          if (shots && loc === 'fr-FR') await page.screenshot({ path: `${shots}/stopped-old-fr-${short}.png`, fullPage: true });
        });
      }
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no sideways scroll at ' + tag);
      await ctx.close(); await env.stop(); env = null;
    }
    assert.deepEqual(errors.filter((e) => !/ResizeObserver/.test(e)), [], 'page errors');
    if (failures.length) { console.log(`FAIL stopped-language-634: ${failures.length} check(s) failed`); process.exitCode = 1; }
    else console.log('PASS #634 the Stopped placeholder follows the active language; 375/768/1440, light and dark.');
  } finally { await browser.close(); if (env) await env.stop(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
