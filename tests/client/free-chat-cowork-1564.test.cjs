// #1564: Task (Cowork) cannot be chosen in a free chat. The option is disabled, the arrow keys
// cannot reach it, and the caption says "Runs inside a project" with a button to the Projects page.
// Renders the real ComposerModeBar parts through Vite's SSR pipeline (effects do not run under SSR,
// so the choice is exercised through the state's choose() the way the keyboard handler calls it).
// Also checks that every catalogue carries the two new strings, so no locale shows English here.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

async function withModule(fn) {
  const { createServer } = require('./vite-ssr-server.cjs');
  const server = await createServer({ configFile: false, root: path.resolve(__dirname, '../..'), server: { middlewareMode: true }, appType: 'custom', plugins: [(await import('@vitejs/plugin-react')).default()] });
  global.window = { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), addEventListener() {}, removeEventListener() {} };
  global.document = { documentElement: { dataset: {}, lang: '' } };
  global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  Object.defineProperty(global, 'navigator', { value: { language: 'en-GB', languages: ['en-GB'] }, configurable: true, writable: true });
  try {
    const mod = await server.ssrLoadModule('/src/components/ComposerModeBar.tsx');
    const React = require('react');
    const { renderToStaticMarkup } = require('react-dom/server');
    return await fn(mod, React, renderToStaticMarkup, server);
  } finally {
    delete global.window; delete global.document; delete global.localStorage; delete global.navigator;
    await server.close();
  }
}

const ACCESS = { harnessEnabled: true, canUseCode: true, repositories: ['repo-a'] };

// Renders the toggle and caption from one useModeSwitch, and hands its state to the test.
function harnessFor(mod, React, capture) {
  return function Harness(props) {
    const state = mod.useModeSwitch(props);
    capture(state);
    return React.createElement(React.Fragment, null,
      React.createElement(mod.ModeToggle, { state, disabled: false }),
      React.createElement(mod.ModeCaption, { state, disabled: false, onRepository() {} }));
  };
}

function render(mod, React, renderToStaticMarkup, input) {
  let state = null;
  const Harness = harnessFor(mod, React, (s) => { state = s; });
  const html = renderToStaticMarkup(React.createElement(Harness, { access: ACCESS, repository: 'repo-a', messageCount: 0, onModeChange() {}, ...input }));
  return { html, state };
}

const cowork = (html) => html.match(/<button[^>]*data-mode="cowork"[^>]*>/)[0];

test('a free chat disables Task, says it runs inside a project, and offers Projects', () => withModule((mod, React, render2, server) => {
  const onOpenProjects = () => {};
  const { html } = render(mod, React, render2, { projectId: null, mode: 'chat', onOpenProjects });
  assert.match(cowork(html), /disabled=""/, 'the Task/Cowork radio is disabled in a free chat');
  assert.doesNotMatch(cowork(html), /aria-checked="true"/);
  assert.match(html, /Task runs inside a project\./);
  assert.match(html, /Open Projects/);
  assert.match(html, /class="composer-mode-open"/);
}));

test('a free chat in Task mode (moved out of a project) still falls back visibly, with the same hint', () => withModule((mod, React, render2) => {
  const { html } = render(mod, React, render2, { projectId: null, mode: 'cowork', onOpenProjects: () => {} });
  assert.match(html, /Task runs inside a project\./);
  assert.match(html, /Open Projects/);
  assert.match(html, /data-caption="fallback"/, 'a phone shows the slim line for a free chat');
}));

test('a free chat without a Projects handler still says why, but offers no dead button', () => withModule((mod, React, render2) => {
  const { html } = render(mod, React, render2, { projectId: null, mode: 'chat' });
  assert.match(html, /Task runs inside a project\./);
  assert.doesNotMatch(html, /composer-mode-open/);
}));

test('a project chat keeps Task enabled and shows no free-chat hint', () => withModule((mod, React, render2) => {
  const { html } = render(mod, React, render2, { projectId: 'p1', mode: 'chat', onOpenProjects: () => {} });
  assert.doesNotMatch(cowork(html), /disabled=""/, 'Task is selectable inside a project');
  assert.doesNotMatch(html, /runs inside a project/i);
  assert.doesNotMatch(html, /composer-mode-open/);
  assert.match(html, /data-caption="chat"/);
}));

test('choosing Task in a free chat is refused, so the arrow keys cannot switch to it', () => withModule((mod, React, render2) => {
  const changes = [];
  const { state } = render(mod, React, render2, { projectId: null, mode: 'chat', onModeChange: (m, n) => changes.push([m, n]) });
  state.choose('cowork');
  assert.deepEqual(changes, [], 'no mode change and no confirmation for Task in a free chat');
  assert.equal(state.confirm, null);
}));

test('the Projects button is wired to the handler the chat passes in', () => withModule((mod, React, render2) => {
  const onOpenProjects = () => {};
  const { state } = render(mod, React, render2, { projectId: null, mode: 'chat', onOpenProjects });
  assert.equal(state.onOpenProjects, onOpenProjects);
  assert.equal(state.coworkNeedsProject, true);
}));

