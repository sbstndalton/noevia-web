'use strict';
// sbstndalton/noevia#2446: the Space page autosave state machine (src/page-autosave.ts), with a fake server.
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./spaces-load.cjs');
const { PageAutosave, AUTOSAVE_DELAY_MS } = load('page-autosave.ts');

const plain = (o) => JSON.parse(JSON.stringify(o));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const base = (over = {}) => ({ id: 'p1', version: 'v1', title: 'QA page', content: 'one', ...over });
const conflict = (version) => Object.assign(new Error('changed'), { status: 409, code: 'stale_revision', version });

function machine({ save, load: loadPage, delayMs = 15, timeoutMs, stored } = {}) {
  const calls = [];
  const local = { value: stored ?? null, writes: 0, clears: 0 };
  const a = new PageAutosave({
    delayMs, timeoutMs,
    save: save ?? (async (id, body) => { calls.push(body); return { version: `v${calls.length + 1}` }; }),
    load: loadPage ?? (async () => base({ version: 'theirs', content: 'their text', title: 'Their title' })),
    persist: (d) => { if (d) { local.value = d; local.writes++; } else { local.value = null; local.clears++; } },
  });
  return { a, calls, local };
}

test('the autosave delay is 1.5 seconds', () => { assert.equal(AUTOSAVE_DELAY_MS, 1500); });

test('an edit saves once after the delay, on the version it was based on, and ends saved', async () => {
  const { a, calls, local } = machine();
  a.receive(base());
  a.edit({ content: 'two' });
  assert.equal(a.getSnapshot().status, 'dirty');
  await wait(60);
  assert.deepEqual(plain(calls), [{ title: 'QA page', content: 'two', version: 'v1' }]);
  const s = a.getSnapshot();
  assert.equal(s.status, 'saved');
  assert.equal(s.base.version, 'v2');
  assert.equal(local.value, null, 'a successful save clears the device copy');
});

test('a burst of edits is one save of the last text', async () => {
  const { a, calls } = machine({ delayMs: 40 });
  a.receive(base());
  for (const c of ['a', 'ab', 'abc']) { a.edit({ content: c }); await wait(10); }
  await wait(120);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].content, 'abc');
});

test('typing while a save is in flight is saved next, on the new version', async () => {
  let release; const gate = new Promise((r) => { release = r; });
  const calls = [];
  const { a } = machine({ save: async (id, body) => { calls.push(body); if (calls.length === 1) await gate; return { version: `v${calls.length + 1}` }; } });
  a.receive(base());
  a.edit({ content: 'x' });
  await wait(40);
  assert.equal(a.getSnapshot().status, 'saving');
  a.edit({ content: 'xy' });
  release();
  await wait(80);
  assert.deepEqual(calls.map((c) => [c.content, c.version]), [['x', 'v1'], ['xy', 'v2']]);
  assert.equal(a.getSnapshot().status, 'saved');
});

test('a failed save keeps the draft on this device, shows failed, and does not retry by itself', async () => {
  let n = 0;
  const { a, local } = machine({ save: async () => { n++; throw new Error('offline'); } });
  a.receive(base());
  a.edit({ content: 'mine' });
  await wait(80);
  assert.equal(a.getSnapshot().status, 'error');
  assert.equal(n, 1);
  assert.deepEqual({ ...local.value }, { title: 'QA page', content: 'mine', baseVersion: 'v1' });
  assert.equal(a.getSnapshot().draft.content, 'mine');
});

test('retry after a failure saves; typing again also tries again', async () => {
  let fail = true; const calls = []; let served = base();
  const { a, local } = machine({
    save: async (id, body) => { calls.push(body); if (fail) throw new Error('offline'); served = base({ version: `v${calls.length + 1}`, content: body.content }); return { version: served.version }; },
    load: async () => served,
  });
  a.receive(base());
  a.edit({ content: 'mine' });
  await wait(60);
  fail = false;
  assert.equal(await a.flush(true), true);
  assert.equal(a.getSnapshot().status, 'saved');
  assert.equal(local.value, null);
  fail = true; a.edit({ content: 'again' }); await wait(60);
  assert.equal(a.getSnapshot().status, 'error');
  fail = false; a.edit({ content: 'again!' }); await wait(60);
  assert.equal(a.getSnapshot().status, 'saved');
});

test('a 409 is a conflict: nothing is overwritten, the draft is kept, no further save is attempted', async () => {
  let n = 0;
  const { a, local } = machine({ save: async () => { n++; throw conflict('v9'); } });
  a.receive(base());
  a.edit({ content: 'mine' });
  await wait(60);
  const s = a.getSnapshot();
  assert.equal(s.status, 'conflict');
  assert.equal(s.remoteVersion, 'v9');
  assert.equal(local.value.content, 'mine');
  a.edit({ content: 'mine, more' });
  await wait(60);
  assert.equal(n, 1, 'editing during a conflict never saves');
  assert.equal(a.getSnapshot().draft.content, 'mine, more');
  assert.equal(local.value.content, 'mine, more');
});

