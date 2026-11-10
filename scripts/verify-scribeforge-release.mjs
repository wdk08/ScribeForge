import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { releaseAPI, releasePage } from '../js/scribeforge/browser-download.js';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const json = async path => JSON.parse(await read(path));
const [pkg, config, dev, cargo, storage, native, vite] = await Promise.all([
  json('package.json'), json('src-tauri/tauri.conf.json'), json('src-tauri/tauri.local.conf.json'),
  read('src-tauri/Cargo.toml'), read('js/scribeforge/storage.js'), read('src-tauri/src/lib.rs'), read('vite.config.js'),
]);
const tag = process.argv[2] ?? `v${pkg.version}-scribeforge`;
assert.match(tag, /^v\d+\.\d+\.\d+-scribeforge$/);
assert.equal(tag, `v${pkg.version}-scribeforge`);
assert.equal(config.version, pkg.version);
assert.equal(pkg.name, 'scribeforge');
assert.equal(config.productName, 'ScribeForge');
assert.equal(config.identifier, 'com.scribeforge.desktop');
assert.equal(dev.identifier, 'com.scribeforge.desktop.dev');
assert.deepEqual(config.bundle.fileAssociations.flatMap(item => item.ext), ['stf']);
assert.equal(config.bundle.createUpdaterArtifacts, false);
assert.equal(config.plugins?.updater, undefined);
assert.match(cargo, /^name = "scribeforge"$/m);
assert.ok(cargo.includes(`version = "${pkg.version}"`));
assert.match(storage, /com\.scribeforge\.desktop\.dev.*com\.scribeforge\.desktop/);
assert.match(native, /app_data_dir\(\)/);
assert.match(vite, /base: '\/ScribeForge\//);
assert.equal(releasePage, 'https://github.com/wdk08/ScribeForge/releases/latest');
assert.equal(releaseAPI, 'https://api.github.com/repos/wdk08/ScribeForge/releases/latest');
await read(`releases/${tag}.md`);
console.log(`Verified ScribeForge ${tag} release identity and storage configuration.`);
