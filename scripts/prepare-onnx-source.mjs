// Copyright (C) 2026 wdk08. SPDX-License-Identifier: GPL-3.0-only
// Expand the supplied upstream source and redirect its reviewed dependencies to
// the supplied source archives. Does not change the application's runtime.
import {readFile,writeFile,mkdir,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const deps=resolve(process.argv.slice(2).find(arg=>!arg.startsWith('--'))??'../dependencies'),items=JSON.parse(await readFile('third-party/source-downloads.json'));
const hash=(bytes,algorithm='sha256')=>createHash(algorithm).update(bytes).digest('hex');
for(const item of items){if(hash(await readFile(join(deps,item.file)))!==item.sha256)throw new Error(`Source checksum failed: ${item.name}`);}
const eigen=JSON.parse(await readFile('third-party/eigen-source.json')),eigenPath=resolve(eigen.file),eigenBytes=await readFile(eigenPath);if(hash(eigenBytes)!==eigen.sha256)throw new Error('Eigen source checksum failed.');
if(process.argv.includes('--verify-only')){console.log(`Verified ${items.length} upstream source archives and exact Eigen source.`);process.exit(0);}
const work=await mkdtemp(join(tmpdir(),'scriptforge-onnx-build-source-'));
execFileSync('tar',['-xf',join(deps,items.find(p=>p.name==='onnxruntime').file),'-C',work,'--strip-components=1']);
const file=join(work,'cmake/deps.txt'),original=await readFile(file,'utf8');
const patched=original.split('\n').map(line=>{const [name]=line.split(';');if(name==='eigen')return `eigen;${eigenPath.replaceAll('\\','/')};${hash(eigenBytes,'sha1')}`;const item=items.find(p=>p.name===`onnx-${name}`);return item?`${name};${join(deps,item.file).replaceAll('\\','/')};${item.sha1}`:line;}).join('\n');
await writeFile(`${file}.upstream`,original);await writeFile(file,patched);
await writeFile(join(work,'SCRIPTFORGE-SOURCE-PATCH.md'),'Prepared for ScriptForge, October 19, 2026: cmake/deps.txt redirects recorded core/WASM dependency URLs to supplied hash-verified sources. Eigen uses the exact pinned Git commit archive because the original generated zip changed. No C/C++ source changed. Keep EIGEN_MPL2_ONLY and the WASM-only execution-provider selection. Original deps.txt is retained alongside it.\n');
console.log(`Prepared upstream ONNX source: ${work}\nFollow upstream js/web and tools/ci_build/build.py WASM instructions. Optional native providers remain disabled.`);
