import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
export const platforms=['darwin-aarch64','darwin-x86_64','windows-x86_64'];
export function validateManifest(manifest,version,assets){
 if(manifest.version!==version||typeof manifest.notes!=='string'||!Number.isFinite(Date.parse(manifest.pub_date)))throw new Error('Updater version, notes or publication date is invalid.');
 for(const platform of platforms){
  const item=manifest.platforms?.[platform];if(!item?.signature||typeof item.signature!=='string')throw new Error(`Missing signature: ${platform}`);
  const signature=Buffer.from(item.signature.trim(),'base64').toString('utf8');if(!signature.startsWith('untrusted comment:')||signature.split(/\r?\n/).find(line=>line.startsWith('trusted comment:'))?.split('\t').find(field=>field.startsWith('version:'))!==`version:${version}`)throw new Error(`Missing version-bound Tauri signature: ${platform}`);
  const url=new URL(item.url);if(url.protocol!=='https:')throw new Error('HTTPS is required.');
  if(assets){const asset=assets.find(a=>a.browser_download_url===url.href||`https://api.github.com/repos/wdk08/ScriptForge/releases/assets/${a.id}`===url.href);if(!asset||!asset.size)throw new Error(`Missing release asset: ${platform}`);
   if(platform.startsWith('darwin')&&!asset.name.endsWith('.app.tar.gz'))throw new Error('macOS updater must be an app archive.');
   if(platform.startsWith('windows')&&!asset.name.endsWith('.exe'))throw new Error('Windows updater must use the configured NSIS installer.');
  }
 }
 return true;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const manifest=JSON.parse(await readFile(process.argv[2],'utf8')),assets=JSON.parse(await readFile(process.argv[3],'utf8'));validateManifest(manifest,process.env.RELEASE_VERSION,assets);console.log('All three signed updater platforms match uploaded release assets.');
 if(process.argv.includes('--public'))for(const item of Object.values(manifest.platforms)){
  const response=await fetch(item.url,{headers:{Accept:'application/octet-stream',Range:'bytes=0-0'}});await response.body?.cancel();
  if(!response.ok||(response.headers.get('content-type')??'').includes('json'))throw new Error('An updater asset is not publicly downloadable as binary data.');
 }
}
