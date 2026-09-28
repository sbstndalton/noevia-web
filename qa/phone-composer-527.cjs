// #527: in phone-sized space (tier 2, src/styles/space-tiers.css) the chat composer is compact and
// floats over the conversation: one line tall until you type, one control row inside it (+, a
// Chat/Cowork chip, the model and thinking level as plain text, send), no separate mode row and no
// band behind it. The live inference strip, the routing decision and the context meter leave the
// page for the model sheet, which also carries the model list and the Thinking levels; a dot on the
// model button shows a reply is generating. Tier 0 is unchanged.
//
// Built app, synthetic fixture: every API answer below is invented. The one streamed reply is the
// fixture's own held-open synthetic stream; nothing reaches inference, storage or a diary.
//
//   node scripts/build.cjs --outDir /tmp/x && QA_DIST=/tmp/x node qa/phone-composer-527.cjs
//   QA_BASE_DIST=<a build of main>  also compares tier 0 against it, element by element
//   QA_SHOT_PREFIX=before|after     names the 390x844 light/dark screenshots (qa-output/ by default)
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || `${os.homedir()}/noevia-local-test/node_modules/playwright-core`);
const { createFixture } = require('./diary-fixture.cjs');
const port = Number(process.env.QA_PORT || 31527), origin = `http://localhost:${port}`;
const out = process.env.QA_SCREENSHOTS || path.join(__dirname, '..', 'qa-output', 'phone-composer-527');
const prefix = process.env.QA_SHOT_PREFIX || 'run';
const failures = [], errors = []; let checks = 0;
const check = (ok, label, detail) => { checks++; if (!ok) failures.push({ label, detail }); };
// A step that cannot run (an element that is not there yet) is a failure, not a crash, so a run
// against the old build still lists every check it misses.
const step = async (label, fn) => { try { await fn(); } catch (e) { checks++; failures.push({ label, detail: `${String(e.message || e).split('\n')[0]} ${(String(e.stack).match(/phone-composer-527\.cjs:\d+/) || [''])[0]}` }); } };

const MODEL = 'synthetic-model-Q4_K_M';
const context = (routing) => ({ id: '__free-synthetic', name: 'Synthetic free chat', routing, model: routing === 'manual' ? MODEL : undefined, files: [], assets: [], toolboxes: ['core'] });
const METER = { historyCount: 2, model: MODEL, limit: 8192, limitSource: 'synthetic limit', used: 1300, reserve: 1024, safety: 256, threshold: 6000,
  parts: [{ name: 'Synthetic system', tokens: 600 }, { name: 'Synthetic messages', tokens: 700 }], compactedAt: null, covered: 0 };
const ROUTE = { offered: [{ id: 'fast', label: 'Synthetic fast' }, { id: 'smart', label: 'Synthetic smart' }], scores: { fast: 0.8, smart: 0.2 }, selectedRole: 'fast',
  effectiveRole: 'fast', backend: 'decision-service', model: 'convaiinnovations/laya', calibrated: false, latencyMs: 40, status: 'accepted', fallbackReason: null };
const REPLY = ['meta', 'delta', 'usage', 'done'].map(type => 'data: ' + JSON.stringify(
  type === 'meta' ? { type, route: 'fast', routingDecision: ROUTE }
  : type === 'delta' ? { type, text: 'Synthetic answer paragraph. '.repeat(60) }
  : type === 'usage' ? { type, promptTokens: 12, completionTokens: 34, totalTokens: 46, tokensPerSecond: 46.8 } : { type })).join('\n\n') + '\n\n';

