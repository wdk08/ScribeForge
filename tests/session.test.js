import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, createElement, updateElement } from '../js/document.js';
import { parseFountain } from '../js/fountain.js';
import { DocumentSession, draftRecord, recordForFile, fountainForSaving } from '../js/session.js';
import { createFileService, contentHash } from '../js/files.js';
import { StorageConflictError } from '../js/storage.js';
import { importOpenedFile } from '../js/library.js';

// Transactional in-memory dependency for orchestrator tests; real IndexedDB is tested separately.
function repository() {
  const records = new Map();
  return { records, fail: false,
    async get(id) { return records.get(id); },
    async put(record, revision = null) {
      if (this.fail) throw new Error('Quota exceeded');
      const previous = records.get(record.id);
      if ((previous?.revision ?? null) !== revision) throw new StorageConflictError();
      const next = { ...record, revision: (previous?.revision ?? 0) + 1 }; records.set(record.id, next); return next;
    },
    async findHandle(handle) { return [...records.values()].find(record => record.handle === handle) ?? null; },
  };
}
function files() {
  const state = { source: 'Original.', writes: 0, downloads: [], gate: null };
  const handle = { name: 'Original.fountain', isSameEntry: async other => handle === other };
  const adapter = { ensurePermission: async () => {}, pickSave: async () => handle,
    write: async (destination, source) => { if (state.gate) await state.gate; state.source = source; state.writes++; return { kind: 'file', source, name: destination.name, hash: await contentHash(source) }; },
    download: (source, name) => { state.downloads.push(source); return { kind: 'download', source, name, hash: null }; },
  };
  return { state, handle, adapter };
}
async function setup(linked = true) {
  const store = repository(); const fs = files();
  const doc = createDocument({ title: 'Original', elements: [createElement('action', 'Original.')] });
  let record = draftRecord(doc);
  if (linked) record = await recordForFile({ source: 'Original.', name: 'Original.fountain', hash: await contentHash('Original.'), handle: fs.handle });
  record = await store.put(record);
  const session = new DocumentSession(store, fs.adapter, record, record.recovery.document, { delay: 100000 });
  return { store, fs, session };
}
function change(session, text) {
  const el = session.document.elements.find(el => el.type === 'action');
  session.changed(updateElement(session.document, el.id, { text }), { anchor: { id: el.id, offset: text.length }, focus: { id: el.id, offset: text.length } });
}
test('autosave recovery persists independently of files and retains previous snapshots', async () => {
  const { store, fs, session } = await setup();
  change(session, 'Changed.'); await session.flush();
  const saved = await store.get(session.record.id);
  assert.equal(saved.recovery.document.elements[0].text, 'Changed.'); assert.ok(saved.recovery.dirty);
  assert.equal(fs.state.writes, 0); assert.equal(fs.state.source, 'Original.');
  assert.ok(session.recoveryCurrent); assert.ok(saved.recoveryHistory.length); session.dispose();
});
test('an interrupted recovery leaves the last successful snapshot and current text intact', async () => {
  const { store, session } = await setup();
  change(session, 'First edit.'); await session.flush();
  store.fail = true; change(session, 'Second edit.');
  await assert.rejects(session.flush(), /Quota/);
  assert.equal((await store.get(session.record.id)).recovery.document.elements[0].text, 'First edit.');
  assert.equal(session.document.elements[0].text, 'Second edit.'); assert.ok(session.storageError); session.dispose();
});
test('typing during file save remains dirty and is recovered rather than falsely marked saved', async () => {
  const { store, fs, session } = await setup();
  change(session, 'Being saved.');
  let release; fs.state.gate = new Promise(resolve => { release = resolve; });
  const saving = session.save(); await new Promise(resolve => setTimeout(resolve, 0));
  change(session, 'Typed during save.'); release(); await saving;
  assert.ok(fs.state.source.includes('Being saved.')); assert.ok(session.dirty);
  assert.equal((await store.get(session.record.id)).recovery.document.elements[0].text, 'Typed during save.');
  assert.ok(session.record.recovery.dirty); session.dispose();
});
test('Save As forks an existing file reference, keeping the original recent entry', async () => {
  const { store, fs, session } = await setup(); const originalId = session.record.id;
  fs.adapter.pickSave = async () => ({ name: 'New.fountain', isSameEntry: async () => false });
  await session.saveAs();
  assert.notEqual(session.record.id, originalId); assert.ok(store.records.has(originalId));
  assert.equal(session.record.fileName, 'New.fountain'); session.dispose();
});
test('failed Save As keeps the original file identity and still recovers subsequent edits', async () => {
  const { store, fs, session } = await setup(); const originalId = session.record.id;
  fs.adapter.pickSave = async () => ({ name: 'Failed Copy.fountain', isSameEntry: async () => false });
  fs.adapter.write = async () => { throw new Error('Disk full'); };
  await assert.rejects(session.saveAs(), /Disk full/);
  assert.equal(session.record.id, originalId); assert.equal(session.document.id, originalId);
  change(session, 'Still safe.'); await session.flush();
  assert.equal((await store.get(originalId)).recovery.document.id, originalId);
  assert.equal((await store.get(originalId)).recovery.document.elements[0].text, 'Still safe.'); session.dispose();
});
test('download fallback records a cached copy without claiming a persistent local handle', async () => {
  const { fs, session } = await setup(false); fs.adapter.pickSave = async () => null;
  const result = await session.save();
  assert.equal(result.kind, 'download'); assert.equal(fs.state.downloads.length, 1);
  assert.equal(session.record.handle, null); assert.ok(session.record.downloadOnly); assert.ok(session.record.cachedSource); session.dispose();
});
test('a recovered edit cannot trigger file autosave until explicitly saved', async () => {
  const { store, fs, session } = await setup(); change(session, 'Recovered.'); await session.flush(); session.dispose();
  const recovery = new DocumentSession(store, fs.adapter, await store.get(session.record.id));
  assert.ok(recovery.recovered); await assert.rejects(recovery.enableFileAutosave(true), /explicitly/);
  assert.equal(fs.state.writes, 0); await recovery.save(); await recovery.enableFileAutosave(true);
  change(recovery, 'Next edit.'); await recovery.flush(); assert.equal(fs.state.writes, 2); recovery.dispose();
});
test('stale-tab recovery and file writes stop; Save As can preserve a new copy', async () => {
  const { store, fs, session } = await setup();
  await store.put({ ...session.record, title: 'Other tab' }, session.record.revision);
  change(session, 'My stale-tab edit.'); await assert.rejects(session.flush(), StorageConflictError);
  await assert.rejects(session.save(), StorageConflictError); assert.equal(fs.state.writes, 0);
  fs.adapter.pickSave = async () => ({ name: 'Copy.fountain', isSameEntry: async () => false });
  await session.saveAs(); assert.equal(fs.state.writes, 1); assert.equal(session.document.id, session.record.id); session.dispose();
});
test('opening the same handle reuses its ID and never replaces an unsaved recovery', async () => {
  const { store, fs, session } = await setup(); change(session, 'Do not replace.'); await session.flush();
  const reopened = await importOpenedFile({ source: 'Outside copy.', name: fs.handle.name, hash: await contentHash('Outside copy.'), handle: fs.handle }, store);
  assert.equal(reopened.id, session.record.id); assert.equal(reopened.recovery.document.elements[0].text, 'Do not replace.'); session.dispose();
});
test('unchanged complex Fountain exports exactly, including empty annotations and metadata', () => {
  for (const source of ['Title:\n\n# \n\n[[]]\n\n/**/\n\n!Action.\n', '\uFEFFTitle: Test\r\n\r\nINT. ROOM - DAY\r\n\r\nAction.']) {
    assert.equal(fountainForSaving(parseFountain(source)), source);
  }
});

