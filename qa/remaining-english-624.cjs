// #624 (the rest): English left in the German and French UI. The language is set in page memory only
// (the preferences GET is answered with de-DE / fr-FR); the synthetic account is never changed and
// nothing touches Diary or real storage.
//   - Code task card: plan, assistant output, result counts, network note, Planner review (verdict,
//     findings, outcome, the accept/decline card) and the "not reported by this harness" line
//   - Code sidebar note "Task status unavailable" and the header widget's task lines
//   - the "Harness" label in French
//   - the tool approval card (title, question, three buttons)
//   - chat status lines the server sends by id ("Loading the selected model…", "Generating response…")
//   - the "Effort: …" line and the route names ("Laya routing · Schnell", "Selected: … · Used: …")
//   - the German project delete dialog says "deinem", not "Ihrem"
// The real application server with a synthetic upstream (qa/sources-panel-lib.cjs); the chat stream,
// the Code tasks and the active-task list are synthetic in the page. Fails on a build without the
// fixes and passes with them.
//
// Run: [PLAYWRIGHT_MODULE=<playwright-core>] [APP_DIR=<web dir of a built app>] [QA_SCREENSHOTS=<dir>] node qa/remaining-english-624.cjs
const os = require('node:os'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || `${os.homedir()}/noevia-local-test/node_modules/playwright-core`);
const assert = require('node:assert/strict');
const ts = require('typescript');
const { start, signedIn } = require('./sources-panel-lib.cjs');

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
load('i18n/settings/index');
for (const [locale, name] of [['de-DE', 'DE_DE'], ['fr-FR', 'FR_FR']]) {
  core.registerCatalogue(locale, load(`i18n/${locale}`)[name]);
  core.registerSegment('settings', locale, load(`i18n/settings/${locale}`)[`${name}_SETTINGS`]);
}

// Words the fixed English used to show: none of them may appear in the checked regions.
const ENGLISH_CODE = /Reported plan|Last reported plan|Reported as|Some plan text|No entries were reported|Assistant output|Showing the first 32|tool calls? ·|allowed ·|declined ·|refused by noevia|Network: nothing|Reached |Refused |Not reported by this harness|Not reviewed by the Planner|The Planner suggests|The Planner requests|Review findings|Accept change|You accepted|Nobody answered|not accepted|Its branch stays|Planner review|The Planner’s verdict|Blocker|Major\b/;
const ENGLISH_CHAT = /Effort:|provider parameter|best-effort hint|Generating response|Loading the selected model|Preparing response|Allow once|Allow for this chat|Approval required|This changes data in your account|routing · (fast|smart|code)|\bfast\b|\bsmart\b/;

const flat = (s) => s.replace(/[\s  ]+/g, ' ').trim();

const routingDecision = { offered: [{ id: 'fast', label: 'Short answer' }, { id: 'smart', label: 'Reasoning' }], scores: { fast: 0.7, smart: 0.3 },
  selectedRole: 'smart', effectiveRole: 'fast', backend: 'decision-service', model: 'convaiinnovations/laya', calibrated: false, latencyMs: 12, status: 'accepted', fallbackReason: null };

