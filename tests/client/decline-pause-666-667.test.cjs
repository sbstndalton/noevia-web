// #666/#667: the note on a reply that ended because a write was declined, in every interface
// language, and the action row of a reply that ended on a note with no text (Regenerate, no Copy).
// Synthetic data only.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

async function withSsr(run) {
  const { createServer } = await import('vite');
  const server = await createServer({
    configFile: false, root: path.resolve(__dirname, '../..'), server: { middlewareMode: true }, appType: 'custom',
    plugins: [(await import('@vitejs/plugin-react')).default()],
  });
  global.window = { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), addEventListener() {}, removeEventListener() {} };
  global.document = { documentElement: { dataset: {} } };
  global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  global.navigator = { language: 'en-GB', languages: ['en-GB'] };
  try { await run(server); } finally {
    delete global.window; delete global.document; delete global.localStorage; delete global.navigator;
    await server.close();
  }
}

const LOCALES = ['en-GB', 'de-DE', 'es-ES', 'fr-FR', 'it-IT', 'nb-NO', 'nl-NL', 'pt-BR', 'sv-SE'];

test('declined note: fixed wording, the tool name, and any saved change, in every locale', async () => {
  await withSsr(async (server) => {
    const core = await server.ssrLoadModule('/src/i18n/core.ts');
    const { pausedNoteText } = await server.ssrLoadModule('/src/chat-labels.ts');
    const tFor = (locale) => Object.assign((k, p) => core.translate(locale, k, p), { plural: (k, c, p) => core.translatePlural(locale, k, c, p) });
    const en = tFor('en-GB');
    assert.equal(pausedNoteText(en, { reason: 'declined', applied: 0, declined: ['project_append_file'] }), 'No change was made: you declined project_append_file.');
    assert.equal(pausedNoteText(en, { reason: 'declined', applied: 1, declined: ['project_append_file'] }), '1 change was saved. You declined project_append_file, so nothing else was changed.');
    assert.equal(pausedNoteText(en, { reason: 'declined', applied: 2, declined: ['a_tool', 'b_tool'] }), '2 changes were saved. You declined a_tool, b_tool, so nothing else was changed.');
    // #666 review: a decline whose names did not survive says so in general words.
    assert.equal(pausedNoteText(en, { reason: 'declined', applied: 0, declined: [] }), 'No change was made.');
    assert.equal(pausedNoteText(en, { reason: 'declined', applied: 1 }), '1 change was saved before this reply ended.');
    // The #658 notes are unchanged.
    assert.equal(pausedNoteText(en, { reason: 'supervision', applied: 0 }), 'Step supervision paused this reply before any further steps. Nothing was changed.');
    for (const locale of LOCALES) {
      if (locale !== 'en-GB') core.registerCatalogue(locale, (await server.ssrLoadModule(`/src/i18n/${locale}.ts`))[locale.replace('-', '_').toUpperCase()]);
      const t = tFor(locale);
      for (const [applied, key] of [[0, 'chat.paused.declined'], [1, 'chat.paused.declinedApplied.one'], [3, 'chat.paused.declinedApplied.other']]) {
        const text = pausedNoteText(t, { reason: 'declined', applied, declined: ['project_append_file'] });
        assert.ok(text.includes('project_append_file'), `${locale} ${key} names the tool: ${text}`);
        assert.doesNotMatch(text, /\{(tools|count)\}/, `${locale} ${key} fills every placeholder`);
        if (applied) assert.ok(text.includes(String(applied)), `${locale} ${key} says how many were saved`);
        if (!applied) assert.notEqual(pausedNoteText(t, { reason: 'declined', applied: 0, declined: [] }), 'chat.paused.declinedNone', `${locale} has the general note`);
        if (locale !== 'en-GB') assert.notEqual(text, pausedNoteText(en, { reason: 'declined', applied, declined: ['project_append_file'] }), `${locale} ${key} is translated`);
      }
    }
  });
});

test('a last reply that ended on a note with no text keeps Regenerate and has no Copy', async () => {
  await withSsr(async (server) => {
    const React = require('react');
    const { renderToStaticMarkup } = require('react-dom/server');
    const { MessageActions } = await server.ssrLoadModule('/src/components/ChatView.tsx');
    const render = (content) => renderToStaticMarkup(React.createElement(MessageActions, { content, canRegenerate: true, onRegenerate() {}, regenerateDisabled: false }));
    const empty = render('');
    assert.match(empty, />Regenerate</);
    assert.doesNotMatch(empty, />Copy</, 'nothing to copy');
    const text = render('Synthetic answer');
    assert.match(text, />Copy</);
    assert.match(text, />Regenerate</);
  });
});

test('Regenerate on a paused or declined reply: nothing saved re-runs plainly; saved changes stay as their record', async () => {
  await withSsr(async (server) => {
    const { planRegenerate } = await server.ssrLoadModule('/src/regenerate.ts');
    const { modelHistory } = await server.ssrLoadModule('/src/applied-writes.ts');
    const user = { id: 'u1', role: 'user', content: 'Say hello in three words.' };
    const paused = { id: 'a1', role: 'assistant', content: '', toolCalls: [{ name: 'project_read_file', args: '{}', status: 'done', result: 'Zahl: 1' }], paused: { reason: 'supervision', applied: 0 } };
    const plain = planRegenerate([user, paused], 'a1');
    assert.equal(plain.userText, 'Say hello in three words.');
    assert.equal(plain.base.length, 0, 'nothing was changed: the same as a Retry');

    const saved = { name: 'project_append_file', args: '{"name":"qa.md","text":"x"}', status: 'done', applied: true, target: 'noevia projects/QA/Text/qa.md', result: 'Appended.' };
    const declined = { name: 'project_append_file', args: '{"name":"qa.md","text":"y"}', status: 'denied', result: 'ERROR: the user declined to run project_append_file. Do not retry it; ask what they would prefer.' };
    const mixed = { id: 'a2', role: 'assistant', content: '', toolCalls: [saved, declined], paused: { reason: 'declined', applied: 1, declined: ['project_append_file'] } };
    const plan = planRegenerate([user, mixed], 'a2');
    assert.equal(plan.base.length, 2, 'the user turn and the record of the saved change stay');
    assert.equal(plan.base[1].content, '');
    assert.deepEqual(plan.base[1].toolCalls.map((c) => c.status), ['done'], 'the declined call is not part of the record');
    assert.equal(JSON.stringify(plan.base[1].paused), JSON.stringify({ reason: 'declined', applied: 1, declined: ['project_append_file'] }), 'the record still reads as a decline');
    const history = modelHistory(plan.base);
    assert.deepEqual(history.map((e) => [e.role, e.applied === true, e.declined === true]), [['user', false, false], ['assistant', false, false], ['tool', true, false]],
      'the saved change is sent as done (never replayed); the declined call is not replayed: Regenerate means try again');
    // Outside a re-run, the declined call of a reply still in the transcript is sent as not run.
    assert.deepEqual(modelHistory([user, mixed]).map((e) => [e.role, e.applied === true, e.declined === true]), [['user', false, false], ['assistant', false, false], ['tool', true, false], ['tool', false, true]]);
  });
});
