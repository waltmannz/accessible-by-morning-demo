const $ = id => document.getElementById(id);
let activeRun = null;
let pollTimer;
let currentVariant = 'before';
let eventCount = 0;
let geminiConfig = null;
let geminiApiConfigured = null;
let geminiApiModel = '';
let previewResizeObserver;
let blockedManagedRuns = [];
let cancellationRequestedFor = null;
let knownRuns = [];
let historySignature = '';
let selectionEpoch = 0;
let newEngineChanged = false;
const terminalStatuses = ['completed', 'complete', 'succeeded', 'failed', 'error', 'interrupted', 'cancelled'];
const isTerminal = run => terminalStatuses.includes(run?.status);
const remoteUnresolved = run => run?.mode === 'gemini' && Object.values(run.remote || {}).some(remote => ['in_progress', 'queued', 'pending'].includes(remote.status));
const stageOrder = ['baseline', 'fixing', 'verifying', 'report'];
const stageAliases = {setup: 'baseline', cloning: 'baseline', auditing: 'baseline', audit: 'baseline', baseline: 'baseline', plan: 'fixing', planning: 'fixing', repair: 'fixing', fix: 'fixing', retry: 'fixing', fixing: 'fixing', agent: 'fixing', verification: 'verifying', verify: 'verifying', verifying: 'verifying', review: 'verifying', reporting: 'report', packaging: 'report', report: 'report', complete: 'report', completed: 'report'};

