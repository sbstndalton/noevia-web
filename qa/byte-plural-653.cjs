// #653: a file under 1 KB was listed as "109 byte" (CLDR's short English byte has no plural). On the project's
// Sources tab, a 109-byte synthetic upload and a 1-byte one now read with the locale's own singular and plural.
//   en-GB "109 bytes" / "1 byte"; de-DE "109 Byte"; fr-FR "109 octets" / "1 octet"; a kilobyte-size file keeps "kB"/"ko".
//
// The real application server on synthetic data.
//
// Run: [APP_DIR=<web dir of a built app>] [QA_SCREENSHOTS=<dir>] node qa/byte-plural-653.cjs
const os = require('node:os');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || `${os.homedir()}/noevia-local-test/node_modules/playwright-core`);
const assert = require('node:assert/strict');
const { start, signedIn, upload } = require('./sources-panel-lib.cjs');

const CASES = [
  ['en-GB', /\b109 bytes\b/, /\b1 byte\b(?!s)/, /\b2 kB\b/],
  ['de-DE', /\b109 Byte\b/, /\b1 Byte\b/, /\b2 kB\b/],
  ['fr-FR', /\b109 octets\b/, /\b1 octet\b(?!s)/, /\b2 ko\b/],
];

(async () => {
  let env;
  const browser = await chromium.launch({ headless: true, channel: process.env.QA_CHANNEL || 'chrome' });
  const failures = [], errors = [];
  const shots = process.env.QA_SCREENSHOTS;
  const check = async (name, fn) => {
    try { await fn(); console.log(`ok   ${name}`); } catch (e) { failures.push(name); console.log(`FAIL ${name}\n     ${String(e.message).split('\n').slice(0, 30).join('\n     ')}`); }
  };
  try {
    env = await start({ port: 31653, name: 'bytes653' });
    const first = await signedIn(browser, env, { width: 1440, theme: 'light', projectName: 'Synthetic bytes' });
    const files = [
      { name: 'tiny-109.md', mimeType: 'text/markdown', buffer: Buffer.from('#'.repeat(109)) },
      { name: 'one.md', mimeType: 'text/markdown', buffer: Buffer.from('x') },
      { name: 'small-2k.md', mimeType: 'text/markdown', buffer: Buffer.from('y'.repeat(2048)) },
    ];
    await upload(first.page, files, 3);
    const storage = await first.ctx.storageState();
    const projectId = first.project.id;
    await first.ctx.close();

    for (const [width, theme] of [[1440, 'light'], [375, 'dark']]) {
      for (const [locale, many, one, kilo] of CASES) {
        const ctx = await browser.newContext({ locale, viewport: { width, height: 900 }, storageState: storage });
        await ctx.addInitScript((t) => localStorage.setItem('cowork-theme', t), theme);
        const page = await ctx.newPage();
        page.on('pageerror', (e) => errors.push(`${locale}: ${e.message}`));
        await check(`#653 ${locale} (${width} ${theme}): file sizes under 1 KB say bytes with the right plural`, async () => {
          await page.goto(`${env.origin}/p/${projectId}/sources`);
          await page.locator('.project-sources .source-list li').first().waitFor({ timeout: 20000 });
          const rows = (await page.locator('.project-sources .source-list li').allInnerTexts()).map((t) => t.replace(/\s/g, " ")).join('\n');
          assert.match(rows, many, `109 bytes: ${rows}`);
          assert.match(rows, one, `1 byte: ${rows}`);
          assert.match(rows, kilo, `2 KB keeps its symbol: ${rows}`);
          assert.doesNotMatch(rows, /\b109 byte\b(?!s)/, 'the English "109 byte" bug');
          if (shots && locale === 'en-GB') await page.screenshot({ path: `${shots}/bytes-${width}-${theme}.png` });
        });
        await ctx.close();
      }
    }
    assert.deepEqual(errors.filter((e) => !/ResizeObserver/.test(e)), [], 'page errors');
    if (failures.length) { console.log(`FAIL byte-plural-653: ${failures.length} check(s) failed`); process.exitCode = 1; }
    else console.log('PASS #653 sizes under 1 KB read with the locale\'s own byte plural (en-GB, de-DE, fr-FR).');
  } finally { await browser.close(); if (env) await env.stop(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
