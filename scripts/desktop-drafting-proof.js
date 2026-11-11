// Runs only through the explicit isolated native stress harness.
(async()=>{
 const invoke=window.__TAURI__.core.invoke,state=JSON.parse(sessionStorage.getItem('drafting-proof')||'{"stage":0,"checks":[]}');
 const assert=(ok,message)=>{if(!ok)throw new Error(message);state.checks.push(message);};
 const wait=async fn=>{const end=Date.now()+45000;while(true){try{if(await fn())return;}catch{}if(Date.now()>end)throw new Error('Drafting proof timed out');await new Promise(r=>setTimeout(r,25));}};
 try{
  const info=await invoke('desktop_diagnostics'),{repository}=await import('/js/storage.js'),{fileService:files}=await import('/js/files.js'),{draftRecord}=await import('/js/session.js'),{createDocument,createElement:e}=await import('/js/document.js');
  const open=async elements=>{const doc=createDocument({title:`Native drafting ${state.stage}`,elements}),record=draftRecord(doc);record.recovery.dirty=false;await repository.put(record);state.original=doc;sessionStorage.setItem('drafting-proof',JSON.stringify(state));location.href=`editor.html?id=${doc.id}`;};
  if(!location.pathname.endsWith('editor.html')){await repository.setPreference('screenplayFolder',files.restoreHandle(info.directory));await open([e('action',Array(8).fill('A short action line.').join('\n')),e('action','')]);return;}
  await wait(()=>window.scriptForge?.getDocument()&&document.getElementById('pages').contentEditable==='true');
  await wait(()=>Boolean(window.scriptForge.getFileState().fileName));const initialFileName=window.scriptForge.getFileState().fileName;
  const root=document.getElementById('pages'),{restoreSelection}=await import('/js/selection.js');
  const select=(id,offset)=>restoreSelection(root,{anchor:{id,offset},focus:{id,offset}},{scroll:true});
  const key=(key,options={})=>root.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true,...options}));
  const type=text=>root.dispatchEvent(new InputEvent('beforeinput',{inputType:'insertText',data:text,bubbles:true,cancelable:true}));
  const original=state.original;
  if(state.stage===0){
   select(original.elements[1].id,0);
   for(const step of [()=>key('Tab'),()=>type('luke'),()=>key('Enter'),()=>key('Tab'),()=>type('whispering'),()=>key('Enter'),()=>type('Hello.')]){step();assert(window.scriptForge.getPages().length===1,'native unfinished cue/parenthetical sequence stays mid-page');}
   await wait(async()=>{const r=await repository.get(original.id);return r.handle&&(await files.read(r.handle)).source.includes('Hello.');});await window.scriptForgeBeforeClose();const record=await repository.get(original.id);assert(JSON.stringify(record.recovery.document)===JSON.stringify(window.scriptForge.getDocument()),'native dialogue drafting saves full recovery');assert((await files.read(record.handle)).source.includes('Hello.'),'native dialogue drafting saves to its managed Fountain file');
   state.stage=1;const action=e('action','Luke walks into the bedroom and closes the door behind him.');action.rightMarginOffsetPt=15;await open([action]);return;
  }
  const action=original.elements[0],offset=action.text.indexOf('and');select(action.id,offset);key('Enter');
  const split=window.scriptForge.getDocument(),parts=split.elements.filter(e=>e.type==='action');
  assert(parts.length===2&&parts[0].text===action.text.slice(0,offset)&&parts[1].text===action.text.slice(offset),'native Return splits Action exactly without trimming or duplication');
  assert(parts[0].id===action.id&&parts[1].rightMarginOffsetPt===15&&window.scriptForge.getSelection().focus.id===parts[1].id,'native split preserves identity, custom margin and caret');
  key('z',{metaKey:true});assert(JSON.stringify(window.scriptForge.getDocument())===JSON.stringify(original),'native split undo restores original');key('z',{metaKey:true,shiftKey:true});assert(JSON.stringify(window.scriptForge.getDocument())===JSON.stringify(split),'native split redo restores independent elements');
  select(parts[1].id,3);key('Enter',{shiftKey:true});assert(window.scriptForge.getDocument().elements.filter(e=>e.type==='action').length===2,'native Shift Return stays within Action');key('z',{metaKey:true});
  await wait(async()=>{const r=await repository.get(original.id);return r.handle&&(await import('/js/fountain.js')).parseFountain((await files.read(r.handle)).source).elements.filter(e=>e.type==='action').length===2;});await window.scriptForgeBeforeClose();const record=await repository.get(original.id),disk=await files.read(record.handle),{parseFountain}=await import('/js/fountain.js');
  assert(record.fileName===initialFileName,'native split autosave keeps the original filename');
  assert(JSON.stringify(parseFountain(disk.source).elements.filter(e=>e.type==='action').map(e=>e.text))===JSON.stringify(parts.map(e=>e.text)),'native autosave writes two independent Action paragraphs to the same Fountain file');assert(JSON.stringify(record.recovery.document)===JSON.stringify(split),'native recovery retains split IDs and margins');
  await invoke('desktop_diagnostics_report',{report:{success:true,checks:state.checks}});
 }catch(error){await invoke('desktop_diagnostics_report',{report:{success:false,error:String(error),stack:error.stack,screen:document.body.innerText.slice(0,1800),...state}});}
})();
