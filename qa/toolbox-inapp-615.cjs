// #615 (reopened, round 9): the composer tools menu shows every in-app toolset in the interface
// language. The round-7 and round-8 checks mocked /api/toolboxes in the page, so they never saw that the
// REAL /api/toolboxes/permitted (which feeds this menu) left out the `inApp` flag the picker had.
// Nothing about the toolbox endpoints is mocked here: the real application server runs with three
// synthetic MCP servers (nextcloud, tavily, noevia: every tool the manifest names), so the boxes
// arrive exactly as live, `source: "mcp"` and all. Only the account language is set, by answering
// the preferences GET with de-DE / fr-FR (in page memory; the synthetic account is unchanged).
//
//   1. the real /api/toolboxes and /api/toolboxes/permitted (chat and cowork) carry inApp:true for
//      every in-app box, and false for none of them
//   2. the composer tools menu (the "/" catalogue) names and describes each box from the catalogue,
//      words the unavailable reasons (and the coding harness) by code
//   3. the model popup, fed by the real /api/toolboxes, does the same
//
// Fails on a build of origin/main and passes with the fix.
//
// Run: [APP_DIR=<web dir of a built app>] [QA_SCREENSHOTS=<dir>] node qa/toolbox-inapp-615.cjs
const os = require('node:os'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), http = require('node:http');
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
const { TOOLBOX_LABEL_IDS, TOOLBOX_DESCRIPTION_IDS } = load('toolbox-copy');

const manifest = buildToolboxManifest({ features: { enabled: () => true } });
const IN_APP_IDS = ['core', ...manifest.map((b) => b.id)];

// Three MCP servers that offer exactly the tools the manifest names; every other request is a no-op.
function fakeMcp(port) {
  const byServer = {};
  for (const box of manifest) (byServer[box.server] ||= new Set()) && box.tools.forEach((n) => byServer[box.server].add(n));
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const c of req) raw += c;
    const msg = raw ? JSON.parse(raw) : {};
    const serverId = req.url.split('/')[1];
    const reply = (result) => { res.setHeader('Content-Type', 'application/json'); res.setHeader('mcp-session-id', 'qa-session'); res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result })); };
    if (msg.method === 'initialize') return reply({ protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: `qa-${serverId}`, version: '0' } });
    if (msg.id === undefined) { res.statusCode = 202; return res.end(); }
    if (msg.method === 'tools/list') return reply({ tools: [...(byServer[serverId] || [])].map((name) => ({ name, description: `Synthetic ${name}.`, inputSchema: { type: 'object', properties: {} } })) });
    return reply({ content: [{ type: 'text', text: 'ok' }] });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

