// Copyright (C) 2026 wdk08. SPDX-License-Identifier: GPL-3.0-only
import {readdir,readFile,writeFile} from 'node:fs/promises';
import {join,resolve,basename} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
export async function createArtifactChecksums(directory){
 const artifacts=[];
 async function visit(folder){for(const entry of await readdir(folder,{withFileTypes:true})){const file=join(folder,entry.name);if(entry.isDirectory()&&!entry.name.endsWith('.app'))await visit(file);else if(entry.isFile()&&/(?:\.dmg|\.app\.tar\.gz|\.exe)$/.test(entry.name)){if(/[\r\n]/.test(entry.name))throw new Error('Invalid artifact filename.');const sha256=createHash('sha256').update(await readFile(file)).digest('hex');await writeFile(`${file}.sha256`,`${sha256}  ${basename(file)}\n`);artifacts.push({file,sha256});}}}
 await visit(resolve(directory));if(!artifacts.length)throw new Error('No installer/update artifacts found.');return artifacts.sort((a,b)=>a.file.localeCompare(b.file));
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const artifacts=await createArtifactChecksums(process.argv[2]);const i=process.argv.indexOf('--upload');
 if(i>=0){const tag=process.argv[i+1];if(!/^v\d+\.\d+\.\d+$/.test(tag??''))throw new Error('Expected an explicit release tag.');if(process.env.GH_REPO!=='wdk08/ScriptForge')throw new Error('Checksum upload requires the intended repository.');execFileSync('gh',['release','upload',tag,...artifacts.map(a=>`${a.file}.sha256`),'--repo',process.env.GH_REPO],{stdio:'inherit'});}
 console.log(`Created ${artifacts.length} SHA-256 files${i>=0?' and attached them to the approved release':' locally; no upload'}.`);
}
