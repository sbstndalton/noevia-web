// Request-lifecycle regression for the real App/Sidebar/ProjectView/CodePanel tree. All APIs
// are intercepted synthetic values: no harness, repository, account, model, or storage is used.
const assert = require('node:assert/strict');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const {createFixture} = require('./diary-fixture.cjs');
const {navClick} = require('./nav.cjs');

const PORT = 31472;
const TASK_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TASK_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CAPS = ['read_repository', 'edit_file', 'execute_command', 'install_dependency', 'network', 'delete', 'git_push'];
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return {promise, resolve};
};
const project = (id, name) => ({id, name, goal:'', instructions:'', memories:[], files:[], assets:[], chats:[], toolboxes:['core'], createdAt:1, updatedAt:1, modes:['chat']});
const approval = {id:'approval-a', action:'edit_file', title:'Edit stale-a.txt', kind:'edit', command:'', paths:['/stale-a.txt'], reason:'', arguments:{path:'/stale-a.txt'}, diff:null};
const task = (id, name, status, extra={}) => ({id, status, stage:status, error:null, createdAt:1, updatedAt:2, task:name, branch:`qa/${id[0]}`, meta:null,
  identityHash:null, capabilities:['read_repository', 'edit_file'], steps:[], plan:null, assistantOutput:null, approval:null, result:null, ...extra});
const state = (which, tasks) => ({
  repositories: which === 'a' ? [{id:'a-default'}, {id:'a-special'}] : [{id:'b-default'}, {id:'b-special'}],
  capabilities:CAPS, defaultCapabilities:which === 'a' ? ['read_repository', 'network'] : ['read_repository'],
  harnesses:which === 'a' ? [{id:'a-harness', label:'A harness', version:'1'}, {id:'a-other', label:'A other', version:'1'}]
    : [{id:'b-harness', label:'B harness', version:'2'}, {id:'b-other', label:'B other', version:'2'}],
  promptPreparation:[{id:'direct', label:'Direct', available:true, reason:`${which.toUpperCase()} direct`}, {id:'local', label:'Local', available:true, reason:`${which.toUpperCase()} local`}],
  sandboxed:true, network:true, tasks,
});

async function openProject(page, name) {
  await navClick(page, 'Projects');
  await page.locator('.project-card').filter({hasText:name}).first().click();
  await page.getByRole('heading', {name}).waitFor();
}
async function openCode(page) {
  await page.getByRole('tab', {name:'Code'}).waitFor();
  await page.getByRole('tab', {name:'Code'}).click();
  await page.getByRole('heading', {name:'Code', exact:true}).waitFor();
}
async function directProject(page, name) {
  await page.getByRole('button', {name:`Open ${name}`}).click();
  await page.getByRole('heading', {name}).waitFor();
}

