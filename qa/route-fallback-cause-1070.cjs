// #1070: a cloud-model chat showed "Legacy routing · Fast · fallback" and "Fallback: service did
// not answer · 1,808 ms" when Laya had in fact answered 503 after missing its own 1.8 s time limit
// (a cold first decision after idle). The route detail now states that cause, and the latency stays
// in milliseconds. An older record with no fallbackCause, an unknown cause, and a cause equal to the
// reason keep the plain reason.
//
// Built app, synthetic fixture: every API answer below is invented; nothing reaches inference,
// storage or a diary.
//
//   node scripts/build.cjs --outDir <dir> && QA_DIST=<dir> node qa/route-fallback-cause-1070.cjs
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || `${os.homedir()}/noevia-local-test/node_modules/playwright-core`);
const { createFixture } = require('./diary-fixture.cjs');
const port = Number(process.env.QA_PORT || 31070), origin = `http://localhost:${port}`;
const out = process.env.QA_SCREENSHOTS || path.join(__dirname, '..', 'qa-output', 'route-fallback-cause-1070');
const failures = [], errors = []; let checks = 0;
const check = (ok, label, detail) => { checks++; if (!ok) failures.push({ label, detail }); };
const step = async (label, fn) => { try { await fn(); } catch (e) { checks++; failures.push({ label, detail: String(e.message || e).split('\n')[0] }); } };

const MODEL = 'synthetic-cloud-model';
const PROJECT = { id: '__free-synthetic', name: 'Synthetic free chat', routing: 'auto', files: [], assets: [], toolboxes: ['core'] };
const decision = (extra) => ({ offered: [{ id: 'fast', label: 'Synthetic fast' }, { id: 'smart', label: 'Synthetic smart' }], scores: {},
  selectedRole: null, effectiveRole: 'fast', backend: 'legacy', model: null, calibrated: false, latencyMs: 1808,
  status: 'fallback', fallbackReason: 'no-backend-answered', ...extra });
const reply = (routingDecision) => ['meta', 'delta', 'done'].map(type => 'data: ' + JSON.stringify(
  type === 'meta' ? { type, route: 'fast', routingDecision } : type === 'delta' ? { type, text: 'Synthetic answer.' } : { type })).join('\n\n') + '\n\n';

async function detailFor(browser, routingDecision) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  page.on('pageerror', e => errors.push(e.message));
  await page.route('https://**/*', r => r.abort());
  await page.route('**/api/workspace', r => r.fulfill({ json: { projects: [], freeChats: [] } }));
  await page.route('**/api/chats/*/context', r => r.fulfill({ json: { project: PROJECT } }));
  await page.route('**/api/models/installed', r => r.fulfill({ json: [{ name: MODEL, labels: [], loaded: true }] }));
  await page.route('**/api/chat', r => r.fulfill({ headers: { 'content-type': 'text/event-stream' }, body: reply(routingDecision) }));
  await page.goto(origin);
  const box = page.getByRole('textbox', { name: 'Message', exact: true });
  await box.waitFor();
  await box.fill('Synthetic question');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.getByText('Synthetic answer.').first().waitFor();
  const details = page.locator('.assistant-card .routing-details').last();
  await details.locator('summary').click();
  const summary = (await details.locator('summary').innerText()).trim();
  const body = (await details.locator('.routing-details-body p').first().innerText()).trim();
  await page.screenshot({ path: path.join(out, `${String(routingDecision.fallbackCause)}.png`) });
  await page.close();
  return { summary, body };
}

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const fixture = createFixture(port); await fixture.listen();
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    await step('Laya 503 names the real cause', async () => {
      const { summary, body } = await detailFor(browser, decision({ fallbackCause: 'http-503' }));
      check(summary === 'Legacy routing · Fast · fallback', 'summary still says which router answered', summary);
      check(body === 'Fallback: service did not answer (the decision service missed its own time limit or was restarting) · 1,808 ms',
        'detail states the 503 cause and keeps the latency in ms', body);
    });
    await step('unreachable service', async () => {
      const { body } = await detailFor(browser, decision({ fallbackCause: 'network', latencyMs: 12 }));
      check(body === 'Fallback: service did not answer (decision service unreachable) · 12 ms', 'detail states the network cause', body);
    });
    await step('older record without a cause', async () => {
      const { body } = await detailFor(browser, decision({ fallbackCause: undefined }));
      check(body === 'Fallback: service did not answer · 1,808 ms', 'older record keeps the plain reason', body);
    });
    await step('unknown cause is not shown', async () => {
      const { body } = await detailFor(browser, decision({ fallbackCause: 'synthetic-unknown' }));
      check(body === 'Fallback: service did not answer · 1,808 ms', 'unknown cause is not rendered', body);
    });
    await step('cause equal to the reason is not repeated', async () => {
      const { body } = await detailFor(browser, decision({ fallbackReason: 'deadline', fallbackCause: 'deadline', latencyMs: 2001 }));
      check(body === 'Fallback: time limit · 2,001 ms', 'deadline is said once', body);
    });
    check(errors.length === 0, 'no browser errors', errors);
    console.log(JSON.stringify({ checks, failed: failures.length, failures }, null, 2));
    if (failures.length) process.exitCode = 1;
  } finally { await browser.close(); await fixture.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
