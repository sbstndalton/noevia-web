// #1879: the Sources header count equals the readable rows of the list, a partial source included, and
// when a not-readable row exists a note says what the count leaves out. Real application server with a
// synthetic upstream; the workspace answer is edited in the browser to make one source partial (and one
// failed with no text) because a partial extraction needs a real large PDF. Synthetic data only.
//
// Run: PLAYWRIGHT_MODULE=<playwright-core> [APP_DIR=<web dir of a built app>] [QA_SCREENSHOTS=<dir>] node qa/sources-header-count-1879.cjs
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const { start, signedIn, upload } = require('./sources-panel-lib.cjs');

const text = (n) => ({ name: `note-${n}.txt`, mimeType: 'text/plain', buffer: Buffer.from(`Synthetic note number ${n}.`) });

(async () => {
  let env;
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const errors = [];
  try {
    for (const [width, theme] of [[2000, 'light'], [2000, 'dark'], [390, 'light'], [390, 'dark']]) {
      env = await start({ port: 31879, name: 'count1879' });
      const { ctx, page, project } = await signedIn(browser, env, { width, height: width > 1000 ? 1100 : 900, theme, projectName: `Count ${width} ${theme}` });
      page.on('pageerror', e => errors.push(e.message));
      await upload(page, [text(1), text(2), text(3)], 3);

      // Reload with the second note listed as a partial PDF read, the third as a failed read with no text.
      let mode = 'partial';
      await page.route('**/api/workspace*', async (route) => {
        const res = await route.fetch();
        const body = await res.json();
        for (const p of body.projects || []) {
          if (p.id !== project.id) continue;
          const f = p.files.find((x) => x.name === 'note-2.txt');
          if (f) f.document = { state: 'partial', pages: 9, stoppedAt: { page: 4, limit: 'pages' } };
          const g = p.files.find((x) => x.name === 'note-3.txt');
          if (g && mode === 'failed') { g.document = { state: 'failed', error: 'synthetic failure' }; g.chars = 0; delete g.attachment; }
        }
        await route.fulfill({ response: res, json: body });
      });
      const rows = () => page.locator('.project-sources .source-list:not(.upload-progress) > li').count();
      const tabCount = async () => Number(/\((\d+)\)/.exec(await page.getByRole('tab', { name: /Sources/ }).first().innerText())?.[1]);
      const open = async () => { await page.reload(); await page.getByRole('tab', { name: /Sources/ }).first().click(); await page.locator('.project-sources').waitFor(); };

      await open();
      assert.equal(await rows(), 3, 'three rows listed');
      assert.equal(await tabCount(), 3, 'the header equals the list with one source partial');
      assert.equal(await page.getByTestId('sources-count-note').count(), 0, 'no note when every row is counted');
      if (process.env.QA_SCREENSHOTS) await page.screenshot({ path: `${process.env.QA_SCREENSHOTS}/count-1879-partial-${width}-${theme}.png`, fullPage: true });

      mode = 'failed';
      await open();
      const readableRows = await page.locator('.project-sources section:not(.source-not-readable) .source-list > li').count();
      assert.equal(await tabCount(), readableRows, 'the header equals the readable rows');
      assert.equal(readableRows, 2);
      const note = await page.getByTestId('sources-count-note').innerText();
      assert.match(note, /2 sources/); assert.match(note, /1 more/);
      if (process.env.QA_SCREENSHOTS) await page.screenshot({ path: `${process.env.QA_SCREENSHOTS}/count-1879-note-${width}-${theme}.png`, fullPage: true });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no sideways scroll at ' + width);
      await ctx.close(); await env.stop(); env = null;
    }
    assert.deepEqual(errors, []);
    console.log('PASS #1879: the Sources header equals the readable rows with a partial source; the not-readable note states what is left out; 2000/390, light and dark.');
  } finally { await browser.close(); if (env) await env.stop(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
