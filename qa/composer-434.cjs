// #434/#435/#436/#437: composer auto-grow, Send/Stop focus recovery, the Jump-to-latest touch
// target, and drag-and-drop attachments — a real application server (server/index.cjs) plus a
// disposable synthetic upstream standing in for the inference engine, the same pattern
// tests/../qa/chat-context.cjs uses. Fetch-mock (`page.route`) covers the one thing worth
// mocking rather than driving for real: a held-open reply so Stop has something to stop.
// Synthetic data only; no real Diary prompts, no network beyond localhost.
//
// Run: PLAYWRIGHT_MODULE=<playwright-core> QA_SCREENSHOTS=<dir> node qa/composer-434.cjs
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const { spawn } = require('node:child_process');
const { withLocale } = require('./qa-locale.cjs');

const PORT = 31704, UPSTREAM_PORT = 31705;
const origin = `http://localhost:${PORT}`;
const web = path.resolve(__dirname, '..');
const shots = process.env.QA_SCREENSHOTS || '/tmp';

/** Node-side helper (outside the page) for the setup/admin calls, mirroring qa/composer-mode-catalogue.cjs. */
function makeApi(cookies) {
  return async (url, body, method = body === undefined ? 'GET' : 'POST') => {
    const r = await fetch(origin + url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Origin: origin,
        Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; '),
        'X-CSRF-Token': decodeURIComponent(cookies.get('cowork_csrf') || ''),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const v of r.headers.getSetCookie()) { const p = v.split(';')[0], i = p.indexOf('='); cookies.set(p.slice(0, i), p.slice(i + 1)); }
    return { status: r.status, body: await r.json().catch(() => null) };
  };
}

/** A synthetic OpenAI-compatible upstream. Any user message containing STOPTEST keeps its SSE
 *  reply open indefinitely (never writes [DONE]) so there is something for the Stop button to
 *  interrupt; everything else answers after a short, realistic delay. */
