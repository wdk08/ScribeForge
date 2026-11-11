import {test,expect} from '@playwright/test';
test.beforeEach(async({context})=>{await context.addInitScript(()=>{window.scriptForgeLocalHelperDisabled=true;window.showDirectoryPicker=undefined;});});
async function seed(page,elements){await page.goto('/');const doc=await page.evaluate(async elements=>{const{createDocument,createElement}=await import('/js/document.js'),{draftRecord}=await import('/js/session.js'),{repository}=await import('/js/storage.js');const doc=createDocument({elements:elements.map(([type,text,margin])=>({...createElement(type,text),...(margin?{rightMarginOffsetPt:margin}:{})}))});const r=draftRecord(doc);r.recovery.dirty=false;await repository.put(r);return doc;},elements);await page.goto(`/editor.html?id=${doc.id}`);await expect(page.locator('#pages')).toHaveAttribute('contenteditable','true');return doc;}
async function select(page,id,offset){await page.evaluate(async({id,offset})=>(await import('/js/selection.js')).restoreSelection(document.getElementById('pages'),{anchor:{id,offset},focus:{id,offset}},{scroll:true}),{id,offset});}
for(const count of [8,51])test(`unfinished dialogue drafting stays put with ${count} Action lines; completed speech keeps boundary rules`,async({page})=>{
 const doc=await seed(page,[['action',Array(count).fill('A short action line.').join('\n')],['action','']]),id=doc.elements[1].id;
 await select(page,id,0);
 const onePage=async()=>{expect((await page.evaluate(()=>window.scriptForge.getPages())).length).toBe(1);expect(await page.locator(`[data-element-id="${id}"]`).evaluate(el=>el.closest('.screenplay-page').dataset.page)).toBeDefined();};
 await page.keyboard.press('Tab');await onePage();await page.keyboard.type('luke');await onePage();
 expect((await page.evaluate(()=>window.scriptForge.getDocument())).elements.find(e=>e.id===id).text).toBe('LUKE');
 await page.keyboard.press('Enter');await onePage();await page.keyboard.press('Tab');await onePage();
 await page.keyboard.type('whispering');await onePage();
 await page.keyboard.press('Enter');await page.keyboard.type('Hello.');
 const pages=await page.evaluate(()=>window.scriptForge.getPages());expect(pages.length).toBe(count===8?1:2);expect(pages.every(p=>p.used<=864)).toBe(true);
 if(count===51){expect(pages[0].items.length).toBe(1);expect(pages[1].items[0].columns[0][0].id).toBe(id);}
 await page.keyboard.press('ControlOrMeta+z');await page.keyboard.press('ControlOrMeta+Shift+z');expect(await page.evaluate(()=>window.scriptForge.getPages())).toEqual(pages);
 if(count===8)await page.screenshot({path:'test-results/drafting-mid-page.png'});
});
for(const position of ['beginning','middle','end'])test(`Action Return at ${position} splits independent elements, preserves spaces/margins, and recovers`,async({page})=>{
 const text='Luke walks into the bedroom and closes the door behind him.',doc=await seed(page,[['action',text,15]]),id=doc.elements[0].id;
 const offset=position==='beginning'?0:position==='end'?text.length:text.indexOf('and');await select(page,id,offset);await page.keyboard.press('Enter');
 const split=await page.evaluate(()=>window.scriptForge.getDocument()),actions=split.elements.filter(e=>e.type==='action');expect(actions.map(e=>e.text)).toEqual([text.slice(0,offset),text.slice(offset)]);expect(actions[0].id).toBe(id);expect(actions[1].id).not.toBe(id);expect(actions.map(e=>e.rightMarginOffsetPt)).toEqual([15,15]);
 expect(await page.evaluate(()=>window.scriptForge.getSelection().focus)).toEqual({id:actions[1].id,offset:0});await expect(page.locator('.active-writing-area')).toHaveAttribute('data-element-id',actions[1].id);
 const stored=await page.evaluate(async()=>{await window.scriptForgeBeforeClose();return(await(await import('/js/storage.js')).repository.get(window.scriptForge.getDocument().id)).recovery.document;});expect(stored).toEqual(split);
 if(position==='middle'){
  const output=await page.evaluate(async()=>{const doc=window.scriptForge.getDocument(),source=(await import('/js/session.js')).fountainForSaving(doc);return{source,text:(await import('/js/fountain.js')).parseFountain(source).elements.filter(e=>e.type==='action').map(e=>e.text)};});expect(output.text).toEqual(actions.map(e=>e.text));
  await page.addScriptTag({url:'/vendor/jspdf.umd.min.js'});
  const pdf=await page.evaluate(async()=>{const PDF=window.jspdf.jsPDF,writes=[];window.jspdf.jsPDF=function(options){const pdf=new PDF(options),text=pdf.text;pdf.text=function(t,x,y,o){if(pdf.internal.getCurrentPageInfo().pageNumber>1)writes.push({text:t,x,y});return text.call(pdf,t,x,y,o);};return pdf;};const result=await(await import('/js/pdf-export.js')).createScreenplayPDF(window.scriptForge.getDocument());return{pages:result.pages,writes};});
  expect(pdf.pages).toBe(2);expect(pdf.writes.filter(w=>w.text.trim()).map(w=>w.text)).toEqual(actions.map(e=>e.text));expect(pdf.writes[1].y-pdf.writes[0].y).toBe(24);expect(pdf.writes.every(w=>w.x===108)).toBe(true);await page.screenshot({path:'test-results/drafting-action-split.png'});
 }
 await page.keyboard.press('ControlOrMeta+z');expect(await page.evaluate(()=>window.scriptForge.getDocument())).toEqual(doc);await page.keyboard.press('ControlOrMeta+Shift+z');expect(await page.evaluate(()=>window.scriptForge.getDocument())).toEqual(split);
 await page.reload();await page.locator('#recover-changes').click();await expect(page.locator('#pages')).toHaveAttribute('contenteditable','true');expect(await page.evaluate(()=>window.scriptForge.getDocument())).toEqual(split);
  await select(page,actions[0].id,Math.min(3,actions[0].text.length));const before=await page.evaluate(()=>window.scriptForge.getDocument());await page.keyboard.press('Shift+Enter');const soft=await page.evaluate(()=>window.scriptForge.getDocument());expect(soft.elements.length).toBe(before.elements.length);expect(soft.elements.filter(e=>e.type==='action').length).toBe(2);expect(soft.elements.find(e=>e.id===actions[0].id).text).toContain('\n');
});
