import {readFile,writeFile,mkdir,copyFile,lstat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyBundle,digest,safeBundleRead,SOURCE_FILES,PROOF_FILES} from './evidence-bundle.js';

export async function replayEvidence({bundleDir=path.resolve('docs'),runsDir=path.resolve('runs')}={}){
  const{evidence}=await verifyBundle(bundleDir);
  if(!/^[a-zA-Z0-9-]{1,128}$/.test(evidence.id))throw new Error('Invalid recorded run identity.');
  const manifestHash=digest(await readFile(path.join(bundleDir,'manifest.json')));
  const id='recorded-'+evidence.id+'-'+manifestHash.slice(0,8),runDir=path.join(runsDir,id);
  const existing=await lstat(runDir).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  if(existing?.isSymbolicLink())throw new Error('Refusing a symlink replay destination.');
  if(existing){
    const prior=JSON.parse(await readFile(path.join(runDir,'run.json'),'utf8').catch(()=>{throw new Error('Refusing to overwrite an existing run directory.');}));
    if(prior.status==='completed'&&prior.replay?.manifestHash===manifestHash){for(const variant of ['before','after'])for(const file of SOURCE_FILES){const expected=variant==='before'?evidence.publication.beforeSourceHashes[file]:evidence.sourceHashes[file];if(digest(await safeBundleRead(runDir,`${variant}/${file}`))!==expected)throw new Error('Existing replay source changed; refusing overwrite.');}return{state:prior,created:false};}
    throw new Error('Refusing to overwrite an existing run.');
  }
  await mkdir(runsDir,{recursive:true});if((await lstat(runsDir)).isSymbolicLink())throw new Error('Refusing a symlink replay destination.');await mkdir(runDir);
  for(const variant of ['before','after']){await mkdir(path.join(runDir,variant));for(const file of SOURCE_FILES)await copyFile(path.join(bundleDir,variant,file),path.join(runDir,variant,file));}
  for(const variant of ['baseline','verification']){await mkdir(path.join(runDir,'artifacts',variant),{recursive:true});for(const file of PROOF_FILES)await copyFile(path.join(bundleDir,'evidence',variant,file),path.join(runDir,'artifacts',variant,file));}
  for(const file of ['report.md','review.json','changes.patch'])await copyFile(path.join(bundleDir,file),path.join(runDir,'artifacts',file));
  const{manifest}=await verifyBundle(bundleDir);
  if(evidence.publication?.freshRecheck){await copyFile(path.join(bundleDir,'recheck.json'),path.join(runDir,'artifacts','recheck.json'));for(const file of Object.keys(manifest.files).filter(f=>f.startsWith('evidence/rechecks/'))){const target=path.join(runDir,'artifacts',file.slice('evidence/'.length));await mkdir(path.dirname(target),{recursive:true});await copyFile(path.join(bundleDir,file),target);}}
  const importedAt=new Date().toISOString();
  const state={...evidence,id,status:'completed',stage:'complete',task:'Book an appointment using only the keyboard.',startedAt:evidence.startedAt||evidence.baseline.measuredAt,completedAt:evidence.completedAt||evidence.verification.measuredAt,replay:{kind:'recorded-evidence',sourceRunId:evidence.id,importedAt,manifestHash,noProviderCalls:true},events:[{at:importedAt,stage:'complete',message:'Loaded checksum-verified recorded AI evidence. No new Gemini calls or browser measurements were made by this import; original measurement dates are retained.'}],artifacts:{report:`/api/runs/${id}/report`,review:`/artifacts/${id}/review.json`,patch:`/artifacts/${id}/changes.patch`,beforePreview:`/preview/${id}/before/`,afterPreview:`/preview/${id}/after/`,beforeLighthouse:`/artifacts/${id}/baseline/lighthouse.html`,afterLighthouse:`/artifacts/${id}/verification/lighthouse.html`,beforeScreenshot:`/artifacts/${id}/baseline/screenshot.png`,afterScreenshot:`/artifacts/${id}/verification/screenshot.png`,...(evidence.publication?.freshRecheck?{recheck:`/artifacts/${id}/recheck.json`}:{})}};
  await writeFile(path.join(runDir,'run.json'),JSON.stringify(state,null,2));
  return{state,created:true};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const{state,created}=await replayEvidence({bundleDir:path.resolve(process.argv[2]||'docs')});
  console.log(JSON.stringify({id:state.id,created,recordedEvidence:true,noProviderCalls:true,message:'Start or restart npm start to load this recorded run into the dashboard.'}));
}
