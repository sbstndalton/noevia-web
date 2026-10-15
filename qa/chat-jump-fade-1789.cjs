// #1789 (after #1534): the "Jump to latest" band kept the pill out of the transcript's box, so the
// #1534 geometry check passed, but the transcript still cut its last visible line in half right above
// the pill. On screen that half line read as covered by the pill. Now, while the pill is shown, the
// bottom 24px of the transcript fades out (the Diary pattern, #1568): no text is drawn at full contrast
// against the edge next to the pill, and every line above the fade stays fully readable.
//
// The check is on rendered pixels, not boxes: for each width and theme the transcript is scrolled so a
// line of text straddles its bottom edge, the strip just above the edge is screenshotted, and its
// contrast range is measured. A hard-cut line has the full text contrast there; a faded one does not.
//
// Offline: the app is built from this checkout and every API is a synthetic stub (diary-fixture.cjs).
//   PLAYWRIGHT_MODULE=<playwright-core> QA_DIST=<dist dir> [QA_SHOTS=<dir>] node qa/chat-jump-fade-1789.cjs
// Fails on a build without the change, passes with it.
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || `${process.env.HOME}/noevia-local-test/node_modules/playwright-core`);
const assert = require('node:assert/strict');
const { createFixture } = require('./diary-fixture.cjs');
const { withLocale } = require('./qa-locale.cjs');

const PORT = Number(process.env.QA_PORT || 31789);
const SHOTS = process.env.QA_SHOTS || '';
const longAnswer = 'Synthetic paragraph of answer text that runs across several lines so the reply is tall enough to scroll. '.repeat(6);
const history = [];
for (let i = 0; i < 14; i++) {
  history.push({ role: 'user', content: `Synthetic question ${i} about trains.` });
  history.push({ role: 'assistant', content: `${longAnswer} ${i}`, model: 'Synthetic-Chat-Q4' });
}
const freeChats = [{ id: 'fc1789', title: 'Long chat', updatedAt: 5000, archived: false, pinned: false }];

async function openLong(browser, { width, height, theme }) {
  const page = await browser.newPage(withLocale({ viewport: { width, height } }));
  await page.addInitScript((t) => { localStorage.setItem('cowork-theme', t); }, theme);
  await page.route('**/api/workspace', (r) => r.fulfill({ json: { projects: [], freeChats } }));
  await page.route('**/api/chats/*/history', (r) => r.fulfill({ json: { history, revision: 'r1' } }));
  await page.goto(`http://localhost:${PORT}/c/fc1789`);
  await page.locator('.transcript .msg').first().waitFor({ timeout: 20000 });
  await page.evaluate(() => { const t = document.querySelector('.transcript'); t.scrollTop = Math.max(0, t.scrollHeight - t.clientHeight - 700); });
  await page.locator('.jump-to-latest').waitFor({ timeout: 5000 });
  await page.waitForTimeout(300);
  // Nudge the scroll until a line of answer text straddles the transcript's bottom edge, its middle
  // a few pixels below the edge, so the strip just above the edge holds the top half of that line.
  const placed = await page.evaluate(async () => {
    const t = document.querySelector('.transcript');
    const lineAcrossEdge = () => {
      const edge = t.getBoundingClientRect().bottom;
      for (const p of t.querySelectorAll('.msg[data-role=assistant] .bubble p')) {
        const range = document.createRange(); range.selectNodeContents(p);
        for (const r of range.getClientRects()) if (r.height > 8 && r.top < edge - 6 && r.top + r.height / 2 > edge - 2) return r;
      }
      return null;
    };
    for (let i = 0; i < 80 && !lineAcrossEdge(); i++) { t.scrollTop -= 1; await new Promise((r) => requestAnimationFrame(r)); }
    const line = lineAcrossEdge();
    return line ? { left: line.left, width: line.width } : null;
  });
  assert.ok(placed, 'a line of text straddles the transcript edge');
  await page.waitForTimeout(200);
  return { page, line: placed };
}

