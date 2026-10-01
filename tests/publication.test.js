import test from 'node:test';
import assert from 'node:assert/strict';
import {cp,mkdtemp,readFile,writeFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {verifyBundle,digest,MAX_BUNDLE_BYTES} from '../scripts/evidence-bundle.js';
import {replayEvidence} from '../scripts/replay.js';

async function temporaryBundle(fn){const dir=await mkdtemp(path.join(tmpdir(),'accessible-evidence-'));try{const bundle=path.join(dir,'docs');await cp(path.resolve('docs'),bundle,{recursive:true});await fn({dir,bundle});}finally{await rm(dir,{recursive:true,force:true});}}

test('published bundle binds both source versions and only allowed proof within its budget',async()=>{
  const{evidence,manifest}=await verifyBundle(path.resolve('docs'));
  assert.ok(manifest.totalBytes<=MAX_BUNDLE_BYTES);
  assert.equal(evidence.id,manifest.runId);
  for(const variant of ['before','after'])for(const file of ['index.html','styles.css','app.js'])assert.equal(manifest.files[`${variant}/${file}`].sha256,digest(await readFile(path.join('docs',variant,file))));
  assert.equal(Object.keys(manifest.files).some(f=>f.includes('gemini-api-fixer')||f.includes('.env')),false);
});

test('bundle rejects modified baseline, summary and manifest traversal paths before replay',async()=>temporaryBundle(async({bundle})=>{
  const before=path.join(bundle,'before','index.html'),original=await readFile(before);
  await writeFile(before,'tampered baseline');await assert.rejects(verifyBundle(bundle),/integrity mismatch/);await writeFile(before,original);
  const manifestFile=path.join(bundle,'manifest.json'),originalManifest=await readFile(manifestFile),manifest=JSON.parse(originalManifest);
  manifest.files['../../outside.json']={sha256:'bad',bytes:0};await writeFile(manifestFile,JSON.stringify(manifest));await assert.rejects(verifyBundle(bundle),/Unexpected file/);
  await writeFile(manifestFile,originalManifest);await writeFile(path.join(bundle,'evidence.json'),'{}');await assert.rejects(verifyBundle(bundle),/integrity mismatch/);
}));

test('clean replay retains original measurement dates, supplies every proof link and is idempotent',async()=>temporaryBundle(async({dir,bundle})=>{
  const runsDir=path.join(dir,'runs'),{evidence}=await verifyBundle(bundle);
  const first=await replayEvidence({bundleDir:bundle,runsDir});assert.equal(first.created,true);assert.equal(first.state.replay.noProviderCalls,true);assert.equal(first.state.baseline.measuredAt,evidence.baseline.measuredAt);assert.equal(first.state.verification.measuredAt,evidence.verification.measuredAt);
  assert.deepEqual(first.state.sourceHashes,evidence.sourceHashes);await readFile(path.join(runsDir,first.state.id,'artifacts','review.json'));
  if(evidence.publication.freshRecheck)await readFile(path.join(runsDir,first.state.id,'artifacts','recheck.json'));
  const second=await replayEvidence({bundleDir:bundle,runsDir});assert.equal(second.created,false);assert.equal(second.state.replay.importedAt,first.state.replay.importedAt);
  await writeFile(path.join(runsDir,first.state.id,'after','app.js'),'operator edit');await assert.rejects(replayEvidence({bundleDir:bundle,runsDir}),/Existing replay source changed/);
}));

test('replay refuses to overwrite a working run directory',async()=>temporaryBundle(async({dir,bundle})=>{
  const runsDir=path.join(dir,'runs'),first=await replayEvidence({bundleDir:bundle,runsDir});
  const file=path.join(runsDir,first.state.id,'run.json');await writeFile(file,JSON.stringify({...first.state,status:'running'}));
  await assert.rejects(replayEvidence({bundleDir:bundle,runsDir}),/Refusing to overwrite/);
  assert.equal(JSON.parse(await readFile(file,'utf8')).status,'running');
}));
