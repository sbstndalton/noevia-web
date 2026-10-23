'use strict';
// sbstndalton/noevia#1071 slice 4 review N5: a history save the transcript store refuses as busy
// (503, nothing written) is sent again once after the Retry-After wait, capped at 10 s; a second
// refusal is thrown so the app shows it instead of losing the save silently. Synthetic fetch only.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../../src/api.ts'), 'utf8');
const block = source.slice(source.indexOf('/** The longest wait a busy (503) history save'), source.indexOf('// Chat streams SSE events from the proxy:'));
const js = ts.transpileModule(block.replace(/export /g, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function harness(responses) {
  const posts = [], delays = [];
  const ctx = {
    apiFetch: async (url, init) => {
      posts.push({ url, body: JSON.parse(init.body) });
      const r = responses.shift();
      return { status: r.status, ok: r.status >= 200 && r.status < 300, headers: { get: (n) => (n === 'Retry-After' ? r.retryAfter ?? null : null) }, json: async () => r.body ?? {} };
    },
    setTimeout: (fn, ms) => { delays.push(ms); fn(); },
  };
  vm.createContext(ctx);
  vm.runInContext(js + '\nthis.saveChatHistory = saveChatHistory; this.historySaveRetryDelay = historySaveRetryDelay;', ctx);
  return { ctx, posts, delays };
}

const H = [{ role: 'user', content: 'qa hello' }];

test('a busy save is retried once after Retry-After and then lands', async () => {
  const h = harness([{ status: 503, retryAfter: '2' }, { status: 200, body: { revision: 'r2' } }]);
  const result = await h.ctx.saveChatHistory('qa-chat', H, 'r1');
  assert.equal(result.ok, true);
  assert.equal(result.revision, 'r2');
  assert.deepEqual(h.delays, [2000]);
  assert.equal(h.posts.length, 2);
  assert.deepEqual(h.posts[1].body, { history: H, baseRevision: 'r1' }, 'the same save is sent again');
});

test('the wait is capped at 10 s and defaults to 1 s', () => {
  const { ctx } = harness([]);
  assert.equal(ctx.historySaveRetryDelay('120'), 10000);
  assert.equal(ctx.historySaveRetryDelay(null), 1000);
  assert.equal(ctx.historySaveRetryDelay('soon'), 1000);
  assert.equal(ctx.historySaveRetryDelay('0'), 0);
});

test('a second busy answer is thrown (only one retry), and other failures are not retried', async () => {
  const busy = harness([{ status: 503, retryAfter: '1' }, { status: 503, retryAfter: '1' }, { status: 200 }]);
  await assert.rejects(busy.ctx.saveChatHistory('qa-chat', H), /history save failed \(503\)/);
  assert.equal(busy.posts.length, 2);

  const broken = harness([{ status: 500 }, { status: 200 }]);
  await assert.rejects(broken.ctx.saveChatHistory('qa-chat', H), /history save failed \(500\)/);
  assert.equal(broken.posts.length, 1);
  assert.deepEqual(broken.delays, []);
});

test('a conflict after the retry is still returned as a conflict', async () => {
  const h = harness([{ status: 503 }, { status: 409, body: { history: H, revision: 'r9' } }]);
  const result = await h.ctx.saveChatHistory('qa-chat', H, 'r1');
  assert.equal(result.ok, false);
  assert.equal(result.conflict.revision, 'r9');
});

test('the app shows a failed save instead of swallowing it', () => {
  const app = fs.readFileSync(path.join(__dirname, '../../src/App.tsx'), 'utf8');
  assert.match(app, /\.then\(run\)\s*\.catch\(\(\) => \{ setProjectError\(trRef\.current\('chat\.saveFailed'\)\); \}\)/);
  for (const locale of ['en-GB', 'de-DE', 'fr-FR', 'es-ES', 'it-IT', 'nl-NL', 'nb-NO', 'pt-BR', 'sv-SE']) {
    assert.match(fs.readFileSync(path.join(__dirname, `../../src/i18n/${locale}.ts`), 'utf8'), /'chat\.saveFailed': /, locale);
  }
});
