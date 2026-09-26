// Spacing rhythm sweep against synthetic APIs only (no model, no inference, no live services).
// Screenshots every Settings category, Customise, Models, Projects, Diary, chat and the home
// composer across widths, themes, families and densities, and runs a geometry probe on each:
//   flush     a filled or bordered card whose text starts less than 8px from its inner edge
//             (the Settings → Appearance regression: content flush against the card's left side)
//   clipped   a focus/selection outline cut off by an ancestor that clips overflow
//   small     an interactive control under 44px tall on the phone layout
//   zoom      a Settings category shrunk past a last line by shrink-to-fit
//   overflow  horizontal page overflow
//
//   QA_DIST=/tmp/noevia-spacing-dist QA_SCREENSHOTS=/tmp/noevia-spacing-shots/after \
//   PLAYWRIGHT_MODULE=~/noevia-local-test/node_modules/playwright-core node qa/spacing-rhythm.cjs [quick]
// Writes <shots>/findings.json. Exits non-zero when any `flush` or `overflow` finding remains.
const os = require('node:os');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || `${os.homedir()}/noevia-local-test/node_modules/playwright-core`);
const fs = require('node:fs'), path = require('node:path');
const { withLocale } = require('./qa-locale.cjs');
const { createFixture } = require('./diary-fixture.cjs');
const out = process.env.QA_SCREENSHOTS || '/tmp/noevia-spacing-shots';
const PORT = 31477;
const QUICK = process.argv.includes('quick');
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

const CATEGORIES = [
  ['appearance', 'Appearance & language'], ['keyboard', 'Keyboard & input'], ['personalization', 'Assistant & style'],
  ['memory', 'Memory'], ['notifications', 'Notifications'], ['data', 'Your data & privacy'], ['usage', 'Usage'],
  ['profile', 'Account'], ['security', 'Security and login'], ['diary', 'Diary & storage'], ['connectors', 'Connected apps'],
  ['providers', 'AI providers'], ['users', 'Users'], ['models', 'Models & routing'], ['address', 'Web address'],
  ['features', 'Features'], ['experimental', 'Experimental'], ['backups', 'Backups'], ['status', 'Service status'],
  ['capabilities', 'Capabilities (status)'],
];

