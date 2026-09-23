// Real React components with deferred, synthetic HTTP responses only.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const { createFixture } = require('./diary-fixture.cjs');
const { navClick } = require('./nav.cjs');
const tick = page => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
(async () => {
  const fixture = createFixture(0); await fixture.listen();
  const origin = `http://127.0.0.1:${fixture.server.address().port}`;
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const errors = [];
  try {
    for (const staleFails of [false, true]) {
      const page = await browser.newPage(); page.on('pageerror', e => { errors.push(e.message); console.error(e.message); });
      let first, confirm, calls = 0;
      const old = {kind:'webdav',baseUrl:'https://synthetic.invalid',username:'fixture',corpusRoot:'Old synthetic root'};
      const saved = {...old,corpusRoot:'New synthetic root'};
      await page.route('**/api/integrations/storage', route => {
        if (route.request().method() === 'PUT') return route.fulfill({json:saved});
        calls++;
        if (calls === 1) { first = route; return; }
        if (calls === 3) { confirm = route; return; }
        return route.fulfill({json:old});
      });
      await page.goto(origin); await navClick(page, 'Diary');
      await page.waitForFunction(() => !!document.querySelector('.diary-context'));
      await page.locator('.diary-context').getByRole('button',{name:'Edit',exact:true}).click();
      await page.getByRole('button',{name:/Existing online connection/}).click();
      await page.getByPlaceholder('Corpus folder').fill(saved.corpusRoot);
      await page.getByRole('button',{name:'Save',exact:true}).click();
      await page.waitForFunction(() => document.querySelector('.diary-storage-path')?.textContent === 'New synthetic root');
      // Release the old request while the post-save confirmation is still pending.
      assert.ok(first); await first.fulfill(staleFails ? {status:500,json:{error:'Obsolete storage failure'}} : {json:old});
      await tick(page);
      assert.equal(await page.locator('.diary-storage-path').textContent(),saved.corpusRoot);
      assert.equal(await page.getByRole('alert').filter({hasText:/storage|Obsolete/}).count(),0);
      assert.ok(confirm); await confirm.fulfill({status:500,json:{error:'Current storage failure'}});
      await page.getByRole('button',{name:'Retry storage',exact:true}).waitFor();
      if (!staleFails) for (const theme of ['light','dark']) for (const width of [375,768,1440]) {
        await page.setViewportSize({width,height:950});
        await page.evaluate(t => document.documentElement.setAttribute('data-theme',t),theme);
        const retry=page.getByRole('button',{name:'Retry storage',exact:true}); await page.keyboard.press('Tab'); await retry.focus();
        await page.waitForTimeout(150);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth<=innerWidth));
        assert.ok(await retry.evaluate(el => el===document.activeElement && getComputedStyle(el).outlineStyle!=='none'));
        await page.screenshot({path:`/tmp/noevia-ordered-storage-${width}-${theme}.png`});
      }
      await page.getByRole('button',{name:'Retry storage',exact:true}).click();
      await page.waitForFunction(() => document.querySelector('.diary-storage-path')?.textContent === 'Old synthetic root');
      assert.equal(await page.getByRole('button',{name:'Retry storage',exact:true}).count(),0);
      await page.close();
    }
    const page = await browser.newPage(); page.on('pageerror', e => { errors.push(e.message); console.error(e.message); });
    let held, hold = false;
    let workspace = {projects:[],freeChats:[]};
    await page.route('**/api/workspace', route => {
      if (hold) { hold = false; held = route; return; }
      return route.fulfill({json:workspace});
    });
    await page.goto(origin); await page.getByRole('textbox',{name:'Message',exact:true}).waitFor();
    const refresh = () => page.evaluate(() => window.dispatchEvent(new Event('noevia:workspace-changed')));
    hold = true; await refresh();
    while (!held) await tick(page);
    workspace = {projects:[],freeChats:[{id:'restored',title:'Restored synthetic chat',updatedAt:new Date().toISOString()}]};
    await refresh(); await page.getByText('Restored synthetic chat',{exact:true}).waitFor();
    await held.fulfill({json:{projects:[],freeChats:[]}}); await tick(page);
    assert.equal(await page.getByText('Restored synthetic chat',{exact:true}).count(),1);
    // A project create/save triggers another refresh while an earlier event load waits.
    held = null; hold = true; await refresh(); while (!held) await tick(page);
    const project = {id:'created',name:'Saved synthetic project',goal:'',instructions:'',files:[],memories:[],sourceFolders:[],chats:[],createdAt:1,updatedAt:1,model:'auto',toolboxes:[]};
    await page.route('**/api/projects', route => {
      workspace = {...workspace, projects:[project]};
      return route.fulfill({json:project});
    });
    await navClick(page,'Projects');
    await page.getByRole('button',{name:/Create project|New project/}).first().click();
    await page.getByLabel('What are you working on?',{exact:true}).fill(project.name);
    await page.getByRole('button',{name:'Create project',exact:true}).click();
    await page.getByText(project.name,{exact:true}).first().waitFor();
    await held.fulfill({json:{projects:[],freeChats:[]}}); await tick(page);
    assert.ok(await page.getByText(project.name,{exact:true}).count());
    assert.equal(await page.getByText('Restored synthetic chat',{exact:true}).count(),1);
    await page.close(); assert.deepEqual(errors,[]); assert.equal(fixture.requests.length,0);
    console.log('PASS: stale storage success/error ignored across save, current failure retries; workspace event and create/save refreshes remain authoritative.');
  } finally { await browser.close(); await fixture.close(); }
})().catch(e => { console.error(e); process.exitCode=1; });
