// #1576: one chat surface. Task (internal id 'cowork') is a per-send composer choice offered only to
// an administrator with the codeHarness feature; nobody else sees a Task option, a free-chat hint or a
// fallback caption. The project-level "Available in" (modes) switch is gone, and the Code sidebar's
// "New task" opens a project chat with Task preselected. Renders the real components through Vite's
// SSR pipeline (effects do not run under SSR), plus source pins for the App wiring.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
async function withModule(name, fn) {
  const { createServer } = require('./vite-ssr-server.cjs');
  const server = await createServer({ configFile: false, root, server: { middlewareMode: true }, appType: 'custom', plugins: [(await import('@vitejs/plugin-react')).default()] });
  global.window = { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), addEventListener() {}, removeEventListener() {} };
  global.document = { documentElement: { dataset: {}, lang: '' } };
  global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  Object.defineProperty(global, 'navigator', { value: { language: 'en-GB', languages: ['en-GB'] }, configurable: true, writable: true });
  try {
    const mod = await server.ssrLoadModule(name);
    const React = require('react');
    const { renderToStaticMarkup } = require('react-dom/server');
    return await fn(mod, React, renderToStaticMarkup, server);
  } finally {
    delete global.window; delete global.document; delete global.localStorage; delete global.navigator;
    await server.close();
  }
}

function renderBar(mod, React, render, input) {
  let state = null;
  function Harness(props) {
    const s = mod.useModeSwitch(props); state = s;
    return React.createElement(React.Fragment, null,
      React.createElement(mod.ModeToggle, { state: s, disabled: false }),
      React.createElement(mod.ModeCaption, { state: s, disabled: false, onRepository() {} }),
      React.createElement(mod.ModeConfirm, { state: s }));
  }
  const html = render(React.createElement(Harness, { repository: 'repo-a', messageCount: 0, onModeChange() {}, onOpenProjects() {}, ...input }));
  return { html, state };
}
const NOT_OFFERED = { harnessEnabled: true, canUseCode: false, repositories: [], offered: false };
const OFFERED = { harnessEnabled: true, canUseCode: true, repositories: ['repo-a'], offered: true };

test('a viewer who cannot run Task sees no Task option, hint or fallback, in a project or a free chat', () => withModule('/src/components/ComposerModeBar.tsx', (mod, React, render) => {
  for (const projectId of ['p1', null]) {
    for (const mode of ['chat', 'cowork']) {
      const { html, state } = renderBar(mod, React, render, { access: NOT_OFFERED, projectId, mode });
      assert.doesNotMatch(html, /data-mode="cowork"/, `${projectId} ${mode}: no Task radio`);
      assert.doesNotMatch(html, /role="radiogroup"/, `${projectId} ${mode}: no one-option switch`);
      assert.doesNotMatch(html, />Task</, `${projectId} ${mode}: the word Task is not shown`);
      assert.doesNotMatch(html, /runs inside a project|Sent as Chat|will be sent as/i, `${projectId} ${mode}: nothing explains a Task it cannot have`);
      assert.match(html, /data-caption="chat"/);
      assert.equal(state.coworkNeedsProject, false);
    }
  }
}));

test('choosing Task is refused when it is not offered, even inside a project', () => withModule('/src/components/ComposerModeBar.tsx', (mod, React, render) => {
  const changes = [];
  const { state } = renderBar(mod, React, render, { access: NOT_OFFERED, projectId: 'p1', mode: 'chat', onModeChange: (m, n) => changes.push([m, n]) });
  state.choose('cowork');
  assert.deepEqual(changes, []);
}));

test('an administrator with codeHarness keeps Task in a project chat', () => withModule('/src/components/ComposerModeBar.tsx', (mod, React, render) => {
  const changes = [];
  const { html, state } = renderBar(mod, React, render, { access: OFFERED, projectId: 'p1', mode: 'chat', onModeChange: (m, n) => changes.push([m, n]) });
  assert.match(html, /data-mode="cowork"/);
  state.choose('cowork');
  assert.deepEqual(changes, [['cowork', false]]);
}));

test('useCoworkAccess offers Task only to an administrator with codeHarness on', () => {
  const src = fs.readFileSync(path.join(root, 'src/components/ComposerModeBar.tsx'), 'utf8');
  assert.match(src, /offered: !!flags\.codeHarness && isAdmin/);
  assert.match(src, /export function useCoworkAccess\(projectId: string \| null, isAdmin = false, adminKnown = true\)/, 'not an administrator unless told so');
  const chat = fs.readFileSync(path.join(root, 'src/components/ChatView.tsx'), 'utf8');
  assert.match(chat, /useCoworkAccess\(project\?\.id \?\? null, isAdmin, adminKnown\)/);
  const app = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8');
  assert.match(app, /setIsAdmin\(profile\.user\.role === 'admin'\)/);
  assert.match(app, /isAdmin=\{isAdmin\}/);
});

