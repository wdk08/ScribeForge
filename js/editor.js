import { flushForUpdate } from './update-safety.js';
import { setupEditorFeatures } from './editor-features.js';
import { setupActiveElement } from './active-element.js';
import { backups } from './backups.js';
import { setupTitlePage } from './title-page.js';
import { setupSceneAutocomplete } from './scene-autocomplete.js';
import { setupToolbarMenus } from './toolbar-menus.js';
import { createDocument, createElement, validateDocument } from './document.js';
import { setupCharacterRename } from './character-rename-dialog.js';
import { carryCharacterVoice, renameCharacter } from './characters.js';
import { screenplaySettings } from './screenplay-settings.js';
import { parseFountain } from './fountain.js';
import { EditorHistory, editableElements, caret, selectedText, orderedSelection } from './editing.js';
import { createMeasurer, layoutUnits, paginate } from './pagination.js';
import { ensureScreenplayFonts } from './screenplay-format.js';
import { renderPages, invalidateNativeEdit } from './renderer.js';
import { readSelection, restoreSelection, adjacentCaret, domPoint, verticalCaret } from './selection.js';
import { repository } from './storage.js';
import { fileService, fountainFilename } from './files.js';
import { DocumentSession, draftRecord, recordForFile, fountainForSaving } from './session.js';
import { createAutoSavedDraft, importOpenedFile } from './library.js';

import { exportPDF } from './pdf-export.js';
import { setupVoiceLibrary } from './voice-library.js';
import { setupTableRead } from './table-read.js';
import { setupFolderSetting } from './folder-settings.js';
const $ = id => document.getElementById(id);
const toolbarMenus = setupToolbarMenus();
const folderSettings = setupFolderSetting($('screenplay-folder'), { onChange: async directory => {
  void refreshSettingsFolder();
  if (!session) return;
  try {
    if (missingLinkedFile()) { await session.recreateMissingFile(directory); fileAccessError = null; }
    else if (!session.record.handle) await session.saveToFolder(directory);
    else if (session.record.handle && !session.recovered) { session.autoFile = true; await session.flush(); }
  } catch (error) { notify(`Not saved to disk: ${error.message}`); updateFileState(); }
} });
const root = $('pages');
const activeElement = setupActiveElement(root);
const formatShortcuts = { 1: 'scene', 2: 'action', 3: 'character', 4: 'parenthetical', 5: 'dialogue', 6: 'transition' };
for (const [key, type] of Object.entries(formatShortcuts)) {
  const button = document.querySelector(`[data-format="${type}"]`);
  button.title = `${type === 'scene' ? 'Scene Heading' : button.textContent} (⌘/Ctrl + ${key})`;
}
let plainPaste = false;
const titlePage = setupTitlePage($('title-page'), (field, value) => {
  if (!history) return;
  try {
    const state = history.apply(currentSelection, { type: 'titlePage', field, value });
    dirty = true; session.changed(state.document, currentSelection);
    features?.update(); titlePage.update(state.document); $('document-title').value = state.document.title;
    $('workspace-title').textContent = state.document.title.toUpperCase(); updateTools();
  } catch (error) { notify(error.message); }
}, redo => undo(redo));
$('paste-plain-text').addEventListener('click', event => {
  plainPaste = !plainPaste; event.target.setAttribute('aria-pressed', String(plainPaste));
  event.target.textContent = `Paste as Plain Text: ${plainPaste ? 'On' : 'Off'}`;
  closeMenu(); restoreSelection(root, currentSelection);
});
const sceneAutocomplete = setupSceneAutocomplete({ root, getDocument: () => history?.current.document, getSelection: () => readSelection(root) ?? currentSelection, apply: command => apply(command) });
const demo = `INT. RELAY STATION - NIGHT #1#

A tiny light pulses in the dark. Rain works its way down the windows of a room that hasn't changed in thirty years.

NOAH
(into the radio)
If anyone can hear this, the signal is still alive.

AVA
You said that an hour ago.

NOAH
And I meant it an hour ago.

A crackle. Not static this time. Something deliberate.

NOAH
Did you hear that?

AVA ^
Don't touch the dial.
(listening)
There it is again.

They look at each other. For the first time tonight, neither of them knows what to say.

EXT. RELAY STATION - NIGHT #2#

Beyond the fence, the trees stand perfectly still. The rain has stopped.

AVA
Noah. Come and look at this.

NOAH
I'm on my way.

An unseen light travels across the hills. One by one, the distant towers begin to answer.

>CUT TO:
`;

