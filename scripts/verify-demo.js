import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {auditSite} from '../backend/audit.js';
import {startStatic} from '../backend/static.js';
import {verifyBundle,SOURCE_FILES,digest} from './evidence-bundle.js';

const bundleDir=path.resolve('docs');await verifyBundle(bundleDir);
const id=`browser-recheck-${new Date().toISOString().replace(/[:.]/g,'-')}-${randomUUID().slice(0,8)}`,out=path.resolve('runs',id);await mkdir(out,{recursive:true});
const result={id,kind:'fresh-browser-recheck',startedAt:new Date().toISOString(),noProviderCalls:true,originalAiReviewReused:true,sourceHashes:{before:{},after:{}},limitations:'No new AI review or human screen-reader test. The original model reviewed the original recorded measurements.'};
for(const variant of ['before','after']){
  for(const file of SOURCE_FILES)result.sourceHashes[variant][file]=digest(await readFile(path.join(bundleDir,variant,file)));
  const server=await startStatic(path.join(bundleDir,variant));
  try{result[variant]=await auditSite({url:server.url,outputDir:path.join(out,variant)});}finally{await server.close();}
  for(const file of SOURCE_FILES)if(result.sourceHashes[variant][file]!==digest(await readFile(path.join(bundleDir,variant,file))))throw new Error('Source changed during recheck: '+variant+'/'+file);
}
const after=result.after;
result.passed=after.violationCount===0&&after.keyboard.passed&&after.functionality.passed&&after.lighthouseScore===100&&(after.schemaVersion<2||after.stateCoveragePassed===true);
result.completedAt=new Date().toISOString();await writeFile(path.join(out,'recheck.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify({id,output:out,passed:result.passed,noProviderCalls:true,before:{lighthouse:result.before.lighthouseScore,axe:result.before.violationCount},after:{lighthouse:after.lighthouseScore,axe:after.violationCount,keyboard:after.keyboard.passed,functionality:after.functionality.passed,states:after.states?.map(s=>({id:s.id,status:s.status,axe:s.violationCount}))}}));
if(!result.passed)process.exitCode=1;
