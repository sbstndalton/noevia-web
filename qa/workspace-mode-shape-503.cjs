// #503: actual Chat/Code transitions, family shape, inset selection and touch hit targets.
// Every API response is synthetic; this never starts an agent/model or touches live settings.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||`${os.homedir()}/noevia-local-test/node_modules/playwright-core`);
const {createFixture}=require('./diary-fixture.cjs');
const out=process.env.QA_SCREENSHOTS||'/tmp/noevia-mode-503',port=Number(process.env.QA_PORT||31504);
let checks=0;const failures=[],errors=[];
const check=(ok,label,detail)=>{checks++;if(!ok)failures.push({label,detail});};
(async()=>{
 fs.mkdirSync(out,{recursive:true});const f=createFixture(port);await f.listen();
 const b=await chromium.launch({channel:'chrome',headless:true});
 try{
 for(const width of [1440,768,390])for(const theme of ['light','dark'])for(const family of ['editorial','contemporary','glass']){
  const touch=width<1000,name=`${family}-${theme}-${width}`;
  const p=await b.newPage({viewport:{width,height:900},hasTouch:touch,isMobile:width===390,reducedMotion:'reduce'});
  p.on('pageerror',e=>errors.push({name,error:e.message}));await p.route('https://**/*',r=>r.abort());
  await p.addInitScript(({theme,family})=>{localStorage.setItem('cowork-theme',theme);localStorage.setItem('noevia:theme-family',family);},{theme,family});
  await p.route('**/api/profile/appearance',r=>r.fulfill({json:{theme,light:'sage',dark:'sage'}}));
  await p.route('**/api/features',r=>r.fulfill({json:{flags:{previews:true}}}));
  await p.goto(`http://localhost:${port}`);await p.getByPlaceholder('Message noevia…').waitFor();
  const open=async()=>{if(width===390)await p.getByRole('button',{name:'Open navigation',exact:true}).click();};
  const inspect=async(mode,rail)=>{
   const track=p.getByRole('group',{name:'Workspace mode',exact:true});await track.waitFor();await p.waitForTimeout(100);
   const g=await track.evaluate(e=>{
    const r=e.getBoundingClientRect(),s=getComputedStyle(e),buttons=[...e.querySelectorAll('button')],thumb=e.querySelector('.glass-thumb');
    const selected=buttons.find(b=>b.getAttribute('aria-pressed')==='true'),indicator=getComputedStyle(thumb).display==='none'?selected:thumb;
    const ir=indicator.getBoundingClientRect();
    return {selectedRect:selected.getBoundingClientRect().toJSON(),selected:selected.getAttribute('data-mode'),radius:getComputedStyle(indicator).borderTopLeftRadius,track:r.toJSON(),indicator:ir.toJSON(),buttons:buttons.map(b=>({r:b.getBoundingClientRect().toJSON(),radius:getComputedStyle(b).borderTopLeftRadius})),overflow:document.documentElement.scrollWidth>innerWidth,padding:s.padding};
   });
   check(g.selected===mode,`${name}-${rail}: ${mode} is selected`,g);
   check(parseFloat(g.radius)>0&&g.buttons.every(x=>parseFloat(x.radius)>0),`${name}-${rail}-${mode}: rounded selection and controls`,g);
   const t=g.track,i=g.indicator;
   if(rail==='expanded')check(i.left>=t.left+1.5&&i.right<=t.right-1.5&&i.top>=t.top+1.5&&i.bottom<=t.bottom-1.5,`${name}-${rail}-${mode}: selection inset on every edge`,g);
   const selected=g.selectedRect;
   check(Math.abs(i.left-selected.left)<=1&&Math.abs(i.top-selected.top)<=1&&Math.abs(i.width-selected.width)<=1&&Math.abs(i.height-selected.height)<=1,`${name}-${rail}-${mode}: indicator covers selected control`,g);
   if(touch)check(g.buttons.every(x=>x.r.width>=44&&x.r.height>=44),`${name}-${rail}-${mode}: touch targets >=44px`,g.buttons);
   check(!g.overflow,`${name}-${rail}-${mode}: no horizontal overflow`);
   await p.locator('.shell-sidebar-head').screenshot({path:path.join(out,`${name}-${rail}-${mode}.png`)});
  };
  await open();
  for(const mode of ['chat','code','chat']){
   const current=await p.locator('.sidebar').getAttribute('data-mode');
   if(current!==mode){await p.getByRole('group',{name:'Workspace mode'}).getByRole('button',{name:mode==='chat'?'Chat':'Code',exact:true}).click();await p.waitForFunction(m=>document.querySelector('.sidebar')?.dataset.mode===m,mode);await open();}
   await inspect(mode,'expanded');
  }
  if(width>=520){
   await p.getByRole('button',{name:'Collapse navigation',exact:true}).click();
   await inspect('chat','collapsed');
   await p.getByRole('group',{name:'Workspace mode'}).getByRole('button',{name:'Code',exact:true}).click();
   await p.waitForFunction(()=>document.querySelector('.sidebar')?.dataset.mode==='code');await inspect('code','collapsed');
  }
  await p.close();
 }
 check(errors.length===0,'no browser errors',errors);check(f.requests.length===0,'no inference',f.requests);
 fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({checks,failures,errors},null,2));console.log(JSON.stringify({checks,failures},null,2));if(failures.length)process.exitCode=1;
 }finally{await b.close();await f.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
