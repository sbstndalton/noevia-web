'use strict';
// #304: Settings' close/back must never land on a Settings-launched detour (Models & routing,
// Customise, Archived, Diary), or closing Settings from one just re-shows the detour and its own
// "back to Settings" affordance re-opens Settings — the loop the user hit.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const exports_ = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../../src/settings-nav.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: exports_ });
const { initialNavState, nextNavState, resolveSettingsClose, restoreNavState, persistedView, withoutChat, withoutProject } = exports_;

// vm.runInNewContext runs the module in a separate realm, so objects it constructs (state,
// resolveSettingsClose's result) have a different Object prototype than literals written in this
// file — deepStrictEqual treats that as unequal even when every field matches. Compare via JSON
// instead of object identity/prototype.
const j = (v) => JSON.stringify(v);

const chat = (id) => ({ kind: 'chat', chatId: id });
const models = (model) => ({ kind: 'models', model });

test('a direct navigation always becomes the new return target', () => {
  let state = initialNavState(chat('a'));
  state = nextNavState(state, chat('b'));
  assert.equal(j(state), j({ returnView: chat('b'), cameFromSettings: null }));
  state = nextNavState(state, { kind: 'project', id: 'p1' });
  assert.equal(j(state.returnView), j({ kind: 'project', id: 'p1' }));
});

test('a Settings-launched view is remembered, but never becomes the return target', () => {
  let state = initialNavState(chat('a'));
  state = nextNavState(state, models('gguf'), { fromSettingsSection: 'models' });
  assert.equal(j(state), j({ returnView: chat('a'), cameFromSettings: 'models' }));
  // Switching between two Settings-launched sections (e.g. Models -> a different model) still
  // does not disturb the original return target.
  state = nextNavState(state, models('other'), { fromSettingsSection: 'models' });
  assert.equal(j(state.returnView), j(chat('a')));
});

test('Settings close hands back the return target and forgets the detour, so a repeat never loops', () => {
  let state = initialNavState(chat('a'));
  state = nextNavState(state, models(), { fromSettingsSection: 'models' });
  const first = resolveSettingsClose(state);
  assert.equal(j(first.view), j(chat('a')));
  assert.equal(first.next.cameFromSettings, null);
  // A second close (nothing changed the view in between) still returns the same real view,
  // not the detour — this is the exact loop from #304.
  const second = resolveSettingsClose(first.next);
  assert.equal(j(second.view), j(chat('a')));
});

test('a view opened directly (not from Settings) can become the return target even if the same kind is Settings-launchable elsewhere', () => {
  // Archived chats opened from the sidebar, not from Settings: closing Settings later should
  // come back here.
  let state = initialNavState(chat('a'));
  state = nextNavState(state, { kind: 'archived' });
  assert.equal(j(state), j({ returnView: { kind: 'archived' }, cameFromSettings: null }));
  const { view } = resolveSettingsClose(state);
  assert.equal(j(view), j({ kind: 'archived' }));
});

test('three Back/close round trips through Models & routing never regress the return target', () => {
  let state = initialNavState(chat('start'));
  for (let i = 0; i < 3; i++) {
    state = nextNavState(state, models('m'), { fromSettingsSection: 'models' });
    const { view, next } = resolveSettingsClose(state);
    assert.equal(j(view), j(chat('start')), `iteration ${i}`);
    state = next;
  }
});

// #304 (HIGH, model review): a reload used to restore the app straight into a detour view with no
// return target recorded for it, so the very first Settings close resolved right back into the
// same detour, forever — reload turned the loop back on.
test('restoring straight into a detour (a reload mid-loop, or data written before this fix) resolves to the fresh fallback, not the detour', () => {
  const fresh = chat('fresh');
  const state = restoreNavState(models('m'), fresh);
  assert.equal(j(state), j({ returnView: fresh, cameFromSettings: null }));
  const { view } = resolveSettingsClose(state);
  assert.equal(j(view), j(fresh));
});

test('restoring into a real view is unaffected', () => {
  const state = restoreNavState(chat('a'), chat('fresh'));
  assert.equal(j(state), j({ returnView: chat('a'), cameFromSettings: null }));
});

// #304 (HIGH): what gets written as "last place" for the next reload must never itself be a
// detour Settings launched — otherwise the very next reload hits the case above again.
test('the persisted view is the return target while a Settings-launched detour is showing, and the view itself otherwise', () => {
  let state = initialNavState(chat('a'));
  state = nextNavState(state, models('m'), { fromSettingsSection: 'models' });
  assert.equal(j(persistedView(state, models('m'))), j(chat('a')));
  const direct = initialNavState({ kind: 'archived' });
  assert.equal(j(persistedView(direct, { kind: 'archived' })), j({ kind: 'archived' }));
});

// #304 (MED, model review): a deleted chat/project must never remain the return target, even when
// it is not the view on screen (Models & routing was opened from it, then it was deleted from
// Archived chats or another tab).
test('a deleted chat is dropped as the return target and replaced with the given fallback', () => {
  let state = initialNavState(chat('doomed'));
  state = nextNavState(state, models('m'), { fromSettingsSection: 'models' });
  state = withoutChat(state, 'doomed', chat('fresh'));
  assert.equal(j(state.returnView), j(chat('fresh')));
  assert.equal(state.cameFromSettings, 'models', 'the pending detour section is untouched');
  // A different chat's deletion never touches an unrelated return target.
  const other = withoutChat(initialNavState(chat('kept')), 'doomed', chat('fresh'));
  assert.equal(j(other.returnView), j(chat('kept')));
});

test('a deleted project is dropped as the return target, and so is any chat inside it', () => {
  const project = { kind: 'project', id: 'doomed' };
  assert.equal(j(withoutProject(initialNavState(project), 'doomed', { kind: 'projects' }).returnView), j({ kind: 'projects' }));
  const chatInProject = { kind: 'chat', chatId: 'c1', projectId: 'doomed' };
  assert.equal(j(withoutProject(initialNavState(chatInProject), 'doomed', { kind: 'projects' }).returnView), j({ kind: 'projects' }));
  // An unrelated project or a free chat (projectId null) is untouched.
  const unrelated = { kind: 'project', id: 'kept' };
  assert.equal(j(withoutProject(initialNavState(unrelated), 'doomed', { kind: 'projects' }).returnView), j(unrelated));
  const free = { kind: 'chat', chatId: 'c2', projectId: null };
  assert.equal(j(withoutProject(initialNavState(free), 'doomed', { kind: 'projects' }).returnView), j(free));
});