(async () => {
  let env, mcp;
  const browser = await chromium.launch({ headless: true, channel: process.env.QA_CHANNEL || 'chrome' });
  const errors = [], failures = [];
  const shots = process.env.QA_SCREENSHOTS;
  const check = async (name, fn) => {
    try { await fn(); console.log(`ok   ${name}`); } catch (e) { failures.push(name); console.log(`FAIL ${name}\n     ${String(e.message).split('\n').slice(0, 6).join('\n     ')}`); }
  };
  const flat = (s) => s.replace(/[\s  ]+/g, ' ').trim();
  try {
    for (const locale of ['de-DE', 'fr-FR']) {
      const t = (key, params) => core.translate(locale, key, params);
      for (const [width, theme] of [[375, 'light'], [768, 'dark'], [1440, 'light'], [1440, 'dark']]) {
        if (process.env.QA_ONLY && !`${locale}:${width}:${theme}`.startsWith(process.env.QA_ONLY)) continue;
        const tag = `${locale} ${width} ${theme}`, short = `${locale.slice(0, 2)}-${width}-${theme}`;
        mcp = await fakeMcp(31716);
        const base = 'http://127.0.0.1:31716';
        env = await start({ port: 31615, name: 'toolbox615', env: { MCP_SERVERS: `nextcloud|${base}/nextcloud|none,tavily|${base}/tavily|none,noevia|${base}/noevia|none` } });
        const { ctx, page, api } = await signedIn(browser, env, { width, theme, projectName: `Outils ${short}` });
        page.on('pageerror', (e) => errors.push(`${tag}: ${e.message}`));
        const project = JSON.parse((await api('/api/projects', { name: `Toolbox ${short}`, model: 'synthetic', routing: 'manual', toolboxes: ['core'] })).text);
        await page.route('**/api/account/preferences', async (route) => {
          if (route.request().method() !== 'GET') return route.continue();
          const response = await route.fetch();
          return route.fulfill({ response, json: { ...(await response.json()), locale } });
        });
        const getJson = async (url) => JSON.parse((await api(url)).text);
        // The server discovers MCP lazily; the first call waits for it, so everything below sees the boxes.
        const picker = await getJson('/api/toolboxes');
        const permitted = { chat: await getJson(`/api/toolboxes/permitted?projectId=${project.id}&mode=chat`), cowork: await getJson(`/api/toolboxes/permitted?projectId=${project.id}&mode=cowork`) };

        await check(`#615 the real toolbox endpoints all flag every in-app box (${tag})`, async () => {
          const ids = picker.toolboxes.map((b) => b.id);
          for (const id of IN_APP_IDS) assert.ok(ids.includes(id), `the real server offers ${id}: ${ids}`);
          for (const b of picker.toolboxes.filter((x) => IN_APP_IDS.includes(x.id))) assert.equal(b.inApp, true, `/api/toolboxes ${b.id}`);
          for (const [mode, view] of Object.entries(permitted)) {
            for (const id of [...IN_APP_IDS, 'code']) {
              const box = view.boxes.find((b) => b.id === id);
              assert.ok(box, `/permitted (${mode}) lists ${id}`);
              assert.equal(box.inApp, true, `/permitted (${mode}) ${id}: source ${box.source}, inApp ${box.inApp}`);
            }
          }
          assert.ok(permitted.chat.boxes.some((b) => b.id === 'diary' && b.source === 'mcp'), 'the diary is MCP-backed, as live');
        });

        const chatId = `t615-${short}`;
        assert.equal((await api(`/api/projects/${project.id}/chats`, { chats: [{ id: chatId, title: 'Plan' }] })).status, 200);
        await page.goto(`${env.origin}/c/${chatId}`);
        const composer = page.locator('textarea').first();
        await composer.waitFor({ timeout: 20000 });

        // What the menu must say for one box: the catalogue's label and description by id, or the
        // server's own words where the catalogue has none (product names), or the reason by code.
        const expectRow = (box) => {
          const label = TOOLBOX_LABEL_IDS.includes(box.id) ? t(`toolbox.label.${box.id}`) : box.label;
          const description = TOOLBOX_DESCRIPTION_IDS.includes(box.id) ? t(`toolbox.desc.${box.id}`) : box.description;
          const reason = box.reasonCode ? t(`tools.reason.${box.reasonCode}`) : box.reason;
          return { label, text: reason || description, english: reason ? box.reason : box.description };
        };

        await check(`#615 the composer tools menu is ${locale} for every in-app toolset (${tag})`, async () => {
          await composer.fill('/');
          const list = page.locator('.tool-catalogue-list');
          await list.waitFor({ timeout: 10000 });
          await list.locator('li[data-kind=box]').first().waitFor();
          const rows = await list.locator('li[data-kind=box]').evaluateAll((els) => els.map((e) => e.querySelector('.tool-catalogue-label').innerText.trim() + '||' + e.querySelector('small').innerText.replace(/\s+/g, ' ').trim()));
          for (const box of permitted.chat.boxes.filter((b) => [...IN_APP_IDS, 'code'].includes(b.id))) {
            const want = expectRow(box);
            const row = rows.find((r) => r.startsWith(`${want.label}||`));
            assert.ok(row, `${box.id}: a row labelled "${want.label}" in ${JSON.stringify(rows)}`);
            assert.equal(flat(row.split('||')[1]), flat(want.text), `${box.id} text`);
            if (want.text !== want.english) assert.ok(!rows.some((r) => r.includes(flat(want.english))), `${box.id}: English "${want.english}" still shown`);
          }
          // Named in the tester's report.
          assert.ok(rows.some((r) => r.startsWith(`${t('toolbox.label.diary')}||`)), 'the Diary row');
          assert.ok(rows.some((r) => r.includes(t('tools.reason.codeNeedsCowork'))), 'the coding harness reason');
          if (shots) await page.screenshot({ path: `${shots}/tools-menu-615-${short}.png`, fullPage: true });
          await composer.fill('');
          await page.keyboard.press('Escape');
        });

        if (width >= 768) {
          // #1006: the model dialog is the model only; the toolsets are in the composer's + menu
          // (checked above), so the dialog must not list them any more.
          await check(`#615/#1006 the model popup lists no toolsets in ${locale} (${tag})`, async () => {
            const prefix = t('composer.chooseModel', { name: '@@' }).split('@@')[0];
            await page.locator(`button[aria-label^="${prefix}"]`).first().click();
            const dialog = page.locator('dialog.model-dialog-backdrop[open]');
            await dialog.waitFor({ timeout: 10000 });
            assert.equal(await dialog.locator('.mp-tool').count(), 0, 'no tool rows in the model dialog');
            if (shots) await page.screenshot({ path: `${shots}/model-popup-615-${short}.png`, fullPage: true });
            await page.keyboard.press('Escape');
          });
        }
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no sideways scroll at ' + tag);
        await ctx.close(); await env.stop(); env = null; await new Promise((r) => mcp.close(r)); mcp = null;
      }
    }
    assert.deepEqual(errors.filter((e) => !/ResizeObserver/.test(e)), [], 'page errors');
    if (failures.length) { console.log(`FAIL toolbox-inapp-615: ${failures.length} check(s) failed`); process.exitCode = 1; }
    else console.log('PASS #615 on the real toolbox endpoints, in German and French; 375/768/1440, light and dark.');
  } finally { await browser.close(); if (env) await env.stop(); if (mcp) mcp.close(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
