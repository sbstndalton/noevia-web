// #613 #614 #615 #616 #620 (live tester round 7) in the German and French UI. The language is set in
// page memory only (the preferences GET is answered with de-DE / fr-FR); the synthetic account is
// never changed and nothing touches Diary or real storage.
//   #613  Hardware: a stopped engine's "container is exited" note is translated; the Advanced group
//         counters use the locale's singular ("1 défini")
//   #614  Sources: the Instruction Skills block (empty state, status, actions, notes) is translated
//   #615  Chat: Edit / "Save & re-run" / Cancel, the offline banner, the "Using: / Skill:" line and the
//         composer tools menu (built-in toolset names and descriptions)
//   #616  Chat: Laya routing details list translated route descriptions and locale decimal scores
//   #620  a label cut for truncation keeps the space at the cut ("Compagnon de journal")
// Real application server with a synthetic upstream (qa/sources-panel-lib.cjs); the model manager
// APIs are synthetic routes. Fails on a build without the fixes and passes with them.
//
// Run: PLAYWRIGHT_MODULE=<playwright-core> [APP_DIR=<web dir of a built app>] [QA_SCREENSHOTS=<dir>] node qa/locale-613-616-620.cjs
const os = require('node:os');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || `${os.homedir()}/noevia-local-test/node_modules/playwright-core`);
const assert = require('node:assert/strict');
const { start, signedIn } = require('./sources-panel-lib.cjs');

// What each language should show, and the English that must not appear on its page.
const L = {
  'de-DE': {
    pillName: 'Tagebuch Begleiter', // the tail starts with a space
    hardware: 'Hardware', yours: 'Deine Modelle', tune: /tunen/i, advanced: 'Erweitert',
    exitedNote: /Messwerte nicht verfügbar: Container ist beendet/,
    counters: [/1 gesetzt/, /2 gesetzt/],
    skills: { heading: /Anweisungs-Skills \(0\)/, add: 'Anweisungs-Skill hinzufügen', headingOne: /Anweisungs-Skills \(1\)/, review: 'Prüfung erforderlich', enable: 'Diese Version aktivieren', enabled: 'Aktiviert', disable: 'Deaktivieren', version: /Version 1/ },
    edit: 'Bearbeiten', save: 'Speichern & neu ausführen', cancel: 'Abbrechen', editNote: 'Alles nach dieser Nachricht wird ersetzt.',
    offline: /Die Inferenz ist gerade nicht erreichbar/, using: 'Verwendet: core', skill: 'Skill: qa-skill',
    add: 'Dateien und Werkzeuge hinzufügen', core: 'Kern', coreDesc: /Serveruhr/,
    route: { fast: /Begrüßungen, Dank/, smart: /Erklären, Vergleichen/, code: /Programmcode/ }, scores: ['0,5894', '0,1361', '0,2745'],
  },
  'fr-FR': {
    pillName: 'Compagnon de journal', // the head ends with a space
    hardware: 'Matériel', yours: 'Vos modèles', tune: /régler/i, advanced: 'Avancé',
    exitedNote: /Relevés indisponibles : le conteneur est arrêté/,
    counters: [/1 défini(?!s)/, /2 définis/],
    skills: { heading: /Compétences d’instruction \(0\)/, add: 'Ajouter une compétence d’instruction', headingOne: /Compétences d’instruction \(1\)/, review: 'Vérification requise', enable: 'Activer cette version', enabled: 'Activée', disable: 'Désactiver', version: /Version 1/ },
    edit: 'Modifier', save: 'Enregistrer et relancer', cancel: 'Annuler', editNote: 'Tout ce qui suit ce message est remplacé.',
    offline: /L’inférence est injoignable/, using: 'Utilise : core', skill: 'Compétence : qa-skill',
    add: 'Ajouter des fichiers et des outils', core: 'Base', coreDesc: /horloge du serveur/,
    route: { fast: /Salutations, remerciements/, smart: /Expliquer, comparer/, code: /Tout ce qui touche au code/ }, scores: ['0,5894', '0,1361', '0,2745'],
  },
};
const ENGLISH = /Instruction skills|Review required|Add an instruction skill|Enable this version|Reviewed versions apply|Reusable Markdown|Save & re-run|Everything after this message|Inference is unreachable|Using: |Skill: |Always-safe built-ins|Read your diary|Greetings, thanks|Explaining, comparing|Anything involving programming/;
const SKILL_MD = '---\nname: qa-skill\ndescription: Synthetic skill for the locale check\nversion: 1\n---\nDo the synthetic thing.\n';

