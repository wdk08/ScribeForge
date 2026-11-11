import test from 'node:test';import assert from 'node:assert/strict';
import {UpdateController} from '../js/updates.js';import {flushForUpdate} from '../js/update-safety.js';
import {releaseCheck,validPublicKey} from '../scripts/release-check.mjs';import {validateManifest,platforms} from '../scripts/validate-update-manifest.mjs';
const update={version:'1.0.1',currentVersion:'1.0.0',notes:'Release notes',phase:'available'};
function setup({platform='macos',failure='',prepare=async()=>()=>{},result={update}}={}){const calls=[];const controller=new UpdateController({prepare,invoke:async(command,args)=>{calls.push([command,args]);if(command==='desktop_app_info')return{version:'1.0.0',platform,updatesConfigured:true};if(command===failure)throw new Error('Fixture failure');if(command==='desktop_update_check')return result;}});return{controller,calls};}
test('automatic no-update/offline checks are quiet, manual checks report current/error',async()=>{
 for(const failure of ['', 'desktop_update_check']){const{controller:c}=setup({failure,result:{update:null}});await c.initialize();await c.check(true);assert.equal(c.phase,'idle');assert.equal(c.error,'');await c.check();assert.equal(c.phase,failure?'error':'current');}
});
test('busy checks coalesce and progress uses actual totals only',async()=>{
 let resolve;const{controller:c,calls}=setup();await c.initialize();c.invoke=async command=>{calls.push([command]);return new Promise(r=>resolve=r);};const pending=c.check();await c.check();assert.equal(calls.filter(([cmd])=>cmd==='desktop_update_check').length,1);resolve({update});await pending;c.phase='downloading';c.progress({downloaded:12,total:null});assert.equal(c.total,null);c.progress({downloaded:12,total:24});assert.equal(c.total,24);assert.equal(c.downloaded,12);
});
test('Mac download verifies before save/install; restart repeats the save barrier',async()=>{
 const order=[];const{controller:c,calls}=setup({prepare:async()=>{order.push('save');return()=>order.push('unlock');}});await c.initialize();await c.check();await c.download();assert.equal(c.phase,'installed');assert.deepEqual(calls.slice(-2).map(([cmd])=>cmd),['desktop_update_download','desktop_update_install']);assert.deepEqual(order,['save','unlock']);await c.restart();assert.equal(c.phase,'restarting');assert.deepEqual(order,['save','unlock','save']);
});
test('Windows pauses after verified download and saves before launching the installer',async()=>{
 let saved=false;const{controller:c,calls}=setup({platform:'windows',prepare:async()=>{saved=true;return()=>{};}});await c.initialize();await c.check();await c.download();assert.equal(c.phase,'downloaded');assert.equal(saved,false);assert.equal(calls.some(([cmd])=>cmd==='desktop_update_install'),false);await c.install();assert.equal(saved,true);
});
test('signature/download, installation, restart and save failures never claim success',async()=>{
 for(const failure of ['desktop_update_download','desktop_update_install','desktop_update_restart']){let unlocked=0;const{controller:c}=setup({failure,prepare:async()=>()=>unlocked++});await c.initialize();await c.check();await c.download();if(failure==='desktop_update_download'){assert.equal(c.phase,'available');assert.equal(unlocked,0);}else if(failure==='desktop_update_install'){assert.equal(c.phase,'downloaded');assert.equal(unlocked,1);}else{await c.restart();assert.equal(c.phase,'installed');assert.equal(unlocked,2);}assert.ok(c.error);}
 const{controller:c,calls}=setup({prepare:async()=>{throw new Error('Storage error');}});await c.initialize();await c.check();await c.download();assert.equal(c.phase,'downloaded');assert.equal(calls.some(([cmd])=>cmd==='desktop_update_install'),false);
});
test('save barrier verifies exact recovery, and blocks swallowed disk failures and stale snapshots',async()=>{
 const document={id:'test',elements:[],settings:{margin:5}},session={document,record:{id:'test',handle:{}},recoveryCurrent:true,dirty:false,flush:async()=>{}},repository={get:async()=>({recovery:{document}})},backups={queue:Promise.resolve()};const deps={session,repository,backups};await flushForUpdate(deps);
 for(const patch of [{fileError:new Error('Permission revoked')},{dirty:true},{storageError:new Error('Quota')},{recoveryCurrent:false}])await assert.rejects(flushForUpdate({...deps,session:{...session,...patch}}));
 await assert.rejects(flushForUpdate({...deps,repository:{get:async()=>({recovery:{document:{...document,settings:{}}}})}}));
 await flushForUpdate({...deps,session:{...session,record:{id:'test',handle:null},dirty:true}}); // Verified recovery protects drafts without a disk file.
});
test('release versions and real public key configuration validate; requested mismatches fail',async()=>{assert.equal(await releaseCheck({production:true}),'1.0.1');await assert.rejects(releaseCheck({version:'1.0.0'}));assert.equal(validPublicKey('not a key'),false);});
test('manifest requires every target, signed version, HTTPS and actual uploaded artifacts',()=>{
 const signature=Buffer.from('untrusted comment: fixture\nfixture\ntrusted comment: timestamp:1\tversion:1.0.0\nfixture').toString('base64');const assets=platforms.map((p,i)=>({id:i+1,size:100,name:p.startsWith('darwin')?`${p}.app.tar.gz`:`${p}.exe`,browser_download_url:`https://github.com/wdk08/ScriptForge/releases/download/v1.0.0/${p}`}));const manifest={version:'1.0.0',notes:'Notes',pub_date:'2026-10-19T00:00:00Z',platforms:Object.fromEntries(platforms.map((p,i)=>[p,{signature,url:assets[i].browser_download_url}]))};assert.equal(validateManifest(manifest,'1.0.0',assets),true);
 for(const mutate of [m=>delete m.platforms['windows-x86_64'],m=>m.platforms['darwin-aarch64'].url='http://example.invalid/a',m=>m.platforms['darwin-aarch64'].signature='',m=>m.version='2.0.0']){const invalid=structuredClone(manifest);mutate(invalid);assert.throws(()=>validateManifest(invalid,'1.0.0',assets));}
});

