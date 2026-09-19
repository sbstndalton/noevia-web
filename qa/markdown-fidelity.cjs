// Synthetic browser check: Markdown preview fidelity in the Diary workspace.
// No real Diary storage and no model calls; every API is synthetic below.
// Drives headless Chrome over the DevTools protocol directly (no extra deps).
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {spawn}=require('node:child_process');
const assert=require('node:assert/strict');
const PORT=31333;
const CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// A fixture doc covering every construct the preview claims to support,
// including things that commonly break renderers.
const DOC = [
  '# Fidelity probe',
  '',
  '## Sub heading',
  '### Third level',
  '#### Fourth level',
  '',
  'A paragraph with **bold**, *italic*, `inline code`, a [safe link](https://example.com/page) and a [file link](other.md).',
  '',
  '- top bullet',
  '  - nested bullet',
  '    - deeply nested',
  '- another top bullet',
  '',
  '1. first ordered',
  '2. second ordered',
  '   1. nested ordered',
  '',
  '- [ ] open task',
  '- [x] done task',
  '',
  '| Column A | Column B |',
  '| --- | --- |',
  '| one | two |',
  '| three | four |',
  '',
  '```js',
  'const kept = "verbatim, <b>not html</b>";',
  '```',
  '',
  '> A quoted line.',
  '',
  '---',
  '',
  '<script>alert("never")</script>',
].join('\n');

let stored='';

