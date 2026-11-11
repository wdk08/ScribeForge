import { MAX_MODEL_BYTES, validatePiperConfig, PIPER_TEST_TEXT, wavBlob } from './piper-config.js';
function stable(value) { return value && typeof value === 'object' ? Array.isArray(value) ? value.map(stable) : Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value; }
const hex = bytes => [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join('');
export async function preparePiperImport({ model, configuration, name, text = PIPER_TEST_TEXT, runtime, signal, status = () => {} }) {
  const check = () => { if (signal?.aborted) throw Object.assign(new Error('Voice import cancelled.'), { name: 'AbortError' }); };
  if (!model || !/\.onnx$/i.test(model.name ?? '') || !model.size || model.size > MAX_MODEL_BYTES) throw new Error('Choose one Piper .onnx file, up to 512 MB, containing its model weights.');
  if (!configuration || !/\.json$/i.test(configuration.name ?? '') || configuration.size > 2 * 1024 * 1024) throw new Error('Choose its matching .onnx.json configuration (up to 2 MB).');
  if (!globalThis.crypto?.subtle) throw new Error('Local model importing requires a secure browser context. Open ScriptForge on localhost or HTTPS.');
  let config; try { config = JSON.parse(await configuration.text()); } catch { throw new Error('The voice configuration is not valid JSON.'); }
  validatePiperConfig(config); check();
  status('Checking model fingerprint…');
  const modelHash = hex(await crypto.subtle.digest('SHA-256', await model.arrayBuffer())); check();
  const fingerprint = hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${modelHash}:${JSON.stringify(stable(config))}`))); check();
  const id = `piper-${fingerprint}`;
  status('Generating a real speech sample locally. This may take a moment…');
  const result = await runtime.synthesize({ modelId: id, model, config, text: text.trim() || PIPER_TEST_TEXT }); check();
  const audio = wavBlob(result.samples, result.sampleRate);
  return { record: { id, fingerprint, modelHash, model, config, name: (name?.trim() || model.name.replace(/\.onnx$/i, '')).slice(0, 100), fileName: model.name, size: model.size, createdAt: Date.now(), verification: { sampleRate: result.sampleRate, sampleCount: result.samples.length, phonemeCount: result.phonemeCount } }, audio };
}
