const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../../src/setup-timezone.ts'), 'utf8');
const exportsObject = {};
vm.runInNewContext(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, { exports: exportsObject, Intl });
const { timezoneEnvSetting } = exportsObject;

test('setup produces a usable TZ setting for IANA zones and UTC', () => {
  for (const zone of ['America/New_York', 'Asia/Kolkata', 'Europe/London', 'UTC']) {
    assert.equal(timezoneEnvSetting(` ${zone} `), `TZ=${zone}`);
  }
});

test('setup refuses invalid zones, fixed offsets, and env injection', () => {
  for (const zone of ['', 'Not/AZone', '-04:00', 'UTC\nOTHER=value', '$(date)', 'UTC#comment']) {
    assert.equal(timezoneEnvSetting(zone), null);
  }
});
