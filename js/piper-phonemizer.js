import createPhonemizer from '../vendor/piper/piper_phonemize.js';
let instance, output;
export async function phonemize(text, language) {
  if (!instance) instance = await createPhonemizer({
    noExitRuntime: true,
    locateFile: file => new URL(`../vendor/piper/${file.split('/').at(-1)}`, import.meta.url).href,
    print: line => { try { output = JSON.parse(line); } catch {} },
    printErr: line => console.warn('Piper phonemizer:', line),
  });
  output = null;
  instance.callMain(['-l', language, '--input', JSON.stringify([{ text }]), '--espeak_data', '/espeak-ng-data']);
  if (!output) throw new Error('The Piper phonemizer produced no output.');
  return output;
}
