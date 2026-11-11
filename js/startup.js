import { setupDesktopLifecycle } from './desktop.js';
// Keep navigation and an actionable error available even if an app module fails.
const entry = document.querySelector('script[data-entry]').dataset.entry;
try {
  await setupDesktopLifecycle();
  await import(entry === 'editor' ? './editor.js' : './home.js');
  // Update initialization is independent of screenplay startup and never awaited here.
  void import('./updates.js').then(module => module.setupUpdates()).catch(error => console.warn('Update controls unavailable:', error.message));
} catch (error) {
  const alert = document.createElement('section');
  alert.className = 'startup-error'; alert.setAttribute('role', 'alert');
  const message = document.createElement('span');
  message.textContent = `ScriptForge could not start: ${error.message}. Reload to try again.`;
  const retry = document.createElement('button'); retry.textContent = 'Reload';
  retry.addEventListener('click', () => location.reload());
  const home = document.createElement('a'); home.href = './index.html'; home.textContent = 'Home';
  alert.append(message, retry, home);
  document.querySelector('header')?.after(alert);
}
