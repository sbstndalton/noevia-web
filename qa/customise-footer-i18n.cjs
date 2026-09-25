// i18n coverage for #293 part 2: the Customise page (skills/connectors/plugins), the chat-shell
// status footer (StatsBar) and the composer's Thinking control, in de-DE and fr-FR at 375 and 1440,
// checked for horizontal overflow and clipped controls. Real application server, synthetic upstream
// model, model management and MCP disabled — no live inference, no Diary, no network calls out.
//   PLAYWRIGHT_MODULE=... node qa/customise-footer-i18n.cjs
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const { withLocale } = require('./qa-locale.cjs');
const origin = 'http://localhost:31611', web = path.resolve(__dirname, '..');
const out = process.env.QA_SCREENSHOTS || '/tmp/customise-footer-i18n-shots';

async function api(page, url, body, method = body === undefined ? 'GET' : 'POST') {
  return page.evaluate(async ({ url, body, method }) => {
    const csrf = decodeURIComponent(document.cookie.split(';').map(s => s.trim()).find(s => s.startsWith('cowork_csrf='))?.slice(12) || '');
    const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: await r.json().catch(() => null) };
  }, { url, body, method });
}

// What each run expects on screen, in its own language.
const L = {
  'de-DE': { customise: 'Anpassen', skills: 'Skills', plugins: 'Plugins', thinking: 'Denken', standard: 'Standard', low: 'Niedrig', high: 'Hoch', speed: 'Geschwindigkeit', firstToken: 'Erstes Token', engineTotal: 'Engine gesamt', gpu: 'GPU', openNav: 'Navigation öffnen', nav: 'Navigation', newChat: 'Neuer Chat', send: 'Senden', thinkingAria: 'Denkaufwand' },
  'fr-FR': { customise: 'Personnaliser', skills: 'Compétences', plugins: 'Modules', thinking: 'Réflexion', standard: 'Standard', low: 'Faible', high: 'Élevé', speed: 'Vitesse', firstToken: 'Premier jeton', engineTotal: 'Total du moteur', gpu: 'GPU', openNav: 'Ouvrir la navigation', nav: 'Navigation', newChat: 'Nouvelle discussion', send: 'Envoyer', thinkingAria: 'Effort de réflexion' },
};

