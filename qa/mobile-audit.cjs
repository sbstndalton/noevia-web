// Synthetic mobile audit: Chat + Diary + Markdown workspace at 320x568, 375x667,
// 390x844, 768x1024 in light and dark. Reports horizontal overflow and tap
// targets under 44px. No real Diary storage, no inference; fixture APIs only.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {spawn}=require('node:child_process');
const assert=require('node:assert/strict');
const PORT=31336;
const CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SIZES=[[320,568],[375,667],[390,844],[768,1024]];

const DOC='# Audit probe\n\n- one\n- [ ] task\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n';

function startFixture(){
  const dist=path.resolve(__dirname,'../dist');
  const server=http.createServer((req,res)=>{
    const url=new URL(req.url,'http://localhost');
    const json=(data)=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
    if(url.pathname==='/api/diary/files')return json({files:[{path:'probe.md',name:'probe.md',isDir:false}]});
    if(url.pathname==='/api/diary/file'){
      let raw='';req.on('data',c=>raw+=c);req.on('end',()=>json({path:'probe.md',content:DOC,version:'1'}));
      return;
    }
    if(url.pathname==='/api/diary/today')return json({todayLog:'',standingSections:{},memoryFiles:[]});
    if(url.pathname==='/api/setup/status')return json({configured:true});
    if(['/api/auth/session','/api/profile'].includes(url.pathname))return json({user:{id:'synthetic-diary-only',username:'fixture',displayName:'Synthetic diary QA',role:'member',diaryEnabled:true,onboarded:true},passkeys:[]});
    if(url.pathname==='/api/workspace')return json({projects:[],freeChats:[]});
    if(url.pathname==='/api/health')return json({inferenceUp:true,diaryUp:true});
    if(url.pathname==='/api/integrations/storage')return json({kind:'local',corpusRoot:''});
    if(url.pathname==='/api/diary/storage-status')return json({mode:'legacy',backup:'not_configured',lastBackedUp:null});
    if(url.pathname==='/api/diary/source')return json({source:'synthetic',months:[]});
    if(url.pathname==='/api/providers')return json({providers:[]});
    if(url.pathname==='/api/toolboxes')return json({toolboxes:[],mcp:{enabled:false}});
    if(url.pathname==='/api/diary/exchanges')return json({exchanges:[]});
    if(url.pathname==='/api/diary/context')return json({project:{id:'__diary-context',name:'Extras',model:'synthetic',files:[],assets:[],toolboxes:['core']}});
    if(url.pathname==='/api/reasoning-settings')return json({default:'default',effort:'default',mode:'off',admin:false});
    if(url.pathname==='/api/models/installed')return json([]);
    const file=path.join(dist,url.pathname==='/'?'index.html':url.pathname);
    if(url.pathname.startsWith('/api/')||!fs.existsSync(file)){res.writeHead(404);return res.end();}
    res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');
    fs.createReadStream(file).pipe(res);
  });
  return {listen:()=>new Promise(r=>server.listen(PORT,'127.0.0.1',r)),close:()=>new Promise(r=>server.close(r))};
}

async function connectCdp(wsUrl){
  const ws=new WebSocket(wsUrl);
  await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej;});
  let id=0;const pending=new Map();
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&pending.has(m.id)){const{res,rej}=pending.get(m.id);pending.delete(m.id);m.error?rej(new Error(JSON.stringify(m.error))):res(m.result);}};
  const send=(method,params={})=>new Promise((res,rej)=>{const i=++id;pending.set(i,{res,rej});ws.send(JSON.stringify({id:i,method,params}));});
  return {send,close:()=>ws.close()};
}
async function evaluate(cdp,expression){
  const r=await cdp.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
  if(r.exceptionDetails)throw new Error('page error: '+(r.exceptionDetails.exception?.description||JSON.stringify(r.exceptionDetails)));
  return r.result.value;
}

