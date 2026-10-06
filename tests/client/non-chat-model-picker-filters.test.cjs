'use strict';
// #409: Laya (the internal multilingual routing/detection model, labelled "System · routing" in
// Your models) was offered as a normal pickable chat model in the composer's Manual picker and
// the Routing tab's Fast/Smart/Code selectors — both filtered with matchesModelUse(labels,
// 'all'), which only excludes embedding/reranking labels and has no concept of a system/routing
// model. The fix is isChatGenerationModel, which additionally excludes Laya by name
// (SYSTEM_NAME = /^laya(?:[_.-]|$)/i in src/model-kind.ts) — the same helper BenchmarksTab,
// LibraryTab and guided.ts already use (see library-tab-non-chat-models.test.cjs for the same
// source-pattern approach; this repo has no jsdom/@testing-library to render these components).
//
// #442: the Vision role selector was left on the old matchesModelUse(labels, 'all') rule and
// still listed Laya (labels: []) — that filter has no name-based exclusion either. Vision now
// filters chatModels (so Laya and any embedding/reranking model are already gone) down further
// to models carrying an actual 'vision' label.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');

const modelPopupSrc = fs.readFileSync(path.join(__dirname, '../../src/components/ModelPopup.tsx'), 'utf8');
const modelsSettingsSrc = fs.readFileSync(path.join(__dirname, '../../src/components/models/ModelsSettings.tsx'), 'utf8');

test('ModelPopup (composer Manual picker) filters with isChatGenerationModel, not matchesModelUse', () => {
  assert.match(modelPopupSrc, /import \{ isChatGenerationModel \} from '\.\.\/model-kind';/);
  assert.match(modelPopupSrc, /const chatModels = models\.filter\(\(m\) => !m\.missingFile && isChatGenerationModel\(m\.name, m\.labels\)\);/);
  assert.doesNotMatch(modelPopupSrc, /import \{ matchesModelUse/, 'ModelPopup must no longer import the incomplete all-use filter');
  assert.doesNotMatch(modelPopupSrc, /matchesModelUse\(m\.labels/, 'ModelPopup must no longer filter models with matchesModelUse');
});

test('ModelsSettings (Routing tab) filters Fast/Smart/Code with isChatGenerationModel', () => {
  assert.match(modelsSettingsSrc, /import \{ isChatGenerationModel \} from '\.\.\/\.\.\/model-kind';/);
  assert.match(modelsSettingsSrc, /const chatModels = models\.filter\(\(m\) => !m\.missingFile && isChatGenerationModel\(m\.name, m\.labels\)\);/);
});

test("#442: ModelsSettings' vision selector is chat-generation models further narrowed to an actual vision label", () => {
  // Laya has labels: [] and is excluded from chatModels already; requiring matchesModelUse(...,
  // 'vision') on TOP of chatModels (not models) also keeps out any other non-vision chat model.
  assert.match(modelsSettingsSrc, /const visionModels = chatModels\.filter\(\(m\) => matchesModelUse\(m\.labels, 'vision'\)\);/);
  assert.match(modelsSettingsSrc, /const roleModels = role === 'vision' \? visionModels : chatModels;/);
});

test('every Routing tab role select renders from the role-appropriate list (roleModels), not a single shared list', () => {
  assert.match(modelsSettingsSrc, /\{roleModels\.map\(\(m\) => <option key=\{m\.name\} value=\{m\.name\}>/);
});
