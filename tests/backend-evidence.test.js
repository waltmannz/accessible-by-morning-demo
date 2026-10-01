import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {tmpdir} from 'node:os';
import http from 'node:http';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {aggregateStateViolations,REQUIRED_AUDIT_STATES,auditSite} from '../backend/audit.js';
import {hashSource,assertSourceUnchanged,assertBrowserVerified,summarizeRunUsage} from '../backend/evidence.js';
const violation=(target)=>({id:'color-contrast',nodes:[{target:[target],html:'<p>example</p>'}]});
test('interaction-only failures join initial rules without duplicating the same rule and target',()=>{
  const result=aggregateStateViolations([{id:'initial',status:'measured',violations:[violation('#copy')]},{id:'validation-error',status:'measured',violations:[violation('#copy'),violation('#booking-error')]},{id:'keyboard-focus',status:'skipped'}]);
  assert.equal(result.violationCount,1);assert.equal(result.affectedNodes,2);assert.deepEqual(result.violations[0].nodes[0].stateIds,['initial','validation-error']);
});
test('schema2 verification rejects skipped or missing task states even when headline scores pass',()=>{
  const good={schemaVersion:2,lighthouseScore:100,violationCount:0,keyboard:{passed:true},functionality:{passed:true},stateCoveragePassed:true,states:REQUIRED_AUDIT_STATES.map(id=>({id,status:'measured',violationCount:0}))};
  assertBrowserVerified(good,{lighthouseScore:81});
  assert.throws(()=>assertBrowserVerified({...good,states:good.states.filter(s=>s.id!=='confirmation'),requiredStateIds:[]}),/state evidence/);
  assert.throws(()=>assertBrowserVerified({...good,states:good.states.map(s=>s.id==='validation-error'?{...s,violationCount:1}:s)}),/state evidence/);
  assert.throws(()=>assertBrowserVerified({...good,lighthouseScore:99}),/verification failed/);
});
test('source measurement binding rejects changes after a browser scan or reviewer',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'morning-hash-'));
  try{for(const name of ['index.html','styles.css','app.js'])await writeFile(path.join(dir,name),'measured source');const hashes=await hashSource(dir);await assertSourceUnchanged(dir,hashes,'after browser measurement');await writeFile(path.join(dir,'app.js'),'changed after measurements');await assert.rejects(()=>assertSourceUnchanged(dir,hashes,'after independent review'),/Source changed after independent review: app.js/);}
  finally{assert.equal(path.dirname(path.resolve(dir)),path.resolve(tmpdir()));await rm(dir,{recursive:true,force:true});}
});
test('usage includes failed actual responses and explicitly counts missing usage rather than inventing cost',()=>{
  const metrics=summarizeRunUsage({apiCalls:[{status:'completed',usage:{promptTokenCount:5,candidatesTokenCount:7,totalTokenCount:12}},{status:'failed',usage:{promptTokenCount:3,candidatesTokenCount:2,thoughtsTokenCount:10,totalTokenCount:15}},{status:'failed'}]});
  assert.equal(metrics.recordedCalls,3);assert.equal(metrics.failedCalls,2);assert.equal(metrics.totalTokens,27);assert.equal(metrics.thinkingTokens,10);assert.equal(metrics.unknownUsageCalls,1);assert.equal(metrics.monetaryCost,undefined);
});

test('cancelling an actual browser navigation closes Chromium promptly and preserves the cancellation reason',{timeout:15000},async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'morning-cancel-')),controller=new AbortController();
  let requested=false;
  const server=http.createServer(()=>{requested=true;controller.abort(new Error('User stopped this browser audit'));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const started=Date.now();
  try{
    await assert.rejects(()=>auditSite({url:`http://127.0.0.1:${server.address().port}`,outputDir:dir,signal:controller.signal}),/User stopped this browser audit/);
    assert.equal(requested,true);assert.ok(Date.now()-started<10000,'Cancellation must not wait for the navigation timeout');
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));assert.equal(path.dirname(path.resolve(dir)),path.resolve(tmpdir()));await rm(dir,{recursive:true,force:true});}
});
