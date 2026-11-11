import { test, expect } from '@playwright/test';
test.beforeEach(async ({context})=>{await context.addInitScript(()=>{window.scriptForgeLocalHelperDisabled=true;window.showDirectoryPicker=undefined;});});
async function seed(page, source, off=false){
 await page.goto('/');
 const id=await page.evaluate(async({source,off})=>{
  const {parseFountain}=await import('/js/fountain.js'),{draftRecord}=await import('/js/session.js'),{repository}=await import('/js/storage.js');
  const doc=parseFountain(source);if(off)doc.elements.find(e=>e.type==='character').continuation='off';
  const record=draftRecord(doc);record.recovery.dirty=false;await repository.put(record);return doc.id;
 },{source,off});
 await page.goto(`/editor.html?id=${id}`);await expect(page.locator('#pages')).toHaveAttribute('contenteditable','true');
}
test('page continuations preserve text, extensions, manual overrides, and every PDF line',async({page})=>{
 await seed(page,"Title: Continuation proof\nContact:\n    123 Example Street\n    Writer City, SC 29301\n    (864) 555-1234\n    screenwriter.longname@example.com\n\nINT. STUDIO - NIGHT\n\nSOPHIA (V.O.)\n(quietly)\n"+'I cannot leave without knowing the truth. '.repeat(160),true);
 const before=await page.evaluate(()=>window.scriptForge.getDocument());
 await expect(page.locator('.page-more').first()).toBeVisible();
 const data=await page.evaluate(()=>{
  const pages=window.scriptForge.getPages(),doc=window.scriptForge.getDocument(),byId=new Map(doc.elements.map(e=>[e.id,e]));
  const text=pages.flatMap(p=>p.items.flatMap(i=>i.columns.flatMap(c=>c))).filter(l=>l.type==='dialogue').map(l=>byId.get(l.id).text.slice(l.start,l.end)).join('');
  return {pages:pages.length,safe:pages.every(p=>p.used<=864),text,cue:doc.elements.find(e=>e.type==='character'),markers:[...document.querySelectorAll('.page-continuation')].map(e=>({text:e.textContent,editable:e.contentEditable,font:getComputedStyle(e).fontSize})),more:document.querySelectorAll('.page-more').length};
 });
 expect(data.pages).toBeGreaterThanOrEqual(3);expect(data.safe).toBe(true);expect(data.more).toBe(data.pages-1);
 expect(data.text).toBe(before.elements.find(e=>e.type==='dialogue').text);
 expect(data.markers.every(m=>m.text==="SOPHIA (V.O.) (CONT'D)"&&m.editable==='false'&&m.font==='16px')).toBe(true);expect(data.cue.continuation).toBe('off');
 await page.addScriptTag({url:'/vendor/jspdf.umd.min.js'});
 const proof=await page.evaluate(async()=>{
  const doc=window.scriptForge.getDocument(),pages=window.scriptForge.getPages(),byId=new Map(doc.elements.map(e=>[e.id,e])),PDF=window.jspdf.jsPDF,writes=[];
  window.jspdf.jsPDF=function(options){const pdf=new PDF(options),text=pdf.text;pdf.text=function(value,x,y,options){const n=pdf.internal.getCurrentPageInfo().pageNumber;if(n>1&&y>60)writes.push({text:value,page:n-1,x,y});return text.call(pdf,value,x,y,options);};return pdf;};
  const expected=pages.flatMap((p,index)=>p.items.flatMap(i=>[
   ...i.headers.flatMap(c=>c.map(l=>l.text)),...i.columns.flatMap(c=>c.map(l=>(l.displayText??byId.get(l.id).text.slice(l.start,l.end)).replace(/\n$/,''))),...i.more.filter(Boolean).map(()=>'(MORE)')
  ].filter(Boolean).map(text=>({text,page:index+1}))));
  const result=await(await import('/js/pdf-export.js')).createScreenplayPDF(doc);window.continuationBlob=result.blob;
  return {writes,expected,pages:result.pages};
 });
 expect(proof.writes.map(({text,page})=>({text,page}))).toEqual(proof.expected);expect(proof.pages).toBe(data.pages+1);
 expect(proof.writes.filter(w=>w.text==='(MORE)'||w.text.includes("(CONT'D)")).every(w=>w.x===252&&w.y<728)).toBe(true);
 await page.locator('#zoom').selectOption('1');await page.locator('.document-viewport').evaluate(el=>{el.scrollTop=1100;});
 await page.screenshot({path:'test-results/page-continuation.png'});
 const download=page.waitForEvent('download');await page.evaluate(()=>{const a=document.createElement('a');a.href=URL.createObjectURL(window.continuationBlob);a.download='Continuation.pdf';a.click();});await(await download).saveAs('test-results/page-continuation.pdf');
 expect(await page.evaluate(()=>window.scriptForge.getDocument())).toEqual(before);
 // Replace only the dialogue spanning all page fragments, through normal editing.
 await page.evaluate(()=>{const pieces=[...document.querySelectorAll('[data-type=dialogue]')],first=pieces[0],last=pieces.at(-1),range=document.createRange();document.getElementById('pages').focus();range.setStart(first.firstChild,0);range.setEnd(last.firstChild,last.firstChild.length);getSelection().removeAllRanges();getSelection().addRange(range);});
 await page.keyboard.insertText('Short.');await expect(page.locator('.page-more')).toHaveCount(0);await expect(page.locator('.page-continuation')).toHaveCount(0);
 expect((await page.evaluate(()=>window.scriptForge.getDocument())).elements.find(e=>e.type==='dialogue').text).toBe('Short.');
});
test('dual speech stays side by side and marks only the still-speaking column',async({page})=>{
 await seed(page,'ANN\n'+'Left column speech continues for several pages. '.repeat(110)+'\n\nBOB (O.S.) ^\nA short reply.');
 const result=await page.evaluate(()=>{
  const pages=window.scriptForge.getPages(),before=JSON.stringify(window.scriptForge.getDocument());
  return {safe:pages.every(p=>p.used<=864),columns:pages.flatMap(p=>p.items).filter(i=>i.kind==='dual').map(i=>({more:i.more,headers:i.headers,counts:i.columns.map(c=>c.length)})),unchanged:before===JSON.stringify(window.scriptForge.getDocument())};
 });
 expect(result.safe&&result.unchanged).toBe(true);expect(result.columns.length).toBeGreaterThan(2);
 expect(result.columns[0].more).toEqual([true,false]);expect(result.columns.slice(1).every(i=>i.headers[1].length===0&&i.counts[1]===0)).toBe(true);
 const bounds=await page.locator('.dualDialogue').first().evaluate(row=>[...row.children].map(el=>({x:el.getBoundingClientRect().x,y:el.getBoundingClientRect().y})));
 expect(bounds[1].x).toBeGreaterThan(bounds[0].x);expect(bounds[1].y).toBe(bounds[0].y);
});
test('ordinary title email stays on one line and profile fields remain editable in smaller windows',async({page})=>{
 await seed(page,'Title: Contacts\nContact:\n    One Street\n    screenwriter.longname@example.com\n\nINT. ROOM - DAY\n\nAction.');
 await page.locator('#zoom').selectOption('1');
 const geometry=await page.locator('[data-title-field=email]').evaluate(el=>({height:parseFloat(el.style.height),width:el.getBoundingClientRect().width,text:el.value}));
 expect(geometry.height).toBe(20);expect(geometry.width).toBeGreaterThan(300);
 await page.setViewportSize({width:800,height:700});await page.locator('#screenplay-settings').click();
 const email=page.locator('#writer-email');await email.fill('a.very.long.but.editable.writer.address@example.com');
 expect(await email.inputValue()).toContain('@example.com');
 const bounds=await email.evaluate(el=>({left:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right,window:innerWidth}));
 expect(bounds.left).toBeGreaterThan(0);expect(bounds.right).toBeLessThan(bounds.window);
});
