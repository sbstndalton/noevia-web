// Synthetic admin and clipboard failures; never touches real accounts.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const {createFixture}=require('./diary-fixture.cjs');
(async()=>{
 const fixture=createFixture(0);await fixture.listen();
 const origin=`http://127.0.0.1:${fixture.server.address().port}`;
 const browser=await chromium.launch({headless:true,channel:'chrome'}),errors=[];
 try{
 const page=await browser.newPage({viewport:{width:1440,height:950}});page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{window.qaCopyFails=true;Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{if(window.qaCopyFails)throw Error('Synthetic clipboard denial');window.qaCopied=text;}}});});
 const admin={id:'admin',username:'admin',displayName:'Synthetic admin',role:'admin',disabled:false,diaryEnabled:true,onboarded:true};
 const member={...admin,id:'member',username:'member',displayName:'Synthetic member',role:'member'},other={...admin,id:'other',username:'other',displayName:'Other synthetic member',role:'member'};
 let users=[admin,member,other],fail=true,held,hold=false,mutations=0,recoveries=0,invitations=0,failLink=false,failList=false;
 await page.route('**/api/**',route=>{
  const req=route.request(),p=new URL(req.url()).pathname,m=req.method();
  if(p==='/api/auth/session'||p==='/api/profile')return route.fulfill({json:{user:admin,passkeys:[]}});
  if(p==='/api/admin/users')return route.fulfill(failList?{status:500,json:{error:'Synthetic list failure'}}:{json:{users}});
  if(p.endsWith('/disabled')){mutations++;if(hold){held=route;return;}if(fail)return route.fulfill({status:500,json:{error:'Synthetic failure'}});member.disabled=req.postDataJSON().disabled;return route.fulfill({json:{ok:true}});}
  if(p==='/api/admin/users/member'&&m==='DELETE'){mutations++;if(fail)return route.fulfill({status:500,json:{error:'Synthetic delete failure'}});users=users.filter(u=>u.id!=='member');return route.fulfill({json:{ok:true}});}
  if(p.endsWith('/recovery')){recoveries++;return route.fulfill(failLink?{status:500,json:{error:'Synthetic token failure'}}:{json:{token:'synthetic-recovery',expiresAt:1}});}
  if(p==='/api/admin/invitations'){invitations++;return route.fulfill(failLink?{status:500,json:{error:'Synthetic token failure'}}:{json:{token:'synthetic-invitation',expiresAt:1}});}
  return route.continue();
 });
 await page.goto(origin);await page.getByTitle('Settings',{exact:true}).click();
 const settings=page.getByRole('region',{name:'Settings',exact:true});await settings.getByRole('button',{name:'Users',exact:true}).click();
 const row=()=>settings.locator('.model-row').filter({hasText:'@member'});
 const alert=text=>settings.getByRole('alert').filter({hasText:text}).waitFor();
 await row().getByRole('button',{name:'Disable',exact:true}).click();await alert('Disable account could not be confirmed');assert.ok(await row().isVisible());
 hold=true;await row().getByRole('button',{name:'Disable',exact:true}).click();
 await settings.getByRole('status').filter({hasText:'Disable account…'}).waitFor();
 assert.ok(await row().getByRole('button',{name:'Recovery',exact:true}).isDisabled());
 assert.ok(await settings.locator('.model-row').filter({hasText:'@other'}).getByRole('button',{name:'Recovery',exact:true}).isEnabled());
 await row().getByRole('button',{name:'Disable',exact:true}).evaluate(el=>el.click());assert.equal(mutations,2);
 member.disabled=true;hold=false;fail=false;await held.fulfill({json:{ok:true}});await row().getByRole('button',{name:'Enable',exact:true}).waitFor();
 fail=true;page.on('dialog',d=>d.accept('member'));await row().getByRole('button',{name:'Delete user member',exact:true}).click();await alert('Delete account could not be confirmed');assert.ok(await row().isVisible());
 failLink=true;await row().getByRole('button',{name:'Recovery',exact:true}).click();await alert('Create recovery link could not be confirmed');
 failLink=false;await row().getByRole('button',{name:'Recovery',exact:true}).click();await alert('Recovery link was created, but copying failed');
 assert.equal(await settings.getByLabel('Created link',{exact:true}).inputValue(),origin+'/?recovery=synthetic-recovery');
 await page.evaluate(()=>window.qaCopyFails=false);await settings.getByRole('button',{name:'Copy link again',exact:true}).click();
 await settings.getByRole('status').filter({hasText:'Recovery link copied.'}).waitFor();assert.equal(recoveries,2);
 await page.evaluate(()=>window.qaCopyFails=true);await settings.getByRole('button',{name:'Copy invitation link',exact:true}).click();await alert('Single-use invitation (expires in 24 hours) was created');assert.equal(invitations,1);
 assert.equal(await settings.getByLabel('Created link',{exact:true}).count(),2);
 for(const theme of ['light','dark']){
  await settings.getByRole('button',{name:'General',exact:true}).click();await settings.getByRole('button',{name:theme==='light'?'Light':'Dark',exact:true}).click();
  await settings.getByRole('button',{name:'Users',exact:true}).click();await row().getByRole('button',{name:'Recovery',exact:true}).click();await alert('copying failed');
  for(const width of [375,768,1440]){
   await page.setViewportSize({width,height:950});await page.waitForTimeout(200);
   assert.ok(await settings.evaluate(el=>el.scrollWidth<=el.clientWidth+1));assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   const copy=settings.getByRole('button',{name:'Copy link again',exact:true});await page.keyboard.press('Tab'); await copy.focus();assert.ok(await copy.evaluate(el=>el===document.activeElement&&getComputedStyle(el).outlineStyle!=='none'));
   await page.screenshot({path:`/tmp/noevia-admin-actions-${width}-${theme}.png`});
  }
 }
 fail=false;failList=true;await row().getByRole('button',{name:'Enable',exact:true}).click();await alert('The change succeeded');assert.ok(await row().isVisible());
 failList=false;await settings.getByRole('button',{name:'Reload users',exact:true}).click();await row().getByRole('button',{name:'Disable',exact:true}).waitFor();
 await row().getByRole('button',{name:'Delete user member',exact:true}).click();await page.waitForFunction(()=>!document.body.textContent.includes('@member'));
 assert.deepEqual(errors,[]);assert.equal(fixture.requests.length,0);
 console.log('PASS admin failures, per-row guard, success/refresh, token/clipboard distinction and copy retry; responsive themes/focus.');
 }finally{await browser.close();await fixture.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
