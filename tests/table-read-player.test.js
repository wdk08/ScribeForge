import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserSpeechEngine } from '../js/speech-engine.js';
import { TableReadPlayer } from '../js/table-read-player.js';
import { installSpeechMock } from './fixtures/speech-mock.js';
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const sequence = [{ elementId: 'a', text: 'First paragraph.', speakerId: 'narrator' }, { elementId: 'b', text: 'Second paragraph.', speakerId: 'noah' }];
function setup(options = {}) {
  const { synth, Utterance, voices } = installSpeechMock(), engine = new BrowserSpeechEngine({ synthesis: synth, Utterance, ...options });
  const changes = [], player = new TableReadPlayer(engine, { onChange: state => changes.push(state), speakerOptions: id => ({ voice: voices[id === 'narrator' ? 0 : 1], rate: 1.2, pitch: .8, volume: .6 }) });
  player.setSequence(sequence); return { synth, engine, player, changes, voices };
}
test('incremental playback assigns voices and settings per speaker, completes, and never queues overlapping speech', async () => {
  const { synth, engine, player, voices } = setup(); player.speed = 1.5; player.play();
  assert.equal(player.state, 'playing'); assert.equal(synth.history.length, 1); assert.equal(synth.active.voice, voices[0]); assert.ok(Math.abs(synth.active.rate - 1.8) < .00001);
  assert.equal(synth.active.pitch, .8); assert.equal(synth.active.volume, .6);
  await synth.finish(); assert.equal(player.index, 1); assert.equal(synth.active.voice, voices[1]);
  await synth.finish(); assert.equal(player.state, 'completed'); assert.equal(player.snapshot().progress, 100); assert.equal(synth.peakPending, 1);
  engine.dispose(); player.dispose();
});
test('pause and resume retain the same utterance; native interruption also updates the explicit state', async () => {
  const { synth, engine, player } = setup(); player.play(); const active = synth.active;
  player.pause(); assert.equal(player.state, 'paused'); assert.equal(synth.paused, true); player.play();
  assert.equal(player.state, 'playing'); assert.equal(synth.active, active); assert.equal(synth.history.length, 1);
  synth.pause(); assert.equal(player.state, 'paused'); player.play(); assert.equal(player.state, 'playing');
  player.stop(); await tick(); assert.equal(player.state, 'stopped'); assert.equal(player.index, 0); assert.equal(synth.active, null);
  engine.dispose();
});
test('previous, next, scene-style seeks and restart cancel stale speech and preserve paused navigation', async () => {
  const { synth, engine, player } = setup(); player.play(); const stale = synth.active.onend;
  player.next(); assert.equal(player.index, 1); assert.equal(synth.active.text, sequence[1].text); stale(); await tick(); assert.equal(player.index, 1);
  player.pause(); player.previous(); assert.equal(player.state, 'paused'); assert.equal(player.index, 0); assert.equal(synth.active, null);
  player.play(); assert.equal(synth.active.text, sequence[0].text);
  player.restart(); assert.equal(player.index, 0); assert.equal(player.state, 'playing');
  player.seek(1, { play: false }); assert.equal(player.state, 'idle'); assert.equal(player.index, 1); assert.equal(synth.active, null);
  player.play(); player.next(); assert.equal(player.state, 'completed'); player.previous(); assert.equal(player.index, 1);
  player.stop(); await tick(); assert.equal(synth.peakPending, 1); engine.dispose();
});
test('native errors enter error state at the current element and can be retried explicitly', async () => {
  const { synth, engine, player } = setup(); player.play(); await synth.fail('not-allowed');
  assert.equal(player.state, 'error'); assert.match(player.error, /Press Play/); assert.equal(player.index, 0);
  player.play(); assert.equal(player.state, 'playing'); await synth.fail('network'); assert.match(player.error, /installed local voice/);
  player.stop(); engine.dispose();
});
test('long paragraphs create only one bounded utterance at a time and remain stoppable', async () => {
  const { synth, engine, player } = setup(); player.setSequence([{ elementId: 'long', text: 'A long paragraph. '.repeat(2000), speakerId: 'narrator' }]); player.play();
  assert.equal(synth.history.length, 1); assert.ok(synth.active.text.length <= 220);
  await synth.finish(); assert.equal(player.index, 0); assert.equal(synth.history.length, 2);
  player.pause(); assert.equal(player.state, 'paused'); player.stop(); await tick(); assert.equal(synth.active, null); assert.equal(synth.peakPending, 1); engine.dispose();
});
test('voice listeners and utterance callbacks are removed on disposal; stalled speech reports a recoverable error', async () => {
  const { synth, engine, player } = setup({ stallMs: 5 });
  let updates = 0; const unsubscribe = engine.subscribeVoices(() => updates++); synth.updateVoices(); assert.equal(updates, 1); unsubscribe(); assert.equal(synth.voiceListeners.size, 0);
  player.play(); const utterance = synth.active; await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(player.state, 'error'); assert.match(player.error, /stopped responding/); assert.equal(utterance.onend, null);
  engine.subscribeVoices(() => {}); player.dispose(); engine.dispose(); assert.equal(synth.voiceListeners.size, 0); assert.equal(synth.active, null);
});
