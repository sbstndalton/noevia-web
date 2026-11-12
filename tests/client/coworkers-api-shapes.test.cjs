'use strict';
// sbstndalton/noevia#2446: the client reads the exact JSON of the native coworker routes (sbstndalton/noevia-rs#445):
// lists `{revision, specialists}`, one record `{revision, specialist}`; PATCH and DELETE carry the list revision.
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
  const spaces = load('spaces-api.ts', { './api': { apiFetch } });
  return { api: load('specialists-api.ts', { './spaces-api': spaces }), sent, spaces };
}
const rec = { id: 'c1', name: 'QA Researcher', glyph: '🔎', tint: 'info', brief: 'Be brief.', projectId: null, chatId: null, spaces: ['s1'], defaultSpace: 's1', createdAt: 1, updatedAt: 2 };

test('a list and a record are read from their envelopes; a null chat stays null', async () => {
  const { api } = apiWith((url) => (url === '/api/specialists' ? { body: { revision: 4, specialists: [rec] } } : { body: { revision: 5, specialist: { ...rec, chatId: 'chat-1', projectId: 'specialist-1', toolboxes: ['files'] } } }));
  const list = await api.listSpecialists();
  assert.equal(list.revision, 4);
  assert.equal(list.specialists[0].chatId, null);
  assert.equal('toolboxes' in list.specialists[0], false, 'no tools field from a server without it');
  const one = await api.readSpecialist('c1');
  assert.equal(one.revision, 5);
  assert.equal(one.specialist.chatId, 'chat-1');
  assert.deepEqual(plain(one.specialist.toolboxes), ['files']);
});

test('create sends the person\'s fields; patch and delete carry the revision', async () => {
  const { api, sent } = apiWith((url, init) => (init.method === 'POST' ? { status: 201, body: { revision: 1, specialist: rec } } : { body: { revision: 6, specialist: rec, ok: true } }));
  await api.createSpecialist({ name: 'QA Researcher', glyph: '🔎', tint: 'info', brief: '', spaces: [], defaultSpace: null });
  assert.deepEqual(plain(sent[0]), { url: '/api/specialists', method: 'POST', body: { name: 'QA Researcher', glyph: '🔎', tint: 'info', brief: '', spaces: [], defaultSpace: null } });
  await api.patchSpecialist('c1', 5, { name: 'New name', defaultSpace: null });
  assert.deepEqual(plain(sent[1].body), { revision: 5, name: 'New name', defaultSpace: null });
  await api.deleteSpecialist('c1', 6);
  assert.deepEqual(plain(sent[2]), { url: '/api/specialists/c1', method: 'DELETE', body: { revision: 6 } });
});

test('a stale write is a 409 carrying the code and the current revision', async () => {
  const { api } = apiWith(() => ({ status: 409, body: { error: 'Changed since you loaded it', code: 'stale_revision', revision: 9 } }));
  await assert.rejects(api.patchSpecialist('c1', 5, { name: 'x' }), (e) => e.status === 409 && e.code === 'stale_revision' && e.revision === 9);
});

test('malformed answers are errors, never a crash', async () => {
  for (const body of [null, {}, { specialists: 'x' }, { revision: 1, specialists: [{ id: 3 }] }]) {
    const { api } = apiWith(() => ({ body }));
    await assert.rejects(api.listSpecialists(), /invalid/i);
  }
  const { api } = apiWith(() => ({ body: { revision: 1 } }));
  await assert.rejects(api.readSpecialist('c1'), /invalid/i);
});
