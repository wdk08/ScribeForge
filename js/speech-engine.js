const cancelled = () => Object.assign(new Error('Speech cancelled.'), { name: 'AbortError' });
const failures = {
  'not-allowed': 'Speech was blocked. Press Play again to start from a user interaction.',
  'voice-unavailable': 'That voice is unavailable. Select another voice and press Play.',
  'language-unavailable': 'This voice cannot speak the selected language. Choose another voice.',
  'audio-busy': 'Audio is busy. Close other audio playback and press Play again.',
  'audio-hardware': 'The browser could not access an audio output device.',
  network: 'The browser voice service could not connect. Try an installed local voice.',
  interrupted: 'The browser interrupted speech. Press Play to retry the current paragraph.',
  canceled: 'The browser cancelled speech. Press Play to retry the current paragraph.',
};

/** Stage 5A adapter. TableReadPlayer depends on this interface, not Web Speech. */
export class BrowserSpeechEngine {
  constructor({ synthesis, Utterance, stallMs } = {}) {
    try { this.synth = synthesis ?? globalThis.speechSynthesis; this.Utterance = Utterance ?? globalThis.SpeechSynthesisUtterance; } catch {}
    this.available = Boolean(this.synth && this.Utterance); this.active = null; this.listeners = new Set(); this.stallMs = stallMs;
  }
  getVoices() { return this.available ? Array.from(this.synth.getVoices()) : []; }
  subscribeVoices(listener) {
    if (!this.available) return () => {};
    this.synth.addEventListener('voiceschanged', listener); this.listeners.add(listener);
    return () => { this.synth.removeEventListener('voiceschanged', listener); this.listeners.delete(listener); };
  }
  speak(text, voice, options = {}) {
    if (!this.available) return Promise.reject(new Error('This browser does not support speech synthesis.'));
    this.stop();
    return new Promise((resolve, reject) => {
      const utterance = new this.Utterance(text);
      utterance.voice = voice ?? null; if (voice?.lang) utterance.lang = voice.lang;
      utterance.rate = Math.min(10, Math.max(.1, options.rate ?? 1)); utterance.pitch = options.pitch ?? 1; utterance.volume = options.volume ?? 1;
      const job = { utterance, paused: false, reject, finish: null }; this.active = job;
      let elapsed = 0, lastTick = Date.now();
      const finish = error => {
        if (this.active !== job) return;
        clearInterval(timer); this.active = null;
        for (const event of ['start', 'end', 'error', 'pause', 'resume', 'boundary']) utterance[`on${event}`] = null;
        if (error) reject(error); else resolve();
      };
      const timer = setInterval(() => {
        const now = Date.now(); if (!job.paused) elapsed += now - lastTick; lastTick = now;
        if (elapsed > (this.stallMs ?? Math.max(20000, text.length * 220 / utterance.rate + 10000))) {
          finish(new Error('The browser stopped responding during speech. Press Play to retry this paragraph.')); this.synth.cancel();
        }
      }, this.stallMs ? Math.min(1000, this.stallMs) : 1000);
      job.finish = finish;
      utterance.onstart = () => { elapsed = 0; options.onStart?.(); };
      utterance.onboundary = () => { elapsed = 0; };
      utterance.onend = () => finish();
      utterance.onerror = event => finish(new Error(failures[event.error] ?? `Speech failed (${event.error || 'unknown error'}). Choose a voice and press Play to retry.`));
      utterance.onpause = () => { job.paused = true; options.onPause?.(); };
      utterance.onresume = () => { job.paused = false; options.onResume?.(); };
      try { if (this.synth.paused) this.synth.resume(); this.synth.speak(utterance); }
      catch (error) { finish(new Error(`Speech could not start: ${error.message}`)); }
    });
  }
  pause() { if (this.active) { this.active.paused = true; this.synth.pause(); } }
  resume() { if (this.active) this.active.paused = false; if (this.available) this.synth.resume(); }
  stop() {
    this.active?.finish(cancelled());
    if (this.available) { this.synth.cancel(); if (this.synth.paused) this.synth.resume(); }
  }
  dispose() { this.stop(); for (const listener of this.listeners) this.synth.removeEventListener('voiceschanged', listener); this.listeners.clear(); }
}
