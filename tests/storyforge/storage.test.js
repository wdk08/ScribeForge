import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { autosaver, browserStore, libraryStore } from '../../js/storyforge/storage.js';
import { newManuscript } from '../../js/storyforge/model.js';

test('IndexedDB persists multiple manuscripts, rejects conflicting writes and retains crash checkpoints', async () => {
  const indexedDB = new IDBFactory();
  const store = libraryStore(browserStore(indexedDB, 'storyforge.dev.test'));
  const manuscript = newManuscript('A book', undefined, 'One 🪶');
  const second = newManuscript('Second book');
  assert.equal(await store.put(manuscript), 1);
  assert.equal(await store.put(second), 1);
  const updated = { ...manuscript, metadata: { ...manuscript.metadata, title: 'A renamed book' } };
  const competingStore = libraryStore(browserStore(indexedDB, 'storyforge.dev.test'));
  const saves = await Promise.allSettled([store.put(updated, 1), competingStore.put(manuscript, 1)]);
  assert.equal(saves.filter(result => result.status === 'fulfilled').length, 1);
  const reopened = await competingStore.get(manuscript.documentId);
  assert.equal(reopened.revision, 2);
  assert.deepEqual(reopened.previous, structuredClone(manuscript));
  assert.equal((await store.list()).length, 2);
  const prod = libraryStore(browserStore(indexedDB, 'storyforge.prod.test'));
  assert.equal(await prod.get(manuscript.documentId), null);
});

test('a malformed checkpoint opens the previous valid save for recovery', async () => {
  const run = browserStore(new IDBFactory(), 'recovery');
  const store = libraryStore(run);
  const manuscript = newManuscript('A book');
  await store.put(manuscript);
  await run('put', { id: manuscript.documentId, revision: 1, current: { ...manuscript, content: { type: 'doc', content: [] } } });
  const recovered = await store.get(manuscript.documentId);
  assert.ok(recovered.recovered);
  assert.deepEqual(recovered.current, structuredClone(manuscript));
});

test('autosave persists changes added during a save and retains dirty content on error', async () => {
  let value = 'first';
  let fail = true;
  const writes = [];
  const saver = autosaver({
    read: () => value, status: () => {}, enabled: false,
    async write(snapshot, revision) {
      if (fail) throw new Error('Disk full');
      writes.push([snapshot, revision]);
      return revision + 1;
    },
  });
  saver.changed();
  await assert.rejects(saver.flush(), /Disk full/);
  assert.ok(saver.dirty);
  fail = false;
  const flush = saver.flush();
  value = 'second';
  saver.changed();
  await Promise.all([flush, saver.flush()]);
  assert.deepEqual(writes, [['first', 0], ['second', 1]]);
  assert.equal(saver.dirty, false);
});

test('continuous typing still triggers a bounded autosave', async () => {
  let resolve;
  const saved = new Promise(done => { resolve = done; });
  const saver = autosaver({
    read: () => 'continuous draft',
    async write(snapshot) { resolve(snapshot); return 1; },
    status: () => {},
    delay: 5000,
    maxDelay: 20,
  });
  saver.changed();
  assert.equal(await saved, 'continuous draft');
});


test('archive and undo are atomic and stale editor saves cannot resurrect a manuscript', async () => {
  const store = libraryStore(browserStore(new IDBFactory(), 'archive'));
  const manuscript = newManuscript('Archive proof');
  await store.put(manuscript, 0, { added: 12 });
  const deletedRevision = await store.archive(manuscript.documentId, 1);
  assert.equal(await store.get(manuscript.documentId), null);
  assert.equal((await store.list()).length, 0);
  await assert.rejects(store.put(manuscript, 1), /changed in another window/);
  await assert.rejects(store.put(manuscript, deletedRevision), /removed from the library/);
  await store.restore(manuscript.documentId, deletedRevision);
  assert.equal((await store.list())[0].activity.added, 12);
  assert.equal((await store.get(manuscript.documentId)).current.metadata.title, 'Archive proof');
});
