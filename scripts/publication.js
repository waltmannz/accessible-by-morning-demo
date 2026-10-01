import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {prepareEvidenceBundle,verifyBundle} from './evidence-bundle.js';
export {assertVerifiedRun} from './publication-gate.js';
export {prepareEvidenceBundle as prepareShowcase};

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(!process.argv[2])throw new Error('Usage: npm run publish:prepare -- runs/<verified-run-id> [docs] [--recheck runs/<browser-check>]');
  const recheckIndex=process.argv.indexOf('--recheck');
  const target=path.resolve(process.argv[3]?.startsWith('--')?'docs':process.argv[3]||'docs');
  const run=await prepareEvidenceBundle(path.resolve(process.argv[2]),target,{recheckDir:recheckIndex>=0?path.resolve(process.argv[recheckIndex+1]):undefined});
  const {manifest}=await verifyBundle(target);
  console.log(JSON.stringify({id:run.id,mode:run.mode,target,integrityVerified:true,bundleBytes:manifest.totalBytes,sourceFilesUnchanged:true}));
}
