import {readFile,mkdir,writeFile,lstat} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {assertVerifiedRun} from './publication-gate.js';
import {renderShowcase,renderReport} from '../frontend/public-showcase.js';

export const SOURCE_FILES=['index.html','styles.css','app.js'];
export const PROOF_FILES=['audit.json','axe.json','keyboard.json','functionality.json','semantic-transcript.txt','lighthouse.json','lighthouse.html','screenshot.png'];
export const MAX_BUNDLE_BYTES=6*1024*1024;
export const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function safeBundleRead(bundleDir,file){
  let current=path.resolve(bundleDir);
  if((await lstat(current)).isSymbolicLink())throw new Error('Evidence bundle symlinks are not allowed.');
  for(const part of file.split('/')){if(!part||part==='.'||part==='..')throw new Error('Invalid evidence path.');current=path.join(current,part);if((await lstat(current)).isSymbolicLink())throw new Error('Evidence bundle symlinks are not allowed.');}
  if((await lstat(current)).size>MAX_BUNDLE_BYTES)throw new Error('Evidence file exceeds bundle budget.');
  return readFile(current);
}

export async function readVerifiedRun(runDir){
  const run=JSON.parse(await readFile(path.join(runDir,'run.json'),'utf8'));assertVerifiedRun(run);
  const beforeSourceHashes={},afterSourceHashes={};
  for(const file of SOURCE_FILES){
    afterSourceHashes[file]=digest(await readFile(path.join(runDir,'after',file)));
    if(run.sourceHashes?.[file]!==afterSourceHashes[file])throw new Error(`Refusing publication: ${file} differs from the verified source or lacks a verified hash.`);
  }
  for(const file of SOURCE_FILES){
    beforeSourceHashes[file]=digest(await readFile(path.join(runDir,'before',file)));
    if(run.beforeSourceHashes?.[file]&&run.beforeSourceHashes[file]!==beforeSourceHashes[file])throw new Error('Measured baseline source changed: '+file);
  }
  return{run,beforeSourceHashes,afterSourceHashes};
}

export async function prepareEvidenceBundle(runDir,targetDir,{repoUrl='https://github.com/waltmannz/accessible-by-morning-demo',prUrl='https://github.com/waltmannz/accessible-by-morning-demo/pull/2',recheckDir}={}){
  const{run,beforeSourceHashes,afterSourceHashes}=await readVerifiedRun(runDir);
  const assets=new Map();let totalBytes=0;
  const add=(relative,data)=>{const bytes=Buffer.isBuffer(data)?data:Buffer.from(data);if(!assets.has(relative))totalBytes+=bytes.length;if(totalBytes>MAX_BUNDLE_BYTES)throw new Error('Evidence bundle exceeds its 6 MiB budget.');assets.set(relative,bytes);};
  const copy=async(from,to)=>add(to,await readFile(from));
  // Strict allowlist: no raw model responses, chain-of-thought, environment files or credentials.
  for(const variant of ['before','after'])for(const file of SOURCE_FILES)await copy(path.join(runDir,variant,file),`${variant}/${file}`);
  for(const variant of ['baseline','verification'])for(const file of PROOF_FILES)await copy(path.join(runDir,'artifacts',variant,file),`evidence/${variant}/${file}`);
  for(const file of ['report.md','review.json','changes.patch'])await copy(path.join(runDir,'artifacts',file),file);
  const auditScope=run.verification.schemaVersion>=2?'Axe measured the required interaction states, plus keyboard, validation and reflow checks.':'Original recorded axe and Lighthouse measured the initial page. Separate scripted checks exercised keyboard booking, validation, reset and reflow; axe did not run in every interaction state.';
  const publication={kind:'recorded-verified-run',auditScope,beforeSourceHashes,afterSourceHashes,repoUrl,prUrl};
  if(recheckDir){
    const recheck=JSON.parse(await readFile(path.join(recheckDir,'recheck.json'),'utf8'));
    for(const variant of ['before','after'])for(const file of SOURCE_FILES)if(recheck.sourceHashes?.[variant]?.[file]!== (variant==='before'?beforeSourceHashes:afterSourceHashes)[file])throw new Error('Fresh recheck covers different source.');
    add('recheck.json',JSON.stringify(recheck,null,2));
    for(const variant of ['before','after']){
      for(const file of PROOF_FILES)await copy(path.join(recheckDir,variant,file),`evidence/rechecks/${variant}/${file}`);
      for(const state of recheck[variant]?.states||[])for(const artifact of Object.values(state.artifacts||{})){
        if(typeof artifact!=='string'||!/^states\/[a-z0-9-]+\/(axe\.json|screenshot\.png|semantic-transcript\.txt)$/.test(artifact))continue;
        await copy(path.join(recheckDir,variant,artifact),`evidence/rechecks/${variant}/${artifact}`);
      }
    }
    publication.freshRecheck={path:'recheck.json',before:recheck.before,after:recheck.after,measuredAt:recheck.completedAt,note:'Fresh browser measurements only; no new Gemini call or human audit. Original Gemini review covered the original recorded measurements.'};
  }
  const evidence={id:run.id,mode:run.mode,startedAt:run.startedAt,completedAt:run.completedAt,repair:run.repair,baseline:run.baseline,verification:run.verification,review:run.review,remote:run.remote,sourceHashes:run.sourceHashes,apiCalls:run.apiCalls,humanTesting:run.humanTesting,publication};
  add('evidence.json',JSON.stringify(evidence,null,2));const renderRun={...run,publication};
  add('index.html',renderShowcase({run:renderRun,repoUrl,prUrl}));add('report.html',renderReport({run:renderRun,repoUrl,prUrl}));add('.nojekyll','');
  // Validate/read every artifact before any target file changes.
  const files={};for(const[file,bytes]of assets){await mkdir(path.dirname(path.join(targetDir,file)),{recursive:true});await writeFile(path.join(targetDir,file),bytes);files[file]={sha256:digest(bytes),bytes:bytes.length};}
  await writeFile(path.join(targetDir,'manifest.json'),JSON.stringify({schemaVersion:1,runId:run.id,kind:'recorded-verified-run',auditScope,beforeSourceHashes,afterSourceHashes,files,totalBytes},null,2));
  return run;
}