// The Code state: a finished task with everything reported, a running one with cut-off output, and
// one waiting on the review card (the Planner could not review).
const codeState = () => ({
  repositories: [{ id: 'noevia' }], capabilities: ['read_repository', 'edit_file', 'execute_command'], defaultCapabilities: ['read_repository'],
  harnesses: [{ id: 'opencode', label: 'OpenCode', version: '1.18.31' }],
  promptPreparation: [{ id: 'direct', label: 'Direct', available: true, reason: 'Your request goes to the model as you wrote it.' }], sandboxed: true, network: false,
  tasks: [
    { id: 'code-done', status: 'completed', stage: null, error: null, createdAt: 1, updatedAt: 2, task: 'Synthetic finished task', branch: 'noevia/task-done', identityHash: null,
      capabilities: ['read_repository', 'edit_file'], steps: [], approval: null,
      plan: { status: 'edited', subQuestions: ['Check the synthetic case'], truncated: true },
      assistantOutput: { text: 'Synthetic assistant words.', truncated: true },
      result: { branch: 'noevia/task-done', tools: 4, approvals: 2, allowed: 2, refused: 1, denied: 1,
        network: { allowed: 3, refused: 2, hosts: [{ host: 'github.com', allowed: 0, refused: 2, reason: null }, { host: 'pypi.org', allowed: 3, refused: 0, reason: null }] },
        review: { reviewed: true, verdict: 'request_changes', accepted: false, decision: 'timeout', headSha: null } },
      review: { status: 'completed', reviewer: 'planner', baseSha: null, headSha: null, verdict: 'request_changes', summary: 'Synthetic summary',
        findings: [{ severity: 'major', file: 'a.js', message: 'Synthetic finding' }, { severity: 'note', message: 'Synthetic note' }] },
      meta: { harness: 'opencode', harnessVersion: '1.18.31', protocolVersion: 1, usage: null, context: null, commands: 0, failedCommands: 0, messageChunks: 1, limitations: ['Synthetic limitation.'] } },
    { id: 'code-run', status: 'running', stage: 'Reading', error: null, createdAt: 3, updatedAt: 4, task: 'Synthetic running task', branch: 'noevia/task-run', identityHash: null,
      capabilities: ['read_repository'], steps: [], approval: null, plan: { status: 'proposed', subQuestions: [], truncated: false },
      assistantOutput: { text: 'Cut off synthetic words.', truncated: true }, result: null, meta: null },
    { id: 'code-wait', status: 'waiting_approval', stage: null, error: null, createdAt: 5, updatedAt: 6, task: 'Synthetic review task', branch: 'noevia/task-wait', identityHash: null,
      capabilities: ['read_repository', 'edit_file'], steps: [], plan: null, assistantOutput: null, result: null, meta: null,
      approval: { id: 'rv1', action: 'review_change', title: 'Accept the change', kind: 'review', command: '', paths: [], reason: '', arguments: { branch: 'noevia/task-wait' }, diff: null,
        review: { status: 'failed', reviewer: 'planner', baseSha: null, headSha: null, reason: 'Synthetic reviewer offline' } } },
  ],
});

// The synthetic chat stream, installed in the page: a message opens a stream that stays open until the
// test pushes more events into it.
function installChat() {
  window.__qaPush = () => {};
  const realFetch = window.fetch.bind(window);
  const enc = new TextEncoder();
  const sse = (events) => events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');
  window.fetch = (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.origin);
    if (url.pathname !== '/api/chat' || (init.method || 'GET') !== 'POST') return realFetch(input, init);
    const stream = new ReadableStream({
      start(controller) {
        window.__qaPush = (events) => controller.enqueue(enc.encode(sse(events)));
        init.signal?.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')));
      },
    });
    return Promise.resolve(new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }));
  };
}