test('automatic disk saving waits for inactivity while recovery persists independently', async () => {
  const { store, fs, session: old } = await setup(); old.dispose();
  const session = new DocumentSession(store, fs.adapter, old.record, old.document, { automatic: true, delay: 10, fileDelay: 80 });
  change(session, 'Automatically saved.');
  await new Promise(resolve => setTimeout(resolve, 35));
  assert.equal((await store.get(session.record.id)).recovery.document.elements[0].text, 'Automatically saved.');
  assert.equal(fs.state.writes, 0);
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(fs.state.writes, 1); assert.equal(parseFountain(fs.state.source).elements.find(el => el.type === 'action').text, 'Automatically saved.');
  assert.equal(session.dirty, false); session.dispose();
});
test('automatic disk failure leaves current recovery available and the original file intact', async () => {
  const { store, fs, session: old } = await setup(); old.dispose();
  const adapter = { ...fs.adapter, write: async () => { throw new Error('Permission revoked'); } };
  const session = new DocumentSession(store, adapter, old.record, old.document, { automatic: true, delay: 10, fileDelay: 30 });
  change(session, 'Keep my changed screenplay.');
  await new Promise(resolve => setTimeout(resolve, 90));
  assert.equal((await store.get(session.record.id)).recovery.document.elements[0].text, 'Keep my changed screenplay.');
  assert.match(session.fileError.message, /Permission revoked/); assert.equal(session.autoFile, false);
  assert.equal(fs.state.source, 'Original.'); assert.equal(session.dirty, true); session.dispose();
});

