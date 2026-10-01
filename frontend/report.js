import {evidenceStyles, renderReportContent} from './public-showcase.js';
const style = document.createElement('style'); style.textContent = evidenceStyles; document.head.append(style);
const status = document.getElementById('report-status');
try {
  const id = new URLSearchParams(location.search).get('run');
  if (!id || !/^[a-zA-Z0-9-]+$/.test(id)) throw new Error('Choose a recorded run from the repair desk to read its evidence.');
  const response = await fetch(`/api/runs/${encodeURIComponent(id)}`);
  if (!response.ok) throw new Error('This recorded run could not be found. Return to the repair desk and choose a run.');
  const run = await response.json();
  document.getElementById('report-content').innerHTML = renderReportContent({run});
  status.textContent = run.status === 'completed' ? 'Recorded result: the automated verification gate passed. Human testing remains pending.' : `Recorded run status: ${run.status}. This is a partial or unsuccessful run; the report does not imply the repaired task passed.`;
  status.className = 'scope-note';
  const preview = document.getElementById('report-preview-link');
  preview.hidden = false; preview.href = `/preview/${encodeURIComponent(id)}/${run.verification ? 'after' : 'before'}/`;
  document.title = `${run.status === 'completed' ? 'Verified run' : 'Run evidence'} · Accessible by Morning`;
} catch (error) { status.className = 'report-error'; status.textContent = error.message; }
