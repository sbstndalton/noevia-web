// #615 (reopened, round 8), #624 item 1, #626, #627, #628 in the German and French UI. The language is
// set in page memory only (the preferences GET is answered with de-DE / fr-FR); the synthetic
// account is never changed and nothing touches Diary or real storage.
//   #615  the composer tools menu names AND describes every in-app toolset. The server marks the
//         diary, project-docs, web and Nextcloud boxes `source: "mcp"` (flagged inApp), so the round-7
//         check that only looked at a synthetic `builtin` Core box never saw the bug.
//   #624  the reply's "Using:" list is worded per box id
//   #626  the reply header ("Auto (Schnell)"), "1 Werkzeugaufruf", the thinking / generating status,
//         and the Stopped placeholder
//   #627  the sidebar MCP footer (plural + number format) and the Code tab's architect options
//   #628  the French Backups size says "ko", not "KB"
// The real application server with a synthetic upstream (qa/sources-panel-lib.cjs); the chat stream
// and the toolbox list are synthetic in the page. Fails on a build without the fixes and passes with them.
//
// Run: [APP_DIR=<web dir of a built app>] [QA_SCREENSHOTS=<dir>] node qa/locale-615-626-628.cjs
const os = require('node:os'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || `${os.homedir()}/noevia-local-test/node_modules/playwright-core`);
const assert = require('node:assert/strict');
const ts = require('typescript');
const { start, signedIn } = require('./sources-panel-lib.cjs');
const { buildToolboxManifest } = require('../server/mcp-toolbox-manifest.cjs');

