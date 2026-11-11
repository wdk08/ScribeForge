import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {auditReleaseHistory} from '../scripts/audit-release-history.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
test('publication audit rejects legacy binaries even after a newer commit repairs the working files',async()=>{
 const roots=[];
 async function repo(){const root=await mkdtemp(join(tmpdir(),'scriptforge-history-'));roots.push(root);execFileSync('git',['init','-q'],{cwd:root});return root;}
 async function write(root,file,source){await mkdir(dirname(join(root,file)),{recursive:true});await writeFile(join(root,file),source);}
 function commit(root){execFileSync('git',['add','--','.'],{cwd:root});execFileSync('git',['commit','-qm','Synthetic audit fixture'],{cwd:root,env:{...process.env,GIT_AUTHOR_NAME:'Audit fixture',GIT_AUTHOR_EMAIL:'audit@example.com',GIT_COMMITTER_NAME:'Audit fixture',GIT_COMMITTER_EMAIL:'audit@example.com'}});}
 async function licensed(root){const sources=[{name:'espeak-ng',commit:'fixture',file:'third-party/piper-source/espeak-ng.tar.gz',sha256:hash('source')}];const artifacts={};for(const ext of ['js','wasm','data']){const name=`piper_phonemize.${ext}`;await write(root,`vendor/piper/${name}`,'built bytes');artifacts[name]=hash('built bytes');}await write(root,'LICENSE','GNU GENERAL PUBLIC LICENSE');await write(root,'scripts/build-piper.mjs','build recipe');await write(root,sources[0].file,'source');await write(root,'third-party/piper-source/manifest.json',JSON.stringify({sources}));await write(root,'vendor/piper/provenance.json',JSON.stringify({artifacts,recipe:'scripts/build-piper.mjs',recipeSha256:hash('build recipe'),sources:sources.map(({name,commit,sha256})=>({name,commit,sha256}))}));}
 try{const legacy=await repo();await write(legacy,'vendor/piper/piper_phonemize.wasm','opaque');commit(legacy);await licensed(legacy);commit(legacy);assert.throws(()=>auditReleaseHistory(legacy),/Historical speech snapshot/);
 const clean=await repo();await licensed(clean);commit(clean);assert.equal(auditReleaseHistory(clean),1);await write(clean,'vendor/piper/piper_phonemize.wasm','tampered');commit(clean);assert.throws(()=>auditReleaseHistory(clean),/bytes mismatch/);
 }finally{for(const root of roots)await rm(root,{recursive:true,force:true});}
});
