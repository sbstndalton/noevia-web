// #1623 two-tone icons, browser proof. Synthetic APIs only (qa/diary-fixture.cjs on its own local
// port plus page routes): no model, no inference, no real Diary, no live server.
//   npm run build && node qa/icon-tones-1623.cjs
// PLAYWRIGHT_MODULE overrides the Playwright module (default ~/noevia-local-test/node_modules/playwright-core).
// QA_SHOTS=<dir> writes a screenshot of every screen below, in every theme family, light and dark,
// palette and width (375, 768, 1440). QA_SHOTS_ONLY=1 skips the assertions (the "before" set on an
// older build); QA_DIST serves another build. QA_PALETTES / QA_WIDTHS (comma lists) narrow a run.
// Screens: the sidebar, the composer (with its + menu), a Settings page, a project's source list, an
// empty state, and the follow-ups: Settings -> Connected apps (the Nextcloud tile), the "No chats yet",
// "No tasks yet" and "No matching projects" empty states, and the current chat and page in the sidebar.
// The assertions pin the rule, measured in the real cascade:
//   controls    no icon inside a button, link, summary, label, menu item, tab, option or toggle paints
//               an accent part, and no control is painted in the accent, on any screen, family, mode,
//               palette or width; except:
//   identity    the Nextcloud tile's logo (.connector-card > .logo) is two-tone like the MCP tile
//   active      the current page's row in the sidebar and the Settings navigation draws its icon wholly
//               in --icon-accent (not two-tone), at >= 3:1 against the row's real, rendered ground
//               (sampled from the screenshot under the icon); hovering or focusing another row leaves
//               its icon neutral; a phone's Settings list (no current row shown) stays neutral
//   decorative  information-only icons (source and folder markers, the storage path, the empty states,
//               Settings search, the connector tiles) paint their inner part in the theme's own
//               --icon-accent, distinct from the outline, and the accent changes with the palette
//   guard       a decorative icon dropped into a button falls back to the neutral colour
//   forced      under forced colours the accent part, and the active icon, take the outline's colour
const os = require('node:os');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || `${os.homedir()}/noevia-local-test/node_modules/playwright-core`);
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { createFixture } = require('./diary-fixture.cjs');
const PORT = 31623;
const shots = process.env.QA_SHOTS || '';
const shotsOnly = process.env.QA_SHOTS_ONLY === '1';
const FAMILIES = ['editorial', 'contemporary', 'glass'], MODES = ['light', 'dark'];
const PALETTES = (process.env.QA_PALETTES || 'iris,warm,cool,neutral,sage').split(',');
const WIDTHS = [[375, 812], [768, 1024], [1440, 900]].filter(([w]) => !process.env.QA_WIDTHS || process.env.QA_WIDTHS.split(',').includes(String(w)));
const FLAGS = { codeHarness: true };

const user = { id: 'synthetic-icons-1623', username: 'iconqa', displayName: 'Icon QA', role: 'member', diaryEnabled: true, onboarded: true };
const project = {
  id: 'p-lab', name: 'Synthetic lab', goal: 'A synthetic project for the icon screenshots.', instructions: 'Answer in short steps.', memories: [],
  files: [{ name: 'synthetic-notes.md', content: '# Notes' }, { name: 'synthetic-plan.txt', content: 'plan' }, { name: 'Documents/Synthetic/manual.md', content: 'manual', source: 'Documents/Synthetic' }],
  assets: [], sourceFolders: ['Documents/Synthetic', 'Documents/Manuals'], projectFolder: 'noevia projects/Synthetic lab', toolboxes: ['core'], modes: ['chat'],
  chats: [{ id: 'pc1', title: 'Synthetic pool layout', preview: 'Two mirrors', updatedAt: 1000, pinned: true }], createdAt: 1000, updatedAt: 1000,
};
const emptyProject = { id: 'p-empty', name: 'Synthetic empty', goal: '', instructions: '', memories: [], files: [], assets: [], sourceFolders: [], toolboxes: ['core'], modes: ['chat'], chats: [], createdAt: 900, updatedAt: 900 };
const freeChats = [{ id: 'c1', title: 'Synthetic trip plan', updatedAt: 1000, pinned: false, messages: [] }, { id: 'c2', title: 'Synthetic notes', updatedAt: 900, pinned: false, messages: [] }];
const CODE_STATE = { repositories: [{ id: 'scratch' }], capabilities: ['read_repository'], defaultCapabilities: ['read_repository'], harnesses: [{ id: 'synthetic', label: 'Synthetic', version: '0' }],
  promptPreparation: [{ id: 'direct', label: 'Direct', available: true, reason: 'Direct' }], sandboxed: true, network: false, tasks: [] };

