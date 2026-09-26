// Isolated UI fixture: every API is synthetic, no inference/storage/network calls.
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const { isClientRoute } = require('../server/spa-routes.cjs');
const fixtureNcModes={};
function createFixture(port = 31239) {
  let syntheticUser='synthetic-diary-only';
  const requests = [], pending = new Set(), live = new Set();
  const extraProject={id:'__diary-context',name:'Extras',model:'synthetic',files:[],assets:[],toolboxes:['core']};
  // Settings → Connectors: a synthetic Google Drive that connects a moment after Connect.
  const drive={state:'disconnected',email:null,backup:null,modes:{drive_search_files:'allow',drive_read_file:'allow',drive_get_metadata:'allow',drive_list_recent:'allow',drive_create_file:'ask',drive_update_file:'ask',drive_trash_file:'ask'}};
  const driveLabels={drive_search_files:'Search files',drive_read_file:'Read file content',drive_get_metadata:'Get file metadata',drive_list_recent:'List recent files',drive_create_file:'Create file',drive_update_file:'Update file',drive_trash_file:'Trash file'};
  const driveView=()=>({id:'gdrive',name:'Google Drive',configured:true,state:drive.state,email:drive.email,userCode:drive.state==='pending'?'WDJB-MJHT':undefined,verificationUrl:drive.state==='pending'?'about:blank#google-device':undefined,backup:drive.backup,
    tools:Object.keys(driveLabels).map(name=>({name,label:driveLabels[name],write:!/search|read|metadata|recent/.test(name),mode:drive.modes[name]}))});
  const server = http.createServer(async (req,res) => {
    const url = new URL(req.url,'http://localhost');
    if (!url.pathname.startsWith('/api/')) {
      // QA_DIST serves a build written elsewhere (npm run build -- --outDir X) instead of ../dist.
      const dist = path.resolve(process.env.QA_DIST || path.join(__dirname,'../dist'));
      let file = path.join(dist,url.pathname === '/'?'index.html':url.pathname);
      // The client's own places (/c/<id>, /settings/<section>…) get the shell, as the real server does (#359).
      if ((!file.startsWith(dist+'/') || !fs.existsSync(file)) && isClientRoute(url.pathname)) file = path.join(dist,'index.html');
      if (!file.startsWith(dist+'/') || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
      if(process.env.LOCAL_RECOVERY_QA==='1' && url.pathname==='/') {
        res.setHeader('Content-Type','text/html');
        return res.end(fs.readFileSync(file,'utf8').replace('<head>',`<head><script>
          window.showDirectoryPicker=async()=>{const root=await navigator.storage.getDirectory();return root.getDirectoryHandle(localStorage.getItem('qa-wrong-folder')==='yes'?'wrong-synthetic-recovery':'synthetic-recovery',{create:true});};
          const original=FileSystemFileHandle.prototype.createWritable;
          FileSystemFileHandle.prototype.createWritable=function(...args){if(localStorage.getItem('qa-fail-write')==='yes')throw Error('Synthetic local disk failure');return original.apply(this,args);};
          addEventListener('DOMContentLoaded',()=>{const box=document.createElement('aside');box.style='position:fixed;right:0;top:0;z-index:99999;background:white;color:black;font:12px sans-serif';for(const [key,label] of [['qa-fail-write','Synthetic disk failure'],['qa-wrong-folder','Choose wrong synthetic folder']]){const row=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.checked=localStorage.getItem(key)==='yes';input.onchange=()=>localStorage.setItem(key,input.checked?'yes':'no');row.append(input,label);box.append(row);}for(const [label,text] of [['External synthetic edit','External competing text'],['Empty synthetic placeholder','']]){const button=document.createElement('button');button.textContent=label;button.onclick=async()=>{const root=await window.showDirectoryPicker(),dir=await root.getDirectoryHandle('Entries',{create:true}),d=new Date(),day=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'),file=await dir.getFileHandle(day+'.md',{create:true}),writer=await original.call(file);await writer.write(text);await writer.close();button.textContent=label+' done';};box.append(button);}document.body.append(box);});
        </script>`));
      }
      res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');return fs.createReadStream(file).pipe(res);
    }
    let raw='';for await(const c of req)raw+=c;
    const body = raw?JSON.parse(raw):{};
    const json = (data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
    if(process.env.LOCAL_RECOVERY_QA==='1' && url.pathname==='/api/qa/state'){if(body.user)syntheticUser=String(body.user);return json({requests:requests.map(r=>r.path),user:syntheticUser});}
    const user={id:syntheticUser,username:'fixture',displayName:'Synthetic diary QA',role:'member',diaryEnabled:true,onboarded:true};
    if(url.pathname==='/api/setup/status')return json({configured:true});
    // Product default (previews off); suites that exercise the Code preview route this to true.
    if(url.pathname==='/api/features')return json({flags:{previews:false}});
    if(['/api/auth/session','/api/profile'].includes(url.pathname))return json({user,passkeys:[]});
    if(url.pathname==='/api/workspace')return json({projects:[],freeChats:[]});
    if(url.pathname==='/api/health')return json({inferenceUp:true,diaryUp:true});
    if(url.pathname==='/api/integrations/storage')return json({kind:'local',corpusRoot:''});
    if(url.pathname==='/api/diary/storage-status')return json({mode:'legacy',backup:'not_configured',lastBackedUp:null});
    if(url.pathname==='/api/diary/source')return json({source:'synthetic',months:[]});
    if(url.pathname==='/api/diary/today')return json({todayLog:'',standingSections:{},memoryFiles:[]});
    if(url.pathname==='/api/diary/files')return json({files:[]});
    if(url.pathname==='/api/providers')return json({providers:[]});
    if(url.pathname==='/api/toolboxes')return json({toolboxes:[],mcp:{enabled:false}});
    if(url.pathname==='/api/diary/exchanges')return json({exchanges:[]});
    if(url.pathname==='/api/diary/context')return json({project:extraProject});
    if(url.pathname==='/api/reasoning-settings')return json({default:'default',effort:extraProject.reasoningEffort||'default',mode:extraProject.reasoningEffort && extraProject.reasoningEffort!=='default'?'hint':'off',admin:false});
    if(url.pathname==='/api/projects/__diary-context/config'){extraProject.reasoningEffort=body.reasoningEffort;return json({ok:true});}
    if(url.pathname==='/api/chat'||url.pathname==='/api/diary/local-exchange') {
      requests.push({path:url.pathname,body});
      res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache'});
      const event=(data)=>res.write('data: '+JSON.stringify(data)+'\n\n');
      event({type:'reasoning',text:'Synthetic provider reasoning'});
      if(url.pathname.endsWith('local-exchange')) {
        return setTimeout(()=>{event({type:'answer',text:'Synthetic local reply'});event({type:'diary',decision:'logged',files:{['Entries/'+body.entryDay+'.md']:'# '+body.entryDay+'\n\nSynthetic local entry'}});event({type:'done'});res.end();},250);
      }
      event({type:'status',text:body.spaceId==='diary-extras'?'Preparing synthetic context':'Reading synthetic diary'});
      if(body.spaceId==='diary-extras') {event({type:'tool',index:0,name:'synthetic_read',args:'{}'});event({type:'tool_result',index:0,name:'synthetic_read',text:'Synthetic reference read'});}
      if(body.message==='cancel synthetic'&&body.spaceId==='diary-extras') { pending.add(res);res.on('close',()=>pending.delete(res));return; }
      if(body.message==='pending write synthetic') {
        event({type:'tool',index:0,name:'project_create_file',args:'{"name":"a.md","text":"synthetic"}'});
        event({type:'tool_pending',id:'ap-synthetic-stale',index:0,name:'project_create_file',args:'{"name":"a.md","text":"synthetic"}'});
        pending.add(res);res.on('close',()=>pending.delete(res));return;
      }
      if(body.message==='live synthetic') { live.add(res);pending.add(res);res.on('close',()=>{live.delete(res);pending.delete(res);});return; }
      if(body.message==='slow thinking synthetic') {
        // About two seconds of thinking before the first word of the answer.
        event({type:'reasoning',text:'Weighing the synthetic options carefully.'});
        setTimeout(()=>{event({type:'delta',text:'Synthetic considered answer'});event({type:'done'});res.end();},2200);
        return;
      }
      if(body.message==='tools chat synthetic') {
        event({type:'tool',index:0,name:'project_search',args:'{"query":"synthetic"}'});
        event({type:'tool_result',index:0,name:'project_search',text:'Found 2 synthetic matches in notes.md'});
        event({type:'tool',index:1,name:'write_note',args:'{"path":"a.md"}'});
        event({type:'tool_result',index:1,name:'write_note',text:'ERROR: the user declined this action.'});
        event({type:'delta',text:'Synthetic answer after tools'});
        event({type:'done'});res.end();return;
      }
      if(body.message==='live tokens synthetic') {
        event({type:'delta',text:'Synthetic streamed reply'});
        event({type:'usage',promptTokens:12,completionTokens:34,totalTokens:46,tokensPerSecond:77});
        event({type:'done'});res.end();return;
      }
      if(body.message==='long synthetic') {
        let chunk=0;
        const timer=setInterval(()=>{
          event({type:'delta',text:('Synthetic streaming paragraph '+(++chunk)+'. ').repeat(20)+'\n\n'});
          if(chunk===80){clearInterval(timer);event({type:'diary',decision:'skip'});event({type:'done'});res.end();}
        },60);
        pending.add(res);res.on('close',()=>{clearInterval(timer);pending.delete(res);});return;
      }
      setTimeout(()=>{
        if(body.message==='fail synthetic')event({type:'error',text:'Synthetic unavailable'});
        else {event({type:'delta',text:body.spaceId==='diary-extras'?'Synthetic optional reference':'Synthetic streamed reply'});if(body.spaceId==='diary')event({type:'diary',decision:'skip'});}
        event({type:'done'});res.end();
      },250);return;
    }
    const ncTools=['nc_notes_search','nc_notes_create','nc_calendar_list_events'];
    const ncModes=fixtureNcModes;
    const ncView=()=>({id:'nextcloud',name:'Nextcloud',configured:true,state:'connected',account:'synthetic',baseUrl:'https://cloud.example.test/',message:'',
      boxes:[{id:'nextcloud-notes',label:'Nextcloud Notes',toolCount:2},{id:'nextcloud-calendar',label:'Calendar',toolCount:1}],
      tools:ncTools.map(name=>({name,label:name,write:/create|update|delete/.test(name),mode:ncModes[name]||(/create|update|delete/.test(name)?'ask':'allow')}))});
    if(url.pathname==='/api/connectors')return json({connectors:[driveView(),ncView()]});
    if(url.pathname==='/api/connectors/nextcloud/policy'){const write=body.tools.some(t=>/create|update|delete/.test(t));
      if(body.mode==='allow'&&write)return json({error:'Writes always ask first, so they cannot be set to Always allow.'},400);
      for(const t of body.tools)ncModes[t]=body.mode;return json(ncView());}
    if(url.pathname==='/api/connectors/gdrive/connect'){drive.state='pending';setTimeout(()=>{drive.state='connected';drive.email='synthetic@example.com';},1500);return json(driveView());}
    if(url.pathname==='/api/connectors/gdrive/disconnect'){drive.state='disconnected';drive.email=null;return json(driveView());}
    if(url.pathname==='/api/connectors/gdrive/policy'){const write=body.tools.some(t=>!/search|read|metadata|recent/.test(t));if(body.mode==='allow'&&write)return json({error:'Writes always ask first, so they cannot be set to Always allow.'},400);for(const t of body.tools)drive.modes[t]=body.mode;return json(driveView());}
    if(url.pathname==='/api/models/installed')return json([]);
    // Fixed baseline the footer's own poll would keep reporting forever — a
    // test proving the live SSE 'usage' update works can't race the poll if
    // this never changes to the value that update carries.
    if(url.pathname==='/api/stats')return json({up:true,tokensPerSecond:11,timeToFirstToken:0.2,inputTokens:5,outputTokens:5,telemetryScope:null,inputTokensTotal:100,outputTokensTotal:200,requestCount:3,cpuPercent:10,gpuPercent:20,vramGb:4,memoryGb:8,mtp:[]});
    return json({});
  });
  return {server,requests,liveEvent:event=>{for(const res of live)res.write('data: '+JSON.stringify(event)+'\n\n');},finishLive:()=>{for(const res of live){res.write('data: {"type":"diary","decision":"skip"}\n\ndata: {"type":"done"}\n\n');res.end();}},listen:()=>new Promise(r=>server.listen(port,'127.0.0.1',r)),close:()=>{for(const res of pending)res.end();return new Promise(r=>server.close(r));}};
}
module.exports={createFixture};
if(require.main===module){const f=createFixture();f.listen().then(()=>console.log('Synthetic Diary UI fixture on http://localhost:31239'));process.on('SIGTERM',()=>f.close().then(()=>process.exit()));}
