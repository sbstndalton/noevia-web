// #1623 two-tone icons, browser proof. Synthetic APIs only (qa/diary-fixture.cjs on its own local
// port plus page routes): no model, no inference, no real Diary, no live server.
//   npm run build && node qa/icon-tones-1623.cjs
// PLAYWRIGHT_MODULE overrides the Playwright module (default ~/noevia-local-test/node_modules/playwright-core).
// QA_SHOTS=<dir> writes screenshots of the sidebar, the composer (with its + menu), a Settings page,
// a project's source list and an empty state at 375, 768 and 1440 wide, in every theme family, light
// and dark (iris), plus the source list in every palette at 1440. QA_SHOTS_ONLY=1 skips the
// assertions (the "before" set on an older build); QA_DIST serves another build.
// The assertions pin the rule, measured in the real cascade:
//   controls    no icon inside a button, link, summary, label, menu item, tab, option or toggle paints
//               an accent part, on any screen, family, mode or width
//   decorative  information-only icons (source and folder markers, the storage path, the empty state,
//               Settings search) paint their inner part in the theme's own --icon-accent, distinct
//               from the outline, and the accent changes with the palette
//   guard       a decorative icon dropped into a button falls back to the neutral colour
//   forced      under forced colours the accent part takes the outline's colour
const os = require('node:os');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || `${os.homedir()}/noevia-local-test/node_modules/playwright-core`);
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { createFixture } = require('./diary-fixture.cjs');
const PORT = 31623;
const shots = process.env.QA_SHOTS || '';
const shotsOnly = process.env.QA_SHOTS_ONLY === '1';
const FAMILIES = ['editorial', 'contemporary', 'glass'], MODES = ['light', 'dark'], PALETTES = ['iris', 'warm', 'cool', 'neutral', 'sage'];
const WIDTHS = [[375, 812], [768, 1024], [1440, 900]];

const user = { id: 'synthetic-icons-1623', username: 'iconqa', displayName: 'Icon QA', role: 'member', diaryEnabled: true, onboarded: true };
const project = {
  id: 'p-lab', name: 'Synthetic lab', goal: 'A synthetic project for the icon screenshots.', instructions: 'Answer in short steps.', memories: [],
  files: [{ name: 'synthetic-notes.md', content: '# Notes' }, { name: 'synthetic-plan.txt', content: 'plan' }, { name: 'Documents/Synthetic/manual.md', content: 'manual', source: 'Documents/Synthetic' }],
  assets: [], sourceFolders: ['Documents/Synthetic', 'Documents/Manuals'], projectFolder: 'noevia projects/Synthetic lab', toolboxes: ['core'], modes: ['chat'],
  chats: [{ id: 'pc1', title: 'Synthetic pool layout', preview: 'Two mirrors', updatedAt: 1000, pinned: true }], createdAt: 1000, updatedAt: 1000,
};
const freeChats = [{ id: 'c1', title: 'Synthetic trip plan', updatedAt: 1000, pinned: false, messages: [] }, { id: 'c2', title: 'Synthetic notes', updatedAt: 900, pinned: false, messages: [] }];

async function routes(page, theme, palette) {
  await page.route('**/api/profile', (r) => r.fulfill({ json: { user, passkeys: [] } }));
  await page.route('**/api/auth/session', (r) => r.fulfill({ json: { user, passkeys: [] } }));
  await page.route('**/api/profile/appearance', (r) => r.fulfill({ json: { theme, light: palette, dark: palette } }));
  await page.route('**/api/workspace', (r) => r.fulfill({ json: { projects: [project], freeChats } }));
  await page.route('**/api/projects/*/skills', (r) => r.fulfill({ json: { skills: [] } }));
  await page.route('**/api/projects/*/instruction-skills', (r) => r.fulfill({ json: { skills: [] } }));
  await page.route('**/api/projects/*/sources/sync', (r) => r.fulfill({ json: { updated: [], skipped: [] } }));
}

/** Every visible icon on the page, measured in the cascade: controls that paint an accent part, and
 *  decorative icons whose accent part is (or is not) the theme's --icon-accent. */
