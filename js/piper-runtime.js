const abortError = () => Object.assign(new Error('Local synthesis cancelled.'), { name: 'AbortError' });
export class PiperRuntime {
  constructor() { this.worker = null; this.pending = new Map(); this.cached = new Set(); this.nextId = 0; this.generation = 0; }
  async synthesize({ modelId, model, config, text, speakerId = 0, rate = 1, pitch = 1 }) {
    const generation = this.generation;
    const buffer = this.cached.has(modelId) ? null : await model.arrayBuffer();
    if (generation !== this.generation) throw abortError();
    if (!this.worker) {
      this.worker = new Worker(new URL('./piper-worker.js', import.meta.url), { type: 'module' });
      this.worker.onmessage = ({ data }) => {
        const pending = this.pending.get(data.id); if (!pending) return;
        clearTimeout(pending.timer); this.pending.delete(data.id);
        if (data.error) { pending.reject(new Error(`Piper synthesis failed: ${data.error}`)); this.cancel(); }
        else { this.cached = new Set(data.result.cachedIds); pending.resolve(data.result); }
      };
      this.worker.onerror = event => this.cancel(new Error(`Local speech worker failed: ${event.message}`));
      this.worker.onmessageerror = () => this.cancel(new Error('Local speech worker could not transfer audio.'));
    }
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.cancel(new Error('Local speech synthesis timed out. Stop and retry with a smaller compatible voice.')), 120000);
      this.pending.set(id, { resolve, reject, timer });
      this.worker.postMessage({ id, modelId, model: buffer, config, text, speakerId, rate, pitch }, buffer ? [buffer] : []);
    });
  }
  cancel(error = abortError()) {
    this.generation++; this.worker?.terminate(); this.worker = null; this.cached.clear();
    for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(error); } this.pending.clear();
  }
  dispose() { this.cancel(); }
}
