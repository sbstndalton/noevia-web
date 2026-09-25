// Contact sheet for the theme-family screenshots (#313): one grid, rows = family × mode,
// columns = surface × width, so the three families can be told apart at a glance.
//   PLAYWRIGHT_MODULE=… node qa/families-contact-sheet.cjs <shots-dir> [out.png] [surfaces,comma,separated]
const os = require('node:os'), fs = require('node:fs'), path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || `${os.homedir()}/noevia-local-test/node_modules/playwright-core`);
const dir = path.resolve(process.argv[2] || '/tmp/families-shots');
const out = path.resolve(process.argv[3] || path.join(dir, 'contact-sheet.png'));
const surfaces = (process.argv[4] || 'home,chat,settings-appearance,sheet').split(',');
const rows = [];
for (const family of ['editorial', 'contemporary', 'glass']) for (const theme of ['light', 'dark']) {
  const cells = [];
  for (const surface of surfaces) for (const width of [1440, 375]) {
    const file = path.join(dir, `${family}-${theme}-${width}-${surface}.png`);
    cells.push(fs.existsSync(file) ? `<figure class="w${width}"><img src="data:image/png;base64,${fs.readFileSync(file).toString('base64')}"><figcaption>${surface} ${width}</figcaption></figure>` : `<figure class="w${width}"><figcaption>missing ${surface} ${width}</figcaption></figure>`);
  }
  rows.push(`<section><h2>${family} · ${theme}</h2><div class="row">${cells.join('')}</div></section>`);
}
const html = `<!doctype html><style>body{margin:0;padding:16px;background:#777;font:600 14px system-ui;color:#fff}
section{margin-bottom:14px}h2{margin:0 0 6px;font-size:18px}.row{display:flex;gap:8px;align-items:flex-start}
figure{margin:0}img{display:block;border-radius:4px}.w1440 img{height:230px}.w375 img{height:230px}figcaption{font-size:11px;opacity:.85}</style>${rows.join('')}`;
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 2400, height: 800 } });
  await page.setContent(html);
  await page.screenshot({ path: out, fullPage: true });
  await browser.close();
  console.log(`contact sheet: ${out}`);
})().catch((e) => { console.error(e); process.exitCode = 1; });