function measure() {
  const PRESSABLE = "button, a, summary, label, [role='button'], [role='link'], [role='menuitem'], [role='menuitemradio'], [role='menuitemcheckbox'], [role='tab'], [role='option'], [role='switch'], [role='checkbox'], [role='radio'], [role='treeitem']";
  const probe = document.createElement('i');
  const resolve = (host, value) => { probe.style.color = value; host.appendChild(probe); const c = getComputedStyle(probe).color; probe.remove(); return c; };
  const out = { controls: 0, controlAccents: [], decorative: 0, accented: 0, wrong: [], accents: [], outlines: [] };
  for (const svg of document.querySelectorAll('svg.ic')) {
    if (!svg.getClientRects().length) continue;
    const base = getComputedStyle(svg).stroke;
    const parts = [...svg.querySelectorAll('.ic-a, .ic-af')];
    const painted = parts.filter((p) => (p.classList.contains('ic-af') ? getComputedStyle(p).fill !== 'none' : getComputedStyle(p).stroke !== base));
    const control = svg.closest(PRESSABLE);
    if (control) {
      out.controls++;
      if (painted.length) out.controlAccents.push(`${svg.dataset.icon} (${svg.dataset.tone}) in <${control.tagName.toLowerCase()} class="${control.className}">`);
      continue;
    }
    if (svg.dataset.tone !== 'decorative') continue;
    out.decorative++;
    if (!parts.length) continue;
    out.accented++;
    const accent = resolve(svg.parentElement, 'var(--icon-accent)');
    for (const p of parts) {
      const paint = p.classList.contains('ic-af') ? getComputedStyle(p).fill : getComputedStyle(p).stroke;
      if (paint !== accent) out.wrong.push(`${svg.dataset.icon}: ${paint} is not the accent ${accent}`);
    }
    out.accents.push(accent); out.outlines.push(base);
  }
  return out;
}

/** Opens the linked reference folders, so their folder markers are on screen too. */
async function openFolders(page) {
  await page.evaluate(() => { for (const d of document.querySelectorAll('details')) if (/folder/i.test(d.querySelector('summary')?.textContent || '')) d.open = true; });
  await page.waitForTimeout(150);
}

async function screens(page, width, name, shoot) {
  const go = async (url, ready) => { await page.goto(`http://localhost:${PORT}${url}`); await ready(); await page.waitForTimeout(250); };
  const result = {};
  // Sidebar (a drawer on a phone).
  await go('/', () => page.getByPlaceholder('Message noevia…').waitFor());
  const toggle = page.getByRole('button', { name: 'Open navigation', exact: true });
  if (await toggle.isVisible()) { await toggle.click(); await page.getByRole('dialog', { name: 'Navigation' }).waitFor(); await page.waitForTimeout(400); }
  result.sidebar = await page.evaluate(measure); await shoot(`${name}-sidebar`);
  // Composer with its + menu open: menu items are controls.
  await go('/', () => page.getByPlaceholder('Message noevia…').waitFor());
  await page.locator('.composer-add').filter({ visible: true }).first().click();
  await page.locator('.composer-actions-panel').waitFor();
  await page.waitForTimeout(250);
  result.composer = await page.evaluate(measure); await shoot(`${name}-composer`);
  await page.keyboard.press('Escape');
  // A Settings page.
  await go('/settings/appearance', () => page.getByRole('dialog', { name: 'Settings' }).waitFor());
  await page.waitForTimeout(400);
  result.settings = await page.evaluate(measure); await shoot(`${name}-settings`);
  // A project's source list: file and folder markers, the storage path.
  await go('/p/p-lab/sources', () => page.locator('.source-name').filter({ visible: true }).first().waitFor());
  await openFolders(page);
  result.sources = await page.evaluate(measure); await shoot(`${name}-sources`);
  // An empty state: a project link that names no project.
  await go('/p/no-such-project', () => page.locator('.empty-state-card').waitFor());
  result.empty = await page.evaluate(measure); await shoot(`${name}-empty`);
  return result;
}

