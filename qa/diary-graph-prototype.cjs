'use strict';
// Issue #275 offline experiment. Synthetic inputs only; never imported by production code.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { performance } = require('node:perf_hooks');

function loadMarkdown() {
  const file = path.join(__dirname, '../src/diary-markdown.ts');
  const module = { exports: {} };
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  vm.runInNewContext(js, { module, exports: module.exports, require() { throw Error('Unexpected parser dependency'); } }, { filename: file });
  return module.exports;
}
const markdown = loadMarkdown();
const { markdownFileLinks, markdownWikiLinks, resolveMarkdownPath, wikiLinkCandidates } = markdown;

function targets(file, root) {
  const out = new Set();
  for (const link of markdownFileLinks(file.content)) {
    const target = resolveMarkdownPath(file.path, link.href);
    if (target && target !== file.path && target.startsWith(`${root}/`)) out.add(target);
  }
  for (const link of markdownWikiLinks(file.content)) {
    // The shipped backlink scan counts wiki embeds as incoming references.
    if (!link.target) continue;
    for (const target of wikiLinkCandidates(file.path, root, link.target)) {
      if (target !== file.path && target.startsWith(`${root}/`)) out.add(target);
    }
  }
  return out;
}

class PrototypeIndex {
  constructor(root = 'Diary', { maxFiles = 5000, maxEdges = 25000 } = {}) {
    this.root = root; this.maxFiles = maxFiles; this.maxEdges = maxEdges; this.tenants = new Map();
  }
  tenant(id) {
    if (!this.tenants.has(id)) this.tenants.set(id, { files: new Map(), incoming: new Map(), tombstones: new Map(), generation: 0, edgeCount: 0 });
    return this.tenants.get(id);
  }
  validPath(filePath) {
    return typeof filePath === 'string' && filePath.startsWith(`${this.root}/`) && filePath.endsWith('.md') &&
      !filePath.split('/').some(part => !part || part === '.' || part === '..' || part.startsWith('.'));
  }
  upsert(tenantId, file) {
    if (!tenantId || !Number.isSafeInteger(file.revision) || file.revision < 1 ||
      typeof file.content !== 'string' || Buffer.byteLength(file.content) > 512 * 1024 ||
      !this.validPath(file.path)) throw Error('Invalid tenant or path');
    const state = this.tenant(tenantId);
    const previous = state.files.get(file.path);
    if (file.revision <= Math.max(previous?.revision || 0, state.tombstones.get(file.path) || 0))
      throw Error('Stale or conflicting source revision');
    const out = targets(file, this.root);
    const projectedEdges = state.edgeCount - (previous?.out.size || 0) + out.size;
    if (state.files.size + (previous ? 0 : 1) > this.maxFiles || projectedEdges > this.maxEdges) throw Error('Index capacity exceeded');
    for (const target of previous?.out || []) {
      const sources = state.incoming.get(target);
      sources.delete(file.path);
      if (!sources.size) state.incoming.delete(target);
    }
    state.files.set(file.path, { revision: file.revision, out }); // No content copied into index.
    state.tombstones.delete(file.path);
    state.edgeCount = projectedEdges;
    for (const target of out) {
      if (!state.incoming.has(target)) state.incoming.set(target, new Set());
      state.incoming.get(target).add(file.path);
    }
    return ++state.generation;
  }
  remove(tenantId, filePath, revision) {
    if (!tenantId || !this.validPath(filePath)) throw Error('Invalid tenant or path');
    const state = this.tenant(tenantId), previous = state.files.get(filePath);
    if (!Number.isSafeInteger(revision) || revision < 1 ||
      revision <= Math.max(previous?.revision || 0, state.tombstones.get(filePath) || 0))
      throw Error('Stale or conflicting source revision');
    if (!state.tombstones.has(filePath) && state.tombstones.size >= this.maxFiles) throw Error('Index capacity exceeded; rebuild required');
    for (const target of previous?.out || []) {
      const sources = state.incoming.get(target);
      sources.delete(filePath);
      if (!sources.size) state.incoming.delete(target);
    }
    state.files.delete(filePath); // Trash is absent from the active graph.
    state.tombstones.set(filePath, revision);
    state.edgeCount -= previous?.out.size || 0;
    return ++state.generation;
  }
  rebuild(tenantId, files, { authoritative = false } = {}) {
    // The prototype cannot verify a Diary source watermark. Callers must obtain
    // a complete authoritative snapshot first; this flag is not a security proof.
    if (!authoritative) throw Error('Authoritative source snapshot required');
    const next = new PrototypeIndex(this.root, { maxFiles: this.maxFiles, maxEdges: this.maxEdges });
    for (const file of files) next.upsert(tenantId, file);
    const state = next.tenant(tenantId);
    state.generation = (this.tenants.get(tenantId)?.generation || 0) + 1;
    this.tenants.set(tenantId, state); // Publish only a complete validated snapshot.
    return state.generation;
  }
  query(tenantId, filePath, { limit = 30, expectedGeneration } = {}) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw Error('Invalid limit');
    const state = this.tenants.get(tenantId);
    if (!state?.files.has(filePath)) return { status: 'missing', generation: state?.generation || 0, nodes: [], partial: false };
    if (expectedGeneration !== undefined && expectedGeneration !== state.generation)
      return { status: 'stale', generation: state.generation, nodes: [], partial: false };
    const out = state.files.get(filePath).out;
    const incoming = state.incoming.get(filePath) || new Set();
    const ids = [...new Set([...out, ...incoming])].filter(id => state.files.has(id)).sort();
    return { status: 'ok', generation: state.generation,
      nodes: ids.slice(0, limit).map(id => ({ id, relation: out.has(id) && incoming.has(id) ? 'both' : out.has(id) ? 'out' : 'in' })),
      partial: ids.length > limit, hidden: Math.max(0, ids.length - limit) };
  }
  counts(tenantId) {
    const state = this.tenant(tenantId);
    return { files: state.files.size, edges: state.edgeCount,
      // Deterministic string payload only, not a claim about JavaScript heap overhead.
      keyBytes: [...state.files].reduce((n, [name, file]) => n + Buffer.byteLength(name) + [...file.out].reduce((sum, target) => sum + Buffer.byteLength(target), 0), 0) };
  }
}