test('repeated folder saves reuse the linked file instead of allocating more files', async () => {
  const { fs, session } = await setup(false);
  let creations = 0;
  fs.adapter.createInFolder = async (_directory, source) => {
    creations++;
    return { handle: fs.handle, name: fs.handle.name, source, hash: await contentHash(source) };
  };
  await Promise.all([session.saveToFolder({ name: 'Screenplays' }), session.saveToFolder({ name: 'Screenplays' })]);
  change(session, 'A subsequent revision.');
  await session.saveToFolder({ name: 'Different folder' });
  assert.equal(creations, 1);
  assert.equal(fs.state.writes, 2);
  assert.equal(session.record.handle, fs.handle);
  assert.ok(fs.state.source.includes('A subsequent revision.'));
  session.dispose();
});

test('new drafts start with Fade In and a blank action for writing', () => {
  const record = draftRecord();
  assert.deepEqual(record.recovery.document.elements.map(el => [el.type, el.text]), [['transition', 'FADE IN:'], ['action', '']]);
  assert.match(fountainForSaving(record.recovery.document), /FADE IN:/);
  assert.equal(record.recovery.dirty, false);
});

test('recreating a missing file retains edits and the missing handle if the replacement write fails', async () => {
  const { fs, session, store } = await setup();
  fs.adapter.read = async () => { throw new DOMException('Deleted', 'NotFoundError'); };
  fs.adapter.createInFolder = async () => { throw new Error('Disk full'); };
  change(session, 'Work after deletion.');
  const id = session.record.id;
  await assert.rejects(session.recreateMissingFile({ name: 'Screenplays' }), /Disk full/);
  assert.equal(session.record.handle, fs.handle); assert.equal(session.record.id, id);
  assert.equal((await store.get(id)).recovery.document.elements[0].text, 'Work after deletion.');
  assert.equal(session.autoFile, false); assert.equal(session.missingFile, true); session.dispose();
});

test('recreation refuses to replace a linked file that becomes available again', async () => {
  const { fs, session } = await setup(); let creations = 0;
  fs.adapter.read = async () => ({ source: 'Original.', hash: session.record.fileHash });
  fs.adapter.createInFolder = async () => { creations++; };
  await assert.rejects(session.recreateMissingFile({}), /Reconnect/);
  assert.equal(creations, 0); assert.equal(session.record.handle, fs.handle); session.dispose();
});

