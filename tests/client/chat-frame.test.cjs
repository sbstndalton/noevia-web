'use strict';
// #738: the suggested-frame confirm row. Chip model, the remove/edit/dismiss reducer, the accepted
// frame and where accepting puts the chat. Synthetic projects and tags only.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const read = (file) => fs.readFileSync(path.join(__dirname, '../..', file), 'utf8');
const load = (file) => { const exports = {}; vm.runInNewContext(ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports, require }); return exports; };
const { startDraft, frameChips, frameDraftReducer, acceptedFrame, acceptPlan, parseTags, cleanTag, MAX_FRAME_TAGS, chatDestinationIds, chatDestinations } = load('src/chat-frame.ts');

const projects = [{ id: 'p-trip', name: 'Synthetic trip' }, { id: 'p-work', name: 'Synthetic work' }];
const suggestion = { projectId: 'p-trip', kind: 'search', tags: ['flights', '#budget'], links: ['c1', 'c2'], confirmed: false, source: 'suggested' };
const plain = (v) => JSON.parse(JSON.stringify(v));

test('a suggestion becomes an idle, unconfirmed draft; anything unusable gives no row', () => {
  const draft = startDraft(suggestion, projects.map((p) => p.id));
  assert.deepEqual(plain(draft), { frame: { projectId: 'p-trip', kind: 'search', tags: ['flights', 'budget'], links: ['c1', 'c2'], confirmed: false, source: 'suggested' }, status: 'idle' });
  assert.equal(startDraft(null, []), null);
  assert.equal(startDraft({ ...suggestion, kind: 'chat' }, ['p-trip']), null, 'an unknown kind is not a frame');
  assert.equal(startDraft([suggestion], ['p-trip']), null);
  assert.equal(startDraft({ ...suggestion, projectId: 'someone-elses' }, ['p-trip']).frame.projectId, null, 'a project the person does not have is dropped');
  assert.equal(startDraft({ ...suggestion, confirmed: true, source: 'user' }, ['p-trip']).frame.confirmed, false, 'a suggestion is never pre-confirmed');
});

test('chips read project, kind, each tag, then N related, and skip what is empty', () => {
  const { frame } = startDraft(suggestion, ['p-trip']);
  assert.deepEqual(plain(frameChips(frame, projects)), [
    { id: 'project', type: 'project', projectId: 'p-trip', label: 'Synthetic trip' },
    { id: 'kind', type: 'kind', kind: 'search' },
    { id: 'tag:flights', type: 'tag', tag: 'flights' },
    { id: 'tag:budget', type: 'tag', tag: 'budget' },
    { id: 'links', type: 'links', count: 2 },
  ]);
  assert.deepEqual(plain(frameChips({ ...frame, projectId: null, tags: [], links: [] }, projects)), [{ id: 'kind', type: 'kind', kind: 'search' }]);
  assert.deepEqual(plain(frameChips({ ...frame, projectId: 'gone' }, projects)).map((c) => c.id), ['kind', 'tag:flights', 'tag:budget', 'links'], 'a project deleted meanwhile shows no chip');
});

test('remove drops one chip at a time; the kind cannot be removed', () => {
  let draft = startDraft(suggestion, ['p-trip']);
  draft = frameDraftReducer(draft, { type: 'removeTag', tag: 'flights' });
  assert.deepEqual(plain(draft.frame.tags), ['budget']);
  draft = frameDraftReducer(draft, { type: 'removeProject' });
  assert.equal(draft.frame.projectId, null);
  draft = frameDraftReducer(draft, { type: 'removeLinks' });
  assert.deepEqual(plain(draft.frame.links), []);
  assert.equal(draft.frame.kind, 'search');
  assert.deepEqual(plain(frameChips(draft.frame, projects)).map((c) => c.id), ['kind', 'tag:budget']);
});

test('edit picks a project and takes tags as free text', () => {
  let draft = startDraft(suggestion, ['p-trip', 'p-work']);
  draft = frameDraftReducer(draft, { type: 'setProject', projectId: 'p-work' });
  assert.equal(draft.frame.projectId, 'p-work');
  draft = frameDraftReducer(draft, { type: 'setProject', projectId: '' });
  assert.equal(draft.frame.projectId, null, 'No project');
  draft = frameDraftReducer(draft, { type: 'setTags', text: '#plans, travel  plans #two words' });
  assert.deepEqual(plain(draft.frame.tags), ['plans', 'travel', 'two', 'words']);
  assert.deepEqual(plain(parseTags('')), []);
  assert.equal(parseTags(Array.from({ length: 30 }, (_, i) => `t${i}`).join(' ')).length, MAX_FRAME_TAGS);
  assert.equal(cleanTag('##' + 'x'.repeat(100)).length, 64);
});