function scanBacklinks(files, target, root = 'Diary') {
  return files.filter(file => targets(file, root).has(target)).map(file => file.path).sort();
}
function corpus(size) {
  return Array.from({ length: size }, (_, i) => {
    const current = `n${String(i).padStart(5, '0')}.md`;
    const next = `n${String((i + 1) % size).padStart(5, '0')}.md`;
    const hub = 'n00000.md';
    return { path: `Diary/${current}`, revision: 1,
      content: `# Synthetic ${i}\n[Next](${next})\n[[${hub.slice(0, -3)}#section|Hub]]\n\`[ignored](secret.md)\`\n` };
  });
}
function measured(fn) { const start = performance.now(); const result = fn(); return { ms: +(performance.now() - start).toFixed(3), result }; }
function benchmark() {
  const rows = [];
  for (const size of [40, 400, 2000]) {
    const files = corpus(size), index = new PrototypeIndex();
    const build = measured(() => { for (const file of files) index.upsert('tenant-a', file); });
    const target = 'Diary/n00000.md';
    const scan = measured(() => scanBacklinks(files, target));
    const query = measured(() => index.query('tenant-a', target, { limit: 100 }));
    const indexedSources = [...(index.tenant('tenant-a').incoming.get(target) || [])].sort();
    if (JSON.stringify(scan.result) !== JSON.stringify(indexedSources)) throw Error('Scan/index parity failed');
    const update = measured(() => index.upsert('tenant-a', { ...files[1], revision: 2, content: '# Corrected; no links.' }));
    const rebuild = measured(() => index.rebuild('tenant-a', files, { authoritative: true }));
    rows.push({ size, buildMs: build.ms, fullScanMs: scan.ms, indexQueryMs: query.ms,
      updateMs: update.ms, rebuildMs: rebuild.ms, ...index.counts('tenant-a'), queryPartial: query.result.partial,
      scanMatchesIndexed: true });
  }
  return rows;
}

if (require.main === module) console.log(JSON.stringify({ experiment: 'synthetic diary graph #275', rows: benchmark() }, null, 2));
module.exports = { PrototypeIndex, targets, scanBacklinks, corpus, benchmark, markdown };