let features, editingLocked = false;
let history, currentSelection, pageLayout = [], dirty = false, composition = null;
let outlineSignature = '', wordCounts = new Map();
let composingJustEnded = false, noticeTimer, renderTimer, preferredX = null;
let session, allowLeave = false, fileAccessError = null, reviewedHash = null, ioBusy = false;
const measure = createMeasurer($('measurement'));
function notify(message) {
  $('notice').textContent = message; $('notice').hidden = false;
  clearTimeout(noticeTimer); noticeTimer = setTimeout(() => { $('notice').hidden = true; }, 6500);
}
function load(doc, record) {
  session?.dispose();
  if (!editableElements(doc).length) doc.elements.push(createElement('action', ''));
  const elements = editableElements(doc);
  const freshTemplate = elements.length === 2 && elements[0].type === 'transition' && elements[0].text === 'FADE IN:' && elements[1].type === 'action' && !elements[1].text;
  const start = freshTemplate ? elements[1] : elements[0];
  currentSelection = caret(start.id);
  history = new EditorHistory(doc, currentSelection); dirty = false;
  session = new DocumentSession(repository, fileService, record, doc, { onState: updateFileState, automatic: true });
  if (record.recovery.selection?.focus && editableElements(doc).some(el => el.id === record.recovery.selection.focus.id)
    && editableElements(doc).some(el => el.id === record.recovery.selection.anchor.id)) currentSelection = record.recovery.selection;
  session.selection = currentSelection;
  document.body.classList.remove('loading-editor');
  root.contentEditable = 'true';
  render(false);
  updateFileState();
  features?.loaded();
  window.history.replaceState(null, '', `./editor.html?id=${encodeURIComponent(record.id)}`);
  const loaded = session;
  if (record.pendingRenames?.length) loaded.retryRenameCleanup().catch(error => notify(error.message));
  if (!record.handle && !loaded.recovered) repository.getPreference('screenplayFolder', null).then(async directory => {
    if (directory && session === loaded) await loaded.saveToFolder(directory);
  }).catch(error => { if (session === loaded) { loaded.fileError = error; updateFileState(); } });
}

function activeType() {
  const elements = editableElements(history.current.document);
  const index = elements.findIndex(el => el.id === currentSelection.focus.id);
  const el = elements[index];
  if (!el) return 'action';
  if (['character', 'parenthetical', 'dialogue'].includes(el.type)) {
    let i = index;
    while (i >= 0 && ['character', 'parenthetical', 'dialogue'].includes(elements[i].type)) {
      if (elements[i].type === 'character') return elements[i].dual ? `dual${el.type[0].toUpperCase()}${el.type.slice(1)}` : el.type;
      i--;
    }
  }
  return el.type;
}
function updateTools() {
  if (!history) return;
  const type = activeType();
  for (const button of document.querySelectorAll('[data-format]')) button.setAttribute('aria-pressed', String(button.dataset.format === type));
  $('element-status').textContent = type.replace(/^dual/, 'Dual ').replace(/^[a-z]/, letter => letter.toUpperCase());
  $('undo').disabled = !history.past.length; $('redo').disabled = !history.future.length;
}
function render(focus = true) {
  if (composition) return;
  const doc = history.current.document;
  $('bold-scene-headings').checked = screenplaySettings(doc).boldSceneHeadings;
  $('scene-numbers').checked = screenplaySettings(doc).sceneNumbers;
  const viewport = document.querySelector('.document-viewport');
  const scrollTop = viewport.scrollTop, horizontal = viewport.scrollLeft, sceneScrollTop = $('scene-list').scrollTop;
  pageLayout = paginate(layoutUnits(doc, measure));
  renderPages(root, pageLayout, doc);
  titlePage.update(doc);
  const requestedZoom = $('zoom').value;
  const maxZoom = Math.max(.25, (viewport.clientWidth - 36) / 816);
  const zoom = String(requestedZoom === 'fit' ? Math.min(1, maxZoom) : Number(requestedZoom));
  if (root.style.getPropertyValue('--page-zoom') !== zoom) root.style.setProperty('--page-zoom', zoom);
  $('title-page').style.zoom = root.style.getPropertyValue('--page-zoom');
  if (document.activeElement !== $('document-title')) $('document-title').value = doc.title;
  $('workspace-title').textContent = doc.title.toUpperCase();
  const scenes = doc.elements.filter(el => el.type === 'scene');
  $('scene-count').textContent = String(scenes.length);
  const nextOutline = JSON.stringify(scenes.map(scene => [scene.id,scene.text]));
  if (outlineSignature !== nextOutline) {
  outlineSignature = nextOutline;
  const fragment = document.createDocumentFragment();
  scenes.forEach((scene, index) => {
    const button = document.createElement('button'); button.className = 'scene-link';
    button.dataset.sceneId = scene.id;
    const number = document.createElement('span'); number.textContent = String(index + 1).padStart(2, '0');
    const title = document.createElement('strong'); title.textContent = scene.text;
    button.append(number, title); button.addEventListener('click', () => {
      currentSelection = caret(scene.id); restoreSelection(root, currentSelection, { scroll: true }); updateTools();
    }); fragment.append(button);
  });
  $('scene-list').replaceChildren(fragment);
  }
  $('scene-list').scrollTop = sceneScrollTop;
  const nextCounts = new Map(); let words = 0;
  for (const el of editableElements(doc)) {
    const previous = wordCounts.get(el.id), count = previous?.text === el.text ? previous.count : el.text.trim().split(/\s+/).filter(Boolean).length;
    nextCounts.set(el.id,{text:el.text,count}); words += count;
  }
  wordCounts = nextCounts;
  $('document-stats').textContent = `${pageLayout.length} ${pageLayout.length === 1 ? 'page' : 'pages'}  ·  ${words.toLocaleString()} words`;
  updateFileState();
  if (focus) restoreSelection(root, currentSelection);
  activeElement.update();
  viewport.scrollTop = scrollTop; viewport.scrollLeft = horizontal;
  updateTools();
  features?.update();
}
function apply(command, selection = readSelection(root) ?? currentSelection) {
  if (editingLocked) return;
  if (features?.needsBackup(command, selection)) {
    const original = history.current.document;
    editingLocked = true; root.contentEditable = 'false';
    return features.beforeChange(command, selection).then(() => {
      if (history.current.document !== original) throw new Error('The screenplay changed while backing up. Please try the edit again.');
      editingLocked = false; root.contentEditable = 'true';
      return apply({ ...command, safetyCaptured: true }, selection);
    }).catch(error => { notify(`Edit stopped: ${error.message}`); }).finally(() => { editingLocked = false; root.contentEditable = 'true'; });
  }
  preferredX = null;
  try {
    const state = history.apply(selection, command);
    currentSelection = state.selection; dirty = true;
    session.changed(state.document, currentSelection);
    render(false); restoreSelection(root, currentSelection, { scroll: true }); activeElement.update(); sceneAutocomplete.update({ edited: true });
  } catch (error) { notify(error.message); }
}
function undo(redo = false) {
  if (editingLocked) return;
  const state = redo ? history.redo() : history.undo();
  const titleFocused = document.activeElement?.matches('[data-title-field], #document-title');
  currentSelection = state.selection; dirty = true; render(false); if (!titleFocused) { restoreSelection(root, currentSelection, { scroll: true }); activeElement.update(); }
  session.changed(state.document, currentSelection); sceneAutocomplete.update({ edited: true });
}

