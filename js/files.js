import { desktopInvoke, exportDesktop } from './desktop.js';
import { createLocalBridge } from './local-files.js';
/** Replace this adapter with native dialogs/storage for a future desktop package. */
export class FileConflictError extends Error {
  constructor(current) {
    super('The local file changed outside ScriptForge. Review it before replacing it, or save your screenplay as a new copy.');
    this.name = 'FileConflictError'; this.current = current;
  }
}

export function fountainFilename(title) {
  return `${title.replace(/[^\p{L}\p{N} _-]/gu, '').trim() || 'Untitled Screenplay'}.fountain`;
}
export async function contentHash(source) {
  const bytes = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
export async function readFountainFile(file) {
  if (!/\.(?:fountain|txt)$/i.test(file.name)) throw new Error('Choose a .fountain or plain-text .txt screenplay.');
  if (file.size > 20 * 1024 * 1024) throw new Error('This file is larger than 20 MB. Choose a plain-text screenplay.');
  let source;
  try { source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await file.arrayBuffer()); }
  catch { throw new Error('This file is not valid UTF-8 text. Re-export it as a UTF-8 Fountain file.'); }
  if (source.includes('\0')) throw new Error('This appears to be a binary file. Choose a plain-text Fountain screenplay.');
  return { source, name: file.name, size: file.size, lastModified: file.lastModified, hash: await contentHash(source) };
}

