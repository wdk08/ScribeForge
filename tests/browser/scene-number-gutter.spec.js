import {test,expect} from '@playwright/test';
test.beforeEach(async({context})=>{await context.addInitScript(()=>{window.scriptForgeLocalHelperDisabled=true;window.showDirectoryPicker=undefined;});});
test('scene-number gutters stay horizontal, outside writing columns and inside pages across margins, themes and sizes',async({page})=>{
 await page.goto('/');
 const id=await page.evaluate(async()=>{
  const {createDocument,createElement}=await import('/js/document.js'),{draftRecord}=await import('/js/session.js'),{repository}=await import('/js/storage.js');
  const doc=createDocument({elements:['1','12','125','1025'].flatMap((number,i)=>[createElement('scene',i===3?'INT. '+('A VERY LONG CALLAHAN HOUSE LOCATION WITH WINDOWS AND STAIRS '.repeat(3))+'- NIGHT':'INT. CALLAHAN HOUSE - NIGHT',{sceneNumber:number}),createElement('action','The room is quiet.')])});
  doc.settings={sceneNumbers:true};const r=draftRecord(doc);r.recovery.dirty=false;await repository.put(r);return r.id;
 });
 await page.goto(`/editor.html?id=${id}`);await expect(page.locator('#pages')).toHaveAttribute('contenteditable','true');
 const measurements=async()=>{
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  // Query and measure atomically: resize repagination can detach locator snapshots.
  return page.evaluate(()=>[...document.querySelectorAll('#pages [data-scene-number]')].map(el=>{
  const p=el.closest('.screenplay-page'),r=el.getBoundingClientRect(),pr=p.getBoundingClientRect(),zoom=pr.width/p.offsetWidth;
  const a=getComputedStyle(el,'::after'),b=getComputedStyle(el,'::before'),c=getComputedStyle(el);
  return {number:el.dataset.sceneNumber,height:parseFloat(a.height),lineHeight:parseFloat(a.lineHeight),width:parseFloat(a.width),left:(r.left-pr.left)/zoom+parseFloat(a.left),textRight:(r.left-pr.left)/zoom+parseFloat(a.left)+parseFloat(a.width),headingLeft:(r.left-pr.left)/zoom,headingRight:(r.left-pr.left+r.width)/zoom,headingHeight:parseFloat(c.height),align:a.textAlign,wrap:a.whiteSpace,leftNumber:(r.left-pr.left)/zoom+parseFloat(b.left),pageWidth:pr.width/zoom};
 }));};
 const baseline=await measurements();
 console.log('Scene-number measurements',JSON.stringify(baseline));
 for(const m of baseline){expect(m.height).toBeCloseTo(m.lineHeight,1);expect(m.wrap).toBe('nowrap');expect(m.align).toBe('right');expect(m.width).toBeGreaterThanOrEqual(4*9);expect(m.left).toBeGreaterThanOrEqual(m.headingRight-.1);expect(m.pageWidth-m.textRight).toBeCloseTo(m.leftNumber,2);expect(m.leftNumber).toBeCloseTo(72,2);}
 expect(baseline.at(-1).headingHeight).toBeGreaterThan(16);
 await page.locator('[data-type="scene"]').first().click();
 for(const theme of ['light','dark']){await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await page.screenshot({path:`test-results/scene-number-gutter-${theme}.png`});}
 for(const width of [1440,900,620]){
  await page.setViewportSize({width,height:1000});
  for(const theme of ['light','dark']){
   await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
   const scene=page.locator('[data-type="scene"]').last();await scene.click();
   const activeBefore=await scene.evaluate(el=>({width:parseFloat(el.style.width),left:getComputedStyle(el).marginLeft}));
   await page.keyboard.press('ControlOrMeta+[');
   await expect(scene).toHaveClass(/active-writing-area/);
   expect(await scene.evaluate(el=>parseFloat(el.style.width))).toBeCloseTo(activeBefore.width-20/3,3);
   const next=await measurements();next.forEach((m,i)=>{expect(m.left).toBeCloseTo(baseline[i].left,1);expect(m.leftNumber).toBeCloseTo(baseline[i].leftNumber,1);expect(m.headingLeft).toBeCloseTo(baseline[i].headingLeft,1);});
   for(const m of next){expect(m.height).toBeCloseTo(m.lineHeight,1);expect(m.pageWidth-m.textRight).toBeCloseTo(m.leftNumber,1);expect(m.left).toBeGreaterThanOrEqual(m.headingRight-.1);}
   await page.keyboard.press('ControlOrMeta+]');await page.keyboard.press('ControlOrMeta+Backslash');
  }
 }
 await page.setViewportSize({width:1440,height:1000});
 await page.addScriptTag({url:'/vendor/jspdf.umd.min.js'});
 const pdf=await page.evaluate(async()=>{
  const Base=window.jspdf.jsPDF,writes=[];window.jspdf.jsPDF=function(o){const p=new Base(o),text=p.text;p.text=function(value,x,y,options){writes.push({value,x,y,align:options?.align??'left',width:p.getTextWidth(value)});return text.call(p,value,x,y,options);};return p;};
  const doc=window.scriptForge.getDocument();doc.elements.filter(e=>e.type==='scene').forEach((e,i)=>e.sceneNumber=['1','12','125','1025'][i]);
  await(await import('/js/pdf-export.js')).createScreenplayPDF(doc);return writes.filter(w=>['1','12','125','1025'].includes(w.value));
 });
 for(const number of ['1','12','125','1025']){
  const pair=pdf.filter(w=>w.value===number);expect(pair).toHaveLength(2);expect(pair[0].x).toBe(54);expect(pair[1].align).toBe('right');expect(pair[1].x-pair[1].width).toBeGreaterThanOrEqual(522);expect(612-pair[1].x).toBe(pair[0].x);
 }
 await page.locator('#screenplay-settings').click();await page.locator('#scene-numbers').uncheck();await page.locator('#settings-done').click();await expect(page.locator('[data-scene-number]')).toHaveCount(0);
 expect(await page.locator('[data-type="scene"]').last().evaluate(el=>parseFloat(el.style.width))).toBe(576);
 await page.locator('#screenplay-settings').click();await page.locator('#scene-numbers').check();await page.locator('#settings-done').click();
 expect(await page.locator('[data-type="scene"]').last().evaluate(el=>parseFloat(el.style.width))).toBe(552);
});
