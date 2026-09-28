// #529: within each theme family every corner comes from that family's radius tokens, and the
// sheet, menu, drawer, dialog and toast motion actually runs (and stops under reduced motion).
//
// For every family (editorial, contemporary, glass) in light and dark, at 1440x900 and 390x844,
// this reads the computed border-radius of the key surfaces and compares it with the role that
// surface has in the design system (docs/design-system.md, "Shape and space"), read from the
// family's own tokens on the page:
//   control  buttons, rows, fields' neighbours, menu-row highlights      --radius-control
//   button   segmented controls and the Tools trigger                     --radius-button
//   input    text fields (sidebar search)                                 --radius-input
//   overlay  menus, popovers, cards, toasts, code blocks                  --radius-overlay
//   surface  the composer card and the model sheet / dialog               --radius-surface
//   bubble   the user's message                                          --radius-bubble
// Circles (send, +) stay 50%. The token values themselves are checked against the family table
// the #492 suite uses, so a token regression cannot pass by moving every surface with it.
//
// Motion: menus, the model sheet (a bottom sheet with a fading backdrop on a phone), the phone
// drawer, Settings and the toast must each start a real animation on the motion tokens, and be
// part-way through it a frame later (opacity/transform between the start and the end). Under
// prefers-reduced-motion the same openings are instant.
//
// Built app, synthetic fixture only: every API answer below is invented, nothing reaches
// inference, storage or a Diary.
//
//   node scripts/build.cjs --outDir /tmp/x && QA_DIST=/tmp/x node qa/radii-motion-529.cjs
//   QA_SHOT_PREFIX=before|after   names the screenshots (qa-output/radii-motion-529/ by default)
//   QA_ONLY=390x844               one size only (debugging)
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || `${os.homedir()}/noevia-local-test/node_modules/playwright-core`);
const { createFixture } = require('./diary-fixture.cjs');
const { openSettings } = require('./nav.cjs');
const { withLocale } = require('./qa-locale.cjs');
const port = Number(process.env.QA_PORT || 31529), origin = `http://localhost:${port}`;
const out = process.env.QA_SCREENSHOTS || path.join(__dirname, '..', 'qa-output', 'radii-motion-529');
const prefix = process.env.QA_SHOT_PREFIX || 'run';
const failures = [], errors = []; let checks = 0;
const check = (ok, label, detail) => { checks++; if (!ok) failures.push({ label, detail }); };
const step = async (label, fn) => { try { await fn(); } catch (e) { checks++; failures.push({ label, detail: `${String(e.message || e).split('\n')[0]} ${(String(e.stack).match(/radii-motion-529\.cjs:\d+/) || [''])[0]}` }); } };

// The family shape table (#492); tokens are read from the page and must match it.
const SHAPE = {
  editorial: { control: 10, button: 10, input: 10, overlay: 14, surface: 20, bubble: 14 },
  contemporary: { control: 8, button: 999, input: 4, overlay: 16, surface: 28, bubble: 20 },
  glass: { control: 12, button: 12, input: 12, overlay: 18, surface: 24, bubble: 18 },
};
const MOTION = { editorial: { quick: 160, considered: 260 }, contemporary: { quick: 150, considered: 300 }, glass: { quick: 200, considered: 300 } };
const FAMILIES = ['editorial', 'contemporary', 'glass'], THEMES = ['light', 'dark'];
const SIZES = [[1440, 900], [390, 844]].filter(([w, h]) => !process.env.QA_ONLY || process.env.QA_ONLY === `${w}x${h}`);

const REPLY = ['delta', 'done'].map(type => 'data: ' + JSON.stringify(type === 'delta'
  ? { type, text: 'Synthetic answer.\n\n```js\nconst synthetic = 1;\n```\n' } : { type })).join('\n\n') + '\n\n';
const chat = (id, title) => ({ id, title, updatedAt: 1000, archived: false, messages: [] });

