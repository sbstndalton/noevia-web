// #272: the web composer pins one exact reviewed Skill version through the same portable manifest
// API a native client reads. Loads SkillPinPicker.tsx and InstructionSkills.tsx through Vite's SSR
// pipeline (as message-actions-render.test.cjs does) and renders them to static markup.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

async function withSsr(run) {
  const { createServer } = require('./vite-ssr-server.cjs');
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

const sha = (c) => c.repeat(64);
const manifest = (over = {}) => ({
  schemaVersion: 1, id: `skill_${'a'.repeat(32)}`, file: 'synthetic/SKILL.md', name: 'Synthetic helper', description: 'Fixture',
  versionLabel: '1.0.0', version: sha('b'), status: 'enabled', valid: true, error: '', origin: { kind: 'project-file' },
  compatibility: '', license: '', requirements: { toolboxes: [], allowedTools: [], unsupportedToolboxes: [], unselectedToolboxes: [], scripts: [] },
  assets: [], resolvable: true, ...over,
});

test('only enabled, resolvable skills become options, each naming one exact version', async () => {
  await withSsr(async (server) => {
    const { skillPinOptions } = await server.ssrLoadModule('/src/components/SkillPinPicker.tsx');
    const options = skillPinOptions([
      manifest(),
      manifest({ id: `skill_${'c'.repeat(32)}`, status: 'disabled', resolvable: false }),
      manifest({ id: `skill_${'d'.repeat(32)}`, status: 'updated', resolvable: false }),
      manifest({ id: `skill_${'e'.repeat(32)}`, resolvable: false, requirements: { toolboxes: [], allowedTools: [], unsupportedToolboxes: [], unselectedToolboxes: [], scripts: ['synthetic/scripts/x.py'] } }),
      manifest({ id: `skill_${'f'.repeat(32)}`, versionLabel: '', name: 'Unlabelled', version: sha('9') }),
      manifest({ id: 'not-a-skill-id' }),
      manifest({ id: `skill_${'1'.repeat(32)}`, version: 'not-a-hash' }),
      null,
    ]);
    assert.deepEqual(JSON.parse(JSON.stringify(options)), [
      { value: `skill_${'a'.repeat(32)}@${sha('b')}`, label: 'Synthetic helper · v1.0.0', title: `synthetic/SKILL.md · SHA-256 ${'b'.repeat(12)}` },
      { value: `skill_${'f'.repeat(32)}@${sha('9')}`, label: 'Unlabelled', title: `synthetic/SKILL.md · SHA-256 ${'9'.repeat(12)}` },
    ]);
    assert.deepEqual(skillPinOptions(undefined), []);
  });
});

test('the picker is a labelled select defaulting to Automatic, and absent with nothing to pin', async () => {
  await withSsr(async (server) => {
    const React = require('react');
    const { renderToStaticMarkup } = require('react-dom/server');
    const { SkillPinSelect, skillPinOptions } = await server.ssrLoadModule('/src/components/SkillPinPicker.tsx');
    assert.equal(renderToStaticMarkup(React.createElement(SkillPinSelect, { options: [], value: '', onChange() {} })), '');
    const options = skillPinOptions([manifest()]);
    const html = renderToStaticMarkup(React.createElement(SkillPinSelect, { options, value: options[0].value, onChange() {}, disabled: true }));
    assert.match(html, /<select[^>]*aria-label="Skill for the next message"/);
    assert.match(html, /<select[^>]*disabled=""/);
    assert.match(html, /<option value="">Automatic<\/option>/);
    assert.match(html, new RegExp(`<option value="${options[0].value}" title="[^"]+" selected="">Synthetic helper · v1.0.0</option>`));
    assert.match(html, /do not grant tools or permissions/);
  });
});

test('Sources shows where a skill came from and why bundled scripts block it', async () => {
  await withSsr(async (server) => {
    const { skillOriginText } = await server.ssrLoadModule('/src/components/InstructionSkills.tsx');
    assert.equal(skillOriginText(undefined), '');
    assert.equal(skillOriginText({ kind: 'project-file' }), 'Uploaded to this project');
    assert.equal(skillOriginText({ kind: 'attached-folder' }), 'From an attached folder');
    assert.equal(skillOriginText({ kind: 'published', publisher: 'Synthetic', sourcePath: 'skills/x/SKILL.md', retrievedAt: '2026-09-01T10:00:00.000Z' }),
      'Published by Synthetic (skills/x/SKILL.md), copied on 2026-09-01');
    assert.equal(skillOriginText({ kind: 'published' }), 'Published by an external source, copied');
  });
  const source = fs.readFileSync(path.join(__dirname, '../../src/components/InstructionSkills.tsx'), 'utf8');
  assert.match(source, /skillOriginText\(skill\.origin, t\)/);
  assert.match(source, /projects\.skills\.scripts'/);
});

test('the composer sends the chosen pin with that one message only, and App forwards it to /api/chat', () => {
  // Wiring check alongside the render tests above: the pin travels ChatView -> App -> streamChat.
  const chatView = fs.readFileSync(path.join(__dirname, '../../src/components/ChatView.tsx'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '../../src/App.tsx'), 'utf8');
  assert.match(chatView, /\.\.\.\(skillPin \? \{ skill: skillPin as SkillPin \} : \{\}\)/);
  assert.match(chatView, /setTurnBoxes\(\[\]\);\n\s+setSkillPin\(''\);/, 'cleared after the send');
  assert.match(chatView, /useSkillPinOptions\(project\?\.id \?\? null, [^)]*streaming[^)]*, mode !== 'cowork'\)/, 'refreshed after each reply; never offered to Cowork tasks');
  assert.match(app, /\.\.\.\(turn\.skill \? \{ skill: turn\.skill \} : \{\}\)/);
});

