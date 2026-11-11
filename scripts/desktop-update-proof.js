// Explicit isolated native test only. Never downloads or installs an update.
(async()=>{
 const invoke=window.__TAURI__.core.invoke,checks=[];
 const assert=(ok,message)=>{if(!ok)throw new Error(message);checks.push(message);};
 const wait=async test=>{const end=Date.now()+45000;while(true){try{if(test())return;}catch{}if(Date.now()>end)throw new Error('Native update UI proof timed out');await new Promise(r=>setTimeout(r,25));}};
 try{
  const info=await invoke('desktop_diagnostics'),app=await invoke('desktop_app_info');
  assert(app.version==='1.0.0','native installed version is 1.0.0');
  assert(info.helpItems.includes('Check for Updates')&&info.helpItems.includes('About ScriptForge'),'actual native Help menu contains update and About commands');
  if(!location.pathname.endsWith('editor.html')){
   await wait(()=>document.querySelector('.sf-about-version')?.textContent.includes(app.version));
   await window.__TAURI__.event.emit('scriptforge-help','about');await wait(()=>document.getElementById('about-scriptforge').open);
   assert(document.querySelectorAll('#about-scriptforge').length===1,'native About uses one dialog and actual package version');
   document.querySelector('[data-about-close]').click();
   try{await invoke('desktop_update_check',{automatic:true});}catch{}const second=await invoke('desktop_update_check',{automatic:true});assert(second.skipped===true,'automatic native checking is limited to once per process');
   const {createDocument,createElement}=await import('/js/document.js'),{draftRecord}=await import('/js/session.js'),{repository}=await import('/js/storage.js');
   const doc=createDocument({title:'Native update safety proof',elements:[createElement('action','A safe update keeps this screenplay.')]});const record=draftRecord(doc);record.recovery.dirty=false;await repository.put(record);sessionStorage.setItem('native-update-checks',JSON.stringify(checks));location.href=`editor.html?id=${doc.id}`;return;
  }
  checks.unshift(...JSON.parse(sessionStorage.getItem('native-update-checks')||'[]'));
  await wait(()=>window.scriptForge?.getDocument()&&document.getElementById('pages').contentEditable==='true');
  const before=window.scriptForge.getDocument(),release=await window.scriptForgePrepareUpdate();
  assert(document.getElementById('pages').contentEditable==='false','native save barrier locks editing during verification');release();assert(document.getElementById('pages').contentEditable==='true','native save barrier restores editing after postponing');
  const {repository}=await import('/js/storage.js'),record=await repository.get(before.id);assert(JSON.stringify(record.recovery.document)===JSON.stringify(before),'native update safety verifies exact recovery without changing screenplay content');
  await invoke('desktop_diagnostics_report',{report:{success:true,checks,installedOrRestarted:false}});
 }catch(error){await invoke('desktop_diagnostics_report',{report:{success:false,error:String(error),stack:error.stack,checks}});}
})();
