// #1453 styling: the Diary 'Search loaded days' field is an app search field, not the browser's default box.
// It must use the same control tokens as the projects search (34px high, control border, surface fill, input
// radius), in both themes. Offline: the app is built from this checkout and every API is a synthetic stub.
//
// Fails on a build without the style, passes with it.
//   QA_DIST=<dist of the parent commit> PLAYWRIGHT_MODULE=<playwright-core> QA_CHROME_PATH=<Chrome> node qa/diary-loaded-search-style-1453.cjs
const os = require('node:os');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || `${os.homedir()}/noevia-local-test/node_modules/playwright-core`);
const assert = require('node:assert/strict');
const { createFixture } = require('./diary-fixture.cjs');

const PORT = Number(process.env.QA_PORT || 31453);

const user = { id: 'qa', username: 'admin', displayName: 'Synthetic', role: 'admin', onboarded: true, diaryEnabled: true };

// Resolve a design token to the colour the browser actually paints, so the check compares paint, not names.
const tokenColour = (page, token, prop) => page.evaluate(([t, p]) => {
  const probe = document.createElement('div');
  probe.style.setProperty(p, `var(${t})`);
  document.body.appendChild(probe);
  const colour = getComputedStyle(probe)[p === 'background' ? 'backgroundColor' : 'borderTopColor'];
  probe.remove();
  return colour;
}, [token, prop]);

(async () => {
  const fixture = createFixture(PORT);
  await fixture.listen();
  const browser = await chromium.launch({ headless: true, ...(process.env.QA_CHROME_PATH ? { executablePath: process.env.QA_CHROME_PATH } : { channel: 'chrome' }) });
  const failures = [];
  try {
    for (const theme of ['light', 'dark']) {
      const name = `#1453 the Diary loaded-days search is styled as an app search field (${theme})`;
      try {
        const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
        await ctx.addInitScript((t) => { try { localStorage.setItem('cowork-theme', t); } catch { /* ignore */ } }, theme);
        const page = await ctx.newPage();
        const json = (body) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
        await page.route('**/api/**', (route) => {
          const p = new URL(route.request().url()).pathname;
          if (p === '/api/setup/status') return route.fulfill(json({ configured: true, publicOrigin: `http://localhost:${PORT}` }));
          if (p === '/api/features') return route.fulfill(json({ flags: { previews: true } }));
          if (p === '/api/profile' || p === '/api/auth/session') return route.fulfill(json({ user, passkeys: [] }));
          return route.fallback();
        });
        await page.goto(`http://localhost:${PORT}/diary`, { waitUntil: 'domcontentloaded' });
        const input = page.locator('.diary-loaded-search input[type="search"]');
        await input.waitFor({ timeout: 20000 });
        const s = await input.evaluate((el) => {
          const cs = getComputedStyle(el);
          return { height: cs.height, borderTopStyle: cs.borderTopStyle, borderTopWidth: cs.borderTopWidth, borderRadius: cs.borderTopLeftRadius,
            backgroundColor: cs.backgroundColor, borderTopColor: cs.borderTopColor, color: cs.color, fontSize: cs.fontSize };
        });
        const want = {
          bg: await tokenColour(page, '--bg-surface', 'background'),
          border: await tokenColour(page, '--control-border', 'border-top-color'),
          radius: await page.evaluate(() => { const p = document.createElement('div'); p.style.borderRadius = 'var(--radius-input)'; document.body.appendChild(p); const r = getComputedStyle(p).borderTopLeftRadius; p.remove(); return r; }),
        };
        assert.equal(s.height, '34px', 'the field is the 34px control height');
        assert.equal(s.borderTopStyle, 'solid', 'the field has the app border, not the browser inset border');
        assert.equal(s.borderTopWidth, '1px');
        assert.equal(s.backgroundColor, want.bg, 'the fill is the surface token');
        assert.equal(s.borderTopColor, want.border, 'the border is the control-border token');
        assert.equal(s.borderRadius, want.radius, 'the corners are the input radius token');
        assert.equal(s.fontSize, (await page.evaluate(() => { const p = document.createElement('div'); p.style.fontSize = 'var(--text-footnote)'; document.body.appendChild(p); const r = getComputedStyle(p).fontSize; p.remove(); return r; })), 'the text is the footnote size');
        await ctx.close();
        console.log(`ok   ${name}`);
      } catch (e) {
        failures.push(name);
        console.log(`FAIL ${name}\n     ${String(e.message).split('\n').slice(0, 8).join('\n     ')}`);
      }
    }
  } finally {
    await browser.close();
    await fixture.close();
  }
  console.log(`\ndiary-loaded-search-style-1453: ${2 - failures.length}/2 passed`);
  if (failures.length) process.exitCode = 1;
})().catch((e) => { console.error(e); process.exitCode = 1; });
