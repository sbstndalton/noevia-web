'use strict';
// #1417: a project this session has just created stays in the workspace list until a workspace read
// includes it, and is dropped once the grace period has passed.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { rememberCreatedProject, withCreatedProjects, CREATED_PROJECT_GRACE_MS } = require('../../src/created-projects.ts');

const project = (id, name = id) => ({ id, name, goal: '', instructions: '', memories: [], files: [], chats: [], createdAt: 1, updatedAt: 1 });

test('a created project is kept while the workspace read has not listed it yet', () => {
  const created = new Map();
  rememberCreatedProject(created, project('p-new', 'New'), 1000);
  const lagging = withCreatedProjects([project('p-old')], created, 1500);
  assert.deepEqual(lagging.map((p) => p.id), ['p-old', 'p-new']);
  assert.equal(created.has('p-new'), true, 'it stays remembered until the server lists it');
});

test('once a workspace read lists the project, it is not duplicated and the memory is cleared', () => {
  const created = new Map();
  rememberCreatedProject(created, project('p-new', 'New'), 1000);
  const listed = withCreatedProjects([project('p-new', 'Server copy')], created, 1500);
  assert.deepEqual(listed.map((p) => [p.id, p.name]), [['p-new', 'Server copy']], 'the server copy wins and appears once');
  assert.equal(created.size, 0);
});

test('a created project is dropped after the grace period, so a project deleted elsewhere does not linger', () => {
  const created = new Map();
  rememberCreatedProject(created, project('p-gone'), 1000);
  const later = withCreatedProjects([], created, 1000 + CREATED_PROJECT_GRACE_MS + 1);
  assert.deepEqual(later, []);
  assert.equal(created.size, 0);
});

test('just inside the grace period the project is still kept', () => {
  const created = new Map();
  rememberCreatedProject(created, project('p-new'), 1000);
  const kept = withCreatedProjects([], created, 1000 + CREATED_PROJECT_GRACE_MS);
  assert.deepEqual(kept.map((p) => p.id), ['p-new']);
});

test('an empty memory leaves the server list untouched and returns a copy', () => {
  const listed = [project('a'), project('b')];
  const next = withCreatedProjects(listed, new Map(), 5);
  assert.deepEqual(next.map((p) => p.id), ['a', 'b']);
  assert.notEqual(next, listed);
});