test('dismiss hides the row and saves nothing; edits wait while a save is in flight; a failed save keeps the draft', () => {
  const draft = startDraft(suggestion, ['p-trip']);
  assert.equal(frameDraftReducer(draft, { type: 'dismiss' }), null);
  assert.equal(frameDraftReducer(null, { type: 'removeProject' }), null);
  // App's accept path sets these statuses directly on the draft (acceptFrame); the reducer only
  // has to respect them.
  const saving = { ...draft, status: 'saving' };
  assert.equal(frameDraftReducer(saving, { type: 'removeTag', tag: 'flights' }), saving, 'no edit lands mid-save');
  const failed = { ...draft, status: 'error' };
  assert.deepEqual(plain(frameDraftReducer(failed, { type: 'removeProject' }).frame.tags), plain(draft.frame.tags), 'nothing the person chose is lost');
  assert.equal(frameDraftReducer(failed, { type: 'removeLinks' }).status, 'idle', 'editing again clears the error');
});

test('accept confirms as the user; the chat moves only into a different, named project', () => {
  const { frame } = startDraft(suggestion, ['p-trip']);
  const accepted = acceptedFrame(frame);
  assert.equal(accepted.confirmed, true);
  assert.equal(accepted.source, 'user');
  assert.equal(frame.confirmed, false, 'the draft itself is not mutated');
  assert.deepEqual(plain(acceptPlan(accepted, null)), { move: true, projectId: 'p-trip' });
  assert.deepEqual(plain(acceptPlan(accepted, 'p-work')), { move: true, projectId: 'p-trip' });
  assert.deepEqual(plain(acceptPlan(accepted, 'p-trip')), { move: false, projectId: 'p-trip' });
  assert.deepEqual(plain(acceptPlan({ ...accepted, projectId: null }, 'p-work')), { move: false, projectId: 'p-work' }, 'a removed project leaves the chat where it is');
});

test('App asks for a frame only on a new chat, behind the flag, without awaiting it in the send path', () => {
  const app = read('src/App.tsx');
  assert.match(app, /framingOn\.current = featureFlags\.chatFraming === true/);
  assert.match(app, /if \(framingOn\.current && existing\.length === 0 && !framingAsked\.current\.has\(chatId\)\)/);
  assert.match(app, /void suggestFrameRef\.current\(chatId, text\)/, 'fire and forget: the reply never waits for it');
  assert.match(app, /moveChatToProject\(chatId, plan\.projectId, frame\)/, 'accept goes through the one move path');
});

test('a suggestion naming a Code-only, Cowork-only or archived project gets no project (#810)', () => {
  const mine = [{ id: 'p-chat', name: 'Chat', modes: ['chat', 'code'] }, { id: 'p-legacy', name: 'Legacy' }, { id: 'p-empty', name: 'Empty', modes: [] },
    { id: 'p-code', name: 'Code', modes: ['code'] }, { id: 'p-cowork', name: 'Cowork', modes: ['cowork'] }, { id: 'p-old', name: 'Old', modes: ['chat'], archived: true }];
  const ids = chatDestinationIds(mine);
  assert.deepEqual(plain(ids), ['p-chat', 'p-legacy', 'p-empty'], 'absent or empty modes read as Chat, as on the server');
  assert.deepEqual(plain(chatDestinations(mine).map((p) => p.name)), ['Chat', 'Legacy', 'Empty'], 'the Edit picker list keeps the project objects');
  for (const id of ['p-code', 'p-cowork', 'p-old']) assert.equal(startDraft({ ...suggestion, projectId: id }, ids).frame.projectId, null, id);
  assert.equal(startDraft({ ...suggestion, projectId: 'p-chat' }, ids).frame.projectId, 'p-chat');
  // App.tsx hands startDraft exactly this filter, not every project id.
  assert.match(read('src/App.tsx'), /startDraft\(suggestion, chatDestinationIds\(projectsRef\.current\)\)/);
  // ...and the Edit picker offers only the same projects.
  assert.match(read('src/App.tsx'), /<FrameChips draft=\{frameDrafts\[view\.chatId\]\} projects=\{chatDestinations\(projects\)\.map/);
});
