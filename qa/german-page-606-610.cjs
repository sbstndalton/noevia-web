// #606 / #607 / #608 / #609 / #610 in the German UI (set in page memory only: the account
// preferences GET is answered with de-DE; the synthetic account is never changed):
//   #606  the rows inside Sources > "Upload results" are 12px (--text-caption), not 16px bold
//   #607  the "Not readable" reason (section and upload row) is German, from the server's reason id
//   #608  chat: context-meter breakdown, "Thought for", "Laya routing", Skill "Automatic" and the
//         screen-reader labels come from the catalogue
//   #609  model Details: chat-template capabilities are German and "Modified" is a locale date
//   #610  small files show B/kB, not "0,00 MB"
// Real application server with a synthetic upstream; the model manager APIs are synthetic routes.
// Fails on a build without the fixes and passes with them.
//
// Run: PLAYWRIGHT_MODULE=<playwright-core> [APP_DIR=<web dir of a built app>] [QA_SCREENSHOTS=<dir>] node qa/german-page-606-610.cjs
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const { start, signedIn } = require('./sources-panel-lib.cjs');

const ENGLISH_LEFTOVERS = /Context window|Messages & summary|Instructions, memory|Thinking & answer reserve|Estimation safety buffer|Free space|Compact chat|Estimates of the prepared request|Automatic compaction/;

