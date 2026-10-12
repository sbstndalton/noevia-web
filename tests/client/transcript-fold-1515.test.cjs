'use strict';
// #1515: a second open tab that sends from a stale view saved its user message twice. The conflict merge
// holds the other tab's copy (which already contains our new turn) while a reply streams; folding that held
// copy in with the current transcript used to write our turn a second time. foldDeferredMerge must append
// only the turns added after the merge was built.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../../src/transcript-merge.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const mod = { exports: {} };
vm.runInNewContext(code, { exports: mod.exports, require: () => ({}) });
const { mergeTranscripts, foldDeferredMerge } = mod.exports;
const u = (content) => ({ role: 'user', content });
const a = (content) => ({ role: 'assistant', content });
// Arrays built inside the vm realm have another Array prototype; compare them as plain data.
const plain = (x) => JSON.parse(JSON.stringify(x));
const texts = (list) => plain(list.map(e => `${e.role}:${e.content}`));

test('the stale-tab case: the held merge already has our turn, and folding it in does not write that turn again', () => {
  // Server (other tab): earlier exchange plus its own question and answer. Ours (stale): the earlier
  // exchange plus our question, which the conflict save then merged into the server copy.
  const before = [u('q1'), a('ans1')];
  const theirs = [...before, u('other-q'), a('other-ans')];
  const ours = [...before, u('second-tab-check')];
  const deferred = { merged: mergeTranscripts(theirs, ours), ours };
  // The reply to our question finishes while the merge is held; the transcript is now ours + reply.
  const current = [...ours, a('OK')];
  // The old fold merged the held copy with the current transcript again.
  const oldFold = mergeTranscripts(deferred.merged, current);
  assert.deepEqual(texts(oldFold).filter(t => t === 'user:second-tab-check').length, 2, 'the old fold duplicated the user turn');
  const folded = foldDeferredMerge(deferred, current);
  assert.deepEqual(texts(folded), ['user:q1', 'assistant:ans1', 'user:other-q', 'assistant:other-ans', 'user:second-tab-check', 'assistant:OK']);
});

test('with nothing added since the merge, folding returns the merged copy unchanged', () => {
  const ours = [u('q1'), a('ans1'), u('again')];
  const deferred = { merged: [u('q1'), a('ans1'), u('other'), a('x'), u('again')], ours };
  assert.deepEqual(plain(foldDeferredMerge(deferred, [...ours])), plain(deferred.merged));
});

test('a transcript that changed an earlier turn since the merge falls back to a plain merge', () => {
  const ours = [u('q1'), a('ans1'), u('late')];
  const deferred = { merged: [u('q1'), a('ans1'), u('late'), a('theirs')], ours };
  const current = [u('q1-edited'), a('ans1'), u('late'), a('mine')];
  assert.deepEqual(plain(foldDeferredMerge(deferred, current)), plain(mergeTranscripts(deferred.merged, current)));
});

test('folding keeps both devices turns in order across two held merges', () => {
  const ours1 = [u('q1')];
  const deferred = { merged: [u('other-q1'), a('other-a1'), u('q1')], ours: ours1 };
  const current = [u('q1'), a('A1'), u('q2')];
  assert.deepEqual(texts(foldDeferredMerge(deferred, current)), ['user:other-q1', 'assistant:other-a1', 'user:q1', 'assistant:A1', 'user:q2']);
});

// #1516: the multi-tab sync adopts another tab's copy only when it is what is on screen plus newer turns.
const { savedCopyExtends } = mod.exports;
test('#1516 a saved copy with newer turns on top of what is shown is adopted', () => {
  assert.equal(savedCopyExtends([u('q1'), a('ans1')], [u('q1'), a('ans1'), u('other-q'), a('other-a')]), true);
  assert.equal(savedCopyExtends([], [u('q1')]), true, 'an empty view adopts a saved chat');
});

test('#1516 an equal, shorter or diverged saved copy is not adopted (the next save merges it)', () => {
  assert.equal(savedCopyExtends([u('q1'), a('ans1')], [u('q1'), a('ans1')]), false);
  assert.equal(savedCopyExtends([u('q1'), a('ans1'), u('mine')], [u('q1'), a('ans1')]), false);
  assert.equal(savedCopyExtends([u('q1'), a('mine')], [u('q1'), a('ans1'), u('other')]), false);
});

// The wiring in App.tsx: the held merge is folded (not re-merged), and the sync check runs only while idle and visible.
const appSrc = fs.readFileSync(path.join(__dirname, '../../src/App.tsx'), 'utf8');
test('#1515 App folds a held merge with foldDeferredMerge, and keeps the turns it was built from', () => {
  assert.match(appSrc, /const deferredMerges = useRef<Record<string, DeferredMerge>>\(\{\}\);/);
  assert.match(appSrc, /const folded = foldDeferredMerge\(deferred, next\);/);
  assert.doesNotMatch(appSrc, /mergeTranscripts\(deferred, next\)/, 'the held copy is no longer merged again with the current transcript');
  assert.match(appSrc, /const show = \(merged: HistoryEntry\[\], ours: HistoryEntry\[\]\) => \{/);
  assert.match(appSrc, /deferredMerges\.current\[chatId\] = \{ merged, ours \};/);
});

test('#1516 App checks the saved revision of an open chat every 15 s, only while visible and idle', () => {
  assert.match(appSrc, /const CHAT_SYNC_MS = 15_000;/);
  const effect = appSrc.slice(appSrc.indexOf('  const chatViewId = view.kind'), appSrc.indexOf('  // Lazily load a chat\'s persisted history'));
  assert.match(effect, /window\.setInterval\(check, CHAT_SYNC_MS\)/);
  assert.match(effect, /document\.visibilityState === 'hidden' \|\| busy\(\)/);
  assert.match(effect, /const busy = \(\) => sendingChats\.current\.has\(chatId\) \|\| \(savesInFlight\.current\[chatId\] \?\? 0\) > 0;/);
  assert.match(effect, /if \(!savedCopyExtends\(local, history\)\) return;/);
});
