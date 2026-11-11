import { MixedSpeechEngine } from './mixed-speech-engine.js';
import { TableReadPlayer } from './table-read-player.js';
import { buildTableRead, spokenText, speakerSettings, tableReadPreferences, tableReadPreferenceKey, loadTableReadPreferences, orderedVoices, resolveVoice, voiceId } from './table-read-model.js';

export function setupTableRead({ repository, getDocument, onReturn = () => {}, openVoiceLibrary = () => {}, engineFactory = () => new MixedSpeechEngine() }) {
  const $ = id => document.getElementById(id), dialog = $('table-read-dialog');
  let doc, model, preferences, engine, player, voices = [], events, castEvents, previewEvents, open = false, epoch = 0, ready = false, previewToken = 0, previewing = false;
  let preferenceQueue = Promise.resolve(), pendingWrites = 0, highlighted = null, selectedId = null;
  let errors = { storage: '', playback: '', voices: '' }, voiceCatalogError = '';
  const paragraphs = new Map();
  function showErrors() { $('tr-error').textContent = Object.values(errors).filter(Boolean).join(' '); $('tr-error').hidden = !$('tr-error').textContent; }
  function profile(id) { return speakerSettings(preferences?.speakers[id]); }
  function optionsFor(id) {
    const settings = profile(id), index = model.speakers.findIndex(item => item.id === id);
    return { ...settings, voice: resolveVoice(voices, settings, index).voice };
  }
  function savePreferences() {
    const id = doc.id, snapshot = structuredClone(preferences), token = epoch;
    pendingWrites++; $('tr-preference-status').textContent = 'Saving voice settings…';
    preferenceQueue = preferenceQueue.catch(() => {}).then(() => repository.setPreference(tableReadPreferenceKey(id), snapshot));
    preferenceQueue.then(() => {
      if (open && token === epoch) { errors.storage = ''; showErrors(); if (pendingWrites === 1) $('tr-preference-status').textContent = 'Voice settings saved in this browser.'; }
    }, error => {
      if (open && token === epoch) { errors.storage = `Voice settings could not be saved: ${error.message}`; $('tr-preference-status').textContent = 'Voice settings not saved. Your screenplay is unchanged.'; showErrors(); }
    }).finally(() => { pendingWrites--; });
  }
  function stopPreview() { const activePreview = previewing; previewToken++; previewing = false; if (activePreview) engine?.stop(); }
  function updateState(state = player.snapshot()) {
    if (!open) return;
    const { current, index, total, progress } = state;
    $('tr-state').textContent = previewing ? 'Voice preview' : state.state; $('tr-state').dataset.state = state.state;
    $('tr-speaker').textContent = previewing ? 'Previewing voice' : current?.speaker ?? (state.state === 'completed' ? 'Table read complete' : 'Ready to read');
    $('tr-position').textContent = current ? `${current.sceneNumber ? `Scene ${current.sceneNumber} · ` : ''}${current.sceneTitle} · Element ${index + 1} of ${total}` : `${total} spoken ${total === 1 ? 'element' : 'elements'}`;
    $('tr-percent').textContent = `${Math.floor(progress)}%`; $('tr-progress').value = String(progress);
    $('tr-progress').setAttribute('aria-valuetext', `${Math.floor(progress)} percent of spoken elements completed`);
    const canSpeak = ready && engine.available && voices.length > 0 && total > 0;
    $('tr-play').textContent = state.state === 'paused' ? 'Resume' : state.state === 'completed' ? 'Play again' : 'Play';
    $('tr-play').disabled = !canSpeak || state.state === 'playing'; $('tr-pause').disabled = state.state !== 'playing' || previewing;
    $('tr-stop').disabled = !previewing && ['idle', 'stopped'].includes(state.state) && index === 0;
    $('tr-restart').disabled = !canSpeak; $('tr-previous').disabled = !total || index <= 0; $('tr-next').disabled = !total || index >= total;
    $('tr-progress').disabled = !total; $('tr-scene').disabled = !total;
    $('tr-read-here').disabled = !canSpeak || !selectedId;
    const activeId = ['playing', 'paused'].includes(state.state) && !previewing ? current?.elementId : null;
    if (activeId !== highlighted) {
      const previous = paragraphs.get(highlighted); previous?.classList.remove('tr-active'); previous?.removeAttribute('aria-current');
      highlighted = activeId;
      const paragraph = paragraphs.get(highlighted); paragraph?.classList.add('tr-active'); paragraph?.setAttribute('aria-current', 'true');
      paragraph?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    }
    if (!previewing) { errors.playback = state.error; showErrors(); }
  }
  async function preview(speaker) {
    stopPreview(); player.stop();
    const token = ++previewToken; previewing = true; errors.playback = ''; updateState();
    const text = model.sequence.find(item => item.speakerId === speaker.id)?.text ?? 'A little space for big stories.';
    // A preview is deliberately short and uses the same single-owner engine.
    let failure = '';
    try { const options = optionsFor(speaker.id); await engine.speak(text.slice(0, 180), options.voice, { ...options, rate: options.rate * preferences.speed }); }
    catch (error) { if (token === previewToken && error.name !== 'AbortError') failure = error.message; }
    finally { if (token === previewToken && open) { previewing = false; updateState(); if (failure) errors.playback = failure; showErrors(); } }
  }
  function renderCast() {
    castEvents?.abort(); castEvents = new AbortController();
    const tree = document.createDocumentFragment();
    model.speakers.forEach((speaker, index) => {
      const card = document.createElement('section'); card.className = 'tr-voice-card'; card.dataset.speakerId = speaker.id;
      const group = document.createElement('fieldset'); group.disabled = !ready;
      const heading = document.createElement('div'); heading.className = 'tr-voice-name';
      const name = document.createElement('strong'); name.textContent = speaker.name;
      const previewButton = document.createElement('button'); previewButton.textContent = 'Preview'; previewButton.type = 'button'; previewButton.setAttribute('aria-label', `Preview ${speaker.name}`); previewButton.disabled = !engine.available || !voices.length;
      previewButton.addEventListener('click', () => preview(speaker), { signal: castEvents.signal }); heading.append(name, previewButton);
      const select = document.createElement('select'); select.setAttribute('aria-label', `Voice for ${speaker.name}`); select.dataset.voiceFor = speaker.id;
      const saved = profile(speaker.id), resolved = resolveVoice(voices, saved, index);
      select.add(new Option(resolved.voice ? `Automatic · ${resolved.voice.name}` : 'No voices available yet', ''));
      for (const voice of voices) select.add(new Option(`${voice.name} · ${voice.lang}${voice.localService === false ? ' · online' : ''}`, voiceId(voice)));
      if (resolved.missing) { const missing = new Option('Saved voice unavailable', saved.voiceId); missing.disabled = true; select.add(missing); }
      select.value = saved.voiceId; select.disabled = !engine.available || !voices.length;
      select.addEventListener('change', () => { preferences.speakers[speaker.id] = { ...profile(speaker.id), voiceId: select.value }; savePreferences(); renderCast(); }, { signal: castEvents.signal });
      const parameters = document.createElement('div'); parameters.className = 'tr-voice-parameters';
      for (const [property, labelText, min, max] of [['rate', 'Rate', .5, 2], ['pitch', 'Pitch', 0, 2], ['volume', 'Volume', 0, 1]]) {
        const label = document.createElement('label'); label.textContent = labelText;
        const input = document.createElement('input'); input.type = 'number'; input.min = String(min); input.max = String(max); input.step = '.1'; input.value = String(saved[property]); input.setAttribute('aria-label', `${labelText} for ${speaker.name}`);
        input.addEventListener('change', () => {
          const value = Number(input.value);
          if (!input.value || !Number.isFinite(value) || value < min || value > max) { input.value = String(profile(speaker.id)[property]); return; }
          preferences.speakers[speaker.id] = { ...profile(speaker.id), [property]: value }; savePreferences();
        }, { signal: castEvents.signal });
        label.append(input); parameters.append(label);
      }
      group.append(heading, select, parameters);
      if (resolved.missing) { const warning = document.createElement('small'); warning.className = 'tr-voice-warning'; warning.textContent = resolved.voice ? `Saved voice is unavailable. Using ${resolved.voice.name} until it returns or you choose another.` : 'Saved voice is unavailable. Refresh voices or enable a voice in your system settings.'; group.append(warning); }
      card.append(group); tree.append(card);
    });
    $('tr-cast').replaceChildren(tree); $('tr-cast-count').textContent = `(${model.speakers.length})`;
    const missing = model.speakers.filter((speaker, index) => resolveVoice(voices, profile(speaker.id), index).missing).map(speaker => speaker.name);
    errors.voices = voiceCatalogError || (!engine.available ? 'This browser does not support browser speech synthesis. Import a compatible local voice in Voice Library, or use the screenplay preview.'
      : !voices.length ? 'No speech voices are available yet. Open Cast & voices to refresh, or enable a system voice.'
        : missing.length ? `Saved voices unavailable for ${missing.join(', ')}. Available fallback voices will be used; original assignments are retained.` : '');
    showErrors();
  }
  function refreshVoices() {
    try {
      voices = orderedVoices(engine.getVoices()); voiceCatalogError = '';
      $('tr-engine-notice').textContent = !engine.available ? 'This browser does not support browser speech synthesis. You can import a compatible Piper voice in Voice Library.' : !voices.length ? 'No voices are available yet. Wait for browser voices, try Refresh voices, or import a Piper voice in Voice Library.' : `${voices.length} ${voices.length === 1 ? 'voice' : 'voices'} available. Browser and imported voices can be assigned below.`;
    } catch (error) { voices = []; voiceCatalogError = `Browser voices could not be loaded: ${error.message}`; }
    if (engine.libraryError) voiceCatalogError = engine.libraryError;
    renderCast(); updateState(); showErrors();
  }
  function chooseParagraph(elementId) {
    paragraphs.get(selectedId)?.classList.remove('tr-selected'); selectedId = elementId; paragraphs.get(selectedId)?.classList.add('tr-selected');
    const item = model.sequence.find(item => item.elementId === elementId);
    $('tr-selection').textContent = item ? `${item.speaker} · ${item.sceneTitle}` : 'Start from this scene.'; updateState();
  }
  function renderPreview() {
    previewEvents?.abort(); previewEvents = new AbortController();
    paragraphs.clear(); highlighted = null; selectedId = null; $('tr-selection').textContent = 'Choose a paragraph to start from.';
    const indexes = new Map(model.sequence.map((item, index) => [item.elementId, index]));
    const scenes = new Map(model.scenes.map(scene => [scene.id, scene]));
    const tree = document.createDocumentFragment();
    for (const el of doc.elements) {
      if (!['scene', 'character', 'parenthetical', 'action', 'dialogue', 'lyric'].includes(el.type)) continue;
      const text = spokenText(el.text); if (!text) continue;
      const index = indexes.get(el.id) ?? (el.type === 'scene' ? scenes.get(el.id)?.startIndex : undefined);
      const readable = index !== undefined && index >= 0;
      const paragraph = document.createElement(readable ? 'button' : 'p');
      paragraph.dataset.elementId = el.id; paragraph.dataset.type = el.type;
      paragraph.className = ['character', 'parenthetical'].includes(el.type) ? el.type === 'character' ? 'tr-cue' : 'tr-parenthetical' : 'tr-paragraph';
      paragraph.textContent = text;
      if (readable) { paragraph.type = 'button'; paragraph.addEventListener('click', () => chooseParagraph(el.id), { signal: previewEvents.signal }); }
      paragraphs.set(el.id, paragraph); tree.append(paragraph);
    }
    if (!tree.childNodes.length) { const empty = document.createElement('p'); empty.className = 'tr-empty'; empty.textContent = 'This screenplay has no readable action or dialogue yet. Return to the editor to begin writing.'; tree.append(empty); }
    $('tr-script').replaceChildren(tree);
  }
  function rebuild() {
    stopPreview(); const previous = player?.snapshot();
    const currentId = previous && (previous.index > 0 || ['playing', 'paused', 'error'].includes(previous.state)) ? previous.current?.elementId : null;
    model = buildTableRead(doc, preferences); renderPreview(); renderCast();
    $('tr-scene').replaceChildren(new Option('Beginning', ''), ...model.scenes.map(scene => { const option = new Option(`Scene ${scene.number} — ${scene.title}`, scene.id); option.disabled = scene.startIndex < 0; return option; }));
    player.setSequence(model.sequence); player.speed = preferences.speed;
    const index = model.sequence.findIndex(item => item.elementId === currentId); if (index >= 0) player.seek(index, { play: false });
    updateState();
  }
  function listen(id, event, handler) { $(id).addEventListener(event, handler, { signal: events.signal }); }
  function toggleCast(value) { $('tr-sidebar').hidden = !value; $('tr-body').classList.toggle('tr-cast-hidden', !value); $('tr-cast-toggle').setAttribute('aria-expanded', String(value)); }
  async function close({ restore = true, wait = true } = {}) {
    if (!open) return;
    open = false; epoch++; events?.abort(); castEvents?.abort(); previewEvents?.abort(); stopPreview(); player?.dispose(); engine?.dispose();
    $('tr-close').disabled = true;
    if (wait) await preferenceQueue.catch(() => {});
    dialog.close(); $('tr-close').disabled = false; if (restore) onReturn();
  }
  async function launch() {
    const current = getDocument(); if (!current || open || dialog.open) return;
    doc = structuredClone(current); preferences = tableReadPreferences(); ready = false; voices = []; selectedId = null; previewing = false; voiceCatalogError = ''; errors = { storage: '', playback: '', voices: '' };
    open = true; const token = ++epoch; events = new AbortController(); engine = engineFactory();
    model = buildTableRead(doc, preferences); player = new TableReadPlayer(engine, { onChange: updateState, speakerOptions: optionsFor });
    $('tr-title').textContent = doc.title; $('tr-preference-status').textContent = 'Loading voice settings…'; $('tr-read-headings').disabled = true; $('tr-speed').disabled = true;
    $('tr-read-headings').checked = false; $('tr-speed').value = '1';
    dialog.showModal(); toggleCast(innerWidth > 760); rebuild();
    listen('tr-close', 'click', () => close()); dialog.addEventListener('cancel', event => { event.preventDefault(); void close(); }, { signal: events.signal });
    listen('tr-play', 'click', () => { stopPreview(); player.play(); });
    listen('tr-pause', 'click', () => player.pause()); listen('tr-stop', 'click', () => { stopPreview(); player.stop(); });
    listen('tr-restart', 'click', () => { stopPreview(); player.restart(); });
    listen('tr-previous', 'click', () => { stopPreview(); player.previous(); }); listen('tr-next', 'click', () => { stopPreview(); player.next(); });
    listen('tr-scene', 'change', () => { stopPreview(); const scene = model.scenes.find(item => item.id === $('tr-scene').value); player.seek(scene?.startIndex ?? 0, { play: false }); });
    listen('tr-progress', 'change', () => { stopPreview(); player.seek(Math.floor(Number($('tr-progress').value) / 100 * model.sequence.length)); });
    listen('tr-read-here', 'click', () => {
      const index = model.sequence.findIndex(item => item.elementId === selectedId);
      const scene = model.scenes.find(item => item.id === selectedId);
      if (index >= 0 || scene?.startIndex >= 0) { stopPreview(); player.seek(index >= 0 ? index : scene.startIndex, { play: true }); }
    });
    listen('tr-cast-toggle', 'click', () => toggleCast($('tr-sidebar').hidden));
    listen('tr-read-headings', 'change', () => { preferences.readSceneHeadings = $('tr-read-headings').checked; savePreferences(); rebuild(); });
    listen('tr-speed', 'change', () => { preferences.speed = Number($('tr-speed').value); player.speed = preferences.speed; savePreferences(); });
    listen('tr-refresh-voices', 'click', refreshVoices);
    listen('tr-voice-library', 'click', () => { stopPreview(); player.stop(); engine.releaseLocal?.(); openVoiceLibrary(); });
    const unsubscribeStatus = engine.subscribeStatus?.(message => { if (open) $('tr-engine-activity').textContent = message; });
    events.signal.addEventListener('abort', () => { unsubscribeStatus?.(); $('tr-engine-activity').textContent = ''; }, { once: true });
    try { engine.subscribeVoices(refreshVoices); refreshVoices(); }
    catch (error) { voiceCatalogError = `Browser voices could not be loaded: ${error.message}`; errors.voices = voiceCatalogError; showErrors(); }
    try {
      await preferenceQueue.catch(() => {});
      const [saved] = await Promise.all([loadTableReadPreferences(repository, doc.id), engine.ready ?? Promise.resolve()]); if (!open || token !== epoch) return;
      preferences = saved; ready = true; $('tr-read-headings').checked = preferences.readSceneHeadings; $('tr-speed').value = String(preferences.speed);
      $('tr-read-headings').disabled = false; $('tr-speed').disabled = false; $('tr-preference-status').textContent = 'Voice settings stay with this screenplay in this browser.'; rebuild();
    } catch (error) {
      if (!open || token !== epoch) return;
      // Do not overwrite preferences we could not read. Reopening retries storage.
      errors.storage = `Voice settings could not be loaded: ${error.message} Close and reopen the table read to retry.`;
      $('tr-preference-status').textContent = 'Saved voice settings unavailable.'; showErrors();
    }
  }
  $('simulate-table-read').addEventListener('click', launch);
  window.addEventListener('pagehide', () => { void close({ restore: false, wait: false }); });
  return { close };
}
