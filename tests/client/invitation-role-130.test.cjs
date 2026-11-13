'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { JSDOM } = require('jsdom');

// Exercise the real Users card with React state and DOM events. Isolate the card from unrelated
// settings panels; only its API boundary and translation lookup are replaced.
test('invitations default to member, the administrator choice sends admin, and recovery stays separate', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://example.test' });
  const old = Object.fromEntries(['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent: 'test', clipboard: { writeText: async () => {} } } });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const { createRoot } = require('react-dom/client');
  const { act } = React;
  const roles = [], recoveries = [];
  const self = { id: 'self', username: 'owner', displayName: 'Owner', role: 'admin' };
  const api = {
    fetchProfile: async () => ({ user: self }),
    fetchUsers: async () => ({ users: [self, { id: 'other', username: 'other', displayName: 'Other', role: 'member' }] }),
    createInvitation: async role => { roles.push(role); return { token: 'invite-token' }; },
    createRecovery: async id => { recoveries.push(id); return { token: 'recovery-token' }; },
  };
  const source = fs.readFileSync(path.join(__dirname, '../../src/components/SettingsView.tsx'), 'utf8');
  const start = source.indexOf('function UsersCard()');
  const end = source.indexOf('\n/** Connect-a-provider', start);
  assert.ok(start >= 0 && end > start, 'UsersCard source boundary');
  const code = ts.transpileModule('export ' + source.slice(start, end), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports_ = {};
  vm.runInNewContext(code, {
    exports: exports_, require, ...React, ...api,
    window: dom.window, navigator: globalThis.navigator,
    ShellIcon: () => null,
    useT: () => (key, params = {}) => key + (params.role ? ':' + params.role : ''),
  });
  const root = createRoot(document.getElementById('root'));
  const button = key => [...document.querySelectorAll('button')].find(el => el.textContent === key);
  try {
    await act(async () => { root.render(React.createElement(exports_.UsersCard)); });
    const select = document.querySelector('select');
    assert.equal(select.value, 'member');
    assert.ok(select.closest('label').textContent.includes('users.invitationRole'));
    assert.deepEqual([...select.options].map(o => o.value), ['member', 'admin']);
    await act(async () => { button('users.copyInvitation').click(); });
    assert.deepEqual(roles, ['member']);
    await act(async () => {
      select.value = 'admin';
      select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    });
    await act(async () => { button('users.copyInvitation').click(); });
    assert.deepEqual(roles, ['member', 'admin']);
    await act(async () => { button('users.recovery').click(); });
    assert.deepEqual(recoveries, ['other']);
    assert.deepEqual(roles, ['member', 'admin']);
    assert.ok([...document.querySelectorAll('input')].some(input => input.value.includes('?recovery=recovery-token')));
  } finally {
    await act(async () => { root.unmount(); });
    dom.window.close();
    for (const [key, descriptor] of Object.entries(old)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});