test('"New task" opens a new project chat with Task preselected, not a separate view', () => {
  const app = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8');
  const fn = app.match(/const startProjectTask = useCallback\(([\s\S]*?)\n  \);/);
  assert.ok(fn, 'startProjectTask exists');
  assert.match(fn[1], /setPendingModes\(\(prev\) => \(\{ \.\.\.prev, \[chatId\]: 'cowork' \}\)\)/);
  assert.match(fn[1], /setView\(\{ kind: 'chat', chatId, projectId \}\)/);
  assert.match(fn[1], /setAppMode\('chat'\)/);
  assert.match(app, /<Coding\.View [^\n]*onStartTask=\{startProjectTask\}/);
});

test('the project settings dialog has no "Available in" mode switch and never sends modes', () => {
  const src = fs.readFileSync(path.join(root, 'src/components/EditProjectModal.tsx'), 'utf8');
  assert.doesNotMatch(src, /projects\.edit\.availableIn|toggleMode|ProjectMode/);
  assert.doesNotMatch(src, /^\s*modes,$/m);
  for (const file of ['ProjectView.tsx', 'Sidebar.tsx', 'ProjectsView.tsx']) {
    assert.doesNotMatch(fs.readFileSync(path.join(root, 'src/components', file), 'utf8'), /\.modes\b/, `${file} no longer reads project modes`);
  }
});

test('every catalogue carries the New task picker strings, translated outside English, and none keeps the removed mode keys', async () => {
  const { createServer } = require('./vite-ssr-server.cjs');
  const server = await createServer({ configFile: false, root, server: { middlewareMode: true }, appType: 'custom' });
  try {
    const FILES = { 'en-GB': 'EN_GB', 'de-DE': 'DE_DE', 'es-ES': 'ES_ES', 'fr-FR': 'FR_FR', 'it-IT': 'IT_IT', 'nb-NO': 'NB_NO', 'nl-NL': 'NL_NL', 'pt-BR': 'PT_BR', 'sv-SE': 'SV_SE' };
    const en = (await server.ssrLoadModule('/src/i18n/en-GB.ts')).EN_GB;
    for (const [locale, name] of Object.entries(FILES)) {
      const cat = (await server.ssrLoadModule(`/src/i18n/${locale}.ts`))[name];
      for (const key of ['code.picker.taskTitle', 'code.picker.taskBody', 'code.picker.startTask', 'code.picker.startTaskIn', 'code.picker.taskNoProjects']) {
        assert.ok(cat[key] && cat[key].trim(), `${locale} ${key}`);
        if (locale !== 'en-GB') assert.notEqual(cat[key], en[key], `${locale} ${key} is translated`);
      }
      assert.match(cat['code.picker.startTaskIn'], /\{name\}/, `${locale} names the project`);
      for (const gone of ['projects.edit.availableIn', 'projects.edit.modesHint', 'projects.edit.chooseMode', 'projects.view.chatDisabled', 'code.picker.open']) assert.equal(cat[gone], undefined, `${locale} ${gone}`);
    }
  } finally {
    await server.close();
  }
});

test('a pending Task choice is Chat on the client when Task is not offered, and held while access is unknown (#1839)', () => withModule('/src/chat-mode.ts', (chatMode) => {
  const { modeWithAccess } = chatMode;
  assert.equal(modeWithAccess('cowork', { offered: false, known: true }), 'chat', 'demoted admin / codeHarness off');
  assert.equal(modeWithAccess('cowork', { offered: false }), 'chat', 'known by default');
  assert.equal(modeWithAccess('cowork', { offered: true, known: true }), 'cowork');
  assert.equal(modeWithAccess('cowork', { offered: false, known: false }), 'cowork', 'an admin is not demoted by a profile still loading');
  assert.equal(modeWithAccess('chat', { offered: false, known: true }), 'chat');
}));

test('the mode bar is held, not drawn as for a non-admin, while the profile or flags are unknown (#1839)', () => withModule('/src/components/ComposerModeBar.tsx', (mod, React, render) => {
  const LOADING = { ...OFFERED, known: false };
  for (const mode of ['chat', 'cowork']) {
    const { html } = renderBar(mod, React, render, { access: LOADING, projectId: 'p1', mode });
    assert.doesNotMatch(html, /role="radiogroup"/, `${mode}: no toggle yet`);
  }
  const held = renderBar(mod, React, render, { access: LOADING, projectId: 'p1', mode: 'cowork' }).html;
  assert.doesNotMatch(held, /Runs a conversational reply|Sent as Chat|will be sent as/i, 'a pending Task shows no Chat caption while unknown');
  assert.match(renderBar(mod, React, render, { access: { ...OFFERED, known: true }, projectId: 'p1', mode: 'cowork' }).html, /role="radiogroup"/, 'shown once known');
  const app = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8');
  assert.match(app, /setProfileKnown\(true\);/);
  assert.match(app, /adminKnown=\{profileKnown\}/);
  assert.match(fs.readFileSync(path.join(root, 'src/components/ChatView.tsx'), 'utf8'), /modeWithAccess\(askedMode, coworkAccess\)/);
}));
