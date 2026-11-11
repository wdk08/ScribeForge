// Copyright (C) 2026 wdk08. SPDX-License-Identifier: GPL-3.0-only
import {readFile,writeFile,readdir,mkdir} from 'node:fs/promises';
import {dirname,join,relative} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const hash=value=>createHash('sha256').update(value).digest('hex');
// Reviewed expressions from the locked graph. New terms require a fresh review.
const terms=new Set(['MIT','Apache-2.0','BSD-2-Clause','BSD-3-Clause','ISC','Zlib','0BSD','Unlicense','CC0-1.0','MIT-0','MPL-2.0','Unicode-3.0','CDLA-Permissive-2.0','GPL-3.0-only']);
export function reviewExpression(expression){
 if(expression==='MIT OR SEE LICENSE IN FEEL-FREE.md')return 'MIT';
 // Prefer MIT/Apache over optional LGPL/LLVM terms when a genuine OR exists.
 if(['MIT OR Apache-2.0 OR LGPL-2.1-or-later','Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT'].includes(expression))return 'MIT';
 if(expression==='Apache-2.0 WITH LLVM-exception')return expression;
 const tokens=expression?.replace(/[()]/g,'').split(/\s+(?:OR|AND)\s+|\s*\/\s*/);
 if(!tokens?.length||tokens.some(token=>!terms.has(token)))throw new Error(`Unreviewed license expression: ${expression??'missing'}`);
 return expression;
}
export async function inventory(){
 const cargo=JSON.parse(execFileSync('cargo',['metadata','--locked','--offline','--format-version','1','--manifest-path','src-tauri/Cargo.toml'],{encoding:'utf8',maxBuffer:20_000_000}));
 const lock=JSON.parse(await readFile('package-lock.json')),records=[],texts=new Map();
 async function notices(dir){
  const files=[];async function scan(folder,depth=0){for(const entry of await readdir(folder,{withFileTypes:true})){const path=join(folder,entry.name);if(entry.isFile()&&/^(?:licen[cs]e|copying|notice|authors|copyright)(?:[._-]|$)|^third.?party.*(?:notices|licenses)/i.test(entry.name)){const bytes=await readFile(path);if(bytes.length>2_000_000)throw new Error('Unexpectedly large license file');const sha=hash(bytes);texts.set(sha,bytes);files.push({path:relative(dir,path).replaceAll('\\','/'),sha256:sha});}else if(entry.isDirectory()&&depth<2&&/^(?:licenses?|legal|third.party)$/i.test(entry.name))await scan(path,depth+1);}}
  await scan(dir);return files.sort((a,b)=>a.path.localeCompare(b.path));
 }
 for(const p of cargo.packages){if(p.name==='scriptforge')continue;records.push({ecosystem:'cargo',name:p.name,version:p.version,declaredLicense:p.license,reviewedLicense:reviewExpression(p.license),source:p.repository??p.source,notices:await notices(dirname(p.manifest_path))});}
 for(const [path,p]of Object.entries(lock.packages)){if(!path)continue;let installed;try{installed=JSON.parse(await readFile(join(path,'package.json')));}catch(error){if(error.code!=='ENOENT')throw error;}
 records.push({ecosystem:'npm',name:installed?.name??path.split('node_modules/').at(-1),version:p.version,declaredLicense:p.license,reviewedLicense:reviewExpression(p.license),development:!!p.dev,source:p.resolved,notices:installed?await notices(path):[],optionalPlatformPackage:!installed&&!!p.optional});}
 records.sort((a,b)=>`${a.ecosystem}/${a.name}/${a.version}`.localeCompare(`${b.ecosystem}/${b.name}/${b.version}`));
 return {manifest:{schema:1,scope:'Locked dependency superset, including build/test and other-target dependencies. Metadata is supplemented by retained upstream notices and source; it is not proof of every embedded binary component.',npmLockSha256:hash(await readFile('package-lock.json')),cargoLockSha256:hash(await readFile('src-tauri/Cargo.lock')),packages:records},texts};
}
export async function verifyPiper(){
 const manifest=JSON.parse(await readFile('third-party/piper-source/manifest.json')),proof=JSON.parse(await readFile('vendor/piper/provenance.json'));
 if(proof.emscripten!==manifest.emscripten||proof.recipe!=='scripts/build-piper.mjs'||JSON.stringify(proof.sources)!==JSON.stringify(manifest.sources.map(({name,commit,sha256})=>({name,commit,sha256}))))throw new Error('Piper build/source provenance does not match.');
 if(hash(await readFile(proof.recipe))!==proof.recipeSha256)throw new Error('Piper build recipe changed; rebuild and test the runtime.');
 for(const p of manifest.sources)if(hash(await readFile(p.file))!==p.sha256)throw new Error(`Piper source mismatch: ${p.name}`);
 for(const [name,sha]of Object.entries(proof.artifacts)){if(!/^piper_phonemize\.(js|wasm|data)$/.test(name)||hash(await readFile(`vendor/piper/${name}`))!==sha)throw new Error(`Piper artifact mismatch: ${name}`);}
 if(Object.keys(proof.artifacts).length!==3)throw new Error('Incomplete Piper provenance.');
 const eigen=JSON.parse(await readFile('third-party/eigen-source.json'));if(hash(await readFile(eigen.file))!==eigen.sha256)throw new Error('Eigen source checksum failed.');
}
if(process.argv[1]?.endsWith('/license-inventory.mjs')){
 await verifyPiper();const {manifest,texts}=await inventory();const target='vendor/licenses';
 if(process.argv.includes('--write')){await mkdir(`${target}/texts`,{recursive:true});for(const [sha,bytes]of texts)await writeFile(`${target}/texts/${sha}.txt`,bytes);await writeFile(`${target}/packages.json`,JSON.stringify(manifest,null,2)+'\n');console.log(`Recorded ${manifest.packages.length} dependencies and ${texts.size} distinct notice texts.`);}
 else {const stored=JSON.parse(await readFile(`${target}/packages.json`));if(stored.npmLockSha256!==manifest.npmLockSha256||stored.cargoLockSha256!==manifest.cargoLockSha256)throw new Error('License inventory is stale; regenerate and review.');const expected=new Map(stored.packages.map(p=>[`${p.ecosystem}/${p.name}/${p.version}`,p]));for(const p of manifest.packages){const recorded=expected.get(`${p.ecosystem}/${p.name}/${p.version}`);if(!recorded||recorded.declaredLicense!==p.declaredLicense||recorded.reviewedLicense!==p.reviewedLicense)throw new Error(`Unrecorded license: ${p.name}`);}for(const p of stored.packages)for(const n of p.notices)if(hash(await readFile(`${target}/texts/${n.sha256}.txt`))!==n.sha256)throw new Error(`Notice changed: ${p.name}`);console.log(`License inventory and Piper provenance verified (${manifest.packages.length} dependencies).`);}
}