document.addEventListener('selectionchange', () => {
  if (composition || !history) return;
  const selection = readSelection(root);
  if (selection) { currentSelection = selection; updateTools(); sceneAutocomplete.update(); }
});
root.addEventListener('beforeinput', event => {
  if (event.isComposing || composition || event.inputType === 'insertCompositionText') return;
  event.preventDefault();
  if (composingJustEnded && event.inputType === 'insertFromComposition') return;
  let selection = readSelection(root) ?? currentSelection;
  const target = event.getTargetRanges?.()[0];
  if (event.inputType === 'insertReplacementText' && target) {
    const anchor = domPoint(target.startContainer, target.startOffset, root), focus = domPoint(target.endContainer, target.endOffset, root);
    if (anchor && focus) selection = { anchor, focus };
  }
  if (['insertText', 'insertReplacementText'].includes(event.inputType)) apply({ type: 'insert', text: event.data ?? '' }, selection);
  else if (event.inputType === 'insertParagraph') apply({ type: 'enter' }, selection);
  else if (event.inputType === 'insertLineBreak') apply({ type: 'lineBreak' }, selection);
  else if (event.inputType === 'deleteContentBackward') apply({ type: 'backspace' }, selection);
  else if (event.inputType === 'deleteContentForward') apply({ type: 'delete' }, selection);
  else if (event.inputType === 'historyUndo') undo();
  else if (event.inputType === 'historyRedo') undo(true);
  else if (event.inputType.startsWith('delete') && !['deleteByCut', 'deleteByDrag'].includes(event.inputType)) {
    const range = orderedSelection(history.current.document, selection);
    if (range.first === range.last && range.start.offset === range.end.offset) {
      const el = range.elements[range.first], backwards = /Backward$/.test(event.inputType), at = range.start.offset;
      const length = backwards ? (el.text.slice(0, at).match(/\S*\s*$/)?.[0].length ?? 1) : (el.text.slice(at).match(/^\s*\S*/)?.[0].length ?? 1);
      selection = { anchor: { id: el.id, offset: at }, focus: { id: el.id, offset: backwards ? at - length : at + length } };
    }
    apply({ type: 'insert', text: '' }, selection);
  }
});
root.addEventListener('compositionstart', () => { composition = { selection: readSelection(root) ?? currentSelection, fragment: root.querySelector('.active-writing-area') }; });
root.addEventListener('compositionend', event => {
  const original = composition; composition = null; composingJustEnded = true;
  invalidateNativeEdit(root, original?.fragment);
  if (original && event.data) apply({ type: 'insert', text: event.data }, original.selection);
  else render();
  setTimeout(() => { composingJustEnded = false; }, 0);
});
root.addEventListener('keydown', event => {
  if (event.isComposing || composition) return;
  if (sceneAutocomplete.keydown(event)) return;
  const mod = event.metaKey || event.ctrlKey;
  const key = event.key.toLowerCase();
  const selection = readSelection(root) ?? currentSelection;
  if (mod && !event.shiftKey && !event.altKey && [']','[','\\'].includes(event.key)) {
    event.preventDefault(); event.stopPropagation(); apply({ type: 'rightMargin', ...(event.key === '\\' ? { reset: true } : { delta: event.key === ']' ? -5 : 5 }) }, selection); return;
  }
  if (mod && !event.shiftKey && !event.altKey && formatShortcuts[key]) {
    event.preventDefault(); apply({ type: 'format', elementType: formatShortcuts[key] }, selection); return;
  }
  if (mod && key === 'z') { event.preventDefault(); undo(event.shiftKey); return; }
  if (mod && key === 'y') { event.preventDefault(); undo(true); return; }
  if (mod && key === 's') { event.preventDefault(); saveToDisk(); return; }
  if (event.key === 'Tab' && !mod && !event.altKey) {
    const element = history.current.document.elements.find(el => el.id === selection.focus.id);
    if (element) { event.preventDefault(); apply({ type: 'tab', reverse: event.shiftKey }, selection); }
    return;
  }
  if (event.key === 'Enter') { event.preventDefault(); apply(event.shiftKey ? { type: 'lineBreak' } : { type: 'enter' }); return; }
  if (['Home', 'End'].includes(event.key) || (event.metaKey && ['ArrowLeft', 'ArrowRight'].includes(event.key))) {
    event.preventDefault(); preferredX = null;
    const end = ['End', 'ArrowRight'].includes(event.key);
    const els = editableElements(history.current.document);
    let target;
    if (mod && !event.key.startsWith('Arrow')) {
      const el = end ? els.at(-1) : els[0]; target = caret(el.id, end ? el.text.length : 0);
    } else {
      const el = els.find(el => el.id === selection.focus.id);
      const lines = pageLayout.flatMap(page => page.items.flatMap(item => item.columns.flat())).filter(line => line.id === el.id);
      const line = lines.find(line => selection.focus.offset >= line.start && selection.focus.offset < line.end) ?? lines.at(-1);
      let offset = end ? line.end : line.start;
      if (end && offset < el.text.length) offset--;
      target = caret(el.id, offset);
    }
    currentSelection = event.shiftKey ? { anchor: selection.anchor, focus: target.focus } : target;
    restoreSelection(root, currentSelection, { scroll: true }); return;
  }
  if ((event.ctrlKey || event.altKey) && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
    event.preventDefault(); preferredX = null;
    const el = history.current.document.elements.find(el => el.id === selection.focus.id);
    const at = selection.focus.offset, direction = event.key === 'ArrowLeft' ? -1 : 1;
    const text = direction < 0 ? el.text.slice(0, at) : el.text.slice(at);
    const length = direction < 0 ? text.match(/\S*\s*$/)?.[0].length ?? 0 : text.match(/^\s*\S*/)?.[0].length ?? 0;
    const target = length ? caret(el.id, at + direction * length) : adjacentCaret(history.current.document, selection, direction);
    currentSelection = event.shiftKey ? { anchor: selection.anchor, focus: target.focus } : target;
    restoreSelection(root, currentSelection, { scroll: true }); return;
  }
  if (!mod && !event.altKey && ['ArrowUp', 'ArrowDown'].includes(event.key)) {
    event.preventDefault();
    const selection = readSelection(root) ?? currentSelection;
    const target = verticalCaret(root, pageLayout, selection, event.key === 'ArrowUp' ? -1 : 1, preferredX);
    preferredX = target.preferredX;
    currentSelection = event.shiftKey ? { anchor: selection.anchor, focus: target.selection.focus } : target.selection;
    restoreSelection(root, currentSelection, { scroll: true }); return;
  }
  if (mod && key === 'a') {
    event.preventDefault(); const els = editableElements(history.current.document);
    currentSelection = { anchor: { id: els[0].id, offset: 0 }, focus: { id: els.at(-1).id, offset: els.at(-1).text.length } };
    restoreSelection(root, currentSelection); return;
  }
  if (!mod && !event.altKey && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
    preferredX = null;
    event.preventDefault();
    const selection = readSelection(root) ?? currentSelection;
    const range = orderedSelection(history.current.document, selection);
    const direction = event.key === 'ArrowLeft' ? -1 : 1;
    if (!event.shiftKey && (range.first !== range.last || range.start.offset !== range.end.offset)) {
      currentSelection = caret(direction < 0 ? range.start.id : range.end.id, direction < 0 ? range.start.offset : range.end.offset);
    } else {
      const el = history.current.document.elements.find(el => el.id === selection.focus.id);
      const at = selection.focus.offset;
      const within = direction < 0 ? at > 0 : at < el.text.length;
      const step = within ? direction < 0 ? [...el.text.slice(0, at)].at(-1).length : [...el.text.slice(at)][0].length : 0;
      const target = within ? caret(el.id, at + direction * step) : adjacentCaret(history.current.document, selection, direction);
      currentSelection = event.shiftKey ? { anchor: selection.anchor, focus: target.focus } : target;
    }
    restoreSelection(root, currentSelection, { scroll: true });
  }
});
root.addEventListener('pointerdown', event => {
  preferredX = null;
  const fragment = event.target.closest('[data-element-id]');
  const cue = history?.current.document.elements.find(el => el.id === fragment?.dataset.elementId && el.type === 'character');
  if ((event.metaKey || event.ctrlKey) && cue) {
    event.preventDefault(); apply({ type: 'toggleContinuation', id: cue.id }, currentSelection);
  }
});
root.addEventListener('paste', event => {
  event.preventDefault(); apply({ type: 'paste', text: event.clipboardData.getData('text/plain'), plain: plainPaste });
});
root.addEventListener('copy', event => {
  const selection = readSelection(root) ?? currentSelection;
  event.preventDefault(); event.clipboardData.setData('text/plain', selectedText(history.current.document, selection));
});
root.addEventListener('cut', event => {
  const selection = readSelection(root) ?? currentSelection;
  event.preventDefault(); event.clipboardData.setData('text/plain', selectedText(history.current.document, selection));
  apply({ type: 'insert', text: '' }, selection);
});
root.addEventListener('drop', event => {
  event.preventDefault();
  const range = document.caretRangeFromPoint?.(event.clientX, event.clientY);
  const target = range && domPoint(range.startContainer, range.startOffset, root);
  apply({ type: 'paste', text: event.dataTransfer.getData('text/plain') }, target ? caret(target.id, target.offset) : currentSelection);
});
root.addEventListener('dragover', event => event.preventDefault());

