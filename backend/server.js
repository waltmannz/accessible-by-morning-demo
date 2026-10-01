import http from 'node:http';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {readFile,readdir,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {runPipeline} from './pipeline.js';
import {serveFile} from './static.js';
import {getAgent} from './gemini.js';
try{process.loadEnvFile();}catch{}
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const runsRoot=path.join(root,'runs');
const runs=new Map(),controllers=new Map();
function json(res,status,data){res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(data));}
async function body(req){let buffer='';for await(const chunk of req){buffer+=chunk;if(buffer.length>16000)throw new Error('Request body too large');}return JSON.parse(buffer||'{}');}
export async function createServer({port=Number(process.env.PORT||3000),host=process.env.HOST||'127.0.0.1'}={}) {
  await mkdir(runsRoot,{recursive:true});
  for(const name of await readdir(runsRoot)){try{const run=JSON.parse(await readFile(path.join(runsRoot,name,'run.json'),'utf8'));if(run.status==='running'){run.status='interrupted';run.error='Server restarted during this run; inspect persisted remote IDs before starting another managed run.';}runs.set(run.id,run);}catch{}}
  const server=http.createServer(async(req,res)=>{
    try {
      const url=new URL(req.url,'http://localhost'),pathname=url.pathname;
      if(pathname==='/health')return json(res,200,{status:'ok'});
      if(pathname==='/api/config')return json(res,200,{geminiConfigured:Boolean(process.env.GEMINI_API_KEY),defaultMode:process.env.GEMINI_API_KEY?'gemini':'local',agent:getAgent(),repository:process.env.DEMO_REPO_URL||null,humanTesting:'not-performed'});
      if(pathname==='/api/runs'&&req.method==='GET')return json(res,200,{runs:[...runs.values()].sort((a,b)=>b.startedAt.localeCompare(a.startedAt))});
      if(pathname==='/api/runs'&&req.method==='POST'){
        if(controllers.size)return json(res,409,{error:'A run is already active. Wait for it or cancel it.'});
        const input=await body(req),mode=input.mode||(process.env.GEMINI_API_KEY?'gemini':'local');
        if(!['gemini','local'].includes(mode))return json(res,400,{error:'Mode must be gemini or local'});
        if(mode==='gemini'&&!process.env.GEMINI_API_KEY)return json(res,400,{error:'Set GEMINI_API_KEY in local .env to use managed agents.'});
        const id=`${mode}-${randomUUID().slice(0,12)}`,controller=new AbortController();controllers.set(id,controller);
        const initial={id,mode,status:'running',stage:'setup',task:'Book an appointment',startedAt:new Date().toISOString(),events:[]};runs.set(id,initial);
        runPipeline({id,mode,runDir:path.join(runsRoot,id),repoPath:path.join(root,'fixture'),task:'Book an appointment',signal:controller.signal,onEvent:state=>runs.set(id,state)}).catch(e=>{if(e.run)runs.set(id,e.run);else runs.set(id,{...initial,status:'failed',error:e.message});}).finally(()=>controllers.delete(id));
        return json(res,202,initial);
      }
      const runMatch=pathname.match(/^\/api\/runs\/([a-zA-Z0-9-]+)(?:\/(report|cancel|events))?$/);
      if(runMatch){const [,id,action]=runMatch,run=runs.get(id);if(!run)return json(res,404,{error:'Run not found'});
        if(action==='cancel'&&req.method==='POST'){controllers.get(id)?.abort(new Error('Run cancelled by user'));return json(res,202,{id,status:controllers.has(id)?'cancelling':run.status});}
        if(action==='report')return serveFile(res,path.join(runsRoot,id,'artifacts'),'report.md');
        if(action==='events')return json(res,200,{events:run.events,status:run.status});
        return json(res,200,run);
      }
      const preview=pathname.match(/^\/preview\/([a-zA-Z0-9-]+)\/(before|after)(\/.*)?$/);
      if(preview)return serveFile(res,path.join(runsRoot,preview[1],preview[2]),preview[3]||'/');
      if(pathname.startsWith('/preview/fixture/'))return serveFile(res,path.join(root,'fixture'),pathname.slice('/preview/fixture'.length));
      if(pathname.startsWith('/fixture/'))return serveFile(res,path.join(root,'fixture'),pathname.slice('/fixture'.length));
      const artifact=pathname.match(/^\/artifacts\/([a-zA-Z0-9-]+)\/(.*)$/);
      if(artifact)return serveFile(res,path.join(runsRoot,artifact[1],'artifacts'),artifact[2]);
      if(pathname.startsWith('/api/'))return json(res,404,{error:'API route not found'});
      return serveFile(res,path.join(root,'frontend'),pathname);
    }catch(e){return json(res,400,{error:e.message});}
  });
  await new Promise(resolve=>server.listen(port,host,resolve));return server;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){const server=await createServer();console.log(`Accessible by Morning: http://127.0.0.1:${server.address().port}`);}
