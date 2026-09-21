'use strict';
// Where does Node's time go on a chat request?  Synthetic data only: a temp
// data dir, a fake OpenAI-compatible upstream, a generated tool catalogue and
// generated documents. Nothing here touches the Diary, the corpus, a real model
// or the network.
//
//   node scripts/profile-hot-paths.cjs            # table on stdout
//   node scripts/profile-hot-paths.cjs --json     # machine-readable
//
// Two kinds of number:
//   A. in-process cost of the pure hot paths (per call, microseconds), and
//   B. the whole request through handleRequest with a fake provider, so the
//      loop's per-token CPU cost is measured where it is paid.
// Compare against the engine: ~14-30 tok/s decode (33-71 ms per token) and
// ~300-500 tok/s prefill (2-3 ms per token) on the target hardware
// (docs/research-known-good-settings.md), and Docling at seconds per page.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable, Writable } = require('node:stream');
const { performance } = require('node:perf_hooks');

const JSON_OUT = process.argv.includes('--json');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'noevia-profile-'));
process.env.UI_DATA_DIR = dataDir;
process.env.DIARY_AUTH_TOKEN = 'profile-token';
process.env.LEGACY_AUTH_COMPAT = 'true';
process.env.PUBLIC_ORIGIN = 'http://localhost';
process.env.MCP_SERVERS = ''; // no discovery
process.env.LLM_RATE_LIMIT = '100000';

const rows = [];
function record(section, name, { calls, wallMs, cpuMs, unit = 'call', units = calls, note = '' }) {
  rows.push({ section, name, calls, wallMs, cpuMs, perUnitUs: (cpuMs * 1000) / units, unit, note });
}
function bench(section, name, fn, { calls = 200, unit, units, note } = {}) {
  for (let i = 0; i < Math.min(20, calls); i++) fn(); // warm the JIT
  const cpu0 = process.cpuUsage(); const t0 = performance.now();
  for (let i = 0; i < calls; i++) fn();
  const wallMs = performance.now() - t0; const cpu = process.cpuUsage(cpu0);
  record(section, name, { calls, wallMs, cpuMs: (cpu.user + cpu.system) / 1000, unit, units: units ? units * calls : undefined, note });
}

// ── Synthetic fixtures ──────────────────────────────────────────────────────
const words = 'ledger invoice calendar note deck contact task project meeting summary amount date source'.split(' ');
const prose = (n) => Array.from({ length: n }, (_, i) => words[i % words.length]).join(' ');
const syntheticTool = (name, size) => ({ type: 'function', function: { name, description: prose(size), parameters: { type: 'object', properties: Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`arg${i}`, { type: 'string', description: prose(8) }])), required: ['arg0'] } } });
const catalogue = Array.from({ length: 160 }, (_, i) => syntheticTool(`nc_tool_${i}`, 12 + (i % 5) * 20));
const rawCatalogue = catalogue.map((t) => ({ name: t.function.name, description: t.function.description, inputSchema: t.function.parameters, annotations: { readOnlyHint: true } }));
const history = Array.from({ length: 200 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: prose(120) }));
const bigResult = JSON.stringify(Array.from({ length: 500 }, (_, i) => ({ id: i, title: `Row ${i}`, created: '2026-09-21T10:00:00Z', modified: '2026-09-21T11:00:00Z', category: words[i % words.length], content: prose(30), favorite: i % 7 === 0 })));
const bigDocument = Array.from({ length: 40 }, (_, p) => `[Page ${p + 1}]\n` + prose(1500)).join('\n');
const deltaLines = Array.from({ length: 5000 }, (_, i) => 'data: ' + JSON.stringify({ id: 'x', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: words[i % words.length] + ' ' }, finish_reason: null }] }));

