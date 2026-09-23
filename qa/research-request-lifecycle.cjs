// Controlled App/Sidebar/ProjectView/ResearchPanel request lifecycle. Synthetic APIs only.
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { createFixture } = require('./diary-fixture.cjs');

const PORT = 31473;
const project = (id, name) => ({ id, name, goal:'', instructions:'', memories:[], files:[], assets:[], chats:[], toolboxes:['core'], createdAt:1, updatedAt:1, modes:['chat'] });
const budget = { maxWebCalls:12, maxMs:600000, resultsPerQuery:5 };
const state = (jobs = []) => ({ budget, available:true, reason:null, jobs });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const job = (extra = {}) => ({ id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', status:'queued', stage:'Starting',
  plan:{ status:'skipped', question:'B task', subQuestions:[] }, error:null, createdAt:1, updatedAt:2,
  checkpoint:null, artifacts:[], result:null, canSavePartial:false, ...extra });
const aJob = () => job({ id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', status:'running',
  plan:{ status:'skipped', question:'A running task', subQuestions:[] } });

(async () => {
  const watchdog = setTimeout(() => { console.error('Timed out waiting for a controlled Research request'); process.exit(1); }, 60000);
  const fixture = createFixture(PORT); await fixture.listen();
  const browser = await chromium.launch({ headless:true, channel:'chrome' });
  try {
    const page = await browser.newPage({ viewport:{ width:1440, height:900 } });
    let workspaceGets = 0;
    await page.route('**/api/workspace', route => { workspaceGets++; return route.fulfill({ json:{ projects:[project('a','Project A'), project('b','Project B')], freeChats:[] } }); });
    await page.route('**/api/projects/*/skills', route => route.fulfill({ json:{ skills:[] } }));
    await page.route('**/api/features', route => route.fulfill({ json:{ flags:{ deepResearch:true } } }));
    let heldAPlan = null, heldAGet = null, aJobs = [];
    await page.route('**/api/projects/a/research**', async route => {
      if (route.request().method() !== 'POST') {
        if (heldAGet) {
          const held = heldAGet; heldAGet = null; held.started.resolve(); await held.release.promise;
          return held.error ? route.fulfill({ status:503, json:{ error:'Old A read failed' } }) : route.fulfill({ json:state(held.jobs) });
        }
        return route.fulfill({ json:state(aJobs) });
      }
      if (!new URL(route.request().url()).pathname.endsWith('/plan')) { aJobs = [aJob()]; return route.fulfill({ status:202, json:aJobs[0] }); }
      if (heldAPlan) { const held = heldAPlan; heldAPlan = null; held.started.resolve(); await held.release.promise; }
      return route.fulfill({ json:{ subQuestions:['A plan from Project A'] } });
    });
    let bJobs = [], failNextBGet = false, heldGet = null, bGetCount = 0;
    await page.route('**/api/projects/b/research**', async route => {
      const url = new URL(route.request().url());
      if (route.request().method() === 'GET') {
        bGetCount++;
        if (heldGet) { const held = heldGet; heldGet = null; held.started.resolve(); await held.release.promise; return route.fulfill({ json:state(held.jobs) }); }
        if (failNextBGet) { failNextBGet = false; return route.fulfill({ status:503, json:{ error:'Research refresh failed' } }); }
        return route.fulfill({ json:state(bJobs) });
      }
      if (url.pathname.endsWith('/cancel')) bJobs = [job({ status:'cancelled', stage:null, canSavePartial:true })];
      else if (url.pathname.endsWith('/save')) bJobs = [job({ status:'completed', stage:null, artifacts:['B partial report.md'] })];
      else bJobs = [job()];
      return route.fulfill({ status:url.pathname.endsWith('/research') ? 202 : 200, json:bJobs[0] });
    });

    await page.goto(`http://localhost:${PORT}`);
    await page.getByPlaceholder('Message noevia…').waitFor();
    await page.getByRole('button', { name:'Open Project A' }).click();
    await page.getByRole('tab', { name:'Research' }).click();
    await page.getByLabel('Research question').fill('A private draft');
    await page.getByRole('button', { name:'Propose a plan' }).click();
    await page.getByLabel('Plan question 1').waitFor();
    await page.getByRole('button', { name:'Discard plan' }).click();
    const stalePlan = { started:deferred(), release:deferred() };
    heldAPlan = stalePlan;
    await page.getByRole('button', { name:'Propose a plan' }).click();
    await stalePlan.started.promise;
    await page.getByRole('button', { name:'Open Project B' }).click();
    await page.getByRole('heading', { name:'Project B' }).waitFor();
    stalePlan.release.resolve();
    await page.getByRole('tab', { name:'Research' }).waitFor();
    await page.getByRole('tab', { name:'Research' }).click();
    await page.getByLabel('Research question').waitFor();
    assert.equal(await page.getByLabel('Research question').inputValue(), '', 'Project B must not inherit A’s draft');
    assert.equal(await page.getByLabel('Plan question 1').count(), 0, 'Project B must not inherit A’s plan');
    await page.getByLabel('Research question').fill('B task');
    failNextBGet = true;
    await page.getByRole('button', { name:'Start without a plan' }).click();
    await page.getByRole('heading', { name:'B task' }).waitFor();
    await page.getByRole('alert').getByText('Research refresh failed').waitFor();
    assert.equal(await page.getByRole('button', { name:'Cancel', exact:true }).count(), 1,
      'successful start snapshot stays visible after refresh failure');
    const slow = { started:deferred(), release:deferred(), jobs:[job()] };
    heldGet = slow;
    await slow.started.promise;
    const countWhileSlow = bGetCount;
    await page.waitForTimeout(2300);
    assert.equal(bGetCount, countWhileSlow, 'ordinary polls remain single-flight while a read is slow');
    slow.release.resolve();
    const stale = { started:deferred(), release:deferred(), jobs:[job({ artifacts:['Obsolete B report.md'] })] };
    heldGet = stale;
    await stale.started.promise;
    failNextBGet = true;
    await page.getByRole('button', { name:'Cancel', exact:true }).click();
    await page.getByRole('button', { name:'Save partial report' }).waitFor();
    await page.getByRole('alert').getByText('Research refresh failed').waitFor();
    const beforeObsolete = workspaceGets;
    stale.release.resolve();
    await page.waitForTimeout(100);
    assert.equal(await page.getByRole('button', { name:'Cancel', exact:true }).count(), 0,
      'old running poll cannot undo a successful cancellation');
    assert.equal(workspaceGets, beforeObsolete, 'obsolete poll cannot announce a saved report');
    failNextBGet = true;
    const beforeSave = workspaceGets;
    await page.getByRole('button', { name:'Save partial report' }).click();
    await page.getByText('B partial report.md').waitFor();
    await page.getByRole('alert').getByText('Research refresh failed').waitFor();
    for (let i = 0; i < 30 && workspaceGets === beforeSave; i++) await page.waitForTimeout(10);
    assert.equal(workspaceGets, beforeSave + 1, 'successful save announces its new source once');

    // An A poll can finish after the same ProjectView instance has switched to B. Neither a
    // successful old snapshot nor its error belongs in B's card or alert.
    for (const error of [false, true]) {
      await page.getByRole('button', { name:'Open Project A' }).click();
      await page.getByRole('tab', { name:'Research' }).waitFor();
      await page.getByRole('tab', { name:'Research' }).click();
      if (!aJobs.length) {
        await page.getByLabel('Research question').fill('A running task');
        await page.getByRole('button', { name:'Start without a plan' }).click();
      }
      await page.getByRole('heading', { name:'A running task' }).waitFor();
      const oldARead = { started:deferred(), release:deferred(), jobs:[aJob()], error };
      heldAGet = oldARead;
      await oldARead.started.promise;
      await page.getByRole('button', { name:'Open Project B' }).click();
      await page.getByRole('tab', { name:'Research' }).waitFor();
      await page.getByRole('tab', { name:'Research' }).click();
      await page.getByText('B partial report.md').waitFor();
      oldARead.release.resolve();
      await page.waitForTimeout(100);
      assert.equal(await page.getByRole('heading', { name:'A running task' }).count(), 0, 'old A GET cannot replace B jobs');
      assert.equal(await page.getByText('Old A read failed').count(), 0, 'old A GET failure cannot appear in B');
    }
    await page.close();
    console.log('PASS research request lifecycle: project reset, stale A plan/GET, slow and stale B polls, successful start/cancel/save snapshots after refresh failures');
  } finally { clearTimeout(watchdog); await browser.close(); await fixture.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
