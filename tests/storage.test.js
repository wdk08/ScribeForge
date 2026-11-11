import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { createRepository, StorageConflictError } from '../js/storage.js';
import { draftRecord } from '../js/session.js';
test('IndexedDB creates stable recent entries and retains complete recovery models', async () => {
  const factory = new IDBFactory(), store = createRepository(factory, 'test');
  const original = draftRecord(); const stored = await store.put(original);
  const reopened = await createRepository(factory, 'test').get(original.id);
  assert.equal(reopened.id, original.id); assert.deepEqual(reopened.recovery.document, original.recovery.document);
  assert.equal(stored.revision, 1); assert.equal((await store.list()).length, 1);
});
test('revision conflicts never overwrite the more recent recovery snapshot', async () => {
  const store = createRepository(new IDBFactory()); const record = await store.put(draftRecord());
  const newer = await store.put({ ...record, title: 'Newer edit' }, record.revision);
  await assert.rejects(store.put({ ...record, title: 'Stale edit' }, record.revision), StorageConflictError);
  assert.equal((await store.get(record.id)).title, 'Newer edit');
  assert.equal((await store.get(record.id)).revision, newer.revision);
});
test('preferences and recent sorting survive database reopen independently of Fountain', async () => {
  const factory = new IDBFactory(); const store = createRepository(factory);
  const a = await store.put({ ...draftRecord(), modifiedAt: 100 });
  const b = await store.put({ ...draftRecord(), modifiedAt: 200 });
  await store.setPreference('zoom', '0.75');
  assert.equal(await createRepository(factory).getPreference('zoom', 'fit'), '0.75');
  assert.deepEqual((await store.list()).map(record => record.id), [b.id, a.id]);
});
test('unsupported storage and invalid IDs reject without promising recovery', async () => {
  await assert.rejects(createRepository(null).list(), /unavailable/);
  await assert.rejects(createRepository(new IDBFactory()).put({}), /stable screenplay ID/);
});

test('uncloneable records reject without committing or replacing a previous recovery', async () => {
  const store = createRepository(new IDBFactory());
  const original = await store.put(draftRecord());
  const notices = []; store.subscribe(() => notices.push('changed'));
  await assert.rejects(store.put({ ...original, title: 'Do not commit', handle: { getFile() {} } }, original.revision), { name: 'DataCloneError' });
  assert.deepEqual(await store.get(original.id), original);
  assert.deepEqual(notices, []);
  const fresh = draftRecord(); fresh.handle = { getFile() {} };
  await assert.rejects(store.put(fresh), { name: 'DataCloneError' });
  assert.equal(await store.get(fresh.id), undefined);
});
test('a synchronous database-open failure can be retried without resetting stored records', async () => {
  const factory = new IDBFactory(); let fail = true;
  const store = createRepository({ open(...args) {
    if (fail) { fail = false; throw new DOMException('Temporarily unavailable', 'SecurityError'); }
    return factory.open(...args);
  } });
  await assert.rejects(store.list(), /Temporarily unavailable/);
  const stored = await store.put(draftRecord());
  assert.equal((await store.list())[0].id, stored.id);
});

test('a stalled browser database open times out and a later retry preserves existing data', async () => {
  const factory = new IDBFactory();
  const original = await createRepository(factory, 'stalled').put(draftRecord());
  let stalled = true;
  const store = createRepository({ open(...args) {
    if (stalled) return {};
    return factory.open(...args);
  } }, 'stalled', { timeoutMs: 20 });
  await assert.rejects(store.list(), { name: 'StorageTimeoutError' });
  stalled = false;
  assert.equal((await store.list())[0].id, original.id);
});

test('library removal preserves recovery, survives reload, and supports revision-safe undo', async () => {
  const factory = new IDBFactory(), store = createRepository(factory, 'archive-test');
  const record = await store.put(draftRecord());
  const removed = await store.archive(record.id, record.revision);
  assert.equal((await store.list()).length, 0);
  const reopened = createRepository(factory, 'archive-test');
  assert.equal((await reopened.list()).length, 0);
  assert.deepEqual((await reopened.get(record.id)).recovery, record.recovery);
  await assert.rejects(store.put(record, record.revision), StorageConflictError);
  const restored = await reopened.restore(record.id, removed.revision);
  assert.equal(restored.deletedAt, null);
  assert.equal((await store.list()).length, 1);
  assert.deepEqual(restored.recovery, record.recovery);
});

test('a stale card cannot remove a screenplay edited in another tab', async () => {
  const store = createRepository(new IDBFactory(), 'archive-stale');
  const record = await store.put(draftRecord());
  await store.put({ ...record, title: 'Updated elsewhere' }, record.revision);
  await assert.rejects(store.archive(record.id, record.revision), StorageConflictError);
  assert.equal((await store.list())[0].title, 'Updated elsewhere');
});

test('unresponsive recovery and preference writes time out without reporting success', async()=>{
 const factory=new IDBFactory(), realOpen=factory.open.bind(factory);
 factory.open=(...args)=>{
  const request=realOpen(...args);
  request.addEventListener('success',()=>{
   const db=request.result;
   db.transaction=()=>({objectStore:()=>({get:()=>({}),put:()=>({})}),abort(){this.onabort?.();}});
  });return request;
 };
 const store=createRepository(factory,'stalled-writes',{timeoutMs:15});
 await assert.rejects(store.put(draftRecord(),null,false),{name:'StorageTimeoutError'});
 await assert.rejects(store.setPreference('writerProfile',{}),/saving preferences|preferences/);
});

test('a timed-out write reconnects once and verifies the revision before retrying',async()=>{
 const factory=new IDBFactory(),realOpen=factory.open.bind(factory);let first=true;
 factory.open=(...args)=>{const request=realOpen(...args);request.addEventListener('success',()=>{
  if(!first)return;first=false;
  request.result.transaction=()=>({objectStore:()=>({get:()=>({})}),abort(){this.onabort?.();}});
 });return request;};
 const store=createRepository(factory,'retry-write',{timeoutMs:30});const draft=draftRecord();
 const saved=await store.put(draft);assert.equal(saved.revision,1);assert.deepEqual((await store.get(draft.id)).recovery,draft.recovery);
});

test('departing pages abort unfinished read locks but allow recovery writes to finish',async()=>{
 const prior=globalThis.window;globalThis.window=new EventTarget();
 const transactions=[];
 const db={close(){},transaction(store,mode){
  const tx=new EventTarget();tx.mode=mode;tx.aborted=false;
  tx.objectStore=()=>({get:()=>({}),put:()=>({})});
  tx.abort=()=>{tx.aborted=true;tx.onabort?.();tx.dispatchEvent(new Event('abort'));};transactions.push(tx);return tx;
 }};
 const factory={open(){const request={result:db};queueMicrotask(()=>request.onsuccess());return request;}};
 try{
  const store=createRepository(factory,'departing-reads',{timeoutMs:500});
  const read=store.get('existing').catch(e=>e),write=store.put(draftRecord()).catch(e=>e);
  for(let i=0;i<6;i++)await Promise.resolve();
  assert.equal(transactions.length,2);
  window.dispatchEvent(new Event('pagehide'));
  assert.equal(transactions.find(t=>t.mode==='readonly').aborted,true);
  assert.equal(transactions.find(t=>t.mode==='readwrite').aborted,false);
  transactions.find(t=>t.mode==='readwrite').abort();await Promise.all([read,write]);
 }finally{if(prior===undefined)delete globalThis.window;else globalThis.window=prior;}
});