async function open(browser, { width, height, family, theme, motion = 'no-preference' }) {
  const touch = width < 768;
  const page = await browser.newPage(withLocale({ viewport: { width, height }, isMobile: touch, hasTouch: touch, reducedMotion: motion }));
  await page.addInitScript(([f, t]) => { localStorage.setItem('cowork-theme', t); localStorage.setItem('noevia:theme-family', f); }, [family, theme]);
  page.on('pageerror', e => errors.push({ at: `${family}-${theme}-${width}`, error: e.message }));
  await page.route('https://**/*', r => r.abort());
  let freeChats = [chat('fc1', 'Synthetic chat one'), chat('fc2', 'Synthetic chat two')];
  const projects = [{ id: 'p1', name: 'Synthetic project', chats: [{ id: 'pc1', title: 'Synthetic project chat', updatedAt: 1 }] }];
  await page.route('**/api/workspace', r => r.fulfill({ json: { projects, freeChats } }));
  await page.route('**/api/freechats', async r => {
    if (r.request().method() !== 'POST') return r.continue();
    freeChats = r.request().postDataJSON().chats; return r.fulfill({ json: { ok: true } });
  });
  const free = { id: '__free-synthetic', name: 'Synthetic free chat', routing: 'auto', files: [], assets: [], toolboxes: ['core'] };
  await page.route('**/api/chats/*/context', r => r.fulfill({ json: { project: free } }));
  await page.route('**/api/chat', r => r.fulfill({ headers: { 'content-type': 'text/event-stream' }, body: REPLY }));
  await page.goto(origin);
  await page.getByRole('textbox', { name: 'Message', exact: true }).waitFor();
  await page.getByRole('button', { name: /^Choose model: / }).first().waitFor();
  await page.waitForTimeout(250);
  return page;
}

const px = (v) => v === '50%' ? v : Number.parseFloat(v);
/** Every corner of the first visible match, e.g. ['20px','20px','20px','20px']. */
const corners = (page, selector, pseudo = null) => page.evaluate(([selector, pseudo]) => {
  const e = [...document.querySelectorAll(selector)].find(el => el.getBoundingClientRect().width > 0);
  if (!e) return null;
  const c = getComputedStyle(e, pseudo);
  if (pseudo && (c.content === 'none' || c.content === 'normal')) return null;
  return [c.borderTopLeftRadius, c.borderTopRightRadius, c.borderBottomRightRadius, c.borderBottomLeftRadius].map(v => v.split(' ')[0]);
}, [selector, pseudo]);
const tokens = (page) => page.evaluate(() => {
  const c = getComputedStyle(document.documentElement), read = (n) => Number.parseFloat(c.getPropertyValue(`--radius-${n}`));
  return { control: read('control'), button: read('button'), input: read('input'), overlay: read('overlay'), surface: read('surface'), bubble: read('bubble') };
});
/** A radius expectation: a number of px for all corners, '50%' for a circle, or four values. */
function expectRadius(label, actual, expected) {
  const want = Array.isArray(expected) ? expected : [expected, expected, expected, expected];
  const ok = !!actual && actual.every((v, i) => want[i] === '50%' ? v === '50%' : Math.abs(px(v) - want[i]) < 0.6);
  check(ok, label, { actual, expected: want });
}

/** The animations running on an element (and its pseudo-elements), right after it appeared. */
const animationsOn = (page, selector) => page.evaluate((selector) => {
  const e = [...document.querySelectorAll(selector)].find(el => el.getBoundingClientRect().width > 0) || document.querySelector(selector);
  if (!e) return null;
  return e.getAnimations({ subtree: true }).map(a => ({
    name: a.animationName || a.transitionProperty, pseudo: a.effect?.pseudoElement || null, self: a.effect?.target === e,
    duration: Number(a.effect?.getTiming().duration) || 0, state: a.playState,
  }));
}, selector);
const snapshot = (page, selector) => page.evaluate((selector) => {
  const e = [...document.querySelectorAll(selector)].find(el => el.getBoundingClientRect().width > 0) || document.querySelector(selector);
  if (!e) return null;
  const c = getComputedStyle(e), r = e.getBoundingClientRect();
  return { opacity: Number(c.opacity), transform: c.transform, x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2 };
}, selector);
/** Checks an entrance: a motion-enter animation on the element with the family's token duration,
 *  caught part-way (it has left its start and not reached its end). */