(async () => {
  const watchdog = setTimeout(() => {
    console.error(new Error('Timed out waiting for a controlled Code request'));
    process.exit(1);
  }, 60000);
  const fixture = createFixture(PORT); await fixture.listen();
  const browser = await chromium.launch({headless:true, channel:'chrome'});
  const errors = [];
  try {
    const page = await browser.newPage({viewport:{width:1440, height:900}});
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/workspace', route => route.fulfill({json:{projects:[project('a', 'Project A'), project('b', 'Project B')], freeChats:[]}}));
    await page.route('**/api/projects/*/skills', route => route.fulfill({json:{skills:[]}}));
    await page.route('**/api/features', route => route.fulfill({json:{flags:{codeHarness:true}}}));

    let aTasks = [task(TASK_A, 'Synthetic A task', 'waiting_approval', {approval})];
    let bTasks = [];
    const getQueues = {a:[], b:[]};
    const heldMutations = {a:null, b:null};
    const decisions = [];

    const queueGet = (which, response) => {
      const started = deferred(), release = deferred();
      getQueues[which].push({started, release, ...response});
      return {started, release};
    };
    const routeCode = async (which, route) => {
      const request = route.request();
      const url = new URL(request.url());
      const current = () => which === 'a' ? aTasks : bTasks;
      if (request.method() === 'POST') {
        if (url.pathname.endsWith('/approve')) {
          decisions.push(request.postDataJSON().decision);
          aTasks = [task(TASK_A, 'Synthetic A task', 'running')];
          return route.fulfill({json:{ok:true}});
        }
        if (url.pathname.endsWith('/cancel')) {
          const held = heldMutations[which];
          if (held) {
            held.started.resolve();
            await held.release.promise;
            if (held.status) return route.fulfill({status:held.status, json:{error:held.error}});
          }
          const finished = task(which === 'a' ? TASK_A : TASK_B, which === 'a' ? 'Synthetic A task' : 'Synthetic B task', 'completed');
          if (which === 'a') aTasks = [finished]; else bTasks = [finished];
          return route.fulfill({json:finished});
        }
        const started = task(which === 'a' ? TASK_A : TASK_B, which === 'a' ? 'Delayed A success' : 'Synthetic B task', 'running');
        if (which === 'a') aTasks = [started]; else bTasks = [started];
        return route.fulfill({status:202, json:{taskId:started.id, branch:`qa/${which}`}});
      }
      const queued = getQueues[which].shift();
      if (queued) {
        queued.started.resolve();
        await queued.release.promise;
        if (queued.status) return route.fulfill({status:queued.status, json:{error:queued.error}});
        return route.fulfill({json:state(which, queued.tasks)});
      }
      return route.fulfill({json:state(which, current())});
    };
    await page.route('**/api/projects/a/code**', route => routeCode('a', route));
    await page.route('**/api/projects/b/code**', route => routeCode('b', route));

    await page.goto(`http://localhost:${PORT}`);
    await page.getByPlaceholder('Message noevia…').waitFor();
    await openProject(page, 'Project A');
    await openCode(page);
    await page.getByRole('group', {name:'Approval required'}).waitFor();

    // A valid GET slower than the one-second approval interval must still become visible; ordinary
    // polls do not continually supersede it merely because their timer fired later.
    const slowCurrent = queueGet('a', {tasks:[task(TASK_A, 'Slow current snapshot', 'waiting_approval', {approval})]});
    await slowCurrent.started.promise;
    await page.waitForTimeout(1300);
    slowCurrent.release.resolve();
    await page.getByRole('heading', {name:'Slow current snapshot'}).waitFor();
    await page.getByRole('heading', {name:'Synthetic A task'}).waitFor();

    // A pre-decision approval snapshot must not replace the mutation's newer refresh.
    const staleApproval = queueGet('a', {tasks:[task(TASK_A, 'Synthetic A task', 'waiting_approval', {approval})]});
    await staleApproval.started.promise;
    await page.getByRole('button', {name:'Allow once'}).click();
    await page.getByRole('group', {name:'Approval required'}).waitFor({state:'detached'});
    const resumedPoll = queueGet('a', {tasks:[task(TASK_A, 'Synthetic A task', 'running')]});
    await resumedPoll.started.promise;
    resumedPoll.release.resolve();
    staleApproval.release.resolve();
    await page.waitForTimeout(300);
    assert.equal(await page.getByRole('group', {name:'Approval required'}).count(), 0, 'an obsolete approval snapshot returned');
    assert.deepEqual(decisions, ['approve']);

    // A delayed failure that began before a newer successful poll cannot surface an old error.
    const staleFailure = queueGet('a', {status:500, error:'Synthetic stale same-project failure'});
    await staleFailure.started.promise;
    await page.getByRole('button', {name:'Cancel task'}).click();
    await page.getByText('Finished').waitFor();
    staleFailure.release.resolve();
    await page.waitForTimeout(300);
    assert.equal(await page.getByText('Synthetic stale same-project failure').count(), 0, 'an obsolete same-project failure surfaced');

    // Build unmistakable A-only composer identity and switch directly without remounting it first.
    aTasks = [];
    await page.getByRole('tab', {name:/Chats/}).click();
    await openCode(page);
    await page.getByLabel('Repository', {exact:true}).selectOption('a-special');
    await page.getByLabel('Harness').selectOption('a-other');
    await page.getByLabel('Prompt preparation').selectOption('local');
    await page.getByLabel('What should it do?').fill('A-only draft');
    await page.getByLabel('Domains it may reach').fill('a.example.test');

    await directProject(page, 'Project B');
    await openCode(page);
    assert.equal(await page.getByLabel('Repository', {exact:true}).inputValue(), 'b-default');
    assert.equal(await page.getByLabel('Harness').inputValue(), 'b-harness');
    assert.equal(await page.getByLabel('Prompt preparation').inputValue(), 'direct');
    assert.equal(await page.getByLabel('What should it do?').inputValue(), '');
    assert.equal(await page.getByLabel('Reach the network').isChecked(), false);
    assert.equal(await page.getByLabel('Domains it may reach').count(), 0, 'A domains survived in B');

    // Return to A, start a task through the real composer, then hold one of its ordinary polls.
    await directProject(page, 'Project A');
    await openCode(page);
    await page.getByLabel('Repository', {exact:true}).selectOption('a-special');
    await page.getByLabel('Harness').selectOption('a-other');
    await page.getByLabel('Prompt preparation').selectOption('local');
    await page.getByLabel('What should it do?').fill('Start delayed A task');
    await page.getByLabel('Reach the network').check();
    await page.getByLabel('Domains it may reach').fill('a.example.test');
    await page.getByRole('button', {name:'Start task'}).click();
    await page.getByText('Delayed A success').waitFor();
    const delayedA = queueGet('a', {tasks:[...aTasks]});
    await delayedA.started.promise;
    const delayedBAccess = queueGet('b', {tasks:[]});
    await page.evaluate(() => {
      window.__codeLeaks = [];
      new MutationObserver(() => {
        if (document.querySelector('h1')?.textContent?.includes('Project B') &&
          (document.body.textContent?.includes('Delayed A success') || document.body.textContent?.includes('A other'))) {
          window.__codeLeaks.push(document.body.textContent);
        }
      }).observe(document.body, {subtree:true, childList:true, characterData:true});
    });
    await directProject(page, 'Project B');
    await page.getByRole('tab', {name:/Chats/}).waitFor();
    assert.equal(await page.getByRole('tab', {name:'Code'}).count(), 0, 'A access kept Code mounted while B access was pending');
    delayedA.release.resolve();
    await page.waitForTimeout(200);
    assert.equal(await page.getByText('Delayed A success').count(), 0, 'A success rendered before B access resolved');
    delayedBAccess.release.resolve();
    await openCode(page);
    assert.equal(await page.getByText('Delayed A success').count(), 0, 'A success rendered after B response');
    assert.deepEqual(await page.evaluate(() => window.__codeLeaks), [], 'A content painted under the B heading');
    assert.equal(await page.getByLabel('Repository', {exact:true}).inputValue(), 'b-default');
    assert.equal(await page.getByLabel('Harness').inputValue(), 'b-harness');

    // The same cross-project ordering guard applies to rejected A reads after B is current.
    await directProject(page, 'Project A');
    await openCode(page);
    aTasks = [task(TASK_A, 'A before rejected poll', 'running')];
    await page.getByRole('tab', {name:/Chats/}).click();
    await openCode(page);
    await page.getByText('A before rejected poll').waitFor();
    const rejectedA = queueGet('a', {status:500, error:'Synthetic stale cross-project failure'});
    await rejectedA.started.promise;
    await directProject(page, 'Project B');
    await openCode(page);
    rejectedA.release.resolve();
    await page.waitForTimeout(300);
    assert.equal(await page.getByText('Synthetic stale cross-project failure').count(), 0, 'A failure rendered in B');
    assert.equal(await page.getByText('A before rejected poll').count(), 0, 'A task remained in B');

    // A successful mutation's follow-up GET may remain held across the project switch. Its result
    // and finally block still belong only to the old A instance.
    aTasks = [task(TASK_A, 'A mutation task', 'running')];
    await directProject(page, 'Project A');
    await openCode(page);
    await page.getByText('A mutation task').waitFor();
    const heldFollowup = queueGet('a', {tasks:[task(TASK_A, 'A completed late', 'completed')]});
    await page.getByRole('button', {name:'Cancel task'}).click();
    await heldFollowup.started.promise;
    await directProject(page, 'Project B');
    await openCode(page);
    heldFollowup.release.resolve();
    await page.waitForTimeout(300);
    assert.equal(await page.getByText('A completed late').count(), 0, 'A post-mutation refresh changed B');

    // A rejected A mutation cannot surface its error or clear B's busy state. Hold B's own POST,
    // release A first, and require B to stay disabled until B itself settles.
    aTasks = [task(TASK_A, 'A rejected mutation', 'running')];
    bTasks = [task(TASK_B, 'Synthetic B task', 'running')];
    await directProject(page, 'Project A');
    await openCode(page);
    await page.getByText('A rejected mutation').waitFor();
    heldMutations.a = {started:deferred(), release:deferred(), status:500, error:'Synthetic stale A mutation failure'};
    await page.getByRole('button', {name:'Cancel task'}).click();
    await heldMutations.a.started.promise;
    await directProject(page, 'Project B');
    await openCode(page);
    await page.getByText('Synthetic B task').waitFor();
    heldMutations.b = {started:deferred(), release:deferred()};
    await page.getByRole('button', {name:'Cancel task'}).click();
    await heldMutations.b.started.promise;
    assert.equal(await page.getByRole('button', {name:'Cancel task'}).isDisabled(), true, 'B mutation did not enter busy state');
    heldMutations.a.release.resolve();
    await page.waitForTimeout(300);
    assert.equal(await page.getByText('Synthetic stale A mutation failure').count(), 0, 'A mutation error surfaced in B');
    assert.equal(await page.getByRole('button', {name:'Cancel task'}).isDisabled(), true, 'A finally cleared B busy state');
    heldMutations.b.release.resolve();
    await page.getByText('Finished').waitFor();
    assert.equal(await page.getByRole('button', {name:'Cancel task'}).count(), 0, 'B busy/action state did not settle');

    assert.deepEqual(errors, []);
    console.log('PASS code-request-ordering: obsolete success/failure, mutation refresh, project-scoped access and composer identity through actual App/Sidebar.');
  } finally {
    clearTimeout(watchdog);
    await browser.close();
    await fixture.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
