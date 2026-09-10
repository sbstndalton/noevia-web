// Browser regression against disposable real servers/accounts. Build first.
// Use an existing Playwright installation via PLAYWRIGHT_MODULE; no app dependency.
// Never points at production or sends a chat/diary prompt.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const web = path.resolve(__dirname, '..');
const origin = 'http://localhost:31237';
const password = 'synthetic onboarding browser password';
const screenshots = process.env.QA_SCREENSHOTS;
async function api(page, url, body, method = 'POST') {
  return page.evaluate(async ({url, body, method}) => {
    const csrf = document.cookie.split(';').map(s => s.trim()).find(s => s.startsWith('cowork_csrf='))?.slice(12) || '';
    const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': decodeURIComponent(csrf) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  }, {url, body, method});
}
async function state(page) { return (await api(page, '/api/auth/session', undefined, 'GET')).body.user; }
async function layout(page, label) {
  for (const width of [375,768,1440]) for (const theme of ['light','dark']) {
    await page.setViewportSize({width,height:1000});
    await page.evaluate(theme => { localStorage.setItem('cowork-theme',theme); document.documentElement.setAttribute('data-theme',theme); }, theme);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${label}: overflow at ${width}/${theme}`);
    await page.getByRole('heading', {level:1}).focus();
    await page.keyboard.press('Tab');
    assert.ok(await page.evaluate(() => { const el = document.activeElement; return el !== document.body && (getComputedStyle(el).outlineStyle !== 'none' || getComputedStyle(el).boxShadow !== 'none'); }), `${label}: focus indicator`);
    if (screenshots) await page.screenshot({path:path.join(screenshots,`${label}-${width}-${theme}.png`),fullPage:true,animations:'disabled'});
  }
}
(async () => {
  if (screenshots) fs.mkdirSync(screenshots,{recursive:true});
  const browser = await chromium.launch({headless:true,channel:'chrome'});
  try {
    for (const diaryEnabled of [false,true]) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(),'cowork-browser-onboarding-'));
      const server = spawn(process.execPath,['server/index.cjs'],{cwd:web,stdio:'ignore',env:{...process.env,UI_DATA_DIR:dir,UI_PORT:'31237',UI_HOST:'127.0.0.1',PUBLIC_ORIGIN:origin,LEGACY_AUTH_COMPAT:'false',DIARY_AUTH_TOKEN:'synthetic-only',INFERENCE_BASE_URL:'http://127.0.0.1:1',DIARY_BASE_URL:'http://127.0.0.1:1',MODEL_MANAGER_KIND:'none',MCP_SERVERS:'',MCP_SERVER_URL:''}});
      const contexts=[];
      try {
        for (let i=0;i<100;i++) { try { if ((await fetch(origin+'/api/setup/status')).ok) break; } catch {} await new Promise(r=>setTimeout(r,50)); }
        const context = await browser.newContext(); contexts.push(context);
        const page = await context.newPage(); const errors=[];
        page.on('pageerror',e=>errors.push(e.message));
        await page.goto(origin);
        await layout(page,`welcome-${diaryEnabled}`);
        await page.getByRole('button',{name:'Get started',exact:true}).click();
        await page.getByRole('button',{name:diaryEnabled?'Yes, I want a diary':'Chat only',exact:true}).click();
        await page.locator('#wiz-code').fill(fs.readFileSync(path.join(dir,'first-run-setup-code'),'utf8').trim());
        await page.locator('#wiz-username').fill('owner');
        await page.locator('#wiz-password').fill(password);
        await layout(page,`fresh-${diaryEnabled}`);
        await page.getByRole('button',{name:'Create account',exact:true}).click();
        await page.getByRole('heading',{name:'Connect an inference provider'}).waitFor();
        assert.equal((await state(page)).diaryEnabled,diaryEnabled);
        await page.reload();
        await page.getByRole('button',{name:'Skip — set up later in Settings',exact:true}).click();
        assert.equal(await page.getByRole('checkbox',{name:'Enable the Diary add-on'}).isChecked(),diaryEnabled);
        if (diaryEnabled) await page.getByRole('button',{name:'Skip — set up later in Settings',exact:true}).click();
        else await page.getByRole('button',{name:'Continue',exact:true}).click();
        await layout(page,`prefs-${diaryEnabled}`);
        await page.getByRole('radio',{name:'Light theme'}).check();
        assert.equal(await page.locator('html').getAttribute('data-theme'),'light');
        await page.getByRole('radio',{name:'Dark theme'}).check();
        await page.getByRole('button',{name:'Skip — set up later',exact:true}).click();
        await layout(page,`passkey-${diaryEnabled}`);
        await page.getByRole('button',{name:'Set up later',exact:true}).click();
        await page.getByRole('heading',{name:'Secure your account',exact:true}).waitFor({state:'hidden'});
        assert.equal((await state(page)).onboarded,true);
        await page.reload();
        assert.equal((await state(page)).onboarded,true);
        for (const role of ['member','admin']) {
          const invitation=await api(page,'/api/admin/invitations',{role});
          assert.equal(invitation.status,201);
          const memberContext=await browser.newContext(); contexts.push(memberContext);
          const member=await memberContext.newPage(); member.on('pageerror',e=>errors.push(e.message));
          await member.goto(origin+'/?invite='+encodeURIComponent(invitation.body.token));
          await member.locator('#username').fill(role+'qa'); await member.locator('#password').fill(password);
          await member.getByRole('checkbox',{name:'Enable Diary add-on'}).setChecked(diaryEnabled);
          await member.getByRole('button',{name:'Create account',exact:true}).click();
          await member.getByRole('heading',{name:role==='member'?'Set up the diary':'Connect an inference provider',exact:true}).waitFor();
          assert.equal(new URL(member.url()).search,'');
          if (role==='admin') await member.getByRole('button',{name:'Skip — set up later in Settings',exact:true}).click();
          await layout(member,`${role}-diary-${diaryEnabled}`);
          assert.equal(await member.getByRole('checkbox',{name:'Enable the Diary add-on'}).isChecked(),diaryEnabled);
          if (role==='member') {
            assert.equal(await member.getByRole('button',{name:'Back',exact:true}).count(),0);
            for (const url of ['/api/admin/invitations','/api/models/download']) assert.equal((await api(member,url,{})).status,403);
          }
          await member.getByRole('button',{name:'Sign out — resume later'}).click();
          await member.locator('#username').fill(role+'qa'); await member.locator('#password').fill(password);
          await member.getByRole('button',{name:'Sign in with password'}).click();
          if (role==='admin') await member.getByRole('button',{name:'Skip — set up later in Settings',exact:true}).click();
          assert.equal(await member.getByRole('checkbox',{name:'Enable the Diary add-on'}).isChecked(),diaryEnabled);
          // Failed saves retain the recorded choice; successful changes survive reload.
          await member.route('**/api/profile/features',r=>r.fulfill({status:500,json:{error:'Synthetic save failure'}}));
          await member.getByRole('checkbox',{name:'Enable the Diary add-on'}).click();
          await member.getByRole('alert').filter({hasText:'Could not save your Diary choice'}).waitFor();
          assert.equal(await member.getByRole('checkbox',{name:'Enable the Diary add-on'}).isChecked(),diaryEnabled);
          assert.equal(await member.getByRole('checkbox',{name:'Enable the Diary add-on'}).evaluate(el => el === document.activeElement),true);
          await member.unroute('**/api/profile/features');
          await member.getByRole('checkbox',{name:'Enable the Diary add-on'}).click();
          await member.waitForFunction(expected=>document.querySelector('.auth-option input[type=checkbox]')?.checked===expected,!diaryEnabled);
          assert.equal(await member.getByRole('checkbox',{name:'Enable the Diary add-on'}).evaluate(el => el === document.activeElement),true);
          await member.reload();
          if (role==='admin') await member.getByRole('button',{name:'Skip — set up later in Settings',exact:true}).click();
          assert.equal(await member.getByRole('checkbox',{name:'Enable the Diary add-on'}).isChecked(),!diaryEnabled);
          // Restore the invitation choice before finishing; storage skip is optional.
          await member.getByRole('checkbox',{name:'Enable the Diary add-on'}).click();
          await member.waitForFunction(expected=>document.querySelector('.auth-option input[type=checkbox]')?.checked===expected,diaryEnabled);
          if (diaryEnabled) await member.getByRole('button',{name:'Skip — set up later in Settings',exact:true}).click();
          else await member.getByRole('button',{name:'Continue',exact:true}).click();
          await member.getByRole('button',{name:'Back',exact:true}).click();
          assert.equal(await member.getByRole('checkbox',{name:'Enable the Diary add-on'}).isChecked(),diaryEnabled);
          if (diaryEnabled) await member.getByRole('button',{name:'Skip — set up later in Settings',exact:true}).click();
          else await member.getByRole('button',{name:'Continue',exact:true}).click();
          await member.getByRole('button',{name:'Skip — set up later',exact:true}).click();
          await member.getByRole('button',{name:'Set up later',exact:true}).click();
          await member.getByRole('heading',{name:'Secure your account',exact:true}).waitFor({state:'hidden'});
          await member.reload();
          assert.equal((await state(member)).onboarded,true);
          assert.equal((await state(member)).diaryEnabled,diaryEnabled);
          assert.equal((await state(page)).diaryEnabled,diaryEnabled);
        }
        assert.deepEqual(errors,[]);
        console.log(`PASS real browser: fresh admin + invited member/admin, Diary ${diaryEnabled}, save failure, toggle/reload, Back, sign-out/resume, completion, role isolation, 375/768/1440 light/dark + keyboard`);
      } finally {
        for (const c of contexts) await c.close();
        server.kill('SIGTERM'); await once(server,'exit'); fs.rmSync(dir,{recursive:true,force:true});
      }
    }
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