// Contrast range (max - min luminance, 0..255) of the strip just above the transcript's bottom edge,
// across the line's own width. Decoded in the page from a real screenshot.
async function stripContrast(page, line) {
  const box = await page.evaluate(() => {
    const t = document.querySelector('.transcript').getBoundingClientRect();
    const pill = document.querySelector('.jump-to-latest').getBoundingClientRect();
    return { edge: t.bottom, pillTop: pill.top };
  });
  const clip = { x: Math.round(line.left), y: Math.floor(box.edge) - 5, width: Math.max(40, Math.round(Math.min(line.width, 600))), height: 4 };
  const png = await page.screenshot({ clip });
  const range = await page.evaluate(async (b64) => {
    const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let lo = 255, hi = 0;
    for (let i = 0; i < d.length; i += 4) { const y = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; lo = Math.min(lo, y); hi = Math.max(hi, y); }
    return Math.round(hi - lo);
  }, png.toString('base64'));
  return { range, edge: box.edge, pillTop: box.pillTop };
}

// Full text contrast for comparison: the same width across a line well inside the transcript.
async function bodyContrast(page, line) {
  const y = await page.evaluate(() => {
    const t = document.querySelector('.transcript').getBoundingClientRect();
    for (const p of document.querySelectorAll('.msg[data-role=assistant] .bubble p')) {
      const range = document.createRange(); range.selectNodeContents(p);
      for (const r of range.getClientRects()) if (r.height > 8 && r.top > t.top + 40 && r.bottom < t.bottom - 80) return r.top + r.height / 2;
    }
    return null;
  });
  const png = await page.screenshot({ clip: { x: Math.round(line.left), y: Math.round(y) - 2, width: Math.max(40, Math.round(Math.min(line.width, 600))), height: 4 } });
  return page.evaluate(async (b64) => {
    const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let lo = 255, hi = 0;
    for (let i = 0; i < d.length; i += 4) { const v = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; lo = Math.min(lo, v); hi = Math.max(hi, v); }
    return Math.round(hi - lo);
  }, png.toString('base64'));
}

(async () => {
  const fixture = createFixture(PORT);
  await fixture.listen();
  const browser = await chromium.launch({ headless: true, ...(process.env.QA_CHROME_PATH ? { executablePath: process.env.QA_CHROME_PATH } : { channel: 'chrome' }) });
  const results = [];
  const check = async (name, fn) => {
    try { await fn(); results.push([name, null]); console.log(`PASS chat-jump-fade-1789: ${name}`); }
    catch (e) { results.push([name, e]); console.log(`FAIL chat-jump-fade-1789: ${name}\n  ${String(e.message).split('\n').slice(0, 8).join('\n  ')}`); }
  };
  const cases = [[2000, 1100, 'light'], [2000, 1100, 'dark'], [1462, 812, 'dark'], [390, 844, 'light'], [390, 844, 'dark']];
  try {
    for (const [width, height, theme] of cases) {
      await check(`#1789 ${width} px ${theme}: no text is drawn at full contrast against the edge next to the pill`, async () => {
        const { page, line } = await openLong(browser, { width, height, theme });
        const strip = await stripContrast(page, line);
        const body = await bodyContrast(page, line);
        if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `1789-jump-${width}-${theme}.png`) });
        assert.ok(body > 80, `answer text has full contrast inside the transcript (${body})`);
        assert.ok(strip.edge <= strip.pillTop, 'the transcript ends above the pill');
        assert.ok(strip.range < body * 0.35, `the line cut by the edge beside the pill is faded, not drawn at full contrast (edge strip ${strip.range}, text ${body})`);
        await page.close();
      });
    }

    await check('#1789 the fade goes with the pill: at the latest message the transcript is not faded', async () => {
      const { page } = await openLong(browser, { width: 2000, height: 1100, theme: 'light' });
      await page.locator('.jump-to-latest').click();
      await page.locator('.jump-to-latest').waitFor({ state: 'detached', timeout: 5000 });
      const mask = await page.evaluate(() => { const cs = getComputedStyle(document.querySelector('.transcript')); return cs.maskImage || cs.webkitMaskImage; });
      assert.equal(mask, 'none', `no mask without the pill (${mask})`);
      await page.close();
    });
  } finally {
    await browser.close();
    await fixture.close();
  }
  const failed = results.filter(([, e]) => e);
  console.log(`\nchat-jump-fade-1789: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exitCode = 1;
})().catch((e) => { console.error(e); process.exitCode = 1; });
