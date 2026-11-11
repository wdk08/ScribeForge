import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, createElement } from '../js/document.js';
import { screenplaySettings, changeScreenplaySettings } from '../js/screenplay-settings.js';
import { EditorHistory, caret } from '../js/editing.js';
import { layoutUnits, paginate } from '../js/pagination.js';
import { parseFountain, serializeFountain } from '../js/fountain.js';
import { recordForFile, draftRecord } from '../js/session.js';

const measure = element => [{ start: 0, end: element.text.length }];
test('transition spacing is a full blank line, is not doubled for imports, and consumes pagination space', () => {
  const draft = draftRecord().recovery.document;
  const units = layoutUnits(draft, measure);
  assert.equal(units[1].gap, 16);
  assert.equal(paginate(units)[0].used, 48);
  assert.equal(layoutUnits(parseFountain('>FADE IN:\n\nA room.'), measure)[1].gap, 16);
  const before = structuredClone(draft);
  layoutUnits(draft, measure); assert.deepEqual(draft, before);
});
test('settings default off, belong to each document, and numbering is an undoable metadata edit', () => {
  const doc = parseFountain('INT. ROOM - DAY #9A#\n\nA room.\n\nEXT. ROAD - DAY #44#');
  assert.deepEqual(screenplaySettings(doc), { boldSceneHeadings: false, sceneNumbers: false });
  const original = structuredClone(doc), selection = caret(doc.elements[0].id, 3), history = new EditorHistory(doc, selection);
  history.apply(selection, { type: 'settings', changes: { sceneNumbers: true, boldSceneHeadings: true } });
  assert.deepEqual(history.current.document.elements.filter(el => el.type === 'scene').map(el => el.sceneNumber), ['1', '2']);
  assert.deepEqual(history.current.selection, selection); assert.deepEqual(doc, original);
  assert.deepEqual(screenplaySettings(createDocument()), { boldSceneHeadings: false, sceneNumbers: false });
  assert.match(serializeFountain(history.current.document), /#2#/);
  history.undo(); assert.deepEqual(history.current.document, original);
  history.redo(); assert.equal(screenplaySettings(history.current.document).boldSceneHeadings, true);
  const second = history.current.document.elements.find(el => el.type === 'action');
  history.apply(caret(second.id), { type: 'format', elementType: 'scene' });
  assert.deepEqual(history.current.document.elements.filter(el => el.type === 'scene').map(el => el.sceneNumber), ['1', '2', '3']);
});
test('Redo Numbers repairs missing and duplicate scene metadata without touching text or element identity', () => {
  const elements = [createElement('scene', 'INT. ROOM - DAY', { sceneNumber: '7' }), createElement('action', 'Unchanged.'), createElement('scene', 'EXT. ROAD - DAY'), createElement('scene', 'INT. CAR - DAY', { sceneNumber: '7' })];
  const doc = createDocument({ elements }), history = new EditorHistory(doc, caret(elements[1].id, 4));
  history.apply(history.current.selection, { type: 'renumber' });
  assert.deepEqual(history.current.document.elements.filter(el => el.type === 'scene').map(el => el.sceneNumber), ['1', '2', '3']);
  assert.deepEqual(history.current.document.elements.map(el => [el.id, el.type, el.text]), doc.elements.map(el => [el.id, el.type, el.text]));
  history.undo(); assert.deepEqual(history.current.document, doc);
});
test('re-reading a changed disk file retains only that screenplay’s presentation settings', async () => {
  const doc = changeScreenplaySettings(parseFountain('INT. ROOM - DAY'), { boldSceneHeadings: true, sceneNumbers: true });
  const record = await recordForFile({ source: 'EXT. ROAD - DAY', name: 'Film.fountain', hash: 'new', handle: null }, draftRecord(doc));
  assert.deepEqual(record.recovery.document.settings, doc.settings);
  assert.notEqual(record.recovery.document.settings, doc.settings);
  assert.equal(record.id, doc.id);
});
