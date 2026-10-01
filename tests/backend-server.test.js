import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {createServer,checkMutationRequest} from '../backend/server.js';
import http from 'node:http';
async function close(server){if(server)await new Promise(resolve=>server.close(resolve));}
async function cleanup(dir){assert.equal(path.dirname(path.resolve(dir)),path.resolve(tmpdir()));await rm(dir,{recursive:true,force:true});}
test('paid run mutations reject cross-origin forms, rebinding hosts, malformed JSON and oversized bodies before invoking a pipeline',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'morning-server-'));let started=0,server;
  try{
    server=await createServer({rootDir:dir,port:0,pipeline:async({id,mode,onEvent})=>{started++;onEvent({id,mode,status:'completed',startedAt:new Date().toISOString()});}});
    const base=`http://127.0.0.1:${server.address().port}`;
    for(const [options,status]of [[{headers:{'content-type':'text/plain'},body:'{"mode":"local"}'},415],[{headers:{'content-type':'application/json',origin:'https://attacker.example'},body:'{"mode":"local"}'},403],[{headers:{'content-type':'application/json'},body:'{invalid'},400],[{headers:{'content-type':'application/json'},body:JSON.stringify({mode:'local',extra:'x'.repeat(16000)})},400]]){const response=await fetch(base+'/api/runs',{method:'POST',...options});assert.equal(response.status,status);}
    // Fetch owns its Host header, so use an actual HTTP request to test rebinding.
    const rebound=await new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port:server.address().port,path:'/api/runs',method:'POST',headers:{host:`attacker.example:${server.address().port}`,'content-type':'application/json'}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.end('{"mode":"local"}');});assert.equal(rebound,403);
    assert.equal(started,0);
    assert.equal((await fetch(base+'/api/runs',{method:'POST',headers:{'content-type':'application/json'},body:'{"mode":"local"}'})).status,202);assert.equal(started,1);
    assert.equal((await fetch(base+'/api/runs',{method:'PUT'})).status,405);
  }finally{await close(server);await cleanup(dir);}
});
test('restart persists interruption and read-only reconciliation confirms terminal cloud state using the recorded ID',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'morning-restart-'));let server;const requests=[];
  try{
    const runDir=path.join(dir,'runs','gemini-interrupted');await mkdir(runDir,{recursive:true});await writeFile(path.join(runDir,'run.json'),JSON.stringify({id:'gemini-interrupted',mode:'gemini',status:'running',startedAt:new Date().toISOString(),remote:{fixer:{id:'persisted-cloud-id',environment_id:'old-env',status:'in_progress'}}}));
    server=await createServer({rootDir:dir,port:0,managedClientFactory:()=>({request:async endpoint=>{requests.push(endpoint);return {status:'incomplete',environment_id:'old-env',usage:{total_tokens:14,total_input_tokens:10,total_output_tokens:4}};}})});
    const base=`http://127.0.0.1:${server.address().port}`;
    assert.equal(JSON.parse(await readFile(path.join(runDir,'run.json'),'utf8')).status,'interrupted');
    assert.equal((await fetch(base+'/api/runs/gemini-interrupted/cancel',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status,409);
    const response=await fetch(base+'/api/runs/gemini-interrupted/reconcile',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});assert.equal(response.status,200);
    const reconciled=await response.json();assert.equal(reconciled.remote.fixer.status,'incomplete');assert.equal(reconciled.remote.fixer.cancellationStatus,'terminal confirmed');assert.equal(reconciled.metrics.totalTokens,14);assert.deepEqual(requests,['/interactions/persisted-cloud-id']);
    assert.equal((await fetch(base+'/api/config')).status,200);assert.deepEqual((await(await fetch(base+'/api/config')).json()).blockedManagedRuns,[]);
  }finally{await close(server);await cleanup(dir);}
});
test('server instances have isolated history and occupied ports reject startup instead of hanging',async()=>{
  const one=await mkdtemp(path.join(tmpdir(),'morning-instance-')),two=await mkdtemp(path.join(tmpdir(),'morning-instance-'));let first,second;
  try{await mkdir(path.join(one,'runs','only-one'),{recursive:true});await writeFile(path.join(one,'runs','only-one','run.json'),JSON.stringify({id:'only-one',mode:'local',status:'failed',startedAt:new Date().toISOString()}));first=await createServer({rootDir:one,port:0});second=await createServer({rootDir:two,port:0});assert.equal((await(await fetch(`http://127.0.0.1:${first.address().port}/api/runs`)).json()).runs.length,1);assert.equal((await(await fetch(`http://127.0.0.1:${second.address().port}/api/runs`)).json()).runs.length,0);await assert.rejects(createServer({rootDir:two,port:first.address().port}),error=>error.code==='EADDRINUSE');}
  finally{await close(first);await close(second);await cleanup(one);await cleanup(two);}
});
test('only explicitly configured public origins support HTTPS and mapped external ports',()=>{
  const req={headers:{host:'demo.example',origin:'https://demo.example','content-type':'application/json'}};
  const config={allowedHosts:new Set(['127.0.0.1']),port:8080};assert.equal(checkMutationRequest(req,config).status,403);
  assert.equal(checkMutationRequest(req,{...config,publicOrigins:[new URL('https://demo.example')]}),null);
  assert.equal(checkMutationRequest({...req,headers:{...req.headers,origin:'https://attacker.example'}},{...config,publicOrigins:[new URL('https://demo.example')]}).status,403);
  assert.equal(checkMutationRequest({headers:{host:'localhost:9000',origin:'http://localhost:9000','content-type':'application/json'}},{...config,publicOrigins:[new URL('http://localhost:9000')]}),null);
  assert.equal(checkMutationRequest({...req,headers:{...req.headers,'x-forwarded-host':'demo.example','x-forwarded-proto':'https'}},config).status,403);
});
