import { isDesktop, DesktopBackupStore } from './desktop.js';
import { newId, validateDocument } from './document.js';

export const BACKUP_DEFAULTS = Object.freeze({ enabled: true, interval: 10 });
export function backupSettings(value = {}) {
  return { enabled: value.enabled !== false, interval: [1, 5, 10, 15, 30].includes(value.interval) ? value.interval : 10 };
}
export function backupFingerprint(doc) {
  const { source, diagnostics, ...content } = doc;
  return JSON.stringify({ ...content, elements: doc.elements.map(({ source, ...el }) => el) });
}
/** Only automatic snapshots are thinned. Safety versions are never pruned. */
export function retainedBackups(items, now = Date.now()) {
  const sorted = [...items].sort((a, b) => b.at - a.at), keep = new Set(), buckets = new Set();
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  for (const item of sorted) {
    if (item.reason !== 'Automatic Backup' || item.at >= today.getTime()) { keep.add(item.id); continue; }
    const age = now - item.at, date = new Date(item.at);
    const bucket = age <= 7 * 86400000 ? `day:${date.toDateString()}` : `week:${Math.floor(item.at / (7 * 86400000))}`;
    if (age <= 35 * 86400000 && !buckets.has(bucket)) { buckets.add(bucket); keep.add(item.id); }
  }
  if (sorted.length) keep.add(sorted[0].id);
  return items.filter(item => keep.has(item.id));
}

/** Replace this adapter with Tauri app-data storage without changing backup clients. */
export class IndexedDBBackupStore {
  constructor(factory) {
    try { this.indexedDB = factory ?? globalThis.indexedDB; } catch { this.indexedDB = null; }
  }
  async database() {
    if (!this.connection) this.connection = new Promise((resolve, reject) => {
      if (!this.indexedDB) { reject(new Error('Backup storage is unavailable.')); return; }
      const request = this.indexedDB.open('scriptforge-backups', 1);
      let settled = false;
      const fail = error => { if (settled) return; settled = true; clearTimeout(timer); reject(error); };
      const timer = setTimeout(() => fail(new Error('Backup storage did not respond.')), 8000);
      request.onupgradeneeded = () => { request.result.createObjectStore('versions', { keyPath: 'id' }).createIndex('documentId', 'documentId'); };
      request.onsuccess = () => {
        if (settled) { request.result.close(); return; }
        settled = true; clearTimeout(timer);
        request.result.onversionchange = () => { request.result.close(); this.connection = null; }; resolve(request.result);
      };
      request.onerror = () => fail(request.error);
      request.onblocked = () => fail(new Error('Backup storage is blocked by another window.'));
    }).catch(error => { this.connection = null; throw error; });
    return this.connection;
  }
  async transaction(mode, action) {
    const db = await this.database();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('versions', mode), store = tx.objectStore('versions');
      let value;
      const timer = setTimeout(() => { try { tx.abort(); } catch {} reject(new Error('Backup operation timed out.')); }, 8000);
      try { const request = action(store); if (request) request.onsuccess = () => { value = request.result; }; }
      catch (error) { clearTimeout(timer); tx.abort(); reject(error); }
      tx.oncomplete = () => { clearTimeout(timer); resolve(value); };
      tx.onabort = tx.onerror = () => { clearTimeout(timer); reject(tx.error ?? new Error('Backup storage failed.')); };
    });
  }
  list(id) { return this.transaction('readonly', store => store.index('documentId').getAll(id)); }
  add(snapshot) { return this.transaction('readwrite', store => store.add(snapshot)); }
  remove(ids) { return this.transaction('readwrite', store => { for (const id of ids) store.delete(id); }); }
}
export class BackupService {
  constructor(store = isDesktop() ? new DesktopBackupStore() : new IndexedDBBackupStore()) { this.store = store; this.queue = Promise.resolve(); }
  list(id) { return this.store.list(id).then(items => items.sort((a, b) => b.at - a.at)); }
  captureDamaged(record) {
    const snapshot = structuredClone(record);
    const work = this.queue.then(async () => {
      const item = { id: newId(), documentId: record.id, at: Date.now(), reason: 'Damaged Working Copy', damagedRecord: snapshot, document: null };
      await this.store.add(item); return item;
    });
    this.queue = work.catch(() => {}); return work;
  }
  capture(document, reason = 'Automatic Backup', now = Date.now()) {
    const doc = structuredClone(validateDocument(document));
    const work = this.queue.then(async () => {
      const items = await this.list(doc.id), fingerprint = backupFingerprint(doc);
      if (items[0]?.fingerprint === fingerprint) return items[0];
      const item = { id: newId(), documentId: doc.id, at: now, reason, fingerprint, document: doc };
      await this.store.add(item); // add, never put: existing versions are immutable
      const all = [item, ...items], keep = new Set(retainedBackups(all, now).map(value => value.id));
      await this.store.remove(all.filter(value => !keep.has(value.id)).map(value => value.id));
      return item;
    });
    this.queue = work.catch(() => {}); return work;
  }
}
export const backups = new BackupService();
