// #951 UI redo: one design system matching the Claude/ChatGPT reference. Synthetic APIs only
// (qa/diary-fixture.cjs plus page routes): no model, no inference, no real Diary, no live server.
//   npm run build && PLAYWRIGHT_MODULE=~/noevia-local-test/node_modules/playwright-core node qa/ui-redo-951.cjs
// QA_SHOTS=<dir> writes light/dark × desktop 1440×900 / phone 390×844 screenshots of the key
// screens and every theme family. QA_SHOTS_ONLY=1 skips the assertions (the "before" set on the
// old build). QA_VIDEO=<dir> records settings open/close, a menu, sidebar collapse and sending a
// message as video.
// The assertions pin the redo:
//   tokens   the surface ladder (backdrop, sidebar tile, main tile), no mint/green surfaces, a
//            saved Soft material mapping onto Editorial, Inter UI, 14px composer, 32px rows
//   tiles    8px gutter at the window edges and between tiles, the family's tile radius, the
//            inset ring drawn above content, content clipped to the corners, whole-pixel tile
//            boxes at 1x and 2x DPR, full-bleed on phones
//   motion   Settings springs in (fade + scale) and its exit finishes before it is removed; an
//            open menu reversed mid-flight never jumps; the switch knob springs with a light
//            bounce; the sidebar tile's width animates on collapse; reduced motion (system or
//            Settings) gives no spring
//   themes   all three families in light and dark, the logo right after the sidebar toggle,
//            Glass frosted and translucent over an accent wash
const os = require('node:os');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || `${os.homedir()}/noevia-local-test/node_modules/playwright-core`);
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { createFixture } = require('./diary-fixture.cjs');
const { openSettings } = require('./nav.cjs');
const PORT = 31951;
const shots = process.env.QA_SHOTS || '';
const video = process.env.QA_VIDEO || '';
const shotsOnly = process.env.QA_SHOTS_ONLY === '1';

const user = { id: 'synthetic-ui-951', username: 'uiqa', displayName: 'UI QA', role: 'member', diaryEnabled: true, onboarded: true };
const chat = (id, title) => ({ id, title, updatedAt: 1000, pinned: false, messages: [] });
const project = { id: 'p1', name: 'Synthetic research', goal: 'A synthetic project for the redo screenshots.', instructions: '', memories: [], modes: ['chat'], updatedAt: 1000, files: [], assets: [], chats: [chat('pc1', 'Synthetic project chat')], toolboxes: ['core'] };

async function routes(page, theme) {
  await page.route('**/api/profile', (r) => r.fulfill({ json: { user, passkeys: [] } }));
  await page.route('**/api/auth/session', (r) => r.fulfill({ json: { user, passkeys: [] } }));
  await page.route('**/api/profile/appearance', (r) => r.fulfill({ json: { theme, light: 'iris', dark: 'iris' } }));
  await page.route('**/api/workspace', (r) => r.fulfill({ json: { projects: [project], freeChats: [chat('c1', 'Synthetic trip plan'), chat('c2', 'A synthetic chat with a much longer title that has to truncate'), chat('c3', 'Synthetic notes')] } }));
  await page.route('**/api/chats/*/history', (r) => r.fulfill({ json: { revision: 'r1', history: [
    { role: 'user', content: 'Summarise the synthetic notes in three points.' },
    { role: 'assistant', content: '## Summary\n\n1. **Scope** — the synthetic fixture covers the redo.\n2. **Motion** — short and decelerating.\n3. **Depth** — layered surfaces, not borders.\n\n```js\nconst page = "rgb(21, 21, 21)";\n```' },
  ] } }));
}

const MINT = (rgb) => { const m = rgb.match(/\d+(\.\d+)?/g); if (!m) return false; const [r, g, b] = m.map(Number); return g > r + 6 && g > b + 2; };

/** Samples fn(el) every animation frame for ms, in the page, while action runs. */
async function sample(page, selector, ms, action, read) {
  const run = page.evaluate(({ selector, ms, read }) => new Promise((resolve) => {
    const out = [], start = performance.now(), f = new Function('e', read);
    const tick = () => {
      const e = document.querySelector(selector);
      out.push(e ? f(e) : null);
      if (performance.now() - start < ms) requestAnimationFrame(tick); else resolve(out);
    };
    requestAnimationFrame(tick);
  }), { selector, ms, read });
  if (action) await action();
  return run;
}
const scaleOf = 'const m = getComputedStyle(e).transform; if (m === "none") return { s: 1, o: Number(getComputedStyle(e).opacity) }; const v = m.match(/matrix\\(([^)]+)\\)/)[1].split(",").map(Number); return { s: v[0], x: v[4], o: Number(getComputedStyle(e).opacity) };';

