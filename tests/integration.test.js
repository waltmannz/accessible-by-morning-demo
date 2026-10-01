import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../backend/server.js';
import { assertVerifiedRun, prepareShowcase } from '../scripts/publication.js';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

test('readiness, API validation, fixture preview and persisted history survive a server restart', async () => {
  let server = await createServer({ port: 0 });
  const origin = () => `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(origin() + '/health')).status, 200);
  const history = await (await fetch(origin() + '/api/runs')).json();
  const bad = await fetch(origin() + '/api/runs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'invalid' }) });
  assert.equal(bad.status, 400);
  const fixture = await fetch(origin() + '/preview/fixture/');
  assert.equal(fixture.status, 200);
  assert.match(await fixture.text(), /Book an appointment/);
  await new Promise(resolve => server.close(resolve));
  server = await createServer({ port: 0 });
  try {
    const restored = await (await fetch(origin() + '/api/runs')).json();
    assert.deepEqual(restored.runs.map(r => r.id).sort(), history.runs.map(r => r.id).sort());
    for (const run of restored.runs.filter(r => r.status === 'completed')) {
      assert.equal((await fetch(origin() + `/api/runs/${run.id}/report`)).status, 200);
      assert.equal((await fetch(origin() + `/preview/${run.id}/after/`)).status, 200);
    }
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('publication refuses source changed after verification', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'accessible-publication-'));
  try {
    await mkdir(path.join(dir, 'after'));
    const sourceHashes = {};
    for (const file of ['index.html', 'styles.css', 'app.js']) {
      await writeFile(path.join(dir, 'after', file), 'verified source');
      sourceHashes[file] = createHash('sha256').update('verified source').digest('hex');
    }
    await writeFile(path.join(dir, 'run.json'), JSON.stringify({status:'completed',mode:'local',verification:{violationCount:0,keyboard:{passed:true},functionality:{passed:true},lighthouseScore:100},review:{approved:true},sourceHashes}));
    await writeFile(path.join(dir, 'after', 'app.js'), 'unverified replacement');
    await assert.rejects(prepareShowcase(dir, path.join(dir, 'output')), /differs from the verified source/);
  } finally { await rm(dir, {recursive:true,force:true}); }
});

test('publication refuses failed, unmeasured or same-environment managed repairs', () => {
  const good = { status: 'completed', mode: 'local', verification: { violationCount: 0, keyboard: { passed: true }, functionality: { passed: true }, lighthouseScore: 100 }, review: { approved: true } };
  assert.doesNotThrow(() => assertVerifiedRun(good));
  for (const bad of [
    { ...good, status: 'failed' },
    { ...good, verification: { ...good.verification, lighthouseScore: null } },
    { ...good, verification: { ...good.verification, keyboard: { passed: false } } },
    { ...good, verification: { ...good.verification, functionality: undefined } },
    { ...good, review: { approved: false } },
    { ...good, mode: 'gemini', remote: { fixer: { environment_id: 'same' }, reviewer: { environment_id: 'same' } } }
  ]) assert.throws(() => assertVerifiedRun(bad), /Refusing publication/);
});
