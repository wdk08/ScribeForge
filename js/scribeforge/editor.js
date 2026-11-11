import { toggleMark } from 'prosemirror-commands';
import { undo, redo, undoDepth, redoDepth } from 'prosemirror-history';
import { Selection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { setupCover } from './cover.js';
import { createPagination } from './pagination.js';
import { formattedClipboard } from './clipboard.js';
import { setupToolbarMenus } from '../toolbar-menus.js';
import { statisticsRows, writingActivity } from './analysis.js';
import { activeChapter, changeParagraph, chapterOverride, editorState, emphasisActive, findMatches, insertPageBreak, manuscriptIndex, replaceMatches, selectRange, selectionFormatting, showMatches, textChanges, toggleEmphasis } from './editing.js';
import { exportDocx, exportEpub, exportText } from './formats.js';
import { applyLayout, exportPDF, setZoom } from './layout.js';
import { chapterHeading, encodeManuscript, customStyleId, markValues, paragraphStyle, plainText, resolvedParagraph, schema, styleLabel, validId } from './model.js';
import { setupReading } from './reading.js';
import { setupProfanityAnalyzer } from './profanity.js';
import { setupSettings, setupStyleLibrary } from './settings.js';
import { autosaver, libraryStore } from './storage.js';
import { connectUpdates } from './updates.js';
import { $, connectDesktopClose, connectImport, createManuscript, documentURL, errorMessage, exportBytes, fileName, getPreference, setPreference } from './ui.js';

const store = libraryStore();
let noticeTimer;
function notice(message) {
  $('notice').textContent = message;
  $('notice').hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { $('notice').hidden = true; }, 5500);
}
function saveStatus(message, error) {
  $('save-state').textContent = message;
  $('save-state').toggleAttribute('data-error', Boolean(error));
  $('cover-save-state').textContent = message;
}

let flushBeforeLeaving = async () => {};
let updates;
connectDesktopClose(() => flushBeforeLeaving(), notice, () => updates?.busy);
for (const button of document.querySelectorAll('[data-close]')) {
  button.addEventListener('click', () => button.closest('dialog').close());
}

