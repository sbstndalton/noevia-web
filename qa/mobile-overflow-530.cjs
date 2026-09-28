// #530: on a phone nothing may be wider than the screen. The drawer scrolled sideways on an
// iPhone because content pushed past its edge. This walks every main surface at 320, 375, 390 and
// 430 wide, in each theme family, light and dark, and at every state asserts:
//   1. document and body: scrollWidth <= clientWidth + 1;
//   2. every scroll container (the drawer included): scrollWidth <= clientWidth + 1, unless it is
//      an intended horizontal scroller (HORIZONTAL_SCROLLERS: code blocks, table wrappers…);
//   3. no visible element's right edge passes the viewport or its nearest clipping container.
// Each offender is logged with a selector, its measured width and the likely cause.
// It also measures tier-2 density at 390x844 (drawer rows and settings rows fully on screen) and
// a tier-0 geometry fingerprint at 1440x900, so a before/after pair of runs shows both.
// Built app, synthetic fixture: every API answer below is invented; nothing reaches inference,
// storage or a diary.
//   npm run build -- --outDir /tmp/x && QA_DIST=/tmp/x QA_SCREENSHOTS=<dir> node qa/mobile-overflow-530.cjs
// QA_QUICK=1 walks one family/theme per width instead of all six.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || `${os.homedir()}/noevia-local-test/node_modules/playwright-core`);
const { createFixture } = require('./diary-fixture.cjs');
const port = Number(process.env.QA_PORT || 31653), origin = `http://localhost:${port}`;
const out = process.env.QA_SCREENSHOTS || path.join(os.tmpdir(), 'noevia-mobile-overflow-530');
const SIZES = [[320, 640], [375, 812], [390, 844], [430, 932]];
const FAMILIES = ['editorial', 'contemporary', 'glass'], THEMES = ['light', 'dark'];

// Intended horizontal scrollers: content that must keep its lines (code, tables) scrolls inside
// its own wrapper instead of wrapping. Anything inside one is exempt from rule 3.
const HORIZONTAL_SCROLLERS = [
  'pre', '.md-code', '.code-block', '.md-table-wrap', '.table-wrap', '.md-table', 'table',
  '.chip-carousel', '.chip-scroller',
].join(', ');

// ── Synthetic data: long names, long tokens, wide content ──────────────────
const LONG_URL = 'https://synthetic.example.test/' + 'a-very-long-path-segment/'.repeat(6) + '?query=' + 'x'.repeat(48);
const LONG_FILE = 'Synthetic-' + 'unbroken-file-name-'.repeat(6) + 'final.pdf';
const LONG_PROJECT = 'A synthetic project with an exceptionally long name that has to truncate somewhere';
const UNBROKEN_PROJECT = 'Synthetic-project-with-an-unbroken-name-that-goes-on-and-on-and-on';
const LONG_CHAT = 'A synthetic conversation whose title is far too long to fit on one phone row';
const UNBROKEN_CHAT = 'synthetic_chat_title_without_any_spaces_at_all_' + 'z'.repeat(30);
const project = (id, name, extra = {}) => ({ id, name, updatedAt: 5, files: [], assets: [], chats: [], goal: '', instructions: '', memories: [], toolboxes: ['core'], ...extra });
const PROJECTS = [
  project('p1', LONG_PROJECT, { pinned: true, goal: 'Synthetic goal ' + LONG_URL, instructions: 'Synthetic instructions',
    files: [{ name: LONG_FILE, content: 'synthetic' }], chats: [{ id: 'pc1', title: LONG_CHAT, updatedAt: 4 }] }),
  project('p2', UNBROKEN_PROJECT, { updatedAt: 4 }),
  project('p3', 'Short project', { updatedAt: 3 }),
];
const FREE_CHATS = [
  { id: 'long', title: LONG_CHAT, pinned: true, updatedAt: 20 },
  { id: 'unbroken', title: UNBROKEN_CHAT, pinned: true, updatedAt: 19 },
  ...Array.from({ length: 16 }, (_, i) => ({ id: `c${i}`, title: i % 3 ? `Synthetic chat ${i}` : `${LONG_CHAT} ${i}`, updatedAt: 18 - i })),
];
const WIDE_TABLE = ['| ' + Array.from({ length: 9 }, (_, i) => `Column ${i + 1} heading`).join(' | ') + ' |',
  '|' + ' --- |'.repeat(9), '| ' + Array.from({ length: 9 }, (_, i) => `value-${i}-${'q'.repeat(12)}`).join(' | ') + ' |'].join('\n');
