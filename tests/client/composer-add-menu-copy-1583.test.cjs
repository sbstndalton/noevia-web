'use strict';
// #1583: the composer's + menu, Tools for this chat (Manual).
//  - A connector (Google Drive) is ticked because the account connected it, so its row must look
//    enabled (not dimmed like a disabled item) while staying non-interactive.
//  - The "Add files or photos" subtitle must wrap, not be cut mid-phrase ("PDFs up to 60...").
// phone.css is loaded on every width (main.tsx), so its rules decide the desktop look too.
// Pure stylesheet and source checks: no browser in this batch (the Playwright proof is a follow-up).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const phone = read('src/styles/phone.css').replace(/\/\*[\s\S]*?\*\//g, '');
const actions = read('src/components/ComposerActions.tsx');

const ruleBody = (css, selector) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  return match ? match[1] : null;
};

test('#1583 the connector row keeps the enabled look: the disabled dimming does not apply to a connected tool', () => {
  // The row stays disabled (a connector cannot be toggled from this menu), so the override must sit
  // after the generic :disabled dimming with the same specificity, and undo the opacity.
  const dimmed = ruleBody(phone, '.composer-actions-panel .composer-menu-row:disabled');
  assert.ok(dimmed && /opacity:\s*\.45/.test(dimmed), 'the generic disabled row is still dimmed');
  const connected = ruleBody(phone, '.composer-actions-panel .composer-tool-connected:disabled');
  assert.ok(connected, 'phone.css has a rule for a connected, disabled tool row');
  assert.match(connected, /opacity:\s*1\b/);
  assert.ok(phone.indexOf('.composer-tool-connected:disabled') > phone.indexOf('.composer-actions-panel .composer-menu-row:disabled'), 'the override comes after the dimming rule');
});

test('#1583 the connector row carries that class only while the menu is live, and only connector rows do', () => {
  // Only while the menu is live: a disabled or saving menu dims the connector row like every other row.
  assert.match(actions, /className=\{`composer-menu-row composer-tool-option\$\{box\.connector && project && !disabled && !saving \? ' composer-tool-connected' : ''\}`\}/);
  assert.match(actions, /disabled=\{!project \|\| saving \|\| disabled \|\| box\.connector\}/, 'a connector is still not toggled from the menu');
});

test('#1583 the Add-files subtitle wraps instead of being cut with an ellipsis', () => {
  const small = ruleBody(phone, '.composer-actions-panel .composer-menu-row small');
  assert.ok(small, 'the menu row subtitle has a rule');
  assert.doesNotMatch(small, /white-space:\s*nowrap/, 'the subtitle may wrap onto a second line');
  assert.doesNotMatch(small, /text-overflow:\s*ellipsis/, 'the subtitle is not cut with an ellipsis');
  assert.doesNotMatch(small, /overflow:\s*hidden/, 'the subtitle is not clipped');
});
