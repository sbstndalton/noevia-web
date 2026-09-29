// #636: French byte sizes. Every user-visible size goes through one locale-aware formatter, so French
// says o / ko / Mo / Go / To and the binary Kio / Mio / Gio (never GB, TB, GiB or KiB); German keeps
// GB / TB / GiB (its own convention), which the same run confirms.
//   1. Models -> Vos modeles: "Dossier des modeles : 5,3 To libres sur 7,3 To", the card's "3,3 Go entraine"
//   2. Models -> Regler (the Tune page pre-flight): "Environ 8,47 Gio sur 14 Gio", "Memoire disponible (Gio)",
//      "Modele 6,64 Gio . Cache KV 0,43 Gio", the file size in the time note
//   3. Projects -> Sources -> Ajouter une competence d'instruction: "Taille maximale du fichier : 32 Kio."
//   4. Models -> Discover's free space and the Hardware tab's memory, in the same units
//
// The real application server (real account, real projects). The model manager is a separate service that
// is not part of this repository, so its endpoints (and the model endpoints the Models page reads) are
// answered in the page with synthetic data; the language is set by answering the preferences GET.
//
// Run: [APP_DIR=<web dir of a built app>] [QA_SCREENSHOTS=<dir>] node qa/units-fr-636.cjs
const os = require('node:os'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || `${os.homedir()}/noevia-local-test/node_modules/playwright-core`);
const assert = require('node:assert/strict');
const ts = require('typescript');
const { start, signedIn } = require('./sources-panel-lib.cjs');

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
for (const seg of ['models', 'projects']) load(`i18n/${seg}/index`); // registers each segment's English part
for (const [locale, name] of [['fr-FR', 'FR_FR'], ['de-DE', 'DE_DE']]) {
  core.registerCatalogue(locale, load(`i18n/${locale}`)[name]);
  core.registerSegment('models', locale, load(`i18n/models/${locale}`)[`${name}_MODELS`]);
  core.registerSegment('projects', locale, load(`i18n/projects/${locale}`)[`${name}_PROJECTS`]);
}
const NB = '[\\u00a0\\u202f ]';
// A size in the page: the number, one (no-break) space, the unit.
const sz = (n, unit) => new RegExp(`${n}${NB}${unit}(?![A-Za-z])`);
const WRONG_FR = new RegExp(`\\d${NB}?(GB|TB|GiB|KiB|MiB)\\b`);

const LOCALES = {
  'fr-FR': { binary: 'Gio', decimal: 'Go', tera: 'To', kib: 'Kio' },
  'de-DE': { binary: 'GiB', decimal: 'GB', tera: 'TB', kib: 'KiB' },
};