async function expectEntrance(page, label, selector, duration, { travel = null, fade = false } = {}) {
  const list = await animationsOn(page, selector);
  const own = (list || []).find(a => a.self && a.name === 'motion-enter');
  check(!!own && Math.abs(own.duration - duration) < 1 && own.state === 'running', `${label}: enters with motion-enter on its ${duration}ms token`, list);
  const mid = await snapshot(page, selector);
  await page.waitForTimeout(duration + 150);
  const end = await snapshot(page, selector);
  const moved = mid && end && (Math.abs(mid.opacity - end.opacity) > 0.01 || mid.transform !== end.transform);
  check(moved, `${label}: is still animating a frame after it opens`, { mid, end });
  // A fading entrance must actually start transparent: the drawer's and the phone sheet's
  // slide-only --enter-opacity must not leak into a menu or a toast drawn inside them.
  if (fade && mid) check(mid.opacity < 0.99, `${label}: fades in`, { mid, end });
  if (travel === 'up' && mid && end) check(mid.y > end.y + 20 && mid.opacity === 1, `${label}: slides up from the bottom edge, opaque`, { mid, end });
  if (travel === 'right' && mid && end) check(mid.x < end.x - 20, `${label}: slides in from the left edge`, { mid, end });
  if (travel === 'centred' && mid && end) check(Math.abs(mid.cx - end.cx) < 2, `${label}: stays centred while it enters (no sideways jump)`, { mid, end });
  return end;
}
/** On a phone the sidebar is a drawer, which Escape closes. */
async function ensureDrawer(page) {
  const toggle = page.getByRole('button', { name: 'Open navigation', exact: true });
  if (await toggle.isVisible() && (await toggle.getAttribute('aria-expanded')) !== 'true') { await toggle.click(); await settle(page); }
}
const shot = async (page, name) => { await page.screenshot({ path: path.join(out, `${prefix}-${name}.png`) }); };
const settle = (page) => page.waitForTimeout(450);

