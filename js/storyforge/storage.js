import { decodeManuscript, validId } from './model.js';

export const desktop = globalThis.window?.__TAURI__;
const namespace = typeof __STORYFORGE_DEV__ !== 'undefined' && __STORYFORGE_DEV__ ? 'com.storyforge.desktop.dev' : 'com.storyforge.desktop';
export const DATABASE_NAME = `${namespace}.manuscripts`;

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onabort = () => reject(transaction.error ?? new Error('Saving was interrupted.'));
    transaction.onerror = () => reject(transaction.error ?? new Error('Manuscript storage failed.'));
  });
}

export function browserStore(indexedDB = globalThis.indexedDB, databaseName = DATABASE_NAME) {
  let connection;
  async function open() {
    if (!indexedDB) throw new Error('IndexedDB is unavailable in this browser.');
    if (!connection) {
      const request = indexedDB.open(databaseName, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('manuscripts', { keyPath: 'id' });
      };
      connection = requestResult(request).then(db => {
        db.onversionchange = () => { db.close(); connection = null; };
        return db;
      }).catch(error => { connection = null; throw error; });
    }
    return connection;
  }
  return async function run(action, body) {
    const db = await open();
    if (action === 'list') {
      const records = await requestResult(db.transaction('manuscripts').objectStore('manuscripts').getAll());
      return records.filter(record => !record.deletedAt).map(({ id, current, updated, preview, revision, activity }) =>
        ({ id, metadata: current.metadata, updated, preview, revision, activity }));
    }
    if (!validId(body.id)) throw new Error('Invalid manuscript identifier.');
    if (action === 'get') {
      const record = await requestResult(db.transaction('manuscripts').objectStore('manuscripts').get(body.id));
      return record && (!record.deletedAt || body.includeDeleted) ? record : null;
    }
    if (!['put', 'archive', 'restore'].includes(action)) throw new Error('Unknown manuscript storage operation.');
    const transaction = db.transaction('manuscripts', 'readwrite', { durability: 'strict' });
    const done = transactionDone(transaction);
    try {
      const store = transaction.objectStore('manuscripts');
      const previous = await requestResult(store.get(body.id));
      const actual = previous?.revision ?? 0;
      if (actual !== body.revision) throw new Error('This manuscript changed in another window. Export your version or save it as a new manuscript.');
      if (action !== 'put') {
        if (!previous || Boolean(previous.deletedAt) === (action === 'archive')) {
          throw new Error('The manuscript is no longer available for this action.');
        }
        store.put({ ...previous, revision: actual + 1, deletedAt: action === 'archive' ? Date.now() : null });
        await done;
        return actual + 1;
      }
      if (previous?.deletedAt) throw new Error('This manuscript was removed from the library. Save your changes as a new manuscript.');
      const record = {
        id: body.id, current: body.current, previous: previous?.current ?? null,
        activity: body.activity ?? previous?.activity ?? null, preview: body.preview, revision: actual + 1, updated: Date.now(),
      };
      store.put(record);
      await done;
      return record.revision;
    } catch (error) {
      try { transaction.abort(); } catch {}
      await done.catch(() => {});
      throw error;
    }
  };
}

export function libraryStore(run = desktop ? (action, body) => desktop.core.invoke('manuscripts', { action, body }) : browserStore()) {
  return {
    list: () => run('list', {}),
    archive: (id, revision) => run('archive', { id, revision }),
    restore: (id, revision) => run('restore', { id, revision }),
    async get(id, { includeDeleted = false } = {}) {
      const record = await run('get', { id, includeDeleted });
      if (!record) return null;
      if (record.id !== id) throw new Error('The stored manuscript identifier does not match this library entry.');
      try {
        decodeManuscript(record.current);
        if (record.current.documentId !== id) throw new Error('The stored manuscript has an invalid identifier.');
      }
      catch (error) {
        if (!record.previous) throw error;
        const checkpoint = decodeManuscript(record.previous);
        if (checkpoint.documentId !== id) throw error;
        record.current = checkpoint;
        record.recovered = true;
      }
      return record;
    },
    put(current, revision = 0, activity) {
      decodeManuscript(current);
      const preview = current.content.content.slice(0, 8).flatMap(block =>
        block.content ? [block.content.slice(0, 24).map(run => run.text?.slice(0, 220) ?? '\n').join('').slice(0, 220)] : []);
      return run('put', { id: current.documentId, current, revision, activity, preview });
    },
  };
}

export function autosaver({ read, write, status, revision = 0, enabled = true, delay = 650, maxDelay = 4000 }) {
  let saved = 0;
  let changes = 0;
  let dirtySince = null;
  let timer;
  let running;
  function schedule() {
    clearTimeout(timer);
    if (enabled && changes !== saved) {
      const wait = Math.min(delay, Math.max(0, maxDelay - (Date.now() - dirtySince)));
      timer = setTimeout(() => { void flush().catch(() => {}); }, wait);
    }
  }
  async function flush() {
    clearTimeout(timer);
    if (running) await running;
    if (saved === changes) return;
    if (running) return flush();
    const generation = changes;
    const snapshot = read();
    running = (async () => {
      status('Saving…');
      try {
        revision = await write(snapshot, revision);
        saved = generation;
        dirtySince = saved === changes ? null : Date.now();
        status(saved === changes ? 'Saved locally' : 'Unsaved changes');
        if (saved !== changes) schedule();
      } catch (error) {
        status(error?.message ?? String(error), true);
        throw error;
      }
    })();
    try { await running; }
    finally { running = null; }
  }
  return {
    changed() {
      dirtySince ??= Date.now();
      changes++;
      status('Unsaved changes');
      schedule();
    },
    flush,
    get dirty() { return changes !== saved; },
    setEnabled(value) { enabled = value; schedule(); },
  };
}