const HISTORY = [
  { role: 'user', content: `Please read ${LONG_URL} and the attached ${LONG_FILE}` },
  { role: 'assistant', content: [
    '## Synthetic long content', '', `A link that never breaks: ${LONG_URL}`, '', `A file name: **${LONG_FILE}** and \`${'inline_code_token_'.repeat(5)}\`.`, '',
    '```js', `const syntheticLongLine = ${JSON.stringify('y'.repeat(180))}; // a long code line`, '```', '', WIDE_TABLE, '',
    `> A quoted ${'unbroken'.repeat(12)} token`, '', '- ' + 'listitem'.repeat(14),
  ].join('\n') },
  { role: 'user', content: 'x'.repeat(220) },
];
const ADMIN = { id: 'synthetic-admin', username: 'synthetic-admin-with-a-long-username', displayName: 'Synthetic Administrator With A Long Display Name', role: 'admin', diaryEnabled: true, onboarded: true, email: 'synthetic.administrator.with.a.long.address@example.test' };
const USERS = { users: [ADMIN, { id: 'm1', username: 'member_' + 'n'.repeat(40), displayName: 'Synthetic member ' + 'w'.repeat(30), role: 'member' }] };
const PERMITTED = { mode: 'chat', boxes: [{ id: 'core', label: 'Synthetic core toolbox with a long label', description: 'Synthetic tools ' + LONG_URL, source: 'builtin', state: 'available', reason: null, active: false,
  tools: [{ name: 'synthetic_lookup_' + 'long_'.repeat(8), description: 'Looks up nothing real', write: false, permission: 'allowed', reason: null }] }] };

