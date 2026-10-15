// noevia#1794 (review of web#57, #1784/#1789):
//  1. The 'Stopped before the reply finished.' note under a stopped reply is static text saved with
//     the chat. role="status" made it a live region, so a screen reader could announce it again on
//     every load of the chat. It is now a plain note: no live region, the same text on screen.
//  2. The #1789 bottom fade over the transcript (while 'Jump to latest' shows) also faded the
//     transcript's own scrollbar. The fade now covers the content only; the scrollbar column paints
//     exactly what it paints with no fade at all.
//  (The committed qa-shots PNGs are covered by tests/client/qa-shots-ignored-1794.test.cjs.)
//
// 2000 and 390 px, light and dark. Offline: the app is built from this checkout and every API is a
// synthetic stub (diary-fixture.cjs).
//   PLAYWRIGHT_MODULE=<playwright-core> QA_DIST=<dist dir> [QA_SHOTS=<dir>] node qa/chat-followups-1794.cjs
// Fails on a build without the change, passes with it.
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || `${process.env.HOME}/noevia-local-test/node_modules/playwright-core`);
const { createFixture } = require('./diary-fixture.cjs');
const { withLocale } = require('./qa-locale.cjs');

const PORT = Number(process.env.QA_PORT || 31794);
const SHOTS = process.env.QA_SHOTS || '';
const NAME = 'chat-followups-1794';
const NOTE = 'Stopped before the reply finished.';
const longAnswer = 'Synthetic paragraph of answer text that runs across several lines so the reply is tall enough to scroll. '.repeat(6);
const longHistory = [];
for (let i = 0; i < 14; i++) {
  longHistory.push({ role: 'user', content: `Synthetic question ${i} about trains.` });
  longHistory.push({ role: 'assistant', content: `${longAnswer} ${i}`, model: 'Synthetic-Chat-Q4' });
}
const stoppedHistory = [
  { role: 'user', content: 'Synthetic question about the water cycle.' },
  { role: 'assistant', content: 'Water evaporates, condenses into clouds and', model: 'Synthetic-Chat-Q4', stopped: true },
];
const freeChats = [{ id: 'fc1794', title: 'Synthetic chat', updatedAt: 5000, archived: false, pinned: false }];

async function open(browser, { width, height, theme, history }) {
  const page = await browser.newPage(withLocale({ viewport: { width, height }, deviceScaleFactor: 1 }));
  await page.addInitScript((t) => { localStorage.setItem('cowork-theme', t); }, theme);
  await page.route('**/api/workspace', (r) => r.fulfill({ json: { projects: [], freeChats } }));
  await page.route('**/api/chats/*/history', (r) => r.fulfill({ json: { history, revision: 'r1' } }));
  await page.goto(`http://localhost:${PORT}/c/fc1794`);
  await page.locator('.transcript .msg').first().waitFor({ timeout: 20000 });
  return page;
}

async function decode(page, buf) {
  return page.evaluate(async (b64) => {
    const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    return Array.from(g.getImageData(0, 0, img.width, img.height).data);
  }, buf.toString('base64'));
}