export function createFileService(environment = globalThis) {
  const bridge = createLocalBridge(environment);
  const types = [{ description: 'Fountain screenplay', accept: { 'text/plain': ['.fountain', '.txt'] } }];
  const pickerOptions = { types, multiple: false, id: 'scriptforge' };
  async function ensurePermission(handle, mode = 'read', request = false) {
    handle = bridge.hydrate(handle);
    if (await handle.queryPermission({ mode }) === 'granted') return;
    if (request && await handle.requestPermission({ mode }) === 'granted') return;
    const error = new Error('Local file access is needed. Use Reconnect file or Screenplay Folder to restore access, or Export a copy.');
    error.name = 'FilePermissionError'; throw error;
  }
  function upload() {
    return new Promise((resolve, reject) => {
      const input = environment.document.createElement('input');
      input.type = 'file'; input.accept = '.fountain,.txt'; input.hidden = true;
      const cancel = () => { input.remove(); reject(new DOMException('File selection cancelled.', 'AbortError')); };
      input.addEventListener('cancel', cancel, { once: true });
      input.addEventListener('change', async () => {
        try { const file = input.files[0]; if (!file) { cancel(); return; } resolve({ ...await readFountainFile(file), handle: null }); }
        catch (error) { reject(error); }
        finally { input.remove(); }
      }, { once: true });
      environment.document.body.append(input); input.click();
    });
  }
  function download(source, name) {
    if (desktopInvoke(environment)) return exportDesktop(source, name, environment);
    const url = environment.URL.createObjectURL(new Blob([source], { type: 'text/plain;charset=utf-8' }));
    const link = environment.document.createElement('a'); link.href = url; link.download = name; link.click();
    environment.setTimeout(() => environment.URL.revokeObjectURL(url), 1000);
    return { kind: 'download', name, hash: null, source };
  }
  return {
    supportsHandles: bridge.native || typeof environment.showOpenFilePicker === 'function',
    supportsSavePicker: bridge.native || typeof environment.showSaveFilePicker === 'function',
    ready: bridge.ready,
    get usesDesktop() { return bridge.native; },
    get usesLocalHelper() { return bridge.available; },
    restoreHandle: bridge.hydrate,
    get supportsDirectories() { return typeof environment.showDirectoryPicker === 'function' || bridge.available; },
    pickDirectory: () => bridge.available ? bridge.call('choose-folder').then(bridge.hydrate) : environment.showDirectoryPicker({ id: 'scriptforge-folder', startIn: 'documents', mode: 'readwrite' }),
    async createInFolder(directory, source, title, id) {
      directory = bridge.hydrate(directory);
      await ensurePermission(directory, 'readwrite', false);
      if (directory.localHelper) { const result = await bridge.call('create', { handle: directory, source, title }); return { ...result, kind: 'file', handle: bridge.hydrate(result.handle) }; }
      const create = async () => {
        const base = fountainFilename(title).replace(/\.fountain$/, '');
        for (let n = 0; n < 100; n++) {
          const name = `${base}${n ? ` (${n + 1})` : ''}.fountain`;
          try { await directory.getFileHandle(name); continue; }
          catch (error) { if (error.name !== 'NotFoundError') throw error; }
          const handle = await directory.getFileHandle(name, { create: true });
          // The API lacks exclusive creation. An origin-wide lock,
          // exclusive writes and an empty-file hash check prevent clobbering.
          const result = await this.write(handle, source, { expectedHash: await contentHash('') });
          return { ...result, handle };
        }
        throw new Error('Could not find an unused screenplay filename. Choose another folder.');
      };
      return environment.navigator?.locks ? environment.navigator.locks.request('scriptforge-new-file', create) : create();
    },
    async retireRenamedFile(directory, oldFile) {
      directory = bridge.hydrate(directory);
      await ensurePermission(directory, 'readwrite', false);
      if (directory.localHelper) {
        try { await bridge.call('remove', { handle: oldFile.handle, expectedHash: oldFile.hash }); }
        catch (error) { if (error.name !== 'NotFoundError') throw error; }
        return;
      }
      let entry;
      try { entry = await directory.getFileHandle(oldFile.name); }
      catch (error) { if (error.name === 'NotFoundError') return; throw error; }
      const current = await this.read(entry);
      if (!await entry.isSameEntry(oldFile.handle) || current.hash !== oldFile.hash) {
        throw new Error('The renamed screenplay is saved, but the previous file changed outside ScriptForge and was preserved.');
      }
      await directory.removeEntry(oldFile.name);
    },
    ensurePermission,
    async open({ importCopy = false } = {}) {
      await bridge.ready;
      if (bridge.native || (!importCopy && bridge.available)) {
        const result = await bridge.call('open-file');
        return { ...result, handle: importCopy ? null : bridge.hydrate(result.handle) };
      }
      if (importCopy || typeof environment.showOpenFilePicker !== 'function') return upload();
      const [handle] = await environment.showOpenFilePicker(pickerOptions);
      return { ...await readFountainFile(await handle.getFile()), handle };
    },
    async read(handle, { request = false } = {}) {
      await ensurePermission(handle, 'read', request);
      if (handle.localHelper) return { ...await bridge.call('read', { handle }), handle: bridge.hydrate(handle) };
      return { ...await readFountainFile(await handle.getFile()), handle };
    },
    pickSave: title => typeof environment.showSaveFilePicker === 'function'
      ? environment.showSaveFilePicker({ ...pickerOptions, suggestedName: fountainFilename(title) })
      : Promise.resolve(null),
    async write(handle, source, { expectedHash = null, request = false, allowNewDestination = false } = {}) {
      handle = bridge.hydrate(handle);
      if (handle.localHelper) {
        // The helper validates its grant, checks the expected hash before and
        // after writing its temporary file, fsyncs and atomically replaces it.
        // A separate permission/read request duplicates that same protected work.
        const hash = allowNewDestination ? (await bridge.call('read', { handle })).hash : expectedHash;
        try { return { ...await bridge.call('write', { handle, source, expectedHash: hash }), kind: 'file', handle: bridge.hydrate(handle) }; }
        catch (error) { if (error.name === 'FileConflictError' && error.current) throw new FileConflictError(error.current); throw error; }
      }
      await ensurePermission(handle, 'readwrite', request);
      let writable;
      try {
        writable = await handle.createWritable({ mode: 'exclusive' });
        const file = await handle.getFile();
        const currentSource = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await file.arrayBuffer());
        const currentHash = await contentHash(currentSource);
        if (!allowNewDestination && (!expectedHash || currentHash !== expectedHash)) {
          throw new FileConflictError({ source: currentSource, hash: currentHash, name: file.name });
        }
        await writable.write(source); await writable.close(); writable = null;
        return { kind: 'file', name: handle.name, hash: await contentHash(source), source, handle };
      } catch (error) { if (writable) await writable.abort().catch(() => {}); throw error; }
    },
    download,
  };
}

export const fileService = createFileService();
