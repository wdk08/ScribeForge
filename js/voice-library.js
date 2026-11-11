import { voiceStore, importedVoices } from './voice-storage.js';
import { MixedSpeechEngine } from './mixed-speech-engine.js';
import { PiperRuntime } from './piper-runtime.js';
import { preparePiperImport } from './voice-import.js';
import { PIPER_TEST_TEXT } from './piper-config.js';
import { orderedVoices, voiceId } from './table-read-model.js';

export function setupVoiceLibrary({ launcher = document.getElementById('voice-library'), onReturn = () => {} } = {}) {
  const store = voiceStore(), dialog = document.createElement('dialog'); dialog.id = 'voice-library-dialog'; dialog.className = 'voice-library'; dialog.setAttribute('aria-labelledby', 'vl-title');
  dialog.innerHTML = `<header class="vl-header"><div><span class="eyebrow">LOCAL VOICES</span><h1 id="vl-title">Voice Library</h1></div><button id="vl-close" class="secondary-button">Done</button></header>
    <div class="vl-content"><section class="vl-import"><h2>Import a Piper voice</h2><p>Choose a Piper VITS ONNX model and its matching eSpeak configuration. Import runs a real local speech test before saving. Other ONNX architectures, external weight files, custom phoneme substitutions, and extra language-processing models are not supported.</p>
    <form id="vl-form"><label>ONNX model<input id="vl-model" type="file" accept=".onnx"></label><label>Configuration<input id="vl-config" type="file" accept=".json,.onnx.json"></label><label>Voice name<input id="vl-name" maxlength="100" placeholder="Uses the model filename by default"></label><label>Test / preview text<textarea id="vl-text" maxlength="400" rows="2"></textarea></label><div class="vl-actions"><button id="vl-import" type="submit" class="primary-button">Generate speech &amp; import</button><button id="vl-cancel-import" type="button" class="secondary-button" hidden>Cancel import</button></div></form>
    <p id="vl-status" role="status"></p><p id="vl-error" class="vl-error" role="alert" hidden></p><audio id="vl-audio" controls aria-label="Generated imported voice sample" hidden></audio>
    <details class="vl-browser"><summary>Browser voices</summary><div><select id="vl-browser-voice" aria-label="Browser voice"></select><button id="vl-browser-preview" class="secondary-button">Preview browser voice</button></div></details></section>
    <section class="vl-models"><div class="vl-heading"><h2>Imported voices</h2><button id="vl-refresh" class="secondary-button">Refresh</button></div><div id="vl-list"></div></section></div>
    <footer class="vl-footer">Models stay in this browser’s IndexedDB and are never uploaded. Keep the original files: clearing site data, private browsing, or storage eviction can remove imports. Use models you are licensed to use. Assign voices to speakers in Simulate Table Read.</footer>`;
  document.body.append(dialog); const $ = id => dialog.querySelector(`#${id}`);
  let events, rowEvents, engine, runtime, importController, active = false, importing = false, epoch = 0, records = [], audioUrl = null, previewToken = 0, importSequence = 0, committing = false;
  function error(message = '') { $('vl-error').textContent = message; $('vl-error').hidden = !message; }
  function status(message = '') { $('vl-status').textContent = message; }
  function stopAudio() { previewToken++; engine?.stop(); $('vl-audio').pause(); $('vl-audio').removeAttribute('src'); $('vl-audio').load(); $('vl-audio').hidden = true; if (audioUrl) URL.revokeObjectURL(audioUrl); audioUrl = null; }
  function busy(value) {
    importing = value; for (const id of ['vl-model', 'vl-config', 'vl-name', 'vl-text', 'vl-import', 'vl-refresh', 'vl-browser-preview', 'vl-browser-voice']) $(id).disabled = value;
    $('vl-cancel-import').hidden = !value;
    for (const button of $('vl-list').querySelectorAll('button,select,input')) button.disabled = value;
  }
  async function preview(voice) {
    stopAudio(); const token = ++previewToken; error(); status(`Previewing ${voice.name}…`);
    try { await engine.speak($('vl-text').value.trim() || PIPER_TEST_TEXT, voice, { rate: 1, pitch: 1, volume: 1 }); if (active && token === previewToken) status('Preview finished.'); }
    catch (failure) { if (active && token === previewToken && failure.name !== 'AbortError') { error(failure.message); status('Preview stopped.'); } }
  }
  function browserVoices() {
    const voices = orderedVoices(engine.browser.getVoices()); $('vl-browser-voice').replaceChildren(...voices.map(voice => new Option(`${voice.name} · ${voice.lang}`, voiceId(voice))));
    $('vl-browser-preview').disabled = importing || !voices.length; $('vl-browser-voice').disabled = importing || !voices.length;
  }
  async function refresh() {
    const token = epoch;
    try { const latest = await store.list(); if (!active || token !== epoch) return; records = latest; render(); await engine.refreshImported(); browserVoices(); }
    catch (failure) { if (active && token === epoch) error(`Voice Library could not load: ${failure.message}`); }
  }
  function render() {
    rowEvents?.abort(); rowEvents = new AbortController(); const tree = document.createDocumentFragment();
    if (!records.length) { const empty = document.createElement('p'); empty.className = 'vl-empty'; empty.textContent = 'No imported voices yet. Add a compatible .onnx model and its configuration to get started.'; tree.append(empty); }
    for (const record of records) {
      const card = document.createElement('article'); card.className = 'vl-card'; card.dataset.modelId = record.id;
      const title = document.createElement('h3'); title.textContent = record.name;
      const description = document.createElement('p'); description.textContent = `${record.config.language?.name_english ?? record.config.espeak.voice} · Piper VITS · ${(record.size / 1024 / 1024).toFixed(1)} MB · ${record.config.num_speakers} ${record.config.num_speakers === 1 ? 'speaker' : 'speakers'}`;
      const select = document.createElement('select'); select.setAttribute('aria-label', `Speaker in ${record.name}`);
      const variants = importedVoices([record]); select.replaceChildren(...variants.map(voice => new Option(voice.name, String(voice.speakerId)))); select.hidden = variants.length === 1;
      const actions = document.createElement('div'); actions.className = 'vl-actions';
      const play = document.createElement('button'); play.className = 'secondary-button'; play.textContent = 'Preview'; play.setAttribute('aria-label', `Preview imported ${record.name}`); play.addEventListener('click', () => preview(variants.find(voice => voice.speakerId === Number(select.value))), { signal: rowEvents.signal });
      const rename = document.createElement('button'); rename.className = 'quiet-button'; rename.textContent = 'Rename'; rename.setAttribute('aria-label', `Rename imported ${record.name}`);
      const renameForm = document.createElement('form'); renameForm.className = 'vl-rename'; renameForm.hidden = true;
      const renameInput = document.createElement('input'); renameInput.value = record.name; renameInput.maxLength = 100; renameInput.required = true; renameInput.setAttribute('aria-label', `New voice name for ${record.name}`);
      const renameSave = document.createElement('button'); renameSave.type = 'submit'; renameSave.textContent = 'Save name'; renameSave.className = 'secondary-button';
      const renameCancel = document.createElement('button'); renameCancel.type = 'button'; renameCancel.textContent = 'Cancel';
      rename.addEventListener('click', () => { renameForm.hidden = false; renameInput.focus(); renameInput.select(); }, { signal: rowEvents.signal });
      renameCancel.addEventListener('click', () => { renameForm.hidden = true; rename.focus(); }, { signal: rowEvents.signal });
      renameForm.addEventListener('submit', async event => { event.preventDefault(); renameSave.disabled = true; try { await store.rename(record.id, renameInput.value); await refresh(); status('Voice name updated. Existing voice assignments were preserved.'); } catch (failure) { error(failure.message); renameSave.disabled = false; } }, { signal: rowEvents.signal });
      renameForm.append(renameInput, renameCancel, renameSave);
      const remove = document.createElement('button'); remove.className = 'quiet-button'; remove.textContent = 'Remove';
      const confirmation = document.createElement('div'); confirmation.className = 'vl-confirm'; confirmation.hidden = true;
      const warning = document.createElement('p'); warning.textContent = 'Remove this model from this browser? Original files and screenplay voice assignments are kept. Those assignments will use a fallback until you reimport this voice.';
      const yes = document.createElement('button'); yes.className = 'secondary-button'; yes.textContent = 'Confirm removal'; const no = document.createElement('button'); no.textContent = 'Cancel';
      remove.addEventListener('click', () => { confirmation.hidden = false; }, { signal: rowEvents.signal }); no.addEventListener('click', () => { confirmation.hidden = true; }, { signal: rowEvents.signal });
      yes.addEventListener('click', async () => { yes.disabled = true; stopAudio(); engine.releaseLocal(); try { await store.remove(record.id); await refresh(); status('Imported model removed. Original files and screenplay assignments were preserved.'); } catch (failure) { error(failure.message); yes.disabled = false; } }, { signal: rowEvents.signal });
      confirmation.append(warning, yes, no); actions.append(select, play, rename, remove); card.append(title, description, actions, renameForm, confirmation); tree.append(card);
    }
    $('vl-list').replaceChildren(tree);
  }
  async function close({ force = false } = {}) {
    if (!active) return;
    if (committing && !force) { status('Finishing the verified voice storage write…'); return; } active = false; epoch++; importController?.abort(); runtime?.dispose(); stopAudio(); engine?.dispose(); events?.abort(); rowEvents?.abort(); dialog.close(); onReturn();
  }
  async function open() {
    if (active) return;
    active = true; const token = ++epoch; events = new AbortController(); engine = new MixedSpeechEngine({ store }); runtime = new PiperRuntime(); importing = false;
    $('vl-text').value ||= PIPER_TEST_TEXT; $('vl-model').value = ''; $('vl-config').value = ''; $('vl-name').value = ''; error(); status('Loading stored voices…'); busy(false); dialog.showModal();
    const listen = (id, event, handler) => $(id).addEventListener(event, handler, { signal: events.signal });
    listen('vl-close', 'click', close); dialog.addEventListener('cancel', event => { event.preventDefault(); void close(); }, { signal: events.signal });
    listen('vl-audio', 'play', () => { previewToken++; engine.stop(); status('Playing the generated imported voice sample.'); });
    listen('vl-refresh', 'click', () => { error(); void refresh(); });
    listen('vl-browser-preview', 'click', () => { const voice = engine.browser.getVoices().find(voice => voiceId(voice) === $('vl-browser-voice').value); if (voice) void preview(voice); });
    engine.subscribeVoices(() => { if (active) { try { browserVoices(); } catch (failure) { error(failure.message); } } });
    listen('vl-cancel-import', 'click', () => { importController?.abort(); runtime.cancel(); importSequence++; importController = null; busy(false); status('Import cancelled. No model was added.'); });
    listen('vl-form', 'submit', async event => {
      event.preventDefault(); if (importing) return; stopAudio(); error(); engine.releaseLocal(); busy(true); importController = new AbortController(); const signal = importController.signal, attempt = ++importSequence;
      try {
        if (!engine.localAvailable) throw new Error('Local Piper voices require WebAssembly, Web Workers, and Web Audio. Open ScriptForge on localhost in a compatible browser.');
        const prepared = await preparePiperImport({ model: $('vl-model').files[0], configuration: $('vl-config').files[0], name: $('vl-name').value, text: $('vl-text').value, runtime, signal, status: message => { if (active && attempt === importSequence) status(message); } });
        if (!active || token !== epoch || signal.aborted || attempt !== importSequence) return;
        // Confirm WAV decoding as well as real model inference before committing.
        const context = new (globalThis.AudioContext ?? globalThis.webkitAudioContext)();
        try { await context.decodeAudioData(await prepared.audio.arrayBuffer()); } finally { await context.close(); }
        if (!active || token !== epoch || signal.aborted || attempt !== importSequence) return;
        committing = true; $('vl-cancel-import').disabled = true; status('Saving verified voice to this browser…');
        const saved = await store.add(prepared.record); committing = false;
        if (!active || token !== epoch) return;
        audioUrl = URL.createObjectURL(prepared.audio); $('vl-audio').src = audioUrl; $('vl-audio').hidden = false;
        await refresh(); status(`“${saved.name}” is stored and ready. Play the generated sample below or use Preview.`);
        $('vl-model').value = ''; $('vl-config').value = ''; $('vl-name').value = '';
      } catch (failure) { if (active && token === epoch && attempt === importSequence) { if (failure.name === 'AbortError') status('Import cancelled. No model was added.'); else { error(failure.name === 'QuotaExceededError' ? 'Not enough browser storage. Keep your model files and free space before retrying. Existing voices and screenplays were preserved.' : failure.message); status('Voice import did not finish. Existing voices were preserved.'); } } }
      finally { if (active && token === epoch && attempt === importSequence) { committing = false; runtime.dispose(); busy(false); $('vl-cancel-import').disabled = false; importController = null; try { browserVoices(); } catch {} } }
    });
    await refresh(); if (active && token === epoch) status('Choose an imported voice to preview, or add a compatible Piper model.');
  }
  launcher?.addEventListener('click', () => { void open(); });
  window.addEventListener('pagehide', () => { void close({ force: true }); });
  return { open, close };
}
