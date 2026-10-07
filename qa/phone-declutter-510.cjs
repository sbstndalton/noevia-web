// #510: decluttering follows the space the window has (owner rule, 2026-09-28), in three tiers
// (src/styles/space-tiers.css): tier 0 (>= 1024x760) shows everything; tier 1 (< 1024 wide or
// < 760 tall) drops the greeting subtitle, the plain mode caption and the healthy MCP line and
// trims Recent chats; tier 2 (< 768 wide or < 600 tall) is the full phone treatment: bottom
// composer, no Recent chats, Tools in +, compact pills, one ⋯ per project row, quiet drawer
// controls. At every width the header sliders open this chat's own settings, not Settings.
// #527 then made the tier-2 composer compact: Chat/Cowork moved inside it and Thinking joined the
// model button ("Auto · Auto"); qa/phone-composer-527.cjs covers that in depth.
// Everything moved stays reachable. Built app, synthetic fixture: every API answer below is
// invented, nothing reaches inference, storage or a diary.
// npm run build -- --outDir /tmp/x && QA_DIST=/tmp/x QA_SCREENSHOTS=<dir> node qa/phone-declutter-510.cjs
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || `${os.homedir()}/noevia-local-test/node_modules/playwright-core`);
const { createFixture } = require('./diary-fixture.cjs');
const port = Number(process.env.QA_PORT || 31510), origin = `http://localhost:${port}`;
const out = process.env.QA_SCREENSHOTS || path.join(os.tmpdir(), 'noevia-phone-declutter-510');
const failures = [], errors = []; let checks = 0;
const check = (ok, label, detail) => { checks++; if (!ok) failures.push({ label, detail }); };
// A step that cannot run (an element that is not there yet) is a failure, not a crash, so a
// run against the old build still lists every check it misses.
const step = async (label, fn) => { try { await fn(); } catch (e) { checks++; failures.push({ label, detail: `${String(e.message || e).split('\n')[0]} ${(String(e.stack).match(/phone-declutter-510\.cjs:\d+/) || [''])[0]}` }); } };

const FREE_CONTEXT = { id: '__free-synthetic', name: 'Synthetic free chat', routing: 'auto', files: [], assets: [], toolboxes: ['core'] };
const project = (id, name, extra = {}) => ({ id, name, updatedAt: 5, files: [], assets: [], chats: [], goal: '', instructions: '', memories: [], toolboxes: ['core'], ...extra });
const PROJECTS = [project('p1', 'Synthetic project', { pinned: true }), project('p2', 'Other project', { updatedAt: 4 })];
const FREE_CHATS = [{ id: 'pin', title: 'Synthetic pinned chat', pinned: true, updatedAt: 10 },
  ...[1, 2, 3, 4, 5].map(i => ({ id: `c${i}`, title: `Synthetic chat ${i}`, updatedAt: 10 - i }))];
const PERMITTED = { mode: 'chat', boxes: [{ id: 'core', label: 'Synthetic core', description: 'Synthetic tools', source: 'builtin', state: 'available', reason: null, active: false,
  tools: [{ name: 'synthetic_lookup', description: 'Looks up nothing real', write: false, permission: 'allowed', reason: null }] }] };
const LONG_REPO = 'synthetic-organisation/an-extremely-long-synthetic-repository-name-that-would-overflow';