function startUpstream() {
  const held = new Set();
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const c of req) raw += c;
    const body = raw ? JSON.parse(raw) : {};
    res.setHeader('Content-Type', 'application/json');
    if (req.url.includes('health')) return res.end(JSON.stringify({ all_models_loaded: [{ loaded: true, model_name: 'synthetic-model', recipe_options: { ctx_size: 8192 } }] }));
    if (req.url.includes('models')) return res.end(JSON.stringify({ data: [{ id: 'synthetic-model' }] }));
    if (!req.url.endsWith('/chat/completions')) return res.end('{}');
    const lastUser = [...(body.messages || [])].reverse().find(m => m.role === 'user');
    if (!body.stream) return res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: 'Synthetic title' } }] }));
    res.setHeader('Content-Type', 'text/event-stream');
    if (lastUser && /STOPTEST/.test(lastUser.content || '')) {
      res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: 'Synthetic thinking that never finishes on its own' } }] }) + '\n\n');
      held.add(res); res.on('close', () => held.delete(res));
      return;
    }
    setTimeout(() => {
      res.end('data: ' + JSON.stringify({ choices: [{ delta: { content: 'Synthetic completed reply.' }, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n');
    }, 120);
  });
  return { server, listen: () => new Promise(r => server.listen(UPSTREAM_PORT, '127.0.0.1', r)), close: () => { for (const r of held) r.end(); return new Promise(r => server.close(r)); } };
}

/** The height (px) of the composer textarea right now. */
const textareaHeight = (page) => page.locator('.composer-input').first().evaluate(el => el.getBoundingClientRect().height);

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'noevia-composer434-'));
  fs.mkdirSync(shots, { recursive: true });
  const upstream = startUpstream(); await upstream.listen();
  const server = spawn(process.execPath, ['server/index.cjs'], {
    cwd: web, stdio: 'ignore',
    env: {
      ...process.env, UI_DATA_DIR: dir, UI_PORT: String(PORT), UI_HOST: '127.0.0.1', PUBLIC_ORIGIN: origin,
      LEGACY_AUTH_COMPAT: 'false', INFERENCE_BASE_URL: `http://127.0.0.1:${UPSTREAM_PORT}`,
      MODEL_MANAGER_BASE_URL: `http://127.0.0.1:${UPSTREAM_PORT}`, MODEL_MANAGER_KIND: 'lemonade',
      MCP_SERVERS: '', MCP_SERVER_URL: '',
    },
  });
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const errors = [];
  try {
    for (let i = 0; i < 100; i++) { try { if ((await fetch(origin + '/api/setup/status')).ok) break; } catch { } await new Promise(r => setTimeout(r, 50)); }
    const cookies = new Map();
    const api = makeApi(cookies);
    assert.equal((await api('/api/setup/complete', {
      setupCode: fs.readFileSync(path.join(dir, 'first-run-setup-code'), 'utf8').trim(),
      publicOrigin: origin, username: 'composerqa', displayName: 'Synthetic Composer QA',
      password: 'synthetic composer qa password', diaryEnabled: false,
    })).status, 201);
    assert.ok((await api('/api/profile/onboarding', {})).status < 300);
    const created = await api('/api/projects', { name: 'Composer QA', model: 'synthetic-model', toolboxes: ['core'] });
    const project = created.body.project || created.body;
    assert.ok(project.id, JSON.stringify(created));
    // Separate chats per scenario (rather than one shared chat) — each scenario's own synthetic
    // reply text ("Synthetic completed reply.") is generic and would otherwise accumulate across
    // reused chats' persisted history, making a later `getByText` ambiguous.
    await api(`/api/projects/${project.id}/chats`, { chats: [
      { id: 'compqa-basic', title: 'Composer basics' },
      { id: 'compqa-focus', title: 'Composer focus' },
      { id: 'compqa-focus-coarse', title: 'Composer focus coarse' },
      { id: 'compqa-drop', title: 'Composer drop' },
      { id: 'compqa-shots', title: 'Composer shots' },
      { id: 'compqa-scroll', title: 'Composer scroll' },
    ] });
    // A history long enough that the transcript is taller than the viewport (#436).
    const longHistory = Array.from({ length: 24 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `Synthetic turn ${i}. ${'Padding text so the transcript actually scrolls. '.repeat(15)}` }));
    await api('/api/chats/compqa-scroll/history', { history: longHistory });
    const me = (await api('/api/profile')).body;
    const userId = me?.user?.id || me?.id || null;

    /** A fresh context+page deep-linked straight into `chatId`, with the admin session cookies
     *  already attached — same technique qa/composer-mode-catalogue.cjs uses to skip the sidebar. */
    async function openChat(chatId, contextOpts = {}) {
      const ctx = await browser.newContext(withLocale(contextOpts));
      await ctx.addCookies([...cookies].map(([name, value]) => ({ name, value, url: origin })));
      await ctx.addInitScript(([user, pid, cid]) => {
        localStorage.setItem('noevia:last-view', JSON.stringify({ user, view: { kind: 'chat', chatId: cid, projectId: pid }, settings: null }));
      }, [userId, project.id, chatId]);
      const page = await ctx.newPage();
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(origin);
      await page.getByRole('textbox', { name: 'Message', exact: true }).waitFor({ timeout: 15000 });
      return { ctx, page };
    }

    // ── (a) auto-grow: 1 → 9 lines, capped, then shrinks back after send (#434) ──────────────
    {
      const { ctx, page } = await openChat('compqa-basic');
      const box = page.getByRole('textbox', { name: 'Message', exact: true });
      const lines = (n) => Array.from({ length: n }, (_, i) => `synthetic line ${i + 1}`).join('\n');
      await box.fill(lines(1));
      const h1 = await textareaHeight(page);
      await box.fill(lines(5));
      const h5 = await textareaHeight(page);
      await box.fill(lines(9));
      const h9 = await textareaHeight(page);
      assert.ok(h5 > h1, `5 lines (${h5}px) should be taller than 1 line (${h1}px)`);
      assert.ok(h9 > h5, `9 lines (${h9}px) should be taller than 5 lines (${h5}px)`);
      // Well past the 220px CSS cap for the main chat composer — height must not keep growing.
      await box.fill(lines(30));
      const hCapped = await textareaHeight(page);
      assert.ok(hCapped <= 222, `30 lines (${hCapped}px) should be capped at the composer's max-height (~220px)`);
      const overflow = await page.locator('.composer-input').first().evaluate(el => el.scrollHeight > el.clientHeight + 1);
      assert.ok(overflow, 'content beyond the cap should scroll internally inside the textarea');
      // Send a short synthetic message and confirm the box shrinks back down after it clears.
      await box.fill('autogrow send synthetic');
      await box.press('Enter');
      await page.getByText('Synthetic completed reply.').waitFor({ timeout: 10000 });
      await page.waitForFunction(() => { const el = document.querySelector('.composer-input'); return el && el.value === ''; });
      const hAfterSend = await textareaHeight(page);
      assert.ok(hAfterSend <= h1 + 4, `height after send/clear (${hAfterSend}px) should shrink back to roughly the 1-line height (${h1}px), not stay tall`);
      console.log(`PASS (a) autogrow: 1=${h1}px 5=${h5}px 9=${h9}px capped=${hCapped}px afterSend=${hAfterSend}px`);
      await ctx.close();
    }

    // ── (b) focus: Stop returns it, a completed Send keeps it (#435) ─────────────────────────
    {
      const { ctx, page } = await openChat('compqa-focus');
      const box = page.getByRole('textbox', { name: 'Message', exact: true });
      const isComposerFocused = () => page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.classList.contains('composer-input'));

      await box.fill('STOPTEST hold this reply open');
      await box.press('Enter');
      await page.getByTitle('Stop generating').waitFor({ timeout: 10000 });
      await page.getByTitle('Stop generating').click();
      await page.getByRole('button', { name: 'Send', exact: true }).waitFor({ timeout: 10000 }); // streaming has ended, Send is back
      assert.ok(await isComposerFocused(), 'focus should return to the composer textarea after Stop');

      await box.fill('completed send focus synthetic');
      await box.press('Enter');
      await page.getByText('Synthetic completed reply.').waitFor({ timeout: 10000 });
      await page.getByRole('button', { name: 'Send', exact: true }).waitFor({ timeout: 10000 });
      assert.ok(await isComposerFocused(), 'focus should stay in (or return to) the composer after a completed Send');
      console.log('PASS (b) focus: Stop and a completed Send both leave focus on the composer textarea');
      await ctx.close();
    }

    // ── (b, coarse pointer) neither focus recovery fires on touch — it would pop the keyboard ──
    {
      const { ctx, page } = await openChat('compqa-focus-coarse', { hasTouch: true, isMobile: true, viewport: { width: 390, height: 700 } });
      const box = page.getByRole('textbox', { name: 'Message', exact: true });
      const isComposerFocused = () => page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.classList.contains('composer-input'));
      assert.ok(await page.evaluate(() => window.matchMedia('(pointer: coarse)').matches), 'this context should actually emulate a coarse pointer');

      await box.fill('STOPTEST hold this reply open');
      await box.press('Enter');
      await page.getByTitle('Stop generating').waitFor({ timeout: 10000 });
      await page.getByTitle('Stop generating').click();
      await page.getByRole('button', { name: 'Send', exact: true }).waitFor({ timeout: 10000 });
      assert.ok(!(await isComposerFocused()), 'Stop must not programmatically focus the composer on a coarse (touch) pointer — that would pop the keyboard');

      await box.evaluate(el => el.focus());
      await box.fill('completed send focus synthetic coarse');
      await box.press('Enter');
      await page.getByText('Synthetic completed reply.').waitFor({ timeout: 10000 });
      await page.getByRole('button', { name: 'Send', exact: true }).waitFor({ timeout: 10000 });
      assert.ok(!(await isComposerFocused()), 'a completed Send must not programmatically focus the composer on a coarse (touch) pointer either');
      console.log('PASS (b, coarse pointer) focus: neither Stop nor a completed Send re-opens the on-screen keyboard on touch');
      await ctx.close();
    }

    // ── (c) Jump-to-latest ≥44px under coarse-pointer emulation (#436) ───────────────────────
    {
      const { ctx, page } = await openChat('compqa-scroll', { viewport: { width: 390, height: 700 }, hasTouch: true, isMobile: true });
      await page.locator('.transcript').evaluate(el => { el.scrollTop = 0; el.dispatchEvent(new Event('scroll')); });
      const jump = page.getByRole('button', { name: 'Jump to latest' });
      await jump.waitFor({ timeout: 10000 });
      const boxSize = await jump.boundingBox();
      assert.ok(boxSize && boxSize.height >= 44, `Jump to latest should be ≥44px tall under coarse-pointer emulation, was ${boxSize && boxSize.height}px`);
      await page.screenshot({ path: `${shots}/jump-to-latest-touch-390.png` });
      await ctx.close();
    }
    {
      // Same control, ordinary desktop (fine) pointer: unchanged, still short.
      const { ctx, page } = await openChat('compqa-scroll', { viewport: { width: 1440, height: 900 } });
      await page.locator('.transcript').evaluate(el => { el.scrollTop = 0; el.dispatchEvent(new Event('scroll')); });
      const jump = page.getByRole('button', { name: 'Jump to latest' });
      await jump.waitFor({ timeout: 10000 });
      const boxSize = await jump.boundingBox();
      assert.ok(boxSize && boxSize.height < 40, `Jump to latest's fine-pointer look should be unchanged (short pill), was ${boxSize && boxSize.height}px`);
      await ctx.close();
    }
    console.log('PASS (c) jump-to-latest: >=44px under coarse-pointer emulation, unchanged on a fine pointer');

    // ── (d) drag-and-drop attachments reuse the picker's own pipeline (#437) ─────────────────
    {
      const { ctx, page } = await openChat('compqa-drop');
      const pane = page.locator('.chat-workspace');
      // A synthetic small text file, dropped (not picked) — same pipeline, same limits.
      await pane.evaluate(async () => {
        const dt = new DataTransfer();
        dt.items.add(new File(['synthetic drop content'], 'dropped-note.txt', { type: 'text/plain' }));
        const el = document.querySelector('.chat-workspace');
        for (const type of ['dragenter', 'dragover']) el.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
        await new Promise(r => setTimeout(r, 30));
        el.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
      });
      await page.locator('.composer-action-status').getByText(/Saved 1 file/).waitFor({ timeout: 15000 });
      console.log('PASS (d1) drop: a small text file attaches through the normal upload path');

      // A dragged link/selection (no Files type) must be ignored, not treated as an empty drop.
      const ignoredBefore = await page.locator('.composer-action-status').innerText().catch(() => '');
      await pane.evaluate(() => {
        const dt = new DataTransfer(); dt.setData('text/uri-list', 'https://example.test/not-a-file');
        const el = document.querySelector('.chat-workspace');
        el.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
      });
      await page.waitForTimeout(200);
      const ignoredAfter = await page.locator('.composer-action-status').innerText().catch(() => '');
      assert.equal(ignoredAfter, ignoredBefore, 'a dragged link/selection must not be treated as a (zero-file) drop');
      console.log('PASS (d2) drop: a non-file drag (link/selection) is ignored');

      // An oversize file shows the picker's own error — pure client-side validation, no network.
      await pane.evaluate(async () => {
        const dt = new DataTransfer();
        dt.items.add(new File([new Uint8Array(26 * 1024 * 1024)], 'too-big.txt', { type: 'text/plain' }));
        const el = document.querySelector('.chat-workspace');
        el.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
      });
      await page.locator('.composer-action-status').getByText(/exceeds the limit/).waitFor({ timeout: 10000 });
      console.log('PASS (d3) drop: an oversize file shows the picker\'s own size-limit error');

      // Multiple files in one drop follow the picker's own per-file rules (one good, one too big).
      await pane.evaluate(async () => {
        const dt = new DataTransfer();
        dt.items.add(new File(['ok'], 'multi-ok.txt', { type: 'text/plain' }));
        dt.items.add(new File([new Uint8Array(26 * 1024 * 1024)], 'multi-too-big.txt', { type: 'text/plain' }));
        const el = document.querySelector('.chat-workspace');
        el.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
      });
      await page.locator('.composer-action-status').getByText(/Saved 1\/2/).waitFor({ timeout: 15000 });
      console.log('PASS (d4) drop: multiple dropped files each follow the picker\'s own per-file rules');
      await ctx.close();
    }

    // ── screenshots: composer at 1/5/12 lines and the drag-over state, two widths, both themes ──
    for (const [width, height] of [[1440, 900], [390, 800]]) {
      for (const scheme of ['light', 'dark']) {
        const { ctx, page } = await openChat('compqa-shots', { viewport: { width, height }, colorScheme: scheme });
        const box = page.getByRole('textbox', { name: 'Message', exact: true });
        for (const n of [1, 5, 12]) {
          await box.fill(Array.from({ length: n }, (_, i) => `line ${i + 1} of ${n}`).join('\n'));
          await page.locator('.composer-inner').first().screenshot({ path: `${shots}/composer-lines-${n}-${width}-${scheme}.png` });
        }
        await box.fill('');
        await page.locator('.chat-workspace').evaluate(async () => {
          const dt = new DataTransfer();
          dt.items.add(new File(['synthetic drag preview'], 'preview.txt', { type: 'text/plain' }));
          const el = document.querySelector('.chat-workspace');
          el.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true, cancelable: true }));
          el.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
        });
        await page.locator('.chat-drop-overlay').waitFor({ timeout: 5000 });
        await page.screenshot({ path: `${shots}/composer-drag-over-${width}-${scheme}.png` });
        await ctx.close();
      }
    }
    console.log('screenshots written to', shots);

    assert.deepEqual(errors, [], 'no uncaught page errors');
    console.log('composer #434/#435/#436/#437 QA passed');
  } finally {
    await browser.close();
    server.kill();
    await upstream.close();
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
