'use strict';
// #1709: /projects waits for the first workspace read before it says "No projects yet"; a failed
// first read is an error with a retry. The browser proof is qa/projects-loading-1709.cjs; this pins
// the wiring and the strings. Synthetic only.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const src = (p) => fs.readFileSync(path.join(__dirname, '../../src', p), 'utf8');

test('#1709 App passes the workspace load state and a retry to the Projects page', () => {
  const app = src('App.tsx');
  const view = /<Projects\.View[\s\S]*?\/>/.exec(app)[0];
  assert.match(view, /loaded=\{workspaceLoaded\}/);
  assert.match(view, /failed=\{workspaceFailed\}/);
  assert.match(view, /onRetry=\{\(\) => \{ void refreshProjects\(\); \}\}/);
});

test('#1709 the empty state is gated on a loaded list; loading and failed states come first', () => {
  const v = src('components/ProjectsView.tsx');
  assert.match(v, /const listState: 'loading' \| 'failed' \| 'ready' = projects\.length > 0 \|\| loaded \? 'ready' : failed \? 'failed' : 'loading';/);
  const loading = v.indexOf("listState === 'loading'"), failed = v.indexOf("listState === 'failed'"), empty = v.indexOf("t('projects.emptyTitle')");
  assert.ok(loading > 0 && failed > loading && empty > failed, 'loading, then failed, then the empty state');
  assert.match(v, /aria-busy="true"/);
});

test('#1709 every Projects catalogue words the loading and error states', () => {
  const dir = path.join(__dirname, '../../src/i18n/projects');
  for (const f of fs.readdirSync(dir).filter((f) => /^[a-z]{2}-[A-Z]{2}\.ts$/.test(f) && f !== 'en-US.ts')) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const key of ['loading', 'loadErrorTitle', 'loadErrorBody', 'loadErrorRetry']) assert.match(text, new RegExp(`'projects\\.${key}': "[^"]+"`), `${f} ${key}`);
  }
});
