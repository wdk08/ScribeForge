import { BrowserSpeechEngine } from './speech-engine.js';
import { PiperRuntime } from './piper-runtime.js';
import { voiceStore, importedVoices } from './voice-storage.js';
const aborted = () => Object.assign(new Error('Speech cancelled.'), { name: 'AbortError' });
export class MixedSpeechEngine {
  constructor({ browser = new BrowserSpeechEngine(), store = voiceStore(), runtime = new PiperRuntime(), AudioContextClass = globalThis.AudioContext ?? globalThis.webkitAudioContext, supportsLocal = typeof Worker !== 'undefined' && typeof WebAssembly !== 'undefined' } = {}) {
    this.browser = browser; this.store = store; this.runtime = runtime; this.AudioContextClass = AudioContextClass;
    this.localAvailable = Boolean(AudioContextClass && supportsLocal);
    this.imported = []; this.listeners = new Set(); this.statusListeners = new Set(); this.active = null; this.audio = null; this.disposed = false; this.libraryError = '';
    this.unsubscribe = store.subscribe(() => { void this.refreshImported(); });
    this.unsubscribeBrowser = browser.subscribeVoices(() => this.notify());
    this.ready = this.refreshImported();
  }
  get browserAvailable() { return this.browser.available; }
  get available() { return this.browser.available || (this.localAvailable && this.imported.length > 0); }
  getVoices() { return [...this.browser.getVoices(), ...(this.localAvailable ? this.imported : [])]; }
  notify() { if (!this.disposed) this.listeners.forEach(listener => listener()); }
  async refreshImported() {
    try { const records = await this.store.list(); if (this.disposed) return; this.imported = importedVoices(records); this.libraryError = ''; }
    catch (error) { this.libraryError = `Imported voices could not be loaded: ${error.message}`; }
    this.notify();
  }
  subscribeVoices(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  subscribeStatus(listener) { this.statusListeners.add(listener); return () => this.statusListeners.delete(listener); }
  status(message = '') { this.statusListeners.forEach(listener => listener(message)); }
  unlockAudio() {
    if (!this.localAvailable || !this.imported.length) return;
    try {
      const context = this.audio ??= new this.AudioContextClass();
      if (context.state !== 'running') void context.resume().catch(() => {});
    } catch { /* A local speech request reports output-device failures explicitly. */ }
  }
  speak(text, voice, options = {}) {
    this.stop();
    // Also unlock at the first browser-voice Play gesture, before later local
    // paragraphs are reached from an asynchronous speech completion callback.
    this.unlockAudio();
    if (voice?.kind !== 'piper') {
      const job = { kind: 'browser' }; this.active = job;
      return this.browser.speak(text, voice, options).finally(() => { if (this.active === job) this.active = null; });
    }
    if (!this.localAvailable) return Promise.reject(new Error('This browser cannot run local Piper audio. Use a browser voice or a browser with WebAssembly, Workers, and Web Audio.'));
    let context;
    try { context = this.audio ??= new this.AudioContextClass(); }
    catch (error) { return Promise.reject(new Error(`Audio output could not open: ${error.message}`)); }
    // Unlock audio synchronously within the user's Play/Preview interaction.
    const unlocked = context.resume(); unlocked.catch(() => {});
    return new Promise((resolve, reject) => {
      const job = { kind: 'piper', paused: false, source: null, finish: null }; this.active = job;
      const finish = error => {
        if (this.active !== job) return;
        if (job.source) { job.source.onended = null; try { job.source.stop(); } catch {} job.source.disconnect(); }
        job.gain?.disconnect(); context.onstatechange = null; clearTimeout(job.timer); this.active = null; this.status('');
        if (error) reject(error); else resolve();
      };
      job.finish = finish;
      job.timer = setTimeout(() => { this.runtime.cancel(); finish(new Error('Audio output did not unlock. Press Play again to allow sound.')); }, 20000);
      unlocked.then(() => clearTimeout(job.timer), () => {});
      context.onstatechange = () => {
        if (this.active === job && ['suspended', 'interrupted'].includes(context.state) && !job.paused) { job.paused = true; options.onPause?.(); }
      };
      void (async () => {
        try {
          this.status(`Generating ${voice.name} locally…`);
          const record = await this.store.get(voice.modelId); if (this.active !== job) return;
          if (!record) throw new Error('This imported voice is no longer stored. Reimport it in Voice Library or choose another voice.');
          const output = await this.runtime.synthesize({ modelId: record.id, model: record.model, config: record.config, text, speakerId: voice.speakerId, rate: options.rate ?? 1, pitch: options.pitch ?? 1 });
          if (this.active !== job) return;
          await unlocked; if (this.active !== job) return;
          const buffer = context.createBuffer(1, output.samples.length, output.sampleRate); buffer.copyToChannel(output.samples, 0);
          job.source = context.createBufferSource(); job.source.buffer = buffer; job.source.playbackRate.value = output.pitchRatio;
          job.gain = context.createGain(); job.gain.gain.value = options.volume ?? 1;
          job.source.connect(job.gain); job.gain.connect(context.destination); job.source.onended = () => finish();
          this.status(''); job.source.start(); options.onStart?.();
          if (job.paused) await context.suspend();
        } catch (error) { if (this.active === job) finish(error); }
      })();
    });
  }
  pause() {
    const job = this.active; if (!job) return;
    if (job.kind === 'browser') this.browser.pause();
    else { job.paused = true; clearTimeout(job.timer); void this.audio?.suspend().catch(error => job.finish(error)); }
  }
  resume() {
    const job = this.active; if (!job) return;
    if (job.kind === 'browser') { this.unlockAudio(); this.browser.resume(); }
    else {
      job.paused = false; clearTimeout(job.timer);
      job.timer = setTimeout(() => job.finish(new Error('Audio could not resume. Press Play again to allow sound.')), 20000);
      void this.audio?.resume().then(() => clearTimeout(job.timer), error => job.finish(error));
    }
  }
  stop() {
    const job = this.active;
    if (job?.kind === 'browser') this.browser.stop();
    if (job?.kind === 'piper') { this.runtime.cancel(); job.finish(aborted()); }
    this.active = null; this.status('');
  }
  releaseLocal() { this.stop(); this.runtime.dispose(); const audio = this.audio; this.audio = null; void audio?.close().catch(() => {}); }
  dispose() { this.disposed = true; this.releaseLocal(); this.browser.dispose(); this.unsubscribe(); this.unsubscribeBrowser(); this.listeners.clear(); this.statusListeners.clear(); }
}
