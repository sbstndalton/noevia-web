// Theme families × light/dark × widths (#245, #247, #249) against synthetic APIs only: no
// model, no inference, no Diary, no live services. Serves the built app from ../dist.
//   PLAYWRIGHT_MODULE=~/noevia-local-test/node_modules/playwright-core node qa/theme-families.cjs
// Screenshots (375 and 1440): home, chat, composer with Chat/Cowork (Cowork chosen), a menu
// open, the model sheet, and Settings → Appearance with the family previews. 768 is checked for
// overflow only. #313 adds per-family signatures (Contemporary: tonal, shadowless composer and
// pill buttons; Glass: blurred translucent panes over a coloured atmosphere; Editorial: flat,
// ruled paper) and the hover pull (translate ≤ 3px, no tilt, not clinging, off for touch and reduced motion).
// Contact sheet afterwards: node qa/families-contact-sheet.cjs <shots-dir>
const os = require('node:os');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || `${os.homedir()}/noevia-local-test/node_modules/playwright-core`);
const { withLocale } = require('./qa-locale.cjs');
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { createFixture } = require('./diary-fixture.cjs');
const out = process.env.QA_SCREENSHOTS || '/tmp/families-shots';
const PORT = 31461;
const FAMILIES = { editorial: 'Editorial', contemporary: 'Contemporary', glass: 'Glass' };
const DISPLAY = { editorial: 'Fraunces', contemporary: 'Geist', glass: 'Sora' };

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const fixture = createFixture(PORT); await fixture.listen();
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const errors = [], results = [];
  try {
    for (const width of [375, 768, 1440]) for (const theme of ['light', 'dark']) for (const family of Object.keys(FAMILIES)) {
      const touch = width < 768;
      const page = await browser.newPage(withLocale({ viewport: { width, height: width < 768 ? 812 : 900 }, hasTouch: touch, isMobile: touch }));
      page.on('pageerror', (e) => errors.push({ width, theme, family, error: e.message }));
      // A browser that saved the retired material migrates; the rest save the family directly.
      const legacy = { editorial: 'soft', contemporary: 'material', glass: 'liquid' }[family];
      await page.addInitScript(({ theme, legacy, family, migrate }) => {
        localStorage.setItem('cowork-theme', theme);
        if (migrate) localStorage.setItem('noevia:material', legacy); else localStorage.setItem('noevia:theme-family', family);
      }, { theme, legacy, family, migrate: width === 375 });
      const user = { id: 'synthetic-theme-qa', username: 'themeqa', displayName: 'Theme QA', role: 'member', diaryEnabled: false, onboarded: true };
      const chat = (id, title) => ({ id, title, updatedAt: 1000, pinned: false, messages: [] });
      await page.route('**/api/profile', (r) => r.fulfill({ json: { user, passkeys: [] } }));
      await page.route('**/api/auth/session', (r) => r.fulfill({ json: { user, passkeys: [] } }));
      await page.route('**/api/profile/appearance', (r) => r.fulfill({ json: { theme, light: 'iris', dark: 'iris' } }));
      await page.route('**/api/workspace', (r) => r.fulfill({ json: { projects: [{ id: 'p1', name: 'Synthetic research', updatedAt: 1000, files: [], assets: [], chats: [], toolboxes: ['core'] }], freeChats: [chat('c1', 'Synthetic trip plan'), chat('c2', 'A synthetic chat with a much longer title that has to truncate'), chat('c3', 'Synthetic notes')] } }));
      await page.route('**/api/chats/*/history', (r) => r.fulfill({ json: { revision: 'r1', history: [
        { role: 'user', content: 'Summarise the synthetic notes in three points.' },
        { role: 'assistant', content: '## Summary\n\n1. **Scope** — the synthetic fixture covers themes.\n2. **Motion** — four purposes, one contract.\n3. **Depth** — flat, raised, overlay.\n\n```js\nconst family = "editorial";\n```' },
      ] } }));
      await page.goto(`http://localhost:${PORT}`);
      const composer = page.getByPlaceholder('Message noevia…');
      await composer.waitFor();
      await page.evaluate(() => document.fonts.ready);
      const shot = async (name) => {
        const state = await page.evaluate(() => {
          const root = document.documentElement;
          const inner = document.querySelector('.composer-inner');
          const h = document.querySelector('.chat-workspace .empty-state h1');
          const side = document.querySelector('.app .sidebar.pane');
          const stack = document.querySelector('.app .app-stack.pane');
          return {
            sidebarFilter: side ? getComputedStyle(side).backdropFilter : null,
            stackFilter: stack ? getComputedStyle(stack).backdropFilter : null,
            stackBg: stack ? getComputedStyle(stack).backgroundColor : null,
            stackImage: stack ? getComputedStyle(stack).backgroundImage : null,
            bodyImage: getComputedStyle(document.body).backgroundImage,
            composerBg: inner ? getComputedStyle(inner).backgroundColor : null,
            composerRadius: inner ? getComputedStyle(inner).borderTopLeftRadius : null,
            family: root.dataset.family, theme: root.dataset.theme,
            overflow: root.scrollWidth > innerWidth + 1,
            composerShadow: inner ? getComputedStyle(inner).boxShadow : null,
            composerTransition: inner ? getComputedStyle(inner).transitionProperty : null,
            headingFont: h ? getComputedStyle(h).fontFamily : null,
          };
        });
        results.push({ width, theme, family, surface: name, ...state });
        assert.equal(state.family, family, `${width} ${theme} ${family} ${name}: data-family`);
        assert.equal(state.overflow, false, `${width} ${theme} ${family} ${name}: horizontal overflow`);
        if (state.composerTransition) assert.doesNotMatch(state.composerTransition, /\ball\b/, 'composer names its transitions');
        if (width !== 768) await page.screenshot({ path: path.join(out, `${family}-${theme}-${width}-${name}.png`) });
      };

      // Home: the greeting in the family's display face, the composer as the one raised surface.
      await shot('home');
      const home = results.at(-1);
      assert.ok(home.headingFont?.includes(DISPLAY[family]), `${family} greeting uses ${DISPLAY[family]}: ${home.headingFont}`);
      if (family === 'contemporary') {
        // M3: tonal elevation — the composer is a filled container, not a shadow; 28px shape.
        assert.equal(home.composerShadow, 'none', 'contemporary composer is tonal, not shadowed');
        assert.equal(home.composerRadius, '28px', 'contemporary composer uses the 28px M3 shape');
        assert.notEqual(home.composerBg, home.stackBg, 'contemporary composer sits on a distinct container tone');
      } else if (family === 'glass') assert.notEqual(home.composerShadow, 'none', 'glass composer floats');
      if (family === 'glass') {
        assert.match(home.stackFilter || '', /blur\(/, 'glass reading plane is frosted');
        if (width >= 520) assert.match(home.sidebarFilter || '', /blur\(.*saturate\(/, 'glass sidebar blurs and saturates');
        assert.match(home.bodyImage, /radial-gradient/, 'glass atmosphere behind the panes');
        assert.match(home.stackImage || '', /^linear-gradient\((?:rgba\([^)]*, 0\.\d+\)|color\([^)]*\/ 0\.\d+\))/, `glass reading plane is translucent: ${home.stackImage}`);
      } else {
        assert.match(home.stackFilter || 'none', /^none$/, `${family} reading plane is opaque`);
      }
      if (family === 'editorial') assert.equal(home.composerShadow, 'none', 'editorial composer is ruled, not lifted');

      // Chat/Cowork: the thumb moves, the harness line changes text.
      const toggle = page.getByRole('radiogroup', { name: 'Session mode' });
      await toggle.getByRole('radio', { name: 'Cowork' }).click();
      assert.equal(await toggle.getAttribute('data-mode'), 'cowork');
      await page.waitForTimeout(400);
      await shot('composer-cowork');
      await toggle.getByRole('radio', { name: 'Chat' }).click();

      // A menu: the composer's add menu, an overlay on the shared scale.
      await page.getByRole('button', { name: 'Add files and tools' }).click();
      const panel = page.locator('.composer-actions-panel');
      await panel.waitFor();
      await page.waitForTimeout(250);
      const overlay = await panel.evaluate((e) => ({ radius: getComputedStyle(e).borderTopLeftRadius, shadow: getComputedStyle(e).boxShadow }));
      assert.notEqual(overlay.shadow, 'none', 'menu uses the overlay elevation');
      await shot('menu');
      await page.keyboard.press('Escape');

      // A sheet: the model picker (a dialog on desktop, a bottom sheet on phones).
      await page.locator('.composer .model-pill').first().click();
      const sheet = page.locator('.mp-panel');
      await sheet.waitFor();
      await page.waitForTimeout(400);
      const sheetStyle = await sheet.evaluate((e) => ({ radius: getComputedStyle(e).borderTopLeftRadius, filter: getComputedStyle(e).backdropFilter }));
      if (family === 'contemporary') assert.equal(sheetStyle.radius, '28px', 'M3 sheets and dialogs take 28px');
      if (family === 'glass') assert.match(sheetStyle.filter, /blur\(/, 'glass sheet is frosted');
      // #316: no model, no active project (this fixture's Home context) — ModelChooser's
      // early-return "Open a project…" line used to sit flush against the panel's left edge
      // (.mp-col's padding never applied to it), clipping the round "O" against the panel's own
      // overflow:hidden. A real inset, not just non-negative overlap, is the actual fix.
      const emptyLine = sheet.locator('.rail-empty');
      await emptyLine.waitFor();
      // Measure the rendered glyph itself (a Range around the first character), not the
      // element's own border box — .rail-empty carries no margin, so its box stays flush
      // against .mp-body regardless of padding; only the glyph's own position proves the text
      // actually got breathing room instead of being clipped against the panel edge.
      const emptyInset = await page.evaluate(([panelSel, lineSel]) => {
        const panel = document.querySelector(panelSel), line = document.querySelector(lineSel);
        const textNode = line.firstChild;
        const range = document.createRange();
        range.setStart(textNode, 0); range.setEnd(textNode, 1);
        return range.getBoundingClientRect().left - panel.getBoundingClientRect().left;
      }, ['.mp-panel', '.rail-empty']);
      assert.ok(emptyInset >= 12, `${family} model-sheet empty state's first glyph has a real left inset, not clipped against the panel edge: ${emptyInset}px`);
      await shot('sheet');
      await page.keyboard.press('Escape');
      if (await sheet.isVisible()) await page.mouse.click(5, 5);
      await sheet.waitFor({ state: 'hidden' }).catch(() => {});

      // Hover pull: on desktop a sidebar row shifts ≤ 3px toward the pointer (no tilt), then settles back.
      if (!touch) {
        const row = page.locator('.app .sidebar.pane .side-nav .nav-item').first();
        const b = await row.boundingBox();
        await page.mouse.move(b.x + b.width - 2, b.y + b.height / 2);
        await page.waitForTimeout(260);
        const pulled = await row.evaluate((e) => ({ translate: getComputedStyle(e).translate, rotate: getComputedStyle(e).rotate, pulling: e.hasAttribute('data-pulling') }));
        assert.equal(pulled.rotate, 'none', 'the pull is a translate only, no tilt');
        assert.ok(pulled.pulling, 'row marked as pulling');
        const [tx] = pulled.translate.split(' ').map(parseFloat);
        assert.ok(tx > 0 && tx <= 3, `row pulls toward the pointer by ≤ 3px: ${pulled.translate}`);
        await page.mouse.move(b.x + b.width / 2, b.y - 200);
        await page.waitForTimeout(600);
        const settled = await row.evaluate((e) => getComputedStyle(e).translate);
        assert.ok(settled === 'none' || /^0px( 0px)?$/.test(settled), `row settles after leaving: ${settled}`);
        // Text inputs never move.
        const box = await composer.boundingBox();
        await page.mouse.move(box.x + box.width - 4, box.y + 4);
        await page.waitForTimeout(260);
        assert.equal(await composer.evaluate((e) => getComputedStyle(e).translate), 'none', 'the composer input does not pull');
      }

      // Chat: a synthetic conversation opened from the sidebar.
      if (touch) await page.getByRole('button', { name: 'Open navigation', exact: true }).click().catch(() => {});
      await page.getByText('Synthetic trip plan', { exact: true }).first().click();
      await page.getByText('four purposes, one contract').waitFor();
      await page.waitForTimeout(250);
      await shot('chat');

      // Settings → Appearance: the family previews, each a live sample in light and dark.
      await page.getByTitle('Settings', { exact: true }).first().click();
      const settings = page.getByRole('region', { name: 'Settings', exact: true });
      await settings.waitFor();
      const back = settings.getByRole('button', { name: 'All settings', exact: true });
      if (await back.isVisible()) await back.click();
      await settings.locator('.settings-navigation').getByRole('button', { name: 'Appearance & language', exact: true }).click();
      const choice = settings.getByRole('radiogroup', { name: 'Theme family' });
      await choice.waitFor();
      assert.deepEqual(await choice.locator('.family-tile-name').allTextContents(), Object.values(FAMILIES));
      assert.equal(await choice.getByRole('radio', { checked: true }).locator('.family-tile-name').textContent(), FAMILIES[family]);
      const previews = await choice.locator('.family-preview').evaluateAll((els) => els.map((e) => ({ family: e.dataset.family, theme: e.dataset.theme, bg: getComputedStyle(e).backgroundColor, font: getComputedStyle(e.querySelector('.family-preview-heading')).fontFamily })));
      assert.equal(previews.length, 6);
      for (const p of previews) assert.ok(p.font.includes(DISPLAY[p.family]), `preview ${p.family} heading font ${p.font}`);
      assert.notEqual(previews[0].bg, previews[1].bg, 'light and dark previews differ');
      await choice.scrollIntoViewIfNeeded();
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(250);
      await shot('settings-appearance');
      // Choosing a family restyles the app at once and persists on this device.
      const next = family === 'glass' ? 'editorial' : 'glass';
      await choice.getByRole('radio', { name: new RegExp(`^${FAMILIES[next]}`) }).click();
      assert.equal(await page.evaluate(() => [document.documentElement.dataset.family, localStorage.getItem('noevia:theme-family')].join()), `${next},${next}`);
      await page.close();
    }

    // Reduced motion: menus still open, instantly, and loops stop.
    const page = await browser.newPage(withLocale({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' }));
    page.on('pageerror', (e) => errors.push({ reduced: true, error: e.message }));
    await page.route('**/api/profile/appearance', (r) => r.fulfill({ json: { theme: 'light', light: 'iris', dark: 'iris' } }));
    await page.goto(`http://localhost:${PORT}`); await page.getByPlaceholder('Message noevia…').waitFor();
    await page.getByRole('button', { name: 'Add files and tools' }).click();
    const timing = await page.locator('.composer-actions-panel').evaluate((e) => getComputedStyle(e).animationDuration);
    assert.equal(timing, '0.001s', `reduced motion menu entrance ${timing}`);
    await page.keyboard.press('Escape');
    const still = page.locator('.app .sidebar.pane .side-nav .nav-item').first();
    const sb = await still.boundingBox();
    await page.mouse.move(sb.x + sb.width - 2, sb.y + sb.height / 2);
    await page.waitForTimeout(260);
    assert.equal(await still.evaluate((e) => getComputedStyle(e).translate), 'none', 'no hover pull with reduced motion');
    await page.close();

    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ results, errors }, null, 2));
    assert.deepEqual(errors, []);
    console.log(`PASS theme families: ${results.length} surfaces, 3 families × 2 modes × 3 widths, migration from saved materials, previews, reduced motion. Shots in ${out}`);
  } finally { await browser.close(); await fixture.close(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
