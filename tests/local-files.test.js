import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, rm, unlink, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalFiles } from '../scripts/local-files.mjs';

test('local helper preserves grants across restart, replaces edits, numbers conflicts, and retires renames', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'scriptforge-helper-test-'));
  const configPath = join(folder, '.grants.json');
  try {
    let helper = createLocalFiles({ configPath, enabled: true, picker: async () => folder });
    const directory = await helper.run('choose-folder');
    const first = await helper.run('create', { handle: directory, title: 'My Film', source: 'FADE IN:\n' });
    const duplicate = await helper.run('create', { handle: directory, title: 'My Film', source: 'Another film.' });
    assert.equal(first.name, 'My Film.fountain'); assert.equal(duplicate.name, 'My Film (2).fountain');
    const edited = await helper.run('write', { handle: first.handle, expectedHash: first.hash, source: 'Changed.' });
    assert.equal(await readFile(join(folder, first.name), 'utf8'), 'Changed.');
    helper = createLocalFiles({ configPath, enabled: true });
    assert.equal((await helper.run('read', { handle: first.handle })).source, 'Changed.');
    const renamed = await helper.run('create', { handle: directory, title: 'New title', source: edited.source });
    await helper.run('remove', { handle: first.handle, expectedHash: edited.hash });
    assert.equal((await readdir(folder)).includes(first.name), false);
    assert.equal(await readFile(join(folder, renamed.name), 'utf8'), 'Changed.');
    await writeFile(join(folder, duplicate.name), 'Outside edit.');
    await assert.rejects(helper.run('write', { handle: duplicate.handle, expectedHash: duplicate.hash, source: 'Overwrite.' }), { name: 'FileConflictError' });
    await assert.rejects(helper.run('remove', { handle: duplicate.handle, expectedHash: duplicate.hash }), { name: 'FileConflictError' });
    assert.equal(await readFile(join(folder, duplicate.name), 'utf8'), 'Outside edit.');
    await unlink(join(folder, renamed.name));
    await assert.rejects(helper.run('read', { handle: renamed.handle }), { name: 'NotFoundError' });
    const restored = await helper.run('create', { handle: directory, title: 'New title', source: 'Recovered edits.' });
    assert.equal(restored.name, renamed.name);
    await assert.rejects(helper.run('read', { handle: { ...first.handle, name: '../outside.fountain' } }), { name: 'FilePermissionError' });
    await assert.rejects(helper.run('read', { handle: { ...first.handle, token: 'unknown' } }), { name: 'FilePermissionError' });
    await symlink(join(folder, duplicate.name), join(folder, 'Link.fountain'));
    await assert.rejects(helper.run('read', { handle: { ...first.handle, name: 'Link.fountain' } }), { name: 'FilePermissionError' });
  } finally { await rm(folder, { recursive: true, force: true }); }
});
