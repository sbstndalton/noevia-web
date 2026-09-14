// Probe the Diary composer position at small viewports (diagnostic only).
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {spawn}=require('node:child_process');
const PORT=31338;
const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  const json=d=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(d));};
  if(url.pathname==='/api/diary/files')return json({files:[]});
  if(url.pathname==='/api/diary/today')return json({todayLog:'',standingSections:{},memoryFiles:[]});
  if(url.pathname==='/api/setup/status')return json({configured:true});
  if(['/api/auth/session','/api/profile'].includes(url.pathname))return json({user:{id:'u',username:'f',displayName:'QA',role:'member',diaryEnabled:true,onboarded:true},passkeys:[]});
  if(url.pathname==='/api/workspace')return json({projects:[],freeChats:[]});
  if(url.pathname==='/api/health')return json({inferenceUp:true,diaryUp:true});
  if(url.pathname==='/api/integrations/storage')return json({kind:'local',corpusRoot:''});
  if(url.pathname==='/api/diary/storage-status')return json({mode:'legacy',backup:'not_configured',lastBackedUp:null});
  if(url.pathname==='/api/diary/source')return json({source:'synthetic',months:[]});
  if(url.pathname==='/api/providers')return json({providers:[]});
  if(url.pathname==='/api/toolboxes')return json({toolboxes:[],mcp:{enabled:false}});
  if(url.pathname==='/api/diary/exchanges')return json({exchanges:[]});
  if(url.pathname==='/api/diary/context')return json({project:{id:'__diary-context',name:'Extras',model:'m',files:[],assets:[],toolboxes:['core']}});
  if(url.pathname==='/api/reasoning-settings')return json({default:'default',effort:'default',mode:'off',admin:false});
  if(url.pathname==='/api/models/installed')return json([]);
  const f=path.join('dist',url.pathname==='/'?'index.html':url.pathname);
  if(url.pathname.startsWith('/api/')||!fs.existsSync(f)){res.writeHead(404);return res.end();}
  res.setHeader('Content-Type',f.endsWith('.js')?'text/javascript':f.endsWith('.css')?'text/css':'text/html');
  fs.createReadStream(f).pipe(res);
});
(async()=>{
  await new Promise(r=>server.listen(PORT,'127.0.0.1',r));
  const chrome=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--remote-debugging-port=0','--user-data-dir=/tmp/noevia-probe2','--no-first-run','about:blank'],{stdio:['ignore','pipe','pipe']});
  const wsUrl=await new Promise(r=>{let b='';chrome.stderr.on('data',d=>{b+=d;const m=b.match(/DevTools listening on (ws:\/\/\S+)/);if(m)r(m[1]);});});
  const base=wsUrl.replace(/^ws:/,'http:').split('/devtools/')[0];
  const t=(await (await fetch(base+'/json/list')).json()).find(t=>t.type==='page');
  const ws=new WebSocket(t.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
  let id=0;const p=new Map();
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&p.has(m.id)){p.get(m.id)(m.result);p.delete(m.id);}};
  const send=(me,pa={})=>new Promise(r=>{const i=++id;p.set(i,r);ws.send(JSON.stringify({id:i,method:me,params:pa}));});
  const ev=async x=>{const r=await send('Runtime.evaluate',{expression:x,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description);return r.result.value;};
  await send('Runtime.enable');await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:320,height:568,deviceScaleFactor:2,mobile:true});
  await send('Page.navigate',{url:'http://localhost:'+PORT+'/'});
  for(let i=0;i<80;i++){await new Promise(r=>setTimeout(r,100));if(await ev("!!document.querySelector('button')"))break;}
  await ev("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Diary').click();true");
  await new Promise(r=>setTimeout(r,500));
  const report=await ev(`(()=>{
    const out=[];
    for(const t of document.querySelectorAll('textarea')){
      const r=t.getBoundingClientRect();
      out.push({id:t.id,cls:t.className,visible:!!t.offsetParent,top:Math.round(r.top),bottom:Math.round(r.bottom),vh:innerHeight});
    }
    const dock=document.querySelector('.diary-composer-dock');
    const dr=dock?dock.getBoundingClientRect():null;
    const prim=document.querySelector('.diary-primary');
    const pr=prim?{sh:prim.scrollHeight,ch:prim.clientHeight,sw:prim.scrollWidth,cw:prim.clientWidth}:null;
    return {out,dock:dr&&{top:Math.round(dr.top),bottom:Math.round(dr.bottom)},primary:pr,bodyScroll:document.documentElement.scrollHeight-innerHeight};
  })()`);
  console.log(JSON.stringify(report,null,1));
  chrome.kill();server.close();process.exit(0);
})().catch(e=>{console.error(e);process.exit(1)});
