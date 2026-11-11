// Copyright (C) 2026 wdk08. SPDX-License-Identifier: GPL-3.0-only
// Rebuild the same Piper API from recorded source. No voices/models are fetched.
import {readFile,writeFile,mkdir,mkdtemp,copyFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const args=process.argv.slice(2),sdkArg=args.indexOf('--sdk');
if(sdkArg<0||!args[sdkArg+1])throw new Error('Use npm run build:piper -- --sdk /path/to/emsdk (installed/activated Emscripten 3.1.47).');
const sdk=resolve(args[sdkArg+1]),root=resolve('.'),work=await mkdtemp(join(tmpdir(),'scriptforge-piper-build-'));
const manifest=JSON.parse(await readFile('third-party/piper-source/manifest.json'));
const em=join(sdk,'upstream/emscripten'),run=(cmd,argv)=>execFileSync(cmd,argv,{stdio:'inherit',env:{...process.env,EMSDK:sdk}});
const compiler=execFileSync(join(em,'emcc'),['--version'],{encoding:'utf8'});if(!compiler.includes(` ${manifest.emscripten} `))throw new Error('Wrong Emscripten version.');
for(const item of manifest.sources){const bytes=await readFile(item.file);if(createHash('sha256').update(bytes).digest('hex')!==item.sha256)throw new Error(`Source checksum failed: ${item.name}`);await mkdir(join(work,item.name));run('tar',['-xf',resolve(item.file),'-C',join(work,item.name)]);}
// Same UCD declaration workaround documented by the original wasm builder.
// Modify this SDK's cached header only; never a system compiler/header.
const wchar=join(em,'cache/sysroot/include/wchar.h');let header=await readFile(wchar,'utf8');
if(!header.includes('ScriptForge Piper build:')){
 let count=0;header=header.replace(/^(int\s+isw(?:alnum|alpha|blank|cntrl|digit|graph|lower|print|punct|space|upper|xdigit)\(wint_t\);)/gm,match=>{count++;return `// ScriptForge Piper build: avoid eSpeak UCD macro declaration collision.\n// ${match}`;});
 if(count!==12)throw new Error('Unexpected SDK wchar header; review before patching.');await writeFile(wchar,header);
}
const espeak=join(work,'espeak-ng'),native=join(work,'native'),wasm=join(work,'wasm'),piper=join(work,'piper-phonemize/src');
const flags=['-DCMAKE_POLICY_VERSION_MINIMUM=3.5',`-DFETCHCONTENT_SOURCE_DIR_SONIC-GIT=${join(work,'sonic')}`,'-DCMAKE_BUILD_TYPE=Release','-DBUILD_SHARED_LIBS=OFF','-DUSE_ASYNC=OFF','-DUSE_MBROLA=OFF','-DUSE_LIBSONIC=OFF','-DUSE_LIBPCAUDIO=OFF','-DUSE_KLATT=OFF','-DUSE_SPEECHPLAYER=OFF','-DBUILD_TESTING=OFF'];
run('cmake',['-S',espeak,'-B',native,...flags]);run('cmake',['--build',native,'-j','4']);
run(join(em,'emcmake'),['cmake','-S',espeak,'-B',wasm,...flags]);run('cmake',['--build',wasm,'--target','espeak-ng','-j','4']);
const output=join(work,'output');await mkdir(output);
run(join(em,'em++'),['-O3','-std=c++17',`-I${piper}`,`-I${join(espeak,'src/include')}`,...['main.cpp','phonemize.cpp','phoneme_ids.cpp','shared.cpp'].map(f=>join(piper,f)),join(wasm,'src/libespeak-ng/libespeak-ng.a'),join(wasm,'src/ucd-tools/libucd.a'),'-sINVOKE_RUN=0','-sMODULARIZE=1','-sEXPORT_NAME=createPiperPhonemize','-sEXPORTED_FUNCTIONS=["_main"]','-sEXPORTED_RUNTIME_METHODS=["callMain","FS"]','-sALLOW_MEMORY_GROWTH=1','--preload-file',`${join(native,'espeak-ng-data')}@/espeak-ng-data`,'-o',join(output,'piper_phonemize.js')]);
await writeFile(join(output,'piper_phonemize.js'),(await readFile(join(output,'piper_phonemize.js'),'utf8'))+'\nexport default createPiperPhonemize;\n');
const artifacts={};for(const ext of ['js','wasm','data']){const name=`piper_phonemize.${ext}`,bytes=await readFile(join(output,name));artifacts[name]=createHash('sha256').update(bytes).digest('hex');if(args.includes('--install'))await copyFile(join(output,name),join(root,'vendor/piper',name));}
const recipe='scripts/build-piper.mjs';
const provenance={schema:1,build:'ScriptForge source build',emscripten:manifest.emscripten,sources:manifest.sources.map(({name,commit,sha256})=>({name,commit,sha256})),recipe,recipeSha256:createHash('sha256').update(await readFile(recipe)).digest('hex'),artifacts};
await writeFile(join(output,'provenance.json'),JSON.stringify(provenance,null,2)+'\n');
if(args.includes('--install'))await copyFile(join(output,'provenance.json'),join(root,'vendor/piper/provenance.json'));
console.log(`Piper source build complete: ${output}${args.includes('--install')?' (installed into vendor/piper)':''}`);
