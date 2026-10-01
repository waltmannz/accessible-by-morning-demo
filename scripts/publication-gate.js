export function assertVerifiedRun(run){
  if(!['local','gemini','gemini-api'].includes(run.mode)||run.status!=='completed'||run.verification?.violationCount!==0||run.verification?.keyboard?.passed!==true||run.verification?.lighthouseScore!==100||run.review?.approved!==true)throw new Error('Refusing publication: run has not passed independent measured verification and review.');
  if(run.verification.functionality?.passed!==true)throw new Error('Refusing publication: functional checks are missing or failed.');
  if(run.verification.schemaVersion>=2&&!run.verification.stateCoveragePassed)throw new Error('Refusing publication: required browser states were not measured.');
  if(run.mode==='gemini'&&(!run.remote?.fixer?.environment_id||!run.remote?.reviewer?.environment_id||run.remote.fixer.environment_id===run.remote.reviewer.environment_id))throw new Error('Refusing publication: Gemini review did not use a distinct managed environment.');
}
