export function desktopInvoke(environment = globalThis) {
  const invoke = environment.__TAURI__?.core?.invoke;
  return typeof invoke === 'function' ? invoke : null;
}
export const isDesktop = () => Boolean(desktopInvoke());
export async function invokeDesktop(command, args = {}, environment = globalThis) {
  const invoke = desktopInvoke(environment);
  if (!invoke) throw new Error('The native desktop runtime is unavailable.');
  try { return await invoke(command, args); }
  catch (failure) { throw Object.assign(new Error(failure?.message ?? String(failure)), typeof failure === 'object' ? failure : {}); }
}
export async function exportDesktop(data, name, environment = globalThis) {
  const bytes = data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : new TextEncoder().encode(data);
  return invokeDesktop('desktop_export', { name, bytes: Array.from(bytes) }, environment);
}
export class DesktopBackupStore {
  list(documentId) { return invokeDesktop('desktop_backups', { action: 'list', body: { documentId } }); }
  add(snapshot) { return invokeDesktop('desktop_backups', { action: 'add', body: { snapshot } }); }
  remove(ids) { return invokeDesktop('desktop_backups', { action: 'remove', body: { ids } }); }
}

/** Native close requests wait for editor persistence rather than killing a pending write. */
export async function setupDesktopLifecycle(environment = globalThis) {
  if (!desktopInvoke(environment) || !environment.__TAURI__?.event?.listen) return;
  let closing = false, active = true, unlisten = null, generation = 0;
  const detach = () => { active = false; generation++; unlisten?.(); unlisten = null; };
  const attach = async () => {
    active = true; const token = ++generation;
    const release = await environment.__TAURI__.event.listen('scriptforge-close-requested', async () => {
    if (!active || token !== generation) return;
    if (closing) return; closing = true;
    try { await environment.scriptForgeBeforeClose?.(); await invokeDesktop('desktop_close', {}, environment); }
    catch (error) {
      const dialog = environment.document.createElement('dialog'), title = environment.document.createElement('h1');
      title.textContent = 'Saving has not finished';
      const message = environment.document.createElement('p'); message.textContent = `${error.message} Your work remains open. Keep editing to retry or Export a copy before closing.`;
      const keep = environment.document.createElement('button'); keep.textContent = 'Keep editing'; keep.className = 'primary-button';
      const close = environment.document.createElement('button'); close.textContent = 'Close anyway'; close.className = 'quiet-button';
      keep.onclick = () => { dialog.close(); dialog.remove(); closing = false; };
      close.onclick = () => invokeDesktop('desktop_close', {}, environment);
      dialog.addEventListener('cancel', () => { closing = false; dialog.remove(); });
      dialog.append(title, message, keep, close); environment.document.body.append(dialog); dialog.showModal();
    }
    });
    // Navigation can win the asynchronous IPC registration race.
    if (!active || token !== generation) release(); else unlisten = release;
  };
  environment.addEventListener('pagehide', detach);
  environment.addEventListener('pageshow', event => { if (event.persisted && !unlisten) attach().catch(console.error); });
  await attach();
  return detach;
}
