import http from 'node:http';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {readFile,readdir,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {runPipeline} from './pipeline.js';
import {serveFile} from './static.js';
import {getAgent,GeminiManagedAgent} from './gemini.js';
import {getApiModel} from './gemini-api.js';
import {writeJsonAtomic,summarizeRunUsage} from './evidence.js';
import {networkInterfaces} from 'node:os';
try{process.loadEnvFile();}catch{}
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export function hasUnresolvedManagedWork(run){return run.mode==='gemini'&&Object.values(run.remote||{}).some(remote=>['in_progress','queued','pending'].includes(remote.status));}
export function checkMutationRequest(req,{allowedHosts,port,publicOrigins=[]}){
  let hostUrl;try{hostUrl=new URL(`http://${req.headers.host}`);}catch{return {status:403,error:'Invalid request host'};}
  const configuredOrigin=publicOrigins.find(origin=>origin.hostname===hostUrl.hostname&&Number(origin.port||(origin.protocol==='https:'?443:80))===Number(hostUrl.port||(origin.protocol==='https:'?443:80)));
  if(!configuredOrigin&&(!allowedHosts.has(hostUrl.hostname.replace(/^\[|\]$/g,''))||Number(hostUrl.port||80)!==port))return {status:403,error:'Request host is not allowed'};
  if(req.headers.origin){let origin;try{origin=new URL(req.headers.origin);}catch{return {status:403,error:'Invalid request origin'};}if(origin.origin!==(configuredOrigin?.origin||hostUrl.origin))return {status:403,error:'Cross-origin API mutations are not allowed'};}
  if((req.headers['content-type']||'').toLowerCase().split(';')[0].trim()!=='application/json')return {status:415,error:'API mutations require Content-Type application/json'};
  return null;
}
const presentRun=run=>({...run,metrics:summarizeRunUsage(run)});
function json(res,status,data){res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(data));}
async function body(req){let buffer='',bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>16000)throw new Error('Request body too large');buffer+=chunk;}return JSON.parse(buffer||'{}');}
export async function createServer({port=Number(process.env.PORT||3000),host=process.env.HOST||'127.0.0.1',rootDir=root,runsDir=path.join(rootDir,'runs'),publicOrigins=(process.env.DEMO_PUBLIC_ORIGINS||'').split(',').filter(Boolean),pipeline=runPipeline,managedClientFactory=()=>new GeminiManagedAgent()}={}) {
  const runsRoot=runsDir,runs=new Map(),controllers=new Map();
  const trustedPublicOrigins=publicOrigins.map(value=>{const origin=new URL(value.trim());if(!['http:','https:'].includes(origin.protocol)||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)throw new Error('DEMO_PUBLIC_ORIGINS must contain exact http/https origins without paths or credentials');return origin;});
  const allowedHosts=new Set(['localhost','127.0.0.1','::1',host,...Object.values(networkInterfaces()).flat().filter(Boolean).map(n=>n.address),...(process.env.DEMO_ALLOWED_HOSTS||'').split(',').map(h=>h.trim()).filter(Boolean)]);
  await mkdir(runsRoot,{recursive:true});
  for(const name of await readdir(runsRoot)){try{const file=path.join(runsRoot,name,'run.json'),run=JSON.parse(await readFile(file,'utf8'));if(run.status==='running'){run.status='interrupted';run.error='Server restarted during this run; inspect persisted remote IDs before starting another managed run.';await writeJsonAtomic(file,run);}runs.set(run.id,run);}catch{}}
  const server=http.createServer(async(req,res)=>{
    try {
      const url=new URL(req.url,'http://localhost'),pathname=url.pathname;
      if(pathname.startsWith('/api/')&&!['GET','POST'].includes(req.method))return json(res,405,{error:'Method not allowed'});
      let postInput;
      if(pathname.startsWith('/api/')&&req.method==='POST'){const rejection=checkMutationRequest(req,{allowedHosts,port:server.address().port,publicOrigins:trustedPublicOrigins});if(rejection)return json(res,rejection.status,{error:rejection.error});postInput=await body(req);}
      if(pathname==='/health')return json(res,200,{status:'ok'});
      if(pathname==='/api/config')return json(res,200,{geminiConfigured:Boolean(process.env.GEMINI_API_KEY),geminiApiConfigured:Boolean(process.env.GEMINI_API_KEY),apiModel:getApiModel(),defaultMode:process.env.GEMINI_API_KEY?'gemini-api':'local',agent:getAgent(),repository:process.env.DEMO_REPO_URL||null,humanTesting:'not-performed',blockedManagedRuns:[...runs.values()].filter(hasUnresolvedManagedWork).map(run=>({id:run.id,status:run.status,remote:run.remote}))});
      if(pathname==='/api/runs'&&req.method==='GET')return json(res,200,{runs:[...runs.values()].sort((a,b)=>b.startedAt.localeCompare(a.startedAt)).map(presentRun)});
      if(pathname==='/api/runs'&&req.method==='POST'){
        if(controllers.size)return json(res,409,{error:'A run is already active. Wait for it or cancel it.'});
        const input=postInput,mode=input.mode||(process.env.GEMINI_API_KEY?'gemini-api':'local');
        if(!['gemini','gemini-api','local'].includes(mode))return json(res,400,{error:'Mode must be gemini, gemini-api or local'});
        if(mode!=='local'&&!process.env.GEMINI_API_KEY)return json(res,400,{error:'Set GEMINI_API_KEY in local .env to use Gemini.'});
        if(mode==='gemini'&&[...runs.values()].some(hasUnresolvedManagedWork))return json(res,409,{error:'An earlier hosted interaction remains active or cancellation is unconfirmed. Reconcile its remote status before starting another managed job.',blockedRunIds:[...runs.values()].filter(hasUnresolvedManagedWork).map(run=>run.id)});
        const id=`${mode}-${randomUUID().slice(0,12)}`,controller=new AbortController();controllers.set(id,controller);
        const initial={id,mode,status:'running',stage:'setup',task:'Book an appointment',startedAt:new Date().toISOString(),events:[]};runs.set(id,initial);
        pipeline({id,mode,runDir:path.join(runsRoot,id),repoPath:path.join(rootDir,'fixture'),task:'Book an appointment',signal:controller.signal,onEvent:state=>runs.set(id,state)}).catch(e=>{if(e.run)runs.set(id,e.run);else runs.set(id,{...initial,status:'failed',error:e.message});}).finally(()=>controllers.delete(id));
        return json(res,202,initial);
      }
      const runMatch=pathname.match(/^\/api\/runs\/([a-zA-Z0-9-]+)(?:\/(report|cancel|events|reconcile))?$/);
      if(runMatch){const [,id,action]=runMatch,run=runs.get(id);if(!run)return json(res,404,{error:'Run not found'});
        if(action&&['cancel','reconcile'].includes(action)&&req.method!=='POST')return json(res,405,{error:'This action requires POST'});
        if(action&&['events','report'].includes(action)&&req.method!=='GET')return json(res,405,{error:'This artifact requires GET'});
        if(!action&&req.method!=='GET')return json(res,405,{error:'Run details require GET'});
        if(action==='cancel'&&req.method==='POST'){if(!controllers.has(id))return json(res,409,{error:'No local loop is running. Use cloud status reconciliation for a previously interrupted managed run.',id,status:run.status});controllers.get(id).abort(new Error('Run cancelled by user'));return json(res,202,{id,status:'cancelling'});}
        if(action==='reconcile'&&req.method==='POST'){
          if(run.mode!=='gemini')return json(res,400,{error:'Only managed runs have remote status to reconcile'});
          if(controllers.has(id))return json(res,409,{error:'The local loop is active and owns its cloud status. Wait for it to stop before reconciling.'});
          const client=managedClientFactory();
          for(const remote of Object.values(run.remote||{})){if(remote.id){const actual=await client.request(`/interactions/${encodeURIComponent(remote.id)}`);remote.status=actual.status;remote.environment_id=actual.environment_id||remote.environment_id;remote.usage=actual.usage;remote.reconciledAt=new Date().toISOString();if(!['in_progress','queued','pending'].includes(actual.status))remote.cancellationStatus='terminal confirmed';}}
          await writeJsonAtomic(path.join(runsRoot,id,'run.json'),run);runs.set(id,run);return json(res,200,presentRun(run));
        }
        if(action==='report')return serveFile(res,path.join(runsRoot,id,'artifacts'),'report.md');
        if(action==='events')return json(res,200,{events:run.events,status:run.status});
        return json(res,200,presentRun(run));
      }
      const preview=pathname.match(/^\/preview\/([a-zA-Z0-9-]+)\/(before|after)(\/.*)?$/);
      if(preview)return serveFile(res,path.join(runsRoot,preview[1],preview[2]),preview[3]||'/');
      if(pathname.startsWith('/preview/fixture/'))return serveFile(res,path.join(rootDir,'fixture'),pathname.slice('/preview/fixture'.length));
      if(pathname.startsWith('/fixture/'))return serveFile(res,path.join(rootDir,'fixture'),pathname.slice('/fixture'.length));
      const artifact=pathname.match(/^\/artifacts\/([a-zA-Z0-9-]+)\/(.*)$/);
      if(artifact)return serveFile(res,path.join(runsRoot,artifact[1],'artifacts'),artifact[2]);
      if(pathname.startsWith('/api/'))return json(res,404,{error:'API route not found'});
      return serveFile(res,path.join(rootDir,'frontend'),pathname);
    }catch(e){return json(res,400,{error:e.message});}
  });
  server.on('close',()=>{for(const controller of controllers.values())controller.abort(new Error('Server shut down'));});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,()=>{server.removeListener('error',reject);resolve();});});return server;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){const server=await createServer();console.log(`Accessible by Morning: http://127.0.0.1:${server.address().port}`);}
