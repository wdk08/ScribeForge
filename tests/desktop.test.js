import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalBridge } from '../js/local-files.js';
import { createFileService } from '../js/files.js';
import { DesktopBackupStore, invokeDesktop, exportDesktop } from '../js/desktop.js';
import { buildDesktop, desktopAssets } from '../scripts/build-desktop.mjs';

test('desktop bridge uses native IPC without a localhost server and keeps handles cloneable', async () => {
  const calls=[]; const environment={__TAURI__:{core:{invoke:async(command,args)=>{calls.push([command,args]);return{localHelper:true,desktop:true,token:'native-token',kind:'directory',name:'Scripts'};}}}};
  const bridge=createLocalBridge(environment); await bridge.ready; assert.equal(bridge.available,true); assert.equal(bridge.native,true);
  const handle=bridge.hydrate(await bridge.call('choose-folder')); assert.equal(handle.name,'Scripts'); assert.equal(typeof handle.requestPermission,'function');
  assert.deepEqual(structuredClone(handle),{localHelper:true,desktop:true,token:'native-token',kind:'directory',name:'Scripts'});
  assert.deepEqual(calls,[['desktop_local',{action:'choose-folder',body:{}}]]);
});
test('native file service selects original files and saves through the same protected file identity', async () => {
  const calls=[],handle={localHelper:true,desktop:true,token:'file-token',kind:'file',name:'Original.fountain'};
  const environment={__TAURI__:{core:{invoke:async(command,args)=>{calls.push(args); if(args.action==='open-file') return{handle,source:'Original.',hash:'old',name:handle.name}; if(args.action==='write') return{source:args.body.source,hash:'new',name:handle.name}; return{permission:'granted'};}}}};
  const files=createFileService(environment); assert.equal(files.supportsDirectories,true); assert.equal(files.usesDesktop,true);
  const opened=await files.open(); const written=await files.write(opened.handle,'Edited.',{expectedHash:opened.hash});
  assert.equal(written.handle.token,handle.token); assert.equal(written.kind,'file'); assert.deepEqual(calls.at(-1),{action:'write',body:{handle:written.handle,source:'Edited.',expectedHash:'old'}});
});
test('native IPC preserves cancellation, permission errors and reviewed file conflicts', async () => {
  for(const name of ['AbortError','FilePermissionError','FileConflictError']) {
    const environment={__TAURI__:{core:{invoke:async()=>{throw{name,message:'Native failure',current:{source:'Outside edit.'}};}}}};
    await assert.rejects(invokeDesktop('desktop_local',{},environment),error=>error.name===name&&error.current.source==='Outside edit.');
  }
});
test('desktop export transfers actual UTF-8/PDF bytes through a native save dialog, without a download anchor',async()=>{
  const calls=[],environment={__TAURI__:{core:{invoke:async(command,args)=>{calls.push([command,args]);return{kind:'export'};}}}};
  await createFileService(environment).download('INT. CAFÉ - DAY','Film.fountain');
  await exportDesktop(new Blob(['%PDF-1.4\nproof']),'Film.pdf',environment);
  assert.equal(calls[0][0],'desktop_export'); assert.equal(new TextDecoder().decode(Uint8Array.from(calls[0][1].bytes)),'INT. CAFÉ - DAY');
  assert.equal(new TextDecoder().decode(Uint8Array.from(calls[1][1].bytes)),'%PDF-1.4\nproof');
});
test('desktop backup adapter is independent of browser IndexedDB and propagates storage failures',async()=>{
  const prior=globalThis.__TAURI__,calls=[];
  globalThis.__TAURI__={core:{invoke:async(command,args)=>{calls.push([command,args]);if(args.action==='list')return[{id:'backup'}];if(args.action==='add')throw{message:'Disk full',name:'StorageError'};}}};
  try{const store=new DesktopBackupStore();assert.deepEqual(await store.list('film'),[{id:'backup'}]);await assert.rejects(store.add({id:'new'}),{message:'Disk full'});await store.remove(['old']);assert.equal(calls[0][0],'desktop_backups');}
  finally{if(prior===undefined)delete globalThis.__TAURI__;else globalThis.__TAURI__=prior;}
});
test('desktop asset build excludes local grants, user documents, dependencies and development artifacts',async()=>{
  const root=await mkdtemp(join(tmpdir(),'scriptforge-desktop-assets-'));
  try {
    for(const name of desktopAssets){if(!name.includes('.')){await mkdir(join(root,name));await writeFile(join(root,name,'asset.js'),'// asset');await writeFile(join(root,name,'asset.js.map'),'private map');}else await writeFile(join(root,name),'asset');}
    await writeFile(join(root,'package.json'),' {"version":"0.1.0"}');await writeFile(join(root,'.scriptforge-local.json'),'private grant');await writeFile(join(root,'User.fountain'),'private screenplay');
    const output=await buildDesktop(root),names=await readdir(output);
    assert.ok(!names.includes('.scriptforge-local.json'));assert.ok(!names.includes('User.fountain'));assert.deepEqual(await readdir(join(output,'js')),['asset.js']);assert.equal((JSON.parse(await readFile(join(output,'desktop-build.json'),'utf8'))).version,'0.1.0');
  }finally{await rm(root,{recursive:true,force:true});}
});

