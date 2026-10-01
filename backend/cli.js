import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {runPipeline} from './pipeline.js';
try{process.loadEnvFile();}catch{}
if(process.argv.includes('--foreground'))process.env.GEMINI_EXECUTION_MODE='stream';
const resumeIndex=process.argv.indexOf('--resume');
const resumeId=resumeIndex>=0?process.argv[resumeIndex+1]:undefined;
if(resumeIndex>=0 && (!resumeId||!/^[a-zA-Z0-9-]+$/.test(resumeId)))throw new Error('Supply a valid run ID after --resume');
const mode=process.argv.includes('--gemini-api')||resumeId?.startsWith('gemini-api-')?'gemini-api':process.argv.includes('--gemini')||resumeId?.startsWith('gemini-')?'gemini':'local';
const id=resumeId||`${mode}-${new Date().toISOString().replace(/[:.]/g,'-')}-${randomUUID().slice(0,8)}`;
const runDir=path.resolve('runs',id);
const controller=new AbortController();process.on('SIGINT',()=>controller.abort(new Error('Run interrupted')));process.on('SIGTERM',()=>controller.abort(new Error('Run terminated')));
try {const result=await runPipeline({id,mode,runDir,resumeCandidate:Boolean(resumeId),signal:controller.signal,onEvent:state=>{const latest=state.events.at(-1);if(latest && globalThis.lastEvent!==latest.at){console.log(`${latest.stage}: ${latest.message}`);globalThis.lastEvent=latest.at;}}});console.log(JSON.stringify({id,status:result.status,mode,report:path.join(runDir,'artifacts','report.md'),before:result.baseline.lighthouseScore,after:result.verification.lighthouseScore}));}catch(e){console.error(e.message);process.exitCode=1;}
