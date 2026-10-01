import { chromium } from 'playwright';
import axe from 'axe-core';
import lighthouse from 'lighthouse';
import { launch } from 'chrome-launcher';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

async function tabTo(page,selector,max=35) {
  for(let i=0;i<max;i++) {
    await page.keyboard.press('Tab');
    if(await page.evaluate(s=>document.activeElement?.matches(s),selector)) return true;
  }
  return false;
}
export async function keyboardBooking(page) {
  const steps=[]; const check=(name,passed,detail)=>steps.push({name,passed,detail});
  await page.goto(page.url());
  const tomorrow=await page.evaluate(()=>{const d=new Date();d.setDate(d.getDate()+1);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;});
  for (const [id,value] of [['appointment-service',null],['appointment-date',tomorrow],['appointment-name','Alex Taylor'],['appointment-email','alex@example.com']]) {
    const reached=await tabTo(page,`#${id}`); check(`Reach ${id} by Tab`,reached);
    if(!reached) return {passed:false,steps,confirmation:false};
    if(id==='appointment-service') { await page.keyboard.press('ArrowDown'); }
    else if(id==='appointment-date') {
      // Date widgets differ by OS. Assign test data without pointer interaction;
      // navigation/selection/submission assertions still use actual keyboard events.
      await page.locator(`#${id}`).evaluate((el,v)=>{el.value=v;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));},value);
      check('Date test data supplied',true,'Native date value seeded; date-picker keystrokes are not covered.');
    } else { await page.keyboard.type(value); }
  }
  const slot=await tabTo(page,'[data-slot="09:30"]'); check('Reach 09:30 appointment slot by Tab',slot);
  if(!slot) return {passed:false,steps,confirmation:false};
  await page.keyboard.press('Enter');
  const submit=await tabTo(page,'#book-appointment'); check('Reach Book appointment by Tab',submit);
  if(!submit) return {passed:false,steps,confirmation:false};
  const focus=await page.locator('#book-appointment').evaluate(el=>{const s=getComputedStyle(el);return {outline:s.outlineStyle,width:s.outlineWidth};});
  check('Visible keyboard focus',focus.outline!=='none' && focus.width!=='0px',JSON.stringify(focus));
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  const confirmation=await page.locator('#confirmation').isVisible();
  check('Booking confirmation appears after Enter',confirmation);
  const announced=await page.locator('#confirmation').evaluate(el=>['status','alert'].includes(el.getAttribute('role')) || ['polite','assertive'].includes(el.getAttribute('aria-live')));
  check('Confirmation has announcement semantics',announced);
  return {passed:steps.every(s=>s.passed),steps,confirmation};
}
export async function functionalChecks(page) {
  const checks=[];
  const check=(name,passed,detail)=>checks.push({name,passed,detail});
  const validDate=await page.evaluate(()=>{const d=new Date();d.setDate(d.getDate()+2);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;});
  const seed=async({date=validDate,email='alex@example.com',name='Alex Taylor',slot=true}={})=>{
    await page.goto(page.url());
    await page.locator('#appointment-name').fill(name);
    await page.locator('#appointment-email').fill(email);
    await page.locator('#appointment-date').fill(date);
    if(slot)await page.locator('[data-slot="09:30"]').click();
    await page.locator('#book-appointment').click();
  };
  await seed({date:'2000-01-01'});
  check('Past appointment date is rejected',!(await page.locator('#confirmation').isVisible()) && await page.locator('#booking-error').isVisible());
  await seed({email:'not-an-email'});
  check('Invalid email is rejected',!(await page.locator('#confirmation').isVisible()) && await page.locator('#booking-error').isVisible());
  await seed({name:''});
  check('Missing name is rejected',!(await page.locator('#confirmation').isVisible()) && await page.locator('#booking-error').isVisible());
  await seed({slot:false});
  check('Missing appointment slot is rejected',!(await page.locator('#confirmation').isVisible()) && await page.locator('#booking-error').isVisible());
  check('Error has announcement semantics',await page.locator('#booking-error').evaluate(el=>['alert','status'].includes(el.getAttribute('role'))||['polite','assertive'].includes(el.getAttribute('aria-live'))));
  await page.goto(page.url());
  const date=validDate;
  await seed({date});
  const details=await page.locator('#confirmation-details').textContent();
  check('Confirmation preserves booking details',await page.locator('#confirmation').isVisible() && details.includes('Alex Taylor') && details.includes(date) && details.includes('09:30'));
  if(await page.locator('#confirmation').isVisible()) {
    await page.locator('#book-another').click();
    check('Book another restores the form',await page.locator('#booking-form').isVisible() && !(await page.locator('#confirmation').isVisible()));
  } else check('Book another restores the form',false);
  await page.setViewportSize({width:320,height:900});
  await page.goto(page.url());
  check('320 CSS pixel reflow has no horizontal overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'Viewport proxy for 400% zoom at 1280px, not a magnifier user test.');
  return {passed:checks.every(c=>c.passed),checks};
}
export async function auditSite({url,outputDir,signal}) {
  await mkdir(outputDir,{recursive:true}); signal?.throwIfAborted();
  // Every invocation starts a new browser: verification never reuses fixer state.
  const browser=await chromium.launch({headless:true}); let result;
  try {
    const page=await browser.newPage({viewport:{width:1440,height:1080}});
    await page.goto(url,{waitUntil:'networkidle'});
    await page.screenshot({path:path.join(outputDir,'screenshot.png'),fullPage:true});
    await page.addScriptTag({content:axe.source});
    const raw=await page.evaluate(async()=>window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa','best-practice']}}));
    await writeFile(path.join(outputDir,'axe.json'),JSON.stringify(raw,null,2));
    const transcript=await page.evaluate(()=>Array.from(document.querySelectorAll('h1,h2,h3,nav a,label,input,select,button,[role="button"],[data-slot],#book-appointment')).map(el=>{
      const label=el.getAttribute('aria-label') || (el.labels?.length?Array.from(el.labels).map(l=>l.textContent.trim()).join(' '):'') || (['INPUT','SELECT'].includes(el.tagName)?'unlabelled':el.textContent.trim());
      return `${el.getAttribute('role')||el.tagName.toLowerCase()}: ${label}`;
    }));
    await writeFile(path.join(outputDir,'semantic-transcript.txt'),'DOM semantic inspection, not NVDA/JAWS or human testing.\n'+transcript.join('\n'));
    const keyboard=await keyboardBooking(page);
    await writeFile(path.join(outputDir,'keyboard.json'),JSON.stringify(keyboard,null,2));
    const functionality=await functionalChecks(page);
    await writeFile(path.join(outputDir,'functionality.json'),JSON.stringify(functionality,null,2));
    const violations=raw.violations.map(v=>({id:v.id,impact:v.impact,description:v.description,help:v.help,helpUrl:v.helpUrl,tags:v.tags,nodes:v.nodes.map(n=>({html:n.html,target:n.target,failureSummary:n.failureSummary}))}));
    result={measuredAt:new Date().toISOString(),url,lighthouseScore:null,violationCount:violations.length,affectedNodes:violations.reduce((sum,v)=>sum+v.nodes.length,0),violations,keyboard,functionality,transcript,transcriptType:'DOM semantics; not a real screen reader',humanAudit:{status:'not-performed'},axeVersion:raw.testEngine.version};
  } finally { await browser.close(); }
  signal?.throwIfAborted();
  let chrome;
  try {
    chrome=await launch({chromePath:chromium.executablePath(),chromeFlags:['--headless=new','--no-sandbox','--disable-dev-shm-usage'],logLevel:'silent'});
    const report=await lighthouse(url,{port:chrome.port,onlyCategories:['accessibility'],logLevel:'error',output:['json','html'],formFactor:'desktop',screenEmulation:{mobile:false,width:1440,height:1080,deviceScaleFactor:1,disabled:false}});
    result.lighthouseScore=Math.round(report.lhr.categories.accessibility.score*100);
    result.lighthouseVersion=report.lhr.lighthouseVersion;
    await writeFile(path.join(outputDir,'lighthouse.json'),report.report[0]);
    await writeFile(path.join(outputDir,'lighthouse.html'),report.report[1]);
  } catch(error) { result.lighthouseError=error.message; } finally { if(chrome) await chrome.kill(); }
  await writeFile(path.join(outputDir,'audit.json'),JSON.stringify(result,null,2));
  return result;
}
