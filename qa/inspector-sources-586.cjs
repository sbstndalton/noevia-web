// #586 (round 6): the chat page's right-hand context panel listed an unreadable original (binary
// bytes behind a .txt name) under Sources as an ordinary "Open source" button, while the project's
// Sources tab kept it apart and did not count it. The panel must leave it out. Real application
// server with a synthetic upstream; fails on a build without the fix and passes with it.
//
// Run: PLAYWRIGHT_MODULE=<playwright-core> [APP_DIR=<web dir of a built app>] [QA_SCREENSHOTS=<dir>] node qa/inspector-sources-586.cjs
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const { start, signedIn, upload } = require('./sources-panel-lib.cjs');

(async () => {
  let env;
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const errors = [];
  try {
    for (const [width, theme] of [[375, 'light'], [768, 'dark'], [1440, 'light'], [1440, 'dark']]) {
      // A fresh server and data dir per viewport: the first-run setup code is single use.
      env = await start({ port: 31587, name: 'inspector586' });
      const { ctx, page, api, project } = await signedIn(browser, env, { width, theme, projectName: `Inspector ${width} ${theme}` });
      page.on('pageerror', e => errors.push(e.message));
      await upload(page, [
        { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('Synthetic quarterly plan: ship the widget by June.') },
        { name: 'broken.txt', mimeType: 'text/plain', buffer: Buffer.concat([Buffer.from([0, 1, 2, 0, 255, 254, 0]), Buffer.from('binary junk')]) },
      ], 2);
      await page.locator('.upload-progress').getByText(/broken\.txt/).waitFor({ state: 'attached', timeout: 15000 });

      // One reply in the project, kept as a chat, then opened.
      const chatId = 'insp586-' + width + theme;
      const chat = await api('/api/chat', { spaceId: project.id, projectId: project.id, chatId, message: 'What is the quarterly plan?', history: [] });
      assert.equal(chat.status, 200, chat.text);
      assert.equal((await api(`/api/projects/${project.id}/chats`, { chats: [{ id: chatId, title: 'Quarterly plan' }] })).status, 200);
      const saved = await api(`/api/chats/${chatId}/history`, { history: [
        { role: 'user', content: 'What is the quarterly plan?' },
        { role: 'assistant', content: 'Synthetic answer.', model: 'synthetic' },
      ] });
      assert.equal(saved.status, 200, saved.text);
      await page.goto(`${env.origin}/c/${chatId}`);
      const rail = page.locator('#noevia-inspector');
      await rail.waitFor({ state: 'attached', timeout: 15000 });
      await rail.locator('.insp-section').filter({ has: page.locator('h3', { hasText: /^Sources$/ }) }).waitFor({ state: 'attached' });

      const section = rail.locator('.insp-section').filter({ has: page.locator('h3', { hasText: /^Sources$/ }) });
      // textContent, not innerText: at 375 the panel stacks or hides, and the DOM is what a screen reader gets.
      const listed = (await section.locator('li').evaluateAll(els => els.map(e => e.textContent.trim())));
      assert.ok(listed.some(t => /notes\.txt$/.test(t)), 'the readable file is listed: ' + JSON.stringify(listed));
      assert.ok(!listed.some(t => /broken\.txt/.test(t)), 'the unreadable file must not be listed as a source: ' + JSON.stringify(listed));
      assert.equal(listed.length, 1, 'only the readable source is listed: ' + JSON.stringify(listed));
      const opens = await section.locator('button.insp-source').evaluateAll(els => els.map(e => e.getAttribute('aria-label')));
      assert.ok(!opens.some(l => /broken\.txt/.test(l || '')), 'no "Open source" button for the unreadable file: ' + JSON.stringify(opens));
      if (process.env.QA_SCREENSHOTS) await page.screenshot({ path: `${process.env.QA_SCREENSHOTS}/inspector-586-${width}-${theme}.png`, fullPage: true });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no sideways scroll at ' + width);
      await ctx.close(); await env.stop(); env = null;
    }
    assert.deepEqual(errors, []);
    console.log('PASS #586: the chat page context panel lists only readable sources (the unreadable original is left out); 375/768/1440, light and dark.');
  } finally { await browser.close(); if (env) await env.stop(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