// Runs in the page. Returns spacing findings for the visible document.
function probe(phone) {
  const found = [];
  const transparent = (c) => !c || c === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(c);
  const name = (el) => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).join('.') : ''}`;
  const visible = (el) => el.checkVisibility ? el.checkVisibility({ opacityProperty: true, visibilityProperty: true }) : true;
  const roots = document.querySelectorAll('.settings-stage, .app-stack, .sidebar, [role="dialog"], .popup, .account-popover');
  const seen = new Set();
  for (const root of roots) for (const el of [root, ...root.querySelectorAll('*')]) {
    if (seen.has(el)) continue; seen.add(el);
    if (!visible(el)) continue;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (r.width < 160 || r.height < 36 || r.bottom < 0 || r.top > innerHeight) continue;
    if (/^(INPUT|TEXTAREA|SELECT|BUTTON|A|LABEL|LI|H\d|P|SPAN|SUMMARY|PRE|CODE)$/.test(el.tagName)) continue;
    const bordered = ['Left', 'Top'].every((s) => parseFloat(cs[`border${s}Width`]) > 0 && cs[`border${s}Style`] !== 'none' && !transparent(cs[`border${s}Color`]));
    const parent = el.parentElement ? getComputedStyle(el.parentElement) : null;
    // A fill is a colour or a gradient (Glass paints groups with a background-image).
    const filled = (!transparent(cs.backgroundColor) && parent && parent.backgroundColor !== cs.backgroundColor) || (cs.backgroundImage !== 'none' && /gradient/.test(cs.backgroundImage) && !/radial/.test(cs.backgroundImage));
    if (!(bordered || filled) || parseFloat(cs.borderTopLeftRadius) < 6) continue;
    const inner = r.left + parseFloat(cs.borderLeftWidth);
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let min = Infinity, sample = '';
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent.trim() || !visible(n.parentElement)) continue;
      const range = document.createRange(); range.selectNodeContents(n);
      const rr = range.getBoundingClientRect();
      if (!rr.width || rr.top < r.top || rr.bottom > r.bottom + 1) continue;
      if (rr.left - inner < min) { min = rr.left - inner; sample = n.textContent.trim().slice(0, 40); }
    }
    if (min < 8) found.push({ kind: 'flush', el: name(el), inset: Math.round(min * 10) / 10, text: sample, width: Math.round(r.width) });
  }
  // Selected/active nav rows whose outline or ring is cut by a clipping ancestor.
  for (const el of document.querySelectorAll('[aria-current="page"], .is-active, [aria-checked="true"], [aria-selected="true"]')) {
    if (!visible(el)) continue;
    const cs = getComputedStyle(el);
    const ring = (cs.outlineStyle !== 'none' ? Math.max(0, parseFloat(cs.outlineWidth) + parseFloat(cs.outlineOffset)) : 0)
      + Math.max(0, ...[...cs.boxShadow.matchAll(/(-?\d+(?:\.\d+)?)px\s+(-?\d+(?:\.\d+)?)px\s+(-?\d+(?:\.\d+)?)px\s+(-?\d+(?:\.\d+)?)px/g)].filter((m) => !/inset/.test(cs.boxShadow)).map((m) => parseFloat(m[4])));
    if (!ring) continue;
    const r = el.getBoundingClientRect();
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const as = getComputedStyle(a);
      if (!/(hidden|auto|scroll|clip)/.test(as.overflowX + as.overflowY)) continue;
      const ar = a.getBoundingClientRect();
      const gap = Math.min(r.left - ar.left, ar.right - r.right);
      if (gap < ring - 0.5) found.push({ kind: 'clipped', el: name(el), ring, gap: Math.round(gap * 10) / 10, clipper: name(a), text: (el.textContent || '').trim().slice(0, 30) });
      break;
    }
  }
  if (phone) for (const el of document.querySelectorAll('button, [role="button"], a[href], select, input:not([type="hidden"]), [role="tab"], [role="radio"]')) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || r.bottom < 0 || r.top > innerHeight) continue;
    // An invisible ::after hit area (phone.css) counts toward the target.
    const hit = getComputedStyle(el, '::after');
    const extra = hit.content !== 'none' && hit.position === 'absolute' ? { h: parseFloat(hit.height) || 0, w: parseFloat(hit.width) || 0 } : { h: 0, w: 0 };
    const h = Math.max(r.height, extra.h), w = Math.max(r.width, extra.w);
    if (h < 43.5 && w < 43.5 * 3) found.push({ kind: 'small', el: name(el), h: Math.round(h), w: Math.round(w), text: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30) });
  }
  // Shrink-to-fit (src/fit-to-viewport.ts) may fit a last line in Settings, never more.
  for (const area of document.querySelectorAll('.settings-detail-scroll')) {
    const zoom = [...area.children].map((c) => parseFloat(c.style.zoom)).find(Boolean);
    if (zoom && zoom < 0.94) found.push({ kind: 'zoom', zoom });
  }
  if (document.documentElement.scrollWidth > innerWidth + 1) found.push({ kind: 'overflow', scroll: document.documentElement.scrollWidth, width: innerWidth });
  return found;
}

const chat = (id, title, extra = {}) => ({ id, title, updatedAt: Date.UTC(2026, 8, 20), pinned: false, messages: [], ...extra });
const HISTORY = [
  { role: 'user', content: 'Summarise the synthetic notes in three points and flag anything that needs a decision.' },
  { role: 'assistant', content: '## Summary\n\n1. **Scope**: the synthetic fixture covers settings, panes and the composer.\n2. **Rhythm**: tight inside a group, generous between groups.\n3. **Depth**: flat, raised, overlay.\n\nOne item needs a decision: whether compact density should also trim card padding.\n\n```js\nconst family = "editorial";\n```' },
  { role: 'user', content: 'Keep compact for lists only.' },
  { role: 'assistant', content: 'Noted. Compact trims list and section gaps; card padding and 44px targets stay.' },
];

async function openSettings(page, phone) {
  const nav = page.getByRole('navigation', { name: 'Settings categories' });
  if (!await nav.isVisible().catch(() => false)) {
    if (phone) await page.getByRole('button', { name: 'Open navigation', exact: true }).click().catch(() => {});
    await page.getByRole('button', { name: /Account menu for/ }).click();
    await page.locator('.account-popover').getByRole('button', { name: 'Settings', exact: true }).click();
  }
  await nav.waitFor({ timeout: 8000 });
  return nav;
}

async function run(browser, cfg, surfaces, report) {
  const { width, height, theme, family, density = 'comfortable', phone = false } = cfg;
  const tag = `${family}-${theme}-${density}-${width}`;
  const page = await browser.newPage(withLocale({
    viewport: { width, height }, reducedMotion: 'reduce', deviceScaleFactor: 1,
    ...(phone ? { userAgent: IPHONE, isMobile: true, hasTouch: true } : {}),
  }));
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // The user's accents: Warm in light, Iris in dark.
  await page.addInitScript(({ theme, family, density }) => {
    localStorage.setItem('cowork-theme', theme);
    localStorage.setItem('cowork-palette-light', 'warm'); localStorage.setItem('cowork-palette-dark', 'iris');
    localStorage.setItem('noevia:theme-family', family); localStorage.setItem('noevia:density', density);
    // Every navigation starts on a new chat, never a restored Settings or detour view.
    localStorage.removeItem('noevia:last-view'); sessionStorage.removeItem('noevia-models-tab');
  }, { theme, family, density });
  const user = { id: 'synthetic-spacing-qa', username: 'spacingqa', displayName: 'Synthetic Spacing QA', role: 'admin', diaryEnabled: true, onboarded: true };
  await page.route(/\/api\/(auth\/session|profile)$/, (r) => r.fulfill({ json: { user, passkeys: [] } }));
  await page.route('**/api/profile/appearance', (r) => r.fulfill({ json: { theme, light: 'warm', dark: 'iris' } }));
  const project = { id: 'p1', name: 'Synthetic research', updatedAt: 1000, files: [], assets: [], memories: [], instructions: 'Keep answers short.', goal: 'Collect synthetic notes', sourceFolders: [], toolboxes: ['core'], chats: [chat('pc1', 'Synthetic project chat')] };
  await page.route('**/api/workspace', (r) => r.fulfill({ json: { projects: [project, { ...project, id: 'p2', name: 'Synthetic travel plans', chats: [] }], freeChats: [chat('c1', 'Synthetic trip plan'), chat('c2', 'A synthetic chat with a much longer title that has to truncate somewhere'), chat('c3', 'Synthetic notes')] } }));
  await page.route('**/api/chats/*/history', (r) => r.fulfill({ json: { revision: 'r1', history: HISTORY } }));
  await page.route('**/api/projects/p1/skills', (r) => r.fulfill({ json: { skills: [] } }));
  const shot = async (surface) => {
    await page.waitForTimeout(250);
    const findings = await page.evaluate(probe, phone).catch((e) => [{ kind: 'probe-error', error: e.message }]);
    const file = `${tag}-${surface}.png`;
    await page.screenshot({ path: path.join(out, file) });
    report.push({ file, family, theme, density, width, surface, findings });
  };
  const safe = async (surface, fn) => {
    try { await fn(); } catch (e) { report.push({ file: null, family, theme, density, width, surface, findings: [{ kind: 'nav-error', error: e.message.split('\n')[0] }] }); }
  };
  try {
    await page.goto(`http://localhost:${PORT}`);
    await page.getByPlaceholder('Message noevia…').waitFor();
    await page.evaluate(() => document.fonts.ready);
    const navClick = async (name) => {
      const toggle = page.getByRole('button', { name: 'Open navigation', exact: true });
      if (await toggle.isVisible().catch(() => false)) { await toggle.click(); await page.getByRole('dialog', { name: 'Navigation' }).waitFor(); }
      await page.locator('.sidebar').getByRole('button', { name, exact: true }).first().click();
    };
    const home = async () => { await page.goto(`http://localhost:${PORT}`); await page.getByPlaceholder('Message noevia…').waitFor(); };
    if (surfaces.includes('home')) await safe('home', () => shot('home'));
    if (surfaces.includes('chat')) await safe('chat', async () => {
      await navClick('Synthetic trip plan').catch(async () => { await page.getByText('Synthetic trip plan').first().click(); });
      await page.getByText('Keep compact for lists only.').waitFor({ timeout: 8000 });
      await shot('chat');
    });
    if (surfaces.includes('popover')) await safe('popover', async () => {
      await home();
      if (phone) await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
      await page.getByRole('button', { name: /Account menu for/ }).click();
      await page.locator('.account-popover').waitFor();
      await shot('account-popover');
      await page.keyboard.press('Escape');
    });
    const cats = CATEGORIES.filter(([id]) => surfaces.includes('settings:all') || surfaces.includes(`settings:${id}`));
    // Every surface has its own address (#359), so each shot starts from a clean load of it.
    const visit = async (route, ready) => { await page.goto(`http://localhost:${PORT}${route}`); await page.locator(ready).first().waitFor(); await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(500); };
    if (phone && surfaces.includes('settings:list')) await safe('settings-list', async () => {
      await visit('/settings/appearance', '.settings-detail-scroll');
      await page.getByRole('button', { name: 'All settings' }).first().click();
      await page.getByRole('navigation', { name: 'Settings categories' }).waitFor();
      await shot('settings-list');
    });
    for (const [id] of cats) await safe(`settings-${id}`, async () => {
      await visit(`/settings/${id}`, '.settings-detail-scroll');
      await shot(`settings-${id}`);
      // Long pages: a second frame from further down.
      const more = await page.evaluate(() => { const s = document.querySelector('.settings-detail-scroll'); if (!s || s.scrollHeight <= s.clientHeight + 40) return false; s.scrollTop = s.clientHeight - 80; return true; });
      if (more && !QUICK) await shot(`settings-${id}-2`);
    });
    if (surfaces.includes('models')) for (const tab of ['Overview', 'Your models', 'Discover', 'Routing', 'Hardware']) await safe(`models-${tab}`, async () => {
      await visit('/models', '[role="tab"]');
      await page.getByRole('tab', { name: new RegExp(`^${tab}`) }).first().click(); await page.waitForTimeout(400);
      await shot(`models-${tab.toLowerCase().replace(/\s+/g, '-')}`);
    });
    if (surfaces.includes('customise')) for (const tab of ['skills', 'connectors', 'plugins']) await safe(`customise-${tab}`, async () => {
      await visit(`/customise/${tab}`, '.plugins-page');
      await shot(`customise-${tab}`);
    });
    if (surfaces.includes('projects')) await safe('projects', async () => {
      await home(); await navClick('Projects');
      await page.locator('.project-card').first().waitFor({ timeout: 8000 });
      await shot('projects');
      await page.locator('.project-card').filter({ hasText: 'Synthetic research' }).first().click();
      await page.getByRole('tab', { name: /Chats/ }).first().waitFor({ timeout: 8000 });
      await shot('project-detail');
      await page.getByRole('tab', { name: /Sources/ }).first().click(); await page.waitForTimeout(300);
      await shot('project-sources');
    });
    if (surfaces.includes('diary')) await safe('diary', async () => {
      await home(); await navClick('Diary');
      await page.waitForTimeout(1200);
      await shot('diary');
    });
  } finally {
    if (errors.length) report.push({ file: null, family, theme, density, width, surface: 'pageerror', findings: errors.map((error) => ({ kind: 'pageerror', error })) });
    await page.close();
  }
}

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const fixture = createFixture(PORT); await fixture.listen();
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const report = [];
  const everything = ['home', 'chat', 'popover', 'settings:all', 'models', 'customise', 'projects', 'diary'];
  const core = ['home', 'chat', 'settings:appearance', 'settings:connectors', 'settings:usage', 'customise', 'projects'];
  const plan = process.argv.includes('final') ? [
    [{ width: 1440, height: 900, theme: 'dark', family: 'editorial' }, ['chat', 'popover', 'settings:all', 'customise', 'projects', 'diary']],
    [{ width: 1440, height: 900, theme: 'dark', family: 'editorial', density: 'compact' }, ['chat', 'settings:appearance', 'settings:personalization', 'settings:usage', 'customise']],
    [{ width: 390, height: 844, theme: 'light', family: 'editorial', phone: true }, ['home', 'chat', 'popover', 'settings:list', 'settings:appearance', 'settings:personalization', 'customise', 'projects', 'diary']],
  ] : QUICK ? [
    [{ width: 1440, height: 900, theme: 'dark', family: 'editorial' }, ['settings:appearance', 'settings:users', 'chat']],
    [{ width: 390, height: 844, theme: 'light', family: 'editorial', phone: true }, ['settings:list', 'settings:appearance', 'projects', 'chat']],
  ] : [
    [{ width: 1440, height: 900, theme: 'dark', family: 'editorial' }, everything],
    [{ width: 1440, height: 900, theme: 'light', family: 'editorial' }, everything],
    [{ width: 1440, height: 900, theme: 'dark', family: 'editorial', density: 'compact' }, ['chat', 'settings:appearance', 'settings:personalization', 'settings:usage', 'customise', 'models']],
    [{ width: 1440, height: 900, theme: 'light', family: 'editorial', density: 'compact' }, ['chat', 'settings:appearance', 'settings:connectors']],
    [{ width: 768, height: 1024, theme: 'light', family: 'editorial' }, core],
    [{ width: 768, height: 1024, theme: 'dark', family: 'editorial' }, core],
    [{ width: 390, height: 844, theme: 'light', family: 'editorial', phone: true }, ['home', 'chat', 'popover', 'settings:list', 'settings:appearance', 'settings:personalization', 'settings:usage', 'settings:connectors', 'settings:status', 'customise', 'projects', 'diary']],
    [{ width: 390, height: 844, theme: 'dark', family: 'editorial', phone: true }, ['home', 'chat', 'settings:list', 'settings:appearance', 'settings:usage', 'customise', 'projects']],
    [{ width: 390, height: 844, theme: 'dark', family: 'editorial', density: 'compact', phone: true }, ['chat', 'settings:appearance']],
    [{ width: 1440, height: 900, theme: 'dark', family: 'contemporary' }, ['chat', 'settings:appearance', 'settings:personalization', 'customise']],
    [{ width: 1440, height: 900, theme: 'light', family: 'contemporary' }, ['settings:appearance', 'settings:connectors']],
    [{ width: 1440, height: 900, theme: 'dark', family: 'glass' }, ['chat', 'settings:appearance', 'settings:personalization', 'customise']],
    [{ width: 1440, height: 900, theme: 'light', family: 'glass' }, ['settings:appearance', 'settings:connectors']],
    [{ width: 390, height: 844, theme: 'dark', family: 'glass', phone: true }, ['settings:appearance']],
  ];
  try {
    for (const [cfg, surfaces] of plan) await run(browser, cfg, surfaces, report);
  } finally { await browser.close(); await fixture.close?.(); }
  fs.writeFileSync(path.join(out, 'findings.json'), JSON.stringify(report, null, 1));
  const count = (k) => report.reduce((n, r) => n + r.findings.filter((f) => f.kind === k).length, 0);
  const summary = ['flush', 'clipped', 'small', 'zoom', 'overflow', 'nav-error', 'pageerror', 'probe-error'].map((k) => `${k}=${count(k)}`).join(' ');
  console.log(`spacing-rhythm: ${report.filter((r) => r.file).length} screenshots in ${out}; ${summary}`);
  if (count('flush') || count('overflow') || count('zoom')) process.exitCode = 1;
})().catch((e) => { console.error(e); process.exitCode = 1; });
