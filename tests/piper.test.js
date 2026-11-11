import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { validatePiperConfig, piperPhonemeIds, wavBlob } from '../js/piper-config.js';
import { createVoiceStore, importedVoices } from '../js/voice-storage.js';
import { preparePiperImport } from '../js/voice-import.js';
import { voiceId, orderedVoices } from '../js/table-read-model.js';
import { MixedSpeechEngine } from '../js/mixed-speech-engine.js';
import { installSpeechMock } from './fixtures/speech-mock.js';
const config = { phoneme_type: 'espeak', espeak: { voice: 'en-us' }, audio: { sample_rate: 16000 }, num_speakers: 1, num_symbols: 256, phoneme_map: {}, phoneme_id_map: { '^': [11], '_': [10], '$': [12], a: [30], b: [31] } };
const record = (id = 'one') => ({ id, fingerprint: `fingerprint-${id}`, model: new Blob([new Uint8Array([1, 2, 3])]), config, name: 'My Piper', size: 3 });
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test('Piper compatibility rejects incomplete configurations and unsupported architectures/processors', () => {
  assert.equal(validatePiperConfig(config), config);
  for (const changes of [{ phoneme_type: 'text' }, { audio: { sample_rate: 1 } }, { phoneme_id_map: {} }, { phoneme_map: { a: 'b' } }, { espeak: { voice: 'ar' } }, { num_speakers: 0 }, { inference: { length_scale: NaN } }]) assert.throws(() => validatePiperConfig({ ...config, ...changes }), /Unsupported Piper/);
  assert.throws(() => validatePiperConfig(null), /Piper/);
});
test('raw IPA uses the imported configuration IDs, preserving phonemizer sentence boundaries and multi-ID symbols', () => {
  const raw = { phonemes: ['a', 'b'], phoneme_ids: [1, 0, 14, 0, 2, 1, 0, 15, 0, 2] };
  assert.deepEqual(piperPhonemeIds(raw, config), [11, 10, 30, 10, 12, 11, 10, 31, 10, 12]);
  const custom = { ...config, phoneme_id_map: { ...config.phoneme_id_map, a: [40, 41] } };
  assert.deepEqual(piperPhonemeIds(raw, custom).slice(0, 6), [11, 10, 40, 41, 10, 12]);
  assert.throws(() => piperPhonemeIds({ ...raw, phonemes: ['z', 'b'] }, config), /cannot represent phoneme/);
  assert.throws(() => piperPhonemeIds({ ...raw, phoneme_ids: [1, 0, 14] }, config), /alignment|Incomplete/);
});
test('generated PCM is encoded as a correctly sized mono WAV, with clipping and the model sample rate', async () => {
  const blob = wavBlob(new Float32Array([-2, 0, 2]), 16000), view = new DataView(await blob.arrayBuffer());
  assert.equal(blob.type, 'audio/wav'); assert.equal(blob.size, 50); assert.equal(view.getUint32(24, true), 16000); assert.equal(view.getInt16(44, true), -32767); assert.equal(view.getInt16(48, true), 32767);
});
test('model storage survives reopen, deduplicates without overwriting, and never touches the screenplay database', async () => {
  const factory = new IDBFactory(), store = createVoiceStore(factory, 'test-voices'); const a = record(); await store.add(a);
  const duplicate = await store.add({ ...a, name: 'Do not overwrite my voice' }); assert.equal(duplicate.name, a.name);
  const reopened = createVoiceStore(factory, 'test-voices'); assert.equal((await reopened.list()).length, 1); assert.deepEqual(new Uint8Array(await (await reopened.get(a.id)).model.arrayBuffer()), new Uint8Array([1, 2, 3]));
  await reopened.rename(a.id, 'New display name'); const renamed = await reopened.get(a.id); assert.equal(renamed.name, 'New display name'); assert.equal(renamed.fingerprint, a.fingerprint); assert.deepEqual(new Uint8Array(await renamed.model.arrayBuffer()), new Uint8Array([1, 2, 3])); await assert.rejects(reopened.rename('missing', 'Name'), /no longer/);
  assert.equal((await reopened.list())[0].model, undefined); assert.deepEqual((await factory.databases()).map(db => db.name), ['test-voices']);
  let notifications = 0; const off = store.subscribe(() => notifications++); await store.remove(a.id); assert.equal(notifications, 1); off(); assert.deepEqual(await reopened.list(), []);
  await assert.rejects(createVoiceStore(null).list(), /storage is unavailable/);
});
test('import requires a working local synthesis pass, hashes both files, and returns the original model without server uploads', async () => {
  const model = Object.assign(new Blob([new Uint8Array([1, 2, 3])]), { name: 'voice.onnx' });
  const configuration = Object.assign(new Blob([JSON.stringify(config)]), { name: 'voice.onnx.json' });
  let calls = 0;
  const runtime = { async synthesize(input) { calls++; assert.equal(input.model, model); return { samples: new Float32Array([.1, .2]), sampleRate: 16000, phonemeCount: 8 }; } };
  const prepared = await preparePiperImport({ model, configuration, name: 'Named voice', runtime });
  assert.equal(calls, 1); assert.equal(prepared.record.model, model); assert.match(prepared.record.fingerprint, /^[a-f0-9]{64}$/); assert.equal(prepared.record.name, 'Named voice'); assert.equal(prepared.audio.type, 'audio/wav');
  await assert.rejects(preparePiperImport({ model, configuration, runtime: { synthesize: () => Promise.reject(new Error('Not a real Piper graph')) } }), /Not a real/);
  await assert.rejects(preparePiperImport({ model, configuration: Object.assign(new Blob(['{}']), { name: 'model.json' }), runtime }), /Unsupported/);
  const controller = new AbortController(); controller.abort(); await assert.rejects(preparePiperImport({ model, configuration, runtime, signal: controller.signal }), { name: 'AbortError' });
});
test('imported speaker identities remain stable on rename/reimport and browser automatic voice ordering remains first', () => {
  const a = importedVoices([record()])[0], renamed = importedVoices([{ ...record(), name: 'Renamed' }])[0]; assert.equal(voiceId(a), voiceId(renamed));
  const variants = importedVoices([{ ...record(), config: { ...config, num_speakers: 2, speaker_id_map: { Alice: 1, Bob: 0 } } }]);
  assert.match(variants[0].name, /Bob/); assert.match(variants[1].name, /Alice/); assert.notEqual(voiceId(variants[0]), voiceId(variants[1]));
  const browser = { name: 'System voice', lang: 'zz-ZZ', voiceURI: 'system' }; assert.equal(orderedVoices([a, browser])[0], browser);
});

