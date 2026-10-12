// #1561: the Offsite backups switch was named "Copy backups to Google Drive" for screen readers while it
// visibly reads "Offsite backups", so a screen-reader user heard a different action from the one on
// screen. The switch now takes its name from the same catalogue key as the visible row label. Its hit
// area: the drawn track is 36×20, and the switch's ::before extends the touch target to 44×44 (the rule
// in system/components.css). That is checked here from the stylesheet, because layout is not measurable
// from Node.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '../../src');
const connectors = fs.readFileSync(path.join(SRC, 'components/connectors/ConnectorsSettings.tsx'), 'utf8');
const components = fs.readFileSync(path.join(SRC, 'styles/system/components.css'), 'utf8');

test('the Offsite backups switch is named by the same key as its visible label', () => {
  const label = connectors.match(/<span className="row-label">\{t\('(connectors\.backup\.title)'\)\}<\/span>/);
  assert.ok(label, 'the visible Offsite backups label moved');
  const backupSwitch = connectors.slice(connectors.indexOf('connectors.backup.title'), connectors.indexOf('connectors.backup.title') + 1200).match(/<Switch label=\{t\('([^']+)'\)\}/);
  assert.ok(backupSwitch, 'the backup switch has no label');
  assert.equal(backupSwitch[1], label[1], 'the switch is named differently from the label it sits beside');
});

test('the copy-to-Drive name is gone from the code and the catalogues it lived in', () => {
  assert.doesNotMatch(connectors, /connectors\.backup\.switch/);
  const settings = fs.readdirSync(path.join(SRC, 'i18n/settings')).filter((f) => f.endsWith('.ts'));
  for (const file of settings) assert.doesNotMatch(fs.readFileSync(path.join(SRC, 'i18n/settings', file), 'utf8'), /'connectors\.backup\.switch'/, `${file} still carries the unused key`);
});

test('the switch keeps a 44px touch target: its ::before extends the 36×20 track to 44×44', () => {
  const before = components.match(/:root \.glass-switch::before \{([^}]*)\}/);
  assert.ok(before, 'the glass-switch hit-area rule is gone');
  assert.match(before[1], /position:\s*absolute/);
  assert.match(before[1], /inset:\s*-12px\s+-4px/, 'the hit area no longer reaches 44px tall (20 + 2×12) and wide (36 + 2×4)');
  const track = components.match(/:root \.glass-switch \{[^}]*width:\s*36px;\s*height:\s*20px;/);
  assert.ok(track, 'the switch track is no longer 36×20');
  assert.match(components, /:root \.glass-switch \{[^}]*position:\s*relative;/, 'the hit area is not positioned against the switch itself');
});
