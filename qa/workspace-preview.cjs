// Process-memory preview only. All content, models and API responses are synthetic.
const {createFixture}=require('./diary-fixture.cjs');
const {createHash}=require('node:crypto');
const fixture=createFixture(Number(process.env.PORT||31329));
const base=fixture.server.listeners('request')[0];fixture.server.removeListener('request',base);
const files={
 'MEMORY.md':'# Workspace notes\n\nThese are synthetic notes for reviewing the Markdown workspace.\n\n## A portable notebook\n\nKeep ordinary Markdown as the source of truth. Open [a sample day](Entries/2026-09-14.md) or [project ideas](Ideas.md).\n\n## Try the editor\n\nEdit the source, preview it, save explicitly, or download a copy. All preview saves last only until this process stops.\n',
 'Ideas.md':'# Project ideas\n\n- A quieter writing workspace\n- Search that explains its limits\n- Model guidance based on the inference machine\n\nSee [workspace notes](MEMORY.md).\n',
 'Entries/2026-09-14.md':'# September 14, 2026\n\nA synthetic entry about a walk by the river.\n\n## Things to remember\n\nThe light on the water changed as the clouds passed.\n\nReturn to [workspace notes](../MEMORY.md).\n',
};
const version=text=>text===null?null:createHash('sha256').update(text).digest('hex');
fixture.server.on('request',async(req,res)=>{
 const url=new URL(req.url,'http://localhost');
 const json=(data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
 if(url.pathname==='/api/diary/today'){
 const now=new Date(),currentMonth=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`,month=url.searchParams.get('month')||currentMonth;
 return json({todayLog:`# ${month}-01\n\nA synthetic entry about a quiet morning.\n\n# ${month}-02\n\nA synthetic note about a walk.\n`,standingSections:{},memoryFiles:[]});
 }
 if(url.pathname==='/api/diary/files'){
 const path=url.searchParams.get('path')||'',prefix=path?path+'/':'',rows=new Map();
 for(const key of Object.keys(files))if(key.startsWith(prefix)){const rest=key.slice(prefix.length),name=rest.split('/')[0];rows.set(name,{name,path:prefix+name,isDir:rest.includes('/')});}
 return json({files:[...rows.values()]});
 }
 if(url.pathname==='/api/diary/file'){
 let raw='';for await(const chunk of req)raw+=chunk;
 let body;try{body=JSON.parse(raw);}catch{return json({error:'Invalid synthetic request'},400);}
 if(typeof body.path!=='string' || body.path.split('/').some(p=>!p || p.startsWith('.')) || !body.path.endsWith('.md'))return json({error:'Invalid Markdown path'},400);
 const current=files[body.path]??null;
 if(req.method==='PUT'){
 if(body.version!==version(current))return json({error:'Synthetic file changed. Compare the current version.'},409);
 if(typeof body.content!=='string' || Buffer.byteLength(body.content)>512*1024)return json({error:'File too large'},413);
 files[body.path]=body.content;
 }
 const text=files[body.path]??null;return json({path:body.path,content:text,version:version(text)});
 }
 if(url.pathname==='/api/models/hardware')return json({source:'model-manager',cpu:'Synthetic inference CPU',systemGB:32,gpus:[{id:'synthetic:0',name:'Synthetic GPU',capacityGB:16,sharedGB:null}]});
 if(url.pathname==='/api/models/installed')return json([
 {name:'Synthetic compact model',labels:['tool_use'],sizeGB:4,loaded:true,maxContext:8192},
 {name:'Synthetic vision model',labels:['vision'],sizeGB:9,loaded:false,maxContext:16384},
 {name:'Synthetic reasoning model',labels:['reasoning'],sizeGB:28,loaded:false,maxContext:32768},
 ]);
 if(url.pathname==='/api/models/auto-roles')return json({configured:false,roles:null});
 if(url.pathname.startsWith('/api/models/'))return req.method==='GET'?json([]):json({error:'Model changes are unavailable in this synthetic preview'},405);
 return base(req,res);
});
fixture.listen().then(()=>console.log('Synthetic workspace preview: http://localhost:'+Number(process.env.PORT||31329)));
process.on('SIGTERM',()=>fixture.close().then(()=>process.exit()));
