// #586: an unreadable upload (binary bytes behind a .txt name) is not a text source. It must be
// listed apart under "Not readable" (with a Remove action), left out of the Text group and every
// Sources count, and never offered to the model or cited in a reply. Real application server with
// a synthetic upstream; fails on a build without the fix and passes with it.
//
// Run: PLAYWRIGHT_MODULE=<playwright-core> [APP_DIR=<web dir of a built app>] [QA_SCREENSHOTS=<dir>] node qa/unreadable-source-586.cjs
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
      env = await start({ port: 31586, name: 'unreadable586' });
      const { ctx, page, api, project } = await signedIn(browser, env, { width, theme, projectName: `Unreadable ${width} ${theme}` });
      page.on('pageerror', e => errors.push(e.message));
      await upload(page, [
        { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('Synthetic quarterly plan: ship the widget by June.') },
        { name: 'broken.txt', mimeType: 'text/plain', buffer: Buffer.concat([Buffer.from([0, 1, 2, 0, 255, 254, 0]), Buffer.from('binary junk')]) },
      ], 2);
      await page.locator('.upload-progress').getByText(/broken\.txt/).waitFor({ state: 'attached', timeout: 15000 });
      const summary = await page.locator('summary').filter({ hasText: /Upload results/ }).first().innerText();
      assert.match(summary, /some files were not added/, summary);

      // The Text group holds only the readable file; the counters agree.
      const text = page.getByRole('region', { name: 'Text' });
      await text.waitFor();
      assert.equal(await text.locator('li').count(), 1, 'Text lists only the readable file');
      assert.match(await text.locator('h3').innerText(), /\(1\)/, 'Text count');
      assert.equal(await text.getByText('broken.txt').count(), 0, 'broken.txt must not sit under Text');
      const tab = await page.getByRole('tab', { name: /Sources/ }).first().innerText().catch(() => '');
      if (tab) assert.match(tab, /\b1\b/, 'Sources tab counts one source, got: ' + tab);

      // It has its own clearly separate state, with a way to remove it.
      const bad = page.getByRole('region', { name: 'Not readable' });
      await bad.waitFor({ timeout: 5000 });
      assert.equal(await bad.locator('li').count(), 1);
      assert.match(await bad.innerText(), /broken\.txt/);
      assert.match(await bad.innerText(), /not readable as text/);
      await bad.getByRole('button', { name: /Remove broken\.txt/ }).waitFor();
      if (process.env.QA_SCREENSHOTS) await page.screenshot({ path: `${process.env.QA_SCREENSHOTS}/unreadable-586-${width}-${theme}.png`, fullPage: true });

      // A reply is grounded in the readable file only; the model never sees the unreadable one.
      env.requests.length = 0;
      const chat = await api('/api/chat', { spaceId: project.id, projectId: project.id, chatId: 'u586-' + Date.now(), message: 'What is the quarterly plan?', history: [] });
      assert.equal(chat.status, 200, chat.text);
      const events = chat.text.split('\n').filter(l => l.startsWith('data: ')).map(l => { try { return JSON.parse(l.slice(6)); } catch { return null; } }).filter(Boolean);
      const cited = events.filter(e => e.type === 'sources').flatMap(e => e.sources.map(s => s.file));
      assert.ok(cited.some(f => /notes\.txt$/.test(f)), 'the readable file is cited: ' + JSON.stringify(cited));
      assert.ok(!cited.some(f => /broken\.txt$/.test(f)), 'the unreadable file must never be cited: ' + JSON.stringify(cited));
      assert.ok(!JSON.stringify(env.requests).includes('broken.txt'), 'the unreadable file must not be offered to the model');

      // Remove works, and the section goes away.
      await bad.getByRole('button', { name: /Remove broken\.txt/ }).click();
      await page.getByRole('region', { name: 'Not readable' }).waitFor({ state: 'detached', timeout: 10000 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no sideways scroll at ' + width);
      await ctx.close(); await env.stop(); env = null;
    }
    assert.deepEqual(errors, []);
    console.log('PASS #586: an unreadable upload is listed under Not readable (with Remove), not under Text, not counted, not offered to the model and not cited; 375/768/1440, light and dark.');
  } finally { await browser.close(); if (env) await env.stop(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
