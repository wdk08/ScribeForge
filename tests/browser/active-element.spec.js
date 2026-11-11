import {test,expect} from '@playwright/test';
test.beforeEach(async({context})=>{await context.addInitScript(()=>{window.scriptForgeLocalHelperDisabled=true;window.showDirectoryPicker=undefined;});});
async function open(page,source,{legacy=false,empty=false}={}){
 await page.goto('/');
 const id=await page.evaluate(async({source,legacy,empty})=>{
  const {parseFountain}=await import('/js/fountain.js'),{draftRecord}=await import('/js/session.js'),{repository}=await import('/js/storage.js'),{createElement}=await import('/js/document.js');
  const doc=parseFountain(source);if(legacy)doc.elements.find(e=>e.type==='dialogue').rightMarginOffsetPt=3;if(empty)doc.elements.push(createElement('action',''));
  const r=draftRecord(doc);r.recovery.dirty=false;await repository.put(r);return r.id;
 },{source,legacy,empty});
 await page.goto(`/editor.html?id=${id}`);await expect(page.locator('#pages')).toHaveAttribute('contenteditable','true');
 return page.evaluate(()=>window.scriptForge.getDocument());
}
async function caret(page,id,offset=0){await page.evaluate(async({id,offset})=>{(await import('/js/selection.js')).restoreSelection(document.getElementById('pages'),{anchor:{id,offset},focus:{id,offset}});},{id,offset});await expect(page.locator('.active-writing-area')).toHaveCount(1);}
const geometry=page=>page.locator('.active-writing-area').evaluate(el=>{const c=getComputedStyle(el);return {id:el.dataset.elementId,start:Number(el.dataset.start),width:parseFloat(el.style.width),height:parseFloat(el.style.height),left:c.marginLeft,color:c.color,font:c.font,lineHeight:c.lineHeight,padding:c.padding,bg:c.backgroundColor,border:c.borderWidth,shadow:c.boxShadow};});

test('highlight follows real element columns, empty lines, focus and themes without changing layout',async({page})=>{
 const doc=await open(page,'INT. ROOM - DAY\n\nAn action that wraps across several lines. '.repeat(1)+'\n\nANN\n(quietly)\nHello there.\n\n> CUT TO:\n\nBOB\nLeft speech.\n\nSUE ^\nRight speech.',{empty:true});
 for(const el of doc.elements.filter(e=>!['titleField','whitespace'].includes(e.type))){
  await caret(page,el.id);const g=await geometry(page);expect(g.id).toBe(el.id);expect(g.height).toBeGreaterThanOrEqual(16);expect(g.padding).toBe('0px');expect(g.border).toBe('0px');expect(g.shadow).toBe('none');expect(g.bg).not.toBe('rgba(0, 0, 0, 0)');
  const expected=await page.evaluate(async id=>{const d=window.scriptForge.getDocument(),el=d.elements.find(e=>e.id===id),dual=(await import('/js/document.js')).dualElementIds(d).has(id);return (await import('/js/right-margins.js')).elementLayout(el,dual);},el.id);expect(g.width).toBeCloseTo(expected.width,3);
 }
 const empty=doc.elements.at(-1);await caret(page,empty.id);expect((await geometry(page)).height).toBe(16);
 await page.keyboard.type('A line.');await page.keyboard.press('Shift+Enter');await page.keyboard.type('Next line.');expect((await geometry(page)).height).toBe(32);
 for(const key of ['Enter','Tab','Shift+Enter']){
  await page.keyboard.press(key);await expect(page.locator('.active-writing-area')).toHaveCount(1);
  expect((await geometry(page)).id).toBe(await page.evaluate(()=>window.scriptForge.getSelection().focus.id));
 }
 const g=await geometry(page);await page.evaluate(()=>document.documentElement.dataset.theme='dark');const dark=await geometry(page);expect(dark.bg).not.toBe(g.bg);expect(dark.width).toBe(g.width);expect(dark.height).toBe(g.height);
 await page.screenshot({path:'test-results/active-element-dark.png'});
 await page.locator('#document-title').focus();await expect(page.locator('.active-writing-area')).toHaveCount(0);
 await caret(page,empty.id,3);await page.evaluate(()=>document.documentElement.dataset.theme='light');await page.screenshot({path:'test-results/active-element-light.png'});
 await page.locator('[data-element-id]').filter({hasText:'Hello there.'}).click();await expect(page.locator('.active-writing-area')).toHaveAttribute('data-element-id',doc.elements.find(e=>e.text==='Hello there.').id);
 // A pure highlight/focus/theme change cannot affect the pagination model.
 const before=await page.evaluate(()=>window.scriptForge.getPages());await page.locator('#document-title').focus();expect(await page.evaluate(()=>window.scriptForge.getPages())).toEqual(before);
 await page.emulateMedia({media:'print'});await caret(page,empty.id);expect((await geometry(page)).bg).toBe('rgba(0, 0, 0, 0)');
});