(async () => {
  let env;
  const browser = await chromium.launch({ headless: true, channel: process.env.QA_CHANNEL || 'chrome' });
  const errors = [], failures = [];
  const shots = process.env.QA_SCREENSHOTS;
  const check = async (name, fn) => {
    try { await fn(); console.log(`ok   ${name}`); } catch (e) { failures.push(name); console.log(`FAIL ${name}\n     ${String(e.message).split('\n').slice(0, 4).join('\n     ')}`); }
  };
  try {
    for (const locale of Object.keys(L)) {
      const l = L[locale];
      for (const [width, theme] of [[375, 'light'], [768, 'dark'], [1440, 'light'], [1440, 'dark']]) {
        if (process.env.QA_ONLY && !`${locale}:${width}:${theme}`.startsWith(process.env.QA_ONLY)) continue;
        const tag = `${locale} ${width} ${theme}`;
        const short = `${locale.slice(0, 2)}-${width}-${theme}`;
        env = await start({ port: 31613, name: 'locale613' });
        const { ctx, page, api } = await signedIn(browser, env, { width, theme, projectName: `Projet ${short}` });
        page.on('pageerror', e => { errors.push(`${tag}: ${e.message}`); if (process.env.QA_DEBUG) console.log(e.stack); });
        // The project whose model is a name with a space at the truncation cut, so the composer's model pill splits there.
        const project = JSON.parse((await api('/api/projects', { name: `Locale ${short}`, model: l.pillName, routing: 'manual', toolboxes: ['core'] })).text);

        await page.route('**/api/account/preferences', async route => {
          if (route.request().method() !== 'GET') return route.continue();
          const response = await route.fetch();
          return route.fulfill({ response, json: { ...(await response.json()), locale } });
        });
        await page.route('**/api/health', route => route.fulfill({ json: { inferenceUp: false, diaryUp: null } }));
        const installed = [{ name: l.pillName, labels: [], loaded: true, sizeGB: 3.3, maxContext: 131072, source: 'cache', canDelete: true, status: 'loaded' }];
        const now = Math.floor(Date.now() / 1000);
        const history = [0, 1, 2, 3].map(i => ({ ts: now - (3 - i) * 2, gpu_util: 40 + i, vram_used_gb: 4.5 + i * 0.1, cpu_pct: 10 + i, mem_used_gb: 8 + i, shared_used_gb: 0, temp_c: 50, power_w: 100 }));
        // One engine the service reports as exited, exactly as it words it today (hw.py: "container is exited").
        const stopped = { name: 'llama-vulkan-test', found: true, status: 'exited', image: 'synthetic-stopped', uptime: null, uptime_s: null, started_at: '', loaded_model: null, probe_error: null, last_restart_error: null,
          stats: { ok: false, error: 'container is exited', gpu: null, container: null }, history: [] };
        const schema = [
          { tier: 'Common', tierId: 'common', open: true, fields: [
            { id: 'ctx-size', key: 'ctx-size', label: 'Context size', kind: 'text', choices: [], placeholder: '', help: 'Prompt context length.' },
            { id: 'flash-attn', key: 'flash-attn', label: 'Flash attention', kind: 'text', choices: [], placeholder: '', help: 'Fused attention kernel.' } ] },
          { tier: 'Runtime', tierId: 'runtime', open: false, fields: [
            { id: 'threads', key: 'threads', label: 'Threads', kind: 'text', choices: [], placeholder: '', help: 'CPU threads.' },
            { id: 'batch-size', key: 'batch-size', label: 'Batch size', kind: 'text', choices: [], placeholder: '', help: 'Batch.' } ] },
        ];
        const values = { 'ctx-size': '4096', threads: '8', 'batch-size': '512' }; // Common: 1 set, Runtime: 2 set
        await page.route(/\/api\/(models|model-manager|auto-roles)\b/, (route) => {
          const p = new URL(route.request().url()).pathname, json = (b, status = 200) => route.fulfill({ status, json: b });
          if (p === '/api/models/capabilities') return json({ kind: 'llamacpp', admin: true, autotune: false, presets: true, download: true, runtimeOptions: false, modelManagement: true });
          if (p === '/api/models/installed') return json(installed);
          if (p === '/api/models/evidence') return json({ tracked: true, categories: [], external: { category: 'external_model_card', state: 'unavailable', value: null, at: null, suite: null, provenance: null, limitations: [] } });
          if (p === '/api/auto-roles') return json({ configured: true, roles: {}, missing: [] });
          if (p === '/api/models/estimate') return json({ error: 'No estimate for the synthetic model' }, 404);
          if (p.startsWith('/api/models/')) return json({ job: null, history: [] });
          const r = p.slice('/api/model-manager/'.length);
          const file = { key: `f/${l.pillName}.gguf`, name: `${l.pillName}.gguf`, subdir: 'f', bytes: 3.3e9, size: '3.1 GB', modified: '2026-09-25 14:30', mtime: now, sharded: false, parts: 1, projector: null, sections: [l.pillName], modelId: l.pillName, file: `f/${l.pillName}.gguf`, shape: null, loadedOn: [], fit: [], badges: [] };
          if (r === 'models') return json({ models: [file], unregistered: [], revision: 'r1' });
          if (r === 'overview') return json({ modelsDir: { path: '/models', hostPath: '/mnt/models', exists: true, disk: { total: 7.3e12, free: 5.3e12, usedPct: 27, totalH: '7.3 TB', freeH: '5.3 TB' } }, models: 1, sections: 1, backends: [], activeDownloads: 0, revision: 'r1' });
          if (r === 'settings') return json({ hasToken: false, tokenHint: '' });
          if (r === 'backends') return json({ backends: [stopped] });
          if (r === 'host') return json({ history: [] });
          if (r === 'models/updates') return json({ status: {} });
          if (r === 'sections') return json({ sections: [{ name: l.pillName, values, revision: 'r1' }], raw: '', schema, revision: 'r1' });
          if (/^sections\/[^/]+$/.test(r) && route.request().method() === 'GET') return json({ name: l.pillName, exists: true, values, extras: '', revision: 'r1', hints: [], schema, defaults: {}, backups: [] });
          return json({ targets: [], jobs: [], prompts: [], sections: [] });
        });

        // ---- Sources: Instruction Skills (#614) ----
        await page.goto(`${env.origin}/p/${project.id}/sources`);
        await page.locator('.project-sources').waitFor();
        const section = page.locator('.instruction-skills');
        await section.waitFor();
        await check(`#614 the empty Instruction Skills block is ${locale} (${tag})`, async () => {
          const summary = section.locator('details > summary').first();
          assert.equal((await summary.innerText()).trim(), l.skills.add);
          await summary.click();
          const text = (await section.textContent()).replace(/\s+/g, ' ');
          assert.match(text, l.skills.heading, text);
          assert.doesNotMatch(text, ENGLISH, text);
        });
        await page.locator('.project-sources input[type=file]').first().setInputFiles([{ name: 'qa-skill.md', mimeType: 'text/markdown', buffer: Buffer.from(SKILL_MD) }]);
        await page.locator('.instruction-skill').waitFor({ timeout: 20000 });
        await check(`#614 an uploaded skill, its status, notes and actions are ${locale} (${tag})`, async () => {
          const text0 = (await section.textContent()).replace(/\s+/g, ' ');
          assert.match(text0, l.skills.headingOne, text0);
          await page.locator('.instruction-skill > summary').click();
          const text = (await section.textContent()).replace(/\s+/g, ' ');
          assert.ok(text.includes(l.skills.review), `status "${l.skills.review}" in: ${text}`);
          assert.match(text, l.skills.version, text);
          assert.doesNotMatch(text, ENGLISH, text);
          await section.getByRole('button', { name: l.skills.enable, exact: true }).click();
          await page.waitForFunction(s => document.querySelector('.instruction-skill > summary')?.textContent.includes(s), l.skills.enabled, { timeout: 10000 });
          assert.equal(await section.getByRole('button', { name: l.skills.disable, exact: true }).count(), 1, 'the Disable action');
          const after = (await section.textContent()).replace(/\s+/g, ' ');
          assert.doesNotMatch(after, ENGLISH, after);
        });
        if (shots) await page.screenshot({ path: `${shots}/sources-${short}.png`, fullPage: true });

        // ---- Chat: edit, offline banner, scope line, routing, tools menu, pill (#615 #616 #620) ----
        const chatId = `l613-${short}`;
        assert.equal((await api(`/api/projects/${project.id}/chats`, { chats: [{ id: chatId, title: 'Plan' }] })).status, 200);
        const routingDecision = { offered: [{ id: 'fast', label: 'Greetings, thanks, or a one-line factual answer' }, { id: 'smart', label: 'Explaining, comparing, planning, reasoning or writing more than a sentence' }, { id: 'code', label: 'Anything involving programming code, regex, errors or software' }],
          scores: { fast: 0.5894, smart: 0.1361, code: 0.2745 }, selectedRole: 'fast', effectiveRole: 'fast', backend: 'decision-service', model: 'convaiinnovations/laya', calibrated: false, latencyMs: 685, status: 'accepted', fallbackReason: null };
        assert.equal((await api(`/api/chats/${chatId}/history`, { history: [
          { role: 'user', content: 'Wie lautet der Plan?' },
          { role: 'assistant', content: 'Synthetic answer.', model: 'Assistant · synthetic', routingDecision },
        ] })).status, 200);
        await page.goto(`${env.origin}/c/${chatId}`);
        await page.locator('.msg[data-role=assistant]').first().waitFor({ timeout: 15000 });

        await check(`#615 the offline banner is ${locale} (${tag})`, async () => {
          const banner = page.locator('.conn-banner');
          await banner.waitFor({ timeout: 10000 });
          const text = (await banner.innerText()).replace(/\s+/g, ' ');
          assert.match(text, l.offline, text);
          assert.doesNotMatch(text, /Inference is unreachable|Check the model backend/, text);
          assert.equal(await banner.locator('button.conn-banner-link').count(), 1, 'the Settings link is still there');
          assert.doesNotMatch(await banner.locator('button.conn-banner-link').innerText(), /^Settings$/);
        });
        // A live reply whose stream carries the scope events the server sends (chat.cjs: tools_scope, skills_scope).
        await page.route('**/api/chat', route => route.request().method() !== 'POST' ? route.continue() : route.fulfill({ status: 200, contentType: 'text/event-stream',
          body: [{ type: 'tools_scope', text: 'core' }, { type: 'skills_scope', text: 'qa-skill' }, { type: 'delta', text: 'Second synthetic answer.' }, { type: 'done' }].map(e => `data: ${JSON.stringify(e)}\n\n`).join('') }));
        await page.locator('textarea').first().fill('Und danach?');
        await page.keyboard.press('Enter');
        await page.locator('.tool-scope').first().waitFor({ timeout: 15000 });
        await check(`#615 the "Using: / Skill:" line is ${locale} (${tag})`, async () => {
          const line = page.locator('.tool-scope').first();
          const text = (await line.innerText()).replace(/\s+/g, ' ');
          assert.ok(text.includes(l.using) && text.includes(l.skill), text);
          assert.doesNotMatch(await line.getAttribute('title'), /What noevia gave/);
        });
        await check(`#616 routing details: route descriptions are ${locale} and scores use the locale decimal separator (${tag})`, async () => {
          await page.locator('.transcript .routing-details > summary').first().click();
          const rows = (await page.locator('.transcript .routing-details-body li').evaluateAll(els => els.map(e => e.textContent.replace(/\s+/g, ' ').trim())));
          assert.equal(rows.length, 3, JSON.stringify(rows));
          for (const [i, id] of ['fast', 'smart', 'code'].entries()) {
            assert.match(rows[i], l.route[id], rows[i]);
            assert.ok(rows[i].endsWith(l.scores[i]), `${rows[i]} should end with ${l.scores[i]}`);
          }
          assert.ok(!rows.some(r => /\d\.\d{4}/.test(r) || ENGLISH.test(r)), JSON.stringify(rows));
        });
        await check(`#615 the message Edit controls are ${locale} (${tag})`, async () => {
          const button = page.locator('.msg-edit-btn').first();
          const label = (await button.innerText()).trim();
          assert.equal(label, `✎ ${l.edit}`);
          assert.doesNotMatch(await button.getAttribute('title') + await button.getAttribute('aria-label'), /re-run/i);
          await button.click();
          const actions = page.locator('.msg-edit-actions');
          await actions.waitFor();
          const text = (await actions.innerText()).replace(/\s+/g, ' ');
          assert.ok(text.includes(l.save) && text.includes(l.cancel) && text.includes(l.editNote), text);
          assert.doesNotMatch(text, /Save & re-run|Cancel|Everything after/, text);
          assert.doesNotMatch(await page.locator('.msg-edit textarea, .msg textarea').first().getAttribute('aria-label'), /Edit your message/);
          if (shots) await page.screenshot({ path: `${shots}/chat-edit-${short}.png`, fullPage: true });
          await actions.getByRole('button', { name: l.cancel, exact: true }).click();
        });
        await check(`#620 the composer's model pill keeps the space at the cut (${tag})`, async () => {
          const gap = await page.evaluate(() => {
            const el = [...document.querySelectorAll('.composer-model .mid-trunc')].find(e => e.offsetParent !== null && e.querySelector('.mid-trunc-head'));
            if (!el) return { missing: true };
            const head = el.querySelector('.mid-trunc-head'), tail = el.querySelector('.mid-trunc-tail');
            const range = (node) => { const r = document.createRange(); r.selectNodeContents(node); const rects = [...r.getClientRects()]; return rects[rects.length - 1] && { left: rects[0].left, right: rects[rects.length - 1].right, width: rects.reduce((s, x) => s + x.width, 0) }; };
            const h = range(head), t = range(tail);
            // Head and tail are adjacent flex items; a real space adds its width to one of them.
            const label = el.getAttribute('aria-label'), joined = head.textContent + tail.textContent;
            const spaceAt = head.textContent.endsWith(' ') ? 'head' : tail.textContent.startsWith(' ') ? 'tail' : 'none';
            const box = spaceAt === 'head' ? head : tail;
            const truncated = head.scrollWidth > head.clientWidth + 1;
            // Width of the text inside the box that owns the space, with and without that space.
            const probe = document.createElement('span'); probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;font:' + getComputedStyle(box).font;
            probe.textContent = box.textContent; document.body.appendChild(probe); const withSpace = probe.getBoundingClientRect().width;
            probe.textContent = box.textContent.trim(); const without = probe.getBoundingClientRect().width; probe.remove();
            const rendered = box.getBoundingClientRect().width;
            return { label, joined, spaceAt, truncated, withSpace, without, rendered, h, t };
          });
          assert.ok(!gap.missing, 'a truncated model pill is on the page');
          assert.equal(gap.joined, gap.label);
          assert.notEqual(gap.spaceAt, 'none', `the cut falls on a space: ${gap.label}`);
          if (!gap.truncated) assert.ok(gap.rendered >= gap.withSpace - 0.5, `the space at the cut is collapsed: box ${gap.rendered}px, text with space ${gap.withSpace}px, without ${gap.without}px`);
        });
        await check(`#615 the composer tools menu names and describes the built-in toolsets in ${locale} (${tag})`, async () => {
          await page.getByRole('button', { name: new RegExp(`^${l.add}`) }).first().click();
          const panel = page.locator('.composer-actions-panel');
          await panel.waitFor();
          await panel.locator('.composer-tool-option').first().waitFor({ timeout: 10000 });
          const rows = await panel.locator('.composer-tool-option').evaluateAll(els => els.map(e => e.innerText.replace(/\s+/g, ' ').trim()));
          assert.ok(rows.length >= 1, 'toolset rows');
          const core = rows.find(r => r.startsWith(l.core));
          assert.ok(core, `the Core row reads ${l.core}: ${JSON.stringify(rows)}`);
          assert.match(core, l.coreDesc, core);
          for (const row of rows) assert.doesNotMatch(row, ENGLISH, row);
          if (shots) await page.screenshot({ path: `${shots}/tools-menu-${short}.png`, fullPage: true });
          await page.keyboard.press('Escape');
        });
        if (shots) { await page.locator('.routing-details').first().scrollIntoViewIfNeeded(); await page.screenshot({ path: `${shots}/chat-${short}.png`, fullPage: true }); }

        // ---- Model manager: Hardware and Advanced (#613) ----
        await page.goto(`${env.origin}/models`);
        const dialog = page.locator('.model-manager-page');
        await dialog.waitFor({ timeout: 20000 });
        await check(`#613 a stopped engine's readings note is ${locale} (${tag})`, async () => {
          await dialog.getByRole('tab', { name: l.hardware, exact: true }).click();
          const note = dialog.locator('.mm-panel', { hasText: 'llama-vulkan-test' }).locator('p.mm-note').filter({ hasText: /Messwerte|Relevés|Readings/ }).first();
          await note.waitFor({ timeout: 10000 });
          const text = (await note.innerText()).replace(/\s+/g, ' ');
          assert.match(text, l.exitedNote, text);
          assert.doesNotMatch(text, /container is exited/, text);
          if (shots) await page.screenshot({ path: `${shots}/hardware-${short}.png`, fullPage: true });
        });
        await check(`#613 the Advanced group counters use the ${locale} plural ("1" is singular) (${tag})`, async () => {
          await dialog.getByRole('tab', { name: l.yours, exact: true }).click();
          const card = dialog.getByRole('article', { name: l.pillName });
          await card.waitFor();
          await card.getByRole('button', { name: l.tune }).first().click();
          await dialog.getByRole('button', { name: l.advanced, exact: true }).click();
          const counts = (await dialog.locator('.mm-tier > summary > small').allInnerTexts()).map(s => s.replace(/\s+/g, ' ').trim());
          assert.equal(counts.length, 2, JSON.stringify(counts));
          assert.match(counts[0], l.counters[0], JSON.stringify(counts));
          assert.match(counts[1], l.counters[1], JSON.stringify(counts));
          if (shots) await page.screenshot({ path: `${shots}/advanced-${short}.png`, fullPage: true });
        });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no sideways scroll at ' + tag);
        await ctx.close(); await env.stop(); env = null;
      }
    }
    assert.deepEqual(errors, [], 'page errors');
    if (failures.length) { console.log(`FAIL locale-613-616-620: ${failures.length} check(s) failed`); process.exitCode = 1; }
    else console.log('PASS #613 #614 #615 #616 #620 in German and French; 375/768/1440, light and dark.');
  } finally { await browser.close(); if (env) await env.stop(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