// ── The in-page audit ───────────────────────────────────────────────────────
function audit(allow) {
  const vw = document.documentElement.clientWidth, found = [];
  const name = (el) => {
    if (!el || el === document.body) return 'body';
    const cls = [...el.classList].filter(c => !/^is-|^has-/.test(c)).slice(0, 3).map(c => '.' + c).join('');
    const label = el.getAttribute('aria-label');
    return el.tagName.toLowerCase() + cls + (label ? `[aria-label="${label.slice(0, 40)}"]` : '');
  };
  const pathOf = (el) => { const parts = []; for (let n = el; n && n !== document.body && parts.length < 3; n = n.parentElement) parts.unshift(name(n)); return parts.join(' > '); };
  const shown = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse' || +cs.opacity === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  };
  const inertOrHidden = (el) => !!el.closest('[inert], [hidden], [aria-hidden="true"]:not(svg):not(svg *)');
  const scrolls = (cs) => /auto|scroll/.test(cs.overflowX) || /auto|scroll/.test(cs.overflowY);
  const clips = (cs) => cs.overflowX !== 'visible';
  // Why is this box wider than its room? Heuristics a person would check first.
  const cause = (el) => {
    const cs = getComputedStyle(el), parent = el.parentElement, pcs = parent && getComputedStyle(parent), why = [];
    const text = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join(' ');
    const longest = Math.max(0, ...text.split(/\s+/).map(w => w.length));
    if (longest > 24 && cs.overflowWrap === 'normal' && cs.wordBreak === 'normal') why.push(`unbroken ${longest}-char token`);
    if (/nowrap|pre/.test(cs.whiteSpace) && cs.textOverflow !== 'ellipsis') why.push(`white-space:${cs.whiteSpace}`);
    if (pcs && /flex|grid/.test(pcs.display) && cs.minWidth === 'auto') why.push(`${pcs.display} item with min-width:auto`);
    if (pcs && /grid/.test(pcs.display) && !/minmax\(0/.test(pcs.gridTemplateColumns)) why.push(`grid columns ${pcs.gridTemplateColumns.slice(0, 60)}`);
    if (cs.minWidth !== 'auto' && cs.minWidth !== '0px') why.push(`min-width:${cs.minWidth}`);
    if (parseFloat(cs.marginRight) < 0 || parseFloat(cs.marginLeft) < 0) why.push(`negative margin ${cs.marginLeft}/${cs.marginRight}`);
    if (el.style.width) why.push(`inline width ${el.style.width}`);
    if (/^(img|video|canvas|input|select|textarea|iframe)$/i.test(el.tagName) && cs.maxWidth === 'none') why.push('replaced/form element without max-width');
    if (parent && Math.round(el.getBoundingClientRect().width) > parent.clientWidth + 1) why.push(`width ${cs.width} > parent ${parent.clientWidth}px`);
    return why.join('; ') || 'content wider than its box';
  };
  // The outermost descendants that stick out past a box's inner right edge.
  const culprits = (box) => {
    const limit = box.getBoundingClientRect().left + box.clientLeft + box.clientWidth + 1, list = [];
    const walk = (node) => { for (const c of node.children) {
      if (!shown(c)) continue;
      if (c.getBoundingClientRect().right > limit && !c.closest(allow)) { list.push(c); if (list.length >= 3) return; }
      else if (!clips(getComputedStyle(c))) walk(c); // a clipping child cannot widen the box
    } };
    walk(box);
    return list.map(c => ({ selector: pathOf(c), width: Math.round(c.getBoundingClientRect().width), cause: cause(c) }));
  };
  const de = document.documentElement, body = document.body;
  for (const [el, label] of [[de, 'html'], [body, 'body']]) {
    if (el.scrollWidth > el.clientWidth + 1) found.push({ rule: 'page', selector: label, width: el.scrollWidth, room: el.clientWidth, culprits: culprits(body) });
  }
  const edge = new Set();
  for (const el of body.querySelectorAll('*')) {
    if (el.closest('svg') && el.tagName.toLowerCase() !== 'svg') continue;
    if (!shown(el) || inertOrHidden(el)) continue;
    const cs = getComputedStyle(el);
    // Rule 2: a scroll container must not scroll sideways, unless it is meant to.
    if (scrolls(cs) && el.scrollWidth > el.clientWidth + 1 && !el.matches(allow))
      found.push({ rule: 'scroller', selector: pathOf(el), width: el.scrollWidth, room: el.clientWidth, culprits: culprits(el) });
    // Rule 3: nothing sticks out past the viewport or the box that clips it.
    if (el.parentElement && el.parentElement.closest(allow)) continue;
    // Rule 3, text: a long word overflowing its own box (the box fits, its text does not).
    if (!el.matches(allow) && cs.display !== 'inline' && cs.overflowX === 'visible' && el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1
      && [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) {
      const range = document.createRange(); range.selectNodeContents(el);
      const textRight = Math.max(...[...range.getClientRects()].map(q => q.right)), boxRight = el.getBoundingClientRect().right - el.clientLeft - parseFloat(cs.paddingRight);
      if (textRight > boxRight + 1) found.push({ rule: 'text', selector: pathOf(el), width: Math.round(textRight - el.getBoundingClientRect().left), room: el.clientWidth, cause: cause(el) });
    }
    if (cs.clipPath && cs.clipPath !== 'none' && el.getBoundingClientRect().width <= 2) continue; // visually hidden
    const r = el.getBoundingClientRect();
    let limit = vw, clipper = null;
    if (cs.position !== 'fixed') for (let n = el.parentElement; n && n !== body; n = n.parentElement) {
      const ncs = getComputedStyle(n);
      if (clips(ncs)) { clipper = n; const nr = n.getBoundingClientRect(); limit = Math.min(vw, nr.left + n.clientLeft + n.clientWidth); break; }
      if (ncs.position === 'fixed') break;
    }
    if (r.left >= limit - 1) continue; // parked entirely outside (a closed pane), not visible
    if (r.right > limit + 1) edge.add(el), found.push({ rule: 'edge', el, selector: pathOf(el), width: Math.round(r.width), right: Math.round(r.right), room: Math.round(limit), clipper: clipper ? name(clipper) : 'viewport', cause: cause(el) });
  }
  // Keep only the outermost element of a run that sticks out together.
  return found.filter(f => f.rule !== 'edge' || ![...edge].some(o => o !== f.el && o.contains(f.el))).map(({ el, ...rest }) => rest);
}

async function open(browser, { width, height, family, theme, touch = true, path: route = '/' }) {
  const page = await browser.newPage({ viewport: { width, height }, isMobile: touch, hasTouch: touch, reducedMotion: 'reduce' });
  await page.addInitScript(([f, t]) => { if (f) localStorage.setItem('noevia:theme-family', f); if (t) localStorage.setItem('cowork-theme', t); }, [family, theme]);
  page.setDefaultTimeout(6000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('https://**/*', r => r.abort());
  await page.route(u => ['/api/auth/session', '/api/profile'].includes(u.pathname), r => r.fulfill({ json: { user: ADMIN, passkeys: [] } }));
  await page.route('**/api/admin/users', r => r.fulfill({ json: USERS }));
  await page.route('**/api/toolboxes', r => r.fulfill({ json: { toolboxes: [{ id: 'core', label: 'Synthetic core', description: 'Synthetic tools', source: 'builtin', toolCount: 1, estTokens: 10 }],
    mcp: { configured: true, discovered: 12, servers: [{ id: 'synthetic-server-with-a-very-long-identifier-' + 'k'.repeat(20), auth: 'internal', error: null, discovered: 12 }] } } }));
  await page.route(u => u.pathname === '/api/toolboxes/permitted', r => r.fulfill({ json: PERMITTED }));
  await page.route('**/api/workspace', r => r.fulfill({ json: { projects: PROJECTS, freeChats: FREE_CHATS } }));
  await page.route('**/api/chats/*/history', r => r.fulfill({ json: { revision: 'r1', history: /\/chats\/long\//.test(r.request().url()) ? HISTORY : [] } }));
  await page.route('**/api/chats/*/context', r => r.fulfill({ json: { project: { id: '__free-synthetic', name: 'Synthetic free chat', routing: 'auto', files: [], assets: [], toolboxes: ['core'] } } }));
  await page.route('**/api/models/installed', r => r.fulfill({ json: [{ name: 'synthetic-model-with-a-long-gguf-file-name-UD-Q4_K_XL', labels: [] }] }));
  await page.goto(origin + route);
  await page.locator('#root *').first().waitFor();
  await page.waitForTimeout(300);
  return { page, errors };
}
// /settings reopens the last page read; the list is one step back from it on a phone.
async function settingsList(page) {
  await page.locator('.settings-stage').waitFor();
  await page.waitForTimeout(400); // the saved page opens a beat after the stage mounts
  if (await page.locator('.settings-stage[data-view="detail"]').count()) await page.getByRole('button', { name: 'All settings', exact: true }).click();
  await page.locator('.settings-navigation nav button').first().waitFor();
  await page.waitForTimeout(150);
}
const composer = (page) => page.getByRole('textbox', { name: 'Message', exact: true });
async function openDrawer(page) {
  const toggle = page.getByRole('button', { name: 'Open navigation', exact: true });
  await toggle.click();
  await page.getByRole('dialog', { name: 'Navigation' }).waitFor();
  await page.waitForTimeout(150);
}

// Every state: [name, path to open, steps that reach it]. A state that cannot be reached is itself
// a failure, so a run against an older build still lists everything it misses.
const STATES = [
  ['home', '/', async (p) => { await composer(p).waitFor(); }],
  ['chat with long content', '/c/long', async (p) => { await p.locator('.msg').nth(1).waitFor(); await p.waitForTimeout(200); }],
  ['drawer', '/c/long', async (p) => { await openDrawer(p); }],
  ['drawer scrolled to recents', '/', async (p) => { await openDrawer(p); await p.locator('.sidebar .chat-row').last().scrollIntoViewIfNeeded(); }],
  ['drawer chat ⋯ menu', '/', async (p) => { await openDrawer(p); await p.getByRole('button', { name: `Options for ${UNBROKEN_CHAT}`, exact: true }).click(); await p.getByRole('menu').waitFor(); }],
  ['drawer project ⋯ menu', '/', async (p) => { await openDrawer(p); await p.getByRole('button', { name: `Options for ${LONG_PROJECT}`, exact: true }).click(); await p.getByRole('menu').waitFor(); }],
  ['account menu', '/', async (p) => { await openDrawer(p); await p.getByRole('button', { name: /Account menu for/ }).click(); await p.locator('.account-popover').waitFor(); }],
  ['+ menu', '/', async (p) => { await p.getByRole('button', { name: /^Add files and tools/ }).click(); await p.locator('.composer-actions-panel').waitFor(); }],
  ['tool catalogue', '/', async (p) => { await p.getByRole('button', { name: /^Add files and tools/ }).click(); await p.locator('.composer-actions-panel .composer-browse-tools').click(); await p.locator('.tool-catalogue-panel').waitFor(); await p.waitForTimeout(150); }],
  ['model sheet', '/', async (p) => { await p.getByRole('button', { name: /^Choose model: / }).first().click(); await p.locator('.mp-panel').waitFor(); await p.waitForTimeout(150); }],
  ['archive toast', '/', async (p) => { await openDrawer(p); await p.getByRole('button', { name: 'Options for Synthetic chat 1', exact: true }).click(); await p.getByRole('menuitem', { name: 'Archive', exact: true }).click(); await p.locator('.save-error.is-notice').waitFor(); }],
  ['delete dialog', '/', async (p) => { await openDrawer(p); await p.getByRole('button', { name: `Options for ${UNBROKEN_CHAT}`, exact: true }).click(); await p.getByRole('menuitem', { name: /^Delete/ }).click(); await p.getByRole('dialog').last().waitFor(); await p.waitForTimeout(150); }],
  ['projects', '/projects', async (p) => { await p.getByRole('heading', { name: 'Projects', level: 1 }).waitFor(); }],
  ['new project dialog', '/projects', async (p) => { await p.getByRole('button', { name: /^New project/ }).first().click(); await p.getByRole('dialog').last().waitFor(); await p.waitForTimeout(150); }],
  ['project home', '/p/p1', async (p) => { await p.locator('.crumb-back, .project-main, .project-view').first().waitFor(); await p.waitForTimeout(200); }],
  ['project settings dialog', '/p/p1', async (p) => { await p.getByRole('button', { name: 'Project settings', exact: true }).first().click(); await p.getByRole('dialog').last().waitFor(); await p.waitForTimeout(150); }],
  ['customise', '/customise', async (p) => { await p.locator('main, .customise, .plugins-view').first().waitFor(); await p.waitForTimeout(250); }],
  ['customise connectors', '/customise/connectors', async (p) => { await p.waitForTimeout(350); }],
  ['settings list', '/settings', settingsList],
];
const SETTINGS_IDS = ['appearance', 'keyboard', 'personalization', 'memory', 'notifications', 'data', 'usage', 'profile', 'security', 'diary', 'connectors', 'providers',
  'users', 'models', 'address', 'features', 'experimental', 'backups', 'status', 'capabilities'];
for (const id of SETTINGS_IDS) STATES.push([`settings/${id}`, `/settings/${id}`, async (p) => {
  await p.locator('.settings-detail-scroll').waitFor(); await p.waitForTimeout(350);
  if (!(await p.locator('.settings-stage[data-view="detail"]').count())) throw new Error(`settings/${id} did not open its page`);
}]);

async function densityAt(browser, label) {
  const { page } = await open(browser, { width: 390, height: 844, touch: true });
  await composer(page).waitFor();
  await openDrawer(page);
  // Rows wholly on screen, and above the drawer's sticky footer when there is one.
  const fits = (selector) => page.evaluate((s) => {
    const footer = document.querySelector('.sidebar .side-footer'), floor = footer && footer.getBoundingClientRect().height ? footer.getBoundingClientRect().top : innerHeight;
    return [...document.querySelectorAll(s)].filter(e => { const r = e.getBoundingClientRect(); return r.height > 1 && r.top >= 0 && r.bottom <= Math.min(innerHeight, e.closest('.sidebar') ? floor : innerHeight) + 0.5; }).length;
  }, selector);
  const heights = (selector) => page.evaluate((s) => [...document.querySelectorAll(s)].slice(0, 4).map(e => Math.round(e.getBoundingClientRect().height)), selector);
  const drawer = { rows: await fits('.sidebar :is(.side-nav .nav-item, .proj-row, .chat-row, .new-chat-btn)'), chatRowHeights: await heights('.sidebar .chat-row') };
  await page.goto(origin + '/settings'); await settingsList(page);
  const list = { rows: await fits('.settings-navigation nav button'), heights: await heights('.settings-navigation nav button') };
  const settingsPage = async (id) => {
    await page.goto(origin + `/settings/${id}`); await page.locator('.settings-detail-scroll').waitFor(); await page.waitForTimeout(350);
    return { rows: await fits('.settings-detail .set-row'), heights: await heights('.settings-detail .set-row'),
      pageHeight: await page.evaluate(() => document.querySelector('.settings-detail-scroll').scrollHeight) };
  };
  const appearance = await settingsPage('appearance'), notifications = await settingsPage('notifications'), data = await settingsPage('data');
  await page.close();
  return { label, drawer, settingsList: list, appearance, notifications, data };
}
// Tier 0 must not change: boxes of the main landmarks at 1440x900, compared between two runs.
async function tier0Fingerprint(browser) {
  const result = {};
  for (const [label, route] of [['home', '/'], ['chat', '/c/long'], ['settings', '/settings/appearance'], ['projects', '/projects']]) {
    const { page } = await open(browser, { width: 1440, height: 900, touch: false, path: route });
    await page.waitForTimeout(400);
    result[label] = await page.evaluate(() => [...document.querySelectorAll('.sidebar .nav-item, .sidebar .proj-row, .sidebar .chat-row, .msg, .composer-inner, .settings-navigation nav button, .settings-detail .set-row, .project-card, pre, table')]
      .slice(0, 60).map(e => { const r = e.getBoundingClientRect(); return [e.className.toString().split(' ')[0] || e.tagName, Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)].join(':'); }));
    await page.close();
  }
  return result;
}

module.exports = { open, STATES, audit, HORIZONTAL_SCROLLERS, origin, port };
if (require.main === module) (async () => {
  fs.mkdirSync(out, { recursive: true });
  const fixture = createFixture(port); await fixture.listen();
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const failures = [], unreachable = [], pageErrors = new Set(); let checks = 0;
  try {
    const jobs = [];
    for (const [width, height] of SIZES) {
      const combos = process.env.QA_QUICK ? [[FAMILIES[SIZES.findIndex(s => s[0] === width) % 3], THEMES[width % 2]]] : FAMILIES.flatMap(f => THEMES.map(t => [f, t]));
      for (const [family, theme] of combos) for (const [state, route, reach] of STATES) jobs.push({ width, height, family, theme, state, route, reach });
    }
    const run = async ({ width, height, family, theme, state, route, reach }) => {
      const tag = `${width}x${height} ${family} ${theme} ${state}`;
      let page;
      try {
        const opened = await open(browser, { width, height, family, theme, path: route });
        page = opened.page;
        await reach(page);
        opened.errors.forEach(e => pageErrors.add(`${state}: ${e}`));
        checks++;
        const found = await page.evaluate(audit, HORIZONTAL_SCROLLERS);
        for (const f of found) failures.push({ state: tag, ...f });
        if (width === 390 && family === 'editorial' && theme === 'light' && ['drawer', 'chat with long content', 'settings/appearance', 'settings/notifications', 'settings list'].includes(state))
          await page.screenshot({ path: path.join(out, `390x844-${state.replace(/[^a-z0-9]+/gi, '-')}.png`) });
      } catch (e) {
        checks++; unreachable.push({ state: tag, error: String(e.message || e).split('\n')[0] });
      } finally { if (page) await page.close(); }
    };
    // A few pages at once: each state starts from a fresh page, so they do not interfere.
    const queue = [...jobs];
    await Promise.all(Array.from({ length: Number(process.env.QA_CONCURRENCY || 4) }, async () => { while (queue.length) await run(queue.shift()); }));
    const density = await densityAt(browser, 'tier 2 at 390x844');
    const tier0 = await tier0Fingerprint(browser);
    // One line per distinct offender (selector + rule), with where it happened.
    const grouped = new Map();
    for (const f of failures) { const key = `${f.rule} ${f.selector}`; const g = grouped.get(key) || { ...f, states: [] }; g.states.push(f.state); grouped.set(key, g); }
    const offenders = [...grouped.values()].map(({ state, ...g }) => ({ ...g, count: g.states.length, states: g.states.slice(0, 4) }));
    const results = { checks, failures: failures.length, offenders, unreachable, density, tier0, pageErrors: [...pageErrors].slice(0, 30), inference: fixture.requests.length };
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 2));
    console.log(JSON.stringify({ checks, failures: failures.length, offenders, unreachable, density, inference: fixture.requests.length }, null, 2));
    if (failures.length || unreachable.length || fixture.requests.length) process.exitCode = 1;
  } finally { await browser.close(); await fixture.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