async function open(browser, { width, height, theme = 'light', routing = 'auto', reply = true, models = 1, reasoning = true, touch = width < 768 }) {
  const page = await browser.newPage({ viewport: { width, height }, isMobile: touch, hasTouch: touch, reducedMotion: 'reduce' });
  await page.addInitScript(t => localStorage.setItem('cowork-theme', t), theme);
  page.on('pageerror', e => errors.push({ size: `${width}x${height}`, error: e.message }));
  await page.route('https://**/*', r => r.abort());
  await page.route('**/api/workspace', r => r.fulfill({ json: { projects: [], freeChats: [] } }));
  // The chat's own settings, kept across saves so a Thinking choice reads back.
  const chat = context(routing);
  await page.route('**/api/chats/*/context', r => r.fulfill({ json: { project: chat } }));
  await page.route('**/api/projects/__free-synthetic/config', async r => {
    const body = r.request().postDataJSON() || {};
    await new Promise(done => setTimeout(done, 300));
    if ('reasoningEffort' in body) chat.reasoningEffort = body.reasoningEffort ?? undefined;
    await r.fulfill({ json: { ok: true } });
  });
  if (!reasoning) await page.route('**/api/reasoning-settings*', r => r.fulfill({ status: 503, json: { error: 'Synthetic outage' } }));
  await page.route('**/api/chats/*/context-window', r => r.fulfill({ json: { meter: METER } }));
  await page.route('**/api/models/installed', r => r.fulfill({ json: [MODEL, ...Array.from({ length: models - 1 }, (_, i) => `synthetic-extra-${i + 1}-Q4_K_M`)].map(name => ({ name, labels: [], loaded: true })) }));
  await page.route('**/api/toolboxes', r => r.fulfill({ json: { toolboxes: [{ id: 'core', label: 'Synthetic core', description: 'Synthetic tools', source: 'builtin', toolCount: 1, estTokens: 10 }], mcp: { configured: false } } }));
  // A finished synthetic reply with speed, a routing decision and a measured context; `reply:
  // false` leaves /api/chat to the fixture, whose "live synthetic" stream stays open.
  // A compaction request answers after a pause, so the test can watch it run.
  if (reply) await page.route('**/api/chat', async r => {
    if (r.request().postDataJSON()?.compactOnly) {
      await new Promise(done => setTimeout(done, 1500));
      return r.fulfill({ headers: { 'content-type': 'text/event-stream' }, body: 'data: {"type":"status","text":"Summarising synthetic messages"}\n\ndata: {"type":"done"}\n\n' });
    }
    return r.fulfill({ headers: { 'content-type': 'text/event-stream' }, body: REPLY });
  });
  await page.goto(origin);
  await page.getByRole('textbox', { name: 'Message', exact: true }).waitFor();
  await page.getByRole('button', { name: /^Choose model: / }).first().waitFor();
  await page.waitForTimeout(200);
  return page;
}
const send = async (page, text) => {
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill(text);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
};
const box = (locator) => locator.boundingBox();
const visible = (page, selector) => page.locator(selector).first().isVisible().catch(() => false);
const shot = async (page, name) => { await page.waitForTimeout(200); await page.screenshot({ path: path.join(out, `${prefix}-${name}.png`) }); };
const modelButton = (page) => page.getByRole('button', { name: /^Choose model: / }).first();
// The composer surface over the conversation: the card, and anything drawn from the composer's own
// region (mode row, context row) above it.
const composerStack = (page) => page.evaluate(() => {
  const region = document.querySelector('.chat-workspace > .composer'), card = document.querySelector('.chat-workspace .chat-composer-inner');
  if (!region || !card) return null;
  const shown = [...region.children].filter(e => { const r = e.getBoundingClientRect(); return r.height > 0 && getComputedStyle(e).display !== 'none'; });
  const top = Math.min(...shown.map(e => e.getBoundingClientRect().top)), cardBox = card.getBoundingClientRect();
  return { top, bottom: cardBox.bottom, height: cardBox.bottom - top, card: cardBox.height };
});
// Every background between the composer card and the conversation behind it must let it show.
const opaqueBehindComposer = (page) => page.evaluate(() => {
  const opaque = (c) => { const m = c.match(/rgba?\(([^)]+)\)|color\(srgb ([^)]+)\)/); if (!m) return false; const parts = (m[1] || m[2]).split(/[ ,/]+/).filter(Boolean); return parts.length < 4 || Number(parts[3]) > 0; };
  const region = document.querySelector('.chat-workspace > .composer'); if (!region) return ['no composer region'];
  const found = [];
  for (const el of [region, ...region.querySelectorAll(':scope > :not(.chat-composer-inner)')]) {
    const c = getComputedStyle(el);
    if (opaque(c.backgroundColor)) found.push(`${el.className}: ${c.backgroundColor}`);
    // A fade is fine only if it starts from transparent.
    if (c.backgroundImage !== 'none' && !/^linear-gradient\((to bottom, )?(transparent|rgba\([^)]*,\s*0\))/.test(c.backgroundImage)) found.push(`${el.className}: ${c.backgroundImage.slice(0, 80)}`);
  }
  return found;
});