test('legacy overrides retain exact points while future shortcuts resize highlight by five and preserve editing',async({page})=>{
 const doc=await open(page,'ANN\n'+('A speech with words that wrap naturally. '.repeat(80)),{legacy:true});const speech=doc.elements.find(e=>e.type==='dialogue');expect(speech.rightMarginOffsetPt).toBe(3);
 await caret(page,speech.id,10);const initial=await geometry(page);
 await page.keyboard.press('ControlOrMeta+]');let g=await geometry(page);expect(g.width-initial.width).toBeCloseTo(20/3,3);expect(g.left).toBe(initial.left);
 expect(await page.evaluate(id=>window.scriptForge.getDocument().elements.find(e=>e.id===id).rightMarginOffsetPt,speech.id)).toBe(-2);
 for(let i=0;i<4;i++)await page.keyboard.press('ControlOrMeta+]');await page.keyboard.press('ControlOrMeta+[');expect((await geometry(page)).width-initial.width).toBeCloseTo(80/3,3);
 await page.keyboard.press('ControlOrMeta+z');await page.keyboard.press('ControlOrMeta+Shift+z');
 expect(await page.evaluate(()=>window.scriptForge.getSelection().focus.offset)).toBe(10);
 for(let i=0;i<8;i++){await page.keyboard.press('ControlOrMeta+[');await page.keyboard.type('x');await page.keyboard.press('ControlOrMeta+]');}
 expect(await page.evaluate(()=>window.scriptForge.getSelection().focus.offset)).toBe(18);await expect(page.locator('.active-writing-area')).toHaveCount(1);
 await page.keyboard.press('ControlOrMeta+Backslash');expect((await geometry(page)).width).toBeCloseTo(initial.width+4,3);
 await page.keyboard.press('ControlOrMeta+z');await page.evaluate(()=>window.scriptForgeBeforeClose());const expected=await page.evaluate(()=>window.scriptForge.getDocument());
 await page.reload();await page.locator('#recover-changes').click();await expect(page.locator('#pages')).toHaveAttribute('contenteditable','true');expect(await page.evaluate(()=>window.scriptForge.getDocument())).toEqual(expected);
 await caret(page,speech.id,12);await page.keyboard.press('Shift+ArrowRight');await page.keyboard.press('ControlOrMeta+[');expect(await page.evaluate(()=>window.scriptForge.getSelection())).toEqual({anchor:{id:speech.id,offset:12},focus:{id:speech.id,offset:13}});
});

test('page-spanning and dual dialogue highlight only the focused fragment and never draw PDF backgrounds',async({page})=>{
 const doc=await open(page,'ANN\n'+('A long speech goes across pages. '.repeat(160))+'\n\nBOB\nLeft speech.\n\nSUE ^\nRight speech.');const speech=doc.elements.find(e=>e.type==='dialogue'),fragments=page.locator(`[data-element-id="${speech.id}"]`);expect(await fragments.count()).toBeGreaterThan(1);
 await caret(page,speech.id,4);const first=await geometry(page);const start=await fragments.nth(1).getAttribute('data-start');await caret(page,speech.id,Number(start)+1);expect((await geometry(page)).start).not.toBe(first.start);expect(await page.locator('.continuation.active-writing-area').count()).toBe(0);
 const before=await page.evaluate(()=>window.scriptForge.getPages());
 await page.addScriptTag({url:'/vendor/jspdf.umd.min.js'});
 const proof=await page.evaluate(async()=>{const Base=window.jspdf.jsPDF,calls=[];window.jspdf.jsPDF=function(o){const p=new Base(o),rect=p.rect;p.rect=function(...args){calls.push(args);return rect.apply(p,args);};return p;};const result=await(await import('/js/pdf-export.js')).createScreenplayPDF(window.scriptForge.getDocument());return {calls,pages:result.pages};});expect(proof.calls).toEqual([]);expect(proof.pages).toBe(before.length+1);expect(await page.evaluate(()=>window.scriptForge.getPages())).toEqual(before);
 const dual=doc.elements.filter(e=>e.type==='dialogue').at(-1);await caret(page,dual.id,1);expect((await geometry(page)).id).toBe(dual.id);expect(await page.locator('.dualDialogue .active-writing-area').count()).toBe(1);
 await page.keyboard.press('ControlOrMeta+[');expect((await geometry(page)).width).toBeCloseTo(264-20/3,3);
 await page.keyboard.press('ArrowLeft');await page.keyboard.press('ArrowUp');await expect(page.locator('.active-writing-area')).toHaveCount(1);
});