async function runCombo(browser, [width, height], family, theme) {
  const name = `${family}-${theme}-${width}x${height}`, phone = width < 768, T = MOTION[family];
  const page = await open(browser, { width, height, family, theme });
  const tok = await tokens(page);
  for (const role of Object.keys(SHAPE[family])) check(tok[role] === SHAPE[family][role], `${name}: --radius-${role} is the family's ${SHAPE[family][role]}px`, tok[role]);
  const S = SHAPE[family];
  const row = family === 'contemporary' ? S.button : S.control;

  // ── The composer ──────────────────────────────────────────────────────────
  expectRadius(`${name} composer card: surface`, await corners(page, '.chat-workspace .chat-composer-inner'), S.surface);
  expectRadius(`${name} + button: circle`, await corners(page, '.chat-composer-inner .composer-add'), '50%');
  expectRadius(`${name} send button: circle`, await corners(page, '.chat-composer-inner .send-btn'), '50%');
  expectRadius(`${name} model control: control`, await corners(page, '.chat-composer-inner .composer-model'), S.control);
  if (phone) {
    // The chosen Chat/Cowork chip draws its highlight with the control radius and fades it.
    expectRadius(`${name} Chat/Cowork chip highlight: control`, await corners(page, '.composer-mode-toggle.is-compact button[aria-checked="true"]', '::before'), S.control);
    await page.getByRole('radio', { name: 'Cowork' }).click();
    const list = await animationsOn(page, '.composer-mode-toggle.is-compact');
    check((list || []).some(a => a.pseudo === '::before' && /opacity|transform/.test(a.name) && a.duration > 0), `${name} Chat/Cowork chip: the highlight moves to the chosen mode with a transition`, list);
    await settle(page);
    expectRadius(`${name} Chat/Cowork chip highlight after switching: control`, await corners(page, '.composer-mode-toggle.is-compact button[aria-checked="true"]', '::before'), S.control);
    await page.getByRole('radio', { name: 'Chat' }).click();
    await settle(page);
  } else {
    expectRadius(`${name} Chat/Cowork toggle: button`, await corners(page, '.composer-mode-toggle'), S.button);
    expectRadius(`${name} Chat/Cowork thumb: button inset`, await corners(page, '.composer-mode-toggle', '::before'), Math.max(2, S.button - 2));
    expectRadius(`${name} Tools trigger: button`, await corners(page, '.tool-catalogue-trigger'), S.button);
    await page.getByRole('radio', { name: 'Cowork' }).click();
    const list = await animationsOn(page, '.composer-mode-toggle');
    check((list || []).some(a => a.pseudo === '::before' && a.name === 'transform' && a.duration > 0), `${name} Chat/Cowork thumb slides`, list);
    await settle(page);
    await page.getByRole('radio', { name: 'Chat' }).click();
    await settle(page);
  }
  await shot(page, `${name}-home`);

  // ── The + menu ────────────────────────────────────────────────────────────
  await page.getByRole('button', { name: 'Add files and tools', exact: true }).click();
  await expectEntrance(page, `${name} + menu`, '.composer-actions-panel', T.quick, { fade: true });
  expectRadius(`${name} + menu: overlay`, await corners(page, '.composer-actions-panel'), S.overlay);
  expectRadius(`${name} + menu rows: overlay less the menu padding`, await corners(page, '.composer-actions-panel > button'), Math.max(4, S.overlay - 6));
  await shot(page, `${name}-menu`);
  await page.keyboard.press('Escape');
  await settle(page);

  // ── The model sheet / dialog ──────────────────────────────────────────────
  await page.getByRole('button', { name: /^Choose model: / }).first().click();
  await page.locator('.mp-panel').waitFor();
  const backdrop = await page.evaluate(() => document.getAnimations().filter(a => a.effect?.pseudoElement === '::backdrop').map(a => ({ name: a.animationName, duration: a.effect.getTiming().duration })));
  check(backdrop.some(a => a.name === 'motion-enter' && a.duration > 0), `${name} model sheet: the backdrop fades in`, backdrop);
  await expectEntrance(page, `${name} model sheet`, '.mp-panel', T.considered, { travel: phone ? 'up' : null });
  expectRadius(`${name} model sheet: surface${phone ? ' top corners, flush bottom' : ''}`, await corners(page, '.mp-panel'), phone ? [S.surface, S.surface, 0, 0] : S.surface);
  await shot(page, `${name}-sheet`);
  await page.keyboard.press('Escape');
  await settle(page);
  if (await page.locator('.mp-panel').count()) { await page.mouse.click(2, 2); await settle(page); }

  // ── A conversation: the bubble, a code block, the compact composer ────────
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Synthetic question');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.getByText('Synthetic answer.').first().waitFor();
  await settle(page);
  expectRadius(`${name} user message: bubble`, await corners(page, '.msg-user-row'), family === 'contemporary' ? [S.bubble, S.bubble, S.input, S.bubble] : S.bubble);
  expectRadius(`${name} code block: overlay`, await corners(page, '.transcript .md-code'), S.overlay);
  expectRadius(`${name} composer card in a chat: surface`, await corners(page, '.chat-workspace .chat-composer-inner'), S.surface);
  await shot(page, `${name}-chat`);
  if (phone) {
    // The phone model sheet in a chat (#527) is the same sheet with the same motion.
    await page.getByRole('button', { name: /^Choose model: / }).first().click();
    await page.locator('.mp-panel.is-phone-sheet').waitFor();
    await expectEntrance(page, `${name} phone model sheet in a chat`, '.mp-panel.is-phone-sheet', T.considered, { travel: 'up' });
    expectRadius(`${name} phone model sheet in a chat: surface top corners`, await corners(page, '.mp-panel.is-phone-sheet'), [S.surface, S.surface, 0, 0]);
    await shot(page, `${name}-chat-sheet`);
    await page.keyboard.press('Escape');
    await settle(page);
  }

  // ── The sidebar ───────────────────────────────────────────────────────────
  if (phone) {
    await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
    await expectEntrance(page, `${name} drawer`, '.app .sidebar.pane', T.considered, { travel: 'right' });
    await shot(page, `${name}-drawer`);
  }
  expectRadius(`${name} sidebar rows: ${family === 'contemporary' ? 'button' : 'control'}`, await corners(page, '.sidebar .chat-row'), row);
  expectRadius(`${name} sidebar project row`, await corners(page, '.sidebar .proj-row'), row);
  expectRadius(`${name} sidebar destination`, await corners(page, '.sidebar .nav-item'), row);
  // Contemporary's New chat is its FAB (overlay corners) until a phone flattens it into a row.
  expectRadius(`${name} New chat`, await corners(page, '.sidebar .new-chat-btn'), phone ? row : family === 'contemporary' ? S.overlay : S.control);
  await page.locator('.proj-row').first().hover().catch(() => {});
  await page.getByRole('button', { name: 'Options for Synthetic project', exact: true }).first().click();
  await expectEntrance(page, `${name} project ⋯ menu`, '.ctx-menu', T.quick, { fade: true });
  expectRadius(`${name} project ⋯ menu: overlay`, await corners(page, '.ctx-menu'), S.overlay);
  expectRadius(`${name} project ⋯ menu rows: overlay less the menu padding`, await corners(page, '.ctx-menu .ctx-item'), Math.max(4, S.overlay - 6));
  await shot(page, `${name}-project-menu`);
  await page.keyboard.press('Escape');
  await settle(page);
  // Search is a field.
  if (phone) await ensureDrawer(page);
  // A phone drawer shows the field itself; a desktop sidebar opens it from its search button.
  if (!(await page.locator('input.shell-search').isVisible())) await page.locator('.sidebar').getByRole('button', { name: 'Search noevia', exact: true }).first().click();
  await page.locator('input.shell-search').waitFor();
  expectRadius(`${name} sidebar search: input`, await corners(page, 'input.shell-search'), S.input);
  await page.keyboard.press('Escape');
  await settle(page);

  // ── The archive toast ────────────────────────────────────────────────────
  if (phone) await ensureDrawer(page);
  await page.locator('.sidebar .chat-row', { hasText: 'Synthetic chat two' }).hover().catch(() => {});
  // Row actions only show on hover; a touch screen reaches them the same way a keyboard does.
  await page.getByRole('button', { name: 'Options for Synthetic chat two', exact: true }).first().dispatchEvent('click');
  await page.getByRole('menuitem', { name: 'Archive', exact: true }).click();
  await page.locator('.save-error.is-notice').waitFor();
  await expectEntrance(page, `${name} toast`, '.save-error.is-notice', T.quick, { travel: 'centred', fade: true });
  expectRadius(`${name} toast: overlay`, await corners(page, '.save-error.is-notice'), S.overlay);
  await shot(page, `${name}-toast`);

  // ── Settings ─────────────────────────────────────────────────────────────
  if (phone) {
    await ensureDrawer(page);
    await page.getByRole('button', { name: /Account menu for/ }).filter({ visible: true }).first().click();
    await page.locator('.account-popover').getByRole('menuitem', { name: 'Settings', exact: true }).click();
  } else await openSettings(page);
  await page.locator('.settings-stage').waitFor();
  const stage = await animationsOn(page, '.settings-stage');
  check((stage || []).some(a => a.self && a.name === 'motion-enter' && Math.abs(a.duration - T.considered) < 1), `${name} Settings: enters on the considered token`, stage);
  await settle(page);
  const settings = page.getByRole('region', { name: 'Settings', exact: true });
  await settings.locator('.settings-navigation').getByRole('button', { name: 'Appearance & language', exact: true }).click();
  await settings.getByRole('radiogroup', { name: 'Theme family' }).waitFor();
  await settle(page);
  expectRadius(`${name} settings card: overlay`, await corners(page, '.settings-stage .set-rows, .settings-stage .group'), S.overlay);
  await page.close();
}

