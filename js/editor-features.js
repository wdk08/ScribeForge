import { isDesktop } from './desktop.js';
import { SEARCH_TYPES, findMatches } from './search.js';
import { dialogueStatistics } from './dialogue-statistics.js';
import { backups, backupSettings } from './backups.js';
import { createDocument, validateDocument } from './document.js';

/** UI controllers consume model transactions; no document content is stored as HTML. */
export function setupEditorFeatures({ root, repository, getDocument: currentDocument, getSelection, apply, restore, notify }) {
  const $ = id => document.getElementById(id);
  if (isDesktop()) {
    document.querySelector('#versions-dialog > p').textContent = 'Independent snapshots in ScriptForge’s application-data folder. These are separate from your screenplay files and do not protect against device loss.';
    document.querySelector('#backup-interval').closest('section').querySelectorAll('p')[1].textContent = 'Backups are stored in ScriptForge’s application-data folder, separately from the working library and screenplay files. Autosave remains active when backups are disabled.';
  }
  let recovery = null;
  const getDocument = () => recovery?.placeholder ?? currentDocument();
  let matches = [], current = 0, sort = 'words', ascending = false, versions = [], selectedVersion = null;
  let settings = backupSettings(), lastEdit = 0, activeTime = 0, documentId = null, baseline = null;
  let pending = false, lastAttempt = 0;
  const panel = $('find-panel'), viewport = root.closest('.document-viewport');
  const layer = document.createElement('div'); layer.className = 'search-highlight-layer'; layer.setAttribute('aria-hidden', 'true'); viewport.append(layer);
  viewport.style.position = 'relative';
  for (const type of SEARCH_TYPES) {
    const label = document.createElement('label'), input = document.createElement('input');
    input.type = 'checkbox'; input.checked = true; input.value = type; input.name = 'find-type';
    label.append(input, type === 'scene' ? 'Scene Headings' : `${type[0].toUpperCase()}${type.slice(1)}`); $('find-types').append(label);
  }
  function options() {
    return { caseSensitive: $('find-case').checked, wholeWord: $('find-word').checked,
      types: [...document.querySelectorAll('[name="find-type"]:checked')].map(input => input.value) };
  }
  function point(fragment, offset) {
    const walker = document.createTreeWalker(fragment, NodeFilter.SHOW_TEXT); let node;
    while ((node = walker.nextNode())) { if (offset <= node.length) return [node, offset]; offset -= node.length; }
    return [fragment, 0];
  }
  function drawHighlights(scroll = false) {
    layer.replaceChildren(); if (panel.hidden) return;
    const byId = new Map();
    for (const fragment of root.querySelectorAll('[data-element-id]')) {
      if (!byId.has(fragment.dataset.elementId)) byId.set(fragment.dataset.elementId, []);
      byId.get(fragment.dataset.elementId).push(fragment);
    }
    const bounds = viewport.getBoundingClientRect(); let activeRect;
    const shapes = document.createDocumentFragment();
    matches.forEach((match, index) => {
      for (const el of byId.get(match.id) ?? []) {
        const start = Math.max(match.start, +el.dataset.start), end = Math.min(match.end, +el.dataset.end);
        if (start >= end) continue;
        const range = document.createRange(); range.setStart(...point(el, start - +el.dataset.start)); range.setEnd(...point(el, end - +el.dataset.start));
        for (const rect of range.getClientRects()) {
          const mark = document.createElement('span'); mark.className = `search-highlight${index === current ? ' current' : ''}`;
          Object.assign(mark.style, { left: `${rect.left - bounds.left + viewport.scrollLeft}px`, top: `${rect.top - bounds.top + viewport.scrollTop}px`, width: `${rect.width}px`, height: `${rect.height}px` });
          shapes.append(mark); if (index === current && !activeRect) activeRect = rect;
        }
      }
    });
    layer.append(shapes);
    if (scroll && activeRect) viewport.scrollBy({ top: activeRect.top - bounds.top - viewport.clientHeight / 3, behavior: 'instant' });
  }
  function search(reset = false, scroll = false) {
    if (!getDocument() || panel.hidden) return;
    matches = findMatches(getDocument(), $('find-query').value, options());
    current = reset ? 0 : Math.max(0, Math.min(current, matches.length - 1));
    $('find-count').textContent = `${matches.length ? current + 1 : 0} of ${matches.length}`;
    for (const id of ['find-next', 'find-previous', 'replace-one', 'replace-all']) $(id).disabled = !matches.length;
    drawHighlights(scroll);
  }
  function closeSearch() { panel.hidden = true; layer.replaceChildren(); restore(getSelection()); }
  function openSearch(replace = false) {
    panel.hidden = false; $('replace-row').hidden = !replace; $('find-expand').setAttribute('aria-expanded', String(replace));
    search(); $('find-query').focus(); $('find-query').select();
  }
  function navigate(direction) { if (matches.length) { current = (current + direction + matches.length) % matches.length; search(false, true); } }
  $('find-query').addEventListener('input', () => search(true, true));
  $('find-options').addEventListener('change', () => search(true, true));
  $('find-next').onclick = () => navigate(1); $('find-previous').onclick = () => navigate(-1);
  $('find-close').onclick = closeSearch;
  $('find-screenplay').onclick = () => openSearch(true);
  for (const [button, section] of [['find-advanced', 'find-options'], ['find-expand', 'replace-row']]) $(button).onclick = () => {
    $(section).hidden = !$(section).hidden; $(button).setAttribute('aria-expanded', String(!$(section).hidden));
  };
  panel.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeSearch(); }
    if (event.key === 'Enter') { event.preventDefault(); navigate(event.shiftKey ? -1 : 1); }
  });
  async function replace(all) {
    const list = all ? matches : matches.slice(current, current + 1); if (!list.length) return;
    const query = $('find-query');
    await apply({ type: 'replaceMatches', matches: structuredClone(list), replacement: $('replace-text').value, all });
    query.focus(); search(false, true);
  }
  $('replace-one').onclick = () => replace(false); $('replace-all').onclick = () => replace(true);

  function stats() {
    if (!$('statistics-dialog').open || !getDocument()) return;
    const data = dialogueStatistics(getDocument(), sort, ascending), fragment = document.createDocumentFragment();
    for (const row of data.rows) {
      const tr = document.createElement('tr');
      for (const value of [row.name, row.blocks.toLocaleString(), row.words.toLocaleString(), `${row.percent.toFixed(1)}%`]) { const td = document.createElement('td'); td.textContent = value; tr.append(td); }
      fragment.append(tr);
    }
    $('statistics-rows').replaceChildren(fragment);
    $('statistics-totals').textContent = `Total Dialogue Words: ${data.words.toLocaleString()} · Total Speaking Characters: ${data.characters}`;
    for (const button of document.querySelectorAll('[data-stat-sort]')) button.closest('th').setAttribute('aria-sort', button.dataset.statSort === sort ? ascending ? 'ascending' : 'descending' : 'none');
  }
  $('dialogue-statistics').onclick = () => { $('statistics-dialog').show(); stats(); };
  $('statistics-close').onclick = () => $('statistics-dialog').close();
  for (const button of document.querySelectorAll('[data-stat-sort]')) button.onclick = () => {
    ascending = sort === button.dataset.statSort ? !ascending : button.dataset.statSort === 'name'; sort = button.dataset.statSort; stats();
  };
  function focusMode(force) {
    const enabled = force ?? !document.body.classList.contains('focus-mode');
    document.body.classList.toggle('focus-mode', enabled); $('focus-exit').hidden = !enabled; $('focus-mode').setAttribute('aria-pressed', String(enabled));
    restore(getSelection()); drawHighlights();
  }
  $('focus-mode').onclick = () => focusMode(); $('focus-exit').onclick = () => focusMode(false);
  document.addEventListener('keydown', event => {
    if (event.defaultPrevented || document.querySelector('dialog:modal')) return;
    const active = document.activeElement, editorActive = root.contains(active) || active === root || panel.contains(active) || active === $('focus-exit');
    if (!editorActive) return;
    if ((event.metaKey || event.ctrlKey) && !event.altKey) {
      const key = event.key.toLowerCase();
      if (key === 'f' && event.shiftKey) { event.preventDefault(); focusMode(); }
      else if (key === 'f' || (key === 'h' && event.shiftKey)) { event.preventDefault(); openSearch(key === 'h'); }
    }
    if (event.key === 'Escape') {
      if (!panel.hidden) { event.preventDefault(); closeSearch(); }
      else if (document.body.classList.contains('focus-mode')) { event.preventDefault(); focusMode(false); }
    }
  });
  for (const input of document.querySelectorAll('[name="appearance"]')) input.onchange = () => {
    try { window.scriptForgeTheme.set(input.value); $('appearance-status').textContent = ''; }
    catch (error) { $('appearance-status').textContent = `Theme could not be saved: ${error.message}`; }
  };
  function backupError(error) {
    const message = `Backup failed: ${error.message}. Your current text remains in the editor; autosave is separate.`;
    $('backup-status').textContent = message; $('version-status').textContent = message; notify(message);
  }
  repository.getPreference('backups', {}).then(value => {
    settings = backupSettings(value); $('backups-enabled').checked = settings.enabled; $('backup-interval').value = String(settings.interval);
  }).catch(backupError);
  async function updateSettings() {
    const next = backupSettings({ enabled: $('backups-enabled').checked, interval: Number($('backup-interval').value) });
    try { await repository.setPreference('backups', next); settings = next; activeTime = 0; $('backup-status').textContent = 'Backup preferences saved. Autosave remains active.'; }
    catch (error) { backupError(error); }
  }
  $('backups-enabled').onchange = updateSettings; $('backup-interval').onchange = updateSettings;
  async function capture(reason, doc = getDocument()) {
    try { return await backups.capture(doc, reason); } catch (error) { backupError(error); throw error; }
  }
  function activity() {
    const doc = getDocument(); if (!doc) return;
    const now = Date.now();
    if (doc.id !== documentId) { documentId = doc.id; lastEdit = 0; lastAttempt = 0; activeTime = 0; baseline = doc; }
    if (doc === baseline) return;
    baseline = doc;
    if (lastEdit && now - lastEdit < 30000) activeTime += now - lastEdit;
    lastEdit = now;
    if (settings.enabled && activeTime >= settings.interval * 60000 && !pending && now - lastAttempt >= 60000) {
      pending = true; lastAttempt = now; capture('Automatic Backup', doc).then(() => { activeTime = 0; }).catch(() => {}).finally(() => { pending = false; });
    }
  }
  function previewVersion() {
    const item = versions.find(item => item.id === selectedVersion);
    $('version-preview').textContent = item?.damagedRecord ? 'Damaged working copy preserved for recovery. This version cannot be restored directly.' : item ? `${item.document.title}\n\n${item.document.elements.filter(el => el.type !== 'whitespace').map(el => el.text).join('\n\n')}` : '';
    $('version-restore').disabled = !item?.document;
  }
  async function refreshVersions() {
    try {
      const id = getDocument().id; versions = await backups.list(id);
      if (getDocument().id !== id) return;
      const fragment = document.createDocumentFragment(); let date = '';
      for (const item of versions) {
        const day = new Date(item.at).toLocaleDateString();
        if (day !== date) { const heading = document.createElement('h3'); heading.textContent = day; fragment.append(heading); date = day; }
        const label = document.createElement('label'), radio = document.createElement('input'), text = document.createElement('span');
        radio.type = 'radio'; radio.name = 'backup-version'; radio.value = item.id; radio.checked = item.id === selectedVersion;
        text.textContent = `${new Date(item.at).toLocaleTimeString()} — ${item.reason}`; label.append(radio, text); fragment.append(label);
        radio.onchange = () => { selectedVersion = item.id; previewVersion(); };
      }
      $('version-list').replaceChildren(fragment); $('version-status').textContent = versions.length ? `${versions.length} recoverable versions` : 'No backups yet. Back Up Now creates the first snapshot.';
      previewVersion();
    } catch (error) { backupError(error); }
  }
  function openVersions() { if ($('screenplay-settings-dialog').open) $('screenplay-settings-dialog').close(); $('versions-dialog').showModal(); void refreshVersions(); }
  $('version-history').onclick = openVersions; $('settings-version-history').onclick = openVersions;
  $('versions-close').onclick = () => $('versions-dialog').close(); $('version-refresh').onclick = refreshVersions;
  $('version-snapshot').onclick = async () => { if (recovery) return; try { await capture('Manual Backup'); await refreshVersions(); } catch {} };
  $('version-restore').onclick = () => $('restore-confirm-dialog').showModal();
  $('restore-cancel').onclick = () => $('restore-confirm-dialog').close();
  $('restore-confirm').onclick = async () => {
    const item = versions.find(item => item.id === selectedVersion); if (!item) return;
    const original = getDocument(); $('restore-confirm').disabled = true;
    try {
      validateDocument(item.document);
      if (recovery) {
        const previous = recovery; recovery = null;
        try { await previous.restore(structuredClone(item.document)); } catch (error) { recovery = previous; throw error; }
        $('restore-confirm-dialog').close(); $('versions-dialog').close(); notify('Recovered the backup. The damaged working copy was preserved separately.'); return;
      }
      await capture('Before Restore', original);
      if (getDocument() !== original) throw new Error('The screenplay changed. Review the restore again.');
      await apply({ type: 'restoreVersion', document: { ...structuredClone(item.document), id: original.id }, safetyCaptured: true });
      $('restore-confirm-dialog').close(); $('versions-dialog').close(); notify('Version restored. The previous screenplay is retained in Version History.');
    } catch (error) { backupError(error); } finally { $('restore-confirm').disabled = false; }
  };
  for (const id of ['statistics-dialog', 'versions-dialog']) $(id).addEventListener('close', () => restore(getSelection()));
  function needsBackup(command, selection) {
    if (command.safetyCaptured) return false;
    if (['restoreVersion', 'renameCharacter'].includes(command.type)) return true;
    if (command.type === 'replaceMatches') return command.all && (command.matches.length >= 10 || command.matches.reduce((sum, match) => sum + match.text.length, 0) >= 200);
    if (!['paste', 'insert', 'lineBreak', 'backspace', 'delete'].includes(command.type)) return false;
    const doc = getDocument(), start = doc.elements.findIndex(el => el.id === selection.anchor.id), end = doc.elements.findIndex(el => el.id === selection.focus.id);
    const size = start === end ? Math.abs(selection.focus.offset - selection.anchor.offset) : doc.elements.slice(Math.min(start, end), Math.max(start, end) + 1).reduce((sum, el) => sum + el.text.length, 0);
    return size >= 200 || (command.type === 'paste' && command.text.length >= 500 && (start !== end || size > 0));
  }
  return {
    recover(record, restore) {
      const placeholder = createDocument(); placeholder.id = record.id;
      recovery = { placeholder, restore }; $('version-snapshot').disabled = true; openVersions();
    },
    update() { activity(); search(); stats(); },
    loaded() { $('version-snapshot').disabled = false; documentId = null; baseline = null; activity(); if (settings.enabled) capture('Automatic Backup').catch(() => {}); },
    async beforeChange(command, selection) {
      if (needsBackup(command, selection)) await capture(command.type === 'replaceMatches' ? 'Before Replace All' : command.type === 'paste' ? 'Before Paste' : 'Before Destructive Edit');
    },
    needsBackup,
  };
}