(async () => {
  const fixture = createFixture(PORT);
  await fixture.listen();
  const browser = await chromium.launch({ headless: true, ignoreDefaultArgs: ['--hide-scrollbars'], ...(process.env.QA_CHROME_PATH ? { executablePath: process.env.QA_CHROME_PATH } : { channel: 'chrome' }) });
  const results = [];
  const check = async (name, fn) => {
    try { await fn(); results.push([name, null]); console.log(`PASS ${NAME}: ${name}`); }
    catch (e) { results.push([name, e]); console.log(`FAIL ${NAME}: ${name}\n  ${String(e.message).split('\n').slice(0, 8).join('\n  ')}`); }
  };
  const cases = [[2000, 1100, 'light'], [2000, 1100, 'dark'], [390, 844, 'light'], [390, 844, 'dark']];
  try {
    for (const [width, height, theme] of cases) {
      await check(`${width} px ${theme}: the saved Stopped note is shown but is not a live region`, async () => {
        const page = await open(browser, { width, height, theme, history: stoppedHistory });
        try {
          const note = page.getByTestId('reply-stopped');
          await note.waitFor({ timeout: 10000 });
          assert.equal((await note.innerText()).trim(), NOTE);
          const live = await note.evaluate((n) => {
            for (let el = n; el; el = el.parentElement) {
              const role = el.getAttribute('role'), aria = el.getAttribute('aria-live');
              if (['status', 'alert', 'log'].includes(role) || (aria && aria !== 'off')) return `${el.tagName.toLowerCase()} role=${role} aria-live=${aria}`;
            }
            return null;
          });
          assert.equal(live, null, `the note sits in a live region (${live}) and is announced again on load`);
          if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `1794-stopped-${width}-${theme}.png`) });
        } finally { await page.close(); }
      });

      await check(`${width} px ${theme}: the #1789 fade leaves the transcript's scrollbar alone`, async () => {
        const page = await open(browser, { width, height, theme, history: longHistory });
        try {
          // A classic scrollbar that takes its own column, as Windows and Linux draw it (macOS overlays
          // its scrollbar on the content, where no fade can tell them apart).
          await page.addStyleTag({ content: '.transcript { scroll-behavior: auto !important; scrollbar-color: auto !important; } .transcript::-webkit-scrollbar { width: 14px; background: rgb(150, 150, 150); } .transcript::-webkit-scrollbar-thumb { background: rgb(60, 60, 60); }' });
          await page.evaluate(() => { const t = document.querySelector('.transcript'); t.scrollTop = Math.max(0, t.scrollHeight - t.clientHeight - 260); });
          await page.locator('.jump-to-latest').waitFor({ timeout: 5000 });
          await page.waitForTimeout(250);
          const g = await page.evaluate(() => {
            const t = document.querySelector('.transcript'), r = t.getBoundingClientRect(), cs = getComputedStyle(t);
            const bl = parseFloat(cs.borderLeftWidth), br = parseFloat(cs.borderRightWidth);
            return { left: r.left, top: r.top, bottom: r.bottom, right: r.right - br, bar: t.offsetWidth - t.clientWidth - bl - br, mask: cs.maskImage || cs.webkitMaskImage };
          });
          assert.notEqual(g.mask, 'none', 'the fade is on while the pill shows');
          assert.ok(g.bar >= 8, `the transcript has a classic scrollbar to check (${g.bar} px)`);
          const clip = { x: Math.round(g.right - g.bar), y: Math.round(g.bottom - 24), width: Math.round(g.bar), height: 22 };
          const faded = await decode(page, await page.screenshot({ clip }));
          await page.addStyleTag({ content: '.transcript { -webkit-mask-image: none !important; mask-image: none !important; }' });
          await page.waitForTimeout(100);
          const plain = await decode(page, await page.screenshot({ clip }));
          let worst = 0;
          for (let i = 0; i < plain.length; i += 4) for (let k = 0; k < 3; k++) worst = Math.max(worst, Math.abs(plain[i + k] - faded[i + k]));
          if (SHOTS) {
            await page.addStyleTag({ content: '.transcript { -webkit-mask-image: revert-layer !important; mask-image: revert-layer !important; }' });
            await page.screenshot({ path: path.join(SHOTS, `1794-scrollbar-${width}-${theme}.png`) });
          }
          assert.ok(worst <= 6, `the scrollbar's bottom 24 px is faded (max pixel difference ${worst})`);
        } finally { await page.close(); }
      });
    }

    // Review of web#63: the width was measured only when the pill appeared or the box resized. A
    // scrollbar that appears or changes style afterwards (the box keeps its size) must be re-measured.
    for (const theme of ['light', 'dark']) {
      await check(`2000 px ${theme}: a scrollbar styled after the pill shows is re-measured and left unfaded`, async () => {
        const page = await open(browser, { width: 2000, height: 1100, theme, history: longHistory });
        try {
          await page.addStyleTag({ content: '.transcript { scroll-behavior: auto !important; }' });
          await page.evaluate(() => { const t = document.querySelector('.transcript'); t.scrollTop = Math.max(0, t.scrollHeight - t.clientHeight - 260); });
          await page.locator('.jump-to-latest').waitFor({ timeout: 5000 });
          await page.waitForTimeout(250);
          const before = await page.evaluate(() => document.querySelector('.transcript').style.getPropertyValue('--transcript-scrollbar-w'));
          await page.addStyleTag({ content: '.transcript { scrollbar-color: auto !important; } .transcript::-webkit-scrollbar { width: 14px; background: rgb(150, 150, 150); } .transcript::-webkit-scrollbar-thumb { background: rgb(60, 60, 60); }' });
          await page.waitForTimeout(300);
          const after = await page.evaluate(() => { const t = document.querySelector('.transcript'); return { w: t.style.getPropertyValue('--transcript-scrollbar-w'), bar: t.offsetWidth - t.clientWidth }; });
          assert.ok(after.bar >= 8, `a classic scrollbar is drawn (${after.bar})`);
          assert.equal(after.w, `${after.bar}px`, `the fade's scrollbar column follows the new scrollbar (was ${before}, now ${after.w})`);
        } finally { await page.close(); }
      });
    }

    await check('2000 px light: the text next to the pill is still faded (#1789 kept)', async () => {
      const page = await open(browser, { width: 2000, height: 1100, theme: 'light', history: longHistory });
      try {
        await page.evaluate(() => { const t = document.querySelector('.transcript'); t.scrollTop = Math.max(0, t.scrollHeight - t.clientHeight - 700); });
        await page.locator('.jump-to-latest').waitFor({ timeout: 5000 });
        const alpha = await page.evaluate(() => {
          const t = document.querySelector('.transcript'), r = t.getBoundingClientRect();
          const hit = document.elementFromPoint(r.left + r.width / 2, r.bottom - 4);
          return { mask: getComputedStyle(t).maskImage, inside: t.contains(hit) };
        });
        assert.match(alpha.mask, /linear-gradient/, `the content fade is still there (${alpha.mask})`);
      } finally { await page.close(); }
    });
  } finally {
    await browser.close();
    await fixture.close();
  }
  const failed = results.filter(([, e]) => e);
  console.log(`\n${NAME}: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exitCode = 1;
})().catch((e) => { console.error(e); process.exitCode = 1; });
