import {test,expect} from '@playwright/test';
async function setup(page,{update=true,platform='macos',failed='',automatic=false}={}){
 await page.goto('/editor.html?sample=1');await expect(page.locator('#pages')).toHaveAttribute('contenteditable','true');
 await page.evaluate(async options=>{
  window.updateCalls=[];window.updateListeners={};window.updateOptions=options;
  window.__TAURI__={core:{invoke:async(command,args)=>{window.updateCalls.push({command,args});if(command===options.failed)throw new Error('Test failure');if(command==='desktop_update_download'&&window.holdDownload)await new Promise(resolve=>window.finishDownload=resolve);if(command==='desktop_app_info')return{version:'7.6.5',platform:options.platform,updatesConfigured:true};if(command==='desktop_update_check')return{update:options.update?{version:'7.6.6',currentVersion:'7.6.5',notes:'A safe update. <img src=x onerror="window.badNotes=true">',phase:'available'}:null};}},event:{listen:async(name,fn)=>{window.updateListeners[name]=fn;return()=>delete window.updateListeners[name];}}};
  // The independent controller is installed after the ordinary browser editor initializes.
  if(!options.automatic){const timer=window.setTimeout;window.setTimeout=(fn,delay)=>delay===1000?0:timer(fn,delay);}
  const {setupUpdates}=await import('/js/updates.js');const controllers=await Promise.all([setupUpdates(),setupUpdates()]);if(controllers[0]!==controllers[1])throw new Error('Duplicate update controller');window.testUpdateController=controllers[0];
 },{update,platform,failed,automatic});
}
const menu=(page,payload)=>page.evaluate(payload=>window.updateListeners['scriptforge-help']({payload}),payload);
test('About exposes packaged GPL notices and source instructions without changing a screenplay',async({page})=>{
 await setup(page,{update:false});const before=await page.evaluate(()=>window.scriptForge.getDocument());await menu(page,'about');await page.locator('#about-scriptforge summary').click();await page.getByRole('button',{name:'Read licenses and source instructions'}).click();
 await expect(page.locator('#scriptforge-licenses')).toBeVisible();await expect(page.locator('#scriptforge-licenses pre')).toContainText('GNU GENERAL PUBLIC LICENSE');await expect(page.locator('#scriptforge-licenses pre')).toContainText('ScriptForge-X.Y.Z-source.tar.gz');await expect(page.locator('#scriptforge-licenses pre')).toContainText('SIL OFL-1.1');
 await page.screenshot({path:'test-results/licenses-light.png'});await page.evaluate(()=>document.documentElement.dataset.theme='dark');await page.screenshot({path:'test-results/licenses-dark.png'});await page.locator('#scriptforge-licenses button').click();await expect(page.locator('#about-scriptforge')).toBeVisible();expect(await page.evaluate(()=>window.scriptForge.getDocument())).toEqual(before);
});
test('About shows native version, reuses one dialog, and shares manual update checking',async({page})=>{
 await setup(page,{update:false});await menu(page,'about');await expect(page.locator('#about-scriptforge')).toBeVisible();await expect(page.locator('.sf-about-version')).toHaveText('Version 7.6.5');await menu(page,'about');await expect(page.locator('#about-scriptforge')).toHaveCount(1);await page.getByRole('button',{name:'Check for Updates',exact:true}).click();await expect(page.locator('#scriptforge-update h1')).toHaveText('ScriptForge is up to date');await expect(page.locator('[data-summary]')).toContainText('7.6.5');
});
test('release notes are text, Later changes no screenplay, manual checking can reopen',async({page})=>{
 await setup(page);const before=await page.evaluate(()=>window.scriptForge.getDocument());await menu(page,'check');await expect(page.locator('#scriptforge-update h1')).toHaveText('ScriptForge Update Available');await expect(page.locator('#scriptforge-update pre')).toContainText('<img');expect(await page.evaluate(()=>window.badNotes)).toBeUndefined();await page.locator('[data-later]').click();expect(await page.evaluate(()=>window.scriptForge.getDocument())).toEqual(before);await menu(page,'check');await expect(page.locator('#scriptforge-update')).toBeVisible();await page.screenshot({path:'test-results/update-light.png'});await page.evaluate(()=>document.documentElement.dataset.theme='dark');await page.screenshot({path:'test-results/update-dark.png'});
});
test('download progress, save verification, installed prompt and deferred restart preserve editing',async({page})=>{
 await setup(page);await page.evaluate(()=>window.holdDownload=true);await menu(page,'check');await page.locator('[data-primary]').click();await expect(page.locator('progress')).not.toHaveAttribute('value');await page.evaluate(()=>window.updateListeners['scriptforge-update-progress']({payload:{downloaded:512,total:1024}}));await expect(page.locator('[data-progress]')).toHaveText('50% downloaded');await page.evaluate(()=>window.finishDownload());await expect(page.locator('#scriptforge-update h1')).toHaveText('Update Ready');const calls=await page.evaluate(()=>window.updateCalls.map(c=>c.command));expect(calls).toContain('desktop_update_install');expect(calls).not.toContain('desktop_update_restart');await page.locator('[data-later]').click();await expect(page.locator('#pages')).toHaveAttribute('contenteditable','true');
});
test('failed saving blocks install, restores editing, and leaves a retryable downloaded update',async({page})=>{
 await setup(page);await page.evaluate(()=>{window.scriptForgePrepareUpdate=async()=>{throw new Error('Fountain file permission revoked');};});await menu(page,'check');await page.locator('[data-primary]').click();await expect(page.locator('[data-error]')).toContainText('permission revoked');expect(await page.evaluate(()=>window.updateCalls.some(c=>c.command==='desktop_update_install'))).toBe(false);await expect(page.locator('#pages')).toHaveAttribute('contenteditable','true');
});
test('Windows verified download postpones installation until requested',async({page})=>{
 await setup(page,{platform:'windows'});await menu(page,'check');await page.locator('[data-primary]').click();await expect(page.locator('#scriptforge-update h1')).toHaveText('Update Ready to Install');await expect(page.locator('[data-primary]')).toHaveText('Install and Restart');expect(await page.evaluate(()=>window.updateCalls.some(c=>c.command==='desktop_update_install'))).toBe(false);await page.locator('[data-later]').click();
});
test('automatic offline failure is quiet; manual failure is actionable',async({page})=>{
 await setup(page,{failed:'desktop_update_check',automatic:true});await page.waitForTimeout(1200);await expect(page.locator('#scriptforge-update')).not.toBeVisible();await menu(page,'check');await expect(page.locator('[data-error]')).toContainText('Check your connection');
});