function startFixture(){
  const dist=path.resolve(__dirname,'../dist');
  const server=http.createServer((req,res)=>{
    const url=new URL(req.url,'http://localhost');
    const json=(data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
    if(url.pathname==='/api/diary/files')return json({files:[{path:'probe.md',name:'probe.md',isDir:false}]});
    if(url.pathname==='/api/diary/file'){
      let raw='';req.on('data',c=>raw+=c);req.on('end',()=>{
        if(req.method==='PUT'){const body=JSON.parse(raw||'{}');stored=body.content;return json({path:'probe.md',content:stored,version:'2'});}
        return json({path:'probe.md',content:DOC,version:'1'});
      });
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

// Minimal CDP client over Node's built-in WebSocket.
async function connectCdp(wsUrl){
  const ws=new WebSocket(wsUrl);
  await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej;});
  let id=0;const pending=new Map();const events=[];
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&pending.has(m.id)){const{res,rej}=pending.get(m.id);pending.delete(m.id);m.error?rej(new Error(JSON.stringify(m.error))):res(m.result);}else if(m.method)events.push(m);};
  const send=(method,params={})=>new Promise((res,rej)=>{const i=++id;pending.set(i,{res,rej});ws.send(JSON.stringify({id:i,method,params}));});
  return {send,events,close:()=>ws.close()};
}

async function evaluate(cdp,expression){
  const r=await cdp.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
  if(r.exceptionDetails)throw new Error('page error: '+(r.exceptionDetails.exception?.description||JSON.stringify(r.exceptionDetails)));
  return r.result.value;
}

(async()=>{
  const fixture=startFixture();await fixture.listen();
  const profile='/tmp/noevia-md-fidelity-profile';
  fs.rmSync(profile,{recursive:true,force:true});
  const chrome=spawn(CHROME,['--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--window-size=1440,900','about:blank'],{stdio:['ignore','pipe','pipe']});
  const wsUrl=await new Promise((res,rej)=>{
    let buf='';const timer=setTimeout(()=>rej(new Error('Chrome did not report a DevTools socket')),15000);
    chrome.stderr.on('data',d=>{buf+=d;const m=buf.match(/DevTools listening on (ws:\/\/\S+)/);if(m){clearTimeout(timer);res(m[1]);}});
  });
  const debugBase=wsUrl.replace(/^ws:/,'http:').split('/devtools/')[0];
  const targets=await (await fetch(debugBase+'/json/list')).json();
  const pageWs=targets.find(t=>t.type==='page').webSocketDebuggerUrl;
  let cdp;
  try {
    console.error('step: fixture up, chrome up');
    cdp=await connectCdp(pageWs);
    console.error('step: cdp connected');
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Page.navigate',{url:`http://localhost:${PORT}/`});
    // Wait for the app shell.
    for(let i=0;i<100;i++){await new Promise(r=>setTimeout(r,100));if(await evaluate(cdp,`!!document.querySelector('button')`))break;}
    await evaluate(cdp,`window.__qaAlertFired=false;window.alert=()=>{window.__qaAlertFired=true;};true`);
    console.error('step: shell ready');
    const click=name=>evaluate(cdp,`(()=>{for(const b of document.querySelectorAll('button'))if(b.textContent.trim()===${JSON.stringify(name)}||b.getAttribute('aria-label')===${JSON.stringify(name)})return b.click(),true;throw new Error('no button '+${JSON.stringify(name)})})()`);
    const waitFor=expr=>evaluate(cdp,`(async()=>{for(let i=0;i<100;i++){if(${expr})return true;await new Promise(r=>setTimeout(r,100));}throw new Error('timeout waiting');})()`);

    await click('Diary');
    await click('Edit');
    const waitForButton=name=>evaluate(cdp,`(async()=>{for(let i=0;i<100;i++){for(const b of document.querySelectorAll('button'))if(b.textContent.trim()===${JSON.stringify(name)})return true;await new Promise(r=>setTimeout(r,100));}throw new Error('no button '+${JSON.stringify(name)})})()`);
    await waitForButton('probe.md');
    await click('probe.md');
    console.error('step: file opened');
    await waitFor(`!!document.querySelector('[aria-label="Markdown workspace"]')`);
    await click('Preview');
    console.error('step: preview tab');
    // Preview is rendered with the stored fixture document.
    await waitFor(`(()=>{const p=document.querySelector('[aria-label="Markdown preview"]');return !!p&&!!p.querySelector('h2');})()`);

    const checks=await evaluate(cdp,`(()=>{
      const p=document.querySelector('[aria-label="Markdown preview"]');
      const q=s=>p.querySelector(s),qa=s=>[...p.querySelectorAll(s)];
      const text=el=>el?el.textContent:'';
      const result={failures:[]};
      const expect=(name,ok)=>{if(!ok)result.failures.push(name);};
      expect('h2 heading',qa('h2').some(h=>text(h)==='Fidelity probe'));
      expect('h3 headings count',qa('h3').length===1&&text(qa('h3')[0])==='Sub heading');
      expect('h4 headings count',qa('h4').length===2);
      expect('bold',!!q('strong')&&text(q('strong'))==='bold');
      expect('italic',!!q('em')&&text(q('em'))==='italic');
      expect('inline code',qa('code').some(c=>text(c)==='inline code'));
      expect('safe link',qa('a[href="https://example.com/page"]').length===1);
      expect('file link',!!p.querySelector('.diary-markdown-link')||qa('a').some(a=>text(a)==='file link'));
      const bullets=qa('.md-bullet');
      expect('bullets rendered',bullets.length>=5);
      const indents=new Set(bullets.map(b=>getComputedStyle(b).paddingInlineStart));
      expect('nested indent levels',indents.size>=2);
      expect('ordered numbering kept',bullets.some(b=>b.querySelector('.md-pip')&&b.querySelector('.md-pip').textContent.trim()==='1.')&&bullets.some(b=>b.querySelector('.md-pip')&&b.querySelector('.md-pip').textContent.trim()==='2.'));
      expect('table header cells',qa('.md-table th').length===2);
      expect('table body cells',qa('.md-table tbody td').length===4);
      expect('task list open box',qa('.md-task .md-task-box').filter(b=>b.textContent.trim()==='').length===1);
      expect('task list done box',qa('.md-task-done .md-task-box').filter(b=>b.textContent.trim()==='✓').length===1);
      const code=q('.md-code code');
      expect('code block verbatim',!!code&&text(code)==='const kept = "verbatim, <b>not html</b>";');
      expect('code content not parsed as html',!code||!code.querySelector('b'));
      expect('blockquote',!!q('blockquote')&&text(q('blockquote')).includes('A quoted line.'));
      expect('hr',qa('hr').length>=1);
      expect('no script elements',qa('script').length===0);
      expect('raw html text remains escaped',p.textContent.includes('<script>alert("never")</script>'));
      result.alertFired=window.__qaAlertFired;
      return result;
    })()`);
    for(const failure of checks.failures)console.error('FAIL:',failure);
    assert.deepEqual(checks.failures,[],'all fidelity checks pass');
    assert.equal(checks.alertFired,false,'no alert from script content');

    // Round trip: open the file in source mode, save the exact fixture text,
    // confirm stored bytes are unchanged, then re-render preview.
    const roundTrip=await evaluate(cdp,`(async()=>{
      const d=document.querySelector('[aria-label="Markdown workspace"]');
      const src=d.querySelector('#diary-markdown-source');
      if(!src)return {fail:'source textarea missing'};
      if(src.value!==${JSON.stringify(DOC)})return {fail:'loaded source differs from fixture'};
      const save=[...d.querySelectorAll('button')].find(b=>b.textContent.trim()==='Save');
      save.click();
      await new Promise(r=>setTimeout(r,500));
      // switch to Source & preview and confirm re-render
      const tab=[...d.querySelectorAll('button')].find(b=>b.textContent.trim()==='Source & preview');
      tab.click();
      await new Promise(r=>setTimeout(r,300));
      const p=document.querySelector('[aria-label="Markdown preview"]');
      if(!p||!p.querySelector('h2')||p.querySelectorAll('.md-table th').length!==2)return {fail:'re-render after save differs'};
      return {ok:true};
    })()`).catch(e=>({fail:String(e)}));
    assert.equal(stored,DOC,'saving must not rewrite the stored text');
    if(roundTrip.fail)throw new Error(roundTrip.fail);

    // Responsive/theme overflow check at phone width in both themes.
    for(const theme of ['light','dark']){
      await cdp.send('Emulation.setDeviceMetricsOverride',{width:375,height:844,deviceScaleFactor:2,mobile:true});
      await evaluate(cdp,`document.documentElement.setAttribute('data-theme','${theme}');true`);
      await new Promise(r=>setTimeout(r,250));
      const overflow=await evaluate(cdp,`(()=>{const d=document.querySelector('[aria-label="Markdown workspace"]');return d.scrollWidth-d.clientWidth;})()`);
      assert.ok(overflow<=1,`no horizontal overflow at 375 ${theme} (got ${overflow}px)`);
      await cdp.send('Page.captureScreenshot',{format:'png'}).then(r=>fs.writeFileSync(`/tmp/noevia-md-fidelity-375-${theme}.png`,Buffer.from(r.data,'base64')));
    }
    console.log('PASS markdown fidelity: headings, inline, nested lists, table, code, quote, safety, round-trip, responsive');
  } finally {
    if(cdp)cdp.close();
    chrome.kill();fixture.close();try{fs.rmSync(profile,{recursive:true,force:true});}catch{}
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
