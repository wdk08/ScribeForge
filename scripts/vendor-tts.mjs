// Run after npm ci; versions are pinned in package-lock.json.
import { copyFile, mkdir } from 'node:fs/promises';
import {verifyPiper} from './license-inventory.mjs';
await verifyPiper();
const root = new URL('../', import.meta.url);
for (const dir of ['vendor/onnx/', 'vendor/piper/']) await mkdir(new URL(dir, root), { recursive: true });
for (const file of ['ort.wasm.min.mjs', 'ort.wasm.min.mjs.map', 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']) {
  await copyFile(new URL(`node_modules/onnxruntime-web/dist/${file}`, root), new URL(`vendor/onnx/${file}`, root));
}
// Never recopy the opaque npm Piper binary over the source-built runtime.
// Rebuild it with build:piper and preserve the matching provenance/source set.
console.log('Refreshed pinned ONNX Runtime Web; verified source-built Piper remains intact. License notices are retained.');
