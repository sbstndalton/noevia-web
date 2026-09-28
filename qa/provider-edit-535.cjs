// #535 / #536, against the synthetic diary fixture and page.route mocks only (no real provider,
// no model, no Diary): Settings -> AI providers -> Edit a private provider in place.
//
//   1. A private custom provider has an Edit button; the default row and a shared row (the
//      fixture user is a member) do not.
//   2. Edit opens ProviderForm prefilled (name, URL, default model, context size) with an EMPTY
//      key field whose placeholder says a blank keeps the current key.
//   3. Changing only the context size and saving with the key blank sends a PUT whose body has
//      no apiKey (the stored key is kept server-side) and the new contextTokens, and does NOT
//      re-run the connection test (neither the address nor the key changed).
//   4. The list refreshes from GET and shows the new context size; focus returns to Edit.
//   5. Changing the key re-runs the test, then the PUT carries the new key.
//   6. An out-of-range context size is refused in the form without any request.
//
// Screenshots at 390 and 1440, light and dark, go to QA_SCREENSHOTS (default
// /tmp/noevia-qa-535/shots). QA_DIST points at a build written elsewhere, so the same script
// fails on an origin/main build (no Edit button) and passes on this branch's build.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createFixture } = require('./diary-fixture.cjs');
const { withLocale } = require('./qa-locale.cjs');

const PORT = Number(process.env.QA_PORT) || 31535;
const SHOTS = process.env.QA_SCREENSHOTS || '/tmp/noevia-qa-535/shots';
fs.mkdirSync(SHOTS, { recursive: true });

function syntheticProviders() {
  return [
    { id: 'default', label: 'Local engine', baseUrl: 'http://engine.invalid:8080/v1', apiKeyMasked: null, isDefault: true, managed: true, shared: false },
    { id: 'prov-synthetic-1', label: 'Synthetic Hosted', baseUrl: 'https://synthetic.example/v1', apiKeyMasked: 'sk-…1111', isDefault: false, managed: false, shared: false, defaultModel: 'synthetic-large' },
    { id: 'prov-team-1', label: 'Team Shared', baseUrl: 'https://team.example/v1', apiKeyMasked: 'sk-…2222', isDefault: false, managed: false, shared: true },
  ];
}

async function routeProviders(page) {
  const state = { rows: syntheticProviders(), puts: [], tests: [], gets: 0 };
  await page.route('**/api/providers/test', (route) => {
    state.tests.push(route.request().postDataJSON());
    return route.fulfill({ json: { ok: true, models: ['synthetic-large'] } });
  });
  await page.route('**/api/providers/*', (route) => {
    const req = route.request();
    if (req.method() !== 'PUT') return route.fallback();
    const id = decodeURIComponent(new URL(req.url()).pathname.split('/').pop());
    const body = req.postDataJSON();
    state.puts.push({ id, body });
    const row = state.rows.find((r) => r.id === id);
    const next = { ...row, label: body.label, baseUrl: body.baseUrl, defaultModel: body.defaultModel || undefined };
    if (body.contextTokens) next.contextTokens = body.contextTokens; else delete next.contextTokens;
    if (body.apiKey) next.apiKeyMasked = `…${body.apiKey.slice(-4)}`;
    state.rows = state.rows.map((r) => (r.id === id ? next : r));
    return route.fulfill({ json: next });
  });
  await page.route('**/api/providers', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    state.gets += 1;
    return route.fulfill({ json: { providers: state.rows } });
  });
  return state;
}

