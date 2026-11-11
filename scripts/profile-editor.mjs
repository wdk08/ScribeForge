// Isolated, reproducible editor benchmark. No user library or native files are opened.
import {chromium} from '@playwright/test';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
const output=process.argv[2]??'/tmp/scriptforge-editor-profile.json';
const fixtureRoot='/tmp/scriptforge-editor-profile-fixtures';await mkdir(fixtureRoot,{recursive:true});
const browser=await chromium.launch({channel:'chrome',args:['--enable-precise-memory-info']});
const rows=[];
for(const target of [10,50,100,150]){
 const context=await browser.newContext({viewport:{width:1440,height:1000}});
 await context.addInitScript(()=>{window.scriptForgeLocalHelperDisabled=true;window.showDirectoryPicker=undefined;window.__editorProfile={};});
 await context.route(/\/js\/(pagination|renderer|editing|session)\.js$/,async route=>{
  const response=await route.fetch();let source=await response.text();
  const wrap=(name,stat)=>{source=source.replace(`export function ${name}(`,`function ${name}Base(`);source+=`\nexport function ${name}(...args){const p=window.__editorProfile,t=performance.now();try{return ${name}Base(...args)}finally{p.${stat}Ms=(p.${stat}Ms||0)+performance.now()-t;p.${stat}Calls=(p.${stat}Calls||0)+1;}}\n`;};
  if(route.request().url().includes('pagination.js')){wrap('layoutUnits','units');wrap('paginate','pagination');
   source=source.replace('export function createMeasurer(','function createMeasurerBase(');source+='\nexport function createMeasurer(container){const measure=createMeasurerBase(container);return (...args)=>{const p=window.__editorProfile,t=performance.now(),previous=container.firstChild;try{return measure(...args)}finally{p.measureMs=(p.measureMs||0)+performance.now()-t;p.measureCalls=(p.measureCalls||0)+1;if(container.firstChild!==previous)p.measureMisses=(p.measureMisses||0)+1;}};}';
  }else if(route.request().url().includes('renderer.js'))wrap('renderPages','render');
  else if(route.request().url().includes('editing.js'))wrap('editDocument','edit');
  else if(route.request().url().includes('session.js'))wrap('documentFingerprint','fingerprint');
  await route.fulfill({response,body:source});
 });
 const page=await context.newPage();await page.goto('http://localhost:4173/');
 let fixture;try{fixture=JSON.parse(await readFile(`${fixtureRoot}/${target}.json`,'utf8'));}catch{}
 const seeded=await page.evaluate(async({target,fixture})=>{
  const {createDocument,createElement:e}=await import('/js/document.js'),{draftRecord}=await import('/js/session.js'),{repository}=await import('/js/storage.js'),{paginate,layoutUnits,createMeasurer}=await import('/js/pagination.js'),{ensureScreenplayFonts}=await import('/js/screenplay-format.js');await ensureScreenplayFonts();
  const make=count=>createDocument({title:`Profile ${target}`,elements:Array.from({length:count},(_,n)=>[
   e('scene',`INT. ROOM ${n} - DAY`),e('action',Array(6).fill('The room is quiet. A writer watches the window.').join('\n')),
   e('character',n%2?'ANN':'BOB'),e('parenthetical','(quietly)'),e('dialogue',Array(12).fill('I need to know what happens next.').join('\n')),
   e('action',Array(6).fill('Footsteps echo down the long empty corridor.').join('\n')),
  ]).flat()});
  const host=document.createElement('div');host.className='measurement';document.body.append(host);const measure=createMeasurer(host);
  let doc=fixture??make(target),count=target;
  if(!fixture)for(let i=0;i<4;i++){const pages=paginate(layoutUnits(doc,measure)).length;if(Math.abs(pages-target)<=1)break;count=Math.max(1,Math.round(count*target/pages));doc=make(count);}
  host.remove();const record=draftRecord(doc);record.recovery.dirty=false;await repository.put(record);return {doc,id:doc.id};
 },{target,fixture});
 if(!fixture)await writeFile(`${fixtureRoot}/${target}.json`,JSON.stringify(seeded.doc));
 await page.goto(`http://localhost:4173/editor.html?id=${seeded.id}`);await page.locator('#pages[contenteditable=true]').waitFor();
 const result=await page.evaluate(async()=>{
  const root=document.getElementById('pages'),doc=window.scriptForge.getDocument(),actions=doc.elements.filter(e=>e.type==='action'),el=actions[Math.floor(actions.length/2)];
  const {restoreSelection}=await import('/js/selection.js');restoreSelection(root,{anchor:{id:el.id,offset:3},focus:{id:el.id,offset:3}},{scroll:true});
  await new Promise(r=>requestAnimationFrame(r));
  const p=window.__editorProfile;for(const k of Object.keys(p))delete p[k];const beforeHeap=performance.memory?.usedJSHeapSize;
  let created=0;const observer=new MutationObserver(records=>{for(const record of records)for(const n of record.addedNodes)if(n.nodeType===1)created+=1+n.querySelectorAll('*').length;});observer.observe(root,{subtree:true,childList:true});
  const longTasks=[];let tasks;try{tasks=new PerformanceObserver(list=>longTasks.push(...list.getEntries().map(e=>e.duration)));tasks.observe({type:'longtask'});}catch{}
  const samples=[];for(const char of 'writingflow'){
   const start=performance.now();root.dispatchEvent(new InputEvent('beforeinput',{inputType:'insertText',data:char,bubbles:true,cancelable:true}));const blocking=performance.now()-start;
   const visible=root.querySelector('.active-writing-area')?.textContent.includes(char);
   const frame=await new Promise(r=>requestAnimationFrame(()=>r(performance.now()-start)));
   const painted=await new Promise(r=>requestAnimationFrame(()=>r(performance.now()-start)));
   samples.push({blockingMs:blocking,firstFrameMs:frame,paintProxyMs:painted,visible});
  }
  await new Promise(r=>setTimeout(r,50));observer.disconnect();tasks?.disconnect();
  return {pages:window.scriptForge.getPages().length,elements:doc.elements.length,characters:doc.elements.reduce((n,e)=>n+e.text.length,0),samples,metrics:{...p},createdDOMElements:created,DOMElements:root.querySelectorAll('*').length,heapBeforeBytes:beforeHeap,heapAfterBytes:performance.memory?.usedJSHeapSize,longTasksMs:longTasks,selection:window.scriptForge.getSelection()};
 });
 rows.push({target,...result});console.log(JSON.stringify({target,pages:result.pages,metrics:result.metrics,blockingMs:result.samples.map(s=>s.blockingMs),created:result.createdDOMElements}));await context.close();
}
await browser.close();await writeFile(output,JSON.stringify({engine:'Chrome',method:'synchronous beforeinput handler + first and second requestAnimationFrame paint proxies; fixed fixtures in /tmp; routing adds timing counters only',rows},null,2)+'\n');
