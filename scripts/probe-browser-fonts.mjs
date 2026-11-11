// Copyright (C) 2026 wdk08. SPDX-License-Identifier: GPL-3.0-only
// Diagnostic only: compare renderer/font modes without changing application CSS.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
const server=spawn(process.execPath,['scripts/server.mjs'],{env:{...process.env,PORT:'4174'},stdio:['ignore','pipe','inherit']});
await Promise.race([once(server.stdout,'data'),once(server,'exit').then(()=>{throw new Error('Font probe server exited before startup');})]);
const results=[];
try{
for(const mode of [
 {name:'default shell'},
 {name:'full Chromium',channel:'chromium'},
 {name:'shell, fractional font metrics',args:['--font-render-hinting=none']},
 {name:'full Chromium, fractional font metrics',channel:'chromium',args:['--font-render-hinting=none']},
]){
 const {name,...options}=mode,browser=await chromium.launch({headless:true,...options});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  await page.addInitScript(()=>{window.scriptForgeLocalHelperDisabled=true;window.showDirectoryPicker=undefined;});
  await page.goto('http://localhost:4174/editor.html?sample=1');
  await page.waitForFunction(()=>{try{return window.scriptForge?.getDocument()&&document.getElementById('pages').contentEditable==='true';}catch{return false;}});
  const metrics=await page.evaluate(async()=>{
   const {createMeasurer}=await import('/js/pagination.js');
   const host=document.createElement('div');host.className='measurement';document.body.append(host);
   const measure=createMeasurer(host),parts=el=>measure(el).map(line=>el.text.slice(line.start,line.end).trimEnd());
   const action=parts({type:'action',text:'She finally gets to the top of the playground and looks down at Luke'});
   const widenedDialogue=parts({type:'dialogue',rightMarginOffsetPt:-5,text:'It is. Now come up here and protect me from a million billion dinosaurs!'});
   const span=document.createElement('span');span.style.cssText='position:fixed;visibility:hidden;font:16px "Courier Prime";white-space:pre;letter-spacing:0';span.textContent='M'.repeat(100);document.body.append(span);
   const advance=span.getBoundingClientRect().width/100;span.remove();host.remove();
   return {advance,intrinsicAdvance:16*1228/2048,action,widenedDialogue,fonts:[...document.fonts].map(f=>({family:f.family,status:f.status}))};
  });
  results.push({mode:name,version:browser.version(),...metrics});
 }finally{await browser.close();}
}
console.log(JSON.stringify(results,null,2));
}finally{server.kill();await once(server,'exit');}
