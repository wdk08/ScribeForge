import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { installerPreference, releaseInstallers, releasePage } from '../../js/scribeforge/browser-download.js';
import { assembleRelease, targets } from '../../scripts/release-desktop.mjs';

const names = ['ScribeForge_test_aarch64.dmg', 'ScribeForge_test_x86_64.dmg', 'ScribeForge_test_x64-setup.exe'];
const tag = 'v1.0.1';
const assets = names.map(name => ({
  name, size: 42, state: 'uploaded', browser_download_url: releasePage.replace('/latest', `/download/${tag}/${name}`),
}));

test('download discovery uses actual published assets, rejects other repositories and handles uncertain architecture', () => {
  const release = { tag_name: tag, assets };
  assert.deepEqual(Object.values(releaseInstallers(release)), assets.map(asset => asset.browser_download_url));
  assert.throws(() => releaseInstallers({ ...release, draft: true }), /stable published release/);
  assert.throws(() => releaseInstallers({ ...release, assets: [...assets, assets[0]] }), /safely/);
  const wrongRepo = { ...assets[0], browser_download_url: assets[0].browser_download_url.replace('/ScribeForge/', '/ScriptForge/') };
  assert.throws(() => releaseInstallers({ ...release, assets: [wrongRepo, ...assets.slice(1)] }), /location/);
  assert.equal(installerPreference('Windows', ''), 'windows');
  assert.equal(installerPreference('macOS', 'arm'), 'macArm');
  assert.equal(installerPreference('macOS', 'x86'), 'macIntel');
  assert.equal(installerPreference('MacIntel', ''), null);
});

test('release assembly requires all three packages and leaves updater output disabled without signing', async t => {
  const scratch = await mkdtemp(join(tmpdir(), 'scribeforge-release-'));
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const packages = join(scratch, 'packages');
  const output = join(scratch, 'output');
  for (const [index, target] of Object.keys(targets).entries()) {
    const path = join(packages, target);
    await mkdir(path, { recursive: true });
    await writeFile(join(path, names[index]), 'test installer placeholder');
    await writeFile(join(path, 'metadata.json'), JSON.stringify({ target, installer: names[index], signing: 'unsigned' }));
  }
  const notes = await assembleRelease(packages, output, tag);
  assert.equal(notes.length, 3);
  assert.equal(await readFile(join(output, names[0]), 'utf8'), 'test installer placeholder');
  await assert.rejects(readFile(join(output, 'latest.json')), { code: 'ENOENT' });
  await assert.rejects(assembleRelease(packages, join(scratch, 'missing-signatures'), tag, 'configured-key'), /Signed updater assets are incomplete/);
  await rm(join(packages, Object.keys(targets)[0]), { recursive: true });
  await assert.rejects(assembleRelease(packages, join(scratch, 'partial'), tag), /package descriptor/);
});