async function routes(page, theme, palette) {
  await page.route('**/api/profile', (r) => r.fulfill({ json: { user, passkeys: [] } }));
  await page.route('**/api/auth/session', (r) => r.fulfill({ json: { user, passkeys: [] } }));
  await page.route('**/api/profile/appearance', (r) => r.fulfill({ json: { theme, light: palette, dark: palette } }));
  await page.route('**/api/workspace', (r) => r.fulfill({ json: { projects: [project, emptyProject], freeChats } }));
  await page.route('**/api/features', (r) => r.fulfill({ json: { flags: FLAGS } }));
  await page.route('**/api/projects/*/skills', (r) => r.fulfill({ json: { skills: [] } }));
  await page.route('**/api/projects/*/instruction-skills', (r) => r.fulfill({ json: { skills: [] } }));
  await page.route('**/api/projects/*/sources/sync', (r) => r.fulfill({ json: { updated: [], skipped: [] } }));
  await page.route('**/api/projects/*/code**', (r) => r.fulfill({ json: CODE_STATE }));
  await page.route('**/api/code/active', (r) => r.fulfill({ json: { tasks: [], total: 0 } }));
}

/** Every visible icon on the page, measured in the cascade (runs in the page). */
function measure() {
  const PRESSABLE = "button, a, summary, label, [role='button'], [role='link'], [role='menuitem'], [role='menuitemradio'], [role='menuitemcheckbox'], [role='tab'], [role='option'], [role='switch'], [role='checkbox'], [role='radio'], [role='treeitem']";
  const ACTIVE = ".app .sidebar.pane [aria-current='page'] > .ic:first-child, .settings-stage .settings-navigation nav button[aria-current='page'] > .ic:first-child";
  const IDENTITY = '.connector-card > .logo > .ic';
  const probe = document.createElement('i');
  const resolve = (host, value) => { probe.style.color = value; host.appendChild(probe); const c = getComputedStyle(probe).color; probe.remove(); return c; };
  const out = { controls: 0, controlAccents: [], controlInAccent: [], active: [], identity: [], decorative: 0, accented: 0, wrong: [], accents: [], outlines: [], empty: [] };
  for (const svg of document.querySelectorAll('svg.ic')) {
    if (!svg.getClientRects().length) continue;
    const base = getComputedStyle(svg).stroke;
    const accent = resolve(svg.parentElement, 'var(--icon-accent)');
    const parts = [...svg.querySelectorAll('.ic-a, .ic-af')];
    const painted = parts.filter((p) => (p.classList.contains('ic-af') ? getComputedStyle(p).fill !== 'none' : getComputedStyle(p).stroke !== base));
    const control = svg.closest(PRESSABLE);
    const identity = svg.matches(IDENTITY);
    if (control && !identity) {
      out.controls++;
      const where = `${svg.dataset.icon} (${svg.dataset.tone}) in <${control.tagName.toLowerCase()} class="${control.className}">`;
      if (painted.length) out.controlAccents.push(where);
      const row = control.closest('.chat-row, .proj-row') || control;
      if (svg.matches(ACTIVE)) out.active.push({ icon: svg.dataset.icon, stroke: base, accent, colour: getComputedStyle(svg).color, rowBackground: getComputedStyle(row).backgroundColor, settings: !!svg.closest('.settings-navigation'), parts: parts.length });
      else if (base === accent && base !== getComputedStyle(svg).color) out.controlInAccent.push(where);
      continue;
    }
    if (identity) out.identity.push({ icon: svg.dataset.icon, tone: svg.dataset.tone, parts: parts.length, painted: painted.length });
    if (svg.dataset.tone !== 'decorative') continue;
    out.decorative++;
    if (svg.closest('.empty-state-icon')) out.empty.push({ icon: svg.dataset.icon, parts: parts.length });
    if (!parts.length) continue;
    out.accented++;
    for (const p of parts) {
      const paint = p.classList.contains('ic-af') ? getComputedStyle(p).fill : getComputedStyle(p).stroke;
      if (paint !== accent) out.wrong.push(`${svg.dataset.icon}: ${paint} is not the accent ${accent}`);
    }
    out.accents.push(accent); out.outlines.push(base);
  }
  return out;
}