async function open(browser, { width, height, mcpError = null, family = null, cowork = false }) {
  const touch = width < 768;
  const page = await browser.newPage({ viewport: { width, height }, isMobile: touch, hasTouch: touch, reducedMotion: 'reduce' });
  if (family) await page.addInitScript(f => localStorage.setItem('noevia:theme-family', f), family);
  page.on('pageerror', e => errors.push({ size: `${width}x${height}`, error: e.message }));
  await page.route('https://**/*', r => r.abort());
  if (cowork) {
    await page.route('**/api/features', r => r.fulfill({ json: { flags: { previews: false, codeHarness: true } } }));
    await page.route(u => /^\/api\/projects\/p1\/code$/.test(u.pathname), r => r.fulfill({ json: { repositories: [{ id: LONG_REPO }, { id: 'synthetic-organisation/second' }],
      capabilities: [], defaultCapabilities: [], harnesses: [], promptPreparation: [], sandboxed: true, tasks: [] } }));
  }
  await page.route('**/api/toolboxes', r => r.fulfill({ json: { toolboxes: [{ id: 'core', label: 'Synthetic core', description: 'Synthetic tools', source: 'builtin', toolCount: 1, estTokens: 10 }],
    mcp: { configured: true, discovered: 175, servers: [{ id: 'synthetic-a', auth: 'internal', error: mcpError, discovered: 175 }] } } }));
  await page.route(u => u.pathname === '/api/toolboxes/permitted', r => r.fulfill({ json: PERMITTED }));
  await page.route('**/api/workspace', r => r.fulfill({ json: { projects: PROJECTS, freeChats: FREE_CHATS } }));
  await page.route('**/api/chats/*/context', r => r.fulfill({ json: { project: FREE_CONTEXT } }));
  await page.route('**/api/models/installed', r => r.fulfill({ json: [{ name: 'synthetic-model-Q4_K_M', labels: [] }] }));
  await page.goto(origin);
  await page.getByRole('textbox', { name: 'Message', exact: true }).waitFor();
  // Tier 2 (#527) has no Thinking pill: the level rides on the model button.
  await page.getByRole('button', { name: /^Choose model: / }).first().waitFor();
  await page.waitForTimeout(150);
  return page;
}
const visible = (page, selector) => page.locator(selector).first().isVisible().catch(() => false);
const box = (locator) => locator.boundingBox();
const focusedName = (page) => page.evaluate(() => { const e = document.activeElement; return e && e !== document.body ? (e.getAttribute('aria-label') || e.className || e.tagName) : null; });
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
const shot = async (page, name) => { await page.waitForTimeout(200); await page.screenshot({ path: path.join(out, `${name}.png`) }); };
const visibleRecents = (page) => page.locator('.home-recents li').evaluateAll(items => items.filter(li => li.getBoundingClientRect().height > 0).length).catch(() => 0);

