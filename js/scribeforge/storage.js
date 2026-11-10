import { decodeManuscript, validId } from './model.js';

export const desktop = globalThis.window?.__TAURI__;
const namespace = typeof __SCRIBEFORGE_DEV__ !== 'undefined' && __SCRIBEFORGE_DEV__ ? 'com.scribeforge.desktop.dev' : 'com.scribeforge.desktop';
export const DATABASE_NAME = `${namespace}.manuscripts`;

const legacyDatabase = namespace.endsWith('.dev') ? 'com.storyforge.desktop.dev.manuscripts' : 'com.storyforge.desktop.manuscripts';

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

async function legacyRecords(indexedDB, name) {
  const request = indexedDB.open(name);
  let missing = false;
  request.onupgradeneeded = () => {
    // An absent library is normal. Abort the creation of an empty old database.
    missing = true;
    request.transaction.abort();
  };
  const db = await requestResult(request).catch(error => {
    if (missing && error?.name === 'AbortError') return null;
    throw error;
  });
  if (!db) return [];
  try {
    return await requestResult(db.transaction('manuscripts').objectStore('manuscripts').getAll());
  } finally { db.close(); }
}

async function migrateLibrary(indexedDB, db, source) {
  if (!source) return;
  const marker = 'rename-v1';
  const finished = await requestResult(db.transaction('migrations').objectStore('migrations').get(marker));
  if (finished) return;
  const records = await legacyRecords(indexedDB, source);
  const transaction = db.transaction(['manuscripts', 'migrations'], 'readwrite', { durability: 'strict' });
  const done = transactionDone(transaction);
  try {
    const migrations = transaction.objectStore('migrations');
    // Another tab may have completed the copy while we read the old database.
    if (!await requestResult(migrations.get(marker))) {
      const store = transaction.objectStore('manuscripts');
      for (const record of records) {
        const existing = await requestResult(store.get(record.id));
        if (!existing) store.add(record);
        else if (JSON.stringify(existing) !== JSON.stringify(record)) {
          const id = crypto.randomUUID();
          const copy = document => document == null ? document : { ...document, documentId: id };
          store.add({ ...record, id, current: copy(record.current), previous: copy(record.previous) });
        }
      }
      migrations.add(true, marker);
    }
    await done;
  } catch (error) {
    try { transaction.abort(); } catch {}
    await done.catch(() => {});
    throw error;
  }
}

export function browserStore(indexedDB = globalThis.indexedDB, databaseName = DATABASE_NAME, source = databaseName === DATABASE_NAME ? legacyDatabase : null) {
  let connection;
  async function open() {
    if (!indexedDB) throw new Error('IndexedDB is unavailable in this browser.');
    if (!connection) {
      const request = indexedDB.open(databaseName, 2);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('manuscripts')) {
          request.result.createObjectStore('manuscripts', { keyPath: 'id' });
        }
        request.result.createObjectStore('migrations');
      };
      connection = requestResult(request).then(async db => {
        db.onversionchange = () => { db.close(); connection = null; };
        try { await migrateLibrary(indexedDB, db, source); }
        catch (error) {
          db.close();
          throw new Error('The previous library could not be copied. Your original documents are still in place.', { cause: error });
        }
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
