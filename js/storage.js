// Update safety only: preference values are never copied into this registry.
const preferenceWrites = new Set(), preferenceFailures = new Map();
export async function flushPreferences() {
  do {
    await Promise.all([...preferenceWrites]);
    await Promise.resolve(); // Include the next write in an existing preference queue.
  } while (preferenceWrites.size);
  if (preferenceFailures.size) throw new Error('Some preferences could not be saved. Retry saving them before updating.');
}
/** Transactional IndexedDB records. File handles are structured-cloned, never JSON encoded. */
export class StorageConflictError extends Error {
  constructor() { super('This screenplay changed in another tab. Your current text is safe here; save it as a new copy.'); this.name = 'StorageConflictError'; }
}

export function createRepository(factory, name = 'scriptforge', { timeoutMs = 8000 } = {}) {
  // Set only by the native diagnostic plugin in an explicit isolated test run.
  name = (globalThis.scriptForgeDiagnosticDatabasePrefix ?? '') + name;
  if (factory === undefined) {
    try { factory = globalThis.indexedDB; } catch { factory = null; }
  }
  let opening;
  let connection;
  const readers = new Set();
  const listeners = new Set();
  let channel = null;
  // Messaging is an optional optimization. Embedded/private browsers may expose
  // BroadcastChannel but reject its constructor or sending messages.
  try {
    if (typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined') channel = new BroadcastChannel(`${name}:library`);
  } catch { /* Focus/pageshow refreshes still work without cross-tab messaging. */ }
  const changed = () => { for (const listener of listeners) listener(); };
  if (channel) channel.onmessage = changed;
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', () => {
      // Frozen pages must not retain native messaging or database resources.
      try { channel?.close?.(); } catch {} channel = null;
      // close() waits for active transactions. A cursor waiting for JS on a
      // frozen Home page can otherwise keep a read lock and block the next
      // editor's recovery write indefinitely. Reads are safe to abort; writes
      // must be allowed to finish to preserve pending recovery data.
      for (const transaction of readers) try { transaction.abort(); } catch {}
      readers.clear();
      connection?.close(); connection = null; opening = null;
    });
    window.addEventListener('pageshow', () => {
      if (!channel) try { channel = new BroadcastChannel(`${name}:library`); channel.onmessage = changed; } catch {}
    });
  }
  const timeoutError = phase => {
    const error = new Error(`Browser storage timed out while ${phase}. Your existing documents have not been reset. Retry loading the library.`);
    error.name = 'StorageTimeoutError'; return error;
  };
  function database() {
    if (!factory) return Promise.reject(new Error('Browser recovery storage is unavailable. Save your work to a Fountain file.'));
    if (!opening) opening = new Promise((resolve, reject) => {
      const request = factory.open(name, 1);
      let settled = false;
      const timer = setTimeout(() => { settled = true; reject(timeoutError('opening the library')); }, timeoutMs);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('screenplays', { keyPath: 'id' });
        request.result.createObjectStore('preferences', { keyPath: 'key' });
      };
      request.onsuccess = () => {
        const db = request.result;
        if (settled) { db.close(); return; }
        settled = true; clearTimeout(timer);
        connection = db;
        db.onversionchange = () => { db.close(); opening = null; };
        db.onclose = () => { opening = null; };
        resolve(db);
      };
      request.onerror = () => { if (settled) return; settled = true; clearTimeout(timer); reject(request.error); };
      request.onblocked = () => {
        if (settled) return; settled = true; clearTimeout(timer);
        reject(new Error('Close other ScriptForge tabs and retry to finish opening recovery storage.'));
      };
    }).catch(error => { opening = null; throw error; });
    return opening;
  }
  async function withTransaction(store, mode, operation) {
    let db = await database(), transaction;
    try { transaction = db.transaction(store, mode); }
    catch (error) {
      if (error.name !== 'InvalidStateError') throw error;
      opening = null; db = await database(); transaction = db.transaction(store, mode);
    }
    if (mode === 'readonly') {
      readers.add(transaction);
      const release = () => readers.delete(transaction);
      transaction.addEventListener?.('complete', release, { once: true });
      transaction.addEventListener?.('abort', release, { once: true });
    }
    // Queue requests synchronously with transaction creation. Passing a fresh
    // transaction through an awaited promise can let Safari close it as idle.
    return operation(transaction);
  }
  async function read(store, method, key) {
    return withTransaction(store, 'readonly', transaction => new Promise((resolve, reject) => {
      const timer = setTimeout(() => { reject(timeoutError('reading the library')); try { transaction.abort(); } catch {} }, timeoutMs);
      const request = transaction.objectStore(store)[method](key);
      request.onsuccess = () => { clearTimeout(timer); resolve(request.result); };
      request.onerror = () => { clearTimeout(timer); reject(request.error); };
      transaction.onabort = () => { clearTimeout(timer); reject(transaction.error ?? new Error('Recovery read was interrupted.')); };
    }));
  }
  function listRecords() {
    return withTransaction('screenplays', 'readonly', transaction => new Promise((resolve, reject) => {
      const rows = [];
      const request = transaction.objectStore('screenplays').openCursor();
      let timer;
      const armTimer = () => {
        clearTimeout(timer);
        timer = setTimeout(() => { reject(timeoutError('reading the library')); try { transaction.abort(); } catch {} }, timeoutMs);
      };
      armTimer();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) { clearTimeout(timer); resolve(rows.sort((a, b) => b.modifiedAt - a.modifiedAt)); return; }
        rows.push(cursor.value); armTimer(); cursor.continue();
      };
      request.onerror = () => { clearTimeout(timer); reject(request.error); };
      transaction.onabort = () => { clearTimeout(timer); reject(transaction.error ?? new Error('Library read was interrupted.')); };
    }));
  }
  return {
    reconnect() {
      if (!connection) return;
      connection.close(); connection = null; opening = null;
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    get: id => read('screenplays', 'get', id),
    list: async () => (await listRecords()).filter(record => !record.deletedAt),
    async archive(id, expectedRevision) {
      const record = await this.get(id);
      if (!record || record.deletedAt || record.revision !== expectedRevision) throw new StorageConflictError();
      return this.put({ ...record, deletedAt: Date.now() }, expectedRevision);
    },
    async restore(id, expectedRevision) {
      const record = await this.get(id);
      if (!record?.deletedAt || record.revision !== expectedRevision) throw new StorageConflictError();
      return this.put({ ...record, deletedAt: null }, expectedRevision);
    },
    async put(record, expectedRevision = null, retry = true) {
      if (typeof record.id !== 'string' || !record.id) throw new TypeError('A stable screenplay ID is required for browser storage.');
      if (record.recovery?.document?.id !== record.id) throw new TypeError('Recovery snapshots must belong to the same screenplay ID.');
      try { return await withTransaction('screenplays', 'readwrite', transaction => new Promise((resolve, reject) => {
        const store = transaction.objectStore('screenplays');
        const request = store.get(record.id);
        let result, conflict;
        const timer = setTimeout(() => { conflict = timeoutError('saving recovery'); try { transaction.abort(); } catch {} reject(conflict); }, timeoutMs);
        request.onsuccess = () => {
          try {
            const previous = request.result;
            if ((previous?.revision ?? null) !== expectedRevision) throw new StorageConflictError();
            result = { ...record, revision: (previous?.revision ?? 0) + 1 };
            store.put(result);
          } catch (error) {
            conflict = error; transaction.abort();
          }
        };
        transaction.oncomplete = () => {
          clearTimeout(timer);
          resolve(result); changed();
          try { channel?.postMessage('changed'); } catch { /* Storage has committed; optional messaging must not break it. */ }
        };
        transaction.onerror = () => { clearTimeout(timer); reject(conflict ?? transaction.error ?? new Error('Could not store a recovery snapshot.')); };
        transaction.onabort = () => { clearTimeout(timer); reject(conflict ?? transaction.error ?? new Error('Recovery save was interrupted.')); };
      })); } catch (error) {
        if (!retry || error.name !== 'StorageTimeoutError') throw error;
        this.reconnect();
        // A commit acknowledgement can be delayed even after the write committed.
        // Read it back before retrying; never mask another writer's revision.
        const latest = await this.get(record.id);
        if (latest?.revision === (expectedRevision ?? 0) + 1 &&
            JSON.stringify({ ...latest, revision: null }) === JSON.stringify({ ...record, revision: null })) return latest;
        if ((latest?.revision ?? null) !== expectedRevision) throw new StorageConflictError();
        return this.put(record, expectedRevision, false);
      }
    },
    getPreference: async (key, fallback) => (await read('preferences', 'get', key))?.value ?? fallback,
    async setPreference(key, value) {
      const work = withTransaction('preferences', 'readwrite', tx => new Promise((resolve, reject) => {
        const timer = setTimeout(() => { try { tx.abort(); } catch {} reject(timeoutError('saving preferences')); }, timeoutMs);
        try { tx.objectStore('preferences').put({ key, value }); }
        catch (error) { clearTimeout(timer); try { tx.abort(); } catch {} reject(error); return; }
        tx.oncomplete = () => { clearTimeout(timer); resolve(); }; tx.onabort = tx.onerror = () => { clearTimeout(timer); reject(tx.error ?? new Error('Could not store preferences.')); };
      }));
      preferenceWrites.add(work);
      try { await work; preferenceFailures.delete(key); }
      catch (error) { preferenceFailures.set(key, error); throw error; }
      finally { preferenceWrites.delete(work); }
    },
    async findHandle(handle) {
      for (const record of await this.list()) {
        if (!record.handle) continue;
        try { if (record.handle.localHelper && handle.localHelper) { const { fileService } = await import('./files.js'); fileService.restoreHandle(record.handle); } if (await record.handle.isSameEntry(handle)) return record; } catch { /* An unavailable reference cannot identify the file. */ }
      }
      return null;
    },
  };
}

export const repository = createRepository();
