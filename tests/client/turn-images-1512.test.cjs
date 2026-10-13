'use strict';
// #1512: a chat turn names the project image sources it attaches (`turnImageIds`). The server loads
// and describes only those, so a text, CSV, JSON or DOCX message sends `[]` and skips the vision pass.
// Pure rules are checked behaviourally on synthetic ids; the wiring (composer -> ChatView -> App ->
// streamChat, and Retry/Regenerate keeping the original message's ids) is checked at source level,
// the way the rest of tests/client does it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const src = (rel) => fs.readFileSync(path.join(__dirname, '../../src', rel), 'utf8');

function load(rel) {
  const exports = {};
  const out = ts.transpileModule(src(rel), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  new Function('exports', 'require', 'module', out)(exports, () => { throw new Error('no imports expected'); }, { exports });
  return exports;
}
const { addTurnImage, turnImageIdsToSend, TURN_IMAGE_CAP, turnImageId } = load('turn-images.ts');

test('the cap is the server\'s cap: 12 image sources per turn', () => {
  assert.equal(TURN_IMAGE_CAP, 12);
  assert.match(src('turn-images.ts'), /export const TURN_IMAGE_CAP = 12;/);
});

test('an id is usable only when it is a non-empty string of at most 80 characters', () => {
  assert.equal(turnImageId('img-synthetic-1'), 'img-synthetic-1');
  assert.equal(turnImageId('x'.repeat(80)), 'x'.repeat(80));
  assert.equal(turnImageId(''), null);
  assert.equal(turnImageId('x'.repeat(81)), null);
  assert.equal(turnImageId(42), null);
  assert.equal(turnImageId(undefined), null);
});

test('adding an image keeps it once and puts the newest last', () => {
  let ids = addTurnImage([], 'img-a');
  ids = addTurnImage(ids, 'img-b');
  ids = addTurnImage(ids, 'img-a');
  assert.deepEqual(ids, ['img-b', 'img-a']);
});

test('past the cap the oldest id goes, so the newest attachment is the one sent', () => {
  let ids = [];
  for (let i = 0; i < 14; i++) ids = addTurnImage(ids, `img-${i}`);
  assert.equal(ids.length, 12);
  assert.equal(ids[0], 'img-2');
  assert.equal(ids.at(-1), 'img-13');
});

test('an invalid id is ignored and never reaches the server', () => {
  assert.deepEqual(addTurnImage(['img-a'], ''), ['img-a']);
  assert.deepEqual(addTurnImage(['img-a'], 'x'.repeat(81)), ['img-a']);
});

test('what is sent is always an array: empty when the message attaches no images', () => {
  assert.deepEqual(turnImageIdsToSend(undefined), []);
  assert.deepEqual(turnImageIdsToSend(null), []);
  assert.deepEqual(turnImageIdsToSend([]), []);
});

test('what is sent drops invalid and repeated ids and stays within the cap', () => {
  assert.deepEqual(turnImageIdsToSend(['img-a', 'img-a', '', 7, 'img-b']), ['img-a', 'img-b']);
  const many = Array.from({ length: 20 }, (_, i) => `img-${i}`);
  const sent = turnImageIdsToSend(many);
  assert.equal(sent.length, 12);
  assert.equal(sent.at(-1), 'img-19');
});

test('the upload path reports an image\'s asset id only after a successful, readable upload', () => {
  const actions = src('components/ComposerActions.tsx');
  assert.match(actions, /onImageAttached\?: \(assetId: string\) => void;/);
  const body = actions.slice(actions.indexOf('export async function uploadAttachments'), actions.indexOf('/** True only for a drag carrying files'));
  const unreadableAt = body.indexOf('if (unreadable) { failures.push');
  const reportAt = body.indexOf('onImageAttached?.(');
  assert.ok(unreadableAt > 0 && reportAt > unreadableAt, 'the asset id is reported after the unreadable check, so a refused file is never attached');
  assert.match(body, /const \{ project, disabled, diary = false, chatOnly = false, onChanged, onBusy, onStatus, onImageAttached, onSaved \} = sink;/);
  assert.match(body, /if \(result\.attachment\?\.assetId\) onImageAttached\?\.\(result\.attachment\.assetId\);/);
});

test('the picker and the drop handler both carry the callback through the one shared sink', () => {
  const actions = src('components/ComposerActions.tsx');
  assert.match(actions, /await uploadAttachments\(\{ project, disabled, diary, chatOnly, onChanged, onBusy, onStatus, onImageAttached, onSaved \}, files, t\);/);
  assert.match(actions, /export function ComposerActions\(\{ project, disabled, onChanged, onBusy, onStatus, header, diary = false, chatOnly = false, browseTools, onImageAttached, onSaved, onEnsureProject \}/);
});

test('the upload response type carries the image asset id the server returns', () => {
  assert.match(src('api.ts'), /attachment\?: \{ reduction\?: \{ note: string \}; assetId\?: string;/);
});

test('ChatView keeps the attached images per chat and sends them with the next message only', () => {
  const chat = src('components/ChatView.tsx');
  assert.match(chat, /export interface SendTurn \{ turnToolboxes\?: string\[\];[^\n]*turnImageIds\?: string\[\]; notice/);
  assert.match(chat, /const \[pendingImages, setPendingImages\] = useState<Record<string, string\[\]>>\(\{\}\);/);
  assert.match(chat, /const onImageAttached = \(assetId: string\) => setPendingImages\(prev => \(\{ \.\.\.prev, \[chatId\]: addTurnImage\(prev\[chatId\] \?\? \[\], assetId\) \}\)\);/);
  const submit = chat.slice(chat.indexOf('const submit = () => {'), chat.indexOf('// #437: the whole chat pane'));
  assert.match(submit, /turnImageIds: turnImageIdsToSend\(pendingImages\[chatId\]\)/);
  assert.match(submit, /setPendingImages\(prev => \{ const \{ \[chatId\]: _sent, \.\.\.rest \} = prev; return rest; \}\);/);
});

test('ChatView passes the image callback into both the picker and the whole-pane drop handler', () => {
  const chat = src('components/ChatView.tsx');
  assert.match(chat, /const \{ isDragOver, dropProps \} = useAttachmentDrop\(\{\s*\n\s*project: project \|\| freeContext, disabled: streaming \|\| actionBusy, chatOnly: !project,\s*\n\s*onChanged: refreshContext, onBusy: setActionBusy, onStatus: showActionStatus, onImageAttached,/);
  assert.match(chat, /<ComposerActions chatOnly=\{!project\} key=\{chatId\} project=\{project \|\| freeContext\} disabled=\{streaming \|\| actionBusy\} onChanged=\{refreshContext\} onModels=\{openModels\} onBusy=\{setActionBusy\} onStatus=\{showActionStatus\} onImageAttached=\{onImageAttached\}/);
});

test('App sends turnImageIds on every chat request, as an array (never absent, so the server\'s legacy path is not taken)', () => {
  const api = src('api.ts');
  assert.match(api, /mode\?: 'chat'; turnToolboxes\?: string\[\];\s*\n\s*\/\*\* #1512: the project image sources this message attaches/);
  const app = src('App.tsx');
  const handle = app.slice(app.indexOf('const handleSend = useCallback('), app.indexOf('const activeMode: ChatMode'));
  assert.match(handle, /turnImageIds: sentImages,/);
  assert.match(handle, /const sentImages = turnImageIdsToSend\(turn\.turnImageIds\);/);
  // #1514 adds a `files` spread and #1517 the variant fields after the image ids; the image ids must still be on the user turn.
  assert.match(handle, /const userMsg: Message = \{ id: uid\(\), role: 'user', content: text, \.\.\.\(sentPin \? \{ skill: sentPin \} : \{\}\), \.\.\.\(sentImages\.length \? \{ turnImageIds: sentImages \} : \{\}\), \.\.\.\(sentFiles \? \{ files: sentFiles \} : \{\}\), \.\.\.variantFields \};/);
});

test('Retry and Regenerate resend the image ids the original message was sent with', () => {
  const app = src('App.tsx');
  assert.match(app, /void handleSend\(chatId, projectId, msgs\[index - 1\]\.content, rerunBase\(msgs, index\), \{ \.\.\.\(pin \? \{ skill: pin \} : \{\}\), turnImageIds: msgs\[index - 1\]\.turnImageIds, resend/);
  assert.match(app, /void handleSend\(chatId, projectId, plan\.userText, plan\.base, \{ \.\.\.\(plan\.skill \? \{ skill: plan\.skill \} : \{\}\), turnImageIds: plan\.turnImageIds, resend/);
  assert.match(src('regenerate.ts'), /\.\.\.\(prompt\.turnImageIds\?\.length \? \{ turnImageIds: prompt\.turnImageIds \} : \{\}\)/);
});

test('Edit re-runs send no images, as edits already send no Skill pin', () => {
  const app = src('App.tsx');
  // #1517 adds the variant to the call; it still carries no image ids.
  assert.match(app, /void handleSend\(chatId, projectId, text, editBase\(msgs, index\), \{ variantOf: \{ kind: 'branch', user: msgs\[index\], tail: msgs\.slice\(index \+ 1\) \} \}\);/);
  assert.doesNotMatch(app.slice(app.indexOf('void handleSend(chatId, projectId, text, editBase(msgs, index)'), app.indexOf('void handleSend(chatId, projectId, text, editBase(msgs, index)') + 200), /turnImageIds/);
});
