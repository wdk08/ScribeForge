import { backups } from './backups.js';
import { withWriterProfile } from './title-page.js';
import { repository } from './storage.js';
import { fileService } from './files.js';
import { draftRecord, recordForFile, DocumentSession } from './session.js';

export async function openFileIntoLibrary({ importCopy = false, store = repository, files = fileService } = {}) {
  const opened = await files.open({ importCopy });
  return importOpenedFile(opened, store);
}
export async function importOpenedFile(opened, store = repository) {
  const existing = opened.handle ? await store.findHandle(opened.handle) : null;
  if (existing?.recovery?.dirty) return existing;
  if (existing && existing.fileHash === opened.hash) return existing;
  if (existing) await backups.capture(existing.recovery.document, 'Before File Import');
  const record = await recordForFile(opened, existing);
  try { return await store.put(record, existing?.revision ?? null); }
  catch (error) {
    if (!opened.handle || error.name !== 'DataCloneError') throw error;
    // Some embedded pickers return handles that can read files but cannot be
    // persisted. Keep the parsed screenplay as an explicitly labeled copy.
    return store.put({ ...record, handle: null,
      fileReferenceWarning: 'This browser could not store the file reference. Your screenplay was imported as a copy; choose Screenplay Folder for disk autosaving.' }, existing?.revision ?? null);
  }
}
export async function createDraft(store = repository) {
  const record = draftRecord();
  record.recovery.document = withWriterProfile(record.recovery.document, await store.getPreference('writerProfile', {}));
  return store.put(record);
}

export async function createAutoSavedDraft({ store = repository, files = fileService, deferDisk = false } = {}) {
  let record = await createDraft(store);
  if (deferDisk) return record;
  let directory;
  try { directory = await store.getPreference('screenplayFolder', null); }
  catch (error) { return { ...record, folderSaveError: error.message }; }
  if (!directory) return record;
  const session = new DocumentSession(store, files, record);
  try { await session.saveToFolder(directory); record = session.record; }
  catch (error) {
    record = { ...session.record, folderPending: !session.record.handle, folderSaveError: error.message };
    try { record = await store.put(record, session.record.revision); }
    catch { /* The initial draft already exists; open it even if disk metadata cannot be committed. */ }
  } finally { session.dispose(); }
  return record;
}