async function openDrawerIfAny(page) {
  const toggle = page.getByRole('button', { name: 'Open navigation', exact: true });
  if (await toggle.isVisible()) { await toggle.click(); await page.locator('.sidebar').waitFor({ state: 'visible' }); await page.waitForTimeout(150); }
}
// Tier-0 and tier-1 items that must stay (the parts only tier 2 changes).
async function tier2ItemsStay(page, name) {
  check(await visible(page, '.tool-catalogue-trigger'), `${name}: Tools button shown`);
  check((await page.getByRole('button', { name: 'Choose model: Auto (Fast/Smart)', exact: true }).innerText()).replace(/\s+/g, '').includes('(Fast/Smart)'), `${name}: full model label`);
  check((await page.getByRole('button', { name: 'Thinking effort', exact: true }).innerText()).includes('Thinking'), `${name}: Thinking pill keeps its words`);
  check(!(await visible(page, '.composer-add-badge')), `${name}: no + badge`);
  await page.getByRole('button', { name: 'Add files and tools', exact: true }).click();
  await page.locator('.composer-actions-panel').waitFor();
  check(!(await visible(page, '.composer-actions-panel .composer-browse-tools')), `${name}: + menu has no Tools row`);
  await page.keyboard.press('Escape');
  check(await page.getByRole('button', { name: 'New chat in Synthetic project', exact: true }).count() === 1, `${name}: project-row pencil kept`);
  // #951: New chat is a quiet ghost row (no outlined pill), still a full-width labelled target.
  check(await page.locator('.sidebar .new-chat-btn').evaluate(e => getComputedStyle(e).borderTopWidth === '0px' && e.textContent.trim().length > 0), `${name}: New chat is a quiet labelled row`);
  await page.locator('.proj-row', { hasText: 'Synthetic project' }).first().hover();
  await page.getByRole('button', { name: 'Options for Synthetic project', exact: true }).click();
  await page.getByRole('menu').waitFor();
  check(await page.getByRole('menuitem', { name: 'New chat in project' }).count() === 0, `${name}: project menu unchanged`);
  await page.keyboard.press('Escape');
}

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const fixture = createFixture(port); await fixture.listen();
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    // ── Tier 0: 1440x900, everything visible ───────────────────────────────
    await step('tier 0 1440x900', async () => {
      const name = 'tier0 1440x900', page = await open(browser, { width: 1440, height: 900 });
      await shot(page, 'tier0-1440x900');
      check(await visible(page, '.empty-state > p:not(.home-diagnostic)'), `${name}: home subtitle shown`);
      check(await visible(page, '.composer-mode-harness'), `${name}: mode caption shown`);
      check(await visibleRecents(page) === 5, `${name}: all five recent chats shown`, await visibleRecents(page));
      check(await visible(page, '.sidebar .mcp-row'), `${name}: MCP footer line shown`);
      check(await page.locator('.chat-header').getByTitle('Settings', { exact: true }).count() === 0, `${name}: header no longer duplicates Settings`);
      await tier2ItemsStay(page, name);
      // Sliders open this chat's model and tools...
      await page.getByRole('button', { name: 'Model', exact: true }).click();
      await page.getByRole('dialog', { name: 'Model' }).waitFor();
      check(!/\/settings/.test(page.url()) && !(await visible(page, '.settings-stage')), `${name}: sliders did not open Settings`, page.url());
      await shot(page, 'tier0-1440x900-chat-settings');
      await page.keyboard.press('Escape');
      await page.getByRole('dialog', { name: 'Model' }).waitFor({ state: 'hidden' });
      // ...and in a project chat, the project's settings.
      await page.locator('.proj-row', { hasText: 'Synthetic project' }).first().hover();
      await page.getByRole('button', { name: 'New chat in Synthetic project', exact: true }).click();
      await page.locator('.crumb-back', { hasText: 'Synthetic project' }).waitFor();
      await page.getByRole('button', { name: 'Project settings', exact: true }).click();
      await page.getByRole('dialog', { name: 'Edit Synthetic project' }).waitFor();
      check(!/\/settings/.test(page.url()), `${name}: project sliders did not open Settings`, page.url());
      await shot(page, 'tier0-1440x900-project-settings');
      await page.close();
    });

    // ── Tier 1: narrow (900x900) and short (1440x680) ──────────────────────
    for (const [width, height] of [[900, 900], [1440, 680]]) await step(`tier 1 ${width}x${height}`, async () => {
      const name = `tier1 ${width}x${height}`, page = await open(browser, { width, height });
      await shot(page, `tier1-${width}x${height}`);
      check(await page.locator('.empty-state h1').isVisible(), `${name}: greeting stays`);
      check(!(await visible(page, '.empty-state > p:not(.home-diagnostic)')), `${name}: home subtitle hidden`);
      check(!(await visible(page, '.composer-mode-harness')), `${name}: plain mode caption hidden`);
      check(!(await visible(page, '.sidebar .mcp-row')), `${name}: healthy MCP line hidden`);
      const recents = await visibleRecents(page);
      check(height < 760 ? recents === 0 : recents === 3, `${name}: Recent chats ${height < 760 ? 'hidden when short' : 'trimmed to three'}`, recents);
      await tier2ItemsStay(page, name);
      check(await noOverflow(page), `${name}: no horizontal overflow`);
      await page.close();
    });

    // ── Tier 2: 390x844 phone ──────────────────────────────────────────────
    const tier2Home = async (page, name, width, height) => {
      check(await page.locator('.empty-state h1').isVisible(), `${name}: the greeting heading stays`);
      check(!(await visible(page, '.empty-state > p:not(.home-diagnostic)')), `${name}: home subtitle hidden`);
      check(!(await visible(page, '.composer-mode-harness')), `${name}: chat mode caption hidden`);
      check(await visibleRecents(page) === 0, `${name}: no Recent chats list on the blank page`);
      check(!(await visible(page, '.tool-catalogue-trigger')), `${name}: standalone Tools button hidden`);
      check(!(await visible(page, '.chat-workspace .composer-hint')), `${name}: keyboard hint hidden`);
      const modeGroup = page.getByRole('radiogroup', { name: /./ });
      check(await modeGroup.isVisible(), `${name}: Chat/Cowork switch still reachable`);
      // #527: the switch is inside the composer; no row of its own above it.
      check(await page.locator('.chat-workspace .chat-composer-inner [role="radiogroup"]').count() === 1, `${name}: mode switch sits in the composer`);
      const modeBar = await box(page.locator('.composer-mode-bar'));
      check(!modeBar || modeBar.height <= 1, `${name}: no separate mode row`, modeBar);
      const composer = await box(page.locator('.chat-workspace .chat-composer-inner'));
      check(composer && height - (composer.y + composer.height) <= 40, `${name}: composer bottom within 40px of the viewport bottom`, composer);
      const MODEL = 'Choose model: Auto (Fast/Smart) · Thinking: Auto';
      const model = page.getByRole('button', { name: MODEL, exact: true });
      check((await model.innerText()).replace(/\s+/g, ' ').trim() === 'Auto · Auto', `${name}: model button shows the short label and the thinking level`, await model.innerText());
      check(await page.getByRole('button', { name: 'Thinking effort', exact: true }).count() === 0, `${name}: no separate Thinking pill`);
      const row = [];
      for (const [label, control] of [['Add files and tools', page.getByRole('button', { name: 'Add files and tools', exact: true })], ['Chat', page.getByRole('radio', { name: 'Chat' })],
        [MODEL, model], ['Send', page.getByRole('button', { name: 'Send', exact: true })]]) {
        const b = await box(control); row.push({ label, ...b });
        if (width < 768) check(b && b.width >= 44 && b.height >= 44, `${name}: ${label} is a 44px target`, b);
      }
      check(row.every((b, i) => i === 0 || b.x >= row[i - 1].x + row[i - 1].width - 0.5), `${name}: composer controls sit side by side`, row);
      check(row.every(b => Math.abs((b.y + b.height / 2) - (row[0].y + row[0].height / 2)) < 4), `${name}: composer controls share one row`, row);
      check(await noOverflow(page), `${name}: no horizontal overflow`);
    };
    const W = 390, H = 844;
    await step('tier 2 390x844 home', async () => {
      const page = await open(browser, { width: W, height: H });
      await shot(page, 'tier2-390x844');
      await tier2Home(page, 'tier2 390x844', W, H);
      for (const radio of await page.getByRole('radiogroup', { name: /./ }).getByRole('radio').all()) { const b = await box(radio); check(b && b.height >= 44, 'tier2 390x844: mode option is a 44px target', b); }
      await page.close();
    });
    await step('tier 2 390x844 Tools from the + menu', async () => {
      const page = await open(browser, { width: W, height: H });
      await page.getByRole('button', { name: 'Add files and tools', exact: true }).click();
      const toolsRow = page.locator('.composer-actions-panel .composer-browse-tools');
      check(await toolsRow.isVisible(), 'tier2: Tools is in the + menu');
      const toolsBox = await box(toolsRow); check(toolsBox && toolsBox.height >= 44, 'tier2: Tools menu row is a 44px target', toolsBox);
      await shot(page, 'tier2-390x844-plus-menu');
      await toolsRow.click();
      const search = page.getByRole('combobox');
      await search.waitFor();
      await page.getByRole('option', { name: /Synthetic core/ }).waitFor();
      const panel = await box(page.locator('.tool-catalogue-panel'));
      check(panel && panel.x >= 0 && panel.x + panel.width <= W + 1 && panel.y >= 0, 'tier2: tool catalogue fits the viewport', panel);
      check(await search.evaluate(e => e === document.activeElement), 'tier2: catalogue search takes focus');
      await shot(page, 'tier2-390x844-tools');
      await page.keyboard.press('Escape');
      check(!(await visible(page, '.tool-catalogue-panel')), 'tier2: Escape closes the catalogue');
      check(await focusedName(page) === 'Add files and tools', 'tier2: focus returns to the + button', await focusedName(page));
      // Choosing a toolbox for the next message stays visible without the Tools button.
      await page.getByRole('button', { name: 'Add files and tools', exact: true }).click();
      await page.locator('.composer-actions-panel .composer-browse-tools').click();
      await page.getByRole('option', { name: /Synthetic core/ }).click();
      await page.keyboard.press('Escape');
      const badge = page.locator('.composer-add-badge');
      check(await badge.isVisible() && (await badge.innerText()).trim() === '1', 'tier2: + shows a badge for a toolbox added to the next message');
      check(await page.getByRole('button', { name: 'Add files and tools · 1 for this message', exact: true }).isVisible(), 'tier2: + names the count');
      await shot(page, 'tier2-390x844-badge');
      await page.close();
    });
    await step('tier 2 390x844 sliders and drawer', async () => {
      const page = await open(browser, { width: W, height: H });
      const chatSettings = page.getByRole('button', { name: 'Model', exact: true });
      await chatSettings.click();
      await page.getByRole('dialog', { name: 'Model' }).waitFor();
      check(!/\/settings/.test(page.url()), 'tier2: sliders did not open global Settings', page.url());
      await page.keyboard.press('Escape');
      await page.getByRole('dialog', { name: 'Model' }).waitFor({ state: 'hidden' });
      await openDrawerIfAny(page);
      await shot(page, 'tier2-390x844-drawer');
      const drawerStyles = await page.evaluate(() => {
        const read = (sel) => { const e = document.querySelector(sel), c = e && getComputedStyle(e); return c && { top: c.borderTopWidth, bg: c.backgroundColor, image: c.backgroundImage, shadow: c.boxShadow }; };
        return { search: read('.sidebar .shell-search'), newChat: read('.sidebar .new-chat-btn') };
      });
      check(drawerStyles.search && drawerStyles.search.top === '0px' && drawerStyles.search.shadow === 'none', 'tier2: drawer search has no heavy border', drawerStyles.search);
      check(drawerStyles.newChat && drawerStyles.newChat.bg === 'rgba(0, 0, 0, 0)' && drawerStyles.newChat.image === 'none' && drawerStyles.newChat.shadow === 'none', 'tier2: drawer New chat is a quiet row', drawerStyles.newChat);
      check(await page.getByRole('textbox', { name: 'Search noevia' }).isVisible(), 'tier2: drawer search stays');
      check(!(await page.getByRole('button', { name: 'New chat in Synthetic project', exact: true }).isVisible()), 'tier2: project-row pencil hidden');
      check(!(await visible(page, '.sidebar .mcp-row')), 'tier2: healthy MCP footer line hidden');
      check(await page.getByRole('button', { name: /Account menu for/ }).isVisible(), 'tier2: account menu stays');
      check(await page.getByRole('button', { name: 'Synthetic chat 1' }).first().isVisible(), 'tier2: recent chats live in the drawer');
      const options = page.getByRole('button', { name: 'Options for Synthetic project', exact: true });
      const ob = await box(options); check(ob && ob.width >= 44 && ob.height >= 44, 'tier2: project ⋯ is a 44px target', ob);
      await options.click();
      const newInProject = page.getByRole('menuitem', { name: 'New chat in project' });
      check(await newInProject.isVisible(), 'tier2: project ⋯ menu carries New chat in project');
      await shot(page, 'tier2-390x844-project-menu');
      await newInProject.click();
      await page.locator('.crumb-back', { hasText: 'Synthetic project' }).waitFor();
      await page.getByRole('button', { name: 'Project settings', exact: true }).click();
      await page.getByRole('dialog', { name: 'Edit Synthetic project' }).waitFor();
      check(!/\/settings/.test(page.url()), 'tier2: project sliders did not open global Settings', page.url());
      check(await noOverflow(page), 'tier2: no horizontal overflow');
      await page.close();
    });
    // A problem with MCP still shows in every tier.
    for (const [width, height] of [[390, 844], [900, 900]]) await step(`degraded MCP ${width}x${height}`, async () => {
      const page = await open(browser, { width, height, mcpError: 'synthetic outage' });
      await openDrawerIfAny(page);
      check(await visible(page, '.sidebar .mcp-row.is-degraded'), `${width}x${height}: a degraded MCP line stays visible`);
      await page.close();
    });

    // ── Tier 2 by height (1280x560) and a portrait tablet (744x1024) ───────
    for (const [width, height] of [[1280, 560], [744, 1024]]) await step(`tier 2 ${width}x${height}`, async () => {
      const name = `tier2 ${width}x${height}`, page = await open(browser, { width, height });
      await shot(page, `tier2-${width}x${height}`);
      await tier2Home(page, name, width, height);
      await page.getByRole('button', { name: 'Add files and tools', exact: true }).click();
      await page.locator('.composer-actions-panel .composer-browse-tools').click();
      await page.getByRole('combobox').waitFor();
      await page.keyboard.press('Escape');
      await openDrawerIfAny(page);
      check(!(await page.getByRole('button', { name: 'New chat in Synthetic project', exact: true }).isVisible()), `${name}: project-row pencil hidden`);
      const nb = await page.locator('.sidebar .new-chat-btn').evaluate(e => { const c = getComputedStyle(e); return { bg: c.backgroundColor, shadow: c.boxShadow }; });
      check(nb.bg === 'rgba(0, 0, 0, 0)' && nb.shadow === 'none', `${name}: New chat is a quiet row`, nb);
      await page.locator('.proj-row', { hasText: 'Synthetic project' }).first().hover();
      await page.getByRole('button', { name: 'Options for Synthetic project', exact: true }).click();
      check(await page.getByRole('menuitem', { name: 'New chat in project' }).isVisible(), `${name}: project ⋯ menu carries New chat in project`);
      await page.keyboard.press('Escape');
      await page.close();
    });

    // Every theme family gets the quiet drawer controls.
    for (const family of ['editorial', 'contemporary', 'glass']) await step(`tier 2 ${family} drawer`, async () => {
      const page = await open(browser, { width: W, height: H, family });
      await openDrawerIfAny(page);
      const s = await page.locator('.sidebar .new-chat-btn').evaluate(e => { const c = getComputedStyle(e); return { bg: c.backgroundColor, image: c.backgroundImage, shadow: c.boxShadow }; });
      check(s.bg === 'rgba(0, 0, 0, 0)' && s.image === 'none' && s.shadow === 'none', `tier2 ${family}: New chat is a quiet row`, s);
      check(await page.locator('.sidebar .shell-search').evaluate(e => getComputedStyle(e).borderTopWidth) === '0px', `tier2 ${family}: search has no border`);
      await shot(page, `tier2-390x844-drawer-${family}`);
      await page.close();
    });
    // The narrowest phone and a small tablet keep one composer row and reach Tools.
    for (const [width, height] of [[320, 640], [700, 900]]) await step(`${width}px composer and Tools`, async () => {
      const page = await open(browser, { width, height });
      check(await noOverflow(page), `${width}px: no horizontal overflow`);
      const send = await box(page.getByRole('button', { name: 'Send', exact: true }));
      check(send && send.x + send.width <= width, `${width}px: send stays on screen`, send);
      await page.getByRole('button', { name: 'Add files and tools', exact: true }).click();
      await page.locator('.composer-actions-panel .composer-browse-tools').click();
      await page.getByRole('combobox').waitFor();
      await shot(page, `tier2-${width}x${height}-tools`);
      await page.close();
    });
    // A long Cowork repository name wraps under the switch instead of overflowing.
    for (const width of [320, 375]) await step(`${width}px long Cowork repository`, async () => {
      const page = await open(browser, { width, height: 740, cowork: true });
      await openDrawerIfAny(page);
      await page.getByRole('button', { name: 'Options for Synthetic project', exact: true }).click();
      await page.getByRole('menuitem', { name: 'New chat in project' }).click();
      await page.locator('.crumb-back', { hasText: 'Synthetic project' }).waitFor();
      await page.getByRole('radio', { name: 'Cowork' }).click();
      const select = page.locator('.composer-mode-harness select');
      await select.waitFor();
      const b = await box(select);
      check(b && b.x >= 0 && b.x + b.width <= width + 0.5, `${width}px: repository choice stays on screen`, b);
      check(await noOverflow(page), `${width}px: long repository name causes no horizontal overflow`);
      check(b && b.height <= 48, `${width}px: repository choice stays one line`, b);
      await shot(page, `tier2-${width}-cowork-long-repo`);
      await page.close();
    });

    check(errors.length === 0, 'no browser errors', errors);
    check(fixture.requests.length === 0, 'no inference requests', fixture.requests);
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ checks, failures, errors }, null, 2));
    console.log(JSON.stringify({ checks, failures }, null, 2));
    if (failures.length) process.exitCode = 1;
  } finally { await browser.close(); await fixture.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