(async () => {
  let env;
  const browser = await chromium.launch({ headless: true, channel: process.env.QA_CHANNEL || 'chrome' });
  const errors = [], failures = [];
  const shots = process.env.QA_SCREENSHOTS;
  const check = async (name, fn) => {
    try { await fn(); console.log(`ok   ${name}`); } catch (e) { failures.push(name); console.log(`FAIL ${name}\n     ${String(e.message).split('\n').slice(0, 6).join('\n     ')}`); }
  };
  try {
    for (const locale of ['de-DE', 'fr-FR']) {
      const t = (key, params) => core.translate(locale, key, params);
      const tp = (key, count, params) => core.translatePlural(locale, key, count, params);
      for (const [width, theme] of [[1440, 'light'], [375, 'dark']]) {
        if (process.env.QA_ONLY && !`${locale}:${width}:${theme}`.startsWith(process.env.QA_ONLY)) continue;
        const tag = `${locale} ${width} ${theme}`, short = `${locale.slice(0, 2)}-${width}-${theme}`;
        env = await start({ port: 31624, name: 'remaining624' });
        const { ctx, page, api, project } = await signedIn(browser, env, { width, theme, projectName: `Projekt ${short}` });
        page.on('pageerror', (e) => errors.push(`${tag}: ${e.message}`));
        await page.route('**/api/account/preferences', async (route) => {
          if (route.request().method() !== 'GET') return route.continue();
          const response = await route.fetch();
          return route.fulfill({ response, json: { ...(await response.json()), locale } });
        });
        await page.route('**/api/features', async (route) => { const r = await route.fetch(); const j = await r.json(); return route.fulfill({ response: r, json: { ...j, flags: { ...(j.flags || {}), codeHarness: true, previews: true } } }); });
        await page.route('**/api/projects/*/code**', (route) => route.fulfill({ json: codeState() }));
        await page.route('**/api/code/active', (route) => route.fulfill({ status: 500, json: { error: 'Synthetic failure' } }));
        await page.addInitScript(installChat);

        // ---- Chat: status lines, Effort line, route names, the tool approval card ----
        const chatId = `r624-${short}`;
        assert.equal((await api(`/api/projects/${project.id}/chats`, { chats: [{ id: chatId, title: 'Plan' }] })).status, 200);
        await page.goto(`${env.origin}/c/${chatId}`);
        await page.locator('textarea').first().waitFor({ timeout: 20000 });
        await page.locator('textarea').first().fill('STATUS');
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => typeof window.__qaPush === 'function' && document.querySelector('.msg-meta'), null, { timeout: 15000 });
        const push = (events) => page.evaluate((e) => window.__qaPush(e), events);
        const meta = async () => flat(await page.locator('.msg-meta').last().innerText());

        await push([{ type: 'meta', model: 'synthetic', route: 'fast', reasoning: 'real', reasoningEffort: 'high', routingDecision },
          { type: 'status', id: 'loadingModel', text: 'Loading the selected model and checking its context allocation…' }]);
        await check(`the model-loading status is ${locale} (${tag})`, async () => {
          await page.waitForFunction((w) => [...document.querySelectorAll('.msg-meta')].some((e) => e.textContent.includes(w)), t('chat.statusId.loadingModel'), { timeout: 10000 });
          assert.doesNotMatch(await meta(), /Loading the selected model/);
        });
        await push([{ type: 'status', id: 'generating', text: 'Generating response…' }]);
        await check(`the generating status is ${locale} (${tag})`, async () => {
          await page.waitForFunction((w) => [...document.querySelectorAll('.msg-meta')].some((e) => e.textContent.includes(w)), t('chat.statusId.generating'), { timeout: 10000 });
          assert.doesNotMatch(await meta(), /Generating response/);
        });
        await check(`an older server's status without an id keeps its own text (${tag})`, async () => {
          await push([{ type: 'status', text: 'Synthetic older status…' }]);
          await page.waitForFunction(() => [...document.querySelectorAll('.msg-meta')].some((e) => e.textContent.includes('Synthetic older status…')), null, { timeout: 10000 });
        });
        await check(`the Effort line is ${locale} (${tag})`, async () => {
          const line = flat(await page.locator('.reasoning-result').last().innerText());
          assert.equal(line, t('chat.effort.line', { effort: t('chat.effort.value.high'), basis: t('chat.effort.real') }));
          assert.doesNotMatch(line, /Effort:|provider parameter/);
        });
        await check(`the route summary and details use the ${locale} role names (${tag})`, async () => {
          const fast = t('chat.route.name.fast'), smart = t('chat.route.name.smart');
          const summary = flat(await page.locator('.routing-details > summary').last().innerText());
          assert.equal(summary, t('chat.route.summary', { source: 'Laya', role: fast }));
          await page.locator('.routing-details > summary').last().click();
          const body = flat(await page.locator('.routing-details-body').last().innerText());
          assert.ok(body.includes(t('chat.route.selectedUsed', { selected: smart, used: fast })), body);
          assert.ok(body.includes(fast) && body.includes(smart), body);
          assert.doesNotMatch(`${summary} ${body}`, /\b(fast|smart|code)\b/, 'no raw route id');
          const header = flat((await page.locator('.msg-sender.is-assistant').last().textContent()));
          assert.ok(header.endsWith(t('chat.route.auto', { route: fast })), header);
        });
        await push([{ type: 'tool_pending', index: 0, id: 'synthetic-approval', name: 'project_create_file', args: '{"name":"notes.md","text":"synthetic"}' }]);
        await check(`the tool approval card is ${locale} (${tag})`, async () => {
          const card = page.locator('.tool-approval');
          await card.waitFor({ timeout: 10000 });
          assert.equal(await card.getAttribute('aria-label'), t('chat.approval.group', { name: 'project_create_file' }));
          assert.equal(flat(await card.locator('.tool-approval-ask').innerText()), t('chat.approval.ask', { name: 'project_create_file' }));
          const buttons = (await card.getByRole('button').allInnerTexts()).map(flat);
          assert.deepEqual(buttons, [t('chat.approval.allowOnce'), t('chat.approval.decline'), t('chat.approval.allowChat')]);
          assert.doesNotMatch(flat(await card.innerText()), ENGLISH_CHAT);
          if (shots) await page.screenshot({ path: `${shots}/chat-${short}.png`, fullPage: true });
        });
        await check(`no English chat wording is left in the reply (${tag})`, async () => {
          const shown = flat(await page.locator('.transcript').innerText());
          assert.doesNotMatch(shown, ENGLISH_CHAT, shown);
        });

        // ---- The German delete dialog (the sidebar is a drawer on a phone, so the desktop layout only) ----
        if (width >= 1024 && locale === 'de-DE') {
          await check(`the project delete dialog speaks to "du", not "Ihr" (${tag})`, async () => {
            // The ⋯ button appears on hover, as it does for a person.
            await page.locator('.spaces').getByText(`Projekt ${short}`, { exact: true }).first().hover();
            await page.getByRole('button', { name: t('sidebar.optionsFor', { name: `Projekt ${short}` }), exact: true }).click();
            await page.getByRole('menuitem', { name: t('sidebar.deleteProject'), exact: true }).click();
            const dialog = page.getByRole('dialog');
            await dialog.waitFor({ timeout: 10000 });
            const text = flat(await dialog.innerText());
            assert.match(text, /in deinem verbundenen Speicher/, text);
            assert.doesNotMatch(text, /\bIhr\w*\b/, text);
            if (shots) await page.screenshot({ path: `${shots}/delete-${short}.png` });
            await page.keyboard.press('Escape');
          });
        }

        // ---- Code tab: the task card ----
        await page.goto(`${env.origin}/p/${project.id}/code`);
        await page.locator('.code-tasks').waitFor({ timeout: 20000 });
        await page.locator('.code-task').nth(2).waitFor({ timeout: 10000 });
        const cards = page.locator('.code-task');
        const all = async (locator) => flat(await locator.evaluate((el) => el.textContent));
        await check(`the finished task's plan, output, counts and network are ${locale} (${tag})`, async () => {
          const card = cards.nth(0), text = await all(card);
          assert.ok(text.includes(t('code.task.plan.heading')), text);
          assert.ok(text.includes(t('code.task.plan.status', { status: t('code.task.plan.state.edited') })), text);
          assert.ok(text.includes(t('code.task.plan.truncated')), text);
          assert.ok(text.includes(t('code.task.output.shortened')), text);
          assert.ok(text.includes(t('code.task.output.truncated')), text);
          assert.ok(text.includes(t('code.task.result', { tools: tp('code.task.result.tools', 4, { count: '4' }), allowed: '2', declined: '1', refused: '1' })), text);
          assert.ok(text.includes(t('code.network.reached', { hosts: 'pypi.org (3)' })), text);
          assert.ok(text.includes(t('code.network.refused', { hosts: 'github.com (2)' })), text);
          assert.ok(text.includes(t('code.meta.limitations', { count: '1' })), text);
          assert.equal(await card.locator('.code-plan').getAttribute('aria-label'), t('code.task.plan.region'));
          assert.doesNotMatch(text, ENGLISH_CODE, text);
        });
        await check(`the Planner verdict, findings and outcome are ${locale} (${tag})`, async () => {
          const card = cards.nth(0), text = await all(card.locator('.code-review-outcome'));
          assert.ok(text.includes(t('code.review.requestsChanges')), text);
          assert.ok(text.includes(t('code.review.severity.major')), text);
          assert.ok(text.includes(`${t('code.review.timedOut')} ${t('code.review.branchStays')}`), text);
          assert.equal(await card.locator('.code-review-outcome').getAttribute('aria-label'), t('code.review.outcome'));
          assert.equal(await card.locator('.code-review-findings').getAttribute('aria-label'), t('code.review.findings'));
          assert.doesNotMatch(text, ENGLISH_CODE, text);
        });
        await check(`the running task's live output is ${locale} (${tag})`, async () => {
          const output = cards.nth(1).locator('.code-output');
          assert.equal(await output.getAttribute('aria-label'), t('code.task.output.heading'));
          const text = await all(output);
          assert.ok(text.includes(t('code.task.output.truncated')), text);
          assert.doesNotMatch(text, ENGLISH_CODE, text);
        });
        await check(`the review card that waits for the person is ${locale} (${tag})`, async () => {
          const card = cards.nth(2).locator('.code-review');
          assert.equal(await card.getAttribute('aria-label'), t('code.review.group'));
          const text = await all(card);
          assert.ok(text.includes(t('code.review.notReviewedReason', { reason: 'Synthetic reviewer offline' })), text);
          assert.ok(text.includes(t('code.review.advice')), text);
          assert.deepEqual((await card.getByRole('button').allInnerTexts()).map(flat), [t('code.review.accept'), t('code.approval.decline')]);
          assert.equal(await card.locator('pre').getAttribute('aria-label'), t('code.review.changeToAccept'));
          assert.doesNotMatch(text, ENGLISH_CODE, text);
          if (shots) await page.screenshot({ path: `${shots}/code-${short}.png`, fullPage: true });
        });
        await check(`the Harness label is ${locale} (${tag})`, async () => {
          assert.equal(flat(await page.locator('.code-fact span').first().innerText()), t('code.panel.harness'));
          if (locale === 'fr-FR') assert.equal(t('code.panel.harness'), 'Harnais');
        });

        // ---- Code sidebar note and the header widget ----
        if (width >= 1024) {
          await page.addInitScript(() => localStorage.setItem('noevia:feature-flags', JSON.stringify({ codeHarness: true, previews: true })));
          await page.goto(`${env.origin}/code`);
          await check(`the Code sidebar's task-status note is ${locale} (${tag})`, async () => {
            const note = page.locator('.side-hint[role=alert]');
            await note.first().waitFor({ timeout: 20000 });
            assert.equal(flat(await note.first().innerText()), t('code.sidebar.statusUnavailable'));
            assert.doesNotMatch(await page.locator('.active-code-entry').innerText(), /Code task status unavailable|Retry/);
            assert.equal(flat(await page.locator('.active-code-entry summary').innerText()), t('code.active.unavailable'));
            assert.equal(await page.locator('.active-code-entry').getAttribute('aria-label'), t('code.active.label'));
            if (shots) await page.screenshot({ path: `${shots}/sidebar-${short}.png` });
          });
        }
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no sideways scroll at ' + tag);
        await ctx.close(); await env.stop(); env = null;
      }
    }
    assert.deepEqual(errors.filter((e) => !/ResizeObserver/.test(e)), [], 'page errors');
    if (failures.length) { console.log(`FAIL remaining-english-624: ${failures.length} check(s) failed`); process.exitCode = 1; }
    else console.log('PASS #624 remaining English in German and French; 1440 light and 375 dark.');
  } finally { await browser.close(); if (env) await env.stop(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
