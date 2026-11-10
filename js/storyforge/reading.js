import { BrowserSpeechEngine } from '../speech-engine.js';
import { TableReadPlayer } from '../table-read-player.js';
import { schema } from './model.js';
import { $, getPreference, setPreference } from './ui.js';

export function readingSequence(doc, { from, to }, mode) {
  const start = mode === 'manuscript' ? 0 : from;
  const end = mode === 'selection' ? to : doc.content.size;
  const sequence = [];
  doc.forEach((node, pos) => {
    if (node.type !== schema.nodes.paragraph) return;
    const left = Math.max(0, start - pos - 1);
    const right = Math.min(node.content.size, end - pos - 1);
    if (right <= left) return;
    const text = node.textBetween(left, right, '', '\n').trim();
    if (text) sequence.push({ text, pos, speakerId: 'reader' });
  });
  return sequence;
}

export function setupReading(view) {
  const dialog = $('read-dialog');
  const voice = $('tr-voice');
  const from = $('tr-start');
  const engine = new BrowserSpeechEngine();
  let voices = [];
  let captured;
  const player = new TableReadPlayer(engine, {
    speakerOptions: () => ({ voice: voices.find(item => item.voiceURI === voice.value) }),
    onChange(state) {
      const available = Boolean(voice.value && state.total);
      $('tr-state').textContent = { idle: 'Ready', playing: 'Playing', paused: 'Paused', stopped: 'Stopped', completed: 'Finished', error: 'Playback error' }[state.state];
      $('tr-position').textContent = state.total ? `Paragraph ${Math.min(state.index + 1, state.total)} of ${state.total}` : '';
      $('tr-play').textContent = state.state === 'paused' ? 'Resume' : 'Play';
      $('tr-play').disabled = !available || state.state === 'playing';
      $('tr-pause').disabled = state.state !== 'playing';
      $('tr-stop').disabled = !['playing', 'paused', 'error', 'completed'].includes(state.state);
      $('tr-previous').disabled = !available || state.index === 0;
      $('tr-next').disabled = !available || state.index >= state.total - 1;
      $('tr-progress').value = state.progress;
      $('tr-preview-text').textContent = state.current?.text.slice(0, 280) ?? '';
      const error = $('tr-error');
      error.textContent = !engine.available ? 'Speech synthesis is unavailable on this device.' :
        !voices.length ? 'No installed local speech voices are available.' : state.error;
      error.hidden = !error.textContent;
    },
  });
  function loadVoices() {
    const current = voice.value || getPreference('read-voice', '');
    voices = engine.getVoices().filter(item => item.localService);
    voice.replaceChildren(...voices.map(item => new Option(`${item.name} (${item.lang})`, item.voiceURI)));
    const chosen = voices.find(item => item.voiceURI === current) ?? voices.find(item => item.default);
    if (chosen) voice.value = chosen.voiceURI;
    if (!voices.length && ['playing', 'paused'].includes(player.state)) player.stop();
    else player.emit();
  }
  function setSequence() { player.setSequence(readingSequence(captured.doc, captured.selection, from.value)); }
  $('read-to-me').addEventListener('click', () => {
    captured = { doc: view.state.doc, selection: view.state.selection };
    from.querySelector('option[value=selection]').disabled = captured.selection.empty;
    from.value = !captured.selection.empty ? 'selection' : captured.selection.from > 1 ? 'cursor' : 'manuscript';
    loadVoices();
    setSequence();
    dialog.showModal();
  });
  from.addEventListener('change', setSequence);
  voice.addEventListener('change', () => {
    try { setPreference('read-voice', voice.value); } catch {}
  });
  $('tr-speed').value = String(getPreference('read-speed', 1)).replace(/^0\./, '.');
  player.speed = Number($('tr-speed').value) || 1;
  $('tr-speed').addEventListener('change', event => {
    player.speed = Number(event.target.value);
    try { setPreference('read-speed', player.speed); } catch {}
  });
  for (const action of ['play', 'pause', 'stop', 'previous', 'next']) $(`tr-${action}`).addEventListener('click', () => player[action]());
  dialog.addEventListener('close', () => { player.stop(); view.focus(); });
  engine.subscribeVoices(() => { if (dialog.open) loadVoices(); });
  window.addEventListener('pagehide', () => player.stop());
}
