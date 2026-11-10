import { speechChunks } from './speech-chunks.js';

/** One incremental playback session. Future engines can synthesize paired blocks. */
export class TableReadPlayer {
  constructor(engine, { onChange = () => {}, speakerOptions = () => ({}) } = {}) {
    this.engine = engine; this.onChange = onChange; this.speakerOptions = speakerOptions;
    this.sequence = []; this.state = 'idle'; this.index = 0; this.generation = 0; this.active = false; this.speed = 1; this.error = '';
  }
  snapshot() { return { state: this.state, index: this.index, total: this.sequence.length, current: this.sequence[this.index] ?? null, progress: this.sequence.length ? Math.min(100, this.index / this.sequence.length * 100) : 0, error: this.error }; }
  emit() { this.onChange(this.snapshot()); }
  cancel() { this.generation++; this.engine.stop(); this.active = false; this.resumeWaiting?.(); this.resumeWaiting = null; }
  setSequence(sequence) { this.cancel(); this.sequence = sequence; this.index = 0; this.state = 'idle'; this.error = ''; this.emit(); }
  play() {
    if (!this.sequence.length) { this.state = 'completed'; this.emit(); return; }
    if (this.state === 'playing') return;
    if (this.state === 'paused' && (this.active || this.resumeWaiting)) {
      this.state = 'playing'; this.engine.resume(); this.resumeWaiting?.(); this.resumeWaiting = null; this.emit(); return;
    }
    if (this.index >= this.sequence.length) this.index = 0;
    this.cancel(); this.state = 'playing'; this.error = ''; this.emit();
    void this.run(this.generation);
  }
  async run(token) {
    try {
      while (token === this.generation && this.index < this.sequence.length) {
        const item = this.sequence[this.index];
        for (const chunk of speechChunks(item.text)) {
          if (this.state === 'paused') await new Promise(resolve => { this.resumeWaiting = resolve; });
          if (token !== this.generation) return;
          const options = this.speakerOptions(item.speakerId); this.active = true;
          await this.engine.speak(chunk, options.voice, { ...options, rate: (options.rate ?? 1) * this.speed,
            onPause: () => { if (token === this.generation && this.state === 'playing') { this.state = 'paused'; this.emit(); } },
            onResume: () => { if (token === this.generation && this.state === 'paused') { this.state = 'playing'; this.emit(); } },
          });
          if (token !== this.generation) return; this.active = false;
        }
        if (token !== this.generation) return;
        this.index++; this.emit();
      }
      if (token === this.generation) { this.state = 'completed'; this.emit(); }
    } catch (error) {
      if (token !== this.generation) return;
      this.active = false; this.state = 'error'; this.error = error.message; this.emit();
    }
  }
  pause() { if (this.state === 'playing') { this.state = 'paused'; this.engine.pause(); this.emit(); } }
  stop() { this.cancel(); this.state = 'stopped'; this.index = 0; this.error = ''; this.emit(); }
  restart() { this.stop(); this.play(); }
  seek(index, { play = this.state === 'playing' } = {}) {
    const wasPaused = this.state === 'paused'; this.cancel();
    this.index = Math.max(0, Math.min(this.sequence.length - 1, Number.isFinite(index) ? Math.floor(index) : 0));
    this.state = wasPaused && !play ? 'paused' : 'idle'; this.error = ''; this.emit(); if (play) this.play();
  }
  previous() { this.seek(this.index - 1); }
  next() {
    if (this.index >= this.sequence.length - 1) { this.cancel(); this.index = this.sequence.length; this.state = 'completed'; this.error = ''; this.emit(); }
    else this.seek(this.index + 1);
  }
  dispose() { this.cancel(); this.state = 'stopped'; }
}