class AudioMock {
  constructor() { this.state = 'suspended'; this.destination = {}; this.sources = []; }
  async resume() { this.state = 'running'; this.onstatechange?.(); }
  async suspend() { this.state = 'suspended'; this.onstatechange?.(); }
  async close() { this.state = 'closed'; }
  createBuffer() { return { copyToChannel() {} }; }
  createGain() { return { gain: { value: 1 }, connect() {}, disconnect() {} }; }
  createBufferSource() { const source = { playbackRate: { value: 1 }, connect() {}, disconnect() {}, start() {}, stop() {}, finish() { this.onended?.(); } }; this.sources.push(source); return source; }
}
test('mixed playback routes actual voice kinds, preserves pause/resume and volume, and cancels late inference without starting audio', async () => {
  const { synth } = installSpeechMock(); const store = createVoiceStore(new IDBFactory(), 'mixed'); await store.add(record());
  let release, begin, cancelled = 0; const runtime = { synthesize: () => new Promise(resolve => { release = resolve; begin?.(); }), cancel() { cancelled++; }, dispose() {} };
  const engine = new MixedSpeechEngine({ store, runtime, AudioContextClass: AudioMock, supportsLocal: true }); await engine.ready;
  const native = engine.getVoices().find(voice => voice.kind !== 'piper'), local = engine.getVoices().find(voice => voice.kind === 'piper');
  const browser = engine.speak('Native text.', native); assert.equal(synth.active.text, 'Native text.'); await synth.finish(); await browser;
  let started = new Promise(resolve => { begin = resolve; });
  const speech = engine.speak('Local text.', local, { volume: .4 }); await started;
  engine.pause(); assert.equal(engine.active.paused, true);
  release({ samples: new Float32Array([.1, .2]), sampleRate: 16000, pitchRatio: 1 }); await tick();
  assert.equal(engine.audio.state, 'suspended'); assert.equal(engine.active.gain.gain.value, .4); engine.resume(); await tick(); assert.equal(engine.audio.state, 'running');
  engine.audio.sources.at(-1).finish(); await speech;
  started = new Promise(resolve => { begin = resolve; });
  const aborted = engine.speak('Cancel before generation finishes.', local); const rejection = assert.rejects(aborted, { name: 'AbortError' }); await started; const audio = engine.audio;
  engine.stop(); release({ samples: new Float32Array([.2]), sampleRate: 16000, pitchRatio: 1 }); await tick(); await rejection;
  assert.equal(audio.sources.length, 1); assert.ok(cancelled > 0); engine.dispose(); assert.equal(synth.voiceListeners.size, 0);
});
