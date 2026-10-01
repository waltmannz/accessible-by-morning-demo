import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {GeminiManagedAgent,fixWithGemini,parseAgentJson,validateFiles} from '../backend/gemini.js';
import {hasUnresolvedManagedWork} from '../backend/server.js';

test('background agent continues incomplete work in the same environment with bounded budget',async()=>{
  const requests=[],states=[];
  const responses=[{id:'one',environment_id:'env-one',status:'in_progress'},{id:'one',environment_id:'env-one',status:'incomplete'},{id:'two',environment_id:'env-one',status:'completed',output_text:'done'}];
  const agent=new GeminiManagedAgent({apiKey:'test',pollMs:1,fetchImpl:async(url,options)=>{requests.push({url,options});return {ok:true,status:200,json:async()=>responses.shift()};},onState:state=>states.push(state)});
  const result=await agent.run({input:'repair',sources:[{name:'index.html',content:'<html>test</html>'}]});
  assert.equal(result.id,'two');
  const continuation=JSON.parse(requests[2].options.body);
  assert.equal(continuation.previous_interaction_id,'one');assert.equal(continuation.environment,'env-one');assert.equal(continuation.agent_config.max_total_tokens,50000);
  assert.equal(states.at(-1).continuations,1);
});
test('create failures are not retried and do not duplicate billable jobs',async()=>{
  let count=0;
  const agent=new GeminiManagedAgent({apiKey:'test',fetchImpl:async()=>{count++;return {ok:false,status:503};}});
  await assert.rejects(()=>agent.run({input:'repair',sources:[]}),/HTTP 503/);assert.equal(count,1);
});
test('retry sends new independent verifier and reviewer findings into reused fixer environment',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'morning-agent-'));
  const files={'index.html':'<html><input id="appointment-name"><div id="confirmation"></div></html>','styles.css':'body { color: black; }','app.js':'console.log("appointment");'};
  try{
    for(const [name,content] of Object.entries(files))await writeFile(path.join(dir,name),content);
    let request;
    await fixWithGemini({sourceDir:dir,outputDir:dir,artifactDir:dir,previous:{id:'prior',environment_id:'same-env'},audit:{violationCount:1,violations:[{id:'color-contrast'}],keyboard:{passed:false},reviewFindings:['Slot fails Enter activation']},agentImpl:{run:async input=>{request=input;return {status:'completed',output_text:JSON.stringify({files,summary:'repair',wcag:['2.1.1']})};}}});
    assert.equal(request.previous.environment_id,'same-env');assert.match(request.input,/Slot fails Enter activation/);assert.match(request.input,/color-contrast/);assert.match(request.input,/"passed":false/);
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('source artifact rejects paths beyond fixed fixture allowlist',()=>{
  assert.throws(()=>validateFiles({'../secret':'text'}),/allowlist/);
  assert.deepEqual(parseAgentJson({steps:[{type:'model_output',content:[{type:'text',text:'```json\n{"approved":true}\n```'}]}]}),{approved:true});
});
test('timed out background work requests cancellation and persists its remote identity',async()=>{
  const requests=[],states=[];
  const agent=new GeminiManagedAgent({apiKey:'test',timeoutMs:-1,onState:state=>states.push(state),fetchImpl:async(url,options)=>{requests.push({url,options});return {ok:true,status:200,json:async()=>({id:'timeout-job',environment_id:'timeout-env',status:'in_progress'})};}});
  await assert.rejects(()=>agent.run({input:'repair',sources:[]}),/timeout/);
  assert.match(requests.at(-1).url,/interactions\/timeout-job\/cancel$/);
  assert.equal(states.at(-1).id,'timeout-job');assert.equal(states.at(-1).cancellationStatus,'requested');
});
test('unconfirmed remote lifecycle blocks another managed job even after local timeout',()=>{
  assert.equal(hasUnresolvedManagedWork({mode:'gemini',status:'failed',remote:{fixer:{status:'in_progress',cancellationStatus:'HTTP 400'}}}),true);
  assert.equal(hasUnresolvedManagedWork({mode:'gemini',status:'cancelled',remote:{fixer:{status:'cancelled',cancellationStatus:'terminal confirmed'}}}),false);
  assert.equal(hasUnresolvedManagedWork({mode:'local',remote:{}}),false);
});
test('foreground keeps SSE open, persists identity, then retrieves complete exported source',async()=>{
  const requests=[],states=[];
  const sse='data: '+JSON.stringify({event_type:'interaction.created',interaction:{id:'stream-job',status:'in_progress'}})+'\n\n'+'data: '+JSON.stringify({event_type:'interaction.completed',interaction:{id:'stream-job',status:'completed'}})+'\n\n';
  const body=new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode(sse.slice(0,61)));controller.enqueue(new TextEncoder().encode(sse.slice(61)));controller.close();}});
  const agent=new GeminiManagedAgent({apiKey:'test',executionMode:'stream',onState:state=>states.push(state),fetchImpl:async(url,options)=>{requests.push({url,options});return requests.length===1?{ok:true,body}:{ok:true,status:200,json:async()=>({id:'stream-job',environment_id:'fresh-env',status:'completed',output_text:'{"files":{}}'})};}});
  const result=await agent.run({input:'export source',sources:[{name:'index.html',content:'<html>site</html>'}]});
  const sent=JSON.parse(requests[0].options.body);assert.equal(sent.background,false);assert.equal(sent.stream,true);assert.equal(requests.filter(r=>r.options.method==='POST').length,1);
  assert.equal(states[0].id,'stream-job');assert.equal(result.environment_id,'fresh-env');assert.equal(result.output_text,'{"files":{}}');
});
test('foreground incomplete continuation retains streaming transport and environment',async()=>{
  const requests=[],states=[];let post=0;
  const agent=new GeminiManagedAgent({apiKey:'test',executionMode:'stream',maxContinuations:1,onState:state=>states.push(state),fetchImpl:async(url,options)=>{
    requests.push({url,options});
    if(options.method==='POST'){
      post++;const id=post===1?'first-stream':'continued-stream';
      const sse=`data: ${JSON.stringify({event_type:'interaction.created',interaction:{id,status:'in_progress'}})}\n\ndata: ${JSON.stringify({event_type:'interaction.completed',interaction:{id,status:post===1?'incomplete':'completed'}})}\n\n`;
      return {ok:true,body:new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode(sse));controller.close();}})};
    }
    return {ok:true,status:200,json:async()=>({id:post===1?'first-stream':'continued-stream',environment_id:'same-stream-env',status:post===1?'incomplete':'completed',output_text:'done'})};
  }});
  const result=await agent.run({input:'repair',sources:[]});
  const creates=requests.filter(r=>r.options.method==='POST').map(r=>JSON.parse(r.options.body));
  assert.equal(creates.length,2);assert.ok(creates.every(c=>c.background===false&&c.stream===true));assert.equal(creates[1].previous_interaction_id,'first-stream');assert.equal(creates[1].environment,'same-stream-env');assert.equal(result.status,'completed');
  assert.equal(states.find(s=>s.id==='continued-stream').environment_id,'same-stream-env');
});