(async () => {
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const fixture = createFixture(PORT); await fixture.listen();
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const errors = [];
  let checks = 0;
  const ok = (cond, msg) => { if (shotsOnly) return; assert.ok(cond, msg); checks++; };
  const eq = (a, b, msg) => { if (shotsOnly) return; assert.equal(a, b, msg); checks++; };
  try {
    if (video) {
      // Screen capture: settings open/close, a menu, sidebar collapse, sending a message.
      fs.mkdirSync(video, { recursive: true });
      // A frame sequence from the DevTools screencast (no Playwright ffmpeg needed), plus an
      // ffmpeg concat list with each frame's real duration: ffmpeg -f concat -i frames.txt out.mp4
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'en-GB' });
      const page = await ctx.newPage();
      const cdp = await ctx.newCDPSession(page);
      const frames = [];
      cdp.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
        const file = `frame-${String(frames.length).padStart(5, '0')}.jpg`;
        fs.writeFileSync(path.join(video, file), Buffer.from(data, 'base64'));
        frames.push({ file, t: metadata.timestamp });
        await cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
      });
      await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 70, everyNthFrame: 1 });
      await page.addInitScript(() => localStorage.setItem('cowork-theme', 'dark'));
      await routes(page, 'dark');
      await page.route('**/api/chat', (r) => r.fulfill({ status: 200, headers: { 'Content-Type': 'text/event-stream' }, body: 'data: {"type":"token","text":"A synthetic reply."}\n\ndata: {"type":"done"}\n\n' }));
      await page.goto(`http://localhost:${PORT}/`);
      await page.getByPlaceholder('Message noevia…').waitFor();
      await page.waitForTimeout(600);
      await openSettings(page); await page.waitForTimeout(900);
      await page.keyboard.press('Escape'); await page.waitForTimeout(900);
      await page.getByRole('button', { name: 'Add files and tools' }).click(); await page.waitForTimeout(700);
      await page.keyboard.press('Escape'); await page.waitForTimeout(500);
      await page.locator('.app .sidebar .side-expand').click(); await page.waitForTimeout(900);
      await page.locator('.app .sidebar .side-expand').click(); await page.waitForTimeout(900);
      await page.getByText('Synthetic trip plan', { exact: true }).first().click(); await page.waitForTimeout(600);
      await page.getByPlaceholder('Message noevia…').fill('A synthetic follow-up.');
      await page.keyboard.press('Enter'); await page.waitForTimeout(1500);
      await cdp.send('Page.stopScreencast');
      fs.writeFileSync(path.join(video, 'frames.txt'), frames.map((f, i) => `file '${f.file}'\nduration ${Math.max(0.001, ((frames[i + 1]?.t ?? f.t + 0.033) - f.t)).toFixed(4)}`).join('\n') + `\nfile '${frames.at(-1).file}'\n`);
      await ctx.close();
      console.log(JSON.stringify({ video }));
      return;
    }

    for (const theme of ['dark', 'light']) for (const [form, viewport] of [['desktop', { width: 1440, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
      const phone = form === 'phone';
      const ctx = await browser.newContext({ viewport, hasTouch: phone, isMobile: phone, locale: 'en-GB', reducedMotion: 'no-preference' });
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(`${theme} ${form} ${page.url()}: ${e.message}`));
      await page.addInitScript((t) => { if (!sessionStorage.getItem('qa-init')) { localStorage.setItem('cowork-theme', t); localStorage.setItem('noevia:material', 'soft'); sessionStorage.setItem('qa-init', '1'); } }, theme);
      await routes(page, theme);
      const shot = async (name) => { if (shots) { await page.waitForTimeout(350); await page.screenshot({ path: path.join(shots, `${name}-${theme}-${form}.png`) }); } };
      await page.goto(`http://localhost:${PORT}/`);
      await page.getByPlaceholder('Message noevia…').waitFor();
      await page.evaluate(() => document.fonts.ready);

      // Tokens: the surface ladder, text, and no mint/green tints.
      const ground = await page.evaluate(() => {
        const bg = (s) => { const e = document.querySelector(s); return e ? getComputedStyle(e).backgroundColor : null; };
        return { app: bg('.app'), side: bg('.app .sidebar'), main: bg('.app .app-stack'), bodyImage: getComputedStyle(document.body).backgroundImage,
          text: getComputedStyle(document.body).color, family: document.documentElement.dataset.family || null,
          composer: bg('.composer-inner'),
          composerRadius: (() => { const e = document.querySelector('.composer-inner'); return e ? getComputedStyle(e).borderTopLeftRadius : null; })(),
          font: getComputedStyle(document.body).fontFamily };
      });
      if (!phone && theme === 'dark') {
        eq(ground.app, 'rgb(15, 15, 15)', 'dark backdrop is one step under the tiles');
        eq(ground.side, 'rgb(21, 21, 21)', 'dark sidebar tile rgb(21,21,21)');
        eq(ground.main, 'rgb(26, 26, 25)', 'dark main tile is the top surface rgb(26,26,25)');
        eq(ground.text, 'rgb(240, 239, 236)', 'dark primary text');
      }
      if (!phone && theme === 'light') {
        eq(ground.main, 'rgb(250, 249, 245)', 'light main tile hsl(48 33.3% 97.1%)');
        eq(ground.side, 'rgb(245, 244, 237)', 'light sidebar tile bg-200');
        eq(ground.app, 'rgb(240, 238, 230)', 'light backdrop slightly deeper');
      }
      eq(ground.bodyImage, 'none', 'no atmosphere gradient behind the app');
      eq(ground.family, 'editorial', 'a saved Soft material maps onto Editorial, the reference default');
      for (const s of [ground.app, ground.side, ground.main, ground.composer].filter(Boolean)) ok(!MINT(s), `no mint/green surface tint: ${s}`);
      eq(ground.composerRadius, '12px', 'composer radius 12px (#956)');
      ok(/Inter/.test(ground.font), `UI face is Inter: ${ground.font}`);

      // Tiles on desktop, full-bleed on a phone.
      const tiles = await page.evaluate(() => {
        const side = document.querySelector('.app .sidebar').getBoundingClientRect(), main = document.querySelector('.app .app-stack'), m = main.getBoundingClientRect();
        const ring = getComputedStyle(main, '::after');
        // A point just inside the rounded bottom-left corner must not hit the tile's content.
        const corner = document.elementFromPoint(m.left + 1, m.bottom - 1);
        return { sideL: side.left, sideT: side.top, gap: m.left - side.right, mainR: innerWidth - m.right, mainB: innerHeight - m.bottom,
          radius: getComputedStyle(main).borderTopLeftRadius, ring: ring.boxShadow, ringZ: ring.zIndex, overflow: getComputedStyle(main).overflow,
          cornerInside: !!corner && main.contains(corner), whole: [side.left, side.top, side.width, m.left, m.width, m.height].every((v) => Number.isInteger(v)) };
      });
      if (!phone) {
        eq(tiles.sideL, 8, 'gutter at the window edge (left)'); eq(tiles.sideT, 8, 'gutter at the window edge (top)');
        eq(tiles.gap, 8, 'gutter between tiles'); eq(tiles.mainR, 8, 'gutter at the right edge'); eq(tiles.mainB, 8, 'gutter at the bottom edge');
        eq(tiles.radius, '12px', 'Editorial tile radius 12px');
        ok(/inset/.test(tiles.ring) && /1px/.test(tiles.ring), `tile ring is an inset 1px line: ${tiles.ring}`);
        ok(Number(tiles.ringZ) >= 1, 'the ring is drawn above the tile content');
        eq(tiles.overflow, 'hidden', 'tile clips its content');
        eq(tiles.cornerInside, false, 'content is clipped to the rounded corner');
        ok(tiles.whole, 'tile boxes sit on whole pixels');
      } else {
        eq(tiles.radius, '0px', 'phone: main view is full-bleed');
      }
      await shot('home');

      if (!phone) {
        // Sidebar rows: 32px, radius 8px, 60ms easeOutQuart hover.
        const row = await page.locator('.app .sidebar .side-nav .nav-item').first().evaluate((e) => { const s = getComputedStyle(e); return { h: e.getBoundingClientRect().height, r: s.borderTopLeftRadius, d: s.transitionDuration, f: s.transitionTimingFunction }; });
        eq(row.h, 32, 'sidebar row is 32px tall'); eq(row.r, '8px', 'sidebar row radius 8px');
        ok(/0\.06s/.test(row.d), `row hover 60ms: ${row.d}`); ok(/cubic-bezier\(0\.165, 0\.84, 0\.44, 1\)/.test(row.f), `row hover easeOutQuart: ${row.f}`);
        // Sidebar collapse: the tile's width springs (intermediate widths), the gutter stays.
        const widths = await sample(page, '.app .sidebar', 500, () => page.locator('.app .sidebar .side-expand').click(), 'return e.getBoundingClientRect().width;');
        const mid = widths.filter((w) => w > 62 && w < 262);
        const steps = widths.slice(1).map((w, i) => w - widths[i]);
        ok(mid.length >= 1, `sidebar width animates on collapse (an intermediate frame): ${widths.slice(0, 12).map(Math.round).join(',')}`);
        ok(steps.every((d) => d <= 0.5), `sidebar collapse progresses one way, never back: ${steps.slice(0, 12).map((d) => d.toFixed(1)).join(',')}`);
        const collapsed = await page.evaluate(() => { const s = document.querySelector('.app .sidebar').getBoundingClientRect(), m = document.querySelector('.app .app-stack'); return { gap: m.getBoundingClientRect().left - s.right, radius: getComputedStyle(m).borderTopLeftRadius }; });
        eq(collapsed.gap, 8, 'collapsed: gutter kept'); eq(collapsed.radius, '12px', 'collapsed: main keeps its radius');
        await page.locator('.app .sidebar .side-expand').click();
        await page.waitForTimeout(500);
      }

      // Chat transcript.
      if (phone) await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
      await page.getByText('Synthetic trip plan', { exact: true }).first().click();
      await page.getByText('short and decelerating').waitFor();
      await shot('chat');

      if (!phone) {
        // A menu reversed mid-flight continues from where it is: no frame-to-frame jump.
        const frames = await sample(page, '.composer-actions-panel', 400, async () => {
          await page.getByRole('button', { name: 'Add files and tools' }).click();
          await page.waitForTimeout(45);
          await page.evaluate(() => window.noeviaMotion.exit(document.querySelector('.composer-actions-panel'), 'menu'));
        }, scaleOf);
        const seen = frames.filter(Boolean);
        const jumps = seen.slice(1).map((f, i) => Math.abs(f.s - seen[i].s));
        ok(seen.some((f) => f.s < 1 && f.s > 0.97), `menu scales from .97: ${seen.slice(0, 6).map((f) => f.s.toFixed(3)).join(',')}`);
        // A slow CI may drop frames; a 30ms frame of a ~140ms spring moves at most ~.02.
        ok(Math.max(0, ...jumps) < 0.025, `reversing a menu mid-flight never jumps (max step ${Math.max(0, ...jumps).toFixed(4)})`);
        await page.keyboard.press('Escape');
        await page.mouse.click(700, 120);
      }

      // Settings: a window over the dimmed app (full-screen sheet on a phone), springing in.
      const opening = await sample(page, '.settings-stage:not(.view-loading)', 700, () => openSettings(page), scaleOf);
      const stage = page.locator('.settings-stage:not(.view-loading)');
      await stage.waitFor();
      await page.waitForTimeout(300);
      const modal = await page.evaluate(() => {
        const e = document.querySelector('.settings-stage'), s = getComputedStyle(e), r = e.getBoundingClientRect();
        const nav = getComputedStyle(document.querySelector('.settings-stage .settings-navigation'));
        const scrim = document.querySelector('.settings-scrim');
        return { radius: s.borderTopLeftRadius, transform: s.transform, opacity: s.opacity,
          bg: s.backgroundColor, navBg: nav.backgroundColor, navW: document.querySelector('.settings-stage .settings-navigation').getBoundingClientRect().width,
          x: r.left, w: r.width, vw: innerWidth, scrim: scrim ? getComputedStyle(scrim).backgroundColor : null,
          appVisible: getComputedStyle(document.querySelector('.app-main')).visibility };
      });
      if (!phone) {
        const seen = opening.filter(Boolean);
        eq(modal.radius, '12px', 'settings window radius 12px');
        ok(modal.x > 0 && modal.w < modal.vw, `settings is a window, not the full app: ${modal.x} ${modal.w}`);
        eq(modal.scrim, 'rgba(0, 0, 0, 0.5)', 'scrim dims the app at 50% black');
        eq(modal.appVisible, 'visible', 'the app stays visible behind the window');
        ok(seen.some((f) => f.s < 0.999 && f.s >= 0.979) || seen.some((f) => f.o < 0.95), `settings springs in from scale .98 with a fade: ${seen.slice(0, 5).map((f) => `${f.s.toFixed(3)}/${f.o.toFixed(2)}`).join(' ')}`);
        ok(seen.every((f) => f.s <= 1.001), 'the window does not overshoot (critically damped)');
        ok(modal.transform === 'none' || /matrix\(1, 0, 0, 1, 0, 0\)/.test(modal.transform), `settings settles at scale 1: ${modal.transform}`);
        eq(Math.round(modal.navW), 192, 'settings nav 192px');
        ok(modal.navBg !== modal.bg, 'settings nav is darker than the content');
        if (theme === 'dark') { eq(modal.bg, 'rgb(26, 26, 25)', 'dialog surface rgb(26,26,25)'); eq(modal.navBg, 'rgb(21, 21, 21)', 'settings nav rgb(21,21,21)'); }
      }
      // A real modal: dialog semantics, the app behind is inert, and Tab never leaves the window.
      const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
      eq(await dialog.getAttribute('aria-modal'), 'true', 'Settings is aria-modal');
      eq(await page.evaluate(() => [...document.querySelectorAll('.app-main, .app .sidebar')].every((e) => e.inert)), true, 'the app behind Settings is inert');
      for (let i = 0; i < 40; i++) await page.keyboard.press(i % 3 === 2 ? 'Shift+Tab' : 'Tab');
      eq(await page.evaluate(() => !!document.activeElement?.closest('.settings-stage')), true, 'Tab and Shift+Tab keep focus inside Settings');
      if (phone) { const back = page.getByRole('button', { name: 'All settings', exact: true }); if (await back.isVisible()) await back.click(); }
      await page.locator('.settings-navigation').getByRole('button', { name: 'Appearance & language', exact: true }).click();
      await page.locator('.settings-detail-scroll').waitFor();
      eq((await page.getByRole('radiogroup', { name: 'Theme family' }).locator('.family-tile-name').allTextContents()).join(','), 'Editorial,Contemporary,Glass', 'the three theme families stay in Appearance');
      await shot('settings');
      // The switch contract (class + aria-checked): the knob springs 16px with a light bounce.
      await page.evaluate(() => {
        const b = document.createElement('button'); b.className = 'glass-switch qa-switch'; b.setAttribute('role', 'switch'); b.setAttribute('aria-checked', 'false');
        const k = document.createElement('span'); k.className = 'knob glass'; b.append(k); document.querySelector('.settings-detail-scroll').append(b);
      });
      const knob = await sample(page, '.qa-switch .knob', 450, () => page.evaluate(() => document.querySelector('.qa-switch').setAttribute('aria-checked', 'true')), scaleOf);
      const box = await page.evaluate(() => { const t = getComputedStyle(document.querySelector('.qa-switch')); const out = `${t.width}x${t.height}`; document.querySelector('.qa-switch').remove(); return out; });
      const xs = knob.filter(Boolean).map((f) => f.x ?? 0);
      eq(box, '36pxx20px', 'switch track 36×20');
      ok(Math.abs(xs.at(-1) - 16) < 0.5, `checked knob travels 16px: ${xs.at(-1)}`);
      if (!phone) ok(Math.max(...xs) > 16.05, `the knob springs with a light bounce (peak ${Math.max(...xs).toFixed(2)}px; ${xs.slice(0, 14).map((x) => x.toFixed(1)).join(",")})`);
      // A press spring hands the button back to CSS: no inline transform or opacity remains.
      const pressed = page.locator('.settings-stage .settings-search-empty button, .settings-stage .btn, .settings-stage .popup-tab').first();
      if (!phone && await pressed.count()) {
        const b = await pressed.boundingBox();
        await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down(); await page.waitForTimeout(120); await page.mouse.up();
        await page.mouse.move(5, 5); await page.waitForTimeout(700);
        eq(await pressed.evaluate((e) => `${e.style.transform}|${e.style.opacity}`), '|', 'no inline transform or opacity left after a press');
      }
      // Exit: the window finishes its spring out before it is removed.
      const closing = await sample(page, '.settings-stage', 700, () => page.keyboard.press('Escape'), scaleOf);
      const beforeRemoval = closing.filter(Boolean).at(-1);
      if (!phone) ok(beforeRemoval && beforeRemoval.o < 0.5, `settings exit completes before removal (last frame opacity ${beforeRemoval?.o.toFixed(2)}, scale ${beforeRemoval?.s.toFixed(3)})`);
      await page.locator('.settings-stage').waitFor({ state: 'detached' });
      if (!phone) eq(await page.evaluate(() => [...document.querySelectorAll('.app-main, .app .sidebar')].some((e) => e.inert)), false, 'the app is interactive again after close');
      if (!phone) ok(await page.evaluate(() => !!document.activeElement && document.activeElement !== document.body && !document.activeElement.closest('.settings-stage')), 'focus returns to the app (the opener) after close');

      // Reopening during the exit keeps the new Settings open (the old exit must not close it).
      await openSettings(page);
      await page.locator('.settings-stage:not(.view-loading)').waitFor();
      await page.waitForTimeout(300);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(50);
      await openSettings(page);
      await page.waitForTimeout(600);
      eq(await page.locator('.settings-stage:not(.is-closing)').count(), 1, 'a Settings reopened mid-exit stays open');
      await page.keyboard.press('Escape');
      await page.locator('.settings-stage').waitFor({ state: 'detached' });

      await page.goto(`http://localhost:${PORT}/projects`);
      await page.waitForTimeout(800);
      await shot('projects');
      await page.goto(`http://localhost:${PORT}/p/p1`);
      await page.waitForTimeout(500);
      await shot('project');
      await page.goto(`http://localhost:${PORT}/customize/connectors`);
      await page.waitForTimeout(700);
      await shot('customize');
      await page.goto(`http://localhost:${PORT}/diary`);
      await page.waitForTimeout(900);
      await shot('diary');

      // Deep link: /settings/<section> opens Settings on that section; Back and Forward walk the
      // sections; Escape closes (the phone sheet too) and leaves the address.
      await page.goto(`http://localhost:${PORT}/settings/appearance`);
      await page.locator('.settings-stage:not(.view-loading)').waitFor();
      if (phone) { const back = page.getByRole('button', { name: 'All settings', exact: true }); if (await back.isVisible()) { await back.click(); } }
      eq(await page.locator('.settings-navigation [aria-current="page"]').textContent(), 'Appearance & language', 'the deep link selects Appearance');
      await page.locator('.settings-navigation').getByRole('button', { name: 'Keyboard & input', exact: true }).click();
      await page.waitForURL(/\/settings\/keyboard/);
      await page.goBack(); await page.waitForURL(/\/settings\/appearance/);
      if (phone) { const back = page.getByRole('button', { name: 'All settings', exact: true }); if (await back.isVisible()) await back.click(); }
      eq(await page.locator('.settings-navigation [aria-current="page"]').textContent(), 'Appearance & language', 'Back returns to Appearance');
      await page.goForward(); await page.waitForURL(/\/settings\/keyboard/);
      ok(true, 'Forward returns to Keyboard');
      await page.keyboard.press('Escape');
      await page.locator('.settings-stage').waitFor({ state: 'detached' });
      ok(!/\/settings/.test(new URL(page.url()).pathname), `Escape closes Settings and leaves its address: ${page.url()}`);
      await page.goto(`http://localhost:${PORT}/settings/appearance`);
      await page.locator('.settings-stage:not(.view-loading)').waitFor();
      // Reduced motion from Settings: closing is a short fade, no spring scale.
      await page.waitForTimeout(400);
      await page.evaluate(() => { document.documentElement.dataset.motion = 'reduced'; });
      const reducedClose = await sample(page, '.settings-stage', 400, () => page.keyboard.press('Escape'), scaleOf);
      ok(reducedClose.filter(Boolean).every((f) => Math.abs(f.s - 1) < 0.001), 'Settings → Motion: Reduced gives no spring');
      await ctx.close();
    }

    // Every theme family, light and dark: screenshots, tiles and each family's signature.
    for (const family of ['editorial', 'contemporary', 'glass']) for (const theme of ['light', 'dark']) for (const dpr of [1, 2]) {
      if (dpr === 2 && theme === 'light') continue;
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: dpr, locale: 'en-GB' });
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(`${family} ${theme}: ${e.message}`));
      await page.addInitScript(({ t, f }) => { localStorage.setItem('cowork-theme', t); localStorage.setItem('noevia:theme-family', f); }, { t: theme, f: family });
      await routes(page, theme);
      await page.goto(`http://localhost:${PORT}/`);
      await page.getByPlaceholder('Message noevia…').waitFor();
      await page.evaluate(() => document.fonts.ready);
      const look = await page.evaluate(() => {
        const c = document.querySelector('.composer-inner'), side = document.querySelector('.app .sidebar'), main = document.querySelector('.app .app-stack');
        const r = main.getBoundingClientRect(), s = side.getBoundingClientRect();
        return { family: document.documentElement.dataset.family, radius: getComputedStyle(c).borderTopLeftRadius, side: getComputedStyle(side).backdropFilter,
          tile: getComputedStyle(main).borderTopLeftRadius, gap: r.left - s.right, transform: getComputedStyle(main).transform,
          whole: [r.left, r.top, r.width, r.height, s.width].every((v) => Number.isInteger(v * devicePixelRatio)),
          body: getComputedStyle(document.body).backgroundColor, h1: getComputedStyle(document.querySelector('.chat-workspace .empty-state h1')).fontFamily };
      });
      eq(look.family, family, `${family} applied`);
      eq(look.gap, 8, `${family} ${theme}: 8px gutter`);
      eq(look.tile, { editorial: '12px', contemporary: '16px', glass: '20px' }[family], `${family} tile radius`);
      eq(look.transform, 'none', `${family} ${theme} @${dpr}x: no transform on the tile`);
      ok(look.whole, `${family} ${theme} @${dpr}x: tile edges on device pixels`);
      const head = await page.evaluate(() => { const t = document.querySelector('.app .sidebar .side-expand').getBoundingClientRect(), l = document.querySelector('.app .sidebar .side-logo').getBoundingClientRect(); return { gap: l.left - t.right }; });
      ok(head.gap >= 0 && head.gap <= 12, `${family} ${theme}: logo follows the toggle (gap ${head.gap}px)`);
      if (family === 'glass') {
        const pane = await page.evaluate(() => { const s = getComputedStyle(document.querySelector('.composer-inner')); return { bg: s.backgroundColor, filter: s.backdropFilter, html: getComputedStyle(document.documentElement).backgroundImage }; });
        ok(/\/ 0\.\d+\)|rgba\([^)]*, 0\.\d+\)/.test(pane.bg), `glass ${theme} composer is translucent: ${pane.bg}`);
        ok(/blur\(24px\) saturate\(1\.8\)/.test(pane.filter), `glass ${theme} composer blurs and saturates: ${pane.filter}`);
        ok(/radial-gradient/.test(pane.html), `glass ${theme} has an accent wash`);
        ok(/blur\(/.test(look.side), `glass sidebar is frosted: ${look.side}`);
      }
      ok(!MINT(look.body), `${family} ${theme}: no mint page`);
      if (family === 'editorial') { eq(look.radius, '12px', 'editorial composer 12px'); ok(/Source Serif/.test(look.h1), 'editorial serif greeting'); }
      if (family === 'contemporary') { eq(look.radius, '24px', 'contemporary composer 24px'); ok(/Inter/.test(look.h1), 'contemporary sans greeting'); }
      const tag = dpr === 2 ? '@2x' : '';
      if (shots) { await page.waitForTimeout(300); await page.screenshot({ path: path.join(shots, `theme-${family}-${theme}-home${tag}.png`) }); }
      if (dpr === 1) {
        await page.getByText('Synthetic trip plan', { exact: true }).first().click();
        await page.getByText('short and decelerating').waitFor();
        if (shots) { await page.waitForTimeout(300); await page.screenshot({ path: path.join(shots, `theme-${family}-${theme}-chat.png`) }); }
        await page.goto(`http://localhost:${PORT}/settings/appearance`);
        await page.locator('.settings-stage:not(.view-loading)').waitFor();
        await page.locator('.family-tile').first().waitFor();
        if (shots) { await page.waitForTimeout(500); await page.screenshot({ path: path.join(shots, `theme-${family}-${theme}-settings.png`) }); }
      }
      await ctx.close();
    }

    // Settings sits over the whole app in every family (#951 review): the scrim covers the sidebar
    // and the window is centred in the viewport, not trapped in the main tile.
    for (const family of ['editorial', 'contemporary', 'glass']) for (const vp of [{ width: 1440, height: 900 }, { width: 1280, height: 800 }]) for (const theme of ['light', 'dark']) {
      const ctx = await browser.newContext({ viewport: vp, locale: 'en-GB' });
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(`${family} settings: ${e.message}`));
      await page.addInitScript(({ t, f }) => { localStorage.setItem('cowork-theme', t); localStorage.setItem('noevia:theme-family', f); }, { t: theme, f: family });
      await routes(page, theme);
      await page.goto(`http://localhost:${PORT}/`);
      await page.getByPlaceholder('Message noevia…').waitFor();
      await openSettings(page);
      await page.locator('.settings-stage:not(.view-loading)').waitFor();
      await page.waitForTimeout(500);
      const cover = await page.evaluate(() => {
        const side = document.querySelector('.app .sidebar').getBoundingClientRect();
        const hit = document.elementFromPoint(side.left + 20, side.top + side.height / 2);
        const r = document.querySelector('.settings-stage').getBoundingClientRect();
        const w = Math.min(1024, innerWidth - 64), h = Math.min(800, innerHeight - 64);
        return { hit: hit?.className?.toString() || hit?.tagName, sidebarExpanded: !document.querySelector('.app .sidebar').classList.contains('is-collapsed'),
          dx: Math.abs(r.left - (innerWidth - w) / 2), dy: Math.abs(r.top - (innerHeight - h) / 2), dw: Math.abs(r.width - w), dh: Math.abs(r.height - h),
          bg: getComputedStyle(document.querySelector('.settings-stage')).backgroundColor };
      });
      const tag = `${family} ${theme} ${vp.width}×${vp.height}`;
      ok(cover.sidebarExpanded, `${tag}: sidebar expanded`);
      ok(/settings-scrim/.test(cover.hit), `${tag}: the scrim covers the sidebar (hit ${cover.hit})`);
      ok(cover.dx < 1 && cover.dy < 1 && cover.dw < 1 && cover.dh < 1, `${tag}: the window is the viewport-centred rect ${JSON.stringify(cover)}`);
      const alpha = Number((cover.bg.match(/[\d.]+(?=\)$)/) || ['1'])[0]);
      ok(!/rgba|\//.test(cover.bg) || alpha >= 0.95, `${tag}: the window is opaque enough to read (${cover.bg})`);
      if (shots && vp.width === 1440 && family === 'glass') await page.screenshot({ path: path.join(shots, `theme-glass-${theme}-settings-open.png`) });
      await ctx.close();
    }

    // System reduced motion: no spring anywhere — the window appears without scaling.
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce', locale: 'en-GB' });
    const page = await ctx.newPage();
    await routes(page, 'dark');
    await page.goto(`http://localhost:${PORT}/`);
    await page.getByPlaceholder('Message noevia…').waitFor();
    const reducedOpen = await sample(page, '.settings-stage:not(.view-loading)', 500, () => openSettings(page), scaleOf);
    ok(reducedOpen.filter(Boolean).length > 0 && reducedOpen.filter(Boolean).every((f) => Math.abs(f.s - 1) < 0.001), 'prefers-reduced-motion: Settings opens with no spring scale');
    const widths = await sample(page, '.app .sidebar', 300, async () => { await page.keyboard.press('Escape'); await page.waitForTimeout(150); await page.locator('.app .sidebar .side-expand').click(); }, 'return e.getBoundingClientRect().width;');
    ok(widths.filter((w) => w > 62 && w < 262).length <= 1, 'prefers-reduced-motion: the sidebar collapses without a width spring');
    await ctx.close();
    assert.deepEqual(errors, [], 'no page errors');
    console.log(JSON.stringify({ ok: true, checks, shots: shots || null, shotsOnly }));
  } finally { await browser.close(); await fixture.close?.(); }
})().catch((e) => { console.error(e); process.exit(1); });