test('native close listeners are released over repeated navigation and bfcache restores', async () => {
  const { setupDesktopLifecycle } = await import('../js/desktop.js');
  let active = 0;
  for (let i = 0; i < 12; i++) {
    const environment = new EventTarget();
    environment.__TAURI__ = { core: { invoke: async () => {} }, event: { listen: async () => { active++; return () => { active--; }; } } };
    await setupDesktopLifecycle(environment); assert.equal(active, 1);
    environment.dispatchEvent(new Event('pagehide')); assert.equal(active, 0);
    const restored = new Event('pageshow'); restored.persisted = true;
    environment.dispatchEvent(restored); await Promise.resolve(); assert.equal(active, 1);
    environment.dispatchEvent(new Event('pagehide')); assert.equal(active, 0);
  }
});
test('navigation during native registration releases its late listener', async () => {
  const { setupDesktopLifecycle } = await import('../js/desktop.js');
  let resolve, released = false;
  const environment = new EventTarget();
  environment.__TAURI__ = { core: { invoke: async () => {} }, event: { listen: () => new Promise(done => { resolve = done; }) } };
  const pending = setupDesktopLifecycle(environment);
  environment.dispatchEvent(new Event('pagehide'));
  resolve(() => { released = true; }); await pending; assert.equal(released, true);
});
test('desktop Import a copy uses a native picker but retains no linked original handle', async () => {
  let calls = 0;
  const files = createFileService({ __TAURI__: { core: { invoke: async (command, args) => { calls++; assert.equal(args.action, 'open-file'); return { handle: { token:'original' }, source:'Action.', name:'Test.fountain' }; } } } });
  const opened = await files.open({importCopy:true}); assert.equal(opened.handle,null); assert.equal(opened.source,'Action.'); assert.equal(calls,1);
});

test('a fast back/forward restore cannot retain an earlier pending close registration',async()=>{
 const {setupDesktopLifecycle}=await import('../js/desktop.js');const pending=[];let active=0;
 const environment=new EventTarget();environment.__TAURI__={core:{invoke:async()=>{}},event:{listen:()=>new Promise(resolve=>pending.push(()=>{active++;resolve(()=>{active--;});}))}};
 const initial=setupDesktopLifecycle(environment);environment.dispatchEvent(new Event('pagehide'));
 const restored=new Event('pageshow');restored.persisted=true;environment.dispatchEvent(restored);
 pending[0]();await initial;assert.equal(active,0);
 pending[1]();await Promise.resolve();assert.equal(active,1);
 environment.dispatchEvent(new Event('pagehide'));assert.equal(active,0);
});
