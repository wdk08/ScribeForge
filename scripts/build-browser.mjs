import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'vite';
import { copyNotices } from './build-desktop.mjs';

await build();
const output = resolve('dist/browser');
const assets = await readdir(resolve(output, 'assets'));
const shell = ['index.html', 'editor.html', ...assets.sort().map(asset => `assets/${asset}`)];
const worker = await readFile('scripts/browser-worker.js', 'utf8');
const hash = createHash('sha256').update(worker);
for (const asset of shell) hash.update(await readFile(resolve(output, asset)));
await writeFile(resolve(output, 'offline.js'),
  `const ASSETS = ${JSON.stringify(shell)};\nconst REVISION = '${hash.digest('hex').slice(0, 16)}';\n${worker}`);
await copyNotices(output);
