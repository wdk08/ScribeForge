import { test, expect } from '@playwright/test';
test.beforeEach(async ({ context }) => { await context.addInitScript(() => { window.scriptForgeLocalHelperDisabled = true; window.showDirectoryPicker = undefined; }); });
test('measured word wrapping preserves Unicode, whitespace, explicit breaks and column boundaries', async ({ page }) => {
  await page.goto('/editor.html?sample=1'); await expect(page.locator('#pages')).toHaveAttribute('contenteditable','true');
  const result = await page.evaluate(async () => {
    const {createMeasurer} = await import('/js/pagination.js'); const {elementColumn,textRangeRect} = await import('/js/screenplay-format.js');
    const host=document.getElementById('measurement'),measure=createMeasurer(host);
    const samples=[['dialogue','Or... You be a dinosaur and I be a princess'],['action','She finally gets to the top of the playground and looks down at Luke'],
      ['dialogue',"Apostrophes aren't lost; hyphenated-word punctuation stays. ".repeat(4)],['action','Café — naïve résumé. '.repeat(8)],
      ['action','a'.repeat(180)],['dialogue','First line.\nSecond line.\n'],['action','👩🏽‍💻e\u0301'.repeat(80)],['action','  Spaces   remain intact.  '.repeat(8)]];
    const records=samples.map(([type,text])=>{
      const lines=measure({type,text}),node=host.firstChild.firstChild,range=document.createRange();
      const sameRow=lines.every(line=>{
        let top=null;
        for(let at=line.start;at<line.end;at++){
          if(text[at]==='\n')continue;range.setStart(node,at);range.setEnd(node,at+1);const rect=textRangeRect(range);
          if(top==null)top=rect.top;else if(Math.abs(rect.top-top)>1)return false;
        }return true;
      });
      return {text,parts:lines.map(l=>text.slice(l.start,l.end)),sameRow};
    });
    const columns=['scene','action','character','dialogue','parenthetical','transition'].map(type=>{
      measure({type,text:type==='parenthetical'?'(quietly)':'A sample'});const p=host.firstChild;
      return {type,expected:elementColumn(type),width:p.getBoundingClientRect().width,offset:parseFloat(getComputedStyle(p).marginLeft),font:getComputedStyle(p).fontFamily};
    });
    return {records,columns,loaded:[...document.fonts].filter(f=>f.family==='Courier Prime').every(f=>f.status==='loaded')};
  });
  expect(result.loaded).toBe(true);
  expect(result.records[0].parts).toEqual(['Or... You be a dinosaur and I be a ','princess']);
  expect(result.records[1].parts).toEqual(['She finally gets to the top of the playground and looks down ','at Luke']);
  for(const r of result.records){expect(r.parts.join('')).toBe(r.text);expect(r.sameRow).toBe(true);}
  expect(result.records[5].parts).toEqual(['First line.\n','Second line.\n','']);
  for(const c of result.columns){expect(c.width).toBeCloseTo(c.expected.width,1);expect(c.offset).toBeCloseTo(c.expected.offset,1);expect(c.font).toContain('Courier Prime');}
});
test('editor and PDF share every measured line and page in a long screenplay', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('#empty-state')).toBeVisible();
  const id=await page.evaluate(async()=>{
    const {parseFountain}=await import('/js/fountain.js'),{draftRecord}=await import('/js/session.js'),{repository}=await import('/js/storage.js');
    const source=Array.from({length:35},(_,i)=>`INT. ROOM ${i} - DAY\n\n${'A longer action with ordinary words, café and punctuation. '.repeat(6)}\n\nANN\n(quietly, but with great conviction)\n${"I won't let ordinary words split in the middle. ".repeat(12)}\n\nBOB\nYes.\n\nCUT TO:\n\n`).join('');
    const r=draftRecord(parseFountain(source));r.recovery.dirty=false;await repository.put(r);return r.id;
  });
  await page.goto(`/editor.html?id=${id}`); await expect(page.locator('#pages')).toHaveAttribute('contenteditable','true');
  await page.addScriptTag({url:'/vendor/jspdf.umd.min.js'});
  const result=await page.evaluate(async()=>{
    const doc=window.scriptForge.getDocument(),snapshot=JSON.stringify(doc),pages=window.scriptForge.getPages(),PDF=window.jspdf.jsPDF,writes=[];
    window.jspdf.jsPDF=function(options){const pdf=new PDF(options),original=pdf.text;pdf.text=function(text,x,y,options){if(pdf.internal.getCurrentPageInfo().pageNumber>1&&y>60)writes.push({text,page:pdf.internal.getCurrentPageInfo().pageNumber-1,x,y});return original.call(pdf,text,x,y,options);};return pdf;};
    const pdf=await(await import('/js/pdf-export.js')).createScreenplayPDF(doc),byId=new Map(doc.elements.map(e=>[e.id,e]));
    const expected=pages.flatMap((page,index)=>page.items.flatMap(item=>[
      ...(item.continued?item.speakers.map((text,col)=>item.columns[col].length?{continuation:true}:null).filter(Boolean):[]),
      ...item.columns.flatMap(col=>col.map(l=>({text:(l.displayText??byId.get(l.id).text.slice(l.start,l.end)).replace(/\n$/,''),page:index+1,type:l.type})))
    ])).filter(l=>l.continuation||l.text);
    return {pages:pages.length,pdfPages:pdf.pages,writes,expected,unchanged:snapshot===JSON.stringify(window.scriptForge.getDocument()),safe:pages.every(p=>p.used<=864)};
  });
  expect(result.unchanged&&result.safe).toBe(true);expect(result.pages).toBeGreaterThan(20);expect(result.pdfPages).toBe(result.pages+1);
  const expected=result.expected.filter(l=>!l.continuation).map(({text,page})=>({text,page}));
  const body=result.writes.filter(l=>l.text!=='(MORE)'&&(!l.text.includes("(CONT'D)")||expected.some(e=>e.text===l.text)));
  expect(body.map(({text,page})=>({text,page}))).toEqual(expected);
  for(const w of body){expect(w.x).toBeGreaterThanOrEqual(54);expect(w.x).toBeLessThanOrEqual(540);expect(w.y).toBeLessThan(728);}
});
test('font failures stop initial pagination with a clear recoverable error',async({page})=>{
  await page.route('**/assets/fonts/*.ttf',route=>route.abort());await page.goto('/editor.html?sample=1');
  await expect(page.locator('.startup-error')).toBeVisible();await expect(page.locator('.startup-error')).toContainText(/font|load/i);
  await expect(page.locator('#pages')).not.toHaveAttribute('contenteditable','true');await expect(page.locator('.startup-error a')).toHaveAttribute('href','./index.html');
});
