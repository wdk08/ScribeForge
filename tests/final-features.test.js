import test from 'node:test';
import assert from 'node:assert/strict';
import { indexedDB } from 'fake-indexeddb';
import { createDocument, createElement } from '../js/document.js';
import { parseFountain } from '../js/fountain.js';
import { fountainForSaving, documentFingerprint } from '../js/session.js';
import { EditorHistory, caret } from '../js/editing.js';
import { automaticContinuations, hasContinuation } from '../js/continuations.js';
import { findMatches, replaceMatches, SEARCH_TYPES } from '../js/search.js';
import { dialogueStatistics } from '../js/dialogue-statistics.js';
import { BackupService, IndexedDBBackupStore, backupSettings, retainedBackups } from '../js/backups.js';
const screenplay = () => parseFountain('INT. HOUSE - DAY\n\nTYLER (V.O.)\nHello there.\n(softly)\nI am here.\n\nHe waits.\n\nTYLER (O.S.)\nHello again.\n\nTESS ^\nAnn and Annie.');

test('continuation overrides beat automatic detection, preserve extensions, identity and undo', () => {
  const doc = screenplay(), cues = doc.elements.filter(el => el.type === 'character'), selection = caret(cues[0].id);
  const history = new EditorHistory(doc, selection);
  history.apply(selection, { type: 'toggleContinuation', id: cues[0].id });
  assert.equal(history.current.document.elements.find(el => el.id === cues[0].id).text, 'TYLER (V.O.)');
  assert.ok(automaticContinuations(history.current.document).has(cues[0].id));
  history.apply(selection, { type: 'toggleContinuation', id: cues[0].id });
  assert.equal(history.current.document.elements.find(el => el.id === cues[0].id).continuation, 'off');
  assert.ok(!automaticContinuations(history.current.document).has(cues[0].id));
  history.undo(); assert.ok(automaticContinuations(history.current.document).has(cues[0].id)); history.redo();
  assert.notEqual(documentFingerprint(doc), documentFingerprint(history.current.document));
  const reopened = parseFountain(fountainForSaving(history.current.document));
  assert.equal(reopened.elements.find(el => el.type === 'character').continuation, undefined);
  assert.equal(reopened.elements.find(el => el.type === 'character').text, 'TYLER (V.O.)');
  assert.equal(dialogueStatistics(doc).words, dialogueStatistics(reopened).words);
});
test('explicit continuation removal preserves every other extension and never duplicates', () => {
  const doc = parseFountain('@TYLER (CONT’D) (V.O.) (O.C.)\nHello.');
  const cue = doc.elements.find(el => el.type === 'character'), history = new EditorHistory(doc, caret(cue.id));
  history.apply(caret(cue.id), { type: 'toggleContinuation', id: cue.id });
  assert.equal(history.current.document.elements[0].text, 'TYLER (V.O.) (O.C.)');
  assert.ok(!hasContinuation(history.current.document.elements[0].text));
  history.apply(caret(cue.id), { type: 'toggleContinuation', id: cue.id });
  const saved = parseFountain(fountainForSaving(history.current.document));
  assert.equal(saved.elements[0].continuation, undefined); assert.equal(saved.elements[0].text, "TYLER (V.O.) (O.C.) (CONT'D)");
});
test('automatic continuation can be suppressed independently after an interruption', () => {
  const doc = parseFountain('@ANN\nHello.\n\nShe waits.\n\n@ANN\nAgain.');
  const cue = doc.elements.filter(el => el.type === 'character')[1], h = new EditorHistory(doc, caret(cue.id));
  assert.ok(automaticContinuations(doc).has(cue.id)); h.apply(caret(cue.id), { type: 'toggleContinuation', id: cue.id });
  assert.ok(!automaticContinuations(h.current.document).has(cue.id)); assert.equal(h.current.document.elements.find(el => el.id === cue.id).continuation, 'off');
});
test('structured literal search supports multiple matches, Unicode words, case, filters and title exclusion', () => {
  const doc = createDocument({ title: 'Ann', elements: [createElement('action', 'Ann ann Annie Ann_1 éAnn Anné [Ann] 😀Ann😀'), createElement('dialogue', 'ANN Ann'), createElement('titleField', 'Ann', { key: 'Author' })] });
  assert.equal(findMatches(doc, 'Ann').length, 10);
  assert.equal(findMatches(doc, 'Ann', { caseSensitive: true }).length, 8);
  assert.equal(findMatches(doc, 'Ann', { wholeWord: true }).length, 6);
  assert.equal(findMatches(doc, 'Ann', { types: ['dialogue'], caseSensitive: true }).length, 1);
  assert.equal(findMatches(doc, '[Ann]').length, 1); assert.equal(findMatches(doc, '').length, 0);
  assert.equal(findMatches(doc, 'Ann', { types: [] }).length, 0); assert.equal(SEARCH_TYPES.length, 6);
});
test('replace preserves IDs/types, handles empty replacement and is one undo transaction', () => {
  const doc = screenplay(), selected = caret(doc.elements.find(el => el.type === 'dialogue').id);
  const matches = findMatches(doc, 'Hello', { types: ['dialogue'] });
  const once = replaceMatches(doc, matches.slice(0, 1), 'Hello Hello'); assert.equal(findMatches(once, 'Hello').length, 3);
  const h = new EditorHistory(doc, selected); h.apply(selected, { type: 'replaceMatches', matches, replacement: '' });
  assert.equal(findMatches(h.current.document, 'Hello').length, 0);
  assert.deepEqual(h.current.document.elements.map(el => [el.id, el.type]), doc.elements.map(el => [el.id, el.type]));
  assert.equal(h.past.length, 1); h.undo(); assert.deepEqual(h.current.document, doc); h.redo(); assert.equal(findMatches(h.current.document, 'Hello').length, 0);
  assert.throws(() => replaceMatches(doc, [{ ...matches[0], text: 'stale' }], ''), /changed/);
});
test('statistics count cue blocks once across parentheticals, normalize extensions, dual dialogue and sorts', () => {
  const doc = screenplay(), data = dialogueStatistics(doc);
  assert.equal(data.characters, 2); assert.equal(data.words, 10);
  assert.deepEqual(data.rows.map(row => [row.name, row.blocks, row.words]), [['TYLER', 2, 7], ['TESS', 1, 3]]);
  assert.equal(data.rows[0].percent, 70); assert.equal(data.rows[1].percent, 30);
  assert.equal(dialogueStatistics(doc, 'name').rows[0].name, 'TESS');
  assert.equal(dialogueStatistics(doc, 'words', true).rows[0].name, 'TESS');
  assert.deepEqual(dialogueStatistics(createDocument()), { rows: [], words: 0, characters: 0 });
});
test('backups are immutable, deduplicated, full fidelity and accessible through a fresh adapter', async () => {
  const service = new BackupService(new IndexedDBBackupStore(indexedDB)), doc = screenplay(); doc.settings = { boldSceneHeadings: true }; doc.elements.find(el => el.type === 'character').continuation = 'off';
  const first = await service.capture(doc, 'Automatic Backup');
  assert.equal((await service.capture(doc)).id, first.id);
  doc.title = 'Changed'; await service.capture(doc, 'Before Restore');
  const reopened = new BackupService(new IndexedDBBackupStore(indexedDB)), versions = await reopened.list(doc.id);
  assert.equal(versions.length, 2); assert.notEqual(versions[0].id, versions[1].id);
  assert.equal(versions.find(item => item.id === first.id).document.title, 'Untitled Screenplay');
  assert.equal(versions.find(item => item.id === first.id).document.elements.find(el => el.type === 'character').continuation, 'off');
  assert.deepEqual(versions.find(item => item.id === first.id).document.settings, { boldSceneHeadings: true });
  await assert.rejects(service.store.add(first));
});
test('retention keeps today, daily last week, weekly last month, all safety versions and sole version', () => {
  const now = new Date('2026-10-16T15:00:00Z').getTime(), day = 86400000;
  const items = Array.from({ length: 400 }, (_, index) => ({ id: String(index), at: now - index * day / 6, reason: 'Automatic Backup' }));
  items.push({ id: 'safety', at: now - 100 * day, reason: 'Before Restore' });
  const kept = retainedBackups(items, now);
  assert.ok(kept.length < 30); assert.ok(kept.some(item => item.id === '0')); assert.ok(kept.some(item => item.id === 'safety'));
  assert.equal(retainedBackups([{ id: 'only', at: 0, reason: 'Automatic Backup' }], now).length, 1);
});
test('backup storage errors reject without modifying the source; subsequent writes can retry', async () => {
  let fail = true; const items = [];
  const service = new BackupService({ list: async () => items, add: async item => { if (fail) throw new Error('Quota exceeded'); items.push(item); }, remove: async () => {} });
  const doc = screenplay(), before = structuredClone(doc);
  await assert.rejects(service.capture(doc), /Quota/); assert.deepEqual(doc, before); fail = false;
  await service.capture(doc); assert.equal(items.length, 1);
  assert.deepEqual(backupSettings({ enabled: false, interval: 500 }), { enabled: false, interval: 10 });
});
test('restore is undoable with stable document ID and preserves full title metadata', () => {
  const doc = screenplay(), original = structuredClone(doc), selection = caret(doc.elements[0].id), h = new EditorHistory(doc, selection);
  const version = structuredClone(doc); version.title = 'Recovered'; version.elements.push(createElement('titleField', 'Writer', { key: 'Author' }));
  h.apply(selection, { type: 'restoreVersion', document: version }); assert.equal(h.current.document.id, doc.id); assert.equal(h.current.document.title, 'Recovered');
  h.undo(); assert.deepEqual(h.current.document, original); h.redo(); assert.equal(h.current.document.title, 'Recovered');
});
test('legacy fingerprints remain unchanged for existing screenplays without overrides', async () => {
  const doc = screenplay(), { meaningfulContent } = await import('../js/document.js');
  const legacy = JSON.stringify({ title: doc.title, elements: meaningfulContent(doc), whitespace: doc.elements.filter(el => el.type === 'whitespace').map(el => el.text) });
  assert.equal(documentFingerprint(doc), legacy);
});
test('forced-off continuation follows a speech block onto subsequent pages', async () => {
  const { layoutUnits, paginate } = await import('../js/pagination.js');
  const { continuedCue } = await import('../js/continuations.js');
  const doc = createDocument({ elements: [createElement('character', 'TYLER (V.O.)', { continuation: 'off' }), createElement('dialogue', 'Speech')] });
  const units = layoutUnits(doc, el => Array.from({ length: el.type === 'dialogue' ? 100 : 1 }, (_, index) => ({ id: el.id, type: el.type, text: el.text, start: index, end: index + 1 })));
  const continuations = paginate(units).flatMap(page => page.items).filter(item => item.continued);
  assert.ok(continuations.length); assert.ok(continuations.every(item => item.speakerStates[0] === 'off'));
  assert.equal(continuedCue('TYLER (V.O.)', continuations[0].speakerStates[0]), 'TYLER (V.O.)');
});
