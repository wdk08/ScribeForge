// Isolated native editor diagnostics, enabled only by the desktop stress runner.
(async()=>{
 const invoke=window.__TAURI__.core.invoke;
 const state=JSON.parse(sessionStorage.getItem('editor-proof')||'{"stage":"deletion","target":0,"checks":[],"profiles":[]}');
 const save=()=>sessionStorage.setItem('editor-proof',JSON.stringify(state));
 const assert=(condition,message)=>{if(!condition)throw new Error(message);state.checks.push(message);};
 const wait=async check=>{const end=Date.now()+45000;while(true){try{if(check())return;}catch{}if(Date.now()>end)throw new Error(`Native editor proof timed out: ${state.step}`);await new Promise(r=>setTimeout(r,25));}};
 try{
  const info=await invoke('desktop_diagnostics');const {repository}=await import('/js/storage.js'),{draftRecord}=await import('/js/session.js');
  if(!location.pathname.endsWith('editor.html')){
   const {createDocument,createElement:e}=await import('/js/document.js');
   const doc=createDocument({elements:[e('action',Array(40).fill('A short action line.').join('\n')),e('character','ANN'),e('parenthetical','(quietly)'),e('dialogue',Array(18).fill('A line of dialogue.').join('\n')),e('action','She waits.')]});
   const r=draftRecord(doc);r.recovery.dirty=false;await repository.put(r);state.original=doc;save();location.href=`editor.html?id=${doc.id}`;return;
  }
  state.step='loading editor';
  await wait(()=>window.scriptForge?.getDocument()&&document.getElementById('pages').contentEditable==='true');
  const {restoreSelection}=await import('/js/selection.js'),root=document.getElementById('pages');
  const select=(a,start,b=a,end=start)=>restoreSelection(root,{anchor:{id:a,offset:start},focus:{id:b,offset:end}},{scroll:true});
  const key=(key,extra={})=>root.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true,...extra}));
  if(state.stage==='deletion'){
   const doc=state.original,first=doc.elements.find(e=>e.type==='parenthetical'),speech=doc.elements.find(e=>e.type==='dialogue');select(first.id,0,speech.id,20);
   if(info.manualKeyboard){const notice=document.getElementById('notice');notice.hidden=false;notice.textContent='Native deletion proof: Backspace';}
   else root.dispatchEvent(new InputEvent('beforeinput',{inputType:'deleteContentBackward',bubbles:true,cancelable:true}));
   state.step='deleting selected parenthetical';
   await wait(()=>!window.scriptForge.getDocument().elements.some(e=>e.id===first.id));
   const result=window.scriptForge.getDocument(),pages=window.scriptForge.getPages();
   assert(result.elements.find(e=>e.id===speech.id)?.text===speech.text.slice(20),'first deletion retains surviving Dialogue identity and text');
   assert(pages[0].used===864&&pages.every(p=>p.used<=864),'first deletion fills the current page without overflow');
   assert(root.querySelector('.page-more')&&root.querySelector('.page-continuation'),'native MORE and CONT D remain present at real dialogue splits');
   const {createMeasurer,layoutUnits,paginate}=await import('/js/pagination.js'),host=document.createElement('div');host.className='measurement';document.body.append(host);const m=createMeasurer(host);
   for(let i=0;i<5;i++)assert(JSON.stringify(paginate(layoutUnits(result,m)))===JSON.stringify(pages),'unchanged native pagination is deterministic');host.remove();
   key('z',{metaKey:true});assert(JSON.stringify(window.scriptForge.getDocument())===JSON.stringify(doc),'native undo restores the full original screenplay');key('z',{metaKey:true,shiftKey:true});assert(JSON.stringify(window.scriptForge.getPages())===JSON.stringify(pages),'native redo restores identical pagination');
   state.stage='profile';document.getElementById('notice').hidden=true;
  }else{
   const doc=window.scriptForge.getDocument(),els=doc.elements.filter(e=>e.type==='action'),el=els[Math.floor(els.length/2)];select(el.id,3);await new Promise(r=>requestAnimationFrame(r));
   let created=0;const observer=new MutationObserver(list=>{for(const record of list)for(const node of record.addedNodes)if(node.nodeType===1)created+=1+node.querySelectorAll('*').length;});observer.observe(root,{childList:true,subtree:true});
   const samples=[];for(const ch of 'writingflow'){const t=performance.now();root.dispatchEvent(new InputEvent('beforeinput',{inputType:'insertText',data:ch,bubbles:true,cancelable:true}));const blocking=performance.now()-t;const frame=await new Promise(r=>requestAnimationFrame(()=>r(performance.now()-t)));samples.push({blockingMs:blocking,firstFrameMs:frame});}
   observer.disconnect();assert(window.scriptForge.getDocument().elements.find(e=>e.id===el.id).text===el.text.slice(0,3)+'writingflow'+el.text.slice(3),'native long-script typing retains every character');
   assert(window.scriptForge.getSelection().focus.offset===14,'native long-script typing retains the model caret');
   state.profiles.push({target:[10,50,100,150][state.target],pages:window.scriptForge.getPages().length,createdDOMElements:created,samples});state.target++;
  }
  if(state.target>=4){await window.scriptForgeBeforeClose();await invoke('desktop_diagnostics_report',{report:{success:true,checks:state.checks,profiles:state.profiles,manualDeletion:info.manualKeyboard===true}});return;}
  await window.scriptForgeBeforeClose();
  const stored=await repository.get(window.scriptForge.getDocument().id);
  assert(JSON.stringify(stored.recovery.document)===JSON.stringify(window.scriptForge.getDocument()),'native recovery preserves the full edited model before navigation');
  const doc=window.scriptForgeProfileFixtures[state.target],r=draftRecord(doc);r.recovery.dirty=false;await repository.put(r);save();location.href=`editor.html?id=${doc.id}`;
 }catch(error){await invoke('desktop_diagnostics_report',{report:{success:false,error:String(error),stack:error?.stack,screen:document.body.innerText.slice(0,2500),...state}});}
})();
