export const MAX_MODEL_BYTES = 512 * 1024 * 1024;
export const PIPER_TEST_TEXT = 'ScriptForge is ready. This is a real local voice.';
export function validatePiperConfig(config) {
  const fail = message => { throw new Error(`Unsupported Piper configuration: ${message}`); };
  if (!config || config.phoneme_type !== 'espeak') fail('only Piper VITS models using eSpeak phonemes are supported.');
  if (!/^[a-zA-Z0-9_+-]{1,80}$/.test(config.espeak?.voice ?? '')) fail('a valid espeak.voice is required.');
  if (config.espeak.voice === 'ar') fail('Arabic voices need an additional diacritization pipeline, which is not supported.');
  if (!Number.isInteger(config.audio?.sample_rate) || config.audio.sample_rate < 8000 || config.audio.sample_rate > 48000) fail('sample rate must be between 8000 and 48000 Hz.');
  if (!Number.isInteger(config.num_speakers) || config.num_speakers < 1 || config.num_speakers > 256) fail('num_speakers must be 1–256.');
  if (Object.keys(config.phoneme_map ?? {}).length) fail('custom phoneme substitutions are not supported.');
  const map = config.phoneme_id_map;
  if (!map || typeof map !== 'object' || Array.isArray(map) || Object.keys(map).length > 4096) fail('phoneme_id_map is required.');
  for (const [symbol, ids] of Object.entries(map)) {
    if (!symbol || !Array.isArray(ids) || !ids.length || ids.length > 16 || ids.some(id => !Number.isInteger(id) || id < 0 || id > 100000 || (config.num_symbols && id >= config.num_symbols))) fail('invalid phoneme IDs.');
  }
  for (const special of ['^', '_', '$']) if (!Object.hasOwn(map, special)) fail('start, padding, and end phoneme IDs are required.');
  for (const [key, fallback, min, max] of [['noise_scale', .667, 0, 2], ['length_scale', 1, .1, 10], ['noise_w', .8, 0, 2]]) {
    const value = config.inference?.[key] ?? fallback;
    if (!Number.isFinite(value) || value < min || value > max) fail(`invalid inference.${key}.`);
  }
  for (const id of Object.values(config.speaker_id_map ?? {})) if (!Number.isInteger(id) || id < 0 || id >= config.num_speakers) fail('invalid speaker IDs.');
  return config;
}

/** The pinned phonemizer emits raw IPA plus sentence markers in its default ABI.
 * Use those markers only for boundaries; actual tensor IDs come from the model. */
export function piperPhonemeIds(raw, config) {
  validatePiperConfig(config);
  if (!Array.isArray(raw.phonemes) || !Array.isArray(raw.phoneme_ids)) throw new Error('The phonemizer returned invalid IPA output.');
  const ids = [], encoded = raw.phoneme_ids, phones = raw.phonemes; let cursor = 0, index = 0;
  const append = symbol => {
    const mapped = config.phoneme_id_map[symbol];
    if (!mapped) throw new Error(`The voice configuration cannot represent phoneme ${JSON.stringify(symbol)}. This model/phonemizer combination is unsupported.`);
    ids.push(...mapped);
  };
  while (index < encoded.length) {
    if (encoded[index++] !== 1 || encoded[index++] !== 0) throw new Error('Unsupported phonemizer sentence markers.');
    append('^'); append('_');
    while (index < encoded.length && encoded[index] !== 2) {
      if (encoded[index + 1] !== 0 || cursor >= phones.length) throw new Error('Unsupported phonemizer output alignment.');
      append(phones[cursor++]); append('_'); index += 2;
    }
    if (encoded[index++] !== 2) throw new Error('Incomplete phonemizer sentence.');
    append('$');
  }
  if (cursor !== phones.length || !ids.length) throw new Error('The phonemizer could not map all text for this voice.');
  return ids;
}
export function wavBlob(samples, sampleRate) {
  const bytes = new ArrayBuffer(44 + samples.length * 2), view = new DataView(bytes);
  const tag = (at, text) => [...text].forEach((char, index) => view.setUint8(at + index, char.charCodeAt(0)));
  tag(0, 'RIFF'); view.setUint32(4, bytes.byteLength - 8, true); tag(8, 'WAVE'); tag(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); tag(36, 'data'); view.setUint32(40, samples.length * 2, true);
  samples.forEach((value, index) => view.setInt16(44 + index * 2, Math.max(-1, Math.min(1, value)) * 32767, true));
  return new Blob([bytes], { type: 'audio/wav' });
}
