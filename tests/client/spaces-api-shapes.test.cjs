'use strict';
// sbstndalton/noevia#2446: the client reads the exact JSON the native Spaces routes answer (sbstndalton/noevia-rs#445,
// "Routes" and "Responses"), and sends the bodies they accept. The sample bodies below are that PR's shapes.
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./spaces-load.cjs');
const plain = (o) => JSON.parse(JSON.stringify(o));

function apiWith(answer) {
  const sent = [];
  const apiFetch = async (url, init = {}) => {
    sent.push({ url, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : undefined });
    const { status = 200, body } = answer(url, init);
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  return { api: load('spaces-api.ts', { './api': { apiFetch } }), sent };
}
const row = { id: '3f2b8c1e-0d4a-4c5e-9a77-1b2c3d4e5f60', title: 'QA page', version: 'a'.repeat(64), bytes: 4, createdAt: 1, updatedAt: 2, savedBy: 'you' };

test('lists and single items are read from their envelopes', async () => {
  const { api } = apiWith((url, init) => {
    if (url === '/api/spaces' && init.method === 'GET') return { body: { revision: 3, spaces: [{ id: 's1', name: 'QA', createdAt: 1, updatedAt: 2 }] } };
    if (url === '/api/spaces') return { status: 201, body: { revision: 4, space: { id: 's2', name: 'New', createdAt: 1, updatedAt: 1 } } };
    if (url.endsWith('/pages?limit=100')) return { body: { pages: [row], truncated: true, total: 900 } };
    if (url.endsWith(`/pages/${row.id}`)) return { body: { page: row, content: 'text' } };
    return { status: 404, body: { error: 'Not found', code: 'not_found' } };
  });
  assert.deepEqual(plain(await api.listSpaces()), { revision: 3, spaces: [{ id: 's1', name: 'QA', createdAt: 1, updatedAt: 2 }] });
  assert.equal((await api.createSpace('New')).id, 's2');
  const pages = await api.listPages('s1');
  assert.equal(pages.truncated, true);
  assert.equal(pages.pages[0].version, row.version);
  assert.deepEqual(plain(await api.readPage('s1', row.id)), { ...row, content: 'text' });
});

test('page writes read `{page}` and send the revision rule', async () => {
  const { api, sent } = apiWith((url, init) => (init.method === 'POST' ? { status: 201, body: { page: row } } : { body: { page: { ...row, version: 'b'.repeat(64) }, changed: true } }));
  assert.equal((await api.createPage('s1', 'QA page')).id, row.id);
  assert.deepEqual(plain(sent[0]), { url: '/api/spaces/s1/pages', method: 'POST', body: { title: 'QA page', content: '' } });
  const saved = await api.writePage('s1', row.id, { title: 'QA page', content: 'x', version: row.version });
  assert.equal(saved.version, 'b'.repeat(64));
  assert.deepEqual(plain(sent[1].body), { title: 'QA page', content: 'x', version: row.version });
});

test('deletes: a Space carries the list revision and withPages only when confirmed; a page carries nothing', async () => {
  const { api, sent } = apiWith(() => ({ body: { ok: true } }));
  await api.deleteSpace('s1', 7, false);
  await api.deleteSpace('s1', 8, true);
  await api.deletePage('s1', row.id);
  assert.deepEqual(plain(sent.map((s) => [s.method, s.body])), [['DELETE', { revision: 7 }], ['DELETE', { revision: 8, withPages: true }], ['DELETE', null]]);
  await api.renameSpace('s1', 'Renamed', 9).catch(() => undefined);
  assert.deepEqual(plain(sent[3].body), { name: 'Renamed', revision: 9 });
});

test('a 409 carries the code and, for a page, the current version', async () => {
  const { api } = apiWith(() => ({ status: 409, body: { error: 'Page changed', code: 'stale_revision', version: 'c'.repeat(64) } }));
  await assert.rejects(api.writePage('s1', row.id, { title: 't', content: 'c', version: 'v' }), (e) => e.status === 409 && e.code === 'stale_revision' && e.version === 'c'.repeat(64));
});

test('a malformed body is an error, never a crash', async () => {
  for (const body of [null, {}, { spaces: 'x' }, { revision: 1, spaces: [{ id: 1 }] }]) {
    const { api } = apiWith(() => ({ body }));
    await assert.rejects(api.listSpaces(), /invalid/i);
  }
  const { api } = apiWith(() => ({ body: { page: row } }));
  await assert.rejects(api.readPage('s1', row.id), /invalid/i, 'a page read without its text');
});
