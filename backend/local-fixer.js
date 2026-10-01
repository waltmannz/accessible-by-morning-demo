import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';

// Fixture-specific, deterministic repair. This mode never claims Gemini made changes.
export async function fixLocally(dir) {
  let html=await readFile(path.join(dir,'index.html'),'utf8');
  html=html.replace('<span class="page-title">A little time.<br>A healthier you.</span>','<h1 class="page-title">A little time.<br>A healthier you.</h1>');
  for(const [label,id] of [['What can we help with?','service'],['Your preferred date','date'],['Your name','name'],['Email address','email']]) html=html.replace(`<div class="field-label">${label}</div>`,`<label class="field-label" for="appointment-${id}">${label}</label>`);
  html=html.replace('<div id="booking-form">','<form id="booking-form" novalidate>');
  html=html.replace(/<div class="slot" data-slot="([^"]+)">([^<]+)<\/div>/g,'<button type="button" class="slot" data-slot="$1" aria-pressed="false">$2</button>');
  html=html.replace('<div id="book-appointment" class="book-button">Book appointment <span aria-hidden="true">↗</span></div>','<button type="submit" id="book-appointment" class="book-button">Book appointment <span aria-hidden="true">↗</span></button>');
  html=html.replace('<p id="booking-error" class="booking-error" hidden>','<p id="booking-error" class="booking-error" role="alert" hidden>');
  html=html.replace(/<\/div>(\s*)<div id="confirmation"/,'</form>$1<div id="confirmation"');
  html=html.replace('id="confirmation" class="confirmation" hidden','id="confirmation" class="confirmation" role="status" aria-live="polite" tabindex="-1" hidden');
  await writeFile(path.join(dir,'index.html'),html);
  let css=await readFile(path.join(dir,'styles.css'),'utf8');
  css=css.replace('color:#83877e','color:#4d574e').replace('color:#a1a59d','color:#636e64').replace(':focus{outline:none}',':focus-visible{outline:3px solid #235a9f;outline-offset:3px}');
  await writeFile(path.join(dir,'styles.css'),css);
  let js=await readFile(path.join(dir,'app.js'),'utf8');
  js=js.replace("document.querySelectorAll('[data-slot]').forEach(item => item.classList.toggle('selected', item === slot));","document.querySelectorAll('[data-slot]').forEach(item => { item.classList.toggle('selected', item === slot); item.setAttribute('aria-pressed', String(item === slot)); });");
  js=js.replace("document.getElementById('book-appointment').addEventListener('click', event => {","bookingForm.addEventListener('submit', event => {");
  js=js.replace("  error.hidden = true;", "  const today = new Date();\n  const selectedDate = new Date(date + 'T00:00:00');\n  today.setHours(0, 0, 0, 0);\n  if (selectedDate <= today) {\n    error.textContent = 'Choose a date after today.';\n    error.hidden = false;\n    document.getElementById('appointment-date').setAttribute('aria-invalid', 'true');\n    return;\n  }\n  document.getElementById('appointment-date').removeAttribute('aria-invalid');\n  error.hidden = true;");
  js=js.replace('  confirmation.hidden = false;','  confirmation.hidden = false;\n  confirmation.focus();');
  js=js.replace('  bookingForm.hidden = false;','  bookingForm.hidden = false;\n  selectedTime = \'\';\n  document.querySelectorAll(\'[data-slot]\').forEach(item => { item.classList.remove(\'selected\'); item.setAttribute(\'aria-pressed\', \'false\'); });\n  document.getElementById(\'appointment-service\').focus();');
  await writeFile(path.join(dir,'app.js'),js);
  return {summary:'Deterministic fixture repair: native appointment controls, field labels, heading, contrast, focus, date validation, and announced confirmation.',wcag:['1.3.1','1.4.3','2.1.1','2.4.7','3.3.1','3.3.2','4.1.2','4.1.3']};
}