test('manual Save queued during a rename writes the new linked file', async () => {
  const { fs, session } = await setup();
  session.document = { ...session.document, title: 'Named' };
  session.record.fileDirectory = { name: 'Folder' };
  fs.adapter.read = async () => ({ source: fs.state.source, hash: await contentHash(fs.state.source) });
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const newHandle = { name: 'Named.fountain' };
  fs.adapter.createInFolder = async (_folder, source) => { await gate; return { kind: 'file', handle: newHandle, name: newHandle.name, source, hash: await contentHash(source) }; };
  fs.adapter.retireRenamedFile = async () => {};
  const destinations = [];
  const write = fs.adapter.write;
  fs.adapter.write = async (handle, ...args) => { destinations.push(handle); return write(handle, ...args); };
  const renaming = session.saveToFolder(session.record.fileDirectory);
  await new Promise(resolve => setTimeout(resolve, 0));
  const manual = session.save(); release(); await renaming; await manual;
  assert.deepEqual(destinations, [newHandle]);
  assert.equal(session.record.fileName, 'Named.fountain'); session.dispose();
});

test('saving a scene after Fade In tolerates in-progress heading whitespace without changing the editor model', () => {
  for (const number of [undefined, '1']) {
    for (const text of ['', ' ', 'INT.', 'INT. ', 'INT. ROOM - DAY ', '  EXT. ROAD - NIGHT\t']) {
      const doc = createDocument({ elements: [createElement('transition', 'FADE IN:'), createElement('scene', text, number ? { sceneNumber: number } : {}), createElement('action', 'A quiet room.')] });
      const before = structuredClone(doc), saved = fountainForSaving(doc), parsed = parseFountain(saved);
      assert.deepEqual(doc, before);
      assert.equal(parsed.elements.find(el => el.type === 'transition').text, 'FADE IN:');
      const scene = parsed.elements.find(el => el.type === 'scene');
      if (text.trim()) { assert.equal(scene.text, text.trim()); assert.equal(scene.sceneNumber, number); }
      else assert.equal(scene, undefined);
      assert.equal(parsed.elements.find(el => el.type === 'action').text, 'A quiet room.');
    }
  }
});

test('an edited heading saves safely, and orphan speech exports literally with an explicit type warning', () => {
  const doc = parseFountain('>FADE IN:\n\n.INT. ROOM - DAY\n\n!A quiet room.\n');
  doc.elements.find(el => el.type === 'scene').text += ' ';
  const snapshot = structuredClone(doc);
  assert.equal(parseFountain(fountainForSaving(doc)).elements.find(el => el.type === 'scene').text, 'INT. ROOM - DAY');
  assert.deepEqual(doc, snapshot);
  const invalid = createDocument({ elements: [createElement('dialogue', 'Orphan speech without a character.')] });
  const warnings = [], before = structuredClone(invalid);
  const source = fountainForSaving(invalid, { onWarning: warning => warnings.push(warning) });
  assert.equal(parseFountain(source).elements.find(el => el.type === 'action').text, invalid.elements[0].text);
  assert.match(warnings[0], /round trip may change element types/);
  assert.deepEqual(invalid, before);
});

test('autosave writes temporary orphan speech literally, warns, and retains exact types and caret in recovery', async () => {
  const {store,fs,session}=await setup();
  const doc=structuredClone(session.document);
  doc.elements=[createElement('character','NOAH'),createElement('action','An interruption.'),createElement('dialogue','Exact speech — café!')];
  const selection={anchor:{id:doc.elements[2].id,offset:0},focus:{id:doc.elements[2].id,offset:0}};
  session.autoFile=true;session.changed(doc,selection);await session.flush();
  assert.equal(fs.state.writes,1);assert.equal(session.fileError,null);assert.equal(session.autoFile,true);
  assert.match(session.fountainWarnings[0],/round trip may change element types/);
  assert.ok(fs.state.source.includes('Exact speech — café!'));
  const saved=await store.get(session.record.id);
  assert.deepEqual(saved.recovery.document,doc);assert.deepEqual(saved.recovery.selection,selection);
  assert.deepEqual(saved.fountainWarnings,session.fountainWarnings);
  const reopened=new DocumentSession(store,fs.adapter,saved,saved.recovery.document);
  assert.deepEqual(reopened.fountainWarnings,session.fountainWarnings);reopened.dispose();
  assert.deepEqual(session.document,doc);session.dispose();
});