test('keep mine saves the draft on top of the version the 409 reported', async () => {
  const calls = [];
  const { a } = machine({ save: async (id, body) => { calls.push(body); if (calls.length === 1) throw conflict('v9'); return { version: 'v10' }; } });
  a.receive(base());
  a.edit({ content: 'mine' });
  await wait(60);
  assert.equal(await a.keepMine(), true);
  assert.deepEqual(plain(calls[1]), { title: 'QA page', content: 'mine', version: 'v9' });
  assert.equal(a.getSnapshot().status, 'saved');
  assert.equal(a.getSnapshot().base.version, 'v10');
});

test('keep mine reads the current version when the 409 did not carry one, and says so when it cannot', async () => {
  const calls = []; let loads = 0; let reachable = true;
  const { a } = machine({
    save: async (id, body) => { calls.push(body); if (calls.length === 1) throw conflict(undefined); return { version: 'v5' }; },
    load: async () => { loads++; if (!reachable) throw new Error('down'); return base({ version: 'v4', content: 'theirs' }); },
  });
  a.receive(base());
  a.edit({ content: 'mine' });
  await wait(60);
  reachable = false;
  assert.equal(await a.keepMine(), false);
  assert.equal(a.getSnapshot().status, 'conflict');
  assert.equal(a.getSnapshot().fault.kind, 'load-failed');
  reachable = true;
  assert.equal(await a.keepMine(), true);
  assert.equal(loads, 2);
  assert.equal(calls[1].version, 'v4');
});

test('take theirs reloads, replaces the draft and drops the device copy', async () => {
  const { a, local } = machine({ save: async () => { throw conflict('theirs'); } });
  a.receive(base());
  a.edit({ content: 'mine' });
  await wait(60);
  assert.equal(await a.takeTheirs(), true);
  const s = a.getSnapshot();
  assert.equal(s.status, 'saved');
  assert.deepEqual({ ...s.draft }, { title: 'Their title', content: 'their text' });
  assert.equal(s.base.version, 'theirs');
  assert.equal(local.value, null);
});

test('keep mine and take theirs do nothing outside a conflict', async () => {
  const { a } = machine();
  a.receive(base());
  assert.equal(await a.keepMine(), false);
  assert.equal(await a.takeTheirs(), false);
});

test('limits are checked before any request and the draft stays', async () => {
  const { a, calls, local } = machine();
  a.receive(base());
  a.edit({ title: '   ' });
  await wait(60);
  assert.equal(a.getSnapshot().status, 'error');
  assert.deepEqual({ ...a.getSnapshot().fault }, { kind: 'problem', problem: 'title-empty' });
  a.edit({ title: 'ok', content: 'x'.repeat(512 * 1024 + 1) });
  await wait(60);
  assert.deepEqual({ ...a.getSnapshot().fault }, { kind: 'problem', problem: 'too-large' });
  assert.equal(calls.length, 0);
  assert.equal(local.value.title, 'ok');
  a.edit({ content: 'small' });
  await wait(60);
  assert.equal(a.getSnapshot().status, 'saved');
  assert.equal(calls.length, 1);
});

test('a save that never answers ends as a timeout with the draft kept', async () => {
  const { a, local } = machine({ timeoutMs: 40, save: (id, body, signal) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))) });
  a.receive(base());
  a.edit({ content: 'slow' });
  await wait(120);
  assert.equal(a.getSnapshot().status, 'error');
  assert.equal(a.getSnapshot().fault.kind, 'timeout');
  assert.equal(local.value.content, 'slow');
});

test('a draft read back from this device on the same version resumes and saves', async () => {
  const { a, calls } = machine();
  a.receive(base(), { title: 'QA page', content: 'from device', baseVersion: 'v1' });
  assert.equal(a.getSnapshot().restored, true);
  assert.equal(a.getSnapshot().status, 'dirty');
  await wait(60);
  assert.equal(calls[0].content, 'from device');
});

test('a device draft based on an older version opens as a conflict and is never saved over the newer page', async () => {
  const { a, calls } = machine();
  a.receive(base({ version: 'v7', content: 'newer' }), { title: 'QA page', content: 'old draft', baseVersion: 'v1' });
  assert.equal(a.getSnapshot().status, 'conflict');
  assert.equal(a.getSnapshot().remoteVersion, 'v7');
  await wait(60);
  assert.equal(calls.length, 0);
  assert.equal(a.getSnapshot().draft.content, 'old draft');
});

test('a device draft equal to the page is dropped', () => {
  const { a, local } = machine({ stored: { x: 1 } });
  a.receive(base(), { title: 'QA page', content: 'one', baseVersion: 'v0' });
  assert.equal(a.getSnapshot().status, 'saved');
  assert.equal(local.value, null);
});

test('dirty says when leaving would lose something', async () => {
  const { a } = machine({ save: async () => { throw new Error('offline'); } });
  a.receive(base());
  assert.equal(a.dirty, false);
  a.edit({ content: 'x' });
  assert.equal(a.dirty, true);
  await wait(60);
  assert.equal(a.dirty, true, 'failed saves stay dirty');
});

