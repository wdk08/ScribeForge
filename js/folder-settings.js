import { repository } from './storage.js';
import { fileService } from './files.js';

export function setupFolderSetting(button, { onChange = () => {} } = {}) {
  const dialog = document.createElement('dialog');
  const heading = document.createElement('h1'); heading.textContent = 'Screenplay Folder';
  const description = document.createElement('p');
  description.textContent = 'Recommended: Documents/ScriptForge. Select or create that folder in the picker, or choose any folder. New scripts save there; files opened elsewhere keep their original location.';
  const status = document.createElement('p'); status.className = 'dialog-note';
  const error = document.createElement('p'); error.setAttribute('role', 'alert'); error.hidden = true;
  const actions = document.createElement('div'); actions.className = 'dialog-actions';
  const choose = document.createElement('button'); choose.className = 'primary-button'; choose.textContent = 'Choose folder'; choose.id = 'choose-screenplay-folder';
  const grant = document.createElement('button'); grant.className = 'secondary-button'; grant.textContent = 'Allow folder access'; grant.id = 'grant-screenplay-folder';
  const close = document.createElement('button'); close.className = 'secondary-button'; close.textContent = 'Continue without folder'; close.id = 'folder-close';
  actions.append(close, grant, choose); dialog.append(heading, description, status, error, actions); document.body.append(dialog);
  dialog.id = 'folder-dialog';
  let directory, prompted = false, finish;
  const ready = Promise.all([fileService.ready, repository.getPreference('screenplayFolder', null), repository.getPreference('screenplayFolderPrompted', false)])
    .then(([, handle, asked]) => { directory = fileService.restoreHandle(handle); prompted = asked; })
    .catch(failure => { error.textContent = failure.message; error.hidden = false; });
  function update() {
    choose.disabled = !fileService.supportsDirectories;
    grant.hidden = !directory || !fileService.supportsDirectories;
    status.textContent = !fileService.supportsDirectories
      ? 'This browser does not support directory access. Open ScriptForge at http://localhost:4173 with its local helper running for folder autosaving in Safari. Recovery still saves in this browser; Export downloads a copy.'
      : directory ? `Selected folder: ${directory.name}${fileService.usesDesktop ? ' · native desktop saving' : fileService.usesLocalHelper ? ' · local saving helper' : ''}. Use Allow folder access if permission expires; you do not need to select it again.`
      : 'No folder selected. Until you choose one, drafts use browser recovery; Export downloads a copy.';
  }
  function done() { dialog.close(); finish?.(); finish = null; }
  close.addEventListener('click', done);
  dialog.addEventListener('cancel', event => { event.preventDefault(); done(); });
  grant.addEventListener('click', async () => {
    grant.disabled = true; error.hidden = true;
    try {
      const permission = await directory.requestPermission({ mode: 'readwrite' });
      if (permission !== 'granted') throw new Error('Folder access was not granted. Changes remain in browser recovery.');
      done(); await onChange(directory);
    } catch (failure) { error.textContent = failure.message; error.hidden = false; }
    finally { grant.disabled = false; }
  });
  choose.addEventListener('click', async () => {
    // Invoke the picker directly on this gesture, before any IndexedDB awaits.
    choose.disabled = true; error.hidden = true;
    try {
      const picked = await fileService.pickDirectory();
      await fileService.ensurePermission(picked, 'readwrite', true);
      await repository.setPreference('screenplayFolder', picked);
      await repository.setPreference('screenplayFolderPrompted', true);
      directory = picked; prompted = true; update(); done(); await onChange(picked);
    } catch (failure) {
      if (failure.name !== 'AbortError') { error.textContent = `Folder selection failed: ${failure.message}`; error.hidden = false; }
    } finally { update(); }
  });
  button.addEventListener('click', async () => { await ready; close.textContent = 'Done'; update(); dialog.showModal(); });
  return {
    async beforeCreate() {
      await ready;
      if (!fileService.supportsDirectories || directory || prompted) return;
      prompted = true;
      try { await repository.setPreference('screenplayFolderPrompted', true); } catch { /* The dialog still lets the user choose a folder or continue. */ }
      close.textContent = 'Continue without folder'; update(); dialog.showModal();
      await new Promise(resolve => { finish = resolve; });
    },
  };
}
