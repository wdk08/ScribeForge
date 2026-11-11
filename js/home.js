import { backups } from './backups.js';
import { setupVoiceLibrary } from './voice-library.js';
import { repository } from './storage.js';
import { fileService, fountainFilename } from './files.js';
import { openFileIntoLibrary, createAutoSavedDraft } from './library.js';
import { exportPDF } from './pdf-export.js';
import { fountainForSaving } from './session.js';
import { setupFolderSetting } from './folder-settings.js';
const $ = id => document.getElementById(id);
const folderSettings = setupFolderSetting($('screenplay-folder'));
let records = [], errorSource, pendingDelete, undoDelete, suspended = false;
function error(message, source = 'action') { errorSource = source; $('library-error').hidden = false; $('library-error').textContent = message; }
const go = id => { location.href = `./editor.html?id=${encodeURIComponent(id)}`; };
function render() {
  const query = $('search').value.toLowerCase().trim();
  const visible = records.filter(record => `${record.title} ${record.fileName ?? ''}`.toLowerCase().includes(query));
  $('library-count').textContent = `${records.length} ${records.length === 1 ? 'screenplay' : 'screenplays'}`;
  const tree = document.createDocumentFragment();
  for (const record of visible) {
    const card = document.createElement('article'); card.className = 'script-card';
    const preview = document.createElement('button'); preview.className = 'script-preview'; preview.setAttribute('aria-label', `Open ${record.title}`);
    const number = document.createElement('span'); number.className = 'preview-page'; number.textContent = '1.'; preview.append(number);
    for (const el of (record.recovery?.document?.elements ?? []).filter(el => ['scene', 'action', 'character', 'dialogue'].includes(el.type)).slice(0, 7)) {
      const p = document.createElement('p'); p.className = `preview-${el.type}`; p.textContent = el.text.slice(0, 190); preview.append(p);
    }
    if (!preview.querySelector('p')) { const p = document.createElement('p'); p.className = 'blank-preview'; p.textContent = 'Every story starts somewhere.'; preview.append(p); }
    const body = document.createElement('div'); body.className = 'card-body';
    const label = document.createElement('span'); label.className = `file-badge ${record.recovery?.dirty ? 'has-recovery' : ''}`;
    label.textContent = !record.fileName ? 'DRAFT · NOT SAVED TO A FILE' : record.recovery?.dirty ? 'UNSAVED CHANGES · RECOVERY AVAILABLE' : record.handle ? 'LINKED LOCAL FILE' : record.downloadOnly ? 'DOWNLOAD COPY' : 'IMPORTED COPY';
    const title = document.createElement('button'); title.className = 'card-title'; title.textContent = record.title;
    const time = document.createElement('time');
    const modified = new Date(record.modifiedAt);
    if (Number.isFinite(modified.getTime())) {
      time.dateTime = modified.toISOString();
      time.textContent = `Edited ${new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(modified)}`;
    } else time.textContent = 'Recently opened';
    const filename = document.createElement('div'); filename.className = 'card-filename'; filename.textContent = record.fileName ?? 'Choose Screenplay Folder for disk autosaving';
    const open = async () => {
      try { if (record.handle && !record.recovery?.dirty) await fileService.ensurePermission(record.handle, 'read', true); } catch { /* Editor offers reconnection and cached-copy options. */ }
      go(record.id);
    };
    preview.addEventListener('click', open); title.addEventListener('click', open);
    const menu = document.createElement('details'); menu.className = 'card-menu';
    const trigger = document.createElement('summary'); trigger.textContent = '⋯'; trigger.setAttribute('aria-label', `Options for ${record.title}`);
    const options = document.createElement('div'); options.className = 'card-menu-options';
    const exportButton = document.createElement('button'); exportButton.textContent = 'Export as Fountain';
    const pdfButton = document.createElement('button'); pdfButton.textContent = 'Export as PDF';
    pdfButton.addEventListener('click', async () => {
      menu.open = false;
      try { const latest = await repository.get(record.id); if (!latest || latest.deletedAt) throw new Error('This screenplay is no longer in the library.'); await exportPDF(latest.recovery.document); }
      catch (failure) { error(`Could not export PDF: ${failure.message}`); }
    });
    const deleteButton = document.createElement('button'); deleteButton.textContent = 'Delete'; deleteButton.className = 'delete-script';
    exportButton.addEventListener('click', async () => {
      menu.open = false;
      try {
        const latest = await repository.get(record.id);
        if (!latest || latest.deletedAt) throw new Error('This screenplay is no longer in the library.');
        let warning;
        await fileService.download(fountainForSaving(latest.recovery.document, { onWarning: text => { warning = text; } }), fountainFilename(latest.title));
        if (warning) error(warning);
      } catch (failure) { error(`Could not export: ${failure.message}`); }
    });
    deleteButton.addEventListener('click', () => {
      menu.open = false; pendingDelete = record;
      $('delete-script-description').textContent = `Remove “${record.title}” from your screenplay library?`;
      $('delete-script-dialog').showModal();
    });
    menu.addEventListener('toggle', () => { if (menu.open) for (const other of document.querySelectorAll('.card-menu[open]')) if (other !== menu) other.open = false; });
    options.append(pdfButton, exportButton, deleteButton); menu.append(trigger, options);
    body.append(menu, label, title, time, filename); card.append(preview, body); tree.append(card);
  }
  $('script-grid').replaceChildren(tree); $('empty-state').hidden = Boolean(visible.length);
  $('empty-title').textContent = records.length ? 'No screenplays match your search.' : 'A blank page. A new possibility.';
  $('empty-text').textContent = records.length ? 'Try another title or clear your search.' : 'Create a screenplay or open a Fountain file to start your library.';
}
let pendingCreation = 0;
window.scriptForgePrepareUpdate = async () => {
  if (pendingCreation) throw new Error('Wait for the screenplay file operation to finish.');
  await backups.queue;
  return () => {};
};
async function action(button, task) {
  if (button.disabled) return;
  if (errorSource === 'action') $('library-error').hidden = true;
  button.disabled = true; pendingCreation++;
  try { go((await task()).id); } catch (failure) { if (failure.name !== 'AbortError') error(failure.message); } finally { button.disabled = false; pendingCreation--; }
}
$('cancel-delete-script').addEventListener('click', () => { pendingDelete = null; $('delete-script-dialog').close(); });
$('confirm-delete-script').addEventListener('click', async () => {
  if (!pendingDelete) return;
  $('confirm-delete-script').disabled = true;
  try {
    await backups.capture(pendingDelete.recovery.document, 'Before Library Removal');
    undoDelete = await repository.archive(pendingDelete.id, pendingDelete.revision);
    pendingDelete = null; $('delete-script-dialog').close();
    $('library-notice-message').textContent = 'Screenplay removed from the library. ';
    $('undo-delete-script').hidden = false; $('library-notice').hidden = false;
    await refreshLibrary();
  } catch (failure) { $('delete-script-dialog').close(); error(`Could not delete: ${failure.message}`); }
  finally { $('confirm-delete-script').disabled = false; }
});
$('undo-delete-script').addEventListener('click', async () => {
  if (!undoDelete) return;
  $('undo-delete-script').disabled = true;
  try {
    await repository.restore(undoDelete.id, undoDelete.revision);
    undoDelete = null; $('library-notice').hidden = true; await refreshLibrary();
  } catch (failure) { error(`Could not undo deletion: ${failure.message}`); }
  finally { $('undo-delete-script').disabled = false; }
});
document.addEventListener('click', event => { for (const menu of document.querySelectorAll('.card-menu[open]')) if (!menu.contains(event.target)) menu.open = false; });
document.addEventListener('keydown', event => { if (event.key === 'Escape') for (const menu of document.querySelectorAll('.card-menu[open]')) { menu.open = false; menu.querySelector('summary').focus(); } });
$('new-screenplay').addEventListener('click', event => action(event.currentTarget, async () => { await folderSettings.beforeCreate(); return createAutoSavedDraft({ deferDisk: true }); }));
$('open-fountain').addEventListener('click', event => action(event.currentTarget, () => openFileIntoLibrary()));
$('import-copy').addEventListener('click', event => action(event.currentTarget, () => openFileIntoLibrary({ importCopy: true })));
$('search').addEventListener('input', render);
$('sample-script').addEventListener('click', () => { location.href = './editor.html?sample=1'; });
let refreshTask = null, refreshAgain = false, renderedRecords = null;
const recordSignature = rows => JSON.stringify(rows.map(row => [row.id, row.revision, row.title,
  row.modifiedAt, row.fileName, Boolean(row.handle), row.downloadOnly, row.recovery?.dirty]));
