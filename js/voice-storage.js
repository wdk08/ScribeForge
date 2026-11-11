const hydrate = record => record && record.model instanceof ArrayBuffer ? { ...record, model: new Blob([record.model], { type: 'application/octet-stream' }) } : record;
/** Separate model database: screenplay records and recovery stores are untouched. */
export function createVoiceStore(factory, name = 'scriptforge-voices') {
  if (factory === undefined) { try { factory = globalThis.indexedDB; } catch { factory = null; } }
  let opening; const listeners = new Set(); let channel;
  try { if (typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined') channel = new BroadcastChannel(`${name}:changes`); } catch {}
  const notify = () => { listeners.forEach(listener => listener()); };
  if (channel) channel.onmessage = notify;
  const changed = () => { notify(); try { channel?.postMessage('changed'); } catch {} };
  async function database() {
    if (!factory) throw new Error('Browser model storage is unavailable. Imported voices require IndexedDB.');
    if (!opening) opening = new Promise((resolve, reject) => {
      const request = factory.open(name, 1); let done = false;
      const timer = setTimeout(() => { done = true; reject(new Error('Voice storage timed out. Close other ScriptForge tabs and retry; stored voices have not been cleared.')); }, 8000);
      request.onupgradeneeded = () => { const store = request.result.createObjectStore('voices', { keyPath: 'id' }); store.createIndex('fingerprint', 'fingerprint', { unique: true }); };
      request.onsuccess = () => { if (done) { request.result.close(); return; } done = true; clearTimeout(timer); const db = request.result; db.onversionchange = () => { db.close(); opening = null; }; db.onclose = () => { opening = null; }; resolve(db); };
      request.onerror = () => { if (!done) { done = true; clearTimeout(timer); reject(request.error); } };
      request.onblocked = () => { if (!done) { done = true; clearTimeout(timer); reject(new Error('Voice storage is blocked by another tab. Close it and retry.')); } };
    }).catch(error => { opening = null; throw error; });
    return opening;
  }
  async function operation(mode, run, update) {
    const db = await database();
    return new Promise((resolve, reject) => {
      let transaction;
      try { transaction = db.transaction('voices', mode); } catch (error) { opening = null; reject(error); return; }
      const timer = setTimeout(() => { try { transaction.abort(); } catch {} reject(new Error('Voice storage operation timed out; existing voices were not reset.')); }, 15000);
      let result, failure;
      transaction.oncomplete = () => { clearTimeout(timer); resolve(result); };
      transaction.onerror = event => { failure = event.target?.error ?? transaction.error ?? new Error('Voice storage request failed.'); };
      transaction.onabort = () => { clearTimeout(timer); reject(failure ?? transaction.error ?? new Error('Voice storage operation was interrupted.')); };
      try { const store = transaction.objectStore('voices'), request = run(store); request.onsuccess = () => {
        try { result = update ? update(request.result, store) : request.result; }
        catch (error) { failure = error; try { transaction.abort(); } catch {} }
      }; }
      catch (error) { clearTimeout(timer); transaction.abort(); reject(error); }
    });
  }
  return {
    async list() { return (await operation('readonly', store => store.getAll())).map(({ model, ...metadata }) => metadata).sort((a, b) => a.name.localeCompare(b.name)); },
    async get(id) { return hydrate(await operation('readonly', store => store.get(id))); },
    async add(record) {
      const existing = await operation('readonly', store => store.index('fingerprint').get(record.fingerprint)); if (existing) return hydrate(existing);
      // WebKit can reject Blob/File persistence even after successful reads.
      // Store owned binary bytes; hydrate into a Blob only when loading a voice.
      const stored = { ...record, model: await record.model.arrayBuffer() };
      try { await operation('readwrite', store => store.add(stored)); }
      catch (error) { if (error?.name === 'ConstraintError') { const duplicate = await operation('readonly', store => store.index('fingerprint').get(record.fingerprint)); if (duplicate) return hydrate(duplicate); } throw error; }
      changed(); return record;
    },
    async rename(id, name) {
      const value = name.trim(); if (!value || value.length > 100) throw new Error('Enter a voice name of 1–100 characters.');
      await operation('readwrite', store => store.get(id), (record, store) => {
        if (!record) throw new Error('This voice is no longer stored. Refresh Voice Library.');
        store.put({ ...record, name: value });
      }); changed();
    },
    async remove(id) { await operation('readwrite', store => store.delete(id)); changed(); },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };
}
let defaultStore;
export function voiceStore() { return defaultStore ??= createVoiceStore(); }
export function importedVoices(records) {
  return records.flatMap(record => Array.from({ length: record.config.num_speakers }, (_, speakerId) => {
    const speaker = Object.entries(record.config.speaker_id_map ?? {}).find(([, id]) => id === speakerId)?.[0];
    return { voiceURI: `piper:${record.id}:${speakerId}`, name: `${record.name}${record.config.num_speakers > 1 ? ` / ${speaker ?? `Speaker ${speakerId}`}` : ''} (Piper)`, lang: record.config.language?.code?.replaceAll('_', '-') ?? record.config.espeak.voice, default: false, localService: true, kind: 'piper', modelId: record.id, speakerId };
  }));
}
