import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {generateJson,fixWithGeminiApi,reviewWithGeminiApi} from '../backend/gemini-api.js';
const fixture={'index.html':'<html><input id="appointment-name"><div id="confirmation"></div></html>','styles.css':'body { color: black; }','app.js':'console.log("appointment");'};
const response=result=>({ok:true,json:async()=>({responseId:'real-response-id',usageMetadata:{totalTokenCount:123},candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(result)}]}}]})});
test('direct API reviewer is a separate source-only request and records real usage',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'morning-direct-'));
  try{
    for(const [name,source]of Object.entries(fixture))await writeFile(path.join(dir,name),source);
    let sent;
    const review=await reviewWithGeminiApi({sourceDir:dir,audit:{keyboard:{passed:true},marker:'fresh-measurements'},artifactDir:dir,apiKey:'test',fetchImpl:async(url,options)=>{sent={url,body:JSON.parse(options.body)};return response({approved:true,findings:[],summary:'Source-only review'});}});
    assert.equal(sent.body.contents.length,1);assert.equal(sent.body.contents[0].role,'user');assert.match(sent.body.contents[0].parts[0].text,/fresh-measurements/);assert.equal(sent.body.environment,undefined);assert.equal(sent.body.previous_interaction_id,undefined);assert.equal(sent.body.tools,undefined);
    assert.equal(sent.body.generationConfig.thinkingConfig.thinkingLevel,'LOW');assert.equal(sent.body.generationConfig.maxOutputTokens,16384);
    assert.equal(review.provider,'gemini-api');assert.equal(review.environmentId,undefined);
    const usage=JSON.parse((await readFile(path.join(dir,'gemini-api-usage.jsonl'),'utf8')).trim());assert.equal(usage.usage.totalTokenCount,123);assert.equal(usage.responseId,'real-response-id');assert.equal(usage.role,'reviewer');
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('direct repair refuses partial source and never writes an unvalidated artifact',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'morning-partial-'));
  try{
    for(const [name,source]of Object.entries(fixture))await writeFile(path.join(dir,name),source);
    await assert.rejects(()=>fixWithGeminiApi({sourceDir:dir,outputDir:dir,audit:{},artifactDir:dir,apiKey:'test',fetchImpl:async()=>response({files:{'index.html':fixture['index.html']},summary:'partial'})}),/Invalid source file/);
    assert.equal(await readFile(path.join(dir,'app.js'),'utf8'),fixture['app.js']);
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('direct API rejects truncated output and records usage without POST retry',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'morning-truncated-'));let calls=0;
  try{
    await assert.rejects(()=>generateJson({prompt:'repair',role:'fixer',artifactDir:dir,apiKey:'test',fetchImpl:async()=>{calls++;return {ok:true,json:async()=>({usageMetadata:{totalTokenCount:999},candidates:[{finishReason:'MAX_TOKENS',content:{parts:[{text:'{"files":'}]}}]})};}}),/MAX_TOKENS/);
    assert.equal(calls,1);const usage=JSON.parse((await readFile(path.join(dir,'gemini-api-usage.jsonl'),'utf8')).trim());assert.equal(usage.status,'failed');assert.equal(usage.usage.totalTokenCount,999);
  }finally{await rm(dir,{recursive:true,force:true});}
});
