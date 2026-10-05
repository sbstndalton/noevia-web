// #887 in a real browser against the built client. Synthetic APIs only.
//   A write approval card names the MCP server the call goes to ("via <server label>"), taken from the
//   tool_pending event's `server`, so two servers offering one tool name can be told apart. A directory
//   server shows its title and its id ("Title (id)", from /api/toolboxes: a title is untrusted), any other the id the server sent; no `server`, no line.
//   All three actions and the full, untruncated arguments are unchanged.
//
// FAILS on origin/main (f6885a55), PASSES with the fix.
// Run: npm run build -- --outDir /tmp/<name>-dist, then
//   PLAYWRIGHT_MODULE=<playwright-core> QA_CHROME_PATH=<Brave or Chrome binary> QA_DIST=/tmp/<name>-dist \
//   node qa/approval-server-887.cjs
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const assert = require('node:assert/strict');
const { createFixture } = require('./diary-fixture.cjs');

const PORT = 31887;
const ARGS = JSON.stringify({ path: 'Synthetic/' + 'long-path-'.repeat(20), content: 'BEGIN_FULL_ARGUMENTS\n' + 'Synthetic proposed content.\n'.repeat(30) + 'END_FULL_ARGUMENTS' });

(async () => {
  const fixture = createFixture(PORT);
  await fixture.listen();
  const browser = await chromium.launch({ headless: true, ...(process.env.QA_CHROME_PATH ? { executablePath: process.env.QA_CHROME_PATH } : { channel: 'chrome' }) });
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/api/chats/*/context', (r) => r.fulfill({ json: { project: { id: 'synthetic-approval-context', name: 'Synthetic', model: 'synthetic', files: [], assets: [], toolboxes: ['core'] } } }));
    await page.route('**/api/toolboxes', (r) => r.fulfill({ json: { toolboxes: [], mcp: { configured: true, servers: [
      { id: 'dir-notes', auth: 'oauth', directory: true, title: 'Synthetic Notes', error: null, discovered: 3 },
      { id: 'dir-spoof', auth: 'directory', directory: true, title: 'Nextcloud', error: null, discovered: 1 },
      { id: 'nextcloud', auth: 'nextcloud', error: null, discovered: 5 },
    ] } } }));
    const decisions = [];
    await page.route('**/api/tool-approvals/*', (r) => { decisions.push(r.request().postDataJSON().decision); return r.fulfill({ json: { ok: true } }); });
    const before = fixture.requests.length;
    await page.goto(`http://localhost:${PORT}`);
    await page.getByPlaceholder('Message noevia…').fill('live synthetic');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    for (let i = 0; fixture.requests.length === before && i < 100; i++) await page.waitForTimeout(20);
    await page.waitForTimeout(100);

    const card = page.locator('.tool-approval');
    const line = card.locator('[data-testid="tool-approval-server"]');
    const cases = [
      { id: 'a', server: 'dir-notes', expect: 'via Synthetic Notes (dir-notes)', decision: 'approve', button: 'Allow once' },
      { id: 'b', server: 'nextcloud', expect: 'via nextcloud', decision: 'deny', button: 'Decline' },
      // A registry title imitating the operator's server still shows the id noevia gave it.
      { id: 'e', server: 'dir-spoof', expect: 'via Nextcloud (dir-spoof)', decision: 'approve', button: 'Allow once' },
      { id: 'c', server: 'not-listed', expect: 'via not-listed', decision: 'approve_all', button: 'Allow for this chat' },
      { id: 'd', server: undefined, expect: null, decision: 'approve', button: 'Allow once' },
    ];
    for (const c of cases) {
      fixture.liveEvent({ type: 'tool_pending', index: 0, id: `synthetic-${c.id}`, name: 'synthetic_write', args: ARGS, ...(c.server ? { server: c.server } : {}) });
      await card.waitFor();
      if (c.expect) {
        await line.waitFor();
        // The title arrives from /api/toolboxes a moment after the card; the id shows until then.
        await page.waitForFunction((want) => document.querySelector('[data-testid="tool-approval-server"]')?.textContent === want, c.expect);
        assert.equal((await line.textContent()).trim(), c.expect, `case ${c.id}`);
      } else {
        assert.equal(await line.count(), 0, 'no server, no line');
      }
      // Unchanged: the full, untruncated arguments and all three actions.
      assert.equal(await card.locator('pre.tool-approval-args').last().textContent(), JSON.stringify(JSON.parse(ARGS), null, 1), `case ${c.id} arguments`);
      for (const name of ['Allow once', 'Decline', 'Allow for this chat']) assert.equal(await card.getByRole('button', { name, exact: true }).count(), 1, `${name} present`);
      await card.getByRole('button', { name: c.button, exact: true }).click();
      await page.waitForFunction(() => [...document.querySelectorAll('.tool-approval button')].every((b) => b.disabled));
      fixture.liveEvent({ type: 'tool_result', index: 0, name: 'synthetic_write', text: c.decision === 'deny' ? 'Declined by user.' : 'Synthetic write accepted.', declined: c.decision === 'deny' });
      await card.waitFor({ state: 'detached' });
    }
    assert.deepEqual(decisions, ['approve', 'deny', 'approve', 'approve_all', 'approve']);
    fixture.finishLive();
    assert.deepEqual(errors, []);
    console.log('PASS approval card names the MCP server it goes to (directory title with its id, raw id, nothing when absent); arguments and all three actions unchanged.');
  } finally { await browser.close(); await fixture.close(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
