import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {GeminiManagedAgent,fixWithGemini,parseAgentJson,validateFiles} from '../backend/gemini.js';

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