// Tier 0 must not move: a snapshot of every composer-area element's box and key styles.
const tier0Snapshot = (page) => page.evaluate(() => {
  const pick = ['.chat-workspace', '.transcript', '.chat-workspace > .composer', '.composer-mode-bar', '.composer-mode-toggle', '.composer-mode-harness',
    '.chat-composer-inner', '.composer-input', '.composer-add', '.composer-model', '.reasoning-pill', '.send-btn', '.chat-context-meter', '.stats-disclosure', '.routing-details'];
  return pick.map(sel => { const e = document.querySelector(sel); if (!e) return [sel, null]; const r = e.getBoundingClientRect(), c = getComputedStyle(e);
    return [sel, [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height), c.position, c.backgroundColor, c.backgroundImage.slice(0, 60), c.display, e.className]]; });
});

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const fixture = createFixture(port); await fixture.listen();
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const W = 390, H = 844;
  try {
    // ── The empty phone composer ───────────────────────────────────────────
    await step('390x844 empty composer', async () => {
      const page = await open(browser, { width: W, height: H });
      const stack = await composerStack(page);
      check(stack && stack.height <= 150, 'empty composer is at most 150px tall, mode row and all', stack);
      check(stack && stack.card <= 110, 'the composer card itself is compact (one text line and one control row)', stack);
      check(stack && H - stack.bottom <= 40, 'composer bottom within 40px of the viewport bottom', stack);
      const rows = await page.getByRole('textbox', { name: 'Message', exact: true }).evaluate(e => e.rows);
      check(rows === 1, 'the message box starts one line tall', rows);
      check(await page.locator('.chat-workspace .chat-composer-inner [role="radiogroup"]').count() === 1, 'Chat/Cowork sits inside the composer');
      const bar = await box(page.locator('.composer-mode-bar'));
      check(!bar || bar.height <= 1, 'no separate mode row above the composer', bar);
      check(!(await visible(page, '.composer-mode-harness')), 'the plain chat caption stays hidden');
      check(await page.getByRole('button', { name: 'Thinking effort', exact: true }).count() === 0, 'thinking is not a separate pill in the composer');
      const model = modelButton(page);
      check((await model.innerText()).replace(/\s+/g, ' ').trim() === 'Auto · Auto', 'model and thinking read as one plain-text button', await model.innerText());
      check(await model.getAttribute('aria-label') === 'Choose model: Auto (Fast/Smart) · Thinking: Auto', 'the model button names the model and the thinking level', await model.getAttribute('aria-label'));
      const mb = await model.evaluate(e => { const c = getComputedStyle(e); return { border: c.borderTopWidth, bg: c.backgroundColor, image: c.backgroundImage }; });
      check(mb.border === '0px' && mb.bg === 'rgba(0, 0, 0, 0)' && mb.image === 'none', 'the model button is plain text, not a bordered pill', mb);
      // One control row, in reading order, every control a 44px target.
      const controls = [page.getByRole('button', { name: 'Add files and tools', exact: true }), page.getByRole('radio', { name: 'Chat' }), page.getByRole('radio', { name: 'Cowork' }), model, page.getByRole('button', { name: 'Send', exact: true })];
      const boxes = []; for (const c of controls) boxes.push(await box(c));
      check(boxes.every(b => b && b.height >= 44 && b.width >= 44), 'composer controls are 44px touch targets', boxes);
      check(boxes.every((b, i) => i === 0 || b.x >= boxes[i - 1].x + boxes[i - 1].width - 0.5), 'controls run left to right: +, Chat/Cowork, model, send', boxes);
      check(boxes.every(b => Math.abs((b.y + b.height / 2) - (boxes[0].y + boxes[0].height / 2)) < 4), 'controls share one row', boxes);
      // Send is disabled (unfocusable) while the draft is empty.
      const order = [];
      await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Synthetic draft');
      await page.getByRole('textbox', { name: 'Message', exact: true }).focus();
      for (let i = 0; i < 4; i++) { await page.keyboard.press('Tab'); order.push(await page.evaluate(() => document.activeElement.getAttribute('aria-label') || document.activeElement.textContent.trim())); }
      check(order[0] === 'Add files and tools' && order[1] === 'Chat' && /^Choose model/.test(order[2]) && order[3] === 'Send', 'focus order: message, +, mode, model, send', order);
      await page.getByRole('textbox', { name: 'Message', exact: true }).fill('');
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal overflow');
      const opaque = await opaqueBehindComposer(page);
      check(opaque.length === 0, 'no opaque band behind the composer', opaque);
      await page.close();
    });

    // ── A chat with messages: floating, and no status rows in the page ─────
    await step('390x844 chat with messages', async () => {
      const page = await open(browser, { width: W, height: H, routing: 'manual' });
      await send(page, 'Synthetic question');
      await page.getByText('Synthetic answer paragraph.').first().waitFor();
      await page.waitForTimeout(400);
      const stack = await composerStack(page);
      const transcript = await box(page.locator('.chat-workspace > .transcript'));
      check(stack && transcript && transcript.y + transcript.height >= stack.bottom - 1, 'the conversation runs under the composer (it floats)', { transcript, stack });
      check(stack && H - stack.bottom <= 40, 'with messages, composer bottom within 40px of the viewport bottom', stack);
      const opaque = await opaqueBehindComposer(page);
      check(opaque.length === 0, 'with messages, no opaque band behind the composer', opaque);
      // The last message can scroll clear of the composer.
      await page.locator('.chat-workspace > .transcript').evaluate(e => { e.scrollTop = e.scrollHeight; });
      await page.waitForTimeout(150);
      const last = await box(page.locator('.msg').last());
      check(last && stack && last.y + last.height <= stack.top + 1, 'the last message scrolls clear of the composer', { last, stack });
      check(!(await visible(page, '.app-stack > .stats-disclosure')), 'the live inference strip is not in the page');
      check(await page.locator('.stats-disclosure').count() === 0, 'no inference strip anywhere until the sheet opens');
      check(!(await visible(page, '.composer .chat-context-meter')), 'the context row is not above the composer');
      check(await page.locator('.routing-details').evaluateAll(list => list.filter(e => !e.closest('.transcript') && e.getBoundingClientRect().height > 0).length) === 0, 'the routing bar is not in the page (a reply keeps its own)');
      check(await page.locator('.stats-announcer [role="status"]').count() === 1, 'reply status is still announced to screen readers');
      await shot(page, `390x844-light-messages`);

      // The model sheet: status, model list, thinking, context.
      const model = modelButton(page);
      await model.click();
      const sheet = page.getByRole('dialog', { name: 'Model and tools' });
      await sheet.waitFor();
      // Measure once the entrance has settled (two equal frames), not mid-rise.
      let panel = null;
      for (let i = 0; i < 20; i++) { const next = await box(sheet.locator('.mp-panel')); if (panel && next && JSON.stringify(next) === JSON.stringify(panel)) break; panel = next; await page.waitForTimeout(50); }
      check(panel && Math.abs(panel.y + panel.height - H) <= 1 && panel.width >= W - 1, 'the model picker is a bottom sheet', panel);
      const status = sheet.locator('.mp-status');
      check(await status.isVisible(), 'the sheet has a status block');
      const statusText = await status.innerText();
      check(/46\.8/.test(statusText) && /tok\/s/.test(statusText), 'the status block shows the reply speed', statusText);
      check(/routing · fast/.test(statusText), 'the status block shows the routing decision', statusText);
      check(/8\.2k/.test(statusText) && /Context window/.test(statusText), 'the status block shows context usage', statusText);
      await status.locator('.chat-context-meter summary').click();
      check(await status.getByRole('meter', { name: 'Estimated chat context used' }).isVisible(), 'context usage details expand in the sheet');
      check(await status.getByRole('button', { name: 'Compact chat' }).count() === 1, 'compaction stays reachable');
      await status.locator('.routing-details summary').click();
      check(await status.locator('.routing-details-body').isVisible(), 'routing details expand in the sheet');
      check(await sheet.getByRole('button', { name: new RegExp(MODEL.replace(/[-]/g, '.')) }).count() >= 1, 'the sheet lists the models', await sheet.locator('.mp-models').innerText().catch(() => ''));
      const thinking = sheet.getByRole('group', { name: 'Thinking' });
      check(await thinking.isVisible(), 'the sheet has a Thinking section');
      const levels = await thinking.getByRole('button').allInnerTexts();
      check(['Auto', 'Low', 'Standard', 'High'].every(l => levels.some(t => t.startsWith(l))), 'all thinking levels are offered', levels);
      check(await thinking.getByRole('button', { pressed: true }).count() === 1, 'the current level is marked');
      for (const b of await thinking.getByRole('button').all()) { const bb = await box(b); check(bb && bb.height >= 44, 'thinking level is a 44px target', bb); }
      await status.locator('.routing-details summary').click();
      await shot(page, `390x844-light-sheet`);
      // Escape closes the routing panel first, then the sheet, and focus returns to the button.
      await status.locator('.routing-details summary').click();
      await page.keyboard.press('Escape');
      check(await sheet.isVisible(), 'Escape inside an open routing panel closes the panel, not the sheet');
      await page.keyboard.press('Escape');
      await sheet.waitFor({ state: 'hidden' });
      check(await model.evaluate(e => e === document.activeElement), 'Escape closes the sheet and returns focus to the model button');
      // The backdrop closes it too.
      await model.click();
      await sheet.waitFor();
      await page.mouse.click(W / 2, 20);
      await sheet.waitFor({ state: 'hidden' });
      check(await model.evaluate(e => e === document.activeElement), 'a backdrop tap closes the sheet and returns focus');
      await page.close();
    });

    // ── Generating: a dot on the model button, the live line in the sheet ──
    await step('390x844 generating indicator', async () => {
      const page = await open(browser, { width: W, height: H, reply: false });
      check(!(await visible(page, '.composer-model-live')), 'no generating dot while idle');
      await send(page, 'live synthetic');
      await page.getByRole('button', { name: 'Stop generating', exact: true }).waitFor();
      const dot = page.locator('.composer-model .composer-model-live');
      check(await dot.isVisible(), 'a generating dot shows on the model button');
      const db = await box(dot);
      check(db && db.width <= 10 && db.height <= 10, 'the generating dot is tiny', db);
      check(await dot.evaluate(e => getComputedStyle(e).animationName) === 'none', 'reduced motion stops the pulse');
      await modelButton(page).click();
      const sheet = page.getByRole('dialog', { name: 'Model and tools' });
      await sheet.waitFor();
      check(/Generating/i.test(await sheet.locator('.mp-status').innerText()), 'the sheet shows the live reply status', await sheet.locator('.mp-status').innerText());
      await shot(page, '390x844-light-generating-sheet');
      await page.keyboard.press('Escape');
      await shot(page, '390x844-light-generating');
      await page.getByRole('button', { name: 'Stop generating', exact: true }).click();
      await page.waitForTimeout(300);
      check(!(await visible(page, '.composer-model-live')), 'the dot goes when the reply stops');
      await page.close();
    });

    // ── Cowork: the caption returns as a slim line when it says something ──
    await step('390x844 cowork caption', async () => {
      const page = await open(browser, { width: W, height: H });
      await page.getByRole('radio', { name: 'Cowork' }).click();
      const caption = page.locator('.composer-mode-harness');
      await caption.waitFor();
      check(/will (go|send) as chat|as chat/i.test(await caption.innerText()), 'the "will go as chat" warning shows', await caption.innerText());
      const cb = await box(caption), card = await box(page.locator('.chat-workspace .chat-composer-inner'));
      check(cb && card && cb.y + cb.height <= card.y + 1 && cb.height <= 40, 'the warning is one slim line above the composer', { cb, card });
      check((await page.getByRole('radio', { name: 'Cowork' }).getAttribute('aria-checked')) === 'true', 'Cowork is chosen');
      check(await page.getByRole('radio', { name: 'Cowork' }).innerText().then(t => t.includes('Cowork')), 'the chosen chip names its mode');
      await shot(page, '390x844-light-cowork');
      await page.close();
    });

    // ── Screenshots in both themes ─────────────────────────────────────────
    for (const theme of ['light', 'dark']) await step(`390x844 ${theme} screenshots`, async () => {
      const page = await open(browser, { width: W, height: H, theme });
      await shot(page, `390x844-${theme}-empty`);
      if (theme === 'dark') {
        const opaque = await opaqueBehindComposer(page);
        check(opaque.length === 0, 'dark: no opaque band behind the composer', opaque);
        await send(page, 'Synthetic question');
        await page.getByText('Synthetic answer paragraph.').first().waitFor();
        await page.waitForTimeout(400);
        await shot(page, `390x844-${theme}-messages`);
        await modelButton(page).click();
        await page.getByRole('dialog', { name: 'Model and tools' }).waitFor();
        await shot(page, `390x844-${theme}-sheet`);
      }
      await page.close();
    });

    // ── The narrowest phone keeps one row ──────────────────────────────────
    await step('320x640 one row', async () => {
      const page = await open(browser, { width: 320, height: 640 });
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '320px: no horizontal overflow');
      const send = await box(page.getByRole('button', { name: 'Send', exact: true })), add = await box(page.getByRole('button', { name: 'Add files and tools', exact: true }));
      check(send && add && send.x + send.width <= 320 && Math.abs(send.y - add.y) < 4, '320px: + and send share the row and stay on screen', { send, add });
      await shot(page, '320x640-light-empty');
      await page.close();
    });

    // ── Choosing a Thinking level keeps focus on it while it saves (#419) ──
    await step('390x844 thinking keeps focus', async () => {
      const page = await open(browser, { width: W, height: H });
      await modelButton(page).click();
      const sheet = page.getByRole('dialog', { name: 'Model and tools' });
      await sheet.waitFor();
      const low = sheet.getByRole('group', { name: 'Thinking' }).getByRole('button', { name: /^Low/ });
      await low.focus();
      await page.keyboard.press('Enter');
      await page.waitForTimeout(100);
      check(await low.getAttribute('aria-disabled') === 'true', 'the level reads as busy while it saves');
      check(await low.evaluate(e => e === document.activeElement), 'focus stays on the level while it saves');
      await page.waitForFunction(() => [...document.querySelectorAll('.reasoning-level')].some(b => b.getAttribute('aria-pressed') === 'true' && b.textContent.startsWith('Low')));
      await page.waitForTimeout(150);
      check(await low.evaluate(e => e === document.activeElement), 'focus is still on the chosen level after the save', await page.evaluate(() => document.activeElement?.tagName + ' ' + document.activeElement?.textContent?.slice(0, 20)));
      check(await low.getAttribute('aria-disabled') === null, 'the level is available again after the save');
      await page.keyboard.press('Escape');
      await sheet.waitFor({ state: 'hidden' });
      check((await modelButton(page).innerText()).replace(/\s+/g, ' ').trim() === 'Auto · Low', 'the model button shows the new level', await modelButton(page).innerText());
      await page.close();
    });

    // ── Effort settings unavailable: no level on the button, none in the sheet ─
    await step('390x844 thinking unavailable', async () => {
      const page = await open(browser, { width: W, height: H, reasoning: false });
      await page.waitForTimeout(300);
      const model = modelButton(page);
      check((await model.innerText()).replace(/\s+/g, ' ').trim() === 'Auto', 'without effort settings the button shows only the model', await model.innerText());
      check(await model.getAttribute('aria-label') === 'Choose model: Auto (Fast/Smart)', 'and names only the model', await model.getAttribute('aria-label'));
      await model.click();
      const sheet = page.getByRole('dialog', { name: 'Model and tools' });
      await sheet.waitFor();
      check(await sheet.getByRole('group', { name: 'Thinking' }).count() === 0, 'and the sheet has no Thinking section');
      await page.close();
    });

    // ── The message box re-measures across the tier boundary ───────────────
    await step('resize across the phone breakpoint', async () => {
      const page = await open(browser, { width: 1440, height: 900, touch: false });
      const input = page.getByRole('textbox', { name: 'Message', exact: true });
      const measure = () => input.evaluate(e => ({ h: e.getBoundingClientRect().height, rows: e.rows, overflow: getComputedStyle(e).overflowY, scroll: e.scrollHeight, client: e.clientHeight }));
      const desk = await measure();
      await page.setViewportSize({ width: W, height: H });
      await page.waitForTimeout(250);
      const phone = await measure();
      check(phone.rows === 1 && phone.h <= 48 && phone.h < desk.h, 'an empty box drops to one line when the window becomes phone-sized', { desk, phone });
      // A draft that fits the desktop box (no scrollbar there) but not the phone's 160px.
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.waitForTimeout(250);
      await input.fill(Array.from({ length: 7 }, (_, i) => `Synthetic draft line ${i + 1}`).join('\n'));
      const fits = await measure();
      check(fits.overflow === 'hidden' && fits.h > 161, 'the draft fits the desktop box without scrolling', fits);
      await page.setViewportSize({ width: W, height: H });
      await page.waitForTimeout(250);
      const tall = await measure();
      check(tall.h <= 161 && tall.overflow === 'auto' && tall.scroll > tall.client, 'a long draft is capped and scrolls inside the phone box, not clipped', tall);
      await input.fill('');
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.waitForTimeout(250);
      const back = await measure();
      check(back.rows === 2 && Math.abs(back.h - desk.h) <= 1, 'back on the desktop the box is its two-row self again', { desk, back });
      await page.close();
    });

    // ── Compaction: said beside the composer, announced once ───────────────
    await step('390x844 compaction status', async () => {
      const page = await open(browser, { width: W, height: H });
      for (let i = 0; i < 3; i++) { await send(page, `Synthetic question ${i + 1}`); await page.waitForFunction(n => document.querySelectorAll('.chat-workspace .msg').length >= n, (i + 1) * 2); await page.waitForTimeout(250); }
      await modelButton(page).click();
      const sheet = page.getByRole('dialog', { name: 'Model and tools' });
      await sheet.waitFor();
      await sheet.locator('.chat-context-meter summary').click();
      await sheet.getByRole('button', { name: 'Compact chat' }).click();
      await page.keyboard.press('Escape');
      await sheet.waitFor({ state: 'hidden' });
      const line = page.locator('.composer > .chat-context-live');
      check(await line.isVisible() && /Compacting|Summarising/.test(await line.innerText()), 'a slim line says the chat is compacting', await line.innerText());
      check(await page.getByRole('textbox', { name: 'Message', exact: true }).isDisabled(), 'while the composer waits for it');
      const lb = await box(line), card = await box(page.locator('.chat-workspace .chat-composer-inner'));
      check(lb && card && lb.y + lb.height <= card.y + 1 && lb.height <= 40, 'the line sits just above the composer', { lb, card });
      await shot(page, '390x844-light-compacting');
      await page.waitForFunction(() => /Compacted/.test(document.querySelector('.composer > .chat-context-live')?.textContent || ''), null, { timeout: 5000 });
      check(!(await line.isVisible()) || (await line.evaluate(e => e.getBoundingClientRect().height)) <= 1, 'the line goes when compaction finishes');
      const regions = await page.evaluate(() => [...document.querySelectorAll('[role="status"], [aria-live]')].filter(e => /Compacted/.test(e.textContent || '')).length);
      check(regions === 1, 'the result is announced by exactly one live region', regions);
      check(await page.getByRole('textbox', { name: 'Message', exact: true }).isEnabled(), 'the composer is usable again');
      await modelButton(page).click();
      await sheet.waitFor();
      await sheet.locator('.chat-context-meter summary').click();
      check(/Compacted/.test(await sheet.locator('.chat-context-meter').innerText()), 'the sheet still shows the result', await sheet.locator('.chat-context-meter').innerText());
      await page.close();
    });

    // ── The sheet opens at its top, focus on its heading ───────────────────
    await step('390x844 sheet opens at the top', async () => {
      const page = await open(browser, { width: W, height: H, routing: 'manual', models: 8 });
      await send(page, 'Synthetic question');
      await page.getByText('Synthetic answer paragraph.').first().waitFor();
      await modelButton(page).click();
      const sheet = page.getByRole('dialog', { name: 'Model and tools' });
      await sheet.waitFor();
      await sheet.getByRole('searchbox').waitFor();
      await page.waitForTimeout(400);
      check(await sheet.locator('.mp-grid').evaluate(e => e.scrollTop) === 0, 'the sheet opens scrolled to the top (8 models, filter shown)', await sheet.locator('.mp-grid').evaluate(e => e.scrollTop));
      const focus = await page.evaluate(() => { const e = document.activeElement; return e && `${e.tagName}${e.closest('.mp-head') ? ' in header' : ''}`; });
      check(focus === 'H2 in header', 'initial focus is the sheet heading, not a field', focus);
      const status = await box(sheet.locator('.mp-status')), grid = await box(sheet.locator('.mp-grid'));
      check(status && grid && status.y >= grid.y - 1 && status.y < grid.y + grid.height, 'the status block is in view', { status, grid });
      await page.close();
    });

    // ── Tier 2 by height: the sheet is one scrolling column that fits ──────
    await step('1280x560 model sheet', async () => {
      const page = await open(browser, { width: 1280, height: 560, routing: 'manual' });
      await send(page, 'Synthetic question');
      await page.getByText('Synthetic answer paragraph.').first().waitFor();
      await modelButton(page).click();
      const sheet = page.getByRole('dialog', { name: 'Model and tools' });
      await sheet.waitFor();
      const panel = await box(sheet.locator('.mp-panel'));
      check(panel && panel.y >= 0 && panel.y + panel.height <= 560 + 0.5, '1280x560: the sheet fits the window', panel);
      const thinking = sheet.getByRole('group', { name: 'Thinking' });
      await thinking.scrollIntoViewIfNeeded();
      check(await thinking.isVisible(), '1280x560: Thinking is reachable by scrolling the sheet');
      const cols = await sheet.locator('.mp-grid').evaluate(e => getComputedStyle(e).gridTemplateColumns.split(' ').length);
      check(cols === 1, '1280x560: one column', cols);
      await shot(page, '1280x560-light-sheet');
      await page.close();
    });

    // ── Tier 0: unchanged ──────────────────────────────────────────────────
    await step('tier 0 1440x900 unchanged', async () => {
      const capture = async () => {
        const page = await open(browser, { width: 1440, height: 900 });
        const empty = await tier0Snapshot(page);
        await send(page, 'Synthetic question');
        await page.getByText('Synthetic answer paragraph.').first().waitFor();
        await page.waitForTimeout(400);
        const full = await tier0Snapshot(page);
        const facts = {
          rows: await page.getByRole('textbox', { name: 'Message', exact: true }).evaluate(e => e.rows),
          modeOutside: await page.locator('.composer-mode-bar [role="radiogroup"]').count() === 1 && await page.locator('.chat-workspace .chat-composer-inner [role="radiogroup"]').count() === 0,
          thinkingPill: await page.getByRole('button', { name: 'Thinking effort', exact: true }).isVisible(),
          strip: await page.locator('.app-stack > .stats-disclosure.is-wide').isVisible(),
          meter: await page.locator('.composer .chat-context-meter').isVisible(),
          composerH: await page.locator('.chat-workspace').evaluate(e => e.style.getPropertyValue('--composer-h')),
        };
        await shot(page, '1440x900-light-messages');
        await page.close();
        return { empty, full, facts };
      };
      const now = await capture();
      check(now.facts.rows === 2 && now.facts.modeOutside && now.facts.thinkingPill && now.facts.strip && now.facts.meter && now.facts.composerH === '', 'tier 0 keeps the mode row, Thinking pill, strip and context row', now.facts);
      const base = process.env.QA_BASE_DIST;
      if (base) {
        const own = process.env.QA_DIST;
        process.env.QA_DIST = base;
        let before; try { before = await capture(); } finally { if (own === undefined) delete process.env.QA_DIST; else process.env.QA_DIST = own; }
        for (const key of ['empty', 'full']) for (let i = 0; i < now[key].length; i++) {
          check(JSON.stringify(now[key][i]) === JSON.stringify(before[key][i]), `tier 0 ${key}: ${now[key][i][0]} unchanged from the base build`, { base: before[key][i][1], branch: now[key][i][1] });
        }
      }
    });

    check(errors.length === 0, 'no browser errors', errors);
    check(fixture.requests.every(r => r.path === '/api/chat' && r.body.message === 'live synthetic'), 'the only fixture stream is the synthetic live reply', fixture.requests.map(r => r.body.message));
    fs.writeFileSync(path.join(out, `${prefix}-results.json`), JSON.stringify({ checks, failures, errors }, null, 2));
    console.log(JSON.stringify({ checks, failed: failures.length, failures }, null, 2));
    if (failures.length) process.exitCode = 1;
  } finally { await browser.close(); await fixture.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
