import {test,expect} from '@playwright/test';
test.beforeEach(async({context})=>{await context.addInitScript(()=>{window.scriptForgeLocalHelperDisabled=true;window.showDirectoryPicker=undefined;});});
async function seed(page,first){await page.goto('/');const doc=await page.evaluate(async first=>{
 const {createDocument,createElement:e}=await import('/js/document.js'),{draftRecord}=await import('/js/session.js'),{repository}=await import('/js/storage.js');
 const doc=createDocument({elements:[e('action',Array(40).fill('A short action line.').join('\n')),e('character','ANN'),...(first==='parenthetical'?[e('parenthetical','(quietly)')]:[]),e('dialogue',Array(18).fill('A line of dialogue.').join('\n')),e('action','She waits.')]});const r=draftRecord(doc);r.recovery.dirty=false;await repository.put(r);return doc;
},first);await page.goto(`/editor.html?id=${doc.id}`);await expect(page.locator('#pages')).toHaveAttribute('contenteditable','true');return doc;}
async function select(page,a,start,b=a,end=start){await page.evaluate(async({a,start,b,end})=>{(await import('/js/selection.js')).restoreSelection(document.getElementById('pages'),{anchor:{id:a,offset:start},focus:{id:b,offset:end}},{scroll:true});},{a,start,b,end});}
for(const first of ['character','parenthetical'])for(const key of ['Backspace','Delete'])test(`${key} from ${first} into page-spanning speech immediately closes the gap and remains stable`,async({page})=>{
 const original=await seed(page,first),start=original.elements.find(e=>e.type===first),speech=original.elements.find(e=>e.type==='dialogue');
 for(let n=0;n<3;n++){
  await select(page,start.id,0,speech.id,20);await page.keyboard.press(key);await expect(page.locator(`[data-element-id="${start.id}"]`)).toHaveCount(0);
  const state=await page.evaluate(()=>({doc:window.scriptForge.getDocument(),pages:window.scriptForge.getPages(),selection:window.scriptForge.getSelection()}));
  expect(state.doc.elements.find(e=>e.id===speech.id)?.type).toBe('dialogue');expect(state.doc.elements.find(e=>e.id===speech.id).text).toBe(speech.text.slice(20));expect(state.doc.elements.some(e=>e.id===start.id)).toBe(false);expect(state.pages[0].used).toBe(864);expect(state.pages.every(p=>p.used<=864)).toBe(true);expect(state.selection.focus).toEqual({id:speech.id,offset:0});
  const fresh=await page.evaluate(async()=>{const {createMeasurer,layoutUnits,paginate}=await import('/js/pagination.js');const host=document.createElement('div');host.className='measurement';document.body.append(host);const doc=window.scriptForge.getDocument(),m=createMeasurer(host),result=Array.from({length:3},()=>paginate(layoutUnits(doc,m)));host.remove();return result;});for(const pages of fresh)expect(pages).toEqual(state.pages);
  await page.keyboard.press('ControlOrMeta+z');expect(await page.evaluate(()=>window.scriptForge.getDocument())).toEqual(original);
  await page.keyboard.press('ControlOrMeta+Shift+z');expect(await page.evaluate(()=>window.scriptForge.getPages())).toEqual(state.pages);await page.keyboard.press('ControlOrMeta+z');
 }
 await select(page,speech.id,20);await page.keyboard.press('Delete');await page.keyboard.press('Backspace');await page.keyboard.press('ControlOrMeta+z');await page.keyboard.press('ControlOrMeta+z');expect(await page.evaluate(()=>window.scriptForge.getDocument())).toEqual(original);
 const before=await page.evaluate(()=>window.scriptForge.getPages());await page.keyboard.press('ArrowDown');await page.keyboard.press('ArrowUp');expect(await page.evaluate(()=>window.scriptForge.getPages())).toEqual(before);
});

test('unchanged pages keep their DOM identity while the edited page and derived markers update',async({page})=>{
 await seed(page,'parenthetical');const doc=await page.evaluate(()=>window.scriptForge.getDocument()),action=doc.elements.find(e=>e.type==='action');
 await page.evaluate(()=>{window.stableLastPage=document.getElementById('pages').lastElementChild;window.stableTitleHeight=document.querySelector('[data-title-field=title]').style.height;});
 await select(page,action.id,3);await page.keyboard.type('abcdefgh');
 expect(await page.evaluate(()=>document.getElementById('pages').lastElementChild===window.stableLastPage)).toBe(true);
 expect(await page.evaluate(()=>document.querySelector('[data-title-field=title]').style.height)).toBe(await page.evaluate(()=>window.stableTitleHeight));
 await page.keyboard.press('Shift+Enter');expect((await page.evaluate(()=>window.scriptForge.getDocument())).elements[0].text).toContain('\n');
 await page.keyboard.press('ControlOrMeta+z');await page.keyboard.press('ControlOrMeta+z');expect(await page.evaluate(()=>window.scriptForge.getDocument())).toEqual(doc);
});

for(const key of ['Backspace','Delete'])test(`${key} across a dialogue page break removes obsolete markers immediately and can delete a whole cue block`,async({page})=>{
 const original=await seed(page,'parenthetical'),speech=original.elements.find(e=>e.type==='dialogue'),cue=original.elements.find(e=>e.type==='character');
 const originalPages=await page.evaluate(()=>window.scriptForge.getPages());expect(originalPages.length).toBe(2);await expect(page.locator('.page-more')).toHaveCount(1);
 for(let n=0;n<3;n++){
  await select(page,speech.id,30,speech.id,300);await page.keyboard.press(key);
  await expect.poll(()=>page.evaluate(id=>window.scriptForge.getDocument().elements.find(e=>e.id===id).text,speech.id)).toBe(speech.text.slice(0,30)+speech.text.slice(300));
  expect((await page.evaluate(()=>window.scriptForge.getPages())).length).toBe(1);await expect(page.locator('.page-more,.page-continuation')).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+z');expect(await page.evaluate(()=>window.scriptForge.getPages())).toEqual(originalPages);
  await page.keyboard.press('ControlOrMeta+Shift+z');expect((await page.evaluate(()=>window.scriptForge.getPages())).length).toBe(1);await page.keyboard.press('ControlOrMeta+z');
 }
 const last=original.elements.at(-1);await select(page,cue.id,0,last.id,0);await page.keyboard.press(key);await expect(page.locator(`[data-element-id="${cue.id}"]`)).toHaveCount(0);
 const after=await page.evaluate(()=>window.scriptForge.getDocument());expect(after.elements.map(e=>[e.id,e.type,e.text])).toEqual([original.elements[0],last].map(e=>[e.id,e.type,e.text]));
 await expect(page.locator('.page-more,.page-continuation')).toHaveCount(0);await page.keyboard.press('ControlOrMeta+z');expect(await page.evaluate(()=>window.scriptForge.getDocument())).toEqual(original);
});

test('cancelled native composition restores model text while retaining other page DOM',async({page})=>{
 const doc=await seed(page,'parenthetical'),action=doc.elements[0];await select(page,action.id,3);
 await page.evaluate(()=>{
  const root=document.getElementById('pages');window.compositionLastPage=root.lastElementChild;
  root.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));root.querySelector('.active-writing-area').textContent='Uncommitted browser composition';root.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:''}));
 });
 expect(await page.evaluate(()=>window.scriptForge.getDocument())).toEqual(doc);await expect(page.locator(`[data-element-id="${action.id}"]`).first()).toHaveText(action.text);
 expect(await page.evaluate(()=>document.getElementById('pages').lastElementChild===window.compositionLastPage)).toBe(true);
});
