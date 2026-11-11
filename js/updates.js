import {desktopInvoke} from './desktop.js';
import {flushPreferences} from './storage.js';
const message = error => typeof error === 'string' ? error : error?.message ?? 'Please try again.';

/** One controller per page; the native process owns the once-per-launch flag and package. */
export class UpdateController {
  constructor({invoke,prepare=async()=>()=>{},changed=()=>{}}) {Object.assign(this,{invoke,prepare,changed,phase:'idle',busy:false,update:null,error:'',version:'',platform:'',configured:false});}
  notify(){this.changed(this);}
  async initialize(){const info=await this.invoke('desktop_app_info');Object.assign(this,{version:info.version,platform:info.platform,configured:info.updatesConfigured});this.notify();}
  async check(automatic=false){
    if(this.busy)return;this.busy=true;this.error='';this.phase='checking';if(!automatic)this.notify();
    try{
      if(!this.configured){if(!automatic)throw new Error('Updates are not configured in this build. Release signing setup is still required.');this.phase='idle';return;}
      const result=await this.invoke('desktop_update_check',{automatic});
      if(result.skipped){this.phase='idle';return;}
      this.update=result.update;this.phase=result.update?.phase??(automatic?'idle':'current');
    }catch(error){this.phase=automatic?'idle':'error';if(!automatic)this.error=`Could not check for updates. Check your connection and try again. ${message(error)}`;}
    finally{this.busy=false;this.notify();}
  }
  async download(){
    if(this.busy||!this.update)return;this.busy=true;this.error='';this.phase='downloading';this.downloaded=0;this.total=null;this.notify();
    try{await this.invoke('desktop_update_download');this.phase='downloaded';}
    catch(error){this.phase='available';this.error=`Download or signature verification failed. Nothing was installed. ${message(error)}`;}
    finally{this.busy=false;this.notify();}
    if(!this.cancelled&&this.phase==='downloaded'&&this.platform!=='windows')await this.install();
  }
  progress({downloaded,total}){if(this.phase!=='downloading')return;this.downloaded=downloaded;this.total=Number.isFinite(total)&&total>0?total:null;this.notify();}
  async install(){
    if(this.cancelled||this.busy||this.phase!=='downloaded')return;this.busy=true;this.error='';let release;
    try{this.phase='saving';this.notify();release=await this.prepare();this.phase='installing';this.notify();await this.invoke('desktop_update_install');this.phase='installed';}
    catch(error){this.phase='downloaded';this.error=`Update not installed. ScriptForge remains open. ${message(error)}`;}
    finally{release?.();this.busy=false;this.notify();}
  }
  async restart(){
    if(this.cancelled||this.busy||this.phase!=='installed')return;this.busy=true;this.error='';let release;
    try{release=await this.prepare();this.phase='restarting';this.notify();await this.invoke('desktop_update_restart');}
    catch(error){release?.();this.busy=false;this.phase='installed';this.error=`Could not restart. Your work remains open; retry or restart ScriptForge later. ${message(error)}`;this.notify();}
  }
}

