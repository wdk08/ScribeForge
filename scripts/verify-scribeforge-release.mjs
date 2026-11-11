import assert from 'node:assert/strict';
import { releaseNotesPath } from './release-desktop.mjs';
import { readFile } from 'node:fs/promises';
import { releaseAPI, releasePage } from '../js/scribeforge/browser-download.js';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const json = async path => JSON.parse(await read(path));
const [pkg, lock, config, dev, cargo, cargoLock, storage, native, vite, home, readme] = await Promise.all([
  json('package.json'), json('package-lock.json'), json('src-tauri/tauri.conf.json'), json('src-tauri/tauri.local.conf.json'),
  read('src-tauri/Cargo.toml'), read('src-tauri/Cargo.lock'), read('js/scribeforge/storage.js'), read('src-tauri/src/lib.rs'), read('vite.config.js'), read('index.html'), read('README.md'),
]);
const tag = process.argv[2] ?? `v${pkg.version}`;
assert.match(pkg.version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
assert.ok(tag === `v${pkg.version}` || tag === 'v1.0.0-scribeforge' && pkg.version === '1.0.0', 'Tag and application version must match.');
assert.equal(config.version, pkg.version);
assert.equal(lock.version, pkg.version);
assert.equal(lock.packages[''].version, pkg.version);
assert.ok(home.includes(`<span>ScribeForge ${pkg.version}</span>`));
assert.equal(readme.split(/\r?\n/)[0], `# ScribeForge ${pkg.version}`);
assert.equal(pkg.name, 'scribeforge');
assert.equal(config.productName, 'ScribeForge');
assert.equal(config.identifier, 'com.scribeforge.desktop');
assert.equal(dev.identifier, 'com.scribeforge.desktop.dev');
assert.deepEqual(config.bundle.fileAssociations.flatMap(item => item.ext), ['stf']);
assert.equal(config.bundle.createUpdaterArtifacts, false);
assert.deepEqual(config.plugins?.updater, {
  endpoints: [`${releasePage}/download/latest.json`],
  pubkey: '',
  requireSignedVersion: true,
});
assert.match(cargo, /^name = "scribeforge"$/m);
assert.equal(cargo.match(/^\[package\]\r?\nname = "scribeforge"\r?\nversion = "([^"]+)"/m)?.[1], pkg.version);
assert.equal(cargoLock.match(/^name = "scribeforge"\r?\nversion = "([^"]+)"/m)?.[1], pkg.version);
assert.match(storage, /com\.scribeforge\.desktop\.dev.*com\.scribeforge\.desktop/);
assert.match(native, /app_data_dir\(\)/);
assert.match(vite, /base: '\/ScribeForge\//);
assert.equal(releasePage, 'https://github.com/wdk08/ScribeForge/releases/latest');
assert.equal(releaseAPI, 'https://api.github.com/repos/wdk08/ScribeForge/releases/latest');
assert.ok((await read(releaseNotesPath(tag))).trim(), "Release notes must contain text.");
console.log(`Verified ScribeForge ${tag} release identity and storage configuration.`);
