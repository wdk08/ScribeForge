// Copyright (C) 2026 wdk08. SPDX-License-Identifier: GPL-3.0-only
// Read-only: prevent publishing old speech binaries without their source records.
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
export function auditReleaseHistory(directory='.'){
 const git=args=>execFileSync('git',args,{cwd:directory,maxBuffer:50_000_000,stdio:['ignore','pipe','pipe']});
 if(git(['rev-parse','--is-shallow-repository']).toString().trim()==='true')throw new Error('Full history is required for publication review; use a full clone.');
 const paths=['vendor/piper/piper_phonemize.js','vendor/piper/piper_phonemize.wasm','vendor/piper/piper_phonemize.data','vendor/piper/provenance.json'];
 const commits=[...new Set(git(['log','--format=%H','HEAD','--',...paths]).toString().trim().split('\n').filter(Boolean))];
 const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
 for(const commit of commits){
  const show=path=>{try{return git(['show',`${commit}:${path}`]);}catch{throw new Error(`Historical speech snapshot ${commit.slice(0,7)} lacks ${path}; preserve it locally and publish a clean licensed snapshot instead.`);}};
  if(!git(['ls-tree',commit,'--',paths[1]]).length)continue;
  if(!show('LICENSE').toString().includes('GNU GENERAL PUBLIC LICENSE'))throw new Error('Historical GPL license is missing.');
  const proof=JSON.parse(show('vendor/piper/provenance.json')),sources=JSON.parse(show('third-party/piper-source/manifest.json'));
  for(const path of paths.slice(0,3))if(hash(show(path))!==proof.artifacts?.[path.split('/').at(-1)])throw new Error(`Historical speech bytes mismatch in ${commit.slice(0,7)}.`);
  if(proof.recipe!=='scripts/build-piper.mjs'||hash(show(proof.recipe))!==proof.recipeSha256)throw new Error('Historical speech build recipe mismatch.');
  if(JSON.stringify(proof.sources)!==JSON.stringify(sources.sources.map(({name,commit,sha256})=>({name,commit,sha256}))))throw new Error('Historical speech source mapping mismatch.');
  for(const source of sources.sources){if(!/^third-party\/piper-source\/[a-z-]+\.tar\.gz$/.test(source.file)||hash(show(source.file))!==source.sha256)throw new Error('Historical speech source archive mismatch.');}
 }
 return commits.length;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 try{console.log(`Publication history verified (${auditReleaseHistory()} speech snapshots).`);}catch(error){console.error(error.message);process.exitCode=1;}
}