// ── A. Pure hot paths ────────────────────────────────────────────────────────
const { createToolboxes, estimateToolTokens } = require('../server/toolboxes.cjs');
const boxes = createToolboxes({
  mcpBoxes: () => [{ id: 'nc-all', label: 'All', description: '', source: 'mcp', server: 'nc', tools: catalogue, reads: catalogue.map((t) => t.function.name) }],
  mcpTools: () => new Map(catalogue.map((t) => [t.function.name, { serverId: 'nc', readOnly: true }])),
  prefill: { budgetFor: () => null, rateFor: () => 0 }, documentSources: { notice: () => '' },
});
bench('A', 'estimateToolTokens: 160-tool catalogue', () => estimateToolTokens(catalogue), { note: 'JSON.stringify of every tool' });
bench('A', 'resolveTools: 160 candidates -> cap/budget', () => boxes.resolveTools({ toolboxes: ['nc-all'] }, 'model-9b'), { note: 'per chat turn, twice with routing' });
bench('A', 'isWriteTool over 160 names', () => { for (const t of catalogue) boxes.isWriteTool(t.function.name); }, { note: 'rebuilds the read-only set per call' });
const mcp = require('../server/mcp.cjs');
bench('A', 'mcp.convertTool: 160 raw tools', () => { for (const t of rawCatalogue) mcp.convertTool(t); }, { note: 'once per discovery (10 min TTL)' });
const context = require('../server/chat-context.cjs');
bench('A', 'chat-context.measure: 200 msgs + 24 tools', () => context.measure(history, catalogue.slice(0, 24), 32768, 'engine', 'model-9b'), { note: 'per round' });
const { reduceToolResult } = require('../server/tool-result-reduce.cjs');
bench('A', `reduceToolResult: ${(bigResult.length / 1024).toFixed(0)} KB JSON array`, () => reduceToolResult(bigResult, { maxChars: 8000 }), { calls: 50, note: 'per tool result' });
const rag = require('../server/rag.cjs');
bench('A', `rag.chunkText: ${(bigDocument.length / 1024).toFixed(0)} KB, 40 pages`, () => rag.chunkText(bigDocument), { calls: 50, note: 'per document ingest' });
bench('A', 'SSE delta parse: 5000 lines', () => { for (const l of deltaLines) { const p = l.slice(5).trim(); if (p !== '[DONE]') JSON.parse(p); } }, { calls: 20, unit: 'token', units: 5000, note: 'what the stream loop does per token' });
const sse = deltaLines.map((l) => l + '\n\n').join('');
bench('A', 'SSE line reassembly + parse: 5000 tokens, 1 KB chunks', () => {
  const dec = new TextDecoder(); let buffer = ''; const bytes = Buffer.from(sse);
  for (let off = 0; off < bytes.length; off += 1024) {
    buffer += dec.decode(bytes.subarray(off, Math.min(off + 1024, bytes.length)), { stream: true });
    let idx; while ((idx = buffer.indexOf('\n')) !== -1) { const line = buffer.slice(0, idx).trim(); buffer = buffer.slice(idx + 1); if (line.startsWith('data:')) { try { JSON.parse(line.slice(5).trim()); } catch {} } }
  }
}, { calls: 20, unit: 'token', units: 5000, note: 'the loop body, without res.write' });

// ── B. The whole request through handleRequest ────────────────────────────────
const { handleRequest } = require('../server/index.cjs');
async function request(url, { method = 'GET', headers = {}, body = '' } = {}) {
  const req = Readable.from(body ? [body] : []);
  req.url = url; req.method = method; req.headers = { host: 'localhost', ...headers };
  const chunks = []; const responseHeaders = {};
  const res = new Writable({ write(chunk, _e, cb) { chunks.push(Buffer.from(chunk)); cb(); } });
  res.statusCode = 200; res.headersSent = false;
  res.setHeader = (n, v) => { responseHeaders[n] = v; };
  res.writeHead = (status, next = {}) => { res.statusCode = status; res.headersSent = true; Object.assign(responseHeaders, next); return res; };
  const finished = new Promise((resolve, reject) => { res.once('finish', resolve); res.once('error', reject); });
  await handleRequest(req, res);
  await finished;
  return { status: res.statusCode, headers: responseHeaders, text: Buffer.concat(chunks).toString('utf8') };
}
const admin = { authorization: 'Bearer profile-token', origin: 'http://localhost', 'content-type': 'application/json' };

function streamingResponse(tokens, paceMs = 0) {
  return new Response(new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      for (let i = 0; i < tokens; i++) {
        controller.enqueue(enc.encode('data: ' + JSON.stringify({ choices: [{ delta: { content: words[i % words.length] + ' ' } }] }) + '\n\n'));
        if (paceMs) await new Promise((r) => setTimeout(r, paceMs));
      }
      controller.enqueue(enc.encode('data: ' + JSON.stringify({ choices: [], usage: { prompt_tokens: 900, completion_tokens: tokens, total_tokens: 900 + tokens }, timings: { predicted_per_second: paceMs ? 1000 / paceMs : 0 } }) + '\n\n'));
      controller.enqueue(enc.encode('data: [DONE]\n\n'));
      controller.close();
    },
  }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