(async () => {
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const fixture = createFixture(PORT); await fixture.listen();
  const browser = await chromium.launch({ headless: true, channel: process.env.QA_CHANNEL || 'chrome' });
  const errors = [], seenAccents = new Map();
  const ok = (cond, msg) => { if (!shotsOnly) assert.ok(cond, msg); };
  try {
    for (const family of FAMILIES) for (const theme of MODES) for (const [width, height] of WIDTHS) {
      const phone = width < 768;
      const ctx = await browser.newContext({ viewport: { width, height }, isMobile: phone, hasTouch: phone, colorScheme: theme });
      const page = await ctx.newPage(); page.on('pageerror', (e) => errors.push(`${family} ${theme} ${width}: ${e.message}`));
      await page.addInitScript(({ t, f }) => { localStorage.setItem('cowork-theme', t); localStorage.setItem('noevia:theme-family', f); localStorage.setItem('cowork-palette-light', 'iris'); localStorage.setItem('cowork-palette-dark', 'iris'); }, { t: theme, f: family });
      await routes(page, theme, 'iris');
      const name = `${family}-${theme}-${width}`;
      const shoot = async (file) => { if (shots) await page.screenshot({ path: path.join(shots, `${file}.png`) }); };
      const r = await screens(page, width, name, shoot);
      for (const [screen, m] of Object.entries(r)) {
        ok(m.controlAccents.length === 0, `${name} ${screen}: a control paints an accent part: ${m.controlAccents.join('; ')}`);
        ok(m.wrong.length === 0, `${name} ${screen}: ${m.wrong.join('; ')}`);
        ok(m.accents.every((a, i) => a !== m.outlines[i]), `${name} ${screen}: the accent part is distinct from the outline`);
      }
      ok(r.sidebar.controls >= 6 && r.composer.controls >= 4, `${name}: controls measured (${r.sidebar.controls}, ${r.composer.controls})`);
      ok(r.sources.accented >= 3, `${name} sources: file and folder markers are two-tone (${r.sources.accented})`);
      ok(r.empty.accented === 1, `${name} empty state: its symbol is two-tone (${r.empty.accented})`);
      if (width === 1440) ok(r.settings.decorative >= 1, `${name} settings: the search field symbol is decorative`);
      await ctx.close();
    }

    // Every palette shows up: the source list at 1440, each family, light and dark.
    for (const family of FAMILIES) for (const theme of MODES) for (const palette of PALETTES) {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: theme });
      const page = await ctx.newPage(); page.on('pageerror', (e) => errors.push(`${family} ${theme} ${palette}: ${e.message}`));
      await page.addInitScript(({ t, f, p }) => { localStorage.setItem('cowork-theme', t); localStorage.setItem('noevia:theme-family', f); localStorage.setItem('cowork-palette-light', p); localStorage.setItem('cowork-palette-dark', p); }, { t: theme, f: family, p: palette });
      await routes(page, theme, palette);
      await page.goto(`http://localhost:${PORT}/p/p-lab/sources`); await page.locator('.source-name').filter({ visible: true }).first().waitFor(); await openFolders(page); await page.waitForTimeout(250);
      const m = await page.evaluate(measure);
      ok(m.wrong.length === 0 && m.controlAccents.length === 0, `${family} ${theme} ${palette}: ${[...m.wrong, ...m.controlAccents].join('; ')}`);
      ok(m.accented >= 3, `${family} ${theme} ${palette}: two-tone markers (${m.accented})`);
      seenAccents.set(`${family}-${theme}-${palette}`, m.accents[0]);
      if (shots) await page.screenshot({ path: path.join(shots, `palette-${family}-${theme}-${palette}-sources.png`) });
      await ctx.close();
    }
    for (const family of FAMILIES) for (const theme of MODES) {
      const colours = new Set(PALETTES.map((p) => seenAccents.get(`${family}-${theme}-${p}`)));
      ok(colours.size === PALETTES.length, `${family} ${theme}: each palette paints its own accent (${[...colours].join(', ')})`);
    }

    // The CSS guard, in the real cascade: the same decorative icon outside and inside a button.
    {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await ctx.newPage();
      await routes(page, 'dark', 'warm');
      await page.goto(`http://localhost:${PORT}/p/p-lab/sources`); await page.locator('.source-name').filter({ visible: true }).first().waitFor();
      const g = await page.evaluate(() => {
        const marker = document.querySelector(".source-name svg.ic[data-tone='decorative'][data-icon='folder'], .storage-path svg.ic[data-tone='decorative']");
        if (!marker) return { free: 'no decorative folder', button: 'none', menuitem: 'none' };
        const free = marker.cloneNode(true), held = marker.cloneNode(true), item = marker.cloneNode(true);
        const button = document.createElement('button'), menuitem = document.createElement('div');
        menuitem.setAttribute('role', 'menuitem');
        document.body.append(free); button.append(held); menuitem.append(item); document.body.append(button, menuitem);
        const fill = (svg) => getComputedStyle(svg.querySelector('.ic-af')).fill;
        return { free: fill(free), button: fill(held), menuitem: fill(item) };
      });
      ok(/^rgb/.test(g.free), `a decorative folder outside a control fills its tab (${g.free})`);
      ok(g.button === 'none' && g.menuitem === 'none', `inside a button or menu item the tab is not painted (${g.button}, ${g.menuitem})`);
      await ctx.close();
    }

    // Forced colours: the accent part takes the outline's colour.
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
      await ctx.close();
    }

    ok(errors.length === 0, errors.join('\n'));
    console.log(shotsOnly ? `shots written to ${shots}` : 'PASS icon tones (#1623): no control paints an accent; decorative icons paint the theme accent in 3 families x light/dark x 5 palettes at 375/768/1440; guard and forced colours hold.');
  } finally { await browser.close(); await fixture.close(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
