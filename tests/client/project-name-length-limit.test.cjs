'use strict';
// #398: the create/edit project name fields accepted arbitrary-length input with zero feedback
// while the server (server/projects.cjs, server/routes/projects.cjs) silently truncates at 120
// characters. The fix adds a client-side maxLength matching the server's cap plus a visible
// counter, both reading one shared constant (src/project-limits.ts, itself backed by
// contracts/project-limits.json — see server/project-name-limit.test.cjs for the server-side half
// of this parity). This repo has no jsdom/@testing-library, so this asserts the wiring directly
// against source, as elsewhere in this suite (tests/client/model-popup-manual-pin.test.cjs).
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');

const limits = fs.readFileSync(path.join(__dirname, '../../src/project-limits.ts'), 'utf8');
const projectsView = fs.readFileSync(path.join(__dirname, '../../src/components/ProjectsView.tsx'), 'utf8');
const editModal = fs.readFileSync(path.join(__dirname, '../../src/components/EditProjectModal.tsx'), 'utf8');
const limitsJson = require('../../contracts/project-limits.json');

test('src/project-limits.ts derives PROJECT_NAME_MAX_LENGTH from the shared contracts JSON, not a hardcoded number', () => {
  assert.match(limits, /import limits from '\.\.\/contracts\/project-limits\.json';/);
  assert.match(limits, /export const PROJECT_NAME_MAX_LENGTH: number = limits\.nameMaxLength;/);
});

test('the shared constant is 120, matching the server\'s truncation', () => {
  assert.equal(limitsJson.nameMaxLength, 120);
});

test('the create-project name input (#proj-name) enforces maxLength from the shared constant', () => {
  assert.match(projectsView, /import \{ PROJECT_NAME_MAX_LENGTH \} from '\.\.\/project-limits';/);
  const inputMatch = projectsView.match(/id="proj-name"[\s\S]*?\/>/);
  assert.ok(inputMatch, 'expected to find the #proj-name input');
  assert.match(inputMatch[0], /maxLength=\{PROJECT_NAME_MAX_LENGTH\}/);
});

test('the create-project dialog renders a visible near-limit counter for the name field', () => {
  assert.match(
    projectsView,
    /className=\{`project-name-counter\$\{name\.length >= PROJECT_NAME_MAX_LENGTH - 10 \? ' is-near-limit' : ''\}`\}/,
  );
  assert.match(projectsView, /t\('projects\.nameLengthCounter', \{ count: name\.length, max: PROJECT_NAME_MAX_LENGTH \}\)/);
});

test('the edit-project name input enforces the same maxLength', () => {
  assert.match(editModal, /import \{ PROJECT_NAME_MAX_LENGTH \} from '\.\.\/project-limits';/);
  const inputMatch = editModal.match(/<input\s+aria-label=\{t\('projects\.edit\.nameLabel'\)\}[\s\S]*?\/>/);
  assert.ok(inputMatch, 'expected to find the edit-project name input');
  assert.match(inputMatch[0], /maxLength=\{PROJECT_NAME_MAX_LENGTH\}/);
});

test('the edit-project dialog also renders a visible near-limit counter for the name field', () => {
  assert.match(editModal, /const nameNearLimit = name\.length >= PROJECT_NAME_MAX_LENGTH - 10;/);
  assert.match(editModal, /t\('projects\.edit\.nameLengthCounter', \{ count: name\.length, max: PROJECT_NAME_MAX_LENGTH \}\)/);
});

test('every new nameLengthCounter(Label) key is defined in its catalogue', () => {
  const projectsCatalogue = fs.readFileSync(path.join(__dirname, '../../src/i18n/projects/en-GB.ts'), 'utf8');
  const baseCatalogue = fs.readFileSync(path.join(__dirname, '../../src/i18n/en-GB.ts'), 'utf8');
  assert.match(projectsCatalogue, /'projects\.nameLengthCounter':/);
  assert.match(projectsCatalogue, /'projects\.nameLengthCounterLabel':/);
  assert.match(baseCatalogue, /'projects\.edit\.nameLengthCounter':/);
  assert.match(baseCatalogue, /'projects\.edit\.nameLengthCounterLabel':/);
});