/** Reduced motion: the same openings happen at once. */
async function runReduced(browser, family) {
  const name = `${family}-reduced-390x844`;
  const page = await open(browser, { width: 390, height: 844, family, theme: 'light', motion: 'reduce' });
  await page.getByRole('button', { name: 'Add files and tools', exact: true }).click();
  const menu = await animationsOn(page, '.composer-actions-panel');
  check((menu || []).every(a => a.duration <= 1), `${name}: the + menu opens instantly`, menu);
  await page.keyboard.press('Escape'); await settle(page);
  await page.getByRole('radio', { name: 'Cowork' }).click();
  const chip = await animationsOn(page, '.composer-mode-toggle');
  check((chip || []).every(a => a.duration <= 1), `${name}: the Chat/Cowork chip switches without a transition`, chip);
  await page.getByRole('radio', { name: 'Chat' }).click(); await settle(page);
  await page.getByRole('button', { name: /^Choose model: / }).first().click();
  await page.locator('.mp-panel').waitFor();
  await page.waitForTimeout(40);
  const sheet = await snapshot(page, '.mp-panel');
  check(sheet && sheet.transform === 'none' || sheet?.transform === 'matrix(1, 0, 0, 1, 0, 0)', `${name}: the model sheet is in place at once`, sheet);
  await page.keyboard.press('Escape'); await settle(page);
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await page.waitForTimeout(40);
  const drawer = await snapshot(page, '.app .sidebar.pane');
  check(drawer && drawer.x >= -1, `${name}: the drawer is in place at once`, drawer);
  await page.close();
}

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const fixture = createFixture(port); await fixture.listen();
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const size of SIZES) for (const family of FAMILIES) for (const theme of THEMES) {
      await step(`${family}-${theme}-${size.join('x')}`, () => runCombo(browser, size, family, theme));
    }
    if (!process.env.QA_ONLY || process.env.QA_ONLY === '390x844') for (const family of FAMILIES) await step(`${family} reduced motion`, () => runReduced(browser, family));
  } finally {
    await browser.close();
    await fixture.close?.();
  }
  for (const f of failures) console.log(`FAIL ${f.label}${f.detail === undefined ? '' : `  ${JSON.stringify(f.detail).slice(0, 400)}`}`);
  for (const e of errors) console.log(`PAGE ERROR ${e.at}: ${e.error}`);
  console.log(`radii-motion-529: ${checks - failures.length}/${checks} checks passed${errors.length ? `, ${errors.length} page errors` : ''} (screenshots: ${out})`);
  process.exit(failures.length || errors.length ? 1 : 0);
})();
