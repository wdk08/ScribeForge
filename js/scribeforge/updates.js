import { desktop } from './storage.js';
import { errorMessage } from './ui.js';

export function connectUpdates(save = async () => {}) {
  if (!desktop?.event?.listen) return;

  const dialog = document.createElement('dialog');
  dialog.id = 'desktop-update';
  dialog.setAttribute('aria-labelledby', 'desktop-update-title');
  dialog.innerHTML = `
    <h1 id="desktop-update-title">ScribeForge update available</h1>
    <p data-update-version></p>
    <progress aria-label="Update download progress" hidden></progress>
    <p data-update-status role="status"></p>
    <p data-update-error role="alert"></p>
    <div class="dialog-actions">
      <button type="button" class="secondary-button" data-update-later>Later</button>
      <button type="button" class="primary-button" data-update-now>Update Now</button>
    </div>`;
  const version = dialog.querySelector('[data-update-version]');
  const progress = dialog.querySelector('progress');
  const status = dialog.querySelector('[data-update-status]');
  const error = dialog.querySelector('[data-update-error]');
  const later = dialog.querySelector('[data-update-later]');
  const now = dialog.querySelector('[data-update-now]');
  const invoke = command => desktop.core.invoke(`desktop_update_${command}`);
  let active = true;
  let pageGeneration = 0;
  let busy = false;
  let downloading = false;

  function reportProgress({ payload: { downloaded, total } }) {
    if (!downloading) return;
    if (total > 0) {
      progress.max = total;
      progress.value = Math.min(downloaded, total);
      status.textContent = `${Math.floor(progress.value / total * 100)}% downloaded`;
    } else {
      status.textContent = `${Math.floor(downloaded / 1024)} KB downloaded`;
    }
  }

  function dismiss() {
    dialog.close();
    void invoke('dismiss').catch(console.error);
  }
  later.addEventListener('click', dismiss);
  dialog.addEventListener('cancel', event => {
    event.preventDefault();
    if (!busy) dismiss();
  });

  now.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    later.disabled = now.disabled = true;
    if (!dialog.matches(':modal')) {
      dialog.removeAttribute('open');
      dialog.showModal();
    }
    error.textContent = '';
    status.textContent = 'Downloading and verifying the update…';
    progress.removeAttribute('value');
    progress.hidden = false;
    const generation = pageGeneration;
    let installing = false;
    let unlisten;
    let failure = 'Could not download or verify the update.';
    try {
      unlisten = await desktop.event.listen('scribeforge-update-progress', reportProgress);
      downloading = true;
      await invoke('download');
      downloading = false;
      progress.hidden = true;
      if (generation !== pageGeneration) return;
      status.textContent = 'Saving your manuscript…';
      failure = 'Could not save your manuscript. The update was not installed.';
      await save();
      if (generation !== pageGeneration) return;
      status.textContent = 'Installing the update and restarting ScribeForge…';
      failure = 'Could not install the update.';
      await invoke('install');
      installing = true;
    } catch (cause) {
      status.textContent = '';
      error.textContent = `${failure} ${errorMessage(cause)}`;
      now.textContent = 'Retry Update';
    } finally {
      downloading = false;
      progress.hidden = true;
      unlisten?.();
      if (!installing) {
        busy = false;
        later.disabled = now.disabled = false;
        if (generation !== pageGeneration) status.textContent = '';
      }
    }
  });

  async function check() {
    try {
      const update = await invoke('check');
      if (!active || !update) return;
      version.textContent = `Version ${update.version} will restart ScribeForge after installation.`;
      document.body.append(dialog);
      // Show a notification without moving focus or interrupting typing.
      dialog.setAttribute('open', '');
    } catch (cause) {
      console.warn('ScribeForge could not check for updates:', errorMessage(cause));
    }
  }

  window.addEventListener('pagehide', () => { active = false; pageGeneration++; });
  window.addEventListener('pageshow', event => {
    if (event.persisted) {
      active = true;
      if (!busy) void check();
    }
  });
  void check();
  return { get busy() { return busy; } };
}
