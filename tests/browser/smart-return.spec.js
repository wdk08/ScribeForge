import {test,expect} from '@playwright/test';
test.beforeEach(async({context})=>context.addInitScript(()=>{window.scriptForgeLocalHelperDisabled=true;window.showDirectoryPicker=undefined;}));
async function seed(page,elements){
 await page.goto('/');
 const id=await page.evaluate(async elements=>{
  const {createDocument,createElement}=await import('/js/document.js'),{draftRecord}=await import('/js/session.js'),{repository}=await import('/js/storage.js');
  const doc=createDocument({elements:elements.map(([type,text,attrs])=>createElement(type,text,attrs))});const record=draftRecord(doc);record.recovery.dirty=false;await repository.put(record);return record.id;
 },elements);
 await page.goto(`/editor.html?id=${id}`);await expect(page.locator('#pages')).toHaveAttribute('contenteditable','true');return id;
}
const doc=page=>page.evaluate(()=>window.scriptForge.getDocument());
async function select(page,id,offset,end=offset){await page.evaluate(async({id,offset,end})=>{
 const {restoreSelection}=await import('/js/selection.js');restoreSelection(document.getElementById('pages'),{anchor:{id,offset},focus:{id,offset:end}});
},{id,offset,end});}
async function caret(page){return page.evaluate(async()=>({model:window.scriptForge.getSelection(),dom:(await import('/js/selection.js')).readSelection(document.getElementById('pages'))}));}

for(const type of ['scene','action','character','dialogue','parenthetical','transition','centered','lyric','section','synopsis','note','boneyard'])test(`real Return splits ${type}, preserves cursor, supports typing and one undo/redo`,async({page})=>{
 const par=type==='parenthetical',text=par?'(whispering softly)':'Préfix🙂suffix — café!';
 await seed(page,[['character','NOAH'],[type,text,type==='section'?{depth:2}:{}],['action','Untouched neighbour.']]);
 const before=await doc(page),el=before.elements[1],at=par?11:text.indexOf('suffix');await select(page,el.id,at);
 await page.keyboard.press('Enter');const after=await doc(page),els=after.elements.filter(e=>e.type!=='whitespace'),added=els[2];
 expect(els[1].type).toBe(type);expect(els[1].id).toBe(el.id);
 expect(els[1].text).toBe(text.slice(0,at)+(par?')':''));expect(added.text).toBe(text.slice(at,par?-1:undefined));
 expect(els[3]).toEqual(before.elements[2]);expect(added.type).toBe('action');
 const expected={anchor:{id:added.id,offset:0},focus:{id:added.id,offset:0}};
 expect(await caret(page)).toEqual({model:expected,dom:expected});
 await page.keyboard.press('ControlOrMeta+z');expect(await doc(page)).toEqual(before);
 await page.keyboard.press('ControlOrMeta+Shift+z');expect(await doc(page)).toEqual(after);
 expect(await caret(page)).toEqual({model:expected,dom:expected});
 await page.keyboard.type('X');expect((await doc(page)).elements.find(e=>e.id===added.id).text).toBe('X'+added.text);
});

test('scene to SOPHIA, selection replacement and soft breaks use the real keyboard without casing changes',async({page})=>{
 const prefix="INT. LUKE'S ROOM - NIGHT";
 await seed(page,[['scene',prefix+'SOPHIA']]);let before=await doc(page);await select(page,before.elements[0].id,prefix.length);await page.keyboard.press('Enter');
 let elements=(await doc(page)).elements.filter(e=>e.type!=='whitespace');expect(elements.map(e=>[e.type,e.text])).toEqual([['scene',prefix],['character','SOPHIA']]);
 await page.keyboard.press('ControlOrMeta+z');await select(page,before.elements[0].id,4,8);await page.keyboard.press('Enter');
 elements=(await doc(page)).elements.filter(e=>e.type!=='whitespace');expect(elements.map(e=>e.text)).toEqual([prefix.slice(0,4),(prefix+'SOPHIA').slice(8)]);
 await page.keyboard.press('ControlOrMeta+z');await select(page,before.elements[0].id,prefix.length);await page.keyboard.press('Shift+Enter');
 expect((await doc(page)).elements[0].text).toBe(prefix+'\nSOPHIA');expect((await doc(page)).elements.length).toBe(1);
});