async function measureRequest(section, name, fn, { calls = 1, unit, units, note } = {}) {
  const cpu0 = process.cpuUsage(); const t0 = performance.now();
  for (let i = 0; i < calls; i++) await fn();
  const wallMs = performance.now() - t0; const cpu = process.cpuUsage(cpu0);
  record(section, name, { calls, wallMs, cpuMs: (cpu.user + cpu.system) / 1000, unit, units: units ? units * calls : undefined, note });
}

(async () => {
  const setupCode = fs.readFileSync(path.join(dataDir, 'first-run-setup-code'), 'utf8').trim();
  const setup = await request('/api/setup/complete', { method: 'POST', headers: { origin: 'http://localhost' }, body: JSON.stringify({ setupCode, publicOrigin: 'http://localhost', username: 'admin', displayName: 'Admin', password: 'synthetic profile password' }) });
  if (setup.status !== 201) throw new Error('setup failed: ' + setup.text);
  const created = await request('/api/projects', { method: 'POST', headers: admin, body: JSON.stringify({ name: 'Profile', model: 'model-9b' }) });
  const projectId = JSON.parse(created.text).id;
  const originalFetch = globalThis.fetch;
  const chat = (tokens, paceMs, history = []) => async () => {
    globalThis.fetch = async (url, opts) => {
      if (!String(url).endsWith('/v1/chat/completions')) return new Response('{}', { status: 404 });
      if (JSON.parse(opts.body).stream) return streamingResponse(tokens, paceMs);
      // The compaction summariser (a long history) and any non-streaming retry.
      return Response.json({ choices: [{ finish_reason: 'stop', message: { content: prose(200) } }] });
    };
    const r = await request('/api/chat', { method: 'POST', headers: admin, body: JSON.stringify({ projectId, chatId: 'profile-chat', message: prose(40), history }) });
    if (!/"type":"done"/.test(r.text)) throw new Error('chat did not finish: ' + r.text.slice(0, 300));
    return r;
  };
  try {
    await measureRequest('B', 'GET /api/workspace (auth + JSON)', () => request('/api/workspace', { headers: admin }), { calls: 300, note: 'sqlite session lookup + serialise' });
    await measureRequest('B', 'POST /api/chat: 1000 tokens, upstream instant', chat(1000, 0), { calls: 5, unit: 'token', units: 1000, note: 'all of Node: prompt, context, SSE in, SSE out' });
    await measureRequest('B', 'POST /api/chat: 1000 tokens, 200-message history', chat(1000, 0, history), { calls: 5, unit: 'token', units: 1000, note: 'same, with a long transcript to measure' });
    await measureRequest('B', 'POST /api/chat: 100 tokens paced at 14 tok/s', chat(100, 71), { calls: 1, unit: 'token', units: 100, note: 'wall = the engine; cpu = Node share' });
  } finally {
    globalThis.fetch = originalFetch;
  }

  // ── Report ──
  if (JSON_OUT) { console.log(JSON.stringify({ node: process.version, platform: `${os.platform()} ${os.arch()} ${os.cpus()[0]?.model || ''}`, rows }, null, 2)); }
  else {
    console.log(`node ${process.version} on ${os.platform()} ${os.arch()} (${os.cpus()[0]?.model || ''})\n`);
    console.log('| # | hot path | calls | wall ms total | cpu ms total | cpu per unit | note |');
    console.log('|---|---|---:|---:|---:|---:|---|');
    for (const r of rows) console.log(`| ${r.section} | ${r.name} | ${r.calls} | ${r.wallMs.toFixed(1)} | ${r.cpuMs.toFixed(1)} | ${r.perUnitUs >= 1000 ? (r.perUnitUs / 1000).toFixed(2) + ' ms' : r.perUnitUs.toFixed(1) + ' µs'} / ${r.unit} | ${r.note} |`);
  }
  fs.rmSync(dataDir, { recursive: true, force: true });
  process.exit(0);
})().catch((err) => { console.error(err); fs.rmSync(dataDir, { recursive: true, force: true }); process.exit(1); });