(async () => {
  let env;
  const browser = await chromium.launch({ headless: true, channel: process.env.QA_CHANNEL || 'chrome' });
  const errors = [], failures = [];
  const shots = process.env.QA_SCREENSHOTS;
  const check = async (name, fn) => {
    try { await fn(); console.log(`ok   ${name}`); } catch (e) { failures.push(name); console.log(`FAIL ${name}\n     ${String(e.message).split('\n').slice(0, 6).join('\n     ')}`); }
  };
  const flat = (s) => s.replace(/\s+/g, ' ').trim();
  try {
    for (const locale of Object.keys(LOCALES)) {
      const l = LOCALES[locale], t = (key, params) => core.translate(locale, key, params);
      for (const [width, theme] of [[375, 'light'], [768, 'dark'], [1440, 'light'], [1440, 'dark']]) {
        if (process.env.QA_ONLY && !`${locale}:${width}:${theme}`.startsWith(process.env.QA_ONLY)) continue;
        const tag = `${locale} ${width} ${theme}`, short = `${locale.slice(0, 2)}-${width}-${theme}`;
        env = await start({ port: 31636, name: 'units636' });
        const { ctx, page, api } = await signedIn(browser, env, { width, theme, projectName: `Unites ${short}` });
        page.on('pageerror', (e) => errors.push(`${tag}: ${e.message}`));
        const project = JSON.parse((await api('/api/projects', { name: `Units ${short}`, model: 'synthetic', routing: 'manual', toolboxes: ['core'] })).text);
        const installed = [{ name: 'Synthetic-Chat', labels: [], loaded: true, sizeGB: 3.3, maxContext: 131072, source: 'cache', canDelete: true, status: 'loaded' }];
        const now = Math.floor(Date.now() / 1000);
        const history = [0, 1, 2, 3].map((i) => ({ ts: now - (3 - i) * 2, gpu_util: 40 + i, vram_used_gb: 4.5 + i * 0.1, cpu_pct: 10 + i, mem_used_gb: 8 + i, shared_used_gb: 0, temp_c: 50, power_w: 100 }));
        const rows = [8192, 16384, 32768, 65536].map((c) => ({ ctx: c, kvQ8Gib: c / 65536 * 0.43 * 4 }));
        const schema = ['Common', 'Speculative decoding'].map((tier, i) => ({ tier, tierId: ['common', 'speculative'][i], open: i === 0, fields: [{ key: i ? 'spec-type' : 'ctx-size', label: 'Field', kind: 'text', choices: [], placeholder: '', help: '' }] }));
        await page.route('**/api/account/preferences', async (route) => {
          if (route.request().method() !== 'GET') return route.continue();
          const response = await route.fetch();
          return route.fulfill({ response, json: { ...(await response.json()), locale } });
        });
        await page.route('**/api/**', (route) => {
          const req = route.request(), url = new URL(req.url()), p = url.pathname, m = req.method();
          const json = (b, status = 200) => route.fulfill({ status, json: b });
          if (p === '/api/models/capabilities') return json({ kind: 'llamacpp', admin: true, autotune: true, presets: true, download: true, runtimeOptions: false, modelManagement: true });
          if (p === '/api/models/installed') return json(installed);
          if (p === '/api/models/evidence') return json({ tracked: true, categories: [], external: { category: 'external_model_card', state: 'unavailable', value: null, at: null, suite: null, provenance: null, limitations: [] } });
          if (p === '/api/models/autotune') return json({ job: null, history: [] });
          if (p === '/api/models/calibration') return json({ job: null, history: [] });
          if (p === '/api/models/autotune/untuned') return json({ models: [], skipped: [] });
          if (p === '/api/models/estimate') return json({ model: 'Synthetic-Chat', budgetGib: 14, chat: true, sizeable: true, arch: 'qwen35', nativeCtx: 65536, modelGib: 6.64, pinnedGib: 0, reserveGib: 0.5, safety: 1.05, moe: false, rows, current: { ctx: 16384, kv: 'q8_0' } });
          if (p === '/api/models/hardware') return json({ source: 'model-manager', cpu: 'Synthetic CPU', systemGB: 64, gpus: [{ id: 'g0', name: 'Synthetic GPU', capacityGB: 16, sharedGB: 0 }] });
          if (p.startsWith('/api/models/')) return json({});
          if (p === '/api/auto-roles' && m === 'GET') return json({ configured: true, roles: {}, missing: [] });
          if (!p.startsWith('/api/model-manager/')) return route.fallback();
          const r = p.slice('/api/model-manager/'.length);
          if (r === 'models') return json({ models: installed.map((mo) => ({ key: `f/${mo.name}.gguf`, name: `${mo.name}.gguf`, subdir: 'f', bytes: mo.sizeGB * 1e9, size: `${(mo.sizeGB * 0.93).toFixed(1)} GB`, modified: '2026-09-01', sharded: false, parts: 1, projector: null, sections: [mo.name] })), unregistered: [] });
          // The service's own text says GB / TB; the raw byte counts are what the client should format.
          if (r === 'overview') return json({ modelsDir: { path: '/models', hostPath: '/mnt/models', exists: true, disk: { total: 7.3 * 1024 ** 4, free: 5.3 * 1024 ** 4, usedPct: 27, totalH: '7.3 TB', freeH: '5.3 TB' } }, models: 1, sections: 1, backends: [], activeDownloads: 0, recentDownloads: [], restarts: [] });
          if (r === 'models/updates') return json({ status: {} });
          if (r === 'download-targets') return json({ targets: [] });
          if (r === 'downloads') return json({ jobs: [] });
          if (r === 'settings') return json({ hasToken: false, tokenHint: '' });
          if (r === 'backends') return json({ backends: [{ name: 'llamacpp', found: true, status: 'running', image: 'synthetic', uptime: '1h 14m', uptime_s: 4440, started_at: '', loaded_model: 'Synthetic-Chat', probe_error: null, last_restart_error: null,
            stats: { ok: true, error: null, gpu: { vendor: 'x', name: 'Synthetic GPU', util_pct: 27, vram_used_gb: 4.9, vram_total_gb: 16.5, temp_c: 50, power_w: 100, gpu_count: 1, cards: [], memory_kind: 'dedicated', shared_used_gb: 0, shared_total_gb: 0, clock_mhz: 1800 }, container: { cpu_pct: 3, mem_used_gb: 6, mem_limit_gb: 32 } }, history }] });
          if (r === 'host') return json({ history: history.map((h) => ({ ts: h.ts, cpu_pct: h.cpu_pct, mem_used_gb: h.mem_used_gb, mem_total_gb: 32, mem_available_gb: 20 })) });
          if (r === 'prompts') return json({ prompts: [] });
          if (r === 'sections') return json({ sections: [{ name: 'Synthetic-Chat', values: {}, revision: 'r1' }], raw: '', schema, revision: 'r1' });
          if (/^sections\/[^/]+$/.test(r) && m === 'GET') return json({ name: 'Synthetic-Chat', exists: true, values: {}, extras: '', revision: 'r1', hints: [], schema, defaults: {}, backups: [] });
          return json({});
        });

        // ---- the Skill upload hint ----
        await page.goto(`${env.origin}/p/${project.id}`);
        await check(`#636 the skill upload hint says ${l.kib} (${tag})`, async () => {
          const summary = page.getByText(t('projects.skills.addSummary'), { exact: true }).first();
          await page.getByRole('tab', { name: new RegExp(t('projects.view.tabSources')) }).first().click().catch(() => undefined);
          await summary.waitFor({ timeout: 20000 });
          await summary.click();
          const hint = flat(await page.locator('details', { has: summary }).first().innerText());
          assert.match(hint, sz('32', l.kib), hint);
          if (locale === 'fr-FR') assert.doesNotMatch(hint, /KiB/, hint);
          if (shots) await page.screenshot({ path: `${shots}/skill-hint-${short}.png`, fullPage: true });
        });

        // ---- the Models page ----
        await page.goto(`${env.origin}/models`);
        const manager = page.locator('.model-manager-page');
        await manager.waitFor({ timeout: 30000 });
        await manager.getByRole('tab', { name: t('mm.tab.yours'), exact: true }).click();
        const card = manager.getByRole('article', { name: 'Synthetic-Chat' });
        await card.waitFor({ timeout: 20000 });
        await check(`#636 Your models: the folder line and the card size are ${locale} (${tag})`, async () => {
          const disk = flat(await manager.getByTestId('models-disk').innerText());
          assert.match(disk, sz('5,3', l.tera), disk);
          assert.match(disk, sz('7,3', l.tera), disk);
          const meta = flat(await card.locator('.model-card-meta').first().innerText());
          assert.match(meta, sz('3,3', l.decimal), meta);
          if (locale === 'fr-FR') { assert.doesNotMatch(disk, WRONG_FR, disk); assert.doesNotMatch(meta, WRONG_FR, meta); }
          if (shots) await page.screenshot({ path: `${shots}/models-${short}.png`, fullPage: true });
        });

        await card.getByRole('button', { name: t('mm.card.tuneNamed', { model: 'Synthetic-Chat' }), exact: true }).click();
        await check(`#636 the Tune page pre-flight is ${locale} (${tag})`, async () => {
          const fit = manager.locator('.mm-fit');
          await fit.waitFor({ timeout: 20000 });
          const text = flat(await manager.locator('.mm-guided').first().innerText());
          assert.match(text, sz('14', l.binary), `budget in ${l.binary}: ${text.slice(0, 500)}`);
          assert.match(text, new RegExp(`${t('mm.fit.memory').replace(/[()]/g, '\\$&')}`), 'the memory field label');
          assert.match(text, sz('6,64', l.binary), `the model size in ${l.binary}`);
          assert.match(text, sz('3,3', l.decimal), `the file size in the time note: ${text.slice(-300)}`);
          if (locale === 'fr-FR') assert.doesNotMatch(text, WRONG_FR, text);
          if (shots) await page.screenshot({ path: `${shots}/tune-${short}.png`, fullPage: true });
        });

        await check(`#636 Discover free space and Hardware use ${locale} units (${tag})`, async () => {
          await page.goto(`${env.origin}/models`);
          await manager.waitFor({ timeout: 30000 });
          await manager.getByRole('tab', { name: t('mm.tab.discover'), exact: true }).click();
          const note = manager.getByTestId('download-target');
          await note.waitFor({ timeout: 10000 });
          assert.match(flat(await note.innerText()), sz('5,3', l.tera));
          await manager.getByRole('tab', { name: t('mm.tab.hardware'), exact: true }).click();
          await manager.locator('svg text.viz-axis').first().waitFor({ timeout: 10000 });
          const body = flat(await manager.innerText());
          if (locale === 'fr-FR') assert.doesNotMatch(body, WRONG_FR, body.slice(0, 400));
          assert.match(body, sz('32', l.binary), `the memory limit in ${l.binary}`);
        });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no sideways scroll at ' + tag);
        await ctx.close(); await env.stop(); env = null;
      }
    }
    assert.deepEqual(errors.filter((e) => !/ResizeObserver/.test(e)), [], 'page errors');
    if (failures.length) { console.log(`FAIL units-fr-636: ${failures.length} check(s) failed`); process.exitCode = 1; }
    else console.log('PASS #636 sizes use the locale units (Go/To/Gio/Kio in French); 375/768/1440, light and dark.');
  } finally { await browser.close(); if (env) await env.stop(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