(async () => {
  let env;
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const errors = [];
  const failures = [];
  const check = async (name, fn) => {
    try { await fn(); console.log(`ok   ${name}`); } catch (e) { failures.push(name); console.log(`FAIL ${name}\n     ${String(e.message).split('\n').slice(0, 4).join('\n     ')}`); }
  };
  try {
    for (const [width, theme] of [[375, 'light'], [768, 'dark'], [1440, 'light'], [1440, 'dark']]) {
      const tag = `${width} ${theme}`;
      env = await start({ port: 31606, name: 'german606' });
      const { ctx, page, api, project } = await signedIn(browser, env, { width, theme, projectName: `Deutsch ${width} ${theme}` });
      page.on('pageerror', e => errors.push(e.message));

      // The chat: one real reply (which records the context meter) kept as a transcript with the
      // fields the reply header reads.
      const chatId = 'de606-' + width + theme;
      const reply = await api('/api/chat', { spaceId: project.id, projectId: project.id, chatId, message: 'Wie lautet der Plan?', history: [] });
      assert.equal(reply.status, 200, reply.text);
      assert.equal((await api(`/api/projects/${project.id}/chats`, { chats: [{ id: chatId, title: 'Plan' }] })).status, 200);
      const routingDecision = { offered: [{ id: 'fast', label: 'Fast' }, { id: 'smart', label: 'Smart' }], scores: { fast: 0.7, smart: 0.3 }, selectedRole: 'fast', effectiveRole: 'fast', backend: 'decision-service', model: 'convaiinnovations/laya', calibrated: false, latencyMs: 12, status: 'accepted', fallbackReason: null };
      assert.equal((await api(`/api/chats/${chatId}/history`, { history: [
        { role: 'user', content: 'Wie lautet der Plan?' },
        { role: 'assistant', content: 'Synthetic answer.', model: 'Assistant · Auto (fast)', reasoning: 'Synthetic reasoning.', reasoningMs: 3000, routingDecision },
      ] })).status, 200);

      // German, in page memory only; a synthetic pinnable skill so the composer shows its picker.
      await page.route('**/api/account/preferences', async route => {
        if (route.request().method() !== 'GET') return route.continue();
        const response = await route.fetch();
        return route.fulfill({ response, json: { ...(await response.json()), locale: 'de-DE' } });
      });
      await page.route('**/instruction-skills/manifests', route => route.fulfill({ json: { schemaVersion: 1, skills: [
        { schemaVersion: 1, id: 'skill_' + 'a'.repeat(32), version: 'b'.repeat(64), versionLabel: '1.0.0', name: 'Synthetic helper', file: 'SKILL.md', status: 'enabled', resolvable: true } ] } }));

      // ---- Sources: upload in German ----
      await page.goto(`${env.origin}/p/${project.id}/sources`);
      await page.locator('.project-sources').waitFor();
      await page.locator('.project-sources input[type=file]').first().setInputFiles([
        { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('Synthetic quarterly plan. '.repeat(80)) },
        { name: 'tiny.md', mimeType: 'text/markdown', buffer: Buffer.from('# Tiny\nSynthetic 110 byte note.\n') },
        { name: 'broken.txt', mimeType: 'text/plain', buffer: Buffer.concat([Buffer.from([0, 1, 2, 0, 255, 254, 0]), Buffer.from('binary junk')]) },
      ]);
      await page.waitForFunction(() => { const rows = [...document.querySelectorAll('.upload-progress li')]; return rows.length >= 3 && rows.every(r => /Gespeichert|Nicht lesbar|Saved|Not readable/.test(r.textContent)); }, null, { timeout: 20000 });

      await check(`#606 upload result rows are 12px like the panel copy (${tag})`, async () => {
        const size = (sel) => page.locator(sel).first().evaluate(el => getComputedStyle(el).fontSize);
        const reference = await size('.project-sources > p.rail-empty');
        assert.equal(reference, '12px');
        for (const sel of ['.upload-progress strong', '.upload-progress li', '.upload-progress small']) assert.equal(await size(sel), '12px', `${sel} font-size`);
      });
      await check(`#607 the upload row's not-readable reason is German (${tag})`, async () => {
        const row = (await page.locator('.upload-progress li', { hasText: 'broken.txt' }).evaluate(e => e.textContent)).replace(/\s+/g, ' ');
        assert.match(row, /Nicht lesbar · .*Binärdaten/, row);
        assert.doesNotMatch(row, /not readable as text|Not readable/i);
      });
      await check(`#607 the Not readable section's reason is German (${tag})`, async () => {
        const section = page.locator('.source-not-readable');
        await section.waitFor();
        const text = (await section.innerText()).replace(/\s+/g, ' ');
        assert.match(text, /Binärdaten/, text);
        assert.doesNotMatch(text, /not readable as text|binary data despite/i);
      });
      await check(`#610 small files show B/kB in German, never 0,00 MB (${tag})`, async () => {
        const text = (await page.locator('.project-sources').innerText()).replace(/[  ]/g, ' ');
        assert.doesNotMatch(text, /0,00 MB/, 'a zero-MB size is shown');
        assert.match(text, /\b\d+,\d kB\b|\b\d+ kB\b/, 'a size in kB is shown: ' + text.slice(0, 400));
        assert.match(text, /\b\d+ (B|Byte)\b/, 'a size in bytes is shown');
      });
      await page.locator('.project-sources details > summary').first().click(); // show the rows for the picture
      if (process.env.QA_SCREENSHOTS) await page.screenshot({ path: `${process.env.QA_SCREENSHOTS}/german-sources-${width}-${theme}.png`, fullPage: true });

      // ---- Chat ----
      await page.goto(`${env.origin}/c/${chatId}`);
      await page.locator('.msg').first().waitFor({ timeout: 15000 });
      // On a phone the meter, routing and status live in the model sheet (#527), one tap away.
      const inline = await page.locator('.chat-context-meter').first().waitFor({ state: 'visible', timeout: 4000 }).then(() => true, () => false);
      if (!inline) await page.getByRole('button', { name: /^Modell wählen: / }).first().click();
      const scope = inline ? page : page.locator('.mp-status');
      const meterLine = scope.locator('.chat-context-meter summary');
      await meterLine.first().waitFor({ timeout: 15000 });
      await page.locator('.thinking-block summary').first().waitFor({ state: 'attached' });

      await check(`#608 context-meter breakdown is German (${tag})`, async () => {
        const meter = scope.locator('.chat-context-meter').first();
        await meterLine.first().click();
        await meter.getByRole('button').first().waitFor();
        const text = (await meter.innerText()).replace(/\s+/g, ' ');
        assert.match(text, /Kontextfenster/, text);
        for (const german of ['Nachrichten & Zusammenfassung', 'Anweisungen, Gedächtnis & Quellen', 'Werkzeuge', 'Reserve für Denken & Antwort', 'Sicherheitspuffer für die Schätzung', 'Freier Platz', 'Chat verdichten']) assert.ok(text.includes(german), `${german} in: ${text}`);
        assert.doesNotMatch(text, ENGLISH_LEFTOVERS, text);
        assert.equal(await meter.locator('[role=meter]').getAttribute('aria-label'), 'Geschätzte Kontextnutzung des Chats');
      });
      await check(`#608 "Thought for" and "Laya routing" are German (${tag})`, async () => {
        const summaries = (await page.locator('.thinking-block summary').evaluateAll(els => els.map(e => e.textContent))).map(s => s.replace(/\s+/g, ' ').trim());
        assert.ok(summaries.some(s => /^Nachgedacht: /.test(s)), JSON.stringify(summaries));
        assert.ok(summaries.some(s => /^Laya-Routing · fast$/.test(s)), JSON.stringify(summaries));
        assert.ok(!summaries.some(s => /Thought for|Laya routing/.test(s)), JSON.stringify(summaries));
        const body = (await page.locator('.routing-details-body').first().evaluate(e => e.textContent)).replace(/\s+/g, ' ');
        assert.match(body, /Entscheidung akzeptiert/, body);
        assert.doesNotMatch(body, /Decision accepted|Scores are uncalibrated/);
      });
      await check(`#608 the Skill picker says Automatisch (${tag})`, async () => {
        const select = page.locator('select.skill-pin-select').first();
        await select.waitFor({ state: 'attached', timeout: 10000 });
        assert.equal(await select.locator('option').first().textContent(), 'Automatisch');
        assert.equal(await select.getAttribute('aria-label'), 'Skill für die nächste Nachricht');
      });
      await check(`#608 screen-reader labels are German (${tag})`, async () => {
        assert.equal((await page.locator('.msg[data-role=user] .msg-sender').first().textContent()).trim(), 'Du');
        assert.match(await page.locator('.msg[data-role=assistant] .msg-sender .sr-only').first().textContent(), /^Assistent · /);
      });
      if (process.env.QA_SCREENSHOTS) await page.screenshot({ path: `${process.env.QA_SCREENSHOTS}/german-chat-${width}-${theme}.png`, fullPage: true });

      // ---- Model Details ----
      const now = Math.floor(Date.now() / 1000);
      const mtime = Date.UTC(2026, 8, 25, 14, 30) / 1000;
      const installed = [{ name: 'Synthetic-Chat', labels: [], loaded: true, sizeGB: 3.3, maxContext: 131072, source: 'cache', canDelete: true, status: 'loaded' }];
      const file = { key: 'f/Synthetic-Chat.gguf', name: 'Synthetic-Chat.gguf', subdir: 'f', bytes: 3.3e9, size: '3.1 GB', modified: '2026-09-25 14:30', mtime, sharded: false, parts: 1, projector: null, sections: ['Synthetic-Chat'], modelId: 'Synthetic-Chat', file: 'f/Synthetic-Chat.gguf', shape: null, loadedOn: [], fit: [], badges: [] };
      await page.route(/\/api\/(models|model-manager|auto-roles)\b/, (route) => {
        const p = new URL(route.request().url()).pathname, json = (b, status = 200) => route.fulfill({ status, json: b });
        if (p === '/api/models/capabilities') return json({ kind: 'llamacpp', admin: true, autotune: false, presets: true, download: true, runtimeOptions: false, modelManagement: true });
        if (p === '/api/models/installed') return json(installed);
        if (p === '/api/models/evidence') return json({ tracked: true, categories: [], external: { category: 'external_model_card', state: 'unavailable', value: null, at: null, suite: null, provenance: null, limitations: [] } });
        if (p === '/api/auto-roles') return json({ configured: true, roles: {}, missing: [] });
        if (p.startsWith('/api/models/')) return json({ job: null, history: [] });
        const r = p.slice('/api/model-manager/'.length);
        if (r === 'models') return json({ models: [file], unregistered: [], revision: 'r1' });
        if (r === 'models/detail') return json({ ...file, path: '/models/f/Synthetic-Chat.gguf', summary: { arch: 'gemma4', general: { params: '2.0 B', quant: 'Q4_0' }, model: { context_length: 131072, block_count: 30, attention_head_count: 8, attention_head_count_kv: 2 },
          chat_template_features: { accepts_enable_thinking: true, accepts_reasoning_effort: false, accepts_preserve_thinking: true, uses_think_tags: false, uses_channel_thought: true } } });
        if (r === 'overview') return json({ modelsDir: { path: '/models', hostPath: '/mnt/models', exists: true, disk: { total: 7.3e12, free: 5.3e12, usedPct: 27, totalH: '7.3 TB', freeH: '5.3 TB' } }, models: 1, sections: 1, backends: [], activeDownloads: 0, revision: 'r1' });
        if (r === 'settings') return json({ hasToken: false, tokenHint: '' });
        if (r === 'backends') return json({ backends: [] });
        if (r === 'host') return json({ history: [] });
        if (r === 'models/updates') return json({ status: {} });
        if (r === 'sections') return json({ sections: [{ name: 'Synthetic-Chat', values: {}, revision: 'r1' }], raw: '', schema: [], revision: 'r1' });
        if (/^sections\//.test(r)) return json({ name: 'Synthetic-Chat', exists: true, values: {}, extras: '', revision: 'r1', hints: [], schema: [], defaults: {}, backups: [] });
        return json({ targets: [], jobs: [], prompts: [], sections: [] });
      });
      await page.goto(`${env.origin}/models`);
      await check(`#609 model Details: capabilities and Modified are localised (${tag})`, async () => {
        const card = page.getByRole('article', { name: 'Synthetic-Chat' }).first();
        await card.waitFor({ timeout: 20000 });
        await card.getByRole('button', { name: /^Details/ }).first().click();
        const facts = page.locator('.mm-facts').first();
        await facts.waitFor();
        const rows = Object.fromEntries((await facts.locator('> div').evaluateAll(els => els.map(e => [e.querySelector('dt').textContent.trim(), e.querySelector('dd').textContent.trim()]))));
        const template = rows['Chat-Vorlage'];
        assert.ok(template, 'Chat-Vorlage row: ' + JSON.stringify(rows));
        assert.doesNotMatch(template, /accepts|uses channel|enable thinking/i, template);
        assert.match(template, /Denkmodus/, template);
        const modified = rows['Geändert'];
        assert.ok(modified, 'Geändert row: ' + JSON.stringify(rows));
        assert.doesNotMatch(modified, /^\d{4}-\d{2}-\d{2}/, 'ISO date shown: ' + modified);
        const expected = await page.evaluate((ms) => new Intl.DateTimeFormat('de-DE', { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(ms)), mtime * 1000);
        assert.equal(modified, expected);
        assert.match(modified, /^\d{1,2}\.\d{1,2}\.\d{4}, \d{1,2}:\d{2}$/, modified);
        if (process.env.QA_SCREENSHOTS) await page.screenshot({ path: `${process.env.QA_SCREENSHOTS}/german-model-details-${width}-${theme}.png`, fullPage: true });
      });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no sideways scroll at ' + width);
      await ctx.close(); await env.stop(); env = null;
    }
    assert.deepEqual(errors, [], 'page errors');
    if (failures.length) { console.log(`FAIL german-page-606-610: ${failures.length} check(s) failed`); process.exitCode = 1; }
    else console.log('PASS #606-#610 in German: upload rows 12px, reasons, kB sizes, chat context/thinking/routing/skill/sr labels, model Details; 375/768/1440, light and dark.');
  } finally { await browser.close(); if (env) await env.stop(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
