'use strict';
// #1613: an AI provider's address wraps at its path slashes, dots and hyphens, never inside a word
// first. urlParts only decides where the breaks go; joining the parts gives the address back.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { urlParts } = require('../../src/url-wrap.ts');

test('the parts join back to the exact address', () => {
  for (const url of ['http://host.docker.internal:8013/v1', 'https://api.synthetic-provider.example.invalid/openai/v1/chat/completions?a=1&b=2#top', 'localhost', '', 'a//b']) {
    assert.equal(urlParts(url).join(''), url);
  }
});

test('breaks fall after a slash, dot, hyphen, underscore or query separator, so a path word stays whole', () => {
  assert.deepEqual(urlParts('https://api.example.invalid/openai/v1/chat'), ['https://', 'api.', 'example.', 'invalid/', 'openai/', 'v1/', 'chat']);
  assert.deepEqual(urlParts('my-model_name'), ['my-', 'model_', 'name']);
  assert.deepEqual(urlParts('a?x=1&y=2'), ['a?', 'x=', '1&', 'y=', '2']);
});

test('the two slashes after the scheme are never split', () => {
  assert.deepEqual(urlParts('http://a'), ['http://', 'a']);
});

test('an address with no break point is a single part', () => {
  assert.deepEqual(urlParts('localhost:8013'), ['localhost:8013']);
});
