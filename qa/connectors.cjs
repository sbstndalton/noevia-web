// Settings → Connectors (release 2): the list, Google Drive's connect flow, per-tool Allow / Ask /
// Block with writes never allowed, a prompt suggestion starting a chat, and Settings replacing the
// workspace on desktop and as list → page on a phone. Synthetic fixture only; no Google, no Drive.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const {createFixture}=require('./diary-fixture.cjs');
const shots=process.env.QA_SCREENSHOTS||'/tmp';
(async()=>{
 const fixture=createFixture(31415);await fixture.listen();
 const browser=await chromium.launch({headless:true,channel:'chrome'});const errors=[];
 try{
  for(const [width,height] of [[1440,900],[768,1024],[390,844]])for(const theme of ['light','dark']){
   const phone=width<700;
   const page=await browser.newPage({viewport:{width,height},colorScheme:theme,isMobile:phone,hasTouch:width<1024});page.on('pageerror',e=>errors.push(e.message));
   await page.goto('http://localhost:31415');await page.getByPlaceholder('Message noevia…').waitFor();
   await page.evaluate(()=>fetch('/api/connectors/gdrive/disconnect',{method:'POST'}));
   if(await page.getByRole('button',{name:'Open navigation',exact:true}).isVisible())await page.getByRole('button',{name:'Open navigation',exact:true}).click();
   // Connectors moved from Settings to the Plugins page (user review, 2026-09-19).
   await page.getByRole('button',{name:'Customise',exact:true}).click();
   const s=page.locator('.plugins-page');await s.getByRole('heading',{name:'Customise',level:1}).waitFor();
   // Every connector on this page is real now; the list names each one and its state.
   await s.getByRole('button',{name:'Nextcloud'}).waitFor();
   for(const name of ['Google Drive','Nextcloud'])assert.equal(await s.getByRole('button',{name}).count(),1,`${name} is listed`);
   assert.equal(await s.locator('.connector-card').filter({hasText:'MCP servers'}).count(),1,'MCP servers is listed');
   // Nextcloud is a real connector page now: its state, its toolboxes and its permissions.
   await s.getByRole('button',{name:'Nextcloud'}).click();
   await s.getByRole('heading',{name:'Nextcloud',level:1}).waitFor();
   await s.getByText(/Connected as synthetic/).first().waitFor();
   await s.getByText(/Nextcloud Notes \(2\)/).waitFor();
   assert.match(await s.getByText(/Settings → Diary/).innerText(),/Diary/,'it points at where Nextcloud is connected');
   const ncCreate=s.getByRole('radiogroup',{name:'nc_notes_create permission'});
   assert.equal(await ncCreate.getByRole('radio',{name:/Always allow/}).getAttribute('aria-disabled'),'true','a write cannot be allowed');
   await s.getByRole('radiogroup',{name:'nc_notes_search permission'}).getByRole('radio',{name:'Blocked'}).click();
   await s.getByRole('radiogroup',{name:'nc_notes_search permission'}).getByRole('radio',{name:'Blocked',checked:true}).waitFor();
   await s.getByRole('button',{name:'Connectors',exact:true}).click();
   await s.getByRole('button',{name:'Google Drive'}).click();
   const [tab]=await Promise.all([page.context().waitForEvent('page',{timeout:3000}).catch(()=>null),s.getByRole('button',{name:'Connect Google Drive'}).click()]);await tab?.close();
   await s.getByText('WDJB-MJHT').waitFor();
   await s.getByText(/Connected as synthetic/).waitFor({timeout:8000});
   // Reads can be allowed; a write's Allow segment is disabled and choosing it changes nothing.
   const create=s.getByRole('radiogroup',{name:'Create file permission'});
   assert.equal(await create.getByRole('radio',{name:/Always allow/}).getAttribute('aria-disabled'),'true');
   await create.getByRole('radio',{name:/Always allow/}).click({force:true});
   assert.equal(await create.getByRole('radio',{name:'Needs approval'}).getAttribute('aria-checked'),'true');
   await s.getByRole('radiogroup',{name:'Trash file permission'}).getByRole('radio',{name:'Blocked'}).click();
   await s.getByRole('radiogroup',{name:'Trash file permission'}).getByRole('radio',{name:'Blocked',checked:true}).waitFor();
   assert.equal(await s.getByLabel('Write and delete tools: set all to').inputValue(),'','mixed group');
   await s.getByLabel('Read-only tools: set all to').selectOption('ask');
   await s.getByRole('radiogroup',{name:'Search files permission'}).getByRole('radio',{name:'Needs approval',checked:true}).waitFor();
   await s.getByLabel('Read-only tools: set all to').selectOption('allow');
   const small=await s.evaluate(el=>[...el.querySelectorAll('.permission-control button, .connector-page .btn, .chip')].filter(b=>{const r=b.getBoundingClientRect();return r.height&&r.height<(matchMedia('(pointer: coarse)').matches?44:26);}).length);
   assert.equal(small,0,`targets ${width}`);
   assert.ok(await s.evaluate(el=>el.scrollWidth<=el.clientWidth+1),`no overflow ${width} ${theme}`);
   await page.screenshot({path:`${shots}/noevia-connectors-${width}-${theme}.png`});
   // A prompt suggestion starts a new chat with it.
   await s.getByRole('button',{name:/List the files you have saved/}).click();
   await s.waitFor({state:'detached'});
   await page.getByText('List the files you have saved to my Google Drive').first().waitFor();
   await page.close();
  }
  assert.deepEqual(errors,[]);
  console.log('PASS connectors: Drive and Nextcloud both real pages, Drive connect by code turns green by itself, writes cannot be allowed, block and group-wide changes, prompt suggestion starts a chat, on the Plugins page; 1440/768/390 light/dark.');
 }finally{await browser.close();await fixture.close?.();}
})().catch(e=>{console.error(e);process.exit(1);});