const rgb = (s) => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
const lum = (c) => { const [r, g, b] = c.map((v) => v / 255).map((v) => (v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)); return r * .2126 + g * .7152 + b * .0722; };
const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };

/** The colour actually rendered under an icon: hide the icon, screenshot its box, take the median pixel. */
async function groundUnder(page, locator) {
  const icon = await locator.elementHandle();
  const box = icon && await icon.boundingBox();
  if (!box) return null;
  await icon.evaluate((n) => { n.style.visibility = 'hidden'; });
  const png = await page.screenshot({ clip: box, animations: 'disabled' });
  await icon.evaluate((n) => { n.style.visibility = ''; });
  return page.evaluate(async (bytes) => {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height), ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    const d = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data, channel = [[], [], []];
    for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) channel[k].push(d[i + k]);
    return channel.map((c) => c.sort((a, b) => a - b)[c.length >> 1]);
  }, [...png]);
}

/** Opens the linked reference folders, so their folder markers are on screen too. */
async function openFolders(page) {
  await page.evaluate(() => { for (const d of document.querySelectorAll('details')) if (/folder/i.test(d.querySelector('summary')?.textContent || '')) d.open = true; });
  await page.waitForTimeout(150);
}

/** On a phone the sidebar is a drawer: open it. */
async function openDrawer(page) {
  const toggle = page.getByRole('button', { name: 'Open navigation', exact: true });
  if (await toggle.isVisible()) { await toggle.click(); await page.getByRole('dialog', { name: 'Navigation' }).waitFor(); await page.waitForTimeout(400); }
}

const ACTIVE_ICON = ".app .sidebar.pane [aria-current='page'] > .ic:first-child";

