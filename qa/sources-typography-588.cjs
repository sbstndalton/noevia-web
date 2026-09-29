// #588: in Sources, the Skill review notice and the collapsible headings render at the panel's
// 12px caption size (not the 16px browser default), and an uploaded SKILL.md says it came from an
// upload, not "an attached folder". Real application server; fails on a build without the fix.
//
// Run: PLAYWRIGHT_MODULE=<playwright-core> [APP_DIR=<web dir of a built app>] [QA_SCREENSHOTS=<dir>] node qa/sources-typography-588.cjs
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
      env = await start({ port: 31588, name: 'typography588' });
      const { ctx, page } = await signedIn(browser, env, { width, theme, projectName: `Typography ${width} ${theme}` });
      page.on('pageerror', e => errors.push(e.message));
      await upload(page, [
        { name: 'SKILL.md', mimeType: 'text/markdown', buffer: Buffer.from('---\nname: synthetic-skill\ndescription: Synthetic skill for browser proof\n---\n\nDo the synthetic thing.\n') },
        { name: 'a.txt', mimeType: 'text/plain', buffer: Buffer.from('Synthetic note.') },
      ], 2);
      await page.getByText(/Some instruction files need review/).waitFor({ timeout: 15000 });
      const size = (locator) => locator.first().evaluate(el => getComputedStyle(el).fontSize);
      const reference = await size(page.locator('.project-sources > p.rail-empty'));
      assert.equal(reference, '12px', 'the panel copy is 12px');
      const targets = {
        'review notice': page.locator('.instruction-skills p[role=status]'),
        'skill summary': page.locator('.instruction-skill > summary'),
        'upload results summary': page.locator('summary').filter({ hasText: /Upload results/ }),
        'linked folders summary': page.locator('.project-linked-folders > summary'),
      };
      for (const [label, locator] of Object.entries(targets)) assert.equal(await size(locator), reference, `${label} must match the 12px panel text at ${width} ${theme}`);
      // An uploaded file is described as an upload, whatever the folder wording of older builds.
      await page.locator('.instruction-skill > summary').first().click();
      const origin = await page.locator('.skill-origin').first().innerText();
      assert.doesNotMatch(origin, /attached folder/i, origin);
      assert.match(origin, /upload/i, origin);
      if (process.env.QA_SCREENSHOTS) await page.screenshot({ path: `${process.env.QA_SCREENSHOTS}/typography-588-${width}-${theme}.png`, fullPage: true });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no sideways scroll at ' + width);
      await ctx.close(); await env.stop(); env = null;
    }
    assert.deepEqual(errors, []);
    console.log('PASS #588: notice and summaries are 12px like the panel copy, and an uploaded SKILL.md is described as an upload; 375/768/1440, light and dark.');
  } finally { await browser.close(); if (env) await env.stop(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
