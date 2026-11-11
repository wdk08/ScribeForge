import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, createElement as el, meaningfulContent } from '../js/document.js';
import { parseFountain } from '../js/fountain.js';
import { fountainForSaving } from '../js/session.js';
import { caret, editDocument, EditorHistory } from '../js/editing.js';
import { sceneLocation, SceneLocationIndex } from '../js/scene-locations.js';
const documentWith = headings => createDocument({ elements: headings.map(text => el('scene', text)) });
test('extracts locations without known time qualifiers, while preserving punctuation, hyphens and ambiguous spaced-dash names', () => {
  for (const qualifier of ['DAY', 'NIGHT', 'CONTINUOUS', 'MOMENTS LATER', 'SAME TIME', 'SUNSET', 'EARLY MORNING', 'LATE AFTERNOON', 'THE NEXT DAY']) assert.equal(sceneLocation(`INT. MOTHER-IN-LAW'S HOUSE - ${qualifier}`).label, "INT. MOTHER-IN-LAW'S HOUSE");
  for (const value of ['INT. HOSPITAL ROOM', 'INT. HOSPITAL ROOM - ', '  INT.   HOSPITAL ROOM – NIGHT', 'INT. HOSPITAL ROOM — MORNING']) assert.equal(sceneLocation(value).label, 'INT. HOSPITAL ROOM');
  assert.equal(sceneLocation('INT. HOUSE - EAST WING - NIGHT').label, 'INT. HOUSE - EAST WING');
  assert.equal(sceneLocation('INT. HOUSE - EAST WING').label, 'INT. HOUSE - EAST WING');
  assert.equal(sceneLocation('INT. HOUSE - DAY CARE').qualifier, null);
  assert.equal(sceneLocation("EXT. Noah's  BEDROOM - night").label, "EXT. Noah's BEDROOM");
  assert.equal(sceneLocation('INTERVIEW'), null); assert.equal(sceneLocation('I/E'), null);
});
test('indexes all scene prefixes, deduplicates case and whitespace, ranks frequency then first appearance and excludes exact locations', () => {
  const doc = documentWith(['INT. HOUSE - DAY', 'INT. Hospital Room - DAY', 'int. Hospital   Room - night', 'INT. HOSPITAL HALLWAY - MORNING', 'EXT. HOSPITAL ENTRANCE - DAY', 'INT./EXT. CAR - NIGHT', 'EXT./INT. CAR - DAY', 'I/E. BOAT - DAY', 'EST. CITY - DAY']); const index = new SceneLocationIndex();
  assert.deepEqual(index.suggest(doc, 'int. h').map(item => [item.label, item.count]), [['INT. HOSPITAL ROOM', 2], ['INT. HOUSE', 1], ['INT. HOSPITAL HALLWAY', 1]]);
  assert.deepEqual(index.suggest(doc, 'INT. HOSPITAL R').map(item => item.label), ['INT. HOSPITAL ROOM']); assert.deepEqual(index.suggest(doc, 'INT. HOSPITAL ROOM - NIGHT'), []);
  for (const [prefix, expected] of [['INT./EXT.', 'INT./EXT. CAR'], ['EXT./INT.', 'EXT./INT. CAR'], ['I/E.', 'I/E. BOAT'], ['EST.', 'EST. CITY']]) assert.equal(index.suggest(doc, prefix)[0].label, expected);
});
test('index tracks additions, edits, last deletions, time-only edits, undo and a reopened document without persistent location data', () => {
  const doc = documentWith(['INT. POLICE STATION - DAY', 'INT. POLICE STATION - NIGHT']), index = new SceneLocationIndex(); index.update(doc); const original = index.locations;
  index.update(doc); assert.equal(index.locations, original);
  const edited = structuredClone(doc); edited.elements[0].text = "INT. SHERIFF'S OFFICE - NIGHT"; assert.equal(index.suggest(edited, 'INT. P')[0].count, 1);
  edited.elements = [edited.elements[0]]; index.document = null; assert.deepEqual(index.suggest(edited, 'INT. P'), []);
  edited.elements.push(el('scene', 'INT. POLICE STATION')); index.document = null; assert.equal(index.suggest(edited, 'INT. P')[0].label, 'INT. POLICE STATION');
  assert.equal(new SceneLocationIndex().suggest(parseFountain(fountainForSaving(edited)), 'INT. P')[0].label, 'INT. POLICE STATION');
  assert.equal(index.suggest(doc, 'INT. P')[0].count, 2);
});
test('completion preserves the scene ID, metadata and existing qualifier, inserts one separator, and is one undo/redo transaction', () => {
  for (const text of ['INT. HOSP', 'INT. HOSP - ', 'INT. HOSP - NIGHT']) {
    const doc = documentWith(['INT. HOSPITAL ROOM - DAY', text]); const scene = doc.elements[1]; scene.sceneNumber = '2'; const before = structuredClone(doc);
    const selection = caret(scene.id, 9), history = new EditorHistory(doc, selection), command = { type: 'completeSceneLocation', elementId: scene.id, before: text, location: 'INT. HOSPITAL ROOM' };
    const state = history.apply(selection, command); assert.equal(state.document.elements.length, 2); assert.equal(state.document.elements[1].text, `INT. HOSPITAL ROOM - ${text.endsWith('NIGHT') ? 'NIGHT' : ''}`); assert.equal(state.document.elements[1].id, scene.id); assert.equal(state.document.elements[1].sceneNumber, '2'); assert.deepEqual(state.selection, caret(scene.id, 'INT. HOSPITAL ROOM - '.length));
    assert.deepEqual(history.undo().document, before); assert.deepEqual(history.redo(), state);
    const typed = text.endsWith('NIGHT') ? state : editDocument(state.document, state.selection, { type: 'insert', text: 'night' });
    const output = fountainForSaving(typed.document); assert.deepEqual(meaningfulContent(parseFountain(output)), meaningfulContent(typed.document).map(el => el.type === 'scene' ? { ...el, text: el.text.toUpperCase() } : el));
    assert.throws(() => editDocument(state.document, state.selection, command), /changed/);
  }
});
test('new scene prefixes automatically switch from Action without moving the caret or changing other shortcuts', () => {
  for (const prefix of ['INT.', 'EXT.', 'INT./EXT.', 'EXT./INT.', 'I/E.', 'EST.']) {
    const doc = createDocument({ elements: [el('action', '')] }), id = doc.elements[0].id; let state = { document: doc, selection: caret(id) };
    for (const letter of prefix) state = editDocument(state.document, state.selection, { type: 'insert', text: letter });
    assert.equal(state.document.elements[0].type, 'scene'); assert.equal(state.document.elements[0].id, id); assert.equal(state.selection.focus.offset, prefix.length);
    assert.equal(editDocument(state.document, state.selection, { type: 'enter' }).document.elements.at(-1).type, 'action');
  }
  const doc = createDocument({ elements: [el('dialogue', 'Hello.')] }); assert.equal(editDocument(doc, caret(doc.elements[0].id), { type: 'tab' }).document.elements.at(-1).type, 'parenthetical');
});
test('hundreds of model scenes remain indexed beyond visible pages without reparsing Fountain', () => {
  const doc = documentWith(Array.from({ length: 600 }, (_, i) => `INT. ROOM ${i} - ${i % 2 ? 'NIGHT' : 'DAY'}`)); const index = new SceneLocationIndex(); assert.equal(index.suggest(doc, 'INT. ROOM').length, 600); assert.equal(index.suggest(doc, 'INT. ROOM 599')[0], undefined);
  const next = structuredClone(doc); next.elements[599].text = "INT. SHERIFF'S OFFICE - NIGHT"; assert.equal(index.suggest(next, 'INT. SHER')[0].label, "INT. SHERIFF'S OFFICE"); assert.equal(index.suggest(next, 'INT. ROOM 599').length, 0);
});


test('lowercase, mixed case, imported and cached suggestions display and insert uppercase without changing ranking',()=>{
 const doc=documentWith(['int. callahan house - day','INT. Callahan HOUSE - night','int. callahan hospital - night','int. cal']);
 const index=new SceneLocationIndex(),query=doc.elements.at(-1);
 const choices=index.suggest(doc,'int. cal');assert.deepEqual(choices.map(e=>[e.label,e.count]),[['INT. CALLAHAN HOUSE',2],['INT. CALLAHAN HOSPITAL',1]]);
 index.locations=index.locations.map(e=>({...e,label:e.label.toLowerCase(),location:e.location.toLowerCase()}));
 assert.equal(index.suggest(doc,'iNt. caL')[0].label,'INT. CALLAHAN HOUSE');
 const result=editDocument(doc,caret(query.id,query.text.length),{type:'completeSceneLocation',elementId:query.id,before:query.text,location:'int. callahan house'});
 assert.equal(result.document.elements.at(-1).text,'INT. CALLAHAN HOUSE - ');assert.deepEqual(result.selection,caret(query.id,'INT. CALLAHAN HOUSE - '.length));
});