async function screens(page, width, name, shoot) {
  const go = async (url, ready) => { await page.goto(`http://localhost:${PORT}${url}`); await ready(); await page.waitForTimeout(250); };
  const result = {};
  // Sidebar (a drawer on a phone), on the home page: no row is current.
  await go('/', () => page.getByPlaceholder('Message noevia…').waitFor());
  await openDrawer(page);
  result.sidebar = await page.evaluate(measure); await shoot(`${name}-sidebar`);
  // Composer with its + menu open: menu items are controls.
  await go('/', () => page.getByPlaceholder('Message noevia…').waitFor());
  await page.locator('.composer-add').filter({ visible: true }).first().click();
  await page.locator('.composer-actions-panel').waitFor();
  await page.waitForTimeout(250);
  result.composer = await page.evaluate(measure); await shoot(`${name}-composer`);
  await page.keyboard.press('Escape');
  // A Settings page: its navigation's current row (Appearance) where the navigation is shown.
  await go('/settings/appearance', () => page.getByRole('dialog', { name: 'Settings' }).waitFor());
  await page.waitForTimeout(400);
  result.settings = await page.evaluate(measure); await shoot(`${name}-settings`);
  const settingsIcon = page.locator(".settings-navigation nav button[aria-current='page'] > .ic:first-child");
  if (await settingsIcon.isVisible().catch(() => false) && result.settings.active.some((a) => a.settings && a.stroke === a.accent)) result.settingsGround = await groundUnder(page, settingsIcon);
  // Settings -> Connected apps: Google Drive (brand), Nextcloud (identity tile), MCP servers.
  await go('/settings/connectors', () => page.locator('.connector-card[aria-label="Nextcloud"]').filter({ visible: true }).waitFor());
  result.connectors = await page.evaluate(measure); await shoot(`${name}-connectors`);
  result.drive = await page.locator('.connector-card[aria-label="Google Drive"] .logo svg').first().evaluate((svg) => ({ ic: svg.classList.contains('ic'), fills: [...svg.querySelectorAll('[fill]')].map((p) => p.getAttribute('fill')).filter((f) => /^#/.test(f)).length }));
  // A project's source list: file and folder markers, the storage path.
  await go('/p/p-lab/sources', () => page.locator('.source-name').filter({ visible: true }).first().waitFor());
  await openFolders(page);
  result.sources = await page.evaluate(measure); await shoot(`${name}-sources`);
  // Empty states: a project link that names no project, "No chats yet", "No tasks yet", no match.
  await go('/p/no-such-project', () => page.locator('.empty-state-card').waitFor());
  result.empty = await page.evaluate(measure); await shoot(`${name}-empty`);
  await go('/p/p-empty', () => page.locator('.empty-state-card').filter({ hasText: 'No chats yet' }).waitFor());
  result.noChats = await page.evaluate(measure); await shoot(`${name}-empty-chats`);
  await go('/p/p-lab/code', () => page.locator('.empty-state-card').filter({ hasText: 'No tasks yet' }).waitFor());
  result.noTasks = await page.evaluate(measure); await shoot(`${name}-empty-tasks`);
  await go('/projects', () => page.locator('.projects-search').waitFor());
  await page.locator('.projects-search').fill('zz-no-such-synthetic-project');
  await page.locator('.empty-state-card').waitFor(); await page.waitForTimeout(200);
  result.noMatch = await page.evaluate(measure); await shoot(`${name}-empty-search`);
  // The current page in the sidebar: Projects (a destination row).
  await openDrawer(page);
  result.projectsPage = await page.evaluate(measure); await shoot(`${name}-active-projects`);
  // The current chat, its icon on the rendered row; then hover and focus another row, and hover it.
  await go('/c/c1', () => page.getByPlaceholder('Message noevia…').waitFor());
  await openDrawer(page);
  await page.locator('.chat-row.is-active').filter({ visible: true }).first().waitFor();
  result.chatPage = await page.evaluate(measure); await shoot(`${name}-active-chat`);
  const activeIcon = page.locator(`.chat-row.is-active ${ACTIVE_ICON.replace('.app .sidebar.pane ', '')}`).filter({ visible: true }).first();
  result.chatGround = await groundUnder(page, activeIcon);
  const other = page.locator('.chat-row:not(.is-active) .nav-item').filter({ hasText: 'Synthetic notes' }).filter({ visible: true }).first();
  const otherStroke = () => other.locator('svg.ic').first().evaluate((s) => getComputedStyle(s).stroke);
  if (width >= 768) { await other.hover(); await page.waitForTimeout(200); result.otherHover = await otherStroke(); }
  await other.focus(); await page.waitForTimeout(200); result.otherFocus = await otherStroke();
  if (width >= 768) {
    await page.locator('.chat-row.is-active .nav-item').filter({ visible: true }).first().hover(); await page.waitForTimeout(250);
    result.activeHovered = await activeIcon.evaluate((s) => getComputedStyle(s).stroke);
    result.chatGroundHovered = await groundUnder(page, activeIcon);
    await shoot(`${name}-active-chat-hover`);
  }
  return result;
}

(async () => {
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const fixture = createFixture(PORT); await fixture.listen();
  const browser = await chromium.launch({ headless: true, channel: process.env.QA_CHANNEL || 'chrome' });
  const errors = [], seenAccents = new Map(), ratios = [];
  let checked = 0;
  const ok = (cond, msg) => { checked++; if (!shotsOnly) assert.ok(cond, msg); };
  try {
    for (const family of FAMILIES) for (const theme of MODES) for (const palette of PALETTES) for (const [width, height] of WIDTHS) {
      const phone = width < 768;
      const ctx = await browser.newContext({ viewport: { width, height }, isMobile: phone, hasTouch: phone, colorScheme: theme });
      const page = await ctx.newPage(); page.on('pageerror', (e) => errors.push(`${family} ${theme} ${palette} ${width}: ${e.message}`));
      await page.addInitScript(({ t, f, p, flags }) => {
        localStorage.setItem('cowork-theme', t); localStorage.setItem('noevia:theme-family', f);
        localStorage.setItem('cowork-palette-light', p); localStorage.setItem('cowork-palette-dark', p);
        localStorage.setItem('noevia:feature-flags', JSON.stringify(flags));
      }, { t: theme, f: family, p: palette, flags: FLAGS });
      await routes(page, theme, palette);
      const name = `${family}-${theme}-${palette}-${width}`;
      const shoot = async (file) => { if (shots) await page.screenshot({ path: path.join(shots, `${file}.png`) }); };
      const r = await screens(page, width, name, shoot);
      const measured = Object.entries(r).filter(([, m]) => m && typeof m === 'object' && 'controls' in m);
      for (const [screen, m] of measured) {
        ok(m.controlAccents.length === 0, `${name} ${screen}: a control paints an accent part: ${m.controlAccents.join('; ')}`);
        ok(m.controlInAccent.length === 0, `${name} ${screen}: a control that is not the current row is painted in the accent: ${m.controlInAccent.join('; ')}`);
        ok(m.wrong.length === 0, `${name} ${screen}: ${m.wrong.join('; ')}`);
        ok(m.accents.every((a, i) => a !== m.outlines[i]), `${name} ${screen}: the accent part is distinct from the outline`);
        // The current row's icon: wholly the accent where the row is shown as current, else neutral.
        for (const a of m.active) {
          ok(a.parts === 0, `${name} ${screen}: the active ${a.icon} is a control glyph, not two-tone`);
          const shown = a.rowBackground !== 'rgba(0, 0, 0, 0)';
          if (shown) ok(a.stroke === a.accent && a.stroke !== a.colour, `${name} ${screen}: the current row's ${a.icon} is the accent (${a.stroke}, accent ${a.accent})`);
          else ok(a.stroke === a.colour, `${name} ${screen}: a current row shown without a highlight keeps a neutral ${a.icon} (${a.stroke})`);
        }
      }
      ok(r.sidebar.controls >= 6 && r.composer.controls >= 4, `${name}: controls measured (${r.sidebar.controls}, ${r.composer.controls})`);
      ok(r.sidebar.active.length === 0, `${name} sidebar: on the home page no row is current (${r.sidebar.active.map((a) => a.icon)})`);
      ok(r.sources.accented >= 3, `${name} sources: file and folder markers are two-tone (${r.sources.accented})`);
      ok(r.empty.accented === 1, `${name} empty state: its symbol is two-tone (${r.empty.accented})`);
      if (width === 1440) {
        ok(r.settings.decorative >= 1, `${name} settings: the search field symbol is decorative`);
        // Settings navigation: Appearance is current and its palette icon is the accent.
        const nav = r.settings.active.filter((a) => a.settings);
        ok(nav.length === 1 && nav[0].icon === 'palette' && nav[0].stroke === nav[0].accent, `${name} settings: the current section's icon is the accent (${JSON.stringify(nav)})`);
      }
      if (width === 375) ok(r.settings.active.filter((a) => a.settings && a.stroke === a.accent).length === 0, `${name} settings: a phone's Settings list shows no accent row`);
      // Follow-up 1: the Nextcloud tile is two-tone like the MCP servers tile; Google Drive keeps its brand.
      const tiles = r.connectors.identity, nextcloud = tiles.filter((t) => t.icon === 'hard-drive'), mcp = tiles.filter((t) => t.icon === 'server');
      ok(tiles.length === 2 && nextcloud.length === 1 && mcp.length === 1, `${name} connectors: the Nextcloud and MCP servers tiles (${JSON.stringify(tiles)})`);
      for (const t of [...nextcloud, ...mcp]) ok(t.tone === 'decorative' && t.parts >= 2 && t.painted === t.parts, `${name} connectors: the ${t.icon} tile is two-tone (${JSON.stringify(t)})`);
      ok(r.connectors.accented >= 2, `${name} connectors: the Nextcloud and MCP tiles both paint the accent (${r.connectors.accented})`);
      ok(!r.drive.ic && r.drive.fills >= 3, `${name} connectors: Google Drive keeps its brand logo (${JSON.stringify(r.drive)})`);
      // Follow-up 2: every empty state's symbol has an accent part.
      for (const [screen, glyph] of [['empty', 'folder'], ['noChats', 'message-square-text'], ['noTasks', 'square-code'], ['noMatch', 'search-x']]) {
        const e = r[screen].empty;
        ok(e.length === 1 && e[0].icon === glyph && e[0].parts >= 1, `${name} ${screen}: the empty state draws ${glyph} with an accent part (${JSON.stringify(e)})`);
      }
      // Follow-up 3: the current row's icon is the accent: the chat, and the Projects page.
      const chat = r.chatPage.active.filter((a) => !a.settings);
      ok(chat.length === 1 && chat[0].icon === 'message-square' && chat[0].stroke === chat[0].accent, `${name} chat: the current chat's icon is the accent (${JSON.stringify(chat)})`);
      const projects = r.projectsPage.active.filter((a) => !a.settings);
      ok(projects.length === 1 && projects[0].icon === 'folder' && projects[0].stroke === projects[0].accent, `${name} projects: the Projects row's icon is the accent (${JSON.stringify(projects)})`);
      const neutral = chat[0]?.colour;
      if (width >= 768) ok(r.otherHover === neutral, `${name}: hovering another chat leaves its icon neutral (${r.otherHover}, neutral ${neutral})`);
      ok(r.otherFocus !== chat[0]?.accent, `${name}: focusing another chat leaves its icon neutral (${r.otherFocus})`);
      if (width >= 768) ok(r.activeHovered === chat[0]?.accent, `${name}: the current chat keeps its accent icon on hover (${r.activeHovered})`);
      // Contrast >= 3:1 against what is really rendered under the icon (blur, wash and all).
      for (const [where, ground] of [['chat row', r.chatGround], ['hovered chat row', r.chatGroundHovered], ['Settings row', r.settingsGround]]) {
        if (!ground || !chat[0]) continue;
        const ratio = contrast(rgb(chat[0].accent), ground);
        ratios.push({ name, where, ratio });
        ok(ratio >= 3, `${name} ${where}: the accent icon ${chat[0].accent} on rgb(${ground}) is ${ratio.toFixed(2)}:1`);
      }
      if (width === 1440) seenAccents.set(`${family}-${theme}-${palette}`, r.sources.accents[0]);
      await ctx.close();
    }
    // Every palette shows up: each paints its own accent, per family and mode.
    if (PALETTES.length === 5 && WIDTHS.some(([w]) => w === 1440)) for (const family of FAMILIES) for (const theme of MODES) {
      const colours = new Set(PALETTES.map((p) => seenAccents.get(`${family}-${theme}-${p}`)));
      ok(colours.size === PALETTES.length, `${family} ${theme}: each palette paints its own accent (${[...colours].join(', ')})`);
    }

    // The CSS guard, in the real cascade: the same decorative icon outside and inside a button, and
    // the Nextcloud tile's identity exception does not leak to any other button.
    {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await ctx.newPage();
      await routes(page, 'dark', 'warm');
      await page.goto(`http://localhost:${PORT}/p/p-lab/sources`); await page.locator('.source-name').filter({ visible: true }).first().waitFor();
      const g = await page.evaluate(() => {
        const marker = document.querySelector(".source-name svg.ic[data-tone='decorative'][data-icon='folder'], .storage-path svg.ic[data-tone='decorative']");
        if (!marker) return { free: 'no decorative folder', button: 'none', menuitem: 'none', logoElsewhere: 'none' };
        const free = marker.cloneNode(true), held = marker.cloneNode(true), item = marker.cloneNode(true), logo = marker.cloneNode(true);
        const button = document.createElement('button'), menuitem = document.createElement('div');
        menuitem.setAttribute('role', 'menuitem');
        // A .logo span in a button that is not a connector card: still guarded.
        const other = document.createElement('button'), span = document.createElement('span'); span.className = 'logo'; span.append(logo); other.append(span);
        document.body.append(free); button.append(held); menuitem.append(item); document.body.append(button, menuitem, other);
        const fill = (svg) => getComputedStyle(svg.querySelector('.ic-af')).fill;
        return { free: fill(free), button: fill(held), menuitem: fill(item), logoElsewhere: fill(logo) };
      });
      ok(/^rgb/.test(g.free), `a decorative folder outside a control fills its tab (${g.free})`);
      ok(g.button === 'none' && g.menuitem === 'none' && g.logoElsewhere === 'none', `inside a button, a menu item or another button's .logo the tab is not painted (${g.button}, ${g.menuitem}, ${g.logoElsewhere})`);
      await ctx.close();
    }

    // Forced colours: the accent part and the current row's icon take the outline's colour.
    {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, forcedColors: 'active' });
      const page = await ctx.newPage();
      await routes(page, 'light', 'warm');
      await page.goto(`http://localhost:${PORT}/p/p-lab/sources`); await page.locator('.source-name').filter({ visible: true }).first().waitFor();
      const f = await page.evaluate(() => [...document.querySelectorAll("svg.ic[data-tone='decorative']")].filter((s) => s.getClientRects().length).flatMap((svg) => {
        const base = getComputedStyle(svg).color;
        return [...svg.querySelectorAll('.ic-a, .ic-af')].map((p) => ({ icon: svg.dataset.icon, base, paint: p.classList.contains('ic-af') ? getComputedStyle(p).fill : getComputedStyle(p).stroke }));
      }));
      ok(f.length >= 3, `forced colours: decorative parts measured (${f.length})`);
      ok(f.every((x) => x.paint === x.base), `forced colours: accent parts are neutral: ${JSON.stringify(f.filter((x) => x.paint !== x.base))}`);
      if (shots) await page.screenshot({ path: path.join(shots, 'forced-colors-sources.png') });
      await page.goto(`http://localhost:${PORT}/c/c1`); await page.locator('.chat-row.is-active').first().waitFor(); await page.waitForTimeout(250);
      const a = await page.locator(`.chat-row.is-active ${ACTIVE_ICON.replace('.app .sidebar.pane ', '')}`).first().evaluate((s) => ({ stroke: getComputedStyle(s).stroke, colour: getComputedStyle(s).color }));
      ok(a.stroke === a.colour, `forced colours: the current chat's icon is the outline colour (${JSON.stringify(a)})`);
      if (shots) await page.screenshot({ path: path.join(shots, 'forced-colors-active-chat.png') });
      await ctx.close();
    }

    ok(errors.length === 0, errors.join('\n'));
    if (ratios.length) {
      const low = ratios.reduce((m, x) => (x.ratio < m.ratio ? x : m));
      console.log(`active-row contrast: ${ratios.length} samples, lowest ${low.ratio.toFixed(2)}:1 (${low.name}, ${low.where})`);
    }
    console.log(shotsOnly ? `shots written to ${shots}` : `PASS icon tones (#1623): ${checked} checks; no control paints the accent except the current row; decorative icons, the Nextcloud tile and every empty state paint the theme accent in ${FAMILIES.length} families x light/dark x ${PALETTES.length} palettes at ${WIDTHS.map(([w]) => w).join('/')}; guard and forced colours hold.`);
  } finally { await browser.close(); await fixture.close(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
