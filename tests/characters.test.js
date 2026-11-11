import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, createElement as el, meaningfulContent, dialogueGroups } from '../js/document.js';
import { parseFountain, serializeFountain } from '../js/fountain.js';
import { fountainForSaving } from '../js/session.js';
import { caret, editDocument, EditorHistory, editableElements } from '../js/editing.js';
import { detectedCharacters, previewCharacterRename, carryCharacterVoice } from '../js/characters.js';
import { buildTableRead, tableReadPreferenceKey, loadTableReadPreferences } from '../js/table-read-model.js';
import { createRepository } from '../js/storage.js';
import { IDBFactory } from 'fake-indexeddb';
const command = plan => ({ type: 'renameCharacter', from: plan.from, to: plan.to, signature: plan.signature, mentions: plan.mentions.map(match => match.id) });

test('Tab on empty or filled dialogue creates exactly one parenthetical with the correct caret and a single undo/redo step', () => {
  for (const text of ['', 'I do not know what to say.']) {
    const doc = createDocument({ elements: [el('character', 'NOAH'), el('dialogue', text)] }), dialogue = doc.elements[1];
    const selection = caret(dialogue.id, Math.floor(text.length / 2)), history = new EditorHistory(doc, selection);
    const state = history.apply(selection, { type: 'tab' }), elements = editableElements(state.document), par = elements.at(-1);
    assert.equal(par.type, 'parenthetical'); assert.equal(par.text, '()'); assert.deepEqual(state.selection, caret(par.id, 1));
    assert.equal(elements.length, text ? 3 : 2);
    if (text) { assert.deepEqual(elements[1], dialogue); assert.notEqual(par.id, dialogue.id); }
    else assert.equal(par.id, dialogue.id);
    assert.deepEqual(history.undo(), { document: doc, selection }); assert.deepEqual(history.redo(), state);
    const typed = editDocument(state.document, state.selection, { type: 'insert', text: 'whispering' }); assert.equal(typed.document.elements.find(e => e.id === par.id).text, '(whispering)');
    const entered = editDocument(typed.document, typed.selection, { type: 'enter' }); assert.equal(entered.document.elements.find(e => e.id === entered.selection.focus.id).type, 'dialogue');
    const spoken = editDocument(entered.document, entered.selection, { type: 'insert', text: "don't move." });
    assert.match(fountainForSaving(spoken.document), /\(whispering\)\nDon't move\./);
  }
});
test('parentheticals preserve manual/imported capitalization, line breaks and format switching without duplicate parentheses', () => {
  for (const value of ['whispering', 'Whispering', 'sOFTLY\nand Calmly']) {
    const doc = createDocument({ elements: [el('parenthetical', '()')] }), id = doc.elements[0].id;
    let state = editDocument(doc, caret(id, 1), { type: 'insert', text: value }); assert.equal(state.document.elements[0].text, `(${value})`);
    state = editDocument(state.document, state.selection, { type: 'format', elementType: 'parenthetical' }); assert.equal(state.document.elements[0].text, `(${value})`);
  }
  const imported = parseFountain('NOAH\n(Whispering)\nStay.'); const par = imported.elements.find(e => e.type === 'parenthetical');
  const result = editDocument(imported, caret(par.id, 1), { type: 'insert', text: 'still ' }); assert.equal(result.document.elements.find(e => e.id === par.id).text, '(still Whispering)');
  const action = createDocument({ elements: [el('action', '')] }); let state = editDocument(action, caret(action.elements[0].id), { type: 'format', elementType: 'parenthetical' });
  state = editDocument(state.document, state.selection, { type: 'insert', text: 'gently' }); assert.equal(state.document.elements[0].text, '(gently)');
  state = editDocument(state.document, state.selection, { type: 'enter' }); state = editDocument(state.document, state.selection, { type: 'insert', text: 'hello' }); assert.equal(state.document.elements.at(-1).text, 'Hello');
});
test('rename covers all cues, case styles, extensions, dual dialogue and selected text without changing identities or formatting', () => {
  const doc = parseFountain("INT. ROOM - DAY\n\nNoah watches NOAH and noah. NoAH calls.\n\nNOAH (V.O.)\nNoah, **Noah** and _noah_. [[Noah note]] /* Noah comment */\n\nAVA ^\nNoah?\n\nNOAH (O.S.) (CONT'D)\n(looking at Noah)\nYes.\n");
  const original = structuredClone(doc), plan = previewCharacterRename(doc, 'NOAH', 'jonah');
  assert.deepEqual(detectedCharacters(doc).map(c => c.name), ['NOAH', 'AVA']); assert.equal(plan.cues.length, 2); assert.equal(plan.mentions.length, 9); assert.deepEqual(doc, original);
  const first = doc.elements.find(e => e.type === 'action'), selection = caret(first.id, first.text.length);
  const history = new EditorHistory(doc, selection), state = history.apply(selection, command(plan));
  assert.equal(state.document.elements.find(e => e.id === first.id).text, 'Jonah watches JONAH and jonah. JoNAH calls.');
  assert.deepEqual(state.document.elements.map(e => e.id), doc.elements.map(e => e.id)); assert.deepEqual(state.document.elements.map(e => e.type), doc.elements.map(e => e.type));
  assert.deepEqual(state.document.elements.filter(e => e.type === 'character').map(e => [e.text, Boolean(e.dual)]), [["JONAH (V.O.)", false], ['AVA', true], ["JONAH (O.S.) (CONT'D)", false]]);
  assert.ok(dialogueGroups(state.document).some(g => g.partnerId));
  assert.ok(state.document.elements.some(e => e.text.includes('Jonah, **Jonah** and _jonah_. [[Noah note]] /* Noah comment */')));
  assert.equal(state.selection.focus.offset, first.text.length + 4);
  const output = fountainForSaving(state.document); assert.deepEqual(meaningfulContent(parseFountain(output)), meaningfulContent(state.document));
  assert.deepEqual(history.undo().document, original); assert.deepEqual(history.redo().document, state.document); assert.equal(history.past.length, 1);
});
test('whole Unicode names, multiword names and word boundaries avoid partial or unrelated matches', () => {
  for (const [name, to, text, expected] of [
    ['ANN', 'EMMA', 'ANN Ann ann ANNIE ANNOUNCEMENT JOANN éANN ANNé ANN_2', 'EMMA Emma emma ANNIE ANNOUNCEMENT JOANN éANN ANNé ANN_2'],
    ['MARY JANE', 'DAVID CARTER', 'Mary Jane met MARY JANE. Mary and Jane stay. Mary Janette stays.', 'David Carter met DAVID CARTER. Mary and Jane stay. Mary Janette stays.'],
    ['JOHN SMITH', 'SARAH', 'john smith and John Smith and JOHN\nSMITH.', 'sarah and Sarah and SARAH.'],
    ['ÉLISE', 'RENÉE', "Élise sees élise. XÉlise Élise2 Élisé. Élise's room.", "Renée sees renée. XÉlise Élise2 Élisé. Renée's room."],
    ["O'NEIL", 'O’BRIEN', "O'Neil calls O'NEIL. O'Neilly stays.", 'O’Brien calls O’BRIEN. O\'Neilly stays.'],
  ]) {
    const doc = createDocument({ elements: [el('action', text), el('character', name), el('dialogue', 'Hello.')] }); const plan = previewCharacterRename(doc, name, to), result = editDocument(doc, caret(doc.elements[0].id), command(plan));
    assert.equal(result.document.elements[0].text, expected); assert.equal(result.document.elements[1].text, to);
  }
});
test('reviewed mentions can be deselected; notes and metadata remain unchanged and stale or unsafe renames fail without mutations', () => {
  const doc = parseFountain('Title: Rose\n\nINT. GARDEN - DAY\n\nRose holds a rose.\n\nROSE\nRose?\n\nANN\nHello.'); const plan = previewCharacterRename(doc, 'ROSE', 'LILY');
  const cmd = command(plan); cmd.mentions = [plan.mentions[0].id]; const result = editDocument(doc, caret(doc.elements[0].id), cmd);
  assert.equal(result.document.elements.find(e => e.type === 'action').text, 'Lily holds a rose.'); assert.equal(result.document.elements.find(e => e.type === 'titleField').text, 'Rose');
  assert.ok(result.document.elements.some(e => e.type === 'dialogue' && e.text === 'Rose?'));
  for (const input of ['Rose', 'Ann', '', 'LILY (V.O.)', '*LILY*', 'LILY\nJANE']) assert.throws(() => previewCharacterRename(doc, 'ROSE', input));
  assert.throws(() => editDocument(result.document, result.selection, cmd), /changed after/);
  assert.throws(() => editDocument(doc, caret(doc.elements[0].id), { ...cmd, mentions: ['not-reviewed'] }), /no longer/);
});
test('emphasized multiword names keep markup delimiters intact and cue extensions are excluded from text matches', () => {
  const doc = parseFountain('INT. ROOM - DAY\n\n**Mary** Jane sees _Mary Jane_.\n\n@**MARY JANE** (V.O.)\nMary Jane.\n'); const plan = previewCharacterRename(doc, 'MARY JANE', 'DAVID CARTER');
  const state = editDocument(doc, caret(doc.elements[0].id), command(plan));
  assert.ok(state.document.elements.some(e => e.text === '**David** Carter sees _David Carter_.'));
  assert.ok(state.document.elements.some(e => e.text === '**DAVID CARTER** (V.O.)'));
  assert.doesNotThrow(() => serializeFountain(state.document, { canonical: true }));
});
test('assigned native or imported voices and speaker settings follow renames, retain undo/redo aliases and leave other scripts and speakers intact', async () => {
  const repository = createRepository(new IDBFactory(), 'rename-test');
  const saved = { version: 1, speed: 1.5, readSceneHeadings: true, speakers: { 'character:NOAH': { voiceId: 'piper:example:0', rate: .75, pitch: .8, volume: .6 }, 'character:AVA': { voiceId: 'native:ava', rate: 1, pitch: 1, volume: 1 }, narrator: { voiceId: 'native:narrator', rate: 1, pitch: 1, volume: 1 } } };
  await repository.setPreference(tableReadPreferenceKey('one'), saved); await repository.setPreference(tableReadPreferenceKey('two'), saved);
  await carryCharacterVoice(repository, 'one', 'NOAH', 'JONAH'); const prefs = await loadTableReadPreferences(repository, 'one');
  assert.deepEqual(prefs.speakers['character:JONAH'], prefs.speakers['character:NOAH']); assert.equal(prefs.speed, 1.5); assert.deepEqual(prefs.speakers.narrator, saved.speakers.narrator); assert.deepEqual(prefs.speakers['character:AVA'], saved.speakers['character:AVA']);
  assert.equal((await loadTableReadPreferences(repository, 'two')).speakers['character:JONAH'], undefined);
  const doc = parseFountain('NOAH\nHello.'), plan = previewCharacterRename(doc, 'NOAH', 'JONAH'), history = new EditorHistory(doc, caret(doc.elements[0].id)); history.apply(history.current.selection, command(plan));
  for (const state of [history.current, history.undo(), history.redo()]) { const speaker = buildTableRead(state.document).speakers.find(s => s.id !== 'narrator'); assert.equal(prefs.speakers[speaker.id].voiceId, 'piper:example:0'); }
  await assert.rejects(carryCharacterVoice({ getPreference: async () => { throw new Error('Storage failed'); } }, 'one', 'NOAH', 'JONAH'), /Storage failed/);
});

test('renaming traverses every scene in a feature-length model, including text beyond rendered pages', () => {
  const elements = Array.from({ length: 250 }, (_, i) => [el('scene', `INT. ROOM ${i} - DAY`), el('action', 'Noah waits.'), el('character', 'NOAH (V.O.)'), el('dialogue', 'Noah?')]).flat();
  const doc = createDocument({ elements }), plan = previewCharacterRename(doc, 'NOAH', 'JONAH'); assert.equal(plan.cues.length, 250); assert.equal(plan.mentions.length, 500);
  const state = editDocument(doc, caret(elements.at(-1).id, 5), command(plan)); assert.equal(state.document.elements.at(-1).text, 'Jonah?'); assert.equal(state.selection.focus.offset, 6); assert.equal(JSON.stringify(state.document).includes('NOAH (V.O.)'), false);
});
