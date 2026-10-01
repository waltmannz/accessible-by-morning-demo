import {mkdir,cp,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {auditSite} from './audit.js';
import {startStatic} from './static.js';
import {fixLocally} from './local-fixer.js';
import {fixWithGemini,reviewWithGemini,FIXTURE_FILES} from './gemini.js';
import {fixWithGeminiApi,reviewWithGeminiApi} from './gemini-api.js';

const execFileAsync=promisify(execFile);
export async function runPipeline({id,mode='local',runDir,repoPath=path.resolve('fixture'),task='Book an appointment',onEvent=()=>{},signal,resumeCandidate=false}) {
  if(!['local','gemini','gemini-api'].includes(mode)) throw new Error('Unknown pipeline mode');
  if(mode!=='local' && !process.env.GEMINI_API_KEY) throw new Error('Configure GEMINI_API_KEY to run Gemini');
  const beforeDir=path.join(runDir,'before'),afterDir=path.join(runDir,'after'),artifactDir=path.join(runDir,'artifacts');
  await mkdir(artifactDir,{recursive:true});
  const state={id,mode,status:'running',stage:'setup',task,startedAt:new Date().toISOString(),events:[],baseline:null,verification:null,artifacts:{report:`/api/runs/${id}/report`,patch:`/artifacts/${id}/changes.patch`,review:`/artifacts/${id}/verification/audit.json`,beforePreview:`/preview/${id}/before/`,afterPreview:`/preview/${id}/after/`,beforeLighthouse:`/artifacts/${id}/baseline/lighthouse.html`,afterLighthouse:`/artifacts/${id}/verification/lighthouse.html`,beforeScreenshot:`/artifacts/${id}/baseline/screenshot.png`,afterScreenshot:`/artifacts/${id}/verification/screenshot.png`},humanTesting:'Not performed. Independent disabled audit and real screen-reader task testing remain required.'};
  const persist=async()=>{await writeFile(path.join(runDir,'run.json'),JSON.stringify(state,null,2));await writeFile(path.join(runDir,'progress.md'),`# Run ${id}\n\nMode: ${mode}\nStatus: ${state.status}\nStage: ${state.stage}\n\n${state.events.map(e=>`- ${e.at}: ${e.message}`).join('\n')}\n`);onEvent(structuredClone(state));};
  const event=async(stage,message)=>{state.stage=stage;state.events.push({stage,message,at:new Date().toISOString()});await persist();};
  let beforeServer,afterServer;
  try {
    if(resumeCandidate){
      const prior=JSON.parse(await readFile(path.join(runDir,'run.json'),'utf8'));
      if(prior.id!==id||prior.mode!==mode)throw new Error('Resume run identity or mode mismatch');
      if(['in_progress','queued','pending'].includes(prior.remote?.fixer?.status)||['in_progress','queued','pending'].includes(prior.remote?.reviewer?.status))throw new Error('Remote agent is still active. Wait for completion before resuming this exported candidate.');
      Object.assign(state,prior,{status:'running',error:undefined,completedAt:undefined});
      if(!state.baseline||!state.repair)throw new Error('Resume requires a completed baseline and exported repair source');
      await event('resume','Resuming the exported candidate and persisted environment IDs; rechecking before any further fix call.');
    }else{
      await event('setup','Copying the deliberately broken fixture into isolated before and repair directories.');
      await cp(repoPath,beforeDir,{recursive:true});await cp(repoPath,afterDir,{recursive:true});
    }
    beforeServer=await startStatic(beforeDir);afterServer=await startStatic(afterDir);
    if(!resumeCandidate){
      await event('baseline','Measuring real axe, Lighthouse, semantic evidence, and the appointment keyboard task.');
      state.baseline=await auditSite({url:beforeServer.url,outputDir:path.join(artifactDir,'baseline'),signal});
    }
    await event('plan',`Baseline: ${state.baseline.violationCount} axe rule violations; keyboard task ${state.baseline.keyboard.passed?'passed':'blocked'}.`);
    let previous=resumeCandidate?state.remote?.fixer:undefined,fix,review;
    const maxAttempts=mode==='gemini-api'?2:mode==='gemini'&&process.env.GEMINI_EXECUTION_MODE==='stream'?1:3;
    for(let attempt=1;attempt<=maxAttempts;attempt++) {
      signal?.throwIfAborted();
      const onState=async remote=>{state.remote={...(state.remote||{}),[remote.role]:remote};if(remote.provider==='gemini-api'&&['completed','failed'].includes(remote.status)){state.apiCalls||=[];state.apiCalls.push({...remote,at:new Date().toISOString()});}await persist();};
      if(!(resumeCandidate&&attempt===1)){
        await event('fix',mode==='local'?'Applying the deterministic fixture repair; no hosted agent is used.':mode==='gemini-api'?`Gemini API fixer attempt ${attempt}: generating actual repaired source through a direct model call.`:`Gemini managed fixer attempt ${attempt}: modifying mounted source in Google’s sandbox.`);
        if(mode==='local') fix=await fixLocally(afterDir);
        else if(mode==='gemini-api')fix=await fixWithGeminiApi({sourceDir:afterDir,outputDir:afterDir,audit:state.verification||state.baseline,artifactDir,onState,signal});
        else {fix=await fixWithGemini({sourceDir:afterDir,outputDir:afterDir,audit:state.verification||state.baseline,artifactDir,onState,signal,previous});previous=fix.interaction;}
        state.repair={summary:fix.summary,wcag:fix.wcag};
      }
      await event('verify','A fresh Chromium process independently checks the repaired files.');
      state.verification=await auditSite({url:afterServer.url,outputDir:path.join(artifactDir,'verification'),signal});
      const measuredPass=state.verification.violationCount===0 && state.verification.keyboard.passed && state.verification.functionality.passed && state.verification.lighthouseScore===100 && state.verification.lighthouseScore>=state.baseline.lighthouseScore;
      if(mode==='gemini') {
        await event('review','A separate Gemini environment reviews only the candidate source and verification checklist.');
        review=await reviewWithGemini({sourceDir:afterDir,audit:state.verification,artifactDir,onState,signal});
        if(!review.environmentId||review.environmentId===previous?.environment_id){review.approved=false;review.findings.push('Independent reviewer must have a distinct fresh environment.');}
        state.review=review;
      } else if(mode==='gemini-api'){
        await event('review','A separate Gemini API request reviews candidate source and host measurements without fixer conversation context.');
        state.review=await reviewWithGeminiApi({sourceDir:afterDir,audit:state.verification,artifactDir,onState,signal});
      }else state.review={approved:measuredPass,summary:'Fresh local browser verification; no AI reviewer or human auditor ran.',findings:measuredPass?[]:['Automated verification failed']};
      if(measuredPass && state.review.approved) break;
      if(mode==='local'||attempt===maxAttempts) throw new Error(`Verification gate failed: ${state.verification.violationCount} axe violations; keyboard=${state.verification.keyboard.passed}; reviewer=${state.review.approved}`);
      state.verification.reviewFindings=state.review.findings;
      await event('retry',mode==='gemini-api'?'Verifier findings are returning to a new Gemini API repair request with the candidate source.':'Verifier findings are returning to the fixer in its existing environment.');
    }
    await writeFile(path.join(artifactDir,'review.json'),JSON.stringify(state.review,null,2));
    state.artifacts.review=`/artifacts/${id}/review.json`;
    state.artifacts.verification=`/artifacts/${id}/verification/audit.json`;
    await event('report','Writing measured evidence, source diff, and a reviewable pull request description.');
    state.sourceHashes=Object.fromEntries(await Promise.all(FIXTURE_FILES.map(async file=>[file,createHash('sha256').update(await readFile(path.join(afterDir,file))).digest('hex')])));
    let patch='';
    for(const file of FIXTURE_FILES) {
      try {const diff=await execFileAsync('git',['diff','--no-index','--',path.join(beforeDir,file),path.join(afterDir,file)],{maxBuffer:2000000});patch+=diff.stdout;}catch(e){if(e.code===1)patch+=e.stdout;else throw e;}
    }
    await writeFile(path.join(artifactDir,'changes.patch'),patch);
    state.status='completed';state.completedAt=new Date().toISOString();state.stage='complete';
    state.claim='Measured automated checks passed on this fixture. This is not a WCAG compliance certification.';
    const report=`# Accessible by Morning: measured demo report\n\nRun: ${id}\nMode: ${mode === 'local' ? 'Deterministic local fixture repair (no Gemini calls)' : mode === 'gemini-api' ? 'Gemini API direct source repair and separate single-turn source review (no managed environment)' : 'Gemini managed fixer and fresh managed reviewer'}\nTask: ${task}\n\n| Measurement | Before | After |\n|---|---:|---:|\n| Lighthouse accessibility | ${state.baseline.lighthouseScore ?? 'unavailable'} | ${state.verification.lighthouseScore ?? 'unavailable'} |\n| Axe rule violations | ${state.baseline.violationCount} | ${state.verification.violationCount} |\n| Affected DOM nodes | ${state.baseline.affectedNodes} | ${state.verification.affectedNodes} |\n| Keyboard booking task | ${state.baseline.keyboard.passed?'passed':'blocked'} | ${state.verification.keyboard.passed?'passed':'blocked'} |\n\n${state.repair.summary}\n\nWCAG criteria addressed: ${state.repair.wcag?.join(', ') || 'see source review'}.\n\nThe transcript is DOM semantic inspection, not NVDA/JAWS audio or human testing. The native date field receives seeded test data; date-picker keyboard gestures are not covered. ${state.humanTesting}\n\n${state.claim}\n\nEvidence: baseline/ and verification/ contain raw axe, Lighthouse, keyboard steps, screenshots, and DOM transcripts. changes.patch contains the source diff.\n`;
    await writeFile(path.join(artifactDir,'report.md'),report);
    await writeFile(path.join(artifactDir,'pr-description.md'),report);
    await event('complete','The repaired appointment task passed the automated verification gate. Reports and source diff are ready.');
    return state;
  } catch(error) {state.status=signal?.aborted?'cancelled':'failed';state.error=error.message;await event(state.status,error.message);throw Object.assign(error,{run:state});}
  finally {await beforeServer?.close();await afterServer?.close();}
}
