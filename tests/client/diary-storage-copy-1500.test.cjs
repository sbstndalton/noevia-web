'use strict';
// #1500: Settings > Diary & storage used developer terms: "If-Match", "corpus folder" and "client
// compatibility" wording in the file-sharing paragraph, and "corpus" in the Diary lede, the storage
// field and the Diary card. The protocol detail moves to operator docs; users see plain words.
const test = require('node:test');
const assert = require('node:assert/strict');
const { catalogue, English, LOCALES } = require('./i18n-catalogue.cjs');

const KEYS = ['sharing.intro', 'storage.corpusFolder', 'diarySettings.lede', 'diarySettings.diaryDesc', 'diary.attachments.storedSeparately', 'users.deletePrompt'];
const DEVELOPER = /If-Match|corpus|Korpus|locking is not|client compatibility/i;

test('#1500 the English file-sharing paragraph says what changes for the user, not the protocol', () => {
  const en = English()['sharing.intro'];
  assert.doesNotMatch(en, /If-Match|corpus|version/i);
  assert.match(en, /Changing a file on another device keeps the old copy in Trash\./);
  assert.match(en, /Files can’t be locked/);
});

test('#1500 the Diary storage field is "Storage folder" and the lede no longer says corpus', () => {
  const en = English();
  assert.equal(en['storage.corpusFolder'], 'Storage folder');
  assert.equal(en['diarySettings.lede'], 'Enable Diary and choose where its journal and files are stored.');
  assert.doesNotMatch(en['diarySettings.diaryDesc'], /corpus/i);
});

test('#1500 no locale shows the developer terms in the Diary storage copy', () => {
  for (const locale of LOCALES) {
    const cat = catalogue(locale);
    for (const key of KEYS) assert.doesNotMatch(cat[key], DEVELOPER, `${locale} ${key}: "${cat[key]}"`);
  }
});

test('#1500 every locale keeps the placeholders of the copy it changed', () => {
  const en = English();
  const holes = (s) => (s.match(/\{\w+\}/g) || []).slice().sort().join(' ');
  for (const locale of LOCALES) {
    for (const key of KEYS) assert.equal(holes(catalogue(locale)[key]), holes(en[key]), `${locale} ${key}`);
  }
});
