'use strict';
// sbstndalton/noevia#2589: the invitation notice names the role in a sentence of its own per role, in every Settings catalogue, and the
// retired keys are gone. Browser proof: qa/users-invitation-role-2589.cjs.
const test = require('node:test'), assert = require('node:assert/strict');
const { SETTINGS_LOCALES, catalogues } = require('./settings-catalogue-b4.cjs');

const all = catalogues(SETTINGS_LOCALES);

test('noevia#2589 every catalogue has both invitation sentences and neither retired key', () => {
  for (const [locale, c] of Object.entries(all)) {
    assert.ok(c['users.invitationMember'] && c['users.invitationAdmin'], `${locale}: both sentences`);
    assert.notEqual(c['users.invitationMember'], c['users.invitationAdmin'], `${locale}: the two differ`);
    assert.ok(!('users.roleInvitation' in c) && !('users.singleUseInvitation' in c), `${locale}: retired keys`);
    assert.ok(!/\{role\}/.test(c['users.invitationMember'] + c['users.invitationAdmin']), `${locale}: no role placeholder left`);
  }
});

test('noevia#2589 the German administrator sentence does not say "für Admin"', () => {
  assert.doesNotMatch(all['de-DE']['users.invitationAdmin'], /für Admin\b/);
});