test('Retry resends the pin its message was sent with, and the project home composer can pin (#562, #564)', () => {
  const app = fs.readFileSync(path.join(__dirname, '../../src/App.tsx'), 'utf8');
  const view = fs.readFileSync(path.join(__dirname, '../../src/components/ProjectView.tsx'), 'utf8');
  assert.match(app, /const sentPin = storablePin\(turn\.skill\);\n\s+const userMsg: Message = \{ id: uid\(\), role: 'user', content: text, \.\.\.\(sentPin \? \{ skill: sentPin \} : \{\}\) \};/, 'the pin is kept on the user turn (#571)');
  // #682 adds a text-free resend marker next to the pin.
  assert.match(app, /const pin = storablePin\(msgs\[index - 1\]\.skill\);\n\s+void handleSend\(chatId, projectId, msgs\[index - 1\]\.content, rerunBase\(msgs, index\), \{ \.\.\.\(pin \? \{ skill: pin \} : \{\}\), resend: resendOutcome\('retry', failed\) \}\)/);
  assert.doesNotMatch(app, /sentSkillPins/, 'no in-memory-only pin map: a reload would lose it');
  assert.match(app, /skill: m\.role === 'user' \? m\.skill : undefined/, 'saved with the transcript');
  assert.match(app, /pendingFirstSend\.current = \{ chatId, projectId, text, \.\.\.\(skill \? \{ skill \} : \{\}\) \}/);
  assert.match(app, /pending\.skill \? \{ skill: pending\.skill \} : \{\}/);
  assert.match(view, /<SkillPinSelect options=\{skillOptions\}/);
  assert.match(view, /onSendFirst\(project\.id, text, skillPin \? \(skillPin as SkillPin\) : undefined\)/);
});

test('Sources labels an enabled skill that has scripts as unusable in chat, and cannot enable one (#567)', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../src/components/InstructionSkills.tsx'), 'utf8');
  assert.match(source, /skill\.status === 'enabled' && skill\.scripts\?\.length \? t\('projects\.skills\.scriptsState'\) : t\(STATUS_KEY\[skill\.status\]\)/);
  assert.match(source, /\(skill\.status !== 'enabled' && !!skill\.scripts\?\.length\)/);
});
