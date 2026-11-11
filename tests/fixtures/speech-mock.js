/** Install deterministic speech without audio; usable in Node and addInitScript. */
export function installSpeechMock({ empty = false, unsupported = false } = {}) {
  const voices = [{ voiceURI: 'test:samantha', name: 'Samantha', lang: 'en-US', default: true, localService: true }, { voiceURI: 'test:alex', name: 'Alex', lang: 'en-US', default: false, localService: true }, { voiceURI: 'test:karen', name: 'Karen', lang: 'en-AU', default: false, localService: true }];
  class Utterance { constructor(text) { this.text = text; } }
  class Synthesis extends EventTarget {
    constructor() { super(); this.voices = empty ? [] : voices; this.active = null; this.speaking = false; this.paused = false; this.history = []; this.cancels = 0; this.peakPending = 0; this.voiceListeners = new Set(); }
    getVoices() { return [...this.voices]; }
    addEventListener(type, callback, options) { if (type === 'voiceschanged') this.voiceListeners.add(callback); super.addEventListener(type, callback, options); }
    removeEventListener(type, callback, options) { if (type === 'voiceschanged') this.voiceListeners.delete(callback); super.removeEventListener(type, callback, options); }
    speak(utterance) { this.peakPending = Math.max(this.peakPending, this.active ? 2 : 1); this.active = utterance; this.history.push(utterance); this.speaking = true; utterance.onstart?.(); }
    cancel() { this.cancels++; this.active = null; this.speaking = false; }
    pause() { this.paused = true; this.active?.onpause?.(); }
    resume() { this.paused = false; this.active?.onresume?.(); }
    async finish() { const item = this.active; this.active = null; this.speaking = false; item?.onend?.(); await new Promise(resolve => setTimeout(resolve, 0)); }
    async fail(error = 'network') { const item = this.active; this.active = null; this.speaking = false; item?.onerror?.({ error }); await new Promise(resolve => setTimeout(resolve, 0)); }
    updateVoices(next = voices) { this.voices = next; this.dispatchEvent(new Event('voiceschanged')); }
  }
  const synth = new Synthesis();
  Object.defineProperty(globalThis, 'speechSynthesis', { value: unsupported ? undefined : synth, configurable: true });
  Object.defineProperty(globalThis, 'SpeechSynthesisUtterance', { value: unsupported ? undefined : Utterance, configurable: true });
  globalThis.speechMock = synth;
  return { synth, Utterance, voices };
}
