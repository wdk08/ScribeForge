import { readFile, writeFile, stat, open, rename, unlink, realpath } from 'node:fs/promises';
import { resolve, basename, dirname, join } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute = promisify(execFile);
const hash = source => createHash('sha256').update(source).digest('hex');
export async function nativePick(kind) {
  const script = kind === 'folder'
    ? 'POSIX path of (choose folder with prompt "Choose your Screenplay Folder. Recommended: Documents/ScriptForge" default location (path to documents folder))'
    : 'POSIX path of (choose file with prompt "Open a Fountain screenplay")';
  try { return (await execute('/usr/bin/osascript', ['-e', script])).stdout.trim(); }
  catch (error) { if (error.stderr?.includes('-128')) { error.name = 'AbortError'; } throw error; }
}
export function createLocalFiles({ configPath, picker = nativePick, enabled = process.platform === 'darwin' }) {
  let state, queue = Promise.resolve();
  async function settings() {
    if (state) return state;
    try { state = JSON.parse(await readFile(configPath, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; state = { grants: {} }; }
    return state;
  }
  async function grant(path, kind) {
    const data = await settings(), token = randomBytes(32).toString('hex');
    const canonical = await realpath(path);
    data.grants[token] = { path: canonical, kind };
    const pendingConfig = `${configPath}.${randomBytes(8).toString('hex')}.tmp`;
    try { await writeFile(pendingConfig, JSON.stringify(data), { mode: 0o600, flag: 'wx' }); await rename(pendingConfig, configPath); }
    finally { await unlink(pendingConfig).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
    return { localHelper: true, token, kind, name: basename(canonical) };
  }
  const failure = (name, message) => Object.assign(new Error(message), { name });
  async function pathFor(handle) {
    const grant = (await settings()).grants[handle?.token];
    if (!grant) throw failure('FilePermissionError', 'Local folder access is unavailable. Choose Screenplay Folder again.');
    if (grant.kind === 'file') {
      if (handle.kind !== 'file') throw failure('FilePermissionError', 'Invalid file reference.');
      try { if (await realpath(grant.path) !== grant.path) throw failure('FilePermissionError', 'The selected file path changed. Select it again.'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      return grant.path;
    }
    if (await realpath(grant.path) !== grant.path) throw failure('FilePermissionError', 'The selected folder path changed. Select it again.');
    if (handle.kind === 'directory') return grant.path;
    if (handle.kind !== 'file' || !handle.name || basename(handle.name) !== handle.name || !/\.(fountain|txt)$/i.test(handle.name)) throw failure('FilePermissionError', 'Invalid screenplay filename.');
    const path = join(grant.path, handle.name);
    try { if (await realpath(path) !== path) throw failure('FilePermissionError', 'Symbolic links are not writable through this helper.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    return path;
  }
  async function perform(action, body = {}) {
    if (action === 'status') return { available: enabled };
    if (!enabled) throw failure('FilePermissionError', 'The local helper is not available on this platform.');
    if (action === 'choose-folder') return grant(await picker('folder'), 'directory');
    if (action === 'open-file') {
      const path = await picker('file');
      if (!/\.(fountain|txt)$/i.test(path)) throw failure('Error', 'Choose a .fountain or .txt screenplay.');
      const handle = await grant(path, 'file');
      return { ...await perform('read', { handle }), handle };
    }
    const path = await pathFor(body.handle);
    if (action === 'same-entry') return { same: path === await pathFor(body.other) };
    if (action === 'permission') { await stat(body.handle.kind === 'directory' ? path : dirname(path)); return { permission: 'granted' }; }
    if (action === 'read') {
      const info = await stat(path);
      if (!info.isFile() || info.size > 20 * 1024 * 1024) throw failure('Error', 'Choose a text screenplay smaller than 20 MB.');
      const source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await readFile(path));
      if (source.includes('\0')) throw failure('Error', 'Choose a plain-text Fountain screenplay.');
      return { source, hash: hash(source), name: basename(path) };
    }
    if (action === 'create') {
      if (body.handle.kind !== 'directory') throw failure('FilePermissionError', 'Choose a folder first.');
      const base = String(body.title).replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 180) || 'Untitled Screenplay';
      for (let n = 0; n < 100; n++) {
        const name = `${base}${n ? ` (${n + 1})` : ''}.fountain`, target = join(path, name);
        let file;
        try { file = await open(target, 'wx', 0o600); }
        catch (error) { if (error.code === 'EEXIST') continue; throw error; }
        try { await file.writeFile(body.source, 'utf8'); await file.sync(); }
        catch (error) { const owned = await file.stat(); const actual = await stat(target); if (owned.ino === actual.ino && owned.dev === actual.dev) await unlink(target); throw error; }
        finally { await file.close(); }
        return { name, source: body.source, hash: hash(body.source), handle: { localHelper: true, token: body.handle.token, kind: 'file', name } };
      }
      throw failure('Error', 'No unused filename is available.');
    }
    if (action === 'write' || action === 'remove') {
      const current = await perform('read', { handle: body.handle });
      if (!body.expectedHash || current.hash !== body.expectedHash) throw Object.assign(failure('FileConflictError', 'The local file changed outside ScriptForge. Review it before replacing.'), { current });
      if (action === 'remove') { await unlink(path); return {}; }
      const temporary = join(dirname(path), `.scriptforge-${randomBytes(16).toString('hex')}.tmp`);
      try {
        const file = await open(temporary, 'wx', 0o600);
        try { await file.writeFile(body.source, 'utf8'); await file.sync(); }
        catch (error) { const owned = await file.stat(); const actual = await stat(target); if (owned.ino === actual.ino && owned.dev === actual.dev) await unlink(target); throw error; }
        finally { await file.close(); }
        const latest = await perform('read', { handle: body.handle });
        if (latest.hash !== body.expectedHash) throw Object.assign(failure('FileConflictError', 'The file changed while saving.'), { current: latest });
        await rename(temporary, path);
      } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
      return { name: basename(path), source: body.source, hash: hash(body.source) };
    }
    throw failure('Error', 'Unknown local file operation.');
  }
  return { run(action, body) {
    const result = queue.then(() => perform(action, body)).catch(error => {
      if (error.code === 'ENOENT') error.name = 'NotFoundError';
      if (['EACCES', 'EPERM'].includes(error.code)) error.name = 'FilePermissionError';
      throw error;
    }); queue = result.catch(() => {}); return result;
  } };
}
