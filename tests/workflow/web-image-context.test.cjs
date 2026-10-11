'use strict';
// #1312: execute the workflow's real assembly step over synthetic sources, without Docker.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const web = path.resolve(__dirname, '../..');
const self = fs.existsSync(path.join(web, '.github/workflows/ci.yml')) ? web : path.resolve(web, '../../../self');
const integration = process.env.NOEVIA_CHECKOUT || path.resolve(web, '../..');

test('web image assembly supplies the actual Dockerfile COPY inputs', () => {
  const workflow = fs.readFileSync(path.join(self, '.github/workflows/ci.yml'), 'utf8');
  const [client, image] = workflow.split(/^  web-image:\s*$/m);
  assert.match(client, /^      - run: node --test tests\/workflow\/\*\.test\.cjs$/m, 'host CI must invoke workflow regression');
  assert.ok(image, 'web-image job must exist');
  // Parse the existing literal shell step, preserving its bytes and environment values.
  const steps = image.split(/^      - /m);
  const matches = steps.filter(x => x.startsWith('name: Lay out an assembled release tree\n'));
  assert.equal(matches.length, 1, 'exactly one image assembly step');
  const step = matches[0];
  const run = step.match(/^        run: \|\n((?:          .*\n|\n)+)/m);
  assert.ok(run, 'assembly must remain an explicit literal shell step');
  const shell = run[1].split('\n').map(line => line.startsWith('          ') ? line.slice(10) : line).join('\n');
  const env = Object.fromEntries([...step.matchAll(/^          (WEB|CORE): ([\w/-]+)$/gm)].map(m => [m[1], m[2]]));
  assert.deepEqual(env, { WEB: 'self', CORE: 'sib/noevia-core' });
  assert.match(image, /context: \$\{\{ env\.TREE \}\}/);
  const docker = fs.readFileSync(path.join(integration, 'build/web.Dockerfile'), 'utf8');
  assert.match(docker, /^COPY rs\/ \/src\/$/m);
  assert.match(docker, /^COPY noevia\/build\/web-supervisor\.sh \/app\/web-supervisor\.sh$/m);
  assert.match(docker, /node --test --test-timeout=120000 tests\/client\/\*\.test\.cjs tests\/server\/\*\.test\.cjs/);
  assert.doesNotMatch(docker, /node --test[^\n]*(?:tests\/workflow|tests\/\*\*)/, 'Docker test glob must exclude host-only workflow tests');
  const supervisor = fs.readFileSync(path.join(integration, 'build/web-supervisor.sh'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'noevia-web-context-'));
  try {
    for (const repo of ['self', 'sib/noevia-core', 'ws']) {
      const source = path.join(dir, repo); fs.mkdirSync(source, { recursive: true });
      fs.writeFileSync(path.join(source, 'synthetic.txt'), repo);
      if (repo === 'ws') {
        fs.mkdirSync(path.join(source, 'build'));
        fs.writeFileSync(path.join(source, 'build/web-supervisor.sh'), supervisor);
      }
      const git = (...args) => execFileSync('git', ['-C', source, ...args], { stdio: 'pipe' });
      git('init', '-q'); git('add', '.');
      git('-c', 'user.name=Synthetic', '-c', 'user.email=synthetic@example.invalid', 'commit', '-qm', 'synthetic context');
    }
    const temp = path.join(dir, 'runner'); fs.mkdirSync(temp);
    const githubEnv = path.join(dir, 'github-env'); fs.writeFileSync(githubEnv, '');
    execFileSync('bash', ['-c', shell], { cwd: dir, env: { ...process.env, ...env, RUNNER_TEMP: temp, GITHUB_ENV: githubEnv }, stdio: 'pipe' });
    const tree = path.join(temp, 'tree');
    assert.ok(fs.statSync(path.join(tree, 'rs')).isDirectory(), 'required rs/ COPY input');
    assert.deepEqual(fs.readFileSync(path.join(tree, 'noevia/build/web-supervisor.sh')), supervisor, 'required supervisor COPY input matches actual checkout');
    for (const repo of ['web', 'core']) assert.ok(fs.existsSync(path.join(tree, repo, 'synthetic.txt')));
    assert.equal(fs.readFileSync(githubEnv, 'utf8'), `TREE=${tree}\n`);
    assert.match(fs.readFileSync(path.join(tree, 'release-refs'), 'utf8'), /^NOEVIA_SHA=[a-f0-9]{40}\nNOEVIA_WEB_SHA=[a-f0-9]{40}\nNOEVIA_CORE_SHA=[a-f0-9]{40}\nNOEVIA_SERVICES_SHA=ci\n$/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
