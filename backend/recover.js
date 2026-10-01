// Recover source from a terminal hosted interaction without restarting fixture work.
import path from 'node:path';
import {readFile,writeFile} from 'node:fs/promises';
import {GeminiManagedAgent,parseAgentJson,validateFiles} from './gemini.js';
import {runPipeline} from './pipeline.js';
try{process.loadEnvFile();}catch{}
const id=process.argv[2];
if(!id||!/^gemini-[a-zA-Z0-9-]+$/.test(id))throw new Error('Usage: node --env-file=.env backend/recover.js <gemini-run-id>');
const runDir=path.resolve('runs',id),artifactDir=path.join(runDir,'artifacts');
const state=JSON.parse(await readFile(path.join(runDir,'run.json'),'utf8'));
if(state.id!==id||state.mode!=='gemini'||!state.remote?.fixer?.id)throw new Error('Run has no persisted managed fixer identity');
const controller=new AbortController();process.on('SIGINT',()=>controller.abort(new Error('Recovery interrupted')));
const agent=new GeminiManagedAgent({timeoutMs:8*60*1000,maxContinuations:1,signal:controller.signal,onState:async remote=>{state.remote.fixer=remote;await writeFile(path.join(runDir,'run.json'),JSON.stringify(state,null,2));console.log(`recovery: ${remote.status}`);}});
try{
  const previous=await agent.request(`/interactions/${encodeURIComponent(state.remote.fixer.id)}`);
  if(['in_progress','queued','pending'].includes(previous.status))throw new Error('Hosted fixer is still active. Wait for its configured timeout or terminal status before recovery.');
  const interaction=previous.status==='completed'?previous:await agent.run({role:'fixer',previous:{id:previous.id,environment_id:previous.environment_id||state.remote.fixer.environment_id},sources:[],input:'Recover the already repaired site in /workspace/site. Do not install browsers or additional packages. Read index.html, styles.css, and app.js NOW and return ONLY plain JSON {"files":{"index.html":"full current contents","styles.css":"full current contents","app.js":"full current contents"},"summary":"changes already made","wcag":["criteria addressed"]}. The host will independently run all browser measurements on these returned files. Preserve all appointment IDs. Do not return paths or a patch.'});
  const result=parseAgentJson(interaction);validateFiles(result.files);
  for(const [file,source]of Object.entries(result.files))await writeFile(path.join(runDir,'after',file),source);
  await writeFile(path.join(artifactDir,'gemini-fixer.json'),JSON.stringify(interaction,null,2));
  state.repair={summary:result.summary,wcag:result.wcag};state.remote.fixer={role:'fixer',id:interaction.id,environment_id:interaction.environment_id,status:interaction.status,usage:interaction.usage};state.status='interrupted';delete state.error;
  await writeFile(path.join(runDir,'run.json'),JSON.stringify(state,null,2));
  await runPipeline({id,mode:'gemini',runDir,resumeCandidate:true,signal:controller.signal,onEvent:run=>{const event=run.events.at(-1);if(event&&event.at!==globalThis.lastRecoveryEvent){console.log(`${event.stage}: ${event.message}`);globalThis.lastRecoveryEvent=event.at;}}});
}catch(error){console.error(error.message);process.exitCode=1;}
