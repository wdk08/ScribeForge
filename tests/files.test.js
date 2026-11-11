import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createFileService, readFountainFile, contentHash, FileConflictError } from '../js/files.js';
globalThis.crypto ??= webcrypto;

export function mockHandle(source, name = 'test.fountain') {
  const state = { source, permission: 'granted', requested: 0, writes: 0, aborted: 0, fail: false };
  const handle = {
    name,
    queryPermission: async () => state.permission,
    requestPermission: async () => { state.requested++; return state.permission; },
    isSameEntry: async other => other === handle,
    getFile: async () => ({ name, size: new TextEncoder().encode(state.source).length, lastModified: 1, arrayBuffer: async () => new TextEncoder().encode(state.source).buffer }),
    createWritable: async () => {
      let next;
      return {
        write: async value => { if (state.fail) throw new Error('Disk full'); next = value; },
        close: async () => { state.source = next; state.writes++; },
        abort: async () => { state.aborted++; },
      };
    },
  };
  return { state, handle };
}
test('Fountain file decoding preserves UTF-8, BOM, line endings and filename', async () => {
  const source = '\uFEFFTitle: A Film\r\n\r\n!🙂 é\r\n';
  const { handle } = mockHandle(source);
  const opened = await readFountainFile(await handle.getFile());
  assert.equal(opened.source, source); assert.equal(opened.name, 'test.fountain');
  assert.equal(opened.hash, await contentHash(source));
});
test('binary, unsupported, incorrectly encoded and excessive files are rejected', async () => {
  await assert.rejects(readFountainFile(await mockHandle('binary\0').handle.getFile()), /binary/);
  await assert.rejects(readFountainFile(await mockHandle('text', 'fake.pdf').handle.getFile()), /Choose/);
  await assert.rejects(readFountainFile({ name: 'bad.fountain', size: 1, arrayBuffer: async () => new Uint8Array([255]).buffer }), /UTF-8/);
  await assert.rejects(readFountainFile({ name: 'huge.fountain', size: 21 * 1024 * 1024 }), /20 MB/);
});
test('native opening uses the selected handle and direct saving writes only to it', async () => {
  const { handle, state } = mockHandle('Original.');
  const service = createFileService({ showOpenFilePicker: async () => [handle] });
  const opened = await service.open(); assert.equal(opened.handle, handle);
  await service.write(handle, 'Edited.', { expectedHash: opened.hash });
  assert.equal(state.source, 'Edited.'); assert.equal(state.writes, 1);
});
test('permission denial keeps the local file intact and background operations do not prompt', async () => {
  const { handle, state } = mockHandle('Original.'); state.permission = 'denied';
  const service = createFileService({});
  await assert.rejects(service.read(handle), /access is needed/); assert.equal(state.requested, 0);
  await assert.rejects(service.write(handle, 'Overwrite.', { request: true }), /access is needed/);
  assert.equal(state.requested, 1); assert.equal(state.source, 'Original.');
});
test('outside edits cause an aborted transaction; reviewed replacement is checked again', async () => {
  const { handle, state } = mockHandle('Original.'); const service = createFileService({});
  const originalHash = await contentHash(state.source); state.source = 'Outside edit.';
  let conflict;
  try { await service.write(handle, 'Mine.', { expectedHash: originalHash }); } catch (error) { conflict = error; }
  assert.ok(conflict instanceof FileConflictError); assert.equal(state.aborted, 1); assert.equal(state.source, 'Outside edit.');
  state.source = 'Another outside edit.';
  await assert.rejects(service.write(handle, 'Mine.', { expectedHash: conflict.current.hash }), FileConflictError);
  await service.write(handle, 'Mine.', { expectedHash: await contentHash(state.source) });
  assert.equal(state.source, 'Mine.');
});
test('Save As accepts an explicitly chosen destination and failed writes abort', async () => {
  const { handle, state } = mockHandle('Existing destination.'); const service = createFileService({ showSaveFilePicker: async options => { assert.equal(options.suggestedName, 'New Film.fountain'); return handle; } });
  assert.equal(await service.pickSave('New Film'), handle);
  await service.write(handle, 'New screenplay.', { allowNewDestination: true }); assert.equal(state.source, 'New screenplay.');
  state.fail = true;
  await assert.rejects(service.write(handle, 'Lost text.', { expectedHash: await contentHash(state.source) }), /Disk full/);
  assert.equal(state.source, 'New screenplay.'); assert.equal(state.aborted, 1);
});