function refreshLibrary() {
  if (suspended) return Promise.resolve();
  if (refreshTask) { refreshAgain = true; return refreshTask; }
  if (renderedRecords === null) $('library-count').textContent = 'Loading screenplays…';
  refreshTask = (async () => {
    try {
      let latest;
      try { latest = await repository.list(); }
      catch (error) {
        if (error.name !== 'StorageTimeoutError') throw error;
        repository.reconnect(); latest = await repository.list();
      }
      const signature = recordSignature(latest);
      records = latest;
      if (signature !== renderedRecords) { render(); renderedRecords = signature; }
      if (errorSource !== 'action') $('library-error').hidden = true;
      $('memory-editor').hidden = true;
    } catch (failure) {
      error(`Could not refresh your browser library: ${failure.message}`, 'refresh');
      render(); $('memory-editor').hidden = false;
    }
  })().finally(() => {
    refreshTask = null;
    // Publish every successful read; a timer/focus event must never discard it.
    // Coalesce any number of requests during the read into one follow-up.
    if (refreshAgain) { refreshAgain = false; refreshLibrary(); }
  });
  return refreshTask;
}
repository.subscribe(refreshLibrary);
function returnToLibrary() {
  suspended = false;
  for (const id of ['new-screenplay', 'open-fountain', 'import-copy']) $(id).disabled = false;
  $('search').value = '';
  if (renderedRecords !== null) render();
  repository.reconnect();
  refreshLibrary();
}
window.addEventListener('pageshow', returnToLibrary);
window.addEventListener('popstate', returnToLibrary);
document.addEventListener('resume', returnToLibrary);
window.addEventListener('focus', refreshLibrary);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshLibrary(); });
// Some embedded browsers omit restore/focus events and lack cross-tab messaging.
// Refresh while Home is visible as a fallback; cancel the timer when suspended.
let refreshTimer;
function watchLibrary() {
  clearInterval(refreshTimer);
  if (document.visibilityState === 'visible') refreshTimer = setInterval(refreshLibrary, 3000);
}
window.addEventListener('pagehide', () => { suspended = true; refreshAgain = false; clearInterval(refreshTimer); });
window.addEventListener('pageshow', watchLibrary);
document.addEventListener('visibilitychange', watchLibrary);
// Controls become interactive only after their handlers are installed.
for (const id of ['new-screenplay', 'open-fountain', 'import-copy']) $(id).disabled = false;
watchLibrary();
$('search').value = '';
await refreshLibrary();

setupVoiceLibrary();
