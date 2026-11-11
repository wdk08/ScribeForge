import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {verifyPiper} from './license-inventory.mjs';
import {assertDistributionPolicy} from './platform-signing.mjs';
export function validPublicKey(key){
  if(typeof key!=='string'||!key.trim()||! /^[A-Za-z0-9+/]+={0,2}$/.test(key.trim()))return false;
  const decoded=Buffer.from(key.trim(),'base64').toString('utf8'),line=decoded.trim().split(/\r?\n/).at(-1);
  const bytes=Buffer.from(line??'','base64');return decoded.startsWith('untrusted comment:')&&bytes.length===42&&bytes.subarray(0,2).toString()==='Ed';
}
export async function releaseCheck({production=false,version=process.env.RELEASE_VERSION}={}){
 const pkg=JSON.parse(await readFile('package.json','utf8')),lock=JSON.parse(await readFile('package-lock.json','utf8')),config=JSON.parse(await readFile('src-tauri/tauri.conf.json','utf8'));
 const cargo=await readFile('src-tauri/Cargo.toml','utf8'),cargoLock=await readFile('src-tauri/Cargo.lock','utf8');
 const versions=[pkg.version,lock.version,lock.packages[''].version,config.version,cargo.match(/^version = "([^"]+)"/m)?.[1],cargoLock.match(/name = "scriptforge"\nversion = "([^"]+)"/)?.[1]];
 if(!/^\d+\.\d+\.\d+$/.test(pkg.version)||versions.some(v=>v!==pkg.version)||(version&&version!==pkg.version))throw new Error('Release version must be synchronized and match the requested X.Y.Z version.');
 if(config.identifier!=='com.scriptforge.desktop')throw new Error('Do not change the application identifier: existing user data depends on it.');
 assertDistributionPolicy(config);
 if(config.plugins?.updater?.endpoints?.[0]!=='https://github.com/wdk08/ScriptForge/releases/latest/download/latest.json'||!config.plugins.updater.requireSignedVersion)throw new Error('Release updater endpoint or signed-version verification is incorrect.');
 if(Object.entries(config.plugins.updater).some(([name,value])=>value===true&&(name.startsWith('dangerous')||name==='allowDowngrades')))throw new Error('Production updates must not weaken transport or enable downgrades.');
 if(production&&!validPublicKey(config.plugins.updater.pubkey))throw new Error('Production updater public key is not configured. Follow RELEASING.md; never commit a private key.');
 if(pkg.license!=='GPL-3.0-only'||lock.packages[''].license!==pkg.license||!cargo.includes('license = "GPL-3.0-only"'))throw new Error('Release license metadata is inconsistent.');
 for(const file of ['LICENSE','COPYRIGHT','THIRD_PARTY_NOTICES.md','SOURCE_CODE.md'])await readFile(file,'utf8');
 await verifyPiper();
 if(!config.bundle.createUpdaterArtifacts)throw new Error('Production configuration must generate signed updater artifacts.');
 await readFile(`releases/v${pkg.version}.md`,'utf8');
 return pkg.version;
}
if(process.argv[1]===fileURLToPath(import.meta.url))try{console.log(`Release ${await releaseCheck({production:process.argv.includes('--production')})}: version and configuration checks passed.`);}catch(error){console.error(error.message);process.exitCode=1;}
