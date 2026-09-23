// Mount the shipped AutoTune component with real CSS; all model APIs/timer ticks are synthetic.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {build}=require('esbuild');
const tick=p=>p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
(async()=>{
 const root=path.resolve(__dirname,'..');
 const bundled=await build({stdin:{contents:`import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{AutoTune}from'./src/components/models/AutoTune';function Harness(){const[model,setModel]=useState('Model A'),[shown,setShown]=useState(true);return <main style={{padding:24,maxWidth:1000,margin:'auto'}}><button onClick={()=>setModel('Model B')}>Select B</button><button onClick={()=>setModel('')}>All models</button><button onClick={()=>setShown(false)}>Unmount</button>{shown&&<AutoTune model={model} onChanged={()=>{window.qaChanges=(window.qaChanges||0)+1;}}/>}</main>}createRoot(document.getElementById('root')).render(<Harness/>);`,loader:'tsx',resolveDir:root},bundle:true,write:false,format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'}});
 const css=fs.readdirSync(path.join(root,'dist/assets')).filter(x=>x.endsWith('.css')).map(x=>fs.readFileSync(path.join(root,'dist/assets',x),'utf8')).join('\n');
 const server=http.createServer((req,res)=>{res.setHeader('content-type',req.url==='/bundle.js'?'text/javascript':req.url==='/style.css'?'text/css':'text/html');res.end(req.url==='/bundle.js'?bundled.outputFiles[0].text:req.url==='/style.css'?css:'<!doctype html><html data-theme="light"><head><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch({headless:true,channel:'chrome'}),errors=[];
 const job=(status,id='job-a',model='Model A')=>({id,model,status,phase:'Measuring synthetic fixture',steps:[]});
 try{for(const terminal of ['cancelled','passed','failed','stale-error']){
  const page=await browser.newPage({viewport:{width:1440,height:950}});page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{const set=window.setInterval,clear=window.clearInterval;window.setInterval=(fn,ms,...args)=>{if(ms===1000){window.qaPoll=fn;return -901;}return set(fn,ms,...args);};window.clearInterval=id=>{if(id===-901){window.qaPoll=null;return;}clear(id);};});
  let gets=0,older,later,hold=false,current=job('running'),cancelled=false;
  await page.route('**/api/**',r=>{const req=r.request(),url=new URL(req.url());
   if(req.method()==='POST'){
    if(url.pathname.endsWith('/cancel')){cancelled=true;return r.fulfill({status:202,json:job('running')});}
    assert.equal(req.postDataJSON().confirmPause,true);current=job('running','restart');return r.fulfill({json:current});
   }
   if(url.searchParams.get('model')==='Model B')return r.fulfill({json:{job:null,history:[]}});
   if(++gets===2){older=r;return;}if(hold){later=r;return;}
   return r.fulfill({json:{job:gets===1?current:job(terminal==='stale-error'?'cancelled':terminal),history:[]}});
  });
  await page.goto(origin);await page.getByRole('button',{name:'Cancel auto-tune',exact:true}).waitFor();await page.waitForFunction(()=>typeof window.qaPoll==='function');
  await page.evaluate(()=>window.qaPoll());while(!older)await tick(page);
  if(terminal==='cancelled'||terminal==='stale-error'){
   await page.getByRole('button',{name:'Cancel auto-tune',exact:true}).click();while(!cancelled)await tick(page);await page.waitForFunction(()=>typeof window.qaPoll==='function');
   assert.ok(await page.getByRole('button',{name:'Cancel auto-tune',exact:true}).isVisible(),'202/running remains running');
  }
  await page.evaluate(()=>window.qaPoll());await page.getByRole('button',{name:'Cancel auto-tune',exact:true}).waitFor({state:'hidden'});
  await older.fulfill(terminal==='stale-error'?{status:500,json:{error:'Obsolete status error'}}:{json:{job:job('running'),history:[]}});await tick(page);
  assert.equal(await page.getByRole('button',{name:'Cancel auto-tune',exact:true}).count(),0);assert.equal(await page.evaluate(()=>window.qaChanges),1);assert.equal(await page.evaluate(()=>window.qaPoll),null);assert.equal(await page.getByRole('alert').count(),0);
  if(terminal==='cancelled'){
   await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Auto-tune and apply',exact:true}).click();await page.getByRole('button',{name:'Cancel auto-tune',exact:true}).waitFor();
   hold=true;await page.evaluate(()=>window.qaPoll());while(!later)await tick(page);await page.getByRole('button',{name:'Select B',exact:true}).click();await tick(page);await later.fulfill({json:{job:job('passed'),history:[]}});await tick(page);assert.equal(await page.evaluate(()=>window.qaChanges),1);assert.equal(await page.getByText('Tuned',{exact:true}).count(),0);assert.equal(await page.getByRole('checkbox').isChecked(),false);
  }await page.close();
 }
 const page=await browser.newPage({viewport:{width:1440,height:950}});page.on('pageerror',e=>errors.push(e.message));let fail=true,held;
 await page.route('**/api/**',r=>{if(fail)return r.fulfill({status:500,json:{error:'Current status failed'}});held=r;});await page.goto(origin);const retry=page.getByRole('button',{name:'Retry status',exact:true});await retry.waitFor();
 for(const theme of ['light','dark'])for(const width of [375,768,1440]){await page.setViewportSize({width,height:950});await page.evaluate(t=>document.documentElement.setAttribute('data-theme',t),theme);await page.keyboard.press('Tab');await retry.focus();await page.waitForTimeout(100);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.ok(await retry.evaluate(el=>el===document.activeElement&&getComputedStyle(el).outlineStyle!=='none'));await page.screenshot({path:`/tmp/noevia-autotune-${width}-${theme}.png`});}
 fail=false;await retry.click();while(!held)await tick(page);await held.fulfill({json:{job:null,history:[]}});await retry.waitFor({state:'hidden'});
 // Unmount while a fresh model's request is held; its completion must be ignored.
 held=null;await page.getByRole('button',{name:'Select B',exact:true}).click();while(!held)await tick(page);await page.getByRole('button',{name:'Unmount',exact:true}).click();await held.fulfill({json:{job:job('passed','job-b','Model B'),history:[]}});await tick(page);assert.equal(await page.locator('.mm-autotune').count(),0);assert.equal(await page.evaluate(()=>window.qaChanges||0),0);await page.close();
 // A completed all-model queue must rescan the server-owned untuned list.
 const all=await browser.newPage({viewport:{width:1440,height:950}});all.on('pageerror',e=>errors.push(e.message));
 await all.addInitScript(()=>{const set=window.setInterval,clear=window.clearInterval;window.setInterval=(fn,ms,...args)=>{if(ms===1000){window.qaPoll=fn;return -902;}return set(fn,ms,...args);};window.clearInterval=id=>{if(id===-902){window.qaPoll=null;return;}clear(id);};});
 let scans=0,statuses=0;
 await all.route('**/api/**',r=>{const url=new URL(r.request().url());
  if(url.pathname.endsWith('/untuned'))return r.fulfill({json:{models:++scans===1?['Model A']:[],skipped:[]}});
  if(url.searchParams.get('model')==='')return r.fulfill({json:{job:job(++statuses===1?'running':'passed','job-all','Model A'),history:[]}});
  return r.fulfill({json:{job:null,history:[]}});
 });
 await all.goto(origin);await all.getByRole('button',{name:'All models',exact:true}).click();
 await all.waitForFunction(()=>typeof window.qaPoll==='function');assert.equal(scans,1);
 await all.evaluate(()=>window.qaPoll());await all.getByText('0 models need tuning.',{exact:false}).waitFor();
 assert.equal(scans,2);assert.equal(await all.getByRole('button',{name:'Tune untuned models and apply',exact:true}).isDisabled(),true);await all.close();
 assert.deepEqual(errors,[]);console.log('PASS AutoTune cancelled/passed/failed ordering,202 cancellation, stale errors, one callback, restart, model switch/unmount, retry and responsive focus.');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
