import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,mkdir,rm} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {reviewExpression,verifyPiper} from '../scripts/license-inventory.mjs';
import {sourcePathAllowed,digest,verifySourceTree} from '../scripts/source-release.mjs';
import {desktopAssets} from '../scripts/build-desktop.mjs';

test('releases carry GPL terms and notices inside the desktop assets',async()=>{
 const license=await readFile('LICENSE','utf8');assert.match(license,/GNU GENERAL PUBLIC LICENSE/);assert.match(license,/Version 3, 29 June 2007/);
 for(const file of ['LICENSE','COPYRIGHT','THIRD_PARTY_NOTICES.md','SOURCE_CODE.md'])assert.ok(desktopAssets.includes(file));
 const pkg=JSON.parse(await readFile('package.json')),lock=JSON.parse(await readFile('package-lock.json'));assert.equal(pkg.license,'GPL-3.0-only');assert.equal(lock.packages[''].license,pkg.license);
});
test('Piper artifacts match recorded sources and retain real source-build provenance',async()=>{
 await verifyPiper();const proof=JSON.parse(await readFile('vendor/piper/provenance.json'));assert.equal(proof.build,'ScriptForge source build');assert.equal(proof.sources.length,3);
 assert.equal(proof.artifacts['piper_phonemize.wasm'],digest(await readFile('vendor/piper/piper_phonemize.wasm')));
 const refresh=await readFile('scripts/vendor-tts.mjs','utf8');assert.ok(!refresh.includes('node_modules/@diffusionstudio/piper-wasm/build/'));
});
test('new or restrictive dependency terms cannot silently pass the reviewed inventory',()=>{
 for(const license of [undefined,'Proprietary','GPL-2.0-only','CC-BY-NC-4.0','MIT AND Proprietary'])assert.throws(()=>reviewExpression(license),/Unreviewed/);
 assert.equal(reviewExpression('MIT OR Apache-2.0 OR LGPL-2.1-or-later'),'MIT');assert.equal(reviewExpression('MPL-2.0'),'MPL-2.0');assert.equal(reviewExpression('Apache-2.0 AND ISC'),'Apache-2.0 AND ISC');
});
test('source archives exclude private storage, secrets, traversal and build output',()=>{
 for(const path of ['../secret','.git/config','/private/file','C:\\secret','dist/app','validation/old.pdf','recovery/draft','src-tauri/target/app','node_modules/package/x','.env.production','keys/updater.key','data/private.db'])assert.equal(sourcePathAllowed(path),false,path);
 for(const path of ['LICENSE','js/editor.js','tests/fixtures/complex.fountain','third-party/piper-source/espeak-ng.tar.gz','.env.example'])assert.equal(sourcePathAllowed(path),true,path);
});
test('release workflow gates installers on matching corresponding-source upload',async()=>{
 const source=await readFile('.github/workflows/release.yml','utf8');assert.match(source,/needs: \[draft, source\]/);assert.match(source,/npm run release:source/);assert.match(source,/Corresponding-source asset missing; refusing publication/);
});
test('source snapshot verification rejects changed or private content before packaging',async()=>{
 const root=await mkdtemp(join(tmpdir(),'scriptforge-source-verification-'));
 try{const files=[];for(const file of ['LICENSE','COPYRIGHT','THIRD_PARTY_NOTICES.md','SOURCE_CODE.md','scripts/build-piper.mjs','vendor/piper/provenance.json']){await mkdir(dirname(join(root,'app',file)),{recursive:true});await writeFile(join(root,'app',file),'source');files.push({path:`app/${file}`,sha256:digest('source')});}await mkdir(join(root,'app/.cargo'));await writeFile(join(root,'app/.cargo/config.toml'),'directory = "../dependencies/cargo"');await writeFile(join(root,'SOURCE-MANIFEST.json'),JSON.stringify({files}));await verifySourceTree(root);await writeFile(join(root,'app/LICENSE'),'changed');await assert.rejects(verifySourceTree(root),/snapshot changed/);files[0]={path:'app/.env',sha256:digest('source')};await writeFile(join(root,'SOURCE-MANIFEST.json'),JSON.stringify({files}));await assert.rejects(verifySourceTree(root),/Private path/);}finally{await rm(root,{recursive:true,force:true});}
});