test('a download completed after navigation cannot install from the stale page',async()=>{
 let finish;const{controller:c,calls}=setup();await c.initialize();await c.check();const original=c.invoke;c.invoke=async(command,args)=>{if(command==='desktop_update_download')await new Promise(resolve=>finish=resolve);return original(command,args);};const work=c.download();c.cancelled=true;finish();await work;assert.equal(c.phase,'downloaded');assert.equal(calls.some(([cmd])=>cmd==='desktop_update_install'),false);
});
test('preference failure blocks update flushing until the same preference saves successfully',async()=>{
 const {IDBFactory}=await import('fake-indexeddb'),{createRepository,flushPreferences}=await import('../js/storage.js');const repo=createRepository(new IDBFactory(),'update-preferences');
 await assert.rejects(repo.setPreference('update-test-theme',()=>{}));await assert.rejects(flushPreferences());await repo.setPreference('update-test-theme','dark');await flushPreferences();assert.equal(await repo.getPreference('update-test-theme'),'dark');repo.reconnect();
});

test('native string failures retain actionable details',async()=>{
 const{controller:c}=setup();await c.initialize();c.invoke=async()=>{throw 'Invalid update signature';};await c.check();assert.match(c.error,/Invalid update signature/);
});

test('preference flush includes subsequent writes in a serialized settings queue',async()=>{
 const{IDBFactory}=await import('fake-indexeddb'),{createRepository,flushPreferences}=await import('../js/storage.js');const repo=createRepository(new IDBFactory(),'update-preference-queue');const queue=repo.setPreference('first',1).then(()=>repo.setPreference('second',2));await flushPreferences();assert.equal(await repo.getPreference('second'),2);await queue;repo.reconnect();
});