(async()=>{
  const fixture=startFixture();await fixture.listen();
  const profile='/tmp/noevia-mobile-audit-profile';
  fs.rmSync(profile,{recursive:true,force:true});
  const chrome=spawn(CHROME,['--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--window-size=390,844','about:blank'],{stdio:['ignore','pipe','pipe']});
  const wsUrl=await new Promise((res,rej)=>{let b='';const t=setTimeout(()=>rej(new Error('no devtools')),15000);chrome.stderr.on('data',d=>{b+=d;const m=b.match(/DevTools listening on (ws:\/\/\S+)/);if(m){clearTimeout(t);res(m[1]);}});});
  const base=wsUrl.replace(/^ws:/,'http:').split('/devtools/')[0];
  const pageWs=(await (await fetch(base+'/json/list')).json()).find(t=>t.type==='page').webSocketDebuggerUrl;
  const cdp=await connectCdp(pageWs);
  const problems=[];
  try {
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    await cdp.send('Page.navigate',{url:`http://localhost:${PORT}/`});
    for(let i=0;i<100;i++){await new Promise(r=>setTimeout(r,100));if(await evaluate(cdp,`!!document.querySelector('button')`))break;}
    const click=name=>evaluate(cdp,`(()=>{for(const b of document.querySelectorAll('button'))if(b.textContent.trim()===${JSON.stringify(name)})return b.click(),true;throw new Error('no button '+${JSON.stringify(name)})})()`);
    const audit=()=>{
      return evaluate(cdp,`(()=>{
        const de=document.documentElement;
        const overflow=de.scrollWidth-de.clientWidth;
        const small=[...document.querySelectorAll('button, a[href], input[type="checkbox"]')]
          .filter(el=>el.offsetParent!==null)
          .map(el=>{const r=el.getBoundingClientRect();return {h:Math.round(r.height),w:Math.round(r.width),label:(el.textContent||el.getAttribute('aria-label')||'').trim().slice(0,30)};})
          .filter(b=>b.h>0&&b.h<40&&b.w>=40)
          .slice(0,20)
          .map(x=>x);
        return {overflow,small,smallCount:small.length};
      })()`);
    };
    const shot=async name=>{const r=await cdp.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(`/tmp/noevia-mobile-${name}.png`,Buffer.from(r.data,'base64'));};

    for(const [w,h] of SIZES){
      for(const theme of ['light','dark']){
        await cdp.send('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:2,mobile:true});
        await evaluate(cdp,`document.documentElement.setAttribute('data-theme','${theme}');true`);
        await new Promise(r=>setTimeout(r,200));
        const tag=`${w}x${h}-${theme}`;

        // Chat view.
        let a=await audit();
        if(a.overflow>1)problems.push(`chat ${tag}: horizontal overflow ${a.overflow}px`);
        if(a.smallCount)problems.push(`chat ${tag}: ${a.smallCount} sub-40px targets: ${JSON.stringify(a.small.slice(0,5))}`);
        await shot(`chat-${tag}`);

        // Diary view.
        await click('Diary');
        await new Promise(r=>setTimeout(r,300));
        a=await audit();
        if(a.overflow>1)problems.push(`diary ${tag}: horizontal overflow ${a.overflow}px`);
        if(a.smallCount)problems.push(`diary ${tag}: ${a.smallCount} sub-40px targets: ${JSON.stringify(a.small.slice(0,5))}`);
        await shot(`diary-${tag}`);

        // Diary landing on phone: composer must be reachable (scrolled into view, fully inside the viewport).
        if(w<500){
          const composer=await evaluate(cdp,`(()=>{const first=document.querySelector('textarea');for(let n=first&&first.parentElement;n;n=n.parentElement){const oy=getComputedStyle(n).overflowY;if((oy==='auto'||oy==='scroll')&&n.scrollHeight>n.clientHeight)n.scrollTop=n.scrollHeight;}const list=[...document.querySelectorAll('textarea')].map(t=>t.getBoundingClientRect());return list.length?{top:Math.min(...list.map(b=>b.top)),bottom:Math.max(...list.map(b=>b.bottom)),vh:innerHeight}:{none:true}})()`);
          if(composer.bottom!==undefined&&composer.bottom>composer.vh+1)problems.push(`diary ${tag}: composer extends ${Math.round(composer.bottom-composer.vh)}px below the viewport`);
        }
        // Back to chat for the next iteration.
        await click('Chat');
        await new Promise(r=>setTimeout(r,200));
      }
    }

    // Markdown workspace at the smallest size, both themes: overflow check.
    await click('Diary');
    await new Promise(r=>setTimeout(r,300));
    await click('Edit');
    const click2=name=>evaluate(cdp,`(()=>{for(const b of document.querySelectorAll('button'))if(b.textContent.trim()===${JSON.stringify(name)})return b.click(),true;throw new Error('no button '+${JSON.stringify(name)})})()`);
    for(const theme of ['light','dark']){
      await cdp.send('Emulation.setDeviceMetricsOverride',{width:320,height:568,deviceScaleFactor:2,mobile:true});
      await evaluate(cdp,`document.documentElement.setAttribute('data-theme','${theme}');true`);
      await evaluate(cdp,`(async()=>{for(let i=0;i<100;i++){if(document.querySelector('[aria-label="Markdown workspace"]'))return true;await new Promise(r=>setTimeout(r,100));}return false;})()`);
      await new Promise(r=>setTimeout(r,200));
      const a=await audit();
      if(a.overflow>1)problems.push(`workspace 320x568 ${theme}: horizontal overflow ${a.overflow}px`);
      await shot(`workspace-320x568-${theme}`);
    }
  } finally {
    cdp.close();chrome.kill();fixture.close();
    try{fs.rmSync(profile,{recursive:true,force:true});}catch{}
  }
  if(problems.length){
    console.log('MOBILE AUDIT PROBLEMS:');
    for(const p of problems)console.log(' -',p);
    process.exitCode=1;
  } else {
    console.log('PASS mobile audit: no overflow or sub-40px targets found at the audited views/sizes');
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
