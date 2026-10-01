import {chromium} from 'playwright';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
const origin = process.env.DEMO_URL || 'http://127.0.0.1:4173';
const out = path.resolve('runs/ui-verification');
await mkdir(out,{recursive:true});
const browser = await chromium.launch({headless:true});
const errors = [];
const page = await browser.newPage({viewport:{width:1440,height:1050},deviceScaleFactor:1});
page.on('pageerror', error=>errors.push(error.message));
await page.goto(origin,{waitUntil:'networkidle'});
await page.screenshot({path:path.join(out,'dashboard-desktop.png'),fullPage:true});
await page.addScriptTag({content:await readFile(path.resolve('node_modules/axe-core/axe.min.js'),'utf8')});
const audit = await page.evaluate(()=>axe.run({include:[['body']],exclude:[['iframe']]},{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa']}}));
const overflow = await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
await page.setViewportSize({width:390,height:844});
await page.screenshot({path:path.join(out,'dashboard-mobile.png'),fullPage:true});
const mobileOverflow = await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
const stateChecks = await page.evaluate(() => {
  const results = [];
  for (const status of ['cancelled','interrupted']) {
    renderRun({id:'state-check',mode:'local',status,stage:'fix',events:[]});
    results.push({name:`${status} allows a new run`,passed:!document.getElementById('start-run').disabled});
  }
  for (const stage of ['plan','fix','retry']) {
    renderRun({id:'state-check',mode:'local',status:'running',stage,events:[]});
    results.push({name:`${stage} shows repair progress`,passed:document.querySelector('#pipeline li[data-stage="fixing"]').classList.contains('active')});
  }
  renderRun({id:'state-check',mode:'local',status:'failed',stage:'failed',events:[{stage:'verify',message:'Verification failed'}],verification:{keyboard:{passed:false}}});
  setPreview('after');
  results.push({name:'Failed verification labels candidate source',passed:document.getElementById('preview-description').textContent.includes('Candidate')});
  results.push({name:'Failure retains verification progress',passed:document.querySelector('#pipeline li[data-stage="verifying"]').classList.contains('active')});
  results.push({name:'Saved local run shows local engine',passed:document.getElementById('run-engine').textContent==='LOCAL DEMONSTRATION'});
  return results;
});
const runList = await (await page.request.get(`${origin}/api/runs`)).json();
const completed = runList.runs?.find(run=>run.status==='completed');
const artifactChecks = [];
if(completed){
  await page.setViewportSize({width:1440,height:1050});
  await page.evaluate(run=>{renderRun(run);setPreview('after');},completed);
  await page.locator('#preview').scrollIntoViewIfNeeded();
  try { await page.frameLocator('#preview').locator('#booking-heading').waitFor({timeout:5000}); }
  catch(error) { console.log(JSON.stringify(await page.evaluate(()=>({src:document.getElementById('preview').src,frame:document.getElementById('preview').contentDocument?.body?.innerText,html:document.getElementById('preview').outerHTML})),null,2)); throw error; }
  await page.evaluate(()=>scrollTo(0,0));
  await page.screenshot({path:path.join(out,'dashboard-completed.png'),fullPage:true});
  for(const id of ['report-link','diff-link','review-link']){
    const href = await page.locator(`#${id}`).getAttribute('href');
    const response = href ? await page.request.get(href) : null;
    artifactChecks.push({name:id,passed:response?.ok()||false,status:response?.status()||null});
  }
}
await writeFile(path.join(out,'dashboard-audit.json'),JSON.stringify({violations:audit.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>n.target)})),errors,desktopOverflow:overflow,mobileOverflow,stateChecks,artifactChecks,completedRun:completed?.id||null},null,2));
console.log(JSON.stringify({violations:audit.violations.length,errors,desktopOverflow:overflow,mobileOverflow,stateChecks,artifactChecks,completedRun:completed?.id||null,output:out},null,2));
await browser.close();
if(audit.violations.length||errors.length||overflow||mobileOverflow||stateChecks.some(check=>!check.passed)||artifactChecks.some(check=>!check.passed))process.exitCode=1;
