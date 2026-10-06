// #617: the Code landing renders in the interface language. Renders the real components through
// Vite's SSR pipeline (as code-task-meta-locale.test.cjs does), one fresh module graph per language
// because the interface locale is resolved once from the browser's languages. The English text that
// qa/code-mode.cjs and coding-workspace-code-link.test.cjs assert on is checked there.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

async function render(language, build) {
  const { createServer } = await import('vite');
  const server = await createServer({ configFile: false, root: path.resolve(__dirname, '../..'), server: { middlewareMode: true }, appType: 'custom', plugins: [(await import('@vitejs/plugin-react')).default()] });
  global.window = { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), addEventListener() {}, removeEventListener() {} };
  global.document = { documentElement: { dataset: {}, lang: '' } };
  global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  // Node defines `navigator` as a getter-only global, so a plain assignment is ignored the first time.
  Object.defineProperty(global, 'navigator', { value: { language, languages: [language] }, configurable: true, writable: true });
  try {
    const core = await server.ssrLoadModule('/src/i18n/core.ts');
    for (const [locale, file, name] of [['de-DE', 'de-DE', 'DE_DE'], ['fr-FR', 'fr-FR', 'FR_FR']]) core.registerCatalogue(locale, (await server.ssrLoadModule(`/src/i18n/${file}.ts`))[name]);
    const React = require('react');
    const { renderToStaticMarkup } = require('react-dom/server');
    const mod = await server.ssrLoadModule('/src/components/CodingWorkspace.tsx');
    return build(mod, React, (el) => renderToStaticMarkup(el).replace(/<[^>]+>/g, ' ').replace(/[  ]/g, ' ').replace(/\s+/g, ' '));
  } finally {
    delete global.window; delete global.document; delete global.localStorage; delete global.navigator;
    await server.close();
  }
}

const ENGLISH = /Open a project to run Code|Code mode runs inside|Open Code|What should we build next|Interface preview|Draft only|Build a feature|Select project|Describe a coding task|Checking Code access|Create a project, then/;

test('the project picker (Code landing once access is granted) reads in German', () => render('de-DE', ({ CodeProjectPicker }, React, text) => {
  const shown = text(React.createElement(CodeProjectPicker, { projects: [{ id: 'p1', name: 'Gartenplan' }], onOpen: () => {} }));
  assert.match(shown, /Projekt öffnen, um Code auszuführen/);
  assert.match(shown, /Der Code-Modus läuft im eigenen Code-Tab jedes Projekts/);
  assert.match(shown, /Gartenplan/);
  assert.match(shown, /Code öffnen/);
  assert.doesNotMatch(shown, ENGLISH);
  const empty = text(React.createElement(CodeProjectPicker, { projects: [], onOpen: () => {} }));
  assert.match(empty, /Lege ein Projekt an/);
  assert.doesNotMatch(empty, ENGLISH);
}));

test('the project picker reads in French', () => render('fr-FR', ({ CodeProjectPicker }, React, text) => {
  const shown = text(React.createElement(CodeProjectPicker, { projects: [{ id: 'p1', name: 'Jardin' }], onOpen: () => {} }));
  assert.match(shown, /Ouvrez un projet pour lancer Code/);
  assert.match(shown, /Ouvrir Code/);
  assert.doesNotMatch(shown, ENGLISH);
}));

test('the honest stub (no access) and its header and preview pages read in German and French', async () => {
  for (const [language, welcome, badge, header] of [['de-DE', /Was sollen wir als Nächstes bauen\?/, /Oberflächenvorschau · keine Ausführung/, /Neue Aufgabe/], ['fr-FR', /Que construisons-nous ensuite \?/, /Aperçu de l’interface · aucune exécution/, /Nouvelle tâche/]]) {
    await render(language, ({ CodingWorkspace }, React, text) => {
      // Before useCodeAccess resolves, the initial render is the checking state, then the stub is never shown statically;
      // a viewer with a wired-up callback and no projects has "denied" decided at once.
      const stub = text(React.createElement(CodingWorkspace, { page: 'New task', projects: [], projectsLoaded: true }));
      assert.match(stub, welcome, language);
      assert.match(stub, badge, language);
      assert.match(stub, header, language);
      assert.doesNotMatch(stub, ENGLISH, language);
      const pr = text(React.createElement(CodingWorkspace, { page: 'Pull requests', projects: [] }));
      assert.doesNotMatch(pr, /Open pull requests|Code reviews|Checks and status|Interface preview|belongs to your coding workspace/, language);
    });
  }
});
