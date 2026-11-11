// Reads only a PUBLIC key. Private keys and passwords must never be supplied here.
import {readFile,writeFile} from 'node:fs/promises';
import {validPublicKey} from './release-check.mjs';
const path=process.argv[2];if(!path||!path.endsWith('.pub'))throw new Error('Provide the public .pub file path only.');
const key=(await readFile(path,'utf8')).trim();if(!validPublicKey(key))throw new Error('Not a Tauri/minisign PUBLIC key. No configuration was changed.');
const configPath='src-tauri/tauri.conf.json',config=JSON.parse(await readFile(configPath,'utf8'));config.plugins.updater.pubkey=key;await writeFile(configPath,JSON.stringify(config,null,2)+'\n');console.log('Public updater verification key configured. No private key was read.');