(async () => {
  const fixture = createFixture(PORT);
  await fixture.listen();
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const errors = [];
  try {
    for (const width of [1440, 390]) {
      for (const theme of ['light', 'dark']) {
        const page = await browser.newPage(withLocale({ viewport: { width, height: 900 } }));
        page.on('pageerror', (e) => errors.push(e.message));
        await page.addInitScript((t) => localStorage.setItem('cowork-theme', t), theme);
        const state = await routeProviders(page);
        await page.goto(`http://localhost:${PORT}/settings/providers`);
        await page.getByText('Synthetic Hosted', { exact: true }).waitFor();

        // 1. Who gets an Edit button.
        const edit = page.getByRole('button', { name: 'Edit Synthetic Hosted', exact: true });
        await edit.waitFor({ timeout: 3000 });
        assert.equal(await page.getByRole('button', { name: 'Edit Team Shared', exact: true }).count(), 0, 'a member gets no Edit on a shared row');
        assert.equal(await page.getByRole('button', { name: 'Edit Local engine', exact: true }).count(), 0, 'the default provider is not editable');
        await page.screenshot({ path: path.join(SHOTS, `${width}-${theme}-list.png`), fullPage: true });

        // 2. Prefilled form, blank key with the keep-key placeholder.
        await edit.click();
        const form = page.getByRole('group', { name: 'Edit Synthetic Hosted' });
        await form.waitFor();
        assert.equal(await form.getByLabel('Provider name', { exact: true }).inputValue(), 'Synthetic Hosted');
        assert.equal(await form.getByLabel('Provider base URL', { exact: true }).inputValue(), 'https://synthetic.example/v1');
        assert.equal(await form.getByLabel('Default model', { exact: true }).inputValue(), 'synthetic-large');
        const key = form.getByLabel('Provider API key', { exact: true });
        assert.equal(await key.inputValue(), '');
        assert.equal(await key.getAttribute('placeholder'), 'Leave blank to keep the current key');
        assert.equal(await form.getByRole('combobox', { name: 'Provider type' }).count(), 0, 'no preset picker when editing');
        const context = form.getByLabel('Context size (tokens)', { exact: true });
        assert.equal(await context.inputValue(), '');

        // 6. Out-of-range context size: refused in the form, nothing sent.
        await context.fill('1000');
        await form.getByRole('button', { name: 'Save changes', exact: true }).click();
        await form.getByText('Context size must be a whole number from 2,048 to 2,000,000.').waitFor();
        assert.equal(state.puts.length, 0);
        assert.equal(state.tests.length, 0);

        // 3. Context only, key blank: PUT without apiKey, no connection re-test.
        await context.fill('131,072');
        await page.screenshot({ path: path.join(SHOTS, `${width}-${theme}-edit-form.png`), fullPage: true });
        const getsBefore = state.gets;
        await form.getByRole('button', { name: 'Save changes', exact: true }).click();
        await form.waitFor({ state: 'detached' });
        assert.equal(state.puts.length, 1);
        assert.equal(state.puts[0].id, 'prov-synthetic-1');
        assert.equal('apiKey' in state.puts[0].body, false, `a blank key must be omitted from the PUT: ${JSON.stringify(state.puts[0].body)}`);
        assert.equal(state.puts[0].body.contextTokens, 131072);
        assert.equal(state.puts[0].body.baseUrl, 'https://synthetic.example/v1');
        assert.equal(state.tests.length, 0, 'unchanged address and key: no connection re-test');

        // 4. List refresh + focus back on Edit.
        await page.getByText('context 131,072 tokens').waitFor();
        assert.ok(state.gets > getsBefore, 'the list re-fetched after saving');
        await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Edit Synthetic Hosted', null, { timeout: 2000 }).catch(() => {});
        assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Edit Synthetic Hosted', 'focus returns to the Edit button');
        await page.screenshot({ path: path.join(SHOTS, `${width}-${theme}-saved.png`), fullPage: true });

        // 5. A new key: re-tested with that key, then sent.
        await edit.click();
        await form.waitFor();
        assert.equal(await form.getByLabel('Context size (tokens)', { exact: true }).inputValue(), '131072', 'the saved context size is prefilled');
        await form.getByLabel('Provider API key', { exact: true }).fill('sk-synthetic-new-9999');
        await form.getByRole('button', { name: 'Save changes', exact: true }).click();
        await form.waitFor({ state: 'detached' });
        assert.equal(state.tests.length, 1, 'a changed key re-runs the connection test');
        assert.equal(state.tests[0].apiKey, 'sk-synthetic-new-9999');
        assert.equal(state.puts[1].body.apiKey, 'sk-synthetic-new-9999');
        assert.equal(state.puts[1].body.contextTokens, 131072);
        await page.getByText('key …9999').waitFor();

        // Horizontal overflow check at every width/theme.
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        assert.ok(overflow <= 0, `${width}px ${theme}: horizontal overflow of ${overflow}px`);
        await page.close();
      }
    }
    assert.deepEqual(errors, [], `page errors: ${errors.join('\n')}`);
    console.log(`provider-edit-535: pass (screenshots in ${SHOTS})`);
  } finally {
    await browser.close();
    await fixture.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
