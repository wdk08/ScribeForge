import * as ort from '../vendor/onnx/ort.wasm.min.mjs';
import { phonemize } from './piper-phonemizer.js';
import { validatePiperConfig, piperPhonemeIds } from './piper-config.js';
ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;
ort.env.wasm.wasmPaths = new URL('../vendor/onnx/', import.meta.url).href;
const sessions = new Map();
async function synthesize(data) {
  const { config, modelId, text } = data; validatePiperConfig(config);
  if (typeof text !== 'string' || !text.trim() || text.length > 2000) throw new Error('Speech text must contain 1–2000 characters.');
  let session = sessions.get(modelId);
  if (!session) {
    if (!(data.model instanceof ArrayBuffer)) throw new Error('Voice model data is not loaded.');
    if (sessions.size >= 1) { const [id, old] = sessions.entries().next().value; await old.release(); sessions.delete(id); }
    session = await ort.InferenceSession.create(data.model, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    const required = ['input', 'input_lengths', 'scales'];
    if (required.some(name => !session.inputNames.includes(name)) || session.inputNames.some(name => ![...required, 'sid'].includes(name)) || !session.outputNames.includes('output')) { await session.release(); throw new Error('This graph is not a compatible Piper VITS TTS model. Expected input, input_lengths, scales and optional sid inputs, plus output audio.'); }
    if (config.num_speakers > 1 && !session.inputNames.includes('sid')) { await session.release(); throw new Error('The multi-speaker configuration does not match this model.'); }
    sessions.set(modelId, session);
  } else { sessions.delete(modelId); sessions.set(modelId, session); }
  const ids = piperPhonemeIds(await phonemize(text, config.espeak.voice), config);
  const rate = Math.min(4, Math.max(.25, data.rate ?? 1));
  const pitchRatio = Math.pow(2, ((data.pitch ?? 1) - 1));
  const feeds = {
    input: new ort.Tensor('int64', BigInt64Array.from(ids, BigInt), [1, ids.length]),
    input_lengths: new ort.Tensor('int64', BigInt64Array.from([BigInt(ids.length)]), [1]),
    scales: new ort.Tensor('float32', Float32Array.from([config.inference?.noise_scale ?? .667, (config.inference?.length_scale ?? 1) * pitchRatio / rate, config.inference?.noise_w ?? .8]), [3]),
  };
  if (session.inputNames.includes('sid')) {
    const speaker = data.speakerId ?? 0;
    if (!Number.isInteger(speaker) || speaker < 0 || speaker >= config.num_speakers) throw new Error('Invalid model speaker.');
    feeds.sid = new ort.Tensor('int64', BigInt64Array.from([BigInt(speaker)]), [1]);
  }
  let result;
  try {
    result = await session.run(feeds);
    const samples = new Float32Array(result.output.data);
    if (samples.length < config.audio.sample_rate / 20 || samples.length > config.audio.sample_rate * 180 || samples.some(value => !Number.isFinite(value)) || !samples.some(value => Math.abs(value) > .00001)) throw new Error('The model did not generate usable speech audio. Check that the configuration matches the model.');
    return { samples, sampleRate: config.audio.sample_rate, pitchRatio, phonemeCount: ids.length, cachedIds: [...sessions.keys()] };
  } finally { Object.values(feeds).forEach(tensor => tensor.dispose()); if (result) Object.values(result).forEach(tensor => tensor.dispose()); }
}
let queue = Promise.resolve();
self.onmessage = ({ data }) => {
  queue = queue.catch(() => {}).then(async () => {
    try { const result = await synthesize(data); self.postMessage({ id: data.id, result }, [result.samples.buffer]); }
    catch (error) { self.postMessage({ id: data.id, error: error instanceof Error ? error.message : String(error) }); }
  });
};
