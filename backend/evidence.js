import {readFile,writeFile,rename} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {FIXTURE_FILES} from './gemini.js';
import {REQUIRED_AUDIT_STATES} from './audit.js';
export async function writeJsonAtomic(file,value){const temporary=file+'.tmp';await writeFile(temporary,JSON.stringify(value,null,2));await rename(temporary,file);}
export async function hashSource(dir){return Object.fromEntries(await Promise.all(FIXTURE_FILES.map(async file=>[file,createHash('sha256').update(await readFile(path.join(dir,file))).digest('hex')])));}
export async function assertSourceUnchanged(dir,expected,checkpoint){const actual=await hashSource(dir);for(const file of FIXTURE_FILES)if(!expected?.[file]||expected[file]!==actual[file])throw new Error(`Source changed ${checkpoint}: ${file}; verification is invalid.`);return actual;}
export function assertBrowserVerified(audit,baseline){
  if(audit?.violationCount!==0||audit.keyboard?.passed!==true||audit.functionality?.passed!==true||audit.lighthouseScore!==100||audit.lighthouseScore<baseline?.lighthouseScore)throw new Error('Independent browser verification failed');
  if(audit.schemaVersion>=2&&(audit.stateCoveragePassed!==true||REQUIRED_AUDIT_STATES.some(id=>!audit.states?.some(s=>s.id===id&&s.status==='measured'&&s.violationCount===0))))throw new Error('Required interaction state evidence is missing or failed');
  return true;
}
export function summarizeRunUsage(run){
  const calls=run.providerCalls||run.apiCalls||Object.values(run.remote||{}).filter(r=>r.usage);
  const result={recordedCalls:calls.length,failedCalls:0,totalTokens:0,inputTokens:0,outputTokens:0,thinkingTokens:0,unknownUsageCalls:0,basis:'Recorded provider responses; monetary cost has not been calculated.'};
  for(const call of calls){if(call.status==='failed')result.failedCalls++;const usage=call.usage;if(!Number.isFinite(usage?.totalTokenCount??usage?.total_tokens)){result.unknownUsageCalls++;continue;}result.totalTokens+=usage.totalTokenCount??usage.total_tokens;result.inputTokens+=usage.promptTokenCount??usage.total_input_tokens??0;result.outputTokens+=usage.candidatesTokenCount??usage.total_output_tokens??0;result.thinkingTokens+=usage.thoughtsTokenCount??usage.total_thought_tokens??0;}
  return result;
}
