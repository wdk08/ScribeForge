import { desktopInvoke, invokeDesktop } from './desktop.js';
export function createLocalBridge(environment) {
  const native = Boolean(desktopInvoke(environment));
  let available = native;
  async function call(action, body = {}) {
    if (native) return invokeDesktop('desktop_local', { action, body }, environment);
    let response;
    try { response = await environment.fetch(`/api/local-files/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-ScriptForge-Local': '1' }, body: JSON.stringify(body) }); }
    catch { throw new Error('The local saving helper is offline. Keep ScriptForge running with npm start; your edits remain in browser recovery.'); }
    const result = await response.json();
    if (!response.ok) throw Object.assign(new Error(result.error?.message ?? 'Local saving failed.'), result.error);
    return result;
  }
  function hydrate(handle) {
    if (!handle?.localHelper || handle.queryPermission) return handle;
    Object.defineProperties(handle, {
      queryPermission: { value: async () => (await call('permission', { handle })).permission },
      requestPermission: { value: async () => (await call('permission', { handle })).permission },
      isSameEntry: { value: async other => (await call('same-entry', { handle, other })).same },
      getFileHandle: { value: async name => { const entry = hydrate({ localHelper: true, token: handle.token, kind: 'file', name }); await call('read', { handle: entry }); return entry; } },
    });
    return handle;
  }
  const ready = !native && environment.fetch && environment.location?.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(environment.location.hostname) && !environment.scriptForgeLocalHelperDisabled && typeof environment.showDirectoryPicker !== 'function'
    ? call('status').then(result => { available = result.available; }).catch(() => {}) : Promise.resolve();
  return { call, hydrate, ready, get native() { return native; }, get available() { return available; } };
}
