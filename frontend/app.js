const $ = id => document.getElementById(id);
let activeRun = null;
let pollTimer;
let currentVariant = 'before';
let eventCount = 0;
let geminiConfig = null;
let previewResizeObserver;
const stageOrder = ['baseline', 'fixing', 'verifying', 'report'];
const stageAliases = {setup: 'baseline', cloning: 'baseline', auditing: 'baseline', audit: 'baseline', baseline: 'baseline', plan: 'fixing', planning: 'fixing', repair: 'fixing', fix: 'fixing', retry: 'fixing', fixing: 'fixing', agent: 'fixing', verification: 'verifying', verify: 'verifying', verifying: 'verifying', review: 'verifying', reporting: 'report', packaging: 'report', report: 'report', complete: 'report', completed: 'report'};

function selectedMode() { return document.querySelector('input[name="mode"]:checked').value; }
function updateMode() {
  const managed = selectedMode() === 'gemini';
  $('run-engine').textContent = (activeRun ? activeRun.mode === 'gemini' : managed) ? 'GEMINI MANAGED AGENT' : 'LOCAL DEMONSTRATION';
  $('mode-note').textContent = managed ? (geminiConfig?.available === false ? geminiConfig.reason || 'Managed mode needs Google API credentials. Configure the server to enable a real cloud run.' : 'A real Google cloud agent repairs mounted fixture files, then a fresh agent reviews them. Requires a Gemini API key; a run can take several minutes.') : 'Local mode applies known repairs to a copy of the code. All audit results are measured from the browser.';
}
document.querySelectorAll('input[name="mode"]').forEach(input => input.addEventListener('change', updateMode));
$('preview').addEventListener('load', () => {
  previewResizeObserver?.disconnect();
  try {
    const frame = $('preview');
    const content = frame.contentDocument?.body;
    if (!content) return;
    const resize = () => { frame.style.height = `${Math.min(1800, Math.max(665, content.scrollHeight + 24))}px`; };
    previewResizeObserver = new ResizeObserver(resize);
    previewResizeObserver.observe(content);
    resize();
  } catch {}
});
fetch('/api/config').then(response => response.ok ? response.json() : null).then(config => { geminiConfig = config?.gemini || (config && {available: config.geminiConfigured, reason: 'Managed mode needs GEMINI_API_KEY in the server environment. Configure it to enable a real cloud run.'}); if (!activeRun && config?.defaultMode === 'gemini') document.querySelector('input[name="mode"][value="gemini"]').checked = true; if (config?.repository) { try { const repository = new URL(config.repository); $('repo').value = repository.pathname.replace(/^\//, '').replace(/\.git$/, ''); $('repo-link').href = repository.href; } catch {} } updateMode(); }).catch(() => {});

function setStatus(status) {
  const labels = {queued: 'QUEUED', running: 'RUNNING', completed: 'VERIFIED', complete: 'VERIFIED', succeeded: 'VERIFIED', failed: 'NEEDS ATTENTION', error: 'NEEDS ATTENTION', interrupted: 'INTERRUPTED', cancelled: 'CANCELLED'};
  $('run-status').textContent = labels[status] || status?.toUpperCase() || 'RUNNING';
  $('run-status').className = `status-pill ${['completed', 'complete', 'succeeded'].includes(status) ? 'completed' : ['failed', 'error', 'interrupted', 'cancelled'].includes(status) ? 'failed' : 'running'}`;
}
function renderPipeline(run) {
  const complete = ['completed', 'complete', 'succeeded'].includes(run.status);
  const latestStage = [...(run.events || [])].reverse().find(event => stageAliases[event.stage]);
  const stage = stageAliases[run.stage] || stageAliases[latestStage?.stage] || 'baseline';
  const index = stageOrder.indexOf(stage);
  document.querySelectorAll('#pipeline li').forEach((item, position) => {
    const done = complete || position < index;
    const active = !complete && position === index;
    item.classList.toggle('done', done);
    item.classList.toggle('active', active);
    item.querySelector('.step-icon').textContent = done ? '✓' : `0${position + 1}`;
    item.querySelector('.step-state').textContent = done ? 'Done' : active ? (['failed', 'error', 'interrupted', 'cancelled'].includes(run.status) ? 'Stopped' : 'In progress') : 'Waiting';
  });
}
function renderEvents(events = []) {
  if (events.length === eventCount) return;
  eventCount = events.length;
  $('event-count').textContent = `${events.length} event${events.length === 1 ? '' : 's'}`;
  $('activity').replaceChildren();
  events.forEach(event => {
    const row = document.createElement('p'); row.className = 'event';
    const time = document.createElement('time');
    const timestamp = event.at || event.timestamp;
    const date = timestamp ? new Date(timestamp) : null;
    time.textContent = date && Number.isFinite(date.getTime()) ? date.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit', second: '2-digit'}) : '··:··';
    const message = document.createElement('span'); message.className = 'event-message'; message.textContent = event.message || event.detail || event.stage || 'Run updated';
    row.append(time, message); $('activity').append(row);
  });
  $('activity').scrollTop = $('activity').scrollHeight;
}
function score(audit) { return audit?.lighthouseScore ?? audit?.lighthouse?.accessibilityScore ?? audit?.lighthouse?.score ?? null; }
function violations(audit) { return audit?.violationCount ?? audit?.axe?.violationCount ?? audit?.violations?.length ?? null; }
function keyboard(audit) { const value = audit?.keyboard?.passed ?? audit?.keyboard?.completed; return value === true ? 'Completed' : value === false ? 'Blocked' : '—'; }
function renderTranscript(audit) {
  const transcript = audit?.transcript || audit?.accessibleNames || audit?.screenReader?.transcript;
  if (!transcript) return 'Awaiting audit.';
  return Array.isArray(transcript) ? transcript.map(item => typeof item === 'string' ? item : `${item.role || item.tag || 'control'}: ${item.name || item.text || '(no accessible name)'}`).join('\n') : typeof transcript === 'string' ? transcript : JSON.stringify(transcript, null, 2);
}
function renderMetrics(run) {
  const before = run.baseline || run.before;
  const after = run.verification || run.after;
  $('score-before').textContent = score(before) ?? '—';
  $('score-after').textContent = score(after) ?? '—';
  $('axe-before').textContent = violations(before) ?? '—';
  $('axe-after').textContent = violations(after) ?? '—';
  $('keyboard-before').textContent = keyboard(before);
  $('keyboard-after').textContent = keyboard(after);
  $('score-description').textContent = after ? (score(after) == null ? 'Lighthouse unavailable · inspect the audit report' : 'Measured in Chromium · score out of 100') : 'Awaiting browser audit · score out of 100';
  $('axe-description').textContent = after ? `${after.affectedNodes ?? after.axe?.affectedNodes ?? 0} affected nodes after repair · automated check` : 'Awaiting audit · distinct failing rules';
  $('keyboard-description').textContent = after ? 'Scripted keyboard test · human testing pending' : 'Awaiting scripted keyboard walkthrough';
  $('transcript-before').textContent = renderTranscript(before);
  $('transcript-after').textContent = renderTranscript(after);
}
function artifactUrl(value) {
  const candidate = typeof value === 'string' ? value : value?.url || value?.href;
  if (!candidate) return null;
  try { const url = new URL(candidate, location.origin); return ['http:', 'https:'].includes(url.protocol) ? url.href : null; } catch { return null; }
}
function renderArtifacts(run) {
  const artifacts = run.artifacts || {};
  const mapping = {'report-link': [artifacts.report || artifacts.reportUrl, 'Read audit report'], 'diff-link': [artifacts.diff || artifacts.patch || artifacts.diffUrl || artifacts.pullRequest, 'Review source changes'], 'review-link': [artifacts.review || artifacts.verification || artifacts.reviewUrl, 'Inspect verification']};
  Object.entries(mapping).forEach(([id, [value, label]]) => {
    const url = artifactUrl(value); const link = $(id);
    if (url) { link.href = url; link.target = '_blank'; link.rel = 'noopener'; link.setAttribute('aria-disabled', 'false'); link.replaceChildren(document.createTextNode(`${label} ↗`)); }
    else { link.removeAttribute('href'); link.setAttribute('aria-disabled', 'true'); link.textContent = 'Available after a run ↗'; }
  });
}
function setPreview(variant) {
  currentVariant = variant;
  const url = activeRun?.id ? `/preview/${encodeURIComponent(activeRun.id)}/${variant}/` : '/preview/fixture/';
  $('preview').src = url;
  $('preview').title = `Harbour Health appointment booking preview, ${variant === 'before' ? 'before repair' : 'after repair'}`;
  $('open-preview').href = url;
  $('show-before').setAttribute('aria-pressed', String(variant === 'before'));
  $('show-after').setAttribute('aria-pressed', String(variant === 'after'));
  $('preview-address').textContent = `harbour-health.demo / ${variant === 'before' ? 'original-source' : 'repaired-source'}`;
  updatePreviewDescription();
}
function updatePreviewDescription() {
  const verified = ['completed', 'complete', 'succeeded'].includes(activeRun?.status);
  $('preview-description').textContent = currentVariant === 'before' ? '● BEFORE · Intentionally broken source' : verified ? '● AFTER · Source repaired and verified' : '● AFTER · Candidate source · verification has not passed';
}
$('show-before').addEventListener('click', () => setPreview('before'));
$('show-after').addEventListener('click', () => setPreview('after'));
function renderRun(run) {
  activeRun = run;
  updateMode();
  $('run-id').textContent = `Run ${run.id}`;
  setStatus(run.status); renderPipeline(run); renderEvents(run.events); renderMetrics(run); renderArtifacts(run);
  const hasAfter = Boolean(run.verification || run.after);
  $('show-after').disabled = !hasAfter;
  updatePreviewDescription();
  const terminal = ['completed', 'complete', 'succeeded', 'failed', 'error', 'interrupted', 'cancelled'].includes(run.status);
  $('start-run').disabled = !terminal;
  $('start-run').firstElementChild.textContent = terminal ? 'Start another repair run' : 'Repair run in progress';
  if (run.error) { $('run-error').hidden = false; $('run-error').textContent = typeof run.error === 'string' ? run.error : run.error.message || JSON.stringify(run.error); }
  if (terminal) { clearTimeout(pollTimer); document.querySelectorAll('input[name="mode"]').forEach(input => input.disabled = false); }
  return terminal;
}
async function pollRun(id) {
  try {
    const response = await fetch(`/api/runs/${encodeURIComponent(id)}`);
    if (!response.ok) throw new Error(`Could not load run (${response.status}).`);
    const run = await response.json();
    if (!renderRun(run)) pollTimer = setTimeout(() => pollRun(id), 1500);
  } catch (error) {
    $('run-error').hidden = false; $('run-error').textContent = `${error.message} Retrying shortly…`;
    pollTimer = setTimeout(() => pollRun(id), 3500);
  }
}
$('start-run').addEventListener('click', async () => {
  $('run-error').hidden = true;
  $('start-run').disabled = true;
  $('start-run').firstElementChild.textContent = 'Starting repair run…';
  document.querySelectorAll('input[name="mode"]').forEach(input => input.disabled = true);
  clearTimeout(pollTimer); eventCount = -1;
  try {
    const response = await fetch('/api/runs', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({mode: selectedMode(), task: 'Book an appointment using only the keyboard.'})});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || data.error || 'The repair run could not start.');
    const run = data.run || data;
    if (!run.id) throw new Error('Server did not return a run identifier.');
    renderRun({...run, status: run.status || 'queued'}); setPreview('before'); pollRun(run.id);
    try { localStorage.setItem('accessible-by-morning-run', run.id); } catch {}
  } catch (error) {
    $('run-error').hidden = false; $('run-error').textContent = error.message;
    $('start-run').disabled = false; $('start-run').firstElementChild.textContent = 'Start repair run';
    document.querySelectorAll('input[name="mode"]').forEach(input => input.disabled = false);
  }
});
try { const saved = localStorage.getItem('accessible-by-morning-run'); if (saved) fetch(`/api/runs/${encodeURIComponent(saved)}`).then(response => response.ok ? response.json() : null).then(run => { if (!run) return; renderRun(run); setPreview('before'); if (!['completed', 'complete', 'succeeded', 'failed', 'error', 'interrupted', 'cancelled'].includes(run.status)) pollRun(run.id); }).catch(() => {}); } catch {}