test('Task in a project still switches as before', () => withModule((mod, React, render2) => {
  const changes = [];
  const { state } = render(mod, React, render2, { projectId: 'p1', mode: 'chat', onModeChange: (m, n) => changes.push([m, n]) });
  state.choose('cowork');
  assert.deepEqual(changes, [['cowork', false]]);
}));

test('every catalogue carries the free-chat hint and button, translated outside English', async () => {
  const { createServer } = require('./vite-ssr-server.cjs');
  const server = await createServer({ configFile: false, root: path.resolve(__dirname, '../..'), server: { middlewareMode: true }, appType: 'custom' });
  try {
    const en = (await server.ssrLoadModule('/src/i18n/en-GB.ts')).EN_GB;
    assert.equal(en['mode.runsInProject'], 'Task runs inside a project.');
    assert.equal(en['mode.openProjects'], 'Open Projects');
    const FILES = { 'de-DE': 'DE_DE', 'es-ES': 'ES_ES', 'fr-FR': 'FR_FR', 'it-IT': 'IT_IT', 'nb-NO': 'NB_NO', 'nl-NL': 'NL_NL', 'pt-BR': 'PT_BR', 'sv-SE': 'SV_SE' };
    for (const [locale, name] of Object.entries(FILES)) {
      const cat = (await server.ssrLoadModule(`/src/i18n/${locale}.ts`))[name];
      for (const key of ['mode.runsInProject', 'mode.openProjects']) {
        assert.ok(cat[key] && cat[key].trim(), `${locale} ${key}`);
        assert.notEqual(cat[key], en[key], `${locale} ${key} is translated`);
      }
    }
  } finally {
    await server.close();
  }
});

// #1595: the hint used to run on after the Chat caption in the same inline span ("Runs a conversational reply
// Runs inside a project Open Projects"), which read as if Chat ran inside a project. It is now its own block
// that names Task, a sibling of the Chat caption line. The pixel check (own line at 1440 and 390) is
// qa/free-chat-mode-row-1595.cjs; this pins the DOM and the style it depends on.
test('#1595 the free-chat hint is a separate block from the Chat caption, naming Task', () => withModule((mod, React, render2) => {
  const { html } = render(mod, React, render2, { projectId: null, mode: 'chat', onOpenProjects: () => {} });
  const caption = html.match(/<span class="composer-mode-line">(.*?)<\/span><span class="composer-mode-free"/);
  assert.ok(caption, 'the caption line closes before the hint block opens');
  assert.equal(caption[1], 'Runs a conversational reply');
  assert.doesNotMatch(caption[1], /project/i, 'the Chat caption never carries the project hint');
  const hint = html.match(/<span class="composer-mode-free"[^>]*>(.*)<\/span><\/span>$/);
  assert.ok(hint && /^<span class="composer-mode-hint">Task runs inside a project\.<\/span><button/.test(hint[1]), 'the hint block holds the Task sentence, then Open Projects');
  assert.match(cowork(html), /title="Task runs inside a project\."/, 'the disabled Task option carries the hint as a tooltip');
}));

test('#1595 the hint block is block-level, so it cannot sit on the Chat caption line', () => {
  const css = require('node:fs').readFileSync(path.resolve(__dirname, '../../src/components/composer-mode.css'), 'utf8');
  const rule = css.match(/\.composer-mode-free\s*\{([^}]*)\}/);
  assert.ok(rule, '.composer-mode-free is styled');
  assert.match(rule[1], /display:\s*flex/, 'a flex container is block-level');
  assert.doesNotMatch(rule[1], /margin-inline-start/, 'no inline offset that would run it on after the caption');
});

test('#1595 every catalogue words the hint about Task, in that language\'s own name for the mode', async () => {
  const { createServer } = require('./vite-ssr-server.cjs');
  const server = await createServer({ configFile: false, root: path.resolve(__dirname, '../..'), server: { middlewareMode: true }, appType: 'custom' });
  try {
    const FILES = { 'en-GB': 'EN_GB', 'de-DE': 'DE_DE', 'es-ES': 'ES_ES', 'fr-FR': 'FR_FR', 'it-IT': 'IT_IT', 'nb-NO': 'NB_NO', 'nl-NL': 'NL_NL', 'pt-BR': 'PT_BR', 'sv-SE': 'SV_SE' };
    for (const [locale, name] of Object.entries(FILES)) {
      const cat = (await server.ssrLoadModule(`/src/i18n/${locale}.ts`))[name];
      assert.ok(cat['mode.runsInProject'].toLowerCase().includes(cat['projects.modeCowork'].toLowerCase()), `${locale}: "${cat['mode.runsInProject']}" names "${cat['projects.modeCowork']}"`);
    }
  } finally {
    await server.close();
  }
});