test('duplicate recovery flushes skip extra commits but successful disk writes still persist their hash and clean state', async () => {
  const { store, fs, session } = await setup(); let puts = 0; const put = store.put.bind(store); store.put = (...args) => { puts++; return put(...args); };
  change(session, 'One recovery snapshot.'); await Promise.all([session.flush({ disk: false }), session.flush({ disk: false })]); assert.equal(puts, 1); assert.equal(fs.state.writes, 0);
  session.autoFile = true; await session.flush(); assert.equal(fs.state.writes, 1); assert.equal(puts, 2); assert.equal(session.dirty, false); assert.equal(session.recoveryCurrent, true);
  const saved = await store.get(session.record.id); assert.equal(saved.fileHash, await contentHash(fs.state.source)); assert.equal(saved.recovery.dirty, false);
  await session.flush({ disk: false }); assert.equal(puts, 2); session.dispose();
});
test('a queued old autosave never writes an outdated snapshot after the user types a newer generation', async () => {
  const { fs, session } = await setup(); session.automatic = true; session.autoFile = true; session.fileDelay = 100000;
  let release; const gate = new Promise(resolve => { release = resolve; }); session.enqueue(() => gate);
  change(session, 'Older queued edit.'); const older = session.flush(); change(session, 'Newest edit.'); release(); await older;
  assert.equal(fs.state.writes, 1); assert.equal(session.dirty, false); await session.flush(); assert.equal(fs.state.writes, 1); assert.ok(fs.state.source.includes('Newest edit.')); assert.equal(session.dirty, false); session.dispose();
});
test('recovery failures can retry the same generation and the shorter default disk delay does not change recovery timing', async () => {
  const { store, session } = await setup(); assert.equal(session.fileDelay, 600); assert.equal(new DocumentSession(store, {}, session.record).delay, 500);
  change(session, 'Retry this same edit.'); store.fail = true; await assert.rejects(session.flush({ disk: false }), /Quota/); store.fail = false; await session.flush({ disk: false }); assert.equal(session.recoveryCurrent, true); session.dispose();
});

test('autosave cannot bypass an unavailable stale-tab revision check after an already-current recovery', async () => {
  const { store, fs, session } = await setup(); change(session, 'Protected recovery.'); await session.flush({ disk: false }); session.autoFile = true;
  const get = store.get.bind(store); store.get = async () => { throw new Error('Revision read unavailable'); }; await session.flush(); assert.equal(fs.state.writes, 0); assert.equal(session.autoFile, false); assert.match(session.storageError.message, /Revision read/);
  store.get = get; assert.equal((await store.get(session.record.id)).recovery.document.elements.find(el => el.type === 'action').text, 'Protected recovery.'); session.dispose();
});

test('returning Home without edits neither rewrites a committed draft nor manufactures a dirty recovery', async () => {
  const store = repository(), record = await store.put(draftRecord()), session = new DocumentSession(store, {}, record);
  await session.flush({ disk: false }); const saved = await store.get(record.id); assert.equal(saved.revision, record.revision); assert.equal(saved.recovery.dirty, false); assert.equal(session.recoveryCurrent, true); session.dispose();
});

test('flush catches up recovery when typing arrives during persistence, including when no disk write is appropriate', async () => {
  const { store, fs, session } = await setup(); let release, started; const gate = new Promise(resolve => { release = resolve; }), began = new Promise(resolve => { started = resolve; });
  const put = store.put.bind(store); let first = true; store.put = async (...args) => { if (first) { first = false; started(); await gate; } return put(...args); };
  change(session, 'Initial snapshot.'); const saving = session.flush({ disk: false }); await began; change(session, 'Typed while recovery was saving.'); release(); await saving;
  assert.equal(session.recoveryCurrent, true); assert.equal((await store.get(session.record.id)).recovery.document.elements.find(el => el.type === 'action').text, 'Typed while recovery was saving.'); assert.equal(fs.state.writes, 0); session.dispose();
});
