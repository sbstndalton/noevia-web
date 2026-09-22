// Fully synthetic browser QA. Playwright serves the built files and intercepts
// fetch in-page, so this opens no port and makes no inference/network request.
// The engine poll deliberately stays at 11 tok/s: request-local SSE telemetry
// must update the footer and survive a later stale engine snapshot.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 try{
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  await context.addInitScript(()=>{
   const nativeFetch=window.fetch.bind(window),encoder=new TextEncoder();
   const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
   let liveStream=null;
   window.__syntheticLiveStats={
    first(){if(!liveStream)return false;liveStream.event({type:'telemetry',phase:'streaming',model:'synthetic-live-model',timeToFirstToken:.42});liveStream.event({type:'delta',text:'Synthetic live reply'});return true;},
    finish(){if(!liveStream)return false;liveStream.event({type:'usage',phase:'streaming',model:'synthetic-live-model',promptTokens:12,completionTokens:34,totalTokens:46,tokensPerSecond:77,timeToFirstToken:.42,drafted:40,accepted:32});liveStream.event({type:'telemetry',phase:'complete',model:'synthetic-live-model',timeToFirstToken:.42});liveStream.event({type:'done',model:'synthetic-live-model'});liveStream.controller.close();liveStream=null;return true;},
   };
   const user={id:'synthetic-live-user',username:'fixture',displayName:'Synthetic live stats',role:'member',diaryEnabled:false,onboarded:true};
   window.fetch=async(input,init={})=>{
    const url=new URL(typeof input==='string'?input:input.url,location.href),p=url.pathname;
    if(url.origin!==location.origin||!p.startsWith('/api/'))return nativeFetch(input,init);
    if(p==='/api/chat'){
     const body=JSON.parse(String(init.body||'{}'));
     if(body.message!=='live telemetry synthetic')return json({error:'unexpected synthetic message'},400);
     const stream=new ReadableStream({start(controller){
      const event=value=>controller.enqueue(encoder.encode(`data: ${JSON.stringify(value)}\n\n`));
      liveStream={controller,event};
      event({type:'meta',model:'synthetic-live-model'});
      event({type:'telemetry',phase:'waiting',model:'synthetic-live-model'});
     }});
     return new Response(stream,{status:200,headers:{'Content-Type':'text/event-stream'}});
    }
    if(p==='/api/setup/status')return json({configured:true});
    if(p==='/api/features')return json({flags:{previews:false}});
    if(p==='/api/auth/session'||p==='/api/profile')return json({user,passkeys:[]});
    if(p==='/api/workspace')return json({projects:[],freeChats:[]});
    if(p==='/api/health')return json({inferenceUp:true,diaryUp:true});
    if(p==='/api/integrations/storage')return json({kind:'local',corpusRoot:''});
    if(p==='/api/diary/storage-status')return json({mode:'legacy',backup:'not_configured',lastBackedUp:null});
    if(p==='/api/diary/source')return json({source:'synthetic',months:[]});
    if(p==='/api/diary/today')return json({todayLog:'',standingSections:{},memoryFiles:[]});
    if(p==='/api/diary/files')return json({files:[]});
    if(p==='/api/providers')return json({providers:[]});
    if(p==='/api/toolboxes')return json({toolboxes:[],mcp:{enabled:false}});
    if(p==='/api/diary/exchanges')return json({exchanges:[]});
    if(p==='/api/diary/context')return json({project:{id:'__diary-context',name:'Extras',model:'synthetic',files:[],assets:[],toolboxes:['core']}});
    if(p==='/api/reasoning-settings')return json({default:'default',effort:'default',mode:'off',admin:false});
    if(p==='/api/connectors')return json({connectors:[]});
    if(p==='/api/models/installed')return json([]);
    if(p==='/api/stats')return json({up:true,tokensPerSecond:11,timeToFirstToken:null,inputTokens:null,outputTokens:null,telemetryScope:'synthetic engine snapshot',inputTokensTotal:100,outputTokensTotal:200,requestCount:3,cpuPercent:null,gpuPercent:null,vramGb:null,memoryGb:null,mtp:[]});
    if(/^\/api\/chats\/[^/]+\/history$/.test(p))return init.method==='POST'?json({ok:true,revision:'synthetic-r1'}):json({history:[],revision:null});
    return json({ok:true});
   };
  });
  const page=await context.newPage();
  const dist=path.resolve(__dirname,'../dist');
  await page.route('https://noevia.synthetic/**',async route=>{
   const url=new URL(route.request().url()),relative=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname.slice(1));
   const file=path.resolve(dist,relative);
   if(!file.startsWith(dist+path.sep)||!fs.existsSync(file))return route.fulfill({status:404,body:'not found'});
   const type=file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':'text/html';
   return route.fulfill({status:200,contentType:type,path:file});
  });
  const value=key=>page.locator(`[data-stat="${key}"] dd`).innerText();
  const label=key=>page.locator(`[data-stat="${key}"] dt`).innerText();
  await page.goto('https://noevia.synthetic/');
  const region=page.getByRole('region',{name:'Inference details'});await region.waitFor();
  await page.locator('[data-stat="speed"] dd').filter({hasText:'11.0 tokens/s'}).waitFor();

  await page.getByRole('textbox',{name:'Message',exact:true}).fill('live telemetry synthetic');
  await page.keyboard.press('Enter');
  await region.getByText('synthetic-live-model · Generating',{exact:true}).waitFor();
  assert.equal(await value('speed'),'Measuring…');assert.equal(await value('first-token'),'Waiting…');assert.equal(await label('reply'),'Current reply');
  assert.equal(await page.evaluate(()=>window.__syntheticLiveStats.first()),true);
  await page.locator('[data-stat="first-token"] dd').filter({hasText:'0.42 s'}).waitFor();
  await page.getByText('Synthetic live reply',{exact:true}).waitFor();
  assert.equal(await value('reply'),'Awaiting provider usage…');
  assert.equal(await page.evaluate(()=>window.__syntheticLiveStats.finish()),true);
  await page.locator('[data-stat="speed"] dd').filter({hasText:'77.0 tokens/s'}).waitFor();
  assert.equal(await value('first-token'),'0.42 s');assert.equal(await label('reply'),'Last reply');assert.equal(await value('reply'),'12 in · 34 out');assert.equal(await value('mtp'),'80.0%');

  await page.waitForTimeout(3200);
  assert.equal(await value('speed'),'77.0 tokens/s');assert.equal(await value('reply'),'12 in · 34 out');
  const shots=process.env.LIVE_STATS_SCREENSHOTS||process.env.QA_SCREENSHOTS;
  if(shots){
   fs.mkdirSync(shots,{recursive:true});
   for(const theme of ['light','dark'])for(const width of [375,768,1440]){
    await page.setViewportSize({width,height:width===375?812:1000});
    await page.evaluate(value=>{document.documentElement.dataset.theme=value;},theme);
    await page.screenshot({path:path.join(shots,`live-stats-${theme}-${width}.png`),fullPage:false});
   }
  }
  console.log('PASS footer shows live generating/first-output state, applies exact reply usage and MTP immediately, and stays separate from later engine polls');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
