'use strict';
// #1551: the server streams a `context` event with the context meter after each tool round (and at
// prep). The meter counts the round's tool output, which the client cannot see. The live meter is
// taken from that event, and the prose already measured is not counted a second time in ChatContext's
// extra. Synthetic fixtures only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function load(rel) {
  const exports = {};
  const out = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../../src', rel), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  new Function('exports', 'require', 'module', 'TextEncoder', out)(exports, () => { throw new Error('no imports expected at runtime'); }, { exports }, TextEncoder);
  return exports;
}
const { contextMeterFromEvent, latestMeasurement, unmeasuredTokens, newerMeter } = load('context-meter.ts');
const bytes = (text) => new TextEncoder().encode(text).length;

// A server-shaped `context` event: the meter's fields at the top level (chat.cjs sends `{type:'context', ...meter}`).
const event = (over = {}) => ({
  type: 'context', model: 'synthetic-model', limit: 12288, limitSource: 'Configured backend context',
  used: 6400, reserve: 3072, safety: 1843, threshold: 7373, updatedAt: 1000,
  parts: [{ name: 'Messages & summary', tokens: 4200 }, { name: 'Tools', tokens: 2200 }],
  historyCount: 2, compactedAt: null, covered: 0, ...over,
});

test('a server context event becomes a meter with every field the client reads', () => {
  const meter = contextMeterFromEvent(event());
  assert.equal(meter.used, 6400);
  assert.equal(meter.limit, 12288);
  assert.equal(meter.threshold, 7373);
  assert.equal(meter.historyCount, 2);
  assert.equal(meter.compactedAt, null);
  assert.equal(meter.covered, 0);
  assert.deepEqual(meter.parts, [{ name: 'Messages & summary', tokens: 4200 }, { name: 'Tools', tokens: 2200 }]);
});

test('an event with no usable numbers is not a meter (it is ignored, not shown as zero)', () => {
  assert.equal(contextMeterFromEvent(event({ used: undefined })), null);
  assert.equal(contextMeterFromEvent(event({ used: 'many' })), null);
  assert.equal(contextMeterFromEvent(event({ limit: 0 })), null);
  assert.equal(contextMeterFromEvent(event({ parts: 'nope' })), null);
});

test('malformed parts are dropped, and the optional fields get safe defaults', () => {
  const meter = contextMeterFromEvent(event({ parts: [{ name: 'Tools', tokens: 5 }, { tokens: 1 }, null, { name: 'Bad', tokens: 'x' }], historyCount: undefined, covered: undefined }));
  assert.deepEqual(meter.parts, [{ name: 'Tools', tokens: 5 }]);
  assert.equal(meter.historyCount, 0);
  assert.equal(meter.covered, 0);
});

test('the reply a meter was measured for is the latest one, and only while no user turn follows it', () => {
  const measured = { meter: contextMeterFromEvent(event()), replyBytes: 0 };
  const current = [
    { id: 'u1', role: 'user', content: 'Q' },
    { id: 'r1', role: 'assistant', content: 'A', contextMeter: measured },
  ];
  assert.equal(latestMeasurement(current).index, 1);
  const followedByUser = [...current, { id: 'u2', role: 'user', content: 'next question' }];
  assert.equal(latestMeasurement(followedByUser), null, 'an older turn\'s meter is not the live one');
  assert.equal(latestMeasurement([{ id: 'u1', role: 'user', content: 'Q' }]), null);
});

test('during a tool turn only the prose written after the measurement is added, not the prose already counted', () => {
  const prose = 'Checking the notes now, one moment please.';
  const after = ' Found it.';
  const messages = [
    { id: 'u1', role: 'user', content: 'Which files mention HERON?' },
    { id: 'r1', role: 'assistant', content: prose, contextMeter: { meter: contextMeterFromEvent(event()), replyBytes: bytes(prose) } },
  ];
  const extraBefore = unmeasuredTokens(messages, undefined);
  assert.equal(extraBefore, 0, 'prose the event already measured is not counted again');
  messages[1] = { ...messages[1], content: prose + after };
  const extraAfter = unmeasuredTokens(messages, undefined);
  assert.equal(extraAfter, Math.ceil(bytes(after) / 3), 'only the new prose is counted');
});

test('without a measurement, extra falls back to every message after the server history count (the pre-#1551 rule)', () => {
  const messages = [
    { id: 'h1', role: 'user', content: 'older' },
    { id: 'h2', role: 'assistant', content: 'older answer' },
    { id: 'u1', role: 'user', content: 'new question' },
    { id: 'r1', role: 'assistant', content: 'new answer' },
  ];
  const expected = ['new question', 'new answer'].reduce((n, text) => n + Math.ceil(bytes(text) / 3) + 12, 0);
  assert.equal(unmeasuredTokens(messages, 2), expected);
});

test('a measured reply that is then replaced by Retry is no longer the live measurement', () => {
  const messages = [
    { id: 'u1', role: 'user', content: 'Q' },
    { id: 'r1', role: 'assistant', content: 'failed', error: true, contextMeter: { meter: contextMeterFromEvent(event()), replyBytes: 0 } },
    { id: 'u2', role: 'user', content: 'Q' },
  ];
  assert.equal(latestMeasurement(messages), null);
});

test('App stores each context event on the reply it belongs to, and ChatContext reads it there', () => {
  const app = fs.readFileSync(path.join(__dirname, '../../src/App.tsx'), 'utf8');
  assert.match(app, /if \(ev\.type === 'context'\) \{[\s\S]{0,400}?contextMeterFromEvent\(ev\)[\s\S]{0,400}?m\.id === replyId \? \{ \.\.\.m, contextMeter: \{ meter, replyBytes: utf8Bytes\(m\.content\) \} \}/);
  const chat = fs.readFileSync(path.join(__dirname, '../../src/components/ChatContext.tsx'), 'utf8');
  assert.match(chat, /from '\.\.\/context-meter'/);
  assert.match(chat, /const meter=newerMeter\(latestMeasurement\(messages\)\?\.meter\?\?null,fetched,streaming\);/, 'the live meter is the one measured for the streaming reply');
  assert.match(chat, /extra=unmeasuredTokens\(messages,meter\?\.historyCount\),/);
  assert.doesNotMatch(chat, /\.slice\(meter\?\.historyCount\?\?messages\.length\)\.reduce/, 'the old unconditional extra is gone');
});

test('the context meter is never saved with the transcript (it is not in the persisted field list)', () => {
  const app = fs.readFileSync(path.join(__dirname, '../../src/App.tsx'), 'utf8');
  const persist = app.slice(app.indexOf('const entries: HistoryEntry[] = msgs.map'), app.indexOf('const entries: HistoryEntry[] = msgs.map') + 900);
  assert.doesNotMatch(persist, /contextMeter/);
});

test('while a reply streams the measured meter is shown; once it ends the newer of the two is', () => {
  const measured = contextMeterFromEvent(event({ updatedAt: 2000, used: 7000 }));
  const fetched = contextMeterFromEvent(event({ updatedAt: 1000, used: 6400 }));
  assert.equal(newerMeter(measured, fetched, true), measured, 'mid-reply the fetched copy is stale');
  assert.equal(newerMeter(measured, fetched, false), measured, 'a measurement newer than the fetched one wins');
  const compacted = contextMeterFromEvent(event({ updatedAt: 3000, used: 2100 }));
  assert.equal(newerMeter(measured, compacted, false), compacted, 'a compaction after the reply is newer and wins');
  assert.equal(newerMeter(null, fetched, true), fetched, 'with no measurement the fetched meter is used, as before');
  assert.equal(newerMeter(measured, null, false), measured);
});