test('split near a dialogue page boundary repaginates, retains continuations and survives recovery/PDF/Fountain',async({page})=>{
 const speech='A long speech with ordinary words. '.repeat(210);
 const id=await seed(page,[['scene','INT. ROOM - DAY'],['character','NOAH'],['dialogue',speech],['action','A beat.'],['character','NOAH'],['dialogue','Still here.']]);
 const before=await doc(page),el=before.elements[2];
 expect(await page.evaluate(()=>window.scriptForge.getPages().some(p=>p.items.some(i=>i.more.some(Boolean))))).toBe(true);
 const at=await page.evaluate(id=>window.scriptForge.getPages()[0].items.flatMap(i=>i.columns.flat()).filter(l=>l.id===id).at(-1).end,el.id);
 expect(at).toBeGreaterThan(0);expect(at).toBeLessThan(speech.length);await select(page,el.id,at);await page.keyboard.press('Enter');
 const after=await doc(page),els=after.elements.filter(e=>e.type!=='whitespace');expect(els[2].type).toBe('dialogue');expect(els[3].type).toBe('action');expect(els[2].text+els[3].text).toBe(speech);
 expect(await page.evaluate(()=>window.scriptForge.getPages().every(p=>p.used<=864))).toBe(true);
 await page.evaluate(()=>window.scriptForgeBeforeClose());
 const saved=await page.evaluate(async id=>(await(await import('/js/storage.js')).repository.get(id)).recovery,id);
 expect(saved.document).toEqual(after);expect(saved.selection.focus).toEqual({id:els[3].id,offset:0});
 await page.addScriptTag({url:'/vendor/jspdf.umd.min.js'});
 const proof=await page.evaluate(async()=>{
  const doc=window.scriptForge.getDocument(),pages=window.scriptForge.getPages();
  const {createScreenplayPDF}=await import('/js/pdf-export.js');const pdf=await createScreenplayPDF(doc);
  const {fountainForSaving}=await import('/js/session.js'),{parseFountain}=await import('/js/fountain.js');
  const parsed=parseFountain(fountainForSaving(doc));
  return {pdfPages:pdf.pages,editorPages:pages.length,hasMore:pages.some(p=>p.items.some(i=>i.more.some(Boolean))),hasContinued:pages.some(p=>p.items.some(i=>[...i.headers.flat(),...i.columns.flat()].some(l=>(l.displayText??l.text??'').includes("CONT'D")))),roundText:parsed.elements.filter(e=>!['whitespace','titleField'].includes(e.type)).map(e=>e.text)};
 });
 expect(proof.pdfPages).toBe(proof.editorPages+1);expect(proof.hasContinued).toBe(true);
 // Existing export renders continuation markers, so compare the actual speech halves.
 expect(proof.roundText).toContain(els[2].text);expect(proof.roundText).toContain(els[3].text);
 await page.reload();await page.locator('#recover-changes').click();await expect(page.locator('#pages')).toHaveAttribute('contenteditable','true');expect(await doc(page)).toEqual(after);
 expect((await caret(page)).dom.focus).toEqual({id:els[3].id,offset:0});
});

test('export warns explicitly for orphan speech and leaves the live document unchanged',async({page})=>{
 await seed(page,[['character','NOAH'],['parenthetical','(whispering softly)'],['dialogue','Stay here.']]);
 const before=await doc(page),el=before.elements[1];await select(page,el.id,11);await page.keyboard.press('Enter');const after=await doc(page);
 await page.locator('.export-menu summary').click();const download=page.waitForEvent('download');await page.locator('#export-fountain').click();await download;
 await expect(page.locator('#notice')).toContainText('Fountain-only round trip');expect(await doc(page)).toEqual(after);
});
