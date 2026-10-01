import { readFile, mkdir, copyFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

export function assertVerifiedRun(run) {
  if (run.status !== 'completed' || run.verification?.violationCount !== 0 || run.verification?.keyboard?.passed !== true || !Number.isFinite(run.verification?.lighthouseScore) || run.review?.approved !== true) {
    throw new Error('Refusing publication: run has not passed independent measured verification and review.');
  }
  if (run.verification.functionality?.passed !== true) throw new Error('Refusing publication: functional checks are missing or failed.');
  if (run.mode === 'gemini' && (!run.remote?.fixer?.environment_id || !run.remote?.reviewer?.environment_id || run.remote.fixer.environment_id === run.remote.reviewer.environment_id)) {
    throw new Error('Refusing publication: Gemini review did not use a distinct managed environment.');
  }
}

export async function prepareShowcase(runDir, targetDir) {
  const run = JSON.parse(await readFile(path.join(runDir, 'run.json'), 'utf8'));
  assertVerifiedRun(run);
  for (const file of ['index.html', 'styles.css', 'app.js']) {
    const actual = createHash('sha256').update(await readFile(path.join(runDir, 'after', file))).digest('hex');
    if (!run.sourceHashes?.[file] || run.sourceHashes[file] !== actual) throw new Error(`Refusing publication: ${file} differs from the verified source or lacks a verified hash.`);
  }
  for (const variant of ['before', 'after']) {
    await mkdir(path.join(targetDir, variant), { recursive: true });
    for (const file of ['index.html', 'styles.css', 'app.js']) await copyFile(path.join(runDir, variant, file), path.join(targetDir, variant, file));
  }
  await copyFile(path.join(runDir, 'artifacts', 'report.md'), path.join(targetDir, 'report.md'));
  const evidence = { id: run.id, mode: run.mode, baseline: run.baseline, verification: run.verification, review: run.review, remote: run.remote, sourceHashes: run.sourceHashes, apiCalls: run.apiCalls, humanTesting: run.humanTesting };
  await writeFile(path.join(targetDir, 'evidence.json'), JSON.stringify(evidence, null, 2));
  const score = run.verification.lighthouseScore;
  const repairMode = run.mode === 'gemini' ? 'Gemini Managed Agent, independently checked by a fresh browser and separate managed reviewer' : run.mode === 'gemini-api' ? 'Gemini API source repair, independently checked by a fresh browser and a separate Gemini API review conversation' : 'Deterministic local fixture repair with fresh browser verification';
  await writeFile(path.join(targetDir, 'index.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Accessible by Morning · Measured demo</title><style>body{font:18px/1.6 system-ui;max-width:900px;margin:4rem auto;padding:0 1.5rem;color:#14261f;background:#f6f8f5}a{color:#174ea6}a:focus-visible{outline:3px solid #174ea6;outline-offset:5px}.links{display:flex;gap:2rem;flex-wrap:wrap}h1{font-size:clamp(2rem,6vw,4rem);line-height:1.1}strong{font-size:1.4rem}</style></head><body><main><p>ACCESSIBLE BY MORNING</p><h1>A booking task.<br>A measured repair.</h1><p>A deliberately broken fictional clinic, repaired in the source code. Try the appointment task with your keyboard and screen reader.</p><p><strong>Lighthouse ${run.baseline.lighthouseScore} → ${score}</strong><br>Axe rules ${run.baseline.violationCount} → ${run.verification.violationCount}<br>Keyboard booking: blocked → passed</p><nav class="links" aria-label="Compare the appointment site"><a href="before/">Try before</a><a href="after/">Try after</a><a href="report.md">Read measured report</a><a href="evidence.json">Inspect raw evidence</a></nav><p>Repair mode: ${repairMode}.</p><p>Native date test data is seeded; the date picker gestures are not covered. The semantic transcript is a DOM inspection. Human disabled audit and real screen-reader testing have not been performed. These results do not certify WCAG compliance.</p><p>No real appointment or email is sent.</p><p><a href="https://github.com/waltmannz/accessible-by-morning-demo">View source and repair pull request</a></p></main></body></html>`);
  await writeFile(path.join(targetDir, '.nojekyll'), '');
  return run;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('Usage: node scripts/publication.js runs/<verified-run-id> [docs]');
  const run = await prepareShowcase(path.resolve(process.argv[2]), path.resolve(process.argv[3] || 'docs'));
  console.log(JSON.stringify({ id: run.id, mode: run.mode, publishedEvidence: 'prepared', target: process.argv[3] || 'docs' }));
}
