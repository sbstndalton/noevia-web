// Isolated UI fixture: every API is synthetic, no inference/storage/network calls.
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
function createFixture(port = 31239) {
  const requests = [], pending = new Set();
  const extraProject={id:'__diary-context',name:'Extras',model:'synthetic',files:[],assets:[],toolboxes:['core']};
  const server = http.createServer(async (req,res) => {
    const url = new URL(req.url,'http://localhost');
    if (!url.pathname.startsWith('/api/')) {
      const file = path.join(__dirname,'../dist',url.pathname === '/'?'index.html':url.pathname);
      if (!file.startsWith(path.resolve(__dirname,'../dist')+'/') || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
      res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');return fs.createReadStream(file).pipe(res);
    }
    let raw='';for await(const c of req)raw+=c;
    const body = raw?JSON.parse(raw):{};
    const json = (data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
    const user={id:'synthetic-diary-only',username:'fixture',displayName:'Synthetic diary QA',role:'member',diaryEnabled:true,onboarded:true};
    if(url.pathname==='/api/setup/status')return json({configured:true});
    if(['/api/auth/session','/api/profile'].includes(url.pathname))return json({user,passkeys:[]});
    if(url.pathname==='/api/workspace')return json({projects:[],freeChats:[]});
    if(url.pathname==='/api/health')return json({inferenceUp:true,diaryUp:true});
    if(url.pathname==='/api/integrations/storage')return json({kind:'local',corpusRoot:''});
    if(url.pathname==='/api/diary/source')return json({source:'synthetic',months:[]});
    if(url.pathname==='/api/diary/today')return json({todayLog:'',standingSections:{},memoryFiles:[]});
    if(url.pathname==='/api/diary/files')return json({files:[]});
    if(url.pathname==='/api/providers')return json({providers:[]});
    if(url.pathname==='/api/toolboxes')return json({toolboxes:[],mcp:{enabled:false}});
    if(url.pathname==='/api/diary/context')return json({project:extraProject});
    if(url.pathname==='/api/reasoning-settings')return json({default:'default',effort:extraProject.reasoningEffort||'default',mode:extraProject.reasoningEffort && extraProject.reasoningEffort!=='default'?'hint':'off',admin:false});
    if(url.pathname==='/api/projects/__diary-context/config'){extraProject.reasoningEffort=body.reasoningEffort;return json({ok:true});}
    if(url.pathname==='/api/chat'||url.pathname==='/api/diary/local-exchange') {
      requests.push({path:url.pathname,body});
      if(url.pathname.endsWith('local-exchange'))return setTimeout(()=>json({reply:'Synthetic local reply',reasoning:'Synthetic provider reasoning',decision:'logged',files:{['Entries/'+body.entryDay+'.md']:'# '+body.entryDay+'\n\nSynthetic local entry'}}),250);
      res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache'});
      const event=(data)=>res.write('data: '+JSON.stringify(data)+'\n\n');
      event({type:'reasoning',text:'Synthetic provider reasoning'});
      event({type:'status',text:body.spaceId==='diary-extras'?'Preparing synthetic context':'Reading synthetic diary'});
      if(body.message==='cancel synthetic'&&body.spaceId==='diary-extras') { pending.add(res);res.on('close',()=>pending.delete(res));return; }
      if(body.message==='long synthetic') {
        let chunk=0;
        const timer=setInterval(()=>{
          event({type:'delta',text:('Synthetic streaming paragraph '+(++chunk)+'. ').repeat(20)+'\n\n'});
          if(chunk===80){clearInterval(timer);event({type:'done'});res.end();}
        },60);
        pending.add(res);res.on('close',()=>{clearInterval(timer);pending.delete(res);});return;
      }
      setTimeout(()=>{
        if(body.message==='fail synthetic')event({type:'error',text:'Synthetic unavailable'});
        else {event({type:'delta',text:body.spaceId==='diary-extras'?'Synthetic optional reference':'Synthetic streamed reply'});if(body.spaceId==='diary')event({type:'diary',decision:'skip'});}
        event({type:'done'});res.end();
      },250);return;
    }
    if(url.pathname==='/api/models/installed')return json([]);
    return json({});
  });
  return {server,requests,listen:()=>new Promise(r=>server.listen(port,'127.0.0.1',r)),close:()=>{for(const res of pending)res.end();return new Promise(r=>server.close(r));}};
}
module.exports={createFixture};
if(require.main===module){const f=createFixture();f.listen().then(()=>console.log('Synthetic Diary UI fixture on http://localhost:31239'));process.on('SIGTERM',()=>f.close().then(()=>process.exit()));}
