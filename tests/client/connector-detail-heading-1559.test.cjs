// #1559: a connector's own page (Google Drive, Nextcloud) kept the list heading "Connected" above its
// back link, so it read as a list with one item open underneath. The heading is now the list's, and
// only the list renders it. A layout is not measurable from Node, so these are source contracts on
// where the heading is rendered relative to the detail-page returns.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '../../src');
const connectors = fs.readFileSync(path.join(SRC, 'components/connectors/ConnectorsSettings.tsx'), 'utf8');
const view = fs.readFileSync(path.join(SRC, 'components/plugins/PluginsView.tsx'), 'utf8');

test('PluginsView no longer draws the Connected heading itself; it hands the heading to the connector list', () => {
  assert.doesNotMatch(view, /<h2 className="plugins-subhead">\{t\('customise\.connectedTitle'\)\}<\/h2>/, 'PluginsView still renders the heading above whatever the Connectors tab shows');
  assert.match(view, /<ConnectorsSettings hideTitle listHeading=\{t\('customise\.connectedTitle'\)\}/, 'the heading is not passed to the connector list');
});

test('the list heading renders only in the list view, after the connector-page returns', () => {
  const headingAt = connectors.indexOf('{listHeading && <h2');
  assert.ok(headingAt > 0, 'the list heading is not rendered at all');
  const driveReturn = connectors.indexOf("if (page === 'gdrive' && drive) return <DrivePage");
  const ncReturn = connectors.indexOf("if (page === 'nextcloud' && nc) return <NextcloudPage");
  assert.ok(driveReturn > 0 && ncReturn > 0, 'the detail-page returns moved; re-check this contract');
  assert.ok(headingAt > Math.max(driveReturn, ncReturn), 'the heading is rendered before the detail pages return, so it would sit above a back link');
  const detailPages = connectors.slice(connectors.indexOf('function DrivePage'));
  assert.doesNotMatch(detailPages, /listHeading/, 'a detail page renders the list heading');
});
