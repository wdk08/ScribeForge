import {test,expect} from '@playwright/test';
test.beforeEach(async({context})=>{await context.addInitScript(()=>{window.scriptForgeLocalHelperDisabled=true;window.showDirectoryPicker=undefined;});});
const source='Title: Margin proof\nContact:\n    One Street\n    (864) 555-0123\n    screenwriter.longname@example.com\n\nINT. ROOM - DAY\n\nAn action.\n\nANN\n'+('A long speech with ordinary words and natural wrapping. '.repeat(100))+'\n\nAnother action.';
async function seed(page,script=source){await page.goto('/');const id=await page.evaluate(async source=>{const {parseFountain}=await import('/js/fountain.js'),{draftRecord}=await import('/js/session.js'),{repository}=await import('/js/storage.js');const r=draftRecord(parseFountain(source));r.recovery.dirty=false;await repository.put(r);return r.id;},script);await page.goto(`/editor.html?id=${id}`);await expect(page.locator('#pages')).toHaveAttribute('contenteditable','true');return id;}
async function select(page,a,start,b=a,end=start){await page.evaluate(async({a,start,b,end})=>{const {restoreSelection}=await import('/js/selection.js');restoreSelection(document.getElementById('pages'),{anchor:{id:a,offset:start},focus:{id:b,offset:end}});},{a,start,b,end});}
test('point shortcuts preserve caret, selection, left edges, recovery, backups, PDF and undo',async({page})=>{
 const id=await seed(page),before=await page.evaluate(()=>window.scriptForge.getDocument()),speech=before.elements.find(e=>e.type==='dialogue');
 await select(page,speech.id,17);const loc=page.locator(`[data-element-id="${speech.id}"]`).first();
 const width=await loc.evaluate(el=>parseFloat(el.style.width)),left=await loc.evaluate(el=>getComputedStyle(el).marginLeft);
 for(let i=0;i<3;i++)await page.keyboard.press('ControlOrMeta+[');
 expect(await loc.evaluate(el=>parseFloat(el.style.width))).toBeCloseTo(width-20,3);await expect(loc).toHaveCSS('margin-left',left);
 expect(await page.evaluate(()=>window.scriptForge.getSelection().focus.offset)).toBe(17);
 expect(await page.evaluate(id=>window.scriptForge.getDocument().elements.find(e=>e.id===id).rightMarginOffsetPt,speech.id)).toBe(15);
 await page.keyboard.press('ControlOrMeta+]');expect(await loc.evaluate(el=>parseFloat(el.style.width))).toBeCloseTo(width-40/3,3);
 await page.keyboard.press('ControlOrMeta+Backslash');expect(await page.evaluate(id=>'rightMarginOffsetPt' in window.scriptForge.getDocument().elements.find(e=>e.id===id),speech.id)).toBe(false);
 await page.keyboard.press('ControlOrMeta+z');expect(await page.evaluate(id=>window.scriptForge.getDocument().elements.find(e=>e.id===id).rightMarginOffsetPt,speech.id)).toBe(10);
 await page.keyboard.press('ControlOrMeta+Shift+z');expect(await loc.evaluate(el=>parseFloat(el.style.width))).toBe(width);
 // A reverse selection spans only the actual selected elements.
 const els=before.elements.filter(e=>['action','character','dialogue'].includes(e.type));await select(page,els[2].id,3,els[0].id,1);await page.keyboard.press('ControlOrMeta+[');
 const modified=await page.evaluate(()=>window.scriptForge.getDocument());expect(modified.elements.filter(e=>e.rightMarginOffsetPt).map(e=>e.id)).toEqual(els.slice(0,3).map(e=>e.id));
 const stored=await page.evaluate(async()=>{await window.scriptForgeBeforeClose();const {repository}=await import('/js/storage.js'),{backups}=await import('/js/backups.js');const doc=window.scriptForge.getDocument();await backups.capture(doc,'Manual Backup');return {recovery:(await repository.get(doc.id)).recovery.document,backup:(await backups.list(doc.id))[0].document};});
 expect(stored.recovery).toEqual(modified);expect(stored.backup).toEqual(modified);
 await page.addScriptTag({url:'/vendor/jspdf.umd.min.js'});
 const proof=await page.evaluate(async()=>{
  const doc=window.scriptForge.getDocument(),pages=window.scriptForge.getPages(),byId=new Map(doc.elements.map(e=>[e.id,e])),PDF=window.jspdf.jsPDF,writes=[];
  window.jspdf.jsPDF=function(options){const pdf=new PDF(options),text=pdf.text;pdf.text=function(t,x,y,options){const page=pdf.internal.getCurrentPageInfo().pageNumber;if(page>1&&y>60)writes.push({text:t,page:page-1,x,y});return text.call(pdf,t,x,y,options);};return pdf;};
  const expected=pages.flatMap((p,index)=>p.items.flatMap(i=>[...i.headers.flatMap(c=>c.map(l=>l.text)),...i.columns.flatMap(c=>c.map(l=>(l.displayText??byId.get(l.id).text.slice(l.start,l.end)).replace(/\n$/,''))),...i.more.filter(Boolean).map(()=>'(MORE)')].filter(Boolean).map(text=>({text,page:index+1}))));
  const pdf=await(await import('/js/pdf-export.js')).createScreenplayPDF(doc);window.marginProof=pdf.blob;return {expected,writes,pages:pdf.pages,editorPages:pages.length,safe:pages.every(p=>p.used<=864)};
 });
 expect(proof.writes.map(({text,page})=>({text,page}))).toEqual(proof.expected);expect(proof.pages).toBe(proof.editorPages+1);expect(proof.safe).toBe(true);
 const download=page.waitForEvent('download');await page.evaluate(()=>{const a=document.createElement('a');a.href=URL.createObjectURL(window.marginProof);a.download='Margins.pdf';a.click();});await(await download).saveAs('test-results/element-margins.pdf');
 await page.reload();await page.locator('#recover-changes').click();await expect(page.locator('#pages')).toHaveAttribute('contenteditable','true');expect((await page.evaluate(()=>window.scriptForge.getDocument())).elements.filter(e=>e.rightMarginOffsetPt).map(e=>e.id)).toEqual(els.slice(0,3).map(e=>e.id));
 await page.locator('[data-title-field=email]').focus();await page.keyboard.press('ControlOrMeta+[');expect((await page.evaluate(()=>window.scriptForge.getDocument())).elements.filter(e=>e.rightMarginOffsetPt).length).toBe(3);
});
test('Shift Return has ordinary line height, keeps one element, survives Fountain and removes with Backspace',async({page})=>{
 await seed(page);const doc=await page.evaluate(()=>window.scriptForge.getDocument()),action=doc.elements.find(e=>e.type==='action'),speech=doc.elements.find(e=>e.type==='dialogue');
 for(const el of [action,speech]){
  await select(page,el.id,3);const count=await page.evaluate(()=>window.scriptForge.getDocument().elements.length);
  await page.keyboard.press('Shift+Enter');
  let next=await page.evaluate(id=>window.scriptForge.getDocument().elements.find(e=>e.id===id),el.id);expect(next.text).toBe(el.text.slice(0,3)+'\n'+el.text.slice(3));expect(next.type).toBe(el.type);expect(await page.evaluate(()=>window.scriptForge.getDocument().elements.length)).toBe(count);
  const rows=await page.evaluate(id=>window.scriptForge.getPages().flatMap(p=>p.items.flatMap(i=>i.columns.flat())).filter(l=>l.id===id),el.id);expect(rows[0].end).toBe(4);
  const geometry=await page.locator(`[data-element-id="${el.id}"]`).first().evaluate(el=>{const n=el.firstChild,r=document.createRange();r.setStart(n,0);r.setEnd(n,1);const first=r.getBoundingClientRect().top;r.setStart(n,4);r.setEnd(n,5);return (r.getBoundingClientRect().top-first)/parseFloat(getComputedStyle(document.getElementById('pages')).zoom);});expect(geometry).toBeCloseTo(16,0);
  await page.keyboard.press('Backspace');expect(await page.evaluate(id=>window.scriptForge.getDocument().elements.find(e=>e.id===id).text,el.id)).toBe(el.text);
  await page.keyboard.press('ControlOrMeta+z');await page.keyboard.press('ControlOrMeta+[');expect(await page.evaluate(id=>window.scriptForge.getDocument().elements.find(e=>e.id===id).text,el.id)).toContain('\n');
 }
 const round=await page.evaluate(async()=>{const doc=window.scriptForge.getDocument(),source=await(await import('/js/session.js')).fountainForSaving(doc),parsed=(await import('/js/fountain.js')).parseFountain(source);return {before:doc.elements.filter(e=>['action','dialogue'].includes(e.type)).map(e=>e.text),after:parsed.elements.filter(e=>['action','dialogue'].includes(e.type)).map(e=>e.text),source};});expect(round.after).toEqual(round.before);expect(round.source).not.toMatch(/rightMarginOffsetPt|↵|¶/);
 await page.locator('#home').click();await page.locator('.card-title').click();await page.locator('#recover-changes').click();await expect(page.locator('#pages')).toHaveAttribute('contenteditable','true');expect((await page.evaluate(()=>window.scriptForge.getDocument())).elements.find(e=>e.id===action.id).text).toContain('\n');
});

test('only a chosen dialogue can be widened to fit the dinosaurs example',async({page})=>{
 await seed(page,'ANN\nIt is. Now come up here and protect me from a million billion dinosaurs!');
 const el=await page.evaluate(()=>window.scriptForge.getDocument().elements.find(e=>e.type==='dialogue'));
 const parts=()=>page.evaluate(id=>{const text=window.scriptForge.getDocument().elements.find(e=>e.id===id).text;return window.scriptForge.getPages().flatMap(p=>p.items.flatMap(i=>i.columns.flat())).filter(l=>l.id===id).map(l=>text.slice(l.start,l.end).trimEnd());},el.id);
 expect((await parts()).at(-1)).toBe('dinosaurs!');await select(page,el.id,7);
 for(let i=0;i<1;i++)await page.keyboard.press('ControlOrMeta+]');
 expect(await parts()).toEqual(['It is. Now come up here and protect','me from a million billion dinosaurs!']);
 await page.keyboard.press('ControlOrMeta+Backslash');expect((await parts()).at(-1)).toBe('dinosaurs!');
});