const updateInstances=new WeakMap();
export function setupUpdates(environment=window){
  if(!desktopInvoke(environment)||!environment.__TAURI__?.event?.listen)return Promise.resolve();
  if(updateInstances.has(environment))return updateInstances.get(environment);
  const pending=initializeUpdates(environment).catch(error=>{updateInstances.delete(environment);throw error;});
  updateInstances.set(environment,pending);return pending;
}
async function initializeUpdates(environment){
  const invoke=desktopInvoke(environment);if(!invoke||!environment.__TAURI__?.event?.listen)return;
  const document=environment.document,link=document.createElement('link');link.rel='stylesheet';link.href='./css/updates.css';document.head.append(link);
  const about=document.createElement('dialog');about.id='about-scriptforge';about.className='sf-update-dialog';
  about.innerHTML='<img src="./scriptForgeLogo.png" alt="" width="64" height="64"><h1>ScriptForge</h1><p class="sf-about-version"></p><p>A screenplay editor for writing, formatting, and managing screenplays.</p><div class="dialog-actions"><button data-about-check class="primary-button">Check for Updates</button><button data-about-close>Close</button></div>';
  const legal=document.createElement('details');legal.innerHTML='<summary>License and source code</summary><p>Copyright © 2026 wdk08. ScriptForge is free software under GPLv3, without warranty. Third-party components retain their own licenses.</p><p>Corresponding source is provided beside each official installer on GitHub Releases.</p><button data-read-licenses>Read licenses and source instructions</button>';
  about.insertBefore(legal,about.querySelector('.dialog-actions'));
  const licenses=document.createElement('dialog');licenses.id='scriptforge-licenses';licenses.className='sf-update-dialog';licenses.innerHTML='<h1>Licenses and Source</h1><pre style="max-height:60vh;overflow:auto;white-space:pre-wrap"></pre><div class="dialog-actions"><button>Close</button></div>';
  licenses.querySelector('button').onclick=()=>licenses.close();
  legal.querySelector('button').onclick=async()=>{licenses.querySelector('pre').textContent='Loading notices…';licenses.showModal();try{const files=['COPYRIGHT','SOURCE_CODE.md','THIRD_PARTY_NOTICES.md','LICENSE'];const texts=await Promise.all(files.map(async file=>{const response=await environment.fetch(`./${file}`);if(!response.ok)throw new Error('Notice unavailable');return `${file}\n\n${await response.text()}`;}));licenses.querySelector('pre').textContent=texts.join('\n\n────────\n\n');}catch{licenses.querySelector('pre').textContent='Could not load local notices. The license and corresponding-source instructions are also included in the release source package.';}};
  const dialog=document.createElement('dialog');dialog.id='scriptforge-update';dialog.className='sf-update-dialog';
  dialog.innerHTML='<h1></h1><p data-summary></p><section data-notes><h2>What’s New</h2><pre></pre></section><progress aria-label="Update download progress"></progress><p data-progress role="status"></p><p data-error role="alert"></p><div class="dialog-actions"><button data-later>Later</button><button data-primary class="primary-button"></button></div>';
  document.body.append(about,licenses,dialog);let active=true,returnFocus=null;
  const show=()=>{if(!dialog.open){returnFocus=document.activeElement;dialog.showModal();}};
  const close=()=>{dialog.close();returnFocus?.focus?.();};
  const controller=new UpdateController({invoke,prepare:async()=>{
    const other=[...document.querySelectorAll('dialog[open]')].some(el=>el!==about&&el!==dialog);
    if(other)throw new Error('Close the other open dialog before installing or restarting.');
    await flushPreferences();
    const release=await environment.scriptForgePrepareUpdate?.();
    if(!environment.scriptForgePrepareUpdate){await environment.scriptForgeBeforeClose?.();}
    return release??(()=>{});
  },changed:state=>{
    if(!active)return;
    about.querySelector('.sf-about-version').textContent=state.version?`Version ${state.version}`:'Version unavailable';
    if(state.phase==='idle')return;
    const titles={checking:'Checking for Updates',available:'ScriptForge Update Available',downloading:'Downloading Update',saving:'Saving Your Work',installing:'Installing Update',downloaded:'Update Ready to Install',installed:'Update Ready',restarting:'Restarting ScriptForge',current:'ScriptForge is up to date',error:'Could Not Check for Updates'};
    dialog.querySelector('h1').textContent=titles[state.phase];
    const summary=state.phase==='current'?`You’re running the latest version of ScriptForge (v${state.version}).`:state.update?`ScriptForge v${state.update.version} · Installed v${state.version}`:'';
    dialog.querySelector('[data-summary]').textContent=summary;
    dialog.querySelector('[data-notes]').hidden=!state.update?.notes;
    dialog.querySelector('pre').textContent=state.update?.notes??''; // Never render release metadata as HTML.
    const progress=dialog.querySelector('progress');progress.hidden=state.phase!=='downloading';
    if(state.total){progress.max=state.total;progress.value=Math.min(state.downloaded,state.total);}else progress.removeAttribute('value');
    const messages={saving:'Waiting for autosave and verifying recovery before proceeding.',installing:state.platform==='windows'?'The installer will close ScriptForge and apply the update.':'Installing the verified update. Keep ScriptForge open.',downloaded:state.platform==='windows'?'Download verified. Installation will save your work, close ScriptForge, and launch the installer.':'Download verified. Ready to retry installation.',installed:'The update is installed. Restart when you are ready.'};
    dialog.querySelector('[data-progress]').textContent=state.phase==='downloading'?(state.total?`${Math.floor(Math.min(100,state.downloaded/state.total*100))}% downloaded`:`${Math.floor((state.downloaded??0)/1024)} KB downloaded — verifying before installation.`):messages[state.phase]??'';
    dialog.querySelector('[data-error]').textContent=state.error;
    const primary=dialog.querySelector('[data-primary]'),later=dialog.querySelector('[data-later]');
    const buttons={available:['Update Now',()=>controller.download()],downloaded:[state.platform==='windows'?'Install and Restart':'Install Update',()=>controller.install()],installed:['Restart Now',()=>controller.restart()]};
    primary.hidden=!buttons[state.phase];primary.disabled=state.busy;primary.textContent=buttons[state.phase]?.[0]??'';primary.onclick=buttons[state.phase]?.[1]??null;
    later.disabled=state.busy;later.textContent=state.phase==='installed'?'Restart Later':['current','error'].includes(state.phase)?'Close':'Later';
    show();
  }});
  about.querySelector('[data-about-check]').onclick=()=>{about.close();void controller.check();};
  about.querySelector('[data-about-close]').onclick=()=>about.close();
  dialog.querySelector('[data-later]').onclick=close;
  dialog.addEventListener('cancel',event=>{if(controller.busy)event.preventDefault();});
  let releases=[],generation=0;
  const attach=async()=>{
    const token=++generation;
    const registrations=await Promise.all([
      environment.__TAURI__.event.listen('scriptforge-help',async({payload})=>{
        if(!active)return;
        if(payload==='about'){if(dialog.open)return;if(!about.open)about.showModal();}
        else if(payload==='check'){about.close();if(controller.phase==='installed'){controller.notify();return;}await controller.check();}
      }),
      environment.__TAURI__.event.listen('scriptforge-update-progress',({payload})=>{if(active)controller.progress(payload);})
    ]);
    if(!active||token!==generation)registrations.forEach(release=>release());else releases=registrations;
  };
  environment.addEventListener('pagehide',()=>{active=false;controller.cancelled=true;generation++;for(const release of releases)release();releases=[];});
  environment.addEventListener('pageshow',event=>{if(event.persisted){active=true;controller.cancelled=false;void attach().catch(console.error);}});
  await attach();
  await controller.initialize();
  environment.setTimeout(()=>{if(active)void controller.check(true);},1000);
  return controller;
}