for (const button of document.querySelectorAll('[data-format], #undo, #redo')) button.addEventListener('mousedown', event => event.preventDefault());
$('format-toolbar').addEventListener('click', event => {
  const button = event.target.closest('[data-format]');
  if (button) apply({ type: 'format', elementType: button.dataset.format });
});
$('undo').addEventListener('click', () => undo()); $('redo').addEventListener('click', () => undo(true));
$('zoom').addEventListener('change', () => render());
$('outline-toggle').addEventListener('click', () => {
  $('outline').hidden = !$('outline').hidden;
  $('outline-toggle').setAttribute('aria-pressed', String(!$('outline').hidden)); render();
});
$('help').addEventListener('click', () => $('help-dialog').showModal());
$('document-title').addEventListener('input', event => {
  if (!history) return;
  const state = history.apply(currentSelection, { type: 'titlePage', field: 'title', value: event.target.value });
  session.changed(state.document, currentSelection); dirty = true;
  features?.update(); titlePage.update(state.document); $('workspace-title').textContent = state.document.title.toUpperCase(); updateTools();
});
$('document-title').addEventListener('keydown', event => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); undo(event.shiftKey); $('document-title').value = history.current.document.title; }
});
$('new-document').addEventListener('click', async () => {
  try {
    await session?.flush(); await folderSettings.beforeCreate(); const record = await createAutoSavedDraft({ deferDisk: true }); fileAccessError = null;
    load(record.recovery.document, record); closeMenu(); render();
  } catch (error) { notify(`Could not start a new screenplay: ${error.message}`); }
});
async function exportFountain() {
  try {
    const doc = history.current.document;
    let warning;
    await fileService.download(fountainForSaving(doc, { onWarning: text => { warning = text; } }), fountainFilename(doc.title)); closeMenu(); document.querySelector('.export-menu').open = false;
    notify(warning || 'Fountain copy exported. Autosave continues updating your linked file.');
  } catch (error) { notify(`Export stopped: ${error.message}`); }
}
$('export-fountain').addEventListener('click', exportFountain);
$('save').addEventListener('click', saveToDisk);
async function exportScreenplayPDF() {
  document.querySelector('.export-menu').open = false;
  try { await exportPDF(history.current.document); closeMenu(); notify('PDF exported.'); }
  catch (error) { notify(`PDF export stopped: ${error.message}`); }
}
$('export-pdf').addEventListener('click', exportScreenplayPDF);
$('export-pdf-copy').addEventListener('click', exportScreenplayPDF);
$('export-copy').addEventListener('click', exportFountain);
document.addEventListener('keydown', event => {
  if (!event.defaultPrevented && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
    event.preventDefault(); saveToDisk();
  }
});
document.addEventListener('click', event => {
  const menu = document.querySelector('.export-menu'); if (!menu.contains(event.target)) menu.open = false;
});
document.addEventListener('keydown', event => {
  const menu = document.querySelector('.export-menu'); if (event.key === 'Escape' && menu.open) { menu.open = false; $('export').focus(); }
});
window.addEventListener('beforeunload', event => { if (!allowLeave && session?.dirty) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('resize', () => { clearTimeout(renderTimer); renderTimer = setTimeout(() => { if (history) render(Boolean(readSelection(root))); }, 100); });

// Read-only access for integration tests; writes still go through editing transactions.
window.scriptForge = Object.freeze({
  getDocument: () => structuredClone(history.current.document),
  getSelection: () => readSelection(root) ?? structuredClone(currentSelection),
  getPages: () => structuredClone(pageLayout),
  getFileState: () => session ? { id: session.record.id, dirty: session.dirty, recoveryCurrent: session.recoveryCurrent, fileName: session.record.fileName, autoFile: session.autoFile, recovered: session.recovered, storageError: session.storageError?.message, fileError: session.fileError?.message } : null,
});

function closeMenu() { toolbarMenus.closeAll(); }
function missingLinkedFile() {
  return Boolean(session?.record.handle && (session.missingFile || session.fileError?.name === 'NotFoundError' || fileAccessError?.name === 'NotFoundError'));
}
function updateFileState() {
  if (!session) return;
  dirty = session.dirty;
  const pending = !session.recoveryCurrent;
  $('disk-save-state').textContent = session.busy ? 'Saving…' : session.fileError || fileAccessError ? 'Save failed'
    : session.record.pendingRenames?.length ? 'Saving…' : dirty ? 'Unsaved changes' : session.record.handle ? 'Saved' : session.record.savedAt ? 'Copy downloaded' : 'Unsaved changes';
  $('save-state').textContent = session.busy ? 'Saving Fountain file…'
    : session.storageError ? 'Recovery unavailable · save a Fountain copy'
    : fileAccessError ? 'Cached copy · local file access unavailable'
    : dirty ? `${session.record.fileName ? 'Unsaved file changes' : 'Draft · no Fountain file yet'} · ${pending ? 'saving recovery…' : 'recovery saved'}`
    : `${session.record.handle ? `Saved to ${session.record.fileName}` : fileService.supportsSavePicker ? 'File copy · choose Screenplay Folder' : 'File copy · downloads for saving'} · ${pending ? 'saving recovery…' : 'recovery saved'}`;
  $('save').disabled = ioBusy || session.busy;
  $('file-autosave').checked = true;
  $('file-autosave').disabled = true;
  $('file-autosave').title = session.record.handle ? 'Autosave always updates this same linked file after edits. Disk failures are shown separately.' : 'Autosave is enabled. Choose Screenplay Folder to enable disk saving in a supported browser. Recovery always saves separately.';
  let message = '';
  if (session.storageError) message = `Recovery could not be saved: ${session.storageError.message}`;
  else if (missingLinkedFile()) message = 'The linked file was moved or deleted. Your edits remain in the editor and browser recovery continues. Recreate file saves this screenplay to its linked folder or your chosen Screenplay Folder and resumes autosaving; an existing file will not be overwritten.';
  else if (session.fileError) message = `File save stopped. ${session.fileError.message}`;
  else if (fileAccessError) message = `Showing the cached copy. ${fileAccessError.message} Your local file has not been changed.`;
  else if (session.recovered) message = 'Recovered unsaved changes. Your original file is unchanged; Continuing to edit resumes autosaving to the same file.';
  else if (session.fountainWarnings.length) message = session.fountainWarnings.join(' ');
  else if (session.record.fileReferenceWarning && !session.record.handle) message = session.record.fileReferenceWarning;
  else if (!session.record.fileName) message = 'This draft has browser recovery. Choose Screenplay Folder to enable automatic disk saving.';
  else if (!session.record.handle) message = fileService.supportsSavePicker
    ? 'This is a browser copy. Choose Screenplay Folder for automatic disk saving, or Export a copy.'
    : 'This is a browser copy. This browser cannot save to a local folder automatically. Recovery is active; Export downloads a copy.';
  $('document-banner').hidden = !message; $('banner-message').textContent = message;
  $('recreate-file').hidden = !missingLinkedFile();
  $('recreate-file').disabled = ioBusy || session.busy;
  $('reconnect-file').hidden = !((fileAccessError || session.fileError) && session.record.handle);
  $('review-file-error').hidden = session.fileError?.name !== 'FileConflictError';
}
function showConflict(error) {
  reviewedHash = error.current.hash;
  $('file-conflict-message').textContent = error.message;
  $('disk-version').value = error.current.source;
  try { $('editor-version').value = fountainForSaving(history.current.document); } catch { $('editor-version').value = editableElements(history.current.document).map(el => el.text).join('\n\n'); }
  if (!$('file-conflict-dialog').open) $('file-conflict-dialog').showModal();
}
async function saveToDisk() {
  if (!session || ioBusy) return;
  if (missingLinkedFile()) { $('recreate-file').click(); return; }
  if (!session.record.handle) {
    const directory = await repository.getPreference('screenplayFolder', null).catch(error => { notify(error.message); return null; });
    if (!directory) { $('screenplay-folder').click(); notify('Choose Screenplay Folder to save this screenplay to disk.'); return; }
    ioBusy = true; updateFileState();
    try { await session.saveToFolder(directory); fileAccessError = null; notify(`Saved ${session.record.fileName}.`); }
    catch (error) { notify(`Could not save: ${error.message}`); }
    finally { ioBusy = false; updateFileState(); }
    return;
  }
  await saveDocument(false);
}
async function saveDocument(as = false, overrideHash = null) {
  if (!session || ioBusy) return;
  ioBusy = true; updateFileState();
  try {
    const result = await (as ? session.saveAs() : session.save({ overrideHash }));
    // Save As can fork the file identity, while undo still concerns screenplay edits.
    if (history.current.document.id !== session.record.id) {
      for (const state of [history.current, ...history.past, ...history.future]) state.document = { ...state.document, id: session.record.id };
      session.document = history.current.document;
    }
    fileAccessError = null; closeMenu();
    window.history.replaceState(null, '', `./editor.html?id=${encodeURIComponent(session.record.id)}`);
    notify(`${result.kind === 'file' ? `Saved ${result.name}.` : 'Fountain download started. This browser reopens the cached copy.'}${session.storageError ? ' Browser recovery still could not be saved.' : ''}`);
  } catch (error) {
    if (error.name === 'FileConflictError') showConflict(error);
    else if (error.name !== 'AbortError') notify(`Could not save: ${error.message}`);
  } finally { ioBusy = false; updateFileState(); }
}
async function refreshSettingsFolder() {
  try { await fileService.ready; const directory = fileService.restoreHandle(await repository.getPreference('screenplayFolder', null)); $('settings-folder-name').textContent = directory?.name || 'No folder selected'; }
  catch (error) { $('settings-folder-name').textContent = `Folder setting unavailable: ${error.message}`; }
}
$('screenplay-settings').addEventListener('click', () => {
  if (!history || composition) return;
  void refreshSettingsFolder(); void loadWriterProfile(); $('screenplay-settings-dialog').showModal();
});
async function loadWriterProfile() {
  const controls = ['author', 'address', 'phone', 'email'].map(field => $(`writer-${field}`));
  controls.push($('save-writer-profile'));
  for (const control of controls) control.disabled = true;
  try {
    const profile = await repository.getPreference('writerProfile', {});
    for (const field of ['author', 'address', 'phone', 'email']) $(`writer-${field}`).value = profile?.[field] ?? '';
    $('writer-profile-status').textContent = '';
  } catch (error) { $('writer-profile-status').textContent = `Could not load profile: ${error.message}`; }
  finally { for (const control of controls) control.disabled = false; }
}
$('save-writer-profile').addEventListener('click', async () => {
  try {
    const profile = Object.fromEntries(['author', 'address', 'phone', 'email'].map(field => [field, $(`writer-${field}`).value]));
    await repository.setPreference('writerProfile', profile); $('writer-profile-status').textContent = 'Writer Profile saved. New screenplays will use these defaults.';
  } catch (error) { $('writer-profile-status').textContent = `Profile was not saved: ${error.message}`; }
});
$('settings-done').addEventListener('click', () => { $('screenplay-settings-dialog').close(); if (history) restoreSelection(root, currentSelection); });
$('screenplay-settings-dialog').addEventListener('close', () => { if (history) restoreSelection(root, currentSelection); });
function changeSettings(command) {
  if (!history || composition) return;
  try {
    const state = history.apply(currentSelection, command);
    currentSelection = state.selection; dirty = true;
    session.changed(state.document, currentSelection); render(false);
    session.flush({ disk: false }).catch(error => notify(`Settings could not be saved: ${error.message}`));
  } catch (error) { notify(error.message); }
}
$('bold-scene-headings').addEventListener('change', event => changeSettings({ type: 'settings', changes: { boldSceneHeadings: event.target.checked } }));
$('scene-numbers').addEventListener('change', event => changeSettings({ type: 'settings', changes: { sceneNumbers: event.target.checked } }));
$('redo-scene-numbers').addEventListener('click', () => changeSettings({ type: 'renumber' }));
$('review-file-error').addEventListener('click', () => showConflict(session.fileError));
$('conflict-close').addEventListener('click', () => $('file-conflict-dialog').close());
$('conflict-copy').addEventListener('click', () => { $('file-conflict-dialog').close(); exportFountain(); });
$('conflict-overwrite').addEventListener('click', () => { $('file-conflict-dialog').close(); saveDocument(false, reviewedHash); });
async function toLibrary() {
  try { await session?.flush(); allowLeave = true; location.href = './index.html'; }
  catch (error) { notify(`Your current text is still here. Save a copy before leaving: ${error.message}`); }
}
$('home').addEventListener('click', event => { event.preventDefault(); toLibrary(); });
$('recovery-home').addEventListener('click', () => { location.href = './index.html'; });
$('recovery-dialog').addEventListener('cancel', event => { event.preventDefault(); location.href = './index.html'; });
async function openFile(importCopy = false) {
  if (ioBusy) return;
  ioBusy = true;
  try {
    const opened = await fileService.open({ importCopy });
    await session?.flush();
    const record = await importOpenedFile(opened); allowLeave = true;
    location.href = `./editor.html?id=${encodeURIComponent(record.id)}`;
  } catch (error) { if (error.name !== 'AbortError') notify(error.message); }
  finally { ioBusy = false; updateFileState(); }
}
$('open-file').addEventListener('click', () => openFile());
$('import-file').addEventListener('click', () => openFile(true));
$('recreate-file').addEventListener('click', async () => {
  if (ioBusy || !missingLinkedFile()) return;
  ioBusy = true; updateFileState();
  try {
    const directory = session.record.fileDirectory ?? await repository.getPreference('screenplayFolder', null);
    if (!directory) {
      $('screenplay-folder').click();
      notify('Choose a Screenplay Folder to recreate this missing file.');
      return;
    }
    const result = await session.recreateMissingFile(directory);
    fileAccessError = null;
    notify(`Recreated ${result.name}. Autosaving has resumed.`);
  } catch (error) { notify(`Could not recreate the file: ${error.message}`); }
  finally { ioBusy = false; updateFileState(); }
});
$('reconnect-file').addEventListener('click', async () => {
  try {
    const current = await fileService.read(session.record.handle, { request: true }); fileAccessError = null; session.missingFile = false;
    if (current.hash !== session.record.fileHash) {
      const { FileConflictError } = await import('./files.js'); session.fileError = new FileConflictError(current); session.autoFile = false;
    } else session.fileError = null;
    if (!session.fileError && !session.recovered) { session.autoFile = true; await session.flush(); }
    updateFileState(); notify('File access restored. Autosave checks for outside changes before writing.');
  }
  catch (error) { fileAccessError = error; updateFileState(); }
});
$('zoom').addEventListener('change', () => repository.setPreference('zoom', $('zoom').value).catch(error => notify(error.message)));
$('outline-toggle').addEventListener('click', () => repository.setPreference('outline', !$('outline').hidden).catch(error => notify(error.message)));
let leavingRecovery = false;
function savePendingRecovery() {
  // Explicit navigation already awaited its write. Do not enqueue fresh writes
  // as Safari freezes the departing page: they can block the next page's reads.
  if (!allowLeave && !leavingRecovery && session && !session.recoveryCurrent) {
    leavingRecovery = true;
    session.flush().catch(() => {}).finally(() => { leavingRecovery = false; });
  }
}
window.addEventListener('pageshow', () => { allowLeave = false; leavingRecovery = false; });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') savePendingRecovery(); });
window.addEventListener('pagehide', savePendingRecovery);
window.addEventListener('pagehide', () => { session?.dispose(); clearTimeout(renderTimer); clearTimeout(noticeTimer); });

async function openSavedRecord(record) {
  let opened;
  try {
    opened = record.handle ? await fileService.read(record.handle) : null;
  } catch (error) { fileAccessError = error; }
  if (opened) {
    if (opened.hash === record.fileHash) { load(record.recovery.document, record); return; }
    await backups.capture(record.recovery.document, 'Before File Refresh');
    const refreshed = await recordForFile(opened, record);
    refreshed.recoveryHistory = record.recoveryHistory ?? [];
    const updated = await repository.put(refreshed, record.revision);
    load(updated.recovery.document, updated);
  } else {
    const doc = record.recovery.document;
    load(doc, record);
  }
}
async function initialize() {
  await ensureScreenplayFonts();
  document.body.classList.add('loading-editor'); root.contentEditable = 'false';
  const params = new URLSearchParams(location.search);
  let record;
  try {
    const zoom = await repository.getPreference('zoom', 'fit');
    $('zoom').value = ['fit', '.75', '0.75', '0.9', '1', '1.25'].includes(zoom) ? zoom : 'fit';
    $('outline').hidden = !(await repository.getPreference('outline', window.innerWidth > 720));
    $('outline-toggle').setAttribute('aria-pressed', String(!$('outline').hidden));
  } catch { /* File saving still works if recovery storage is unavailable. */ }
  try {
    if (params.has('id')) {
      record = await repository.get(params.get('id'));
      if (record?.deletedAt) throw new Error('This screenplay was removed from the library. Undo the deletion on the homepage or reopen its Fountain file.');
      if (!record) throw new Error('This recent screenplay was not found. Return to the library to open its Fountain file.');
      validateDocument(record.recovery?.document);
      if (record.recovery?.dirty) {
        $('recovery-description').textContent = `${record.title} has a browser snapshot from ${new Date(record.recovery.at).toLocaleString()}. ${record.fileName ? `Original file: ${record.fileName}.` : 'This draft has not been saved to a Fountain file yet.'}`;
        $('open-saved').disabled = record.cachedSource == null;
        $('recover-changes').onclick = () => { $('recovery-dialog').close(); load(record.recovery.document, record); render(); };
        $('open-saved').onclick = async () => {
          try {
            // Retain the unsaved draft as its original library entry.
            const opened = record.handle ? await fileService.read(record.handle, { request: true }) : { source: record.cachedSource, name: record.fileName, hash: record.fileHash, handle: null };
            const saved = await recordForFile({ ...opened, handle: null });
            saved.savedVersionOf = record.id;
            const copy = await repository.put(saved); $('recovery-dialog').close(); load(copy.recovery.document, copy);
          } catch (error) { notify(error.message); }
        };
        $('recovery-dialog').showModal(); return;
      }
      await openSavedRecord(record); return;
    }
    if (!params.has('sample')) { record = await createAutoSavedDraft({ deferDisk: true }); load(record.recovery.document, record); return; }
    const doc = parseFountain(demo, { title: 'The Last Signal' });
    record = draftRecord(doc);
    try { record = await repository.put(record); }
    catch (error) { load(doc, record); session.storageError = error; updateFileState(); return; }
    load(doc, record);
  } catch (error) {
    $('save-state').textContent = 'Could not open screenplay'; notify(error.message); $('document-banner').hidden = false; $('banner-message').textContent = error.message;
    // Version storage can be opened even when the working document cannot load.
    if (params.has('id')) {
      if (!record?.deletedAt) {
        const recoveryRecord = record ?? { ...draftRecord(), id: params.get('id') };
        features.recover(recoveryRecord, async document => {
          if (record) await backups.captureDamaged(record);
          document.id = recoveryRecord.id;
          load(document, { ...recoveryRecord, recovery: { document, selection: null, dirty: true, at: Date.now() } });
          session.changed(document, currentSelection);
          try { await session.flush({ disk: false }); }
          catch (failure) { notify(`Backup opened, but the working library is unavailable: ${failure.message}. Export a Fountain copy to keep it outside this browser.`); }
        });
      }
    }
  }
}
const localVoices = setupVoiceLibrary({ onReturn: () => { if ($('screenplay-settings-dialog').open) $('voice-library').focus(); else if (history && !$('table-read-dialog').open) restoreSelection(root, currentSelection); } });
setupTableRead({ openVoiceLibrary: () => localVoices.open(), repository, getDocument: () => history?.current.document, onReturn: () => { if (history) restoreSelection(root, currentSelection); } });
features = setupEditorFeatures({ root, repository, getDocument: () => history?.current.document,
  getSelection: () => currentSelection, apply: (command, selection) => apply(command, selection ?? currentSelection),
  restore: selection => restoreSelection(root, selection, { scroll: true }), notify });
window.scriptForgePrepareUpdate = async () => {
  if (!history || !session) throw new Error('Wait for the screenplay to finish opening.');
  if (composition || editingLocked || ioBusy) throw new Error('Finish the current edit or file operation before updating.');
  editingLocked = true; root.contentEditable = 'false';
  const fields = [...document.querySelectorAll('[data-title-field]')], states = fields.map(field => field.readOnly);
  fields.forEach(field => { field.readOnly = true; });
  const release = () => { editingLocked = false; root.contentEditable = 'true'; fields.forEach((field,index) => { field.readOnly = states[index]; }); };
  try { await flushForUpdate({session,repository,backups}); return release; }
  catch(error) { release(); throw error; }
};
window.scriptForgeBeforeClose = async () => { await session?.flush(); await backups.queue; };
await initialize();

setupCharacterRename({ launcher: $('rename-character'), getDocument: () => composition ? null : history?.current.document, onReturn: () => { if (history) restoreSelection(root, currentSelection); }, onRename: async command => {
  if (!history || composition || command.signature !== JSON.stringify(history.current.document)) throw new Error('The screenplay changed. Review the rename again.');
  // Validate before persisting voice aliases; apply is one ordinary model transaction.
  renameCharacter(history.current.document, currentSelection, command);
  await features.beforeChange(command, currentSelection);
  await carryCharacterVoice(repository, history.current.document.id, command.from, command.to);
  if (command.signature !== JSON.stringify(history.current.document)) throw new Error('The screenplay changed. Review the rename again.');
  const state = history.apply(currentSelection, command);
  currentSelection = state.selection; dirty = true; session.changed(state.document, currentSelection); render(false);
  notify(`Renamed ${command.from} to ${command.to}. Undo restores the complete rename.`);
} });