const allowed=/^(?:before|after)\/(?:index\.html|styles\.css|app\.js)$|^evidence\/(?:baseline|verification)\/(?:audit\.json|axe\.json|keyboard\.json|functionality\.json|semantic-transcript\.txt|lighthouse\.json|lighthouse\.html|screenshot\.png)$|^evidence\/rechecks\/(?:before|after)\/(?:audit\.json|axe\.json|keyboard\.json|functionality\.json|semantic-transcript\.txt|lighthouse\.json|lighthouse\.html|screenshot\.png|states\/[a-z0-9-]+\/(?:axe\.json|screenshot\.png|semantic-transcript\.txt))$|^(?:index\.html|report\.html|report\.md|review\.json|changes\.patch|evidence\.json|recheck\.json|\.nojekyll)$/;
export async function verifyBundle(bundleDir){
  const manifest=JSON.parse((await safeBundleRead(bundleDir,'manifest.json')).toString('utf8'));
  if(manifest.schemaVersion!==1||!manifest.files||manifest.totalBytes>MAX_BUNDLE_BYTES)throw new Error('Invalid evidence bundle manifest.');
  const required=['evidence.json','index.html','report.html','report.md','review.json','changes.patch','.nojekyll',...['before','after'].flatMap(v=>SOURCE_FILES.map(f=>`${v}/${f}`)),...['baseline','verification'].flatMap(v=>PROOF_FILES.map(f=>`evidence/${v}/${f}`))];
  for(const file of required)if(!manifest.files[file])throw new Error('Evidence manifest omits required file: '+file);
  let actualTotal=0;
  for(const[file,record]of Object.entries(manifest.files)){
    if(!allowed.test(file))throw new Error('Unexpected file in evidence bundle: '+file);
    const bytes=await safeBundleRead(bundleDir,file);actualTotal+=bytes.length;
    if(bytes.length!==record.bytes||digest(bytes)!==record.sha256)throw new Error('Evidence bundle integrity mismatch: '+file);
  }
  if(actualTotal!==manifest.totalBytes||actualTotal>MAX_BUNDLE_BYTES)throw new Error('Evidence bundle byte budget mismatch.');
  const evidence=JSON.parse((await safeBundleRead(bundleDir,'evidence.json')).toString('utf8'));assertVerifiedRun({...evidence,status:'completed'});
  if(evidence.id!==manifest.runId)throw new Error('Evidence run identity mismatch.');
  for(const variant of ['before','after'])for(const file of SOURCE_FILES){const key=`${variant}/${file}`,expected=variant==='before'?manifest.beforeSourceHashes?.[file]:manifest.afterSourceHashes?.[file],summary=variant==='before'?evidence.publication?.beforeSourceHashes?.[file]:evidence.publication?.afterSourceHashes?.[file];if(!expected||manifest.files[key]?.sha256!==expected||summary!==expected||(variant==='after'&&evidence.sourceHashes?.[file]!==expected))throw new Error('Evidence source hash mismatch: '+key);}
  return{evidence,manifest};
}