// Overflow/clipping check, the same shape as i18n-locale.cjs and settings-i18n.cjs use.
async function checkNoOverflow(page, width, label) {
  const state = await page.evaluate(() => {
    const overflow = document.documentElement.scrollWidth > window.innerWidth + 1;
    const scrolls = (e) => /auto|scroll/.test(getComputedStyle(e).overflowX);
    const clipped = [...document.querySelectorAll('button, [role="radio"], [role="menuitemradio"], .set-row-label, label, h1, h2, select, .stats-value, .stats-label, .plugins-note, dt, dd')]
      .filter((e) => e.offsetParent && e.getClientRects().length && !e.closest('.chat-row, .proj-row, [hidden]'))
      .filter((e) => {
        if (e.scrollWidth > e.clientWidth + 1 && !scrolls(e)) return true;
        let clip = e.parentElement;
        while (clip && getComputedStyle(clip).overflowX === 'visible') clip = clip.parentElement;
        if (clip && clip.classList.contains('glass-seg')) return false;
        const r = e.getBoundingClientRect(), p = clip ? clip.getBoundingClientRect() : { left: 0, right: window.innerWidth };
        return r.right > Math.min(p.right, window.innerWidth) + 1 || r.left < Math.max(p.left, 0) - 1;
      })
      .map((e) => `${(e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 60)} [${e.tagName}.${e.className}]`);
    return { overflow, clipped };
  });
  assert.equal(state.overflow, false, `${width} ${label}: horizontal overflow`);
  assert.deepEqual(state.clipped, [], `${width} ${label}: clipped ${state.clipped.join(' | ')}`);
}

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'noevia-customise-i18n-'));
  // A tiny synthetic OpenAI-compatible upstream, exactly as reasoning.cjs uses: one fixed answer,
  // no reasoning, so the reply always lands and the footer gets real (if trivial) telemetry.
  const upstream = http.createServer(async (req, res) => {
    let raw = ''; for await (const c of req) raw += c;
    if (req.url.endsWith('/models')) { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ data: [{ id: 'synthetic-model' }] })); }
    res.setHeader('Content-Type', 'text/event-stream');
    res.end('data: ' + JSON.stringify({ choices: [{ delta: { content: 'Synthetic i18n QA answer' } }] }) + '\ndata: [DONE]\n\n');
  });
  await new Promise((r) => upstream.listen(31612, '127.0.0.1', r));
  const { spawn } = require('node:child_process');
  const server = spawn(process.execPath, ['server/index.cjs'], { cwd: web, stdio: 'ignore', env: { ...process.env, UI_DATA_DIR: dir, UI_PORT: '31611', UI_HOST: '127.0.0.1', PUBLIC_ORIGIN: origin, LEGACY_AUTH_COMPAT: 'false', DIARY_AUTH_TOKEN: 'synthetic-only', INFERENCE_BASE_URL: 'http://127.0.0.1:31612/v1', DIARY_BASE_URL: 'http://127.0.0.1:1', MODEL_MANAGER_KIND: 'none', MCP_SERVERS: '', MCP_SERVER_URL: '' } });
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    for (let i = 0; i < 100; i++) { try { if ((await fetch(origin + '/api/setup/status')).ok) break; } catch { } await new Promise((r) => setTimeout(r, 50)); }
    const page = await browser.newPage(withLocale({ viewport: { width: 1440, height: 900 } }));
    await page.goto(origin);
    assert.equal((await api(page, '/api/setup/complete', { setupCode: fs.readFileSync(path.join(dir, 'first-run-setup-code'), 'utf8').trim(), publicOrigin: origin, username: 'i18nqa', displayName: 'Synthetic i18n QA', password: 'synthetic i18n qa password', diaryEnabled: false })).status, 201);
    await api(page, '/api/profile/onboarding', {});
    const created = await api(page, '/api/projects', { name: 'Synthetic i18n project', model: 'synthetic-model', toolboxes: [] });
    assert.ok(created.status === 200 || created.status === 201, `project create: ${created.status}`);
    const projectId = created.body.id;

    for (const locale of ['de-DE', 'fr-FR']) {
      const l = L[locale];
      assert.equal((await api(page, '/api/account/preferences', { locale }, 'PUT')).status, 200);
      for (const width of [375, 1440]) {
        const phone = width < 700;
        await page.setViewportSize({ width, height: phone ? 812 : 900 });
        await page.reload();
        if (phone) {
          await page.getByRole('button', { name: l.openNav, exact: true }).waitFor();
          await page.getByRole('button', { name: l.openNav, exact: true }).click();
          await page.getByRole('dialog', { name: l.nav }).waitFor();
        }
        const projectRow = page.getByText('Synthetic i18n project', { exact: true }).first();
        await projectRow.waitFor();
        await projectRow.click();
        if (phone && await page.getByRole('dialog', { name: l.nav }).isVisible().catch(() => false)) await page.keyboard.press('Escape');
        // A fresh chat per run keeps the composer at "ready to send", not "streaming"/"sent" already.
        await page.locator('.project-page').getByRole('button', { name: l.newChat, exact: true }).click();
        await page.locator('.composer-input').waitFor();
        await page.locator('.composer-input').fill('Synthetic i18n QA question ' + locale + ' ' + width);
        await page.getByRole('button', { name: l.send, exact: true }).click();
        await page.getByText('Synthetic i18n QA answer', { exact: true }).first().waitFor({ timeout: 15000 });

        // Chat-shell status footer: translated dt labels ("Speed", "First token", "Engine total", "GPU").
        // On a phone the footer starts collapsed to one line; open it before checking the details.
        if (phone) {
          const alreadyOpen = await page.getByText(l.speed, { exact: true }).first().isVisible().catch(() => false);
          if (!alreadyOpen) await page.locator('.stats-bar').first().click();
        }
        await page.getByText(l.speed, { exact: true }).first().waitFor();
        await page.getByText(l.firstToken, { exact: true }).first().waitFor();
        await page.getByText(l.engineTotal, { exact: true }).first().waitFor();
        await page.getByText(l.gpu, { exact: true }).first().waitFor();
        await checkNoOverflow(page, width, `${locale} footer`);
        await page.screenshot({ path: path.join(out, `footer-${locale}-${width}.png`), fullPage: true });

        // Composer Thinking control: translated pill label and menu options ("Auto"/"Low"/"Standard"/"High").
        const pill = page.locator('.reasoning-pill');
        await pill.waitFor();
        await pill.scrollIntoViewIfNeeded();
        // On a phone the "Thinking" label itself is hidden by CSS to save space (only the level and
        // chevron show); the aria-label carries the translated text regardless of width.
        assert.equal(await pill.getAttribute('aria-label'), l.thinkingAria);
        if (width >= 700) assert.match(await pill.innerText(), new RegExp(l.thinking));
        await pill.click();
        await page.getByRole('menuitemradio', { name: new RegExp('^' + l.standard) }).waitFor();
        await page.getByRole('menuitemradio', { name: new RegExp('^' + l.low) }).waitFor();
        await page.getByRole('menuitemradio', { name: new RegExp('^' + l.high) }).waitFor();
        await checkNoOverflow(page, width, `${locale} thinking menu`);
        await page.screenshot({ path: path.join(out, `thinking-${locale}-${width}.png`), fullPage: true });
        await page.keyboard.press('Escape');

        // Customise: header, tabs and the shared MCP directory copy, translated.
        if (await page.getByRole('button', { name: l.openNav, exact: true }).isVisible()) await page.getByRole('button', { name: l.openNav, exact: true }).click();
        await page.getByRole('button', { name: l.customise, exact: true }).click();
        const s = page.locator('.plugins-page');
        await s.getByRole('heading', { name: l.customise, level: 1 }).waitFor();
        await s.getByRole('radio', { name: l.skills, exact: true }).waitFor();
        await s.getByRole('radio', { name: l.plugins, exact: true }).click();
        await s.getByText(l.plugins).first().waitFor();
        await checkNoOverflow(page, width, `${locale} customise`);
        await page.screenshot({ path: path.join(out, `customise-${locale}-${width}.png`), fullPage: true });
      }
    }
    console.log('PASS Customise, chat-shell status footer and composer Thinking control translated (de-DE, fr-FR; 375/1440, no overflow or clipping). Screenshots in ' + out);
  } finally {
    await browser.close();
    server.kill();
    upstream.close();
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