async function start() {
  const id = new URLSearchParams(location.search).get('id');
  if (!validId(id)) throw new Error('Choose a manuscript from the library.');
  const record = await store.get(id);
  if (!record) throw new Error('This manuscript is missing from the local library.');
  let manuscript = record.current;
  let index;
  let indexedDoc;
  let pages = 1;
  let formatTimer;
  let previousChapter = -1;
  let chapterButtons = [];
  let plainPaste = false;
  const title = $('document-title');
  const activity = writingActivity(record.activity, () => getPreference('activity', true));
  const view = new EditorView($('pages'), {
    state: editorState(manuscript, {
      defaultStyle: () => manuscript.settings.defaultStyle,
      getSettings: () => manuscript.settings,
      confirmDelete: (size, state) => {
        if (size < 1000) return true;
        const perPage = (index?.characters ?? state.doc.content.size) / pages;
        const threshold = Math.max(1000, Math.min(5000, perPage * 1.5));
        return size < threshold || window.confirm(`Remove approximately ${Math.max(1, Math.round(size / Math.max(1, perPage)))} page(s) of text? You can undo this change.`);
      },
    }),
    attributes: { class: 'prose-content', role: 'textbox', 'aria-label': 'Manuscript editor', 'aria-multiline': 'true', spellcheck: 'true' },
    editable: () => !record.recovered,
    clipboardSerializer: formattedClipboard(() => view, () => manuscript.settings),
    clipboardTextSerializer: slice => slice.content.textBetween(0, slice.content.size, '\n', '\n'),
    handleDOMEvents: {
      paste(editor, event) {
        if (!plainPaste || !event.clipboardData) return false;
        const text = event.clipboardData.getData('text/plain');
        event.preventDefault();
        if (text) editor.pasteText(text, event);
        return true;
      },
    },
    dispatchTransaction(tr) {
      const before = view.state;
      const { state, transactions } = before.applyTransaction(tr);
      if (!transactions.length) return;
      view.updateState(state);
      if (state.doc !== before.doc) {
        activity.update(textChanges(before.doc, state.doc));
        saver.changed();
        updateSelection();
        scheduleIndex();
      } else if (!tr.getMeta('skipStatus')) updateSelection();
    },
  });

  const reflow = createPagination(view, $('pages'));
  view.dom.addEventListener('compositionend', () => scheduleIndex());
  const snapshot = () => ({ ...manuscript, content: view.state.doc.toJSON() });
  let committedCopy = false;
  const saver = autosaver({
    read: () => ({ manuscript: snapshot(), activity: activity.snapshot({ includeDays: true }) }),
    write: (data, revision) => store.put(data.manuscript, revision, data.activity),
    status: saveStatus, revision: record.revision, enabled: getPreference('autosave', true),
  });

  flushBeforeLeaving = async () => {
    if (saver.dirty) await saver.flush();
  };
  const save = () => saver.flush().catch(error => notice(errorMessage(error)));
  const navigate = async id => {
    await flushBeforeLeaving();
    location.href = id ? documentURL(id) : './index.html';
  };
  window.addEventListener('beforeunload', event => {
    if (!saver.dirty || committedCopy) return;
    event.preventDefault();
    event.returnValue = true;
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && saver.dirty && getPreference('autosave', true)) void save();
  });
  $('home').addEventListener('click', event => {
    if (event.metaKey || event.ctrlKey || event.shiftKey) return;
    event.preventDefault();
    navigate().catch(error => notice(errorMessage(error)));
  });
  $('new-document').addEventListener('click', async () => {
    try { await flushBeforeLeaving(); await navigate(await createManuscript(store)); }
    catch (error) { notice(errorMessage(error)); }
  });
  async function saveAsNew(source, isWorkingCopy = false) {
    if (!isWorkingCopy) await flushBeforeLeaving();
    const copy = { ...source, documentId: crypto.randomUUID() };
    const changes = view.state.doc;
    const metadata = manuscript;
    await store.put(copy);
    if (isWorkingCopy && (changes !== view.state.doc || metadata !== manuscript)) {
      notice('A copy was saved. More recent edits are still open in this window.');
      return;
    }
    committedCopy = isWorkingCopy;
    location.href = documentURL(copy.documentId);
  }
  $('save-copy').addEventListener('click', () => saveAsNew(snapshot(), true).catch(error => notice(errorMessage(error))));
  $('recovery').addEventListener('click', async () => {
    try {
      const saved = await store.get(id);
      const previous = saved?.previous;
      $('recovery-info').textContent = previous ? 'This is the prior completed save. Open a separate copy to review or continue from it.' : 'A previous save will appear here after the next completed save.';
      $('recovery-preview').textContent = previous ? plainText(schema.nodeFromJSON(previous.content)).slice(0, 18000) : '';
      $('recover-copy').disabled = !previous;
      $('recover-copy').onclick = () => saveAsNew(previous).catch(error => notice(errorMessage(error)));
      $('recovery-dialog').showModal();
    } catch (error) { notice(errorMessage(error)); }
  });
  connectImport(store, navigate, notice);

  function updateTitle() {
    const name = manuscript.metadata.title || 'Untitled Manuscript';
    $('workspace-title').textContent = name;
    document.title = `${name} · ScribeForge`;
  }
  title.value = manuscript.metadata.title;
  title.disabled = Boolean(record.recovered);
  title.addEventListener('input', () => {
    manuscript = { ...manuscript, metadata: { ...manuscript.metadata, title: title.value } };
    updateTitle();
    saver.changed();
  });
  $('save').disabled = $('settings').disabled = Boolean(record.recovered);
  $('save').addEventListener('click', save);
  updateTitle();
  saveStatus(record.recovered ? 'Recovery checkpoint opened. Save as new manuscript to continue.' : 'Saved locally', record.recovered);

  function ensureIndex() {
    if (indexedDoc !== view.state.doc) {
      indexedDoc = view.state.doc;
      index = manuscriptIndex(indexedDoc, manuscript.settings);
    }
    return index;
  }
  function renderChapters() {
    const { chapters } = ensureIndex();
    const list = $('chapter-list');
    $('chapter-count').textContent = chapters.length;
    chapterButtons = chapters.map((chapter, i) => {
      const button = document.createElement('button');
      button.className = 'scene-link chapter-link';
      const position = document.createElement('span');
      position.textContent = String(i + 1).padStart(2, '0');
      const content = document.createElement('div');
      const name = document.createElement('strong');
      name.textContent = chapter.title;
      const words = document.createElement('small');
      words.textContent = `${chapter.words.toLocaleString()} ${chapter.words === 1 ? 'word' : 'words'}`;
      content.append(name, words);
      button.append(position, content);
      button.addEventListener('click', () => {
        const current = ensureIndex().chapters[i];
        if (current) selectRange(view, current.pos + 1);
      });
      return button;
    });
    if (chapterButtons.length) list.replaceChildren(...chapterButtons);
    else {
      const empty = document.createElement('p');
      empty.className = 'chapter-empty';
      empty.textContent = 'No chapter headings yet.';
      list.replaceChildren(empty);
    }
    previousChapter = -1;
  }
  function updateSelection() {
    const { selection, storedMarks } = view.state;
    const { $from } = selection;
    const style = paragraphStyle(activeParagraph(), manuscript.settings);
    $('paragraph-style').value = style;
    $('element-status').textContent = styleLabel(style, manuscript.settings);
    const format = selectionFormatting(view.state, manuscript.settings);
    for (const key of ['font', 'size']) {
      const input = $(`inline-${key}`);
      if (document.activeElement === input) continue;
      input.value = format[key] == null ? '' : key === 'size' ? `${format[key]} pt` : format[key];
      input.placeholder = format[key] == null ? 'Mixed' : '';
    }
    for (const button of $('format-toolbar').querySelectorAll('[data-align]')) {
      button.setAttribute('aria-pressed', String(button.dataset.align === format.align));
    }
    $('undo').disabled = !undoDepth(view.state);
    $('redo').disabled = !redoDepth(view.state);
    for (const button of $('format-toolbar').querySelectorAll('[data-mark]')) {
      const type = schema.marks[button.dataset.mark];
      const active = ['bold', 'italic', 'underline', 'strike'].includes(type.name) ? emphasisActive(view.state, type.name, manuscript.settings) :
        selection.empty ? type.isInSet(storedMarks ?? $from.marks()) : view.state.doc.rangeHasMark(selection.from, selection.to, type);
      button.setAttribute('aria-pressed', String(Boolean(active)));
    }
    if (indexedDoc !== view.state.doc) return;
    const chapter = activeChapter(index.chapters, selection.head);
    if (chapter === previousChapter) return;
    chapterButtons[previousChapter]?.removeAttribute('aria-current');
    chapterButtons[chapter]?.setAttribute('aria-current', 'location');
    previousChapter = chapter;
  }
  function updateStats() {
    pages = reflow(manuscript.settings).count;
    $('document-stats').textContent = `${ensureIndex().words.toLocaleString()} words · ${pages} ${pages === 1 ? 'page' : 'pages'}`;
  }
  function renderIndex() {
    renderChapters();
    updateStats();
    updateSelection();
    if (!$('find-panel').hidden) refreshFind();
    refreshProfanity();
  }
  function scheduleIndex() {
    clearTimeout(formatTimer);
    formatTimer = setTimeout(renderIndex, 140);
  }
  $('outline-toggle').addEventListener('click', event => {
    $('outline').hidden = !$('outline').hidden;
    event.currentTarget.setAttribute('aria-pressed', String(!$('outline').hidden));
  });
  const resizePages = () => {
    setZoom(manuscript.settings);
    scheduleIndex();
  };
  $('zoom').addEventListener('change', resizePages);
  const resize = new ResizeObserver(resizePages);
  resize.observe($('viewport'));

  const commands = (command, focus = true) => {
    if (record.recovered) return;
    command(view.state, view.dispatch, view);
    if (focus) view.focus();
  };
  $('undo').addEventListener('click', () => commands(undo));
  $('redo').addEventListener('click', () => commands(redo));
  $('format-toolbar').addEventListener('mousedown', event => {
    if (event.target.closest('button')) event.preventDefault();
  });
  for (const button of $('format-toolbar').querySelectorAll('[data-mark]')) {
    const name = button.dataset.mark;
    const command = ['bold', 'italic', 'underline', 'strike'].includes(name) ? toggleEmphasis(name, () => manuscript.settings) : toggleMark(schema.marks[name]);
    button.addEventListener('click', () => commands(command));
  }
  for (const [mark, check] of Object.entries(markValues)) {
    const input = $(`inline-${mark}`);
    input.addEventListener('change', () => {
      const raw = input.value.trim();
      const value = mark === 'size' ? Number(raw.replace(/\s*pt$/i, '')) : raw;
      if (!check(value)) { notice(`Enter a valid ${input.getAttribute('aria-label').toLowerCase()}.`); return; }
      if ((mark === 'font' || mark === 'size') && selectionFormatting(view.state, manuscript.settings)[mark] === value) return;
      commands((state, dispatch) => {
        const { from, to, empty } = state.selection;
        const type = schema.marks[mark];
        const style = type.create({ value });
        const tr = state.tr;
        if (empty) tr.addStoredMark(style);
        else tr.removeMark(from, to, type).addMark(from, to, style);
        dispatch(tr);
        return true;
      }, false);
    });
    if (mark === 'font' || mark === 'size') {
      input.addEventListener('blur', () => queueMicrotask(updateSelection));
      input.addEventListener('keydown', event => {
        if (event.key === 'Enter' && !event.isComposing) {
          event.preventDefault();
          input.blur();
          view.focus();
        }
      });
    }
  }
  $('clear-marks').addEventListener('click', () => commands((state, dispatch) => {
    const { from, to, empty } = state.selection;
    dispatch(empty ? state.tr.setStoredMarks([]) : state.tr.removeMark(from, to));
  }));
  for (const button of $('format-toolbar').querySelectorAll('[data-align]')) {
    button.addEventListener('click', () => commands(changeParagraph({ align: button.dataset.align })));
  }
  $('page-break').addEventListener('click', () => commands(insertPageBreak));
  $('scene-break').addEventListener('click', () => commands((state, dispatch) => {
    const { $from } = state.selection;
    const pos = $from.depth ? $from.after() : $from.pos;
    dispatch(state.tr.insert(pos, schema.nodes.paragraph.create({ style: 'scene' }, schema.text('* * *'))).scrollIntoView());
  }));

  function setFocus(enabled) {
    document.body.classList.toggle('focus-mode', enabled);
    $('focus-exit').hidden = !enabled;
    if (enabled) view.focus();
  }
  const toggleFocus = () => setFocus(!document.body.classList.contains('focus-mode'));
  $('focus-mode').addEventListener('click', toggleFocus);
  $('focus-exit').addEventListener('click', () => setFocus(false));
  $('help').addEventListener('click', () => $('help-dialog').showModal());
  $('paste-plain').addEventListener('click', event => {
    plainPaste = !plainPaste;
    event.currentTarget.setAttribute('aria-pressed', String(plainPaste));
  });

  let matches = [];
  let current = -1;
  function refreshFind(reset = false) {
    const old = matches[current]?.from;
    matches = findMatches(ensureIndex().blocks, $('find-query').value, { exactCase: $('find-case').checked, wholeWord: $('find-word').checked });
    const origin = reset ? view.state.selection.from : old ?? view.state.selection.from;
    current = matches.length ? matches.findIndex(match => match.from >= origin) : -1;
    if (current < 0 && matches.length) current = 0;
    updateFind();
  }
  function updateFind() {
    $('find-count').value = `${current + 1} of ${matches.length}`;
    for (const id of ['find-next', 'find-previous', 'replace-one', 'replace-all']) $(id).disabled = !matches.length || (id.startsWith('replace') && record.recovered);
    showMatches(view, matches, current);
  }
  function findStep(step) {
    refreshFind();
    if (!matches.length) return;
    const selected = view.state.selection;
    const currentMatch = matches[current];
    if (step < 0 || (selected.from === currentMatch.from && selected.to === currentMatch.to)) {
      current = (current + step + matches.length) % matches.length;
    }
    updateFind();
    const match = matches[current];
    const field = document.activeElement;
    selectRange(view, match.from, match.to);
    if (field && $('find-panel').contains(field)) field.focus({ preventScroll: true });
  }
  function openFind(replace = false) {
    $('find-panel').hidden = false;
    $('replace-row').hidden = !replace;
    $('find-expand').setAttribute('aria-expanded', String(replace));
    const selection = view.state.selection;
    if (!selection.empty) {
      const text = view.state.doc.textBetween(selection.from, selection.to, '\n');
      if (text.length <= 200 && !text.includes('\n')) $('find-query').value = text;
    }
    refreshFind(true);
    $('find-query').focus();
    $('find-query').select();
  }
  function closeFind() {
    $('find-panel').hidden = true;
    showMatches(view, [], -1);
    view.focus();
  }
  $('find-open').addEventListener('click', () => openFind());
  $('find-close').addEventListener('click', closeFind);
  $('find-expand').addEventListener('click', event => {
    $('replace-row').hidden = !$('replace-row').hidden;
    event.currentTarget.setAttribute('aria-expanded', String(!$('replace-row').hidden));
    if (!$('replace-row').hidden) $('replace-text').focus();
  });
  for (const id of ['find-query', 'find-case', 'find-word']) $(id).addEventListener('input', () => refreshFind(true));
  $('find-next').addEventListener('click', () => findStep(1));
  $('find-previous').addEventListener('click', () => findStep(-1));
  $('find-query').addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); findStep(event.shiftKey ? -1 : 1); }
  });
  function replace(all) {
    if (record.recovered) return;
    refreshFind();
    if (!matches.length) return;
    const chosen = all ? matches : [matches[current]];
    view.dispatch(replaceMatches(view.state, chosen, $('replace-text').value));
    refreshFind();
  }
  $('replace-one').addEventListener('click', () => replace(false));
  $('replace-all').addEventListener('click', () => replace(true));

  function showStatistics() {
    updateStats();
    $('statistics-rows').replaceChildren(...statisticsRows(ensureIndex(), pages, activity.snapshot()).map(([label, value]) => {
      const row = document.createElement('tr');
      const heading = document.createElement('th');
      heading.scope = 'row';
      heading.textContent = label;
      const data = document.createElement('td');
      data.textContent = value;
      row.append(heading, data);
      return row;
    }));
    $('statistics-dialog').showModal();
  }
  $('statistics').addEventListener('click', showStatistics);
  setupReading(view);
  const refreshProfanity = setupProfanityAnalyzer({
    getDocument: ensureIndex,
    navigate: match => selectRange(view, match.start, match.end),
  });

  function activeParagraph() {
    const { $head } = view.state.selection;
    if ($head.parent.isTextblock) return $head.parent;
    return (Selection.findFrom($head, -1, true) ?? Selection.findFrom($head, 1, true))?.$head.parent;
  }
  const styleLibrary = setupStyleLibrary({
    settings: () => manuscript.settings,
    selectedStyle: () => paragraphStyle(activeParagraph(), manuscript.settings),
    activeFormat: () => resolvedParagraph(activeParagraph(), manuscript.settings),
    activeHeading: () => chapterHeading(activeParagraph(), manuscript.settings),
    overrideChapter: enabled => commands(chapterOverride(enabled, manuscript.settings)),
    selectionFormat: () => selectionFormatting(view.state, manuscript.settings),
    apply(id, definition, options) {
      if (record.recovered) return;
      if (customStyleId(id) && !manuscript.settings.customStyles?.[id]) {
        if (!definition) throw new Error('This style is no longer in the style library.');
        const settings = { ...manuscript.settings, customStyles: { ...manuscript.settings.customStyles, [id]: definition } };
        manuscript = { ...manuscript, settings };
        applyLayout(settings);
      }
      commands(changeParagraph({ style: id, chapterMode: null }, options));
      styleLibrary.refresh();
    },
    focusEditor: () => view.focus(),
    report: notice,
  });
  window.addEventListener('storage', event => { if (event.key === 'scribeforge.paragraph-styles') styleLibrary.refresh(); });

  setupSettings({
    get: () => manuscript,
    apply(settings, author) {
      if (record.recovered) return;
      manuscript = { ...manuscript, settings, metadata: { ...manuscript.metadata, author } };
      applyLayout(settings);
      saver.setEnabled(getPreference('autosave', true));
      saver.changed();
      view.updateState(view.state);
      indexedDoc = null;
      renderIndex();
    },
    focusEditor: () => view.focus(),
    applyParagraph: fields => commands(changeParagraph(fields)),
    currentParagraph: () => view.state.selection.$from.parent.attrs,
  });

  setupCover({
    view, get: () => manuscript, countPages: () => reflow(manuscript.settings).count,
    editable: () => !record.recovered, save,
    update(cover) {
      manuscript = { ...manuscript, cover };
      saver.changed();
    },
  });

  const exporters = {
    stf: [encodeManuscript, 'application/vnd.storyforge+json'],
    docx: [exportDocx, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    epub: [exportEpub, 'application/epub+zip'], txt: [exportText, 'text/plain;charset=utf-8'],
  };
  for (const button of document.querySelectorAll('[data-export]')) {
    button.addEventListener('click', async () => {
      const format = button.dataset.export;
      $('export').closest('details').open = false;
      try {
        if (format === 'pdf') { await exportPDF(); return; }
        const [convert, mime] = exporters[format];
        await exportBytes(`${fileName(manuscript.metadata.title)}.${format}`, convert(snapshot()), mime);
      } catch (error) { notice(errorMessage(error)); }
    });
  }
  document.addEventListener('keydown', event => {
    if (event.defaultPrevented || event.isComposing) return;
    if (event.key === 'Escape' && !document.querySelector('dialog:modal')) {
      if (!$('find-panel').hidden) closeFind();
      else if (document.body.classList.contains('focus-mode')) setFocus(false);
      return;
    }
    if (!(event.metaKey || event.ctrlKey) || event.altKey || document.querySelector('dialog:modal')) return;
    const key = event.key.toLowerCase();
    if (key === 's') { event.preventDefault(); void save(); }
    else if (key === 'f') { event.preventDefault(); if (event.shiftKey) toggleFocus(); else openFind(); }
    else if (key === 'h' && event.shiftKey) { event.preventDefault(); openFind(true); }
  });

  setupToolbarMenus();
  applyLayout(manuscript.settings);
  renderIndex();
  void document.fonts.ready.then(() => { reflow(manuscript.settings, true); updateStats(); });
  setFocus(getPreference('focus', false));
  view.focus();
  updates = connectUpdates(async () => {
    while (saver.dirty) await saver.flush();
  });
}

start().catch(error => {
  saveStatus(errorMessage(error), true);
  notice(errorMessage(error));
  for (const button of document.querySelectorAll('button, select, input')) button.disabled = true;
});