// The catalogues, loaded from this tree's source (the expected wording), never from the build under test.
const SRC = path.join(__dirname, '../src'), cache = {};
function load(file) {
  file = path.posix.normalize(file);
  if (cache[file]) return cache[file];
  const exports_ = {}; cache[file] = exports_;
  const code = ts.transpileModule(fs.readFileSync(path.join(SRC, file + '.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const here = path.posix.dirname(file);
  vm.runInNewContext(code, { exports: exports_, Intl, Map, Number, Object, console, Promise, require: (m) => load(path.posix.join(here, m)) });
  return exports_;
}
const core = load('i18n/core');
core.registerCatalogue('de-DE', load('i18n/de-DE').DE_DE);
core.registerCatalogue('fr-FR', load('i18n/fr-FR').FR_FR);
const EN = load('i18n/en-GB').EN_GB;
const { TOOLBOX_LABEL_IDS } = load('toolbox-copy');

// Every in-app toolset, as the server defines it: the manifest boxes, Core, Offline Wikipedia and Google Drive.
const manifest = buildToolboxManifest({ features: { enabled: () => true } });
const INAPP = [
  { id: 'core', label: 'Core', description: EN['toolbox.desc.core'], source: 'builtin' },
  ...manifest.map((b) => ({ id: b.id, label: b.label, description: b.description, source: 'mcp' })),
  { id: 'offline-wikipedia', label: 'Offline Wikipedia', description: 'Search and read the offline Wikipedia copy on this server. Read-only.', source: 'builtin' },
  { id: 'gdrive', label: 'Google Drive', description: 'Search, read and write files in your connected Google Drive (only files noevia created or was given).', source: 'builtin', connector: true },
].map((b) => ({ ...b, inApp: true, toolCount: 3, estTokens: 300 }));
// A box a third party defined: it keeps exactly the words it sent.
const THIRD = { id: 'their-box', label: 'Their Box', description: 'Their own wording, never translated.', source: 'mcp', toolCount: 1, estTokens: 100 };

const L = {
  'de-DE': {
    add: 'Dateien und Werkzeuge hinzufügen', using: 'Verwendet: Kern, Tagebuch', auto: 'Auto (Schnell)', calls: ['1 Werkzeugaufruf', '2 Werkzeugaufrufe'], state: 'erledigt',
    thinking: 'denkt nach…', generating: 'generiert…', stopped: 'Gestoppt', stoppedText: 'Gestoppt, bevor eine Antwort geschrieben wurde.',
    mcp: 'MCP · 175 Werkzeuge · 3 Server (integriert)', local: 'Lokaler Architekt', frontier: 'Frontier-Architekt', unavailable: 'nicht verfügbar', prep: 'Prompt-Aufbereitung',
    size: /^.*652[\s  ]kB\b/, notSize: /KB|MB/, diary: 'Tagebuch',
  },
  'fr-FR': {
    add: 'Ajouter des fichiers et des outils', using: 'Utilise : Base, Journal', auto: 'Auto (Rapide)', calls: ['1 appel d’outil', '2 appels d’outils'], state: 'terminé',
    thinking: 'réflexion…', generating: 'génération…', stopped: 'Arrêté', stoppedText: 'Arrêté avant l’écriture d’une réponse.',
    mcp: 'MCP · 175 outils · 3 serveurs (intégrés)', local: 'Architecte local', frontier: 'Architecte frontière', unavailable: 'indisponible', prep: 'Préparation du prompt',
    size: /^.*652[\s  ]ko\b/, notSize: /KB|MB/, diary: 'Journal',
  },
};
const ENGLISH_CHAT = /\btool calls?\b|thinking…|generating…|Stopped before|\bAuto \((fast|smart|code)\)|\bunavailable\b|\b\d+ tools\b|Local architect|Frontier architect/;

const backupStatus = (() => {
  const stamp = Date.parse('2026-09-28T02:05:00');
  return { enabled: true, ready: true, reason: null, reasonCode: null, reasonGaps: [], busy: null,
    schedule: 'Daily at 02:00 (server time)', scheduleHour: 2, retention: 'Keeps 7 daily, 4 weekly and 6 monthly snapshots', retentionPolicy: { daily: 7, weekly: 4, monthly: 6 },
    destination: 'Folder /backup/noevia', destinationFolder: { path: '/backup/noevia', mirror: null }, paths: 3, google: null,
    lastBackup: { at: stamp, id: 's5', files: 3, uploadedBytes: 652 * 1024 }, lastVerify: { at: stamp, verifiedAt: stamp, id: 's5', files: 3 }, lastError: null, snapshots: 5 };
})();
const codeState = {
  repositories: [{ id: 'noevia' }], capabilities: ['read_repository', 'edit_file', 'execute_command', 'install_dependency', 'network', 'delete', 'git_push'],
  defaultCapabilities: ['read_repository', 'edit_file', 'execute_command'], harnesses: [{ id: 'opencode', label: 'OpenCode', version: '1.18.31' }],
  // Exactly the ids and English labels server/code-service.cjs sends.
  promptPreparation: [{ id: 'direct', label: 'Direct', available: true, reason: 'Your request goes to the model as you wrote it.' },
    { id: 'local', label: 'Local architect', available: false, reason: 'Not offered yet.' }, { id: 'frontier', label: 'Frontier architect', available: false, reason: 'Not built.' }],
  sandboxed: true, network: false, tasks: [],
};

// The synthetic chat stream, installed in the page: a fetch of /api/chat answers from the message text.
function installChat(locale) {
  window.__qaMessages = [];
  const realFetch = window.fetch.bind(window);
  const enc = new TextEncoder();
  const sse = (events) => events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');
  window.fetch = (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.origin);
    if (url.pathname !== '/api/chat' || (init.method || 'GET') !== 'POST') return realFetch(input, init);
    const { message } = JSON.parse(init.body);
    window.__qaMessages.push(message);
    const scope = { type: 'tools_scope', text: 'Core, Diary', boxes: [{ id: 'core', label: 'Core', inApp: true }, { id: 'diary', label: 'Diary', inApp: true }] };
    const call = (i) => [{ type: 'tool', index: i, name: 'diary_read_today', args: '{}' }, { type: 'tool_result', index: i, name: 'diary_read_today', text: 'ok' }];
    const finished = { ONE: [{ type: 'meta', route: 'fast' }, scope, ...call(0), { type: 'delta', text: 'Synthetic answer one.' }, { type: 'done' }],
      TWO: [{ type: 'meta', route: 'smart' }, ...call(0), ...call(1), { type: 'delta', text: 'Synthetic answer two.' }, { type: 'done' }] }[message];
    const headers = { 'Content-Type': 'text/event-stream' };
    if (finished) return Promise.resolve(new Response(sse(finished), { status: 200, headers }));
    // HOLD: a thought arrives and the stream stays open; QUIET: nothing arrives. Stop ends either one.
    const stream = new ReadableStream({
      start(controller) {
        if (message === 'HOLD') controller.enqueue(enc.encode(sse([{ type: 'reasoning', text: 'Synthetic thought.' }])));
        init.signal?.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')));
      },
    });
    return Promise.resolve(new Response(stream, { status: 200, headers }));
  };
}

(async () => {
  let env;
  const browser = await chromium.launch({ headless: true, channel: process.env.QA_CHANNEL || 'chrome' });
  const errors = [], failures = [];
  const shots = process.env.QA_SCREENSHOTS;
  const check = async (name, fn) => {
    try { await fn(); console.log(`ok   ${name}`); } catch (e) { failures.push(name); console.log(`FAIL ${name}\n     ${String(e.message).split('\n').slice(0, 5).join('\n     ')}`); }
  };
  const flat = (s) => s.replace(/[\s  ]+/g, ' ').trim();
  try {
    for (const locale of Object.keys(L)) {
      const l = L[locale], t = (key, params) => core.translate(locale, key, params);
      for (const [width, theme] of [[375, 'light'], [768, 'dark'], [1440, 'light'], [1440, 'dark']]) {
        if (process.env.QA_ONLY && !`${locale}:${width}:${theme}`.startsWith(process.env.QA_ONLY)) continue;
        const tag = `${locale} ${width} ${theme}`, short = `${locale.slice(0, 2)}-${width}-${theme}`;
        env = await start({ port: 31615, name: 'locale615' });
        const { ctx, page, api } = await signedIn(browser, env, { width, theme, projectName: `Projet ${short}` });
        page.on('pageerror', (e) => errors.push(`${tag}: ${e.message}`));
        const project = JSON.parse((await api('/api/projects', { name: `Locale ${short}`, model: 'synthetic', routing: 'manual', toolboxes: ['core'] })).text);
        await page.route('**/api/account/preferences', async (route) => {
          if (route.request().method() !== 'GET') return route.continue();
          const response = await route.fetch();
          return route.fulfill({ response, json: { ...(await response.json()), locale } });
        });
        // The real server sends the in-app boxes as source "mcp" once MCP is connected; three servers, 175 tools.
        const servers = ['nextcloud', 'tavily', 'internal-mcp'].map((id) => ({ id, auth: id === 'internal-mcp' ? 'internal' : 'none', error: null, discovered: 58 }));
        await page.route('**/api/toolboxes', (route) => route.request().method() !== 'GET' ? route.continue() : route.fulfill({ json: { toolboxes: [...INAPP.filter((b) => !b.connector), { ...INAPP.find((b) => b.connector) }, THIRD], mcp: { configured: true, discovered: 175, servers } } }));
        await page.route('**/api/features', async (route) => { const r = await route.fetch(); const j = await r.json(); return route.fulfill({ response: r, json: { ...j, flags: { ...(j.flags || {}), codeHarness: true, offsiteBackup: true } } }); });
        await page.route('**/api/projects/*/code**', (route) => route.fulfill({ json: codeState }));
        await page.route('**/api/code/active', (route) => route.fulfill({ json: { tasks: [], total: 0 } }));
        await page.route('**/api/admin/offsite-backup', (route) => route.fulfill({ json: backupStatus }));
        await page.addInitScript(installChat, locale);

        const chatId = `l615-${short}`;
        assert.equal((await api(`/api/projects/${project.id}/chats`, { chats: [{ id: chatId, title: 'Plan' }] })).status, 200);
        await page.goto(`${env.origin}/c/${chatId}`);
        await page.locator('textarea').first().waitFor({ timeout: 20000 });
        const send = async (text) => { await page.locator('textarea').first().fill(text); await page.keyboard.press('Enter'); };

        // ---- #615: the composer tools menu ----
        await check(`#615 the tools menu names and describes every in-app toolset in ${locale} (${tag})`, async () => {
          await page.getByRole('button', { name: new RegExp(`^${l.add}`) }).first().click();
          const panel = page.locator('.composer-actions-panel');
          await panel.waitFor();
          await panel.locator('.composer-tool-option').first().waitFor({ timeout: 10000 });
          const rows = await panel.locator('.composer-tool-option').evaluateAll((els) => els.map((e) => e.innerText.replace(/\s+/g, ' ').trim()));
          assert.equal(rows.length, INAPP.length + 1, `every box has a row: ${rows.length}`);
          const wanted = (b) => ({
            label: TOOLBOX_LABEL_IDS.includes(b.id) ? t(`toolbox.label.${b.id}`) : b.label,
            description: t(`toolbox.desc.${b.id}`),
          });
          for (const b of INAPP) {
            const want = wanted(b);
            const row = rows.find((r) => r.startsWith(want.label) && r.includes(flat(want.description)));
            assert.ok(row, `${b.id}: expected "${want.label}" / "${want.description}" in: ${JSON.stringify(rows.filter((r) => r.includes(b.label)))}`);
            assert.notEqual(flat(want.description), flat(b.description), `${b.id}: the catalogue text differs from English`);
          }
          // Named in the tester's report.
          assert.ok(rows.some((r) => r.startsWith(l.diary)), `${l.diary} row`);
          // A third party's box is left as it sent it.
          assert.ok(rows.some((r) => r === `${THIRD.label} ${THIRD.description}`), `their box untouched: ${JSON.stringify(rows.slice(-2))}`);
          for (const b of INAPP) assert.ok(!rows.some((r) => r.includes(flat(b.description))), `English description of ${b.id} still shown`);
          if (shots) await page.screenshot({ path: `${shots}/tools-menu-${short}.png`, fullPage: true });
          await page.keyboard.press('Escape');
        });

        // ---- #624 #626: a reply with one tool call, then one with two ----
        await send('ONE');
        await page.locator('.msg[data-role=assistant] .tool-calls').first().waitFor({ timeout: 15000 });
        await page.getByText('Synthetic answer one.').waitFor();
        await check(`#626 the reply header and the tool-call count are ${locale} (${tag})`, async () => {
          const sender = (await page.locator('.msg-sender.is-assistant').last().textContent()).replace(/\s+/g, ' ').trim();
          assert.ok(sender.endsWith(l.auto), `sender "${sender}" ends with ${l.auto}`);
          const summary = flat(await page.locator('.tool-calls > summary').first().innerText());
          assert.equal(summary, l.calls[0]);
          assert.equal(await page.locator('.tool-call-state').first().getAttribute('aria-label'), l.state);
          const shown = flat(await page.locator('.transcript').innerText());
          assert.doesNotMatch(shown, ENGLISH_CHAT, shown);
        });
        await check(`#624 the "Using:" list names each toolbox in ${locale} (${tag})`, async () => {
          assert.equal(flat(await page.locator('.tool-scope').first().innerText()), l.using);
        });
        await send('TWO');
        await page.getByText('Synthetic answer two.').waitFor({ timeout: 15000 });
        await check(`#626 two tool calls use the ${locale} plural (${tag})`, async () => {
          const summaries = (await page.locator('.tool-calls > summary').allInnerTexts()).map(flat);
          assert.deepEqual(summaries, [l.calls[0], l.calls[1]]);
        });

        // ---- #626: the status while a reply is being written, and the Stopped placeholder ----
        await send('HOLD');
        await check(`#626 the thinking status is ${locale} (${tag})`, async () => {
          await page.locator('.msg-meta').last().waitFor({ timeout: 10000 });
          await page.waitForFunction((word) => /HOLD/.test(window.__qaMessages.at(-1)) && [...document.querySelectorAll('.msg-meta')].some((e) => e.textContent.includes(word)), l.thinking, { timeout: 10000 });
          assert.doesNotMatch(flat(await page.locator('.msg-meta').last().innerText()), /thinking|generating/);
        });
        await page.getByRole('button', { name: t('composer.stop') }).click();
        await page.getByRole('button', { name: t('composer.send') }).waitFor({ timeout: 10000 });
        await send('QUIET');
        await check(`#626 the generating status is ${locale} (${tag})`, async () => {
          await page.waitForFunction((word) => [...document.querySelectorAll('.msg-meta')].some((e) => e.textContent.includes(word)), l.generating, { timeout: 10000 });
        });
        await page.getByRole('button', { name: t('composer.stop') }).click();
        await check(`#626 the Stopped placeholder is ${locale} (${tag})`, async () => {
          await page.getByText(l.stoppedText).waitFor({ timeout: 10000 });
          const last = (await page.locator('.msg-sender.is-assistant').last().textContent()).replace(/\s+/g, ' ').trim();
          assert.ok(last.endsWith(l.stopped), `sender "${last}"`);
          assert.doesNotMatch(flat(await page.locator('.transcript').innerText()), /Stopped before/);
          if (shots) await page.screenshot({ path: `${shots}/chat-${short}.png`, fullPage: true });
        });

        // ---- #627: the sidebar MCP footer ----
        await check(`#627 the sidebar MCP footer is ${locale} (${tag})`, async () => {
          const row = page.locator('.mcp-row .status-text').first();
          await row.waitFor({ state: 'attached', timeout: 10000 });
          assert.equal(flat(await row.textContent()), l.mcp);
        });

        // ---- #627: the Code tab's prompt preparation options ----
        await page.goto(`${env.origin}/p/${project.id}/code`);
        await check(`#627 the Code architect options are ${locale} (${tag})`, async () => {
          const select = page.getByLabel(l.prep, { exact: true });
          await select.waitFor({ timeout: 20000 });
          const options = (await select.locator('option').allTextContents()).map(flat);
          assert.deepEqual(options, [t('code.prep.direct.label'), `${l.local} — ${l.unavailable}`, `${l.frontier} — ${l.unavailable}`]);
          if (shots) await page.screenshot({ path: `${shots}/code-${short}.png`, fullPage: true });
        });

        // ---- #628: the Backups size ----
        await page.goto(`${env.origin}/settings/backups`);
        await check(`#628 the Backups size uses ${locale} byte units (${tag})`, async () => {
          await page.locator('.set-rows .set-row').first().waitFor({ timeout: 20000 });
          const shown = flat(await page.locator('.set-rows').innerText());
          assert.match(shown, l.size, shown);
          assert.doesNotMatch(shown, l.notSize, shown);
          if (shots) await page.screenshot({ path: `${shots}/backups-${short}.png`, fullPage: true });
        });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no sideways scroll at ' + tag);
        await ctx.close(); await env.stop(); env = null;
      }
    }
    assert.deepEqual(errors.filter((e) => !/ResizeObserver/.test(e)), [], 'page errors');
    if (failures.length) { console.log(`FAIL locale-615-626-628: ${failures.length} check(s) failed`); process.exitCode = 1; }
    else console.log('PASS #615 #624 #626 #627 #628 in German and French; 375/768/1440, light and dark.');
  } finally { await browser.close(); if (env) await env.stop(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
