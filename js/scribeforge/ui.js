import { decodeManuscript, defaultSettings, newManuscript, schema, validateSettings } from './model.js';
import { readImport } from './formats.js';
import { desktop } from './storage.js';
import { setupBrowserDownload } from './browser-download.js';

if (typeof window !== 'undefined') {
  setupBrowserDownload();
  try {
    const previousKeys = Object.keys(localStorage).filter(key => key.startsWith('storyforge.'));
    for (const key of previousKeys) {
      const value = localStorage.getItem(key);
      const destination = `scribeforge.${key.slice('storyforge.'.length)}`;
      if (value !== null && localStorage.getItem(destination) === null) localStorage.setItem(destination, value);
    }
  } catch { /* A browser can restrict access to preferences. */ }
}

if (typeof __SCRIBEFORGE_OFFLINE__ !== 'undefined' && __SCRIBEFORGE_OFFLINE__ && 'serviceWorker' in navigator) {
  void navigator.serviceWorker.register('./offline.js').catch(error => console.warn('Offline shell setup failed:', error));
}

export const $ = id => document.getElementById(id);
export const errorMessage = error => error?.message ?? String(error);
export const documentURL = id => `./editor.html?id=${encodeURIComponent(id)}`;

export function getPreference(key, fallback) {
  try { return JSON.parse(localStorage.getItem(`scribeforge.${key}`)) ?? fallback; }
  catch { return fallback; }
}
export function setPreference(key, value) {
  localStorage.setItem(`scribeforge.${key}`, JSON.stringify(value));
}
export function manuscriptDefaults() {
  const settings = getPreference('defaults', defaultSettings);
  try { return validateSettings(settings); }
  catch { return defaultSettings; }
}

export async function createManuscript(store) {
  const manuscript = newManuscript('Untitled Manuscript', manuscriptDefaults());
  await store.put(manuscript);
  return manuscript.documentId;
}

function stableJSON(value) {
  return JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
}

export async function addImport(store, manuscript) {
  const existing = await store.get(manuscript.documentId, { includeDeleted: true });
  if (existing && !existing.recovered && !existing.deletedAt) {
    const current = existing.current;
    if (stableJSON(current.metadata) === stableJSON(manuscript.metadata) &&
      stableJSON(current.settings) === stableJSON(manuscript.settings) &&
      stableJSON(current.cover) === stableJSON(manuscript.cover) &&
      schema.nodeFromJSON(current.content).eq(schema.nodeFromJSON(manuscript.content))) return manuscript.documentId;
  }
  if (existing) {
    const message = existing.deletedAt ? 'This manuscript was removed from your library. Import this file as a new manuscript?' :
      'A different version of this manuscript is already in your library. Import this version as a new manuscript?';
    if (!window.confirm(message)) return null;
    manuscript = { ...manuscript, documentId: crypto.randomUUID() };
  }
  await store.put(manuscript);
  return manuscript.documentId;
}

export function connectImport(store, navigate, showError) {
  const picker = $('import-picker');
  let processing = false;
  async function importFiles(load) {
    if (processing) return;
    processing = true;
    try {
      const results = await load();
      let lastId;
      for (const result of results) {
        if (result.error) { showError(result.error); continue; }
        if (result.warnings.length && !window.confirm(`Import with these changes?\n\n${result.warnings.join('\n')}`)) continue;
        lastId = await addImport(store, result.manuscript) ?? lastId;
      }
      if (lastId) await navigate(lastId);
    } catch (error) { showError(errorMessage(error)); }
    finally { processing = false; }
  }
  $('import').addEventListener('click', () => {
    if (!desktop) { picker.click(); return; }
    void importFiles(async () => {
      let payload;
      try { payload = await desktop.core.invoke('desktop_import'); }
      catch (error) { if (error?.name === 'AbortError') return []; throw error; }
      const bytes = new Uint8Array(payload);
      const size = new DataView(bytes.buffer).getUint32(0, true);
      const name = new TextDecoder().decode(bytes.subarray(4, 4 + size));
      return [await readImport(new File([bytes.subarray(4 + size)], name))];
    });
  });
  picker.addEventListener('change', () => {
    const file = picker.files[0];
    picker.value = '';
    if (file) void importFiles(async () => [await readImport(file)]);
  });
  if (!desktop) return;
  const openAssociated = () => importFiles(async () => {
    const entries = await desktop.core.invoke('associated_manuscripts');
    return entries.map(entry => {
      if (entry.error) return entry;
      try { return { manuscript: decodeManuscript(entry.source), warnings: [] }; }
      catch (error) { return { error: `${entry.name} · ${errorMessage(error)}` }; }
    });
  });
  desktop.event.listen('scribeforge-open-requested', openAssociated)
    .then(openAssociated).catch(error => showError(errorMessage(error)));
}

export function connectDesktopClose(flush, showError, updateBusy = () => false) {
  if (!desktop) return;
  let closing = false;
  desktop.event.listen('scribeforge-close-requested', async () => {
    if (closing || updateBusy()) return;
    closing = true;
    try {
      await flush();
      await desktop.core.invoke('desktop_close');
    } catch (error) { showError(errorMessage(error)); }
    finally { closing = false; }
  }).catch(error => showError(errorMessage(error)));
}

export async function exportBytes(name, data, mime) {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  if (desktop) {
    try { await desktop.core.invoke('desktop_export', { name, bytes: Array.from(bytes) }); }
    catch (error) { if (error?.name !== 'AbortError') throw error; }
    return;
  }
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export function fileName(title) {
  return title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim().replace(/\.+$/, '').slice(0, 120) || 'Manuscript';
}