test('folder saving uses a unique name and never overwrites a conflicting file', async () => {
  const existing = mockHandle('Keep this screenplay.', 'Untitled Screenplay.fountain');
  const entries = new Map([[existing.handle.name, existing]]);
  const directory = {
    queryPermission: async () => 'granted',
    getFileHandle: async (name, options) => {
      if (entries.has(name)) return entries.get(name).handle;
      if (!options?.create) throw new DOMException('Not found', 'NotFoundError');
      const created = mockHandle('', name); entries.set(name, created); return created.handle;
    },
  };
  const service = createFileService({});
  const saved = await service.createInFolder(directory, 'New screenplay.', 'Untitled Screenplay', 'stable-id');
  assert.equal(saved.name, 'Untitled Screenplay (2).fountain');
  assert.equal(existing.state.source, 'Keep this screenplay.'); assert.equal(existing.state.writes, 0);
  assert.equal(entries.get(saved.name).state.source, 'New screenplay.');
});
test('revoked folder permissions never request a background dialog or create a file', async () => {
  let created = false, requested = false;
  const directory = { queryPermission: async () => 'denied', requestPermission: async () => { requested = true; }, getFileHandle: async () => { created = true; } };
  await assert.rejects(createFileService({}).createInFolder(directory, 'New.', 'Title', 'id'), /access is needed/);
  assert.equal(created, false); assert.equal(requested, false);
});

test('retiring a renamed file preserves an outside edit and a replacement entry', async () => {
  const original = mockHandle('Original.', 'Old title.fountain');
  let entry = original.handle, removed = 0;
  const directory = { queryPermission: async () => 'granted', getFileHandle: async () => entry, removeEntry: async () => { removed++; } };
  const service = createFileService({});
  const prior = { handle: original.handle, name: original.handle.name, hash: await contentHash('Original.') };
  original.state.source = 'An outside edit.';
  await assert.rejects(service.retireRenamedFile(directory, prior), /preserved/);
  assert.equal(removed, 0);
  entry = mockHandle('Original.', 'Old title.fountain').handle;
  await assert.rejects(service.retireRenamedFile(directory, prior), /preserved/);
  assert.equal(removed, 0);
  entry = original.handle; original.state.source = 'Original.';
  await service.retireRenamedFile(directory, prior);
  assert.equal(removed, 1);
});

test('rename cleanup is idempotent when the previous filename is already gone', async () => {
  let removed = false;
  const directory = { queryPermission: async () => 'granted', getFileHandle: async () => { throw new DOMException('Missing', 'NotFoundError'); }, removeEntry: async () => { removed = true; } };
  await createFileService({}).retireRenamedFile(directory, { name: 'Old.fountain' });
  assert.equal(removed, false);
});

test('linked helper writes use one protected request and retain conflict, missing-file, permission and offline errors', async () => {
  const actions = []; let failure;
  const handle = { localHelper: true, token: 'test-token', kind: 'file', name: 'Film.fountain' };
  const service = createFileService({
    fetch: async (url, options) => {
      const action = url.split('/').at(-1), body = JSON.parse(options.body); actions.push(action); assert.equal(action, 'write'); assert.equal(body.expectedHash, 'previous-hash');
      if (failure === 'offline') throw new Error('Offline');
      return { ok: !failure, json: async () => failure ? { error: failure } : { name: handle.name, source: body.source, hash: 'new-hash' } };
    },
  });
  const result = await service.write(handle, 'New text.', { expectedHash: 'previous-hash' }); assert.deepEqual(actions, ['write']); assert.equal(result.hash, 'new-hash');
  failure = { name: 'FileConflictError', message: 'Changed', current: { hash: 'outside-hash', source: 'Outside edit.' } };
  await assert.rejects(service.write(handle, 'Overwrite.', { expectedHash: 'previous-hash' }), error => error instanceof FileConflictError && error.current.source === 'Outside edit.');
  for (const name of ['NotFoundError', 'FilePermissionError']) { failure = { name, message: name }; await assert.rejects(service.write(handle, 'Text.', { expectedHash: 'previous-hash' }), { name }); }
  failure = 'offline'; await assert.rejects(service.write(handle, 'Text.', { expectedHash: 'previous-hash' }), /offline/);
});