test('leaving tries one last save of unsaved text; a deleted page is never saved or kept', async () => {
  const one = machine({ delayMs: 10000 });
  one.a.receive(base());
  one.a.edit({ content: 'last words' });
  one.a.leave();
  await wait(40);
  assert.equal(one.calls.length, 1);
  assert.equal(one.local.value, null);

  const two = machine({ delayMs: 10000 });
  two.a.receive(base());
  two.a.edit({ content: 'doomed' });
  two.a.discard();
  two.a.leave();
  await wait(40);
  assert.equal(two.calls.length, 0);
  assert.equal(two.local.value, null);
});

test('leaving mid-conflict keeps the draft on this device and saves nothing', async () => {
  let n = 0;
  const { a, local } = machine({ save: async () => { n++; throw conflict('v9'); } });
  a.receive(base());
  a.edit({ content: 'mine' });
  await wait(60);
  a.leave();
  await wait(30);
  assert.equal(n, 1, 'only the save that produced the conflict');
  assert.equal(local.value.content, 'mine');
});

test('a save whose answer never came, retried: if it had landed it is saved, not a false conflict', async () => {
  let puts = 0; let serverText = 'one';
  const { a, local } = machine({
    timeoutMs: 30,
    save: (id, body, signal) => { puts++; serverText = body.content; return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))); },
    load: async () => base({ version: 'v2', content: serverText }),
  });
  a.receive(base());
  a.edit({ content: 'mine' });
  await wait(100);
  assert.equal(a.getSnapshot().fault.kind, 'timeout');
  assert.equal(await a.flush(true), true, 'the write had landed');
  assert.equal(puts, 1, 'no second write');
  assert.equal(a.getSnapshot().status, 'saved');
  assert.equal(a.getSnapshot().base.version, 'v2');
  assert.equal(local.value, null);
});

test('after an unknown outcome, a page that moved on is a conflict, and one that did not is written again', async () => {
  let theirs = base({ version: 'v8', content: 'theirs' }); const calls = [];
  const { a } = machine({
    save: async (id, body) => { calls.push(body); if (calls.length === 1) throw new Error('network down'); return { version: 'v9' }; },
    load: async () => theirs,
  });
  a.receive(base());
  a.edit({ content: 'mine' });
  await wait(60);
  assert.equal(a.getSnapshot().status, 'error');
  await a.flush(true);
  assert.equal(a.getSnapshot().status, 'conflict');
  assert.equal(a.getSnapshot().remoteVersion, 'v8');
  assert.equal(calls.length, 1);
  // Same again, but nobody touched the page: the retry writes.
  const second = []; theirs = base();
  const m = machine({ save: async (id, body) => { second.push(body); if (second.length === 1) throw new Error('network down'); return { version: 'v9' }; }, load: async () => theirs });
  m.a.receive(base()); m.a.edit({ content: 'mine' }); await wait(60);
  assert.equal(await m.a.flush(true), true);
  assert.equal(second.length, 2);
});

test('keep mine writes even when the draft was edited back to the old base text', async () => {
  const calls = [];
  const { a } = machine({ save: async (id, body) => { calls.push(body); if (calls.length === 1) throw conflict('v9'); return { version: 'v10' }; } });
  a.receive(base());
  a.edit({ content: 'x' });
  await wait(60);
  a.edit({ content: 'one' });
  assert.equal(a.getSnapshot().status, 'conflict');
  assert.equal(await a.keepMine(), true);
  assert.equal(calls.length, 2, 'the server held another version, so mine is written');
  assert.deepEqual(plain(calls[1]), { title: 'QA page', content: 'one', version: 'v9' });
  assert.equal(a.getSnapshot().status, 'saved');
});

test('when the device cannot keep a copy the state says so, and says so again once it can', async () => {
  let works = false;
  const a = new PageAutosave({ delayMs: 15, save: async () => { throw new Error('offline'); }, load: async () => base(), persist: (d) => (d ? works : undefined) });
  a.receive(base());
  a.edit({ content: 'x' });
  await wait(60);
  assert.equal(a.getSnapshot().status, 'error');
  assert.equal(a.getSnapshot().keptOnDevice, false);
  works = true;
  a.edit({ content: 'xy' });
  assert.equal(a.getSnapshot().keptOnDevice, true);
});

test('a late save after leaving clears the device copy only if it is the text that was saved', async () => {
  const seen = [];
  const a = new PageAutosave({ delayMs: 10000, save: async (id, b) => ({ version: 'v2' }), load: async () => base(), persist: (d, saved) => { seen.push([d ? 'write' : 'clear', saved ? saved.content : null]); } });
  a.receive(base());
  a.edit({ content: 'last words' });
  a.leave();
  await wait(40);
  assert.deepEqual(seen.filter((s) => s[0] === 'clear' && s[1]), [['clear', 'last words']]);
});