function selectedMode() { return document.querySelector('input[name="mode"]:checked').value; }
function engineLabel(mode) { return mode === 'gemini' ? 'GEMINI MANAGED AGENT' : mode === 'gemini-api' ? 'GEMINI API · SOURCE REPAIR + REVIEW' : 'LOCAL DEMONSTRATION'; }
function updateMode() {
  const mode = selectedMode();
  $('run-engine').textContent = engineLabel(activeRun?.mode || mode);
  $('mode-note').textContent = mode === 'gemini' ? (geminiConfig?.available === false ? geminiConfig.reason || 'Managed mode needs Google API credentials. Configure the server to enable a real cloud run.' : 'A real Google cloud agent repairs mounted fixture files, then a fresh agent reviews them. Requires a Gemini API key; a run can take several minutes.') : mode === 'gemini-api' ? (geminiApiConfigured === false ? 'Gemini API mode needs GEMINI_API_KEY in the server environment.' : `Direct Gemini model calls repair and independently review the code. A fresh local browser verifies the result.${geminiApiModel ? ` Model: ${geminiApiModel}.` : ''}`) : 'Local mode applies known repairs to a copy of the code. All audit results are measured from the browser.';
  updateStartAvailability();
}
document.querySelectorAll('input[name="mode"]').forEach(input => input.addEventListener('change', () => { newEngineChanged = true; updateMode(); }));
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
async function refreshConfig(initial = false) {
  try {
    const response = await fetch('/api/config');
    if (!response.ok) return;
    const config = await response.json();
    geminiConfig = config.gemini || {available: config.geminiConfigured, reason: 'Managed mode needs GEMINI_API_KEY in the server environment. Configure it to enable a real cloud run.'};
    geminiApiConfigured = config.geminiApiConfigured ?? config.geminiConfigured;
    geminiApiModel = config.apiModel || '';
    blockedManagedRuns = config.blockedManagedRuns || [];
    if (initial && !newEngineChanged && ['local', 'gemini', 'gemini-api'].includes(config.defaultMode)) document.querySelector(`input[name="mode"][value="${config.defaultMode}"]`).checked = true;
    if (config.repository) { try { const repository = new URL(config.repository); if (['http:', 'https:'].includes(repository.protocol)) { $('repo').value = repository.pathname.replace(/^\//, '').replace(/\.git$/, ''); $('repo-link').href = repository.href; } } catch {} }
    renderRemoteStatus(); updateMode();
  } catch {}
}
refreshConfig(true);
function updateStartAvailability() {
  const active = (activeRun && !isTerminal(activeRun)) || knownRuns.some(run => !isTerminal(run));
  const blocked = selectedMode() === 'gemini' && blockedManagedRuns.length > 0;
  $('start-run').disabled = Boolean(active || blocked);
  $('start-run').firstElementChild.textContent = active ? 'A repair run is in progress' : blocked ? 'Resolve hosted status first' : activeRun ? 'Start a new repair run' : 'Start repair run';
}
function historyDate(run) { const date = new Date(run.completedAt || run.verification?.measuredAt || run.startedAt); return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('en-NZ', {day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'Pacific/Auckland'}).format(date) : 'Date unavailable'; }
function isVerified(run) { return run.status === 'completed' && run.review?.approved === true && run.verification?.violationCount === 0 && run.verification?.keyboard?.passed === true; }
function refreshHistoryOptions() {
  const signature = JSON.stringify(knownRuns.map(run => [run.id,run.mode,run.status]));
  if (signature !== historySignature) {
    historySignature = signature;
    $('run-history').replaceChildren();
    if (!knownRuns.length) { const option = document.createElement('option'); option.value=''; option.textContent='No recorded runs yet'; $('run-history').append(option); }
    knownRuns.forEach(run => { const option = document.createElement('option'); option.value=run.id; option.textContent=`${run.replay ? 'Recorded ' : ''}${run.mode === 'gemini-api' ? 'Gemini API' : run.mode === 'gemini' ? 'Managed Agent' : 'Local'} · ${isVerified(run) ? 'Verified' : run.status} · ${historyDate(run)} · ${run.id.slice(-8)}`; $('run-history').append(option); });
  }
  if (activeRun && knownRuns.some(run => run.id === activeRun.id)) $('run-history').value = activeRun.id;
}
function rememberRun(run) { const index=knownRuns.findIndex(item=>item.id===run.id); if(index<0) knownRuns.unshift(run); else knownRuns[index]=run; refreshHistoryOptions(); }
async function selectRecordedRun(id, {persist = true} = {}) {
  const epoch=++selectionEpoch; clearTimeout(pollTimer);
  $('history-note').textContent='Loading the recorded evidence…';
  try {
    const response=await fetch(`/api/runs/${encodeURIComponent(id)}`);
    if(!response.ok) throw new Error('This recorded run is unavailable. Refresh the run list to choose another.');
    const run=await response.json(); if(epoch!==selectionEpoch)return;
    renderRun(run); setPreview(isVerified(run)?'after':'before');
    if(persist)try{localStorage.setItem('accessible-by-morning-run',run.id);}catch{}
    if(!isTerminal(run))pollRun(run.id);
  }catch(error){if(epoch===selectionEpoch)$('history-note').textContent=error.message;}
}
async function loadHistory(initial=false) {
  $('refresh-history').disabled=true;
  try {
    const response=await fetch('/api/runs'); if(!response.ok)throw new Error('Recorded runs are unavailable. You can still configure a new run.');
    const data=await response.json(); knownRuns=data.runs||[]; refreshHistoryOptions();
    if(initial){
      let requested=new URLSearchParams(location.search).get('run');
      if(!requested)try{requested=localStorage.getItem('accessible-by-morning-run');}catch{}
      const saved=knownRuns.find(run=>run.id===requested);
      const preferred=saved||knownRuns.find(run=>isVerified(run)&&['gemini','gemini-api'].includes(run.mode))||knownRuns.find(isVerified)||knownRuns[0];
      if(preferred)await selectRecordedRun(preferred.id,{persist:false});
      else $('history-note').textContent='No results recorded yet. Viewing this page does not start an agent.';
    }else if(activeRun){const latest=knownRuns.find(run=>run.id===activeRun.id);if(latest)renderRun(latest);}
    updateStartAvailability();
  }catch(error){$('history-note').textContent=error.message;}
  finally{$('refresh-history').disabled=false;}
}
$('run-history').addEventListener('change',()=>{if($('run-history').value)selectRecordedRun($('run-history').value);});
$('refresh-history').addEventListener('click',()=>{loadHistory();refreshConfig();});
loadHistory(true);
function renderRemoteStatus() {
  $('remote-status-panel').hidden = !blockedManagedRuns.length;
  $('remote-run-list').replaceChildren();
  const stopped = blockedManagedRuns.some(isTerminal);
  $('remote-status-title').textContent = stopped ? 'Local work stopped. Cloud status is unresolved.' : 'Cloud work is reported active.';
  $('remote-status-description').textContent = stopped ? 'Stopping the local loop does not confirm that Google stopped the hosted interaction. Check its cloud status below. New managed runs remain blocked until the hosted work reaches a terminal state.' : 'A hosted interaction is still reported active. A second managed run cannot start while it is unresolved. Check its status or open the run to stop its local loop.';
  blockedManagedRuns.forEach(run => {
    const row = document.createElement('div'); row.className = 'remote-run';
    const text = document.createElement('div');
    const id = document.createElement('strong'); id.textContent = run.id;
    const detail = document.createElement('p'); detail.textContent = Object.entries(run.remote || {}).map(([role, remote]) => `${role}: ${remote.status}${remote.cancellationStatus ? ` · cancellation ${remote.cancellationStatus}` : ''}`).join('; ');
    text.append(id, detail);
    const buttons = document.createElement('div'); buttons.className = 'remote-run-buttons';
    const view = document.createElement('button'); view.type = 'button'; view.className = 'secondary-button'; view.textContent = 'View run';
    view.addEventListener('click', async () => { view.disabled = true; try { const response = await fetch(`/api/runs/${encodeURIComponent(run.id)}`); const state = await response.json(); if (!response.ok) throw new Error(state.error || 'Could not load this run.'); renderRun(state); setPreview('before'); try { localStorage.setItem('accessible-by-morning-run', state.id); } catch {} if (!isTerminal(state)) { clearTimeout(pollTimer); pollRun(state.id); } $('run-status').scrollIntoView({block: 'center', behavior: 'smooth'}); } catch (error) { $('run-error').hidden = false; $('run-error').textContent = error.message; } finally { view.disabled = false; } });
    const reconcile = document.createElement('button'); reconcile.type = 'button'; reconcile.className = 'secondary-button'; reconcile.textContent = 'Check cloud status';
    reconcile.addEventListener('click', async () => { reconcile.disabled = true; reconcile.textContent = 'Checking…'; try { const response = await fetch(`/api/runs/${encodeURIComponent(run.id)}/reconcile`, {method: 'POST',headers:{'Content-Type':'application/json'},body:'{}'}); const state = await response.json(); if (!response.ok) throw new Error(state.error || 'Could not check cloud status.'); if (activeRun?.id === run.id) renderRun(state); await refreshConfig(); $('run-action-note').hidden = false; $('run-action-note').textContent = remoteUnresolved(state) ? 'Cloud work is still active. Cancellation has not been confirmed.' : 'Cloud status reached a terminal state. This status check did not create a new agent run.'; } catch (error) { $('run-error').hidden = false; $('run-error').textContent = error.message; reconcile.disabled = false; reconcile.textContent = 'Check cloud status'; } });
    buttons.append(view, reconcile); row.append(text, buttons); $('remote-run-list').append(row);
  });
}

function setStatus(status) {
  const labels = {queued: 'QUEUED', running: 'RUNNING', cancelling: 'STOP REQUESTED', unresolved: 'REMOTE UNRESOLVED', completed: 'VERIFIED', complete: 'VERIFIED', succeeded: 'VERIFIED', failed: 'NEEDS ATTENTION', error: 'NEEDS ATTENTION', interrupted: 'INTERRUPTED', cancelled: 'LOCAL LOOP STOPPED'};
  $('run-status').textContent = labels[status] || status?.toUpperCase() || 'RUNNING';
  $('run-status').className = `status-pill ${['completed', 'complete', 'succeeded'].includes(status) ? 'completed' : ['failed', 'error', 'interrupted', 'cancelled', 'unresolved'].includes(status) ? 'failed' : 'running'}`;
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
  const readable = run.baseline ? `/report.html?run=${encodeURIComponent(run.id)}` : null;
  const mapping = {'report-link': [readable, 'Read evidence report'], 'diff-link': [artifacts.diff || artifacts.patch || artifacts.diffUrl || artifacts.pullRequest, 'Review source changes'], 'review-link': [readable && readable + '#provenance', 'Read source review & checks']};
  Object.entries(mapping).forEach(([id, [value, label]]) => {
    const url = artifactUrl(value); const link = $(id);
    if (url) { link.href = url; link.target = '_blank'; link.rel = 'noopener'; link.setAttribute('aria-disabled', 'false'); link.replaceChildren(document.createTextNode(`${label} ↗`)); }
    else { link.removeAttribute('href'); link.setAttribute('aria-disabled', 'true'); link.textContent = 'Available after a run ↗'; }
  });
}
function renderProvenance(run) {
  $('run-provenance').hidden = !run.baseline;
  if (!run.baseline) return;
  $('evidence-kind').textContent = run.replay ? 'RECORDED EVIDENCE' : isTerminal(run) ? 'RECORDED RESULT' : 'CURRENT RUN';
  const calls=run.apiCalls||[], fixer=calls.find(call=>call.role==='fixer');
  $('fixer-provenance').textContent = run.mode==='local' ? 'Deterministic fixture repairs. No AI provider ran for this result.' : run.mode==='gemini-api' ? `Direct Gemini API${fixer?.model ? ` · ${fixer.model}` : ''}. The model returned changed source files.` : 'A hosted Gemini Managed Agent changed the source. Hosted interaction IDs are recorded in the raw evidence.';
  const audit=run.verification;
  const states=Array.isArray(audit?.states)?audit.states:Object.values(audit?.states||{});
  const coverage=audit?.schemaVersion>=2 ? `${states.filter(state=>state.status==='measured').length} interaction states measured.` : 'Historical rule scan: initial booking page only. Keyboard, validation, and reflow checks are recorded separately.';
  $('browser-provenance').textContent = `${audit ? 'Fresh Chromium verification. ' : 'Verification is pending. '}${coverage}`;
  const review=run.review||{};
  $('review-provenance').textContent = `${review.approved===true?'Approved':review.approved===false?'Not approved':'No verdict recorded'}${review.model?` · ${review.model}`:''}. ${run.mode==='gemini-api'?'Separate source-review request with no fixer conversation.':run.mode==='gemini'?'Separate hosted reviewer environment.':'Local browser verification; no model or human reviewer.'}`;
  $('review-verdict').textContent=review.summary||'No independent review summary has been recorded.';
  $('review-findings').replaceChildren();
  (review.findings||[]).forEach(finding=>{const item=document.createElement('li');item.textContent=finding;$('review-findings').append(item);});
  const usage=run.metrics||{recordedCalls:calls.length,totalTokens:calls.reduce((sum,call)=>sum+(Number.isFinite(call.usage?.totalTokenCount)?call.usage.totalTokenCount:0),0),unknownUsageCalls:calls.filter(call=>!Number.isFinite(call.usage?.totalTokenCount)).length};
  $('usage-provenance').textContent = `${run.replay?'Loaded from recorded evidence. No provider call was made to load this result. ':''}${usage.recordedCalls?`${usage.recordedCalls} recorded model calls · ${usage.totalTokens.toLocaleString()} recorded tokens${usage.unknownUsageCalls?` · Usage missing for ${usage.unknownUsageCalls} calls; token total is incomplete.`:'.'}`:'No model usage is recorded for this result.'}`;
  $('readable-report-link').href=`/report.html?run=${encodeURIComponent(run.id)}`;
}
function setPreview(variant) {
  currentVariant = variant;
  const url = activeRun?.id ? `/preview/${encodeURIComponent(activeRun.id)}/${variant}/` : '/preview/fixture/';
  $('preview').loading = 'eager';
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
  if (run.id !== activeRun?.id) {
    eventCount = -1;
    $('run-action-note').hidden = true;
  }
  activeRun = run;
  rememberRun(run);
  if (run.mode === 'gemini') {
    blockedManagedRuns = blockedManagedRuns.filter(item => item.id !== run.id);
    if (remoteUnresolved(run)) blockedManagedRuns.push({id: run.id, mode: run.mode, status: run.status, remote: run.remote});
    renderRemoteStatus();
  }
  updateMode();
  $('run-id').textContent = `Run ${run.id}`;
  const unresolved = isTerminal(run) && remoteUnresolved(run);
  const stopping = cancellationRequestedFor === run.id && !isTerminal(run);
  setStatus(unresolved ? 'unresolved' : stopping ? 'cancelling' : run.status); renderPipeline(run); renderEvents(run.events); renderMetrics(run); renderArtifacts(run); renderProvenance(run);
  $('history-note').textContent=`${run.replay?'Recorded AI evidence loaded from the published bundle. ':''}Viewing ${engineLabel(run.mode).toLowerCase()} · ${run.status} · ${historyDate(run)} NZ time. Choosing an engine for a new run does not change this record.`;
  $('run-permalink').hidden=false;$('run-permalink').href=`/?run=${encodeURIComponent(run.id)}`;
  const hasAfter = Boolean(run.verification || run.after);
  $('show-after').disabled = !hasAfter;
  $('try-before').href=`/preview/${encodeURIComponent(run.id)}/before/`;
  $('try-after').setAttribute('aria-disabled',String(!hasAfter));
  $('try-after').textContent=isVerified(run)?'Open repaired site ↗':'Open candidate source ↗';
  if(hasAfter){$('try-after').href=`/preview/${encodeURIComponent(run.id)}/after/`;$('try-after').target='_blank';$('try-after').rel='noopener';}else $('try-after').removeAttribute('href');
  updatePreviewDescription();
  const terminal = isTerminal(run);
  updateStartAvailability();
  $('stop-run').hidden = terminal;
  $('stop-run').disabled = stopping;
  $('stop-run').textContent = stopping ? 'Stop requested…' : 'Stop this run';
  $('run-error').hidden = !run.error;
  if (run.error) $('run-error').textContent = typeof run.error === 'string' ? run.error : run.error.message || JSON.stringify(run.error);
  if (unresolved) { $('run-action-note').hidden = false; $('run-action-note').textContent = 'The local loop stopped, but hosted work remains active. Cancellation is unconfirmed. Use Check cloud status above.'; }
  else if (terminal && cancellationRequestedFor === run.id) { $('run-action-note').hidden = false; $('run-action-note').textContent = run.mode === 'gemini' ? `The local loop stopped. Recorded cloud status: ${Object.entries(run.remote || {}).map(([role, remote]) => `${role}: ${remote.status}`).join('; ') || 'no interaction recorded'}.` : 'The local loop stopped.'; }
  if (terminal) { clearTimeout(pollTimer); document.querySelectorAll('input[name="mode"]').forEach(input => input.disabled = false); }
  return terminal;
}
$('stop-run').addEventListener('click', async () => {
  if (!activeRun || isTerminal(activeRun)) return;
  const id = activeRun.id;
  $('stop-run').disabled = true;
  try {
    const response = await fetch(`/api/runs/${encodeURIComponent(id)}/cancel`, {method: 'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not request a stop.');
    cancellationRequestedFor = id;
    setStatus('cancelling'); $('stop-run').textContent = 'Stop requested…';
    $('run-action-note').hidden = false;
    $('run-action-note').textContent = activeRun.mode === 'gemini' ? 'Stop requested for the local loop. Hosted cancellation is not confirmed until a cloud status check reports a terminal state.' : 'Stop requested. Waiting for the local loop to stop.';
    clearTimeout(pollTimer); pollRun(id);
  } catch (error) { $('run-error').hidden = false; $('run-error').textContent = error.message; $('stop-run').disabled = false; }
});
async function pollRun(id) {
  try {
    const response = await fetch(`/api/runs/${encodeURIComponent(id)}`);
    if (!response.ok) throw new Error(`Could not load run (${response.status}).`);
    const run = await response.json();
    if(activeRun?.id!==id)return;
    if (!renderRun(run)) pollTimer = setTimeout(() => pollRun(id), 1500);
  } catch (error) {
    $('run-error').hidden = false; $('run-error').textContent = `${error.message} Retrying shortly…`;
    pollTimer = setTimeout(() => pollRun(id), 3500);
  }
}
$('start-run').addEventListener('click', async () => {
  if (selectedMode() === 'gemini' && blockedManagedRuns.length) { renderRemoteStatus(); $('remote-status-panel').scrollIntoView({block: 'center', behavior: 'smooth'}); return; }
  $('run-error').hidden = true;
  $('start-run').disabled = true;
  $('start-run').firstElementChild.textContent = 'Starting repair run…';
  document.querySelectorAll('input[name="mode"]').forEach(input => input.disabled = true);
  clearTimeout(pollTimer); eventCount = -1;
  cancellationRequestedFor = null; $('run-action-note').hidden = true;
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
    await refreshConfig();
  }
});
