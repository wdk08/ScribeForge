// Copyright (C) 2026 wdk08. SPDX-License-Identifier: GPL-3.0-only
// Read-only distribution policy guard. Updater signatures remain mandatory.
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
export function assertDistributionPolicy(config){
 if(config.bundle?.macOS?.signingIdentity!=='-')throw new Error('This distribution requires an explicit ad hoc Mac signature, without a paid Apple identity.');
 const windows=config.bundle?.windows??{};
 if(windows.certificateThumbprint||windows.signCommand)throw new Error('This distribution must not require Windows publisher credentials.');
 if(config.bundle?.createUpdaterArtifacts!==true||config.plugins?.updater?.requireSignedVersion!==true)throw new Error('Unsigned platform distribution must retain signed updater artifacts and signed-version verification.');
 return true;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 assertDistributionPolicy(JSON.parse(await readFile('src-tauri/tauri.conf.json','utf8')));
 console.log('Distribution: ad hoc/unnotarized macOS, unsigned Windows; cryptographically signed Tauri updates required.');
}
