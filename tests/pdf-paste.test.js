import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { screenplayPaste, normalizeScreenplayClipboard } from '../js/screenplay-paste.js';
import { createDocument, createElement, meaningfulContent, validateDocument } from '../js/document.js';
import { caret, EditorHistory } from '../js/editing.js';
import { parseFountain } from '../js/fountain.js';
import { fountainForSaving } from '../js/session.js';
const fixture = readFileSync(new URL('./fixtures/synthetic-pdf-extract.txt', import.meta.url), 'utf8');
const expected = JSON.parse(readFileSync(new URL('./fixtures/synthetic-pdf-extract.expected.json', import.meta.url), 'utf8'));
const body = doc => doc.elements.filter(el => !['whitespace', 'titleField'].includes(el.type)).map(el => [el.type, el.text]);
const sourceMeaning = doc => meaningfulContent(doc).map(el => el.type === 'character' ? { ...el, text: el.text.replace(/ \(CONT'D\)/g, '') } : el);
const miller = 'INT. MILLER HOUSE - NIGHT\n\nTess sits on the couch.\n\nTYLER\nAre you okay?\n\nTess looks toward him.\n\nTESS\nI\'m fine.\n\nTyler stands.\n\nCUT TO:\n\nEXT. MILLER HOUSE - NIGHT\n\nA car pulls into the driveway.';
const millerExpected = [['scene', 'INT. MILLER HOUSE - NIGHT'], ['action', 'Tess sits on the couch.'], ['character', 'TYLER'], ['dialogue', 'Are you okay?'], ['action', 'Tess looks toward him.'], ['character', 'TESS'], ['dialogue', "I'm fine."], ['action', 'Tyler stands.'], ['transition', 'CUT TO:'], ['scene', 'EXT. MILLER HOUSE - NIGHT'], ['action', 'A car pulls into the driveway.']];
for (const [name, text] of [['original', miller], ['no blank separators', miller.replace(/\n\n/g, '\n')], ['mixed separators', miller.replace(/\n\n/g, (_, i) => i % 2 ? '\n' : '\n \t\n')]]) test(`complete supplied PDF example has every required type: ${name}`, () => {
  const doc = createDocument({ elements: screenplayPaste(text) });
  assert.deepEqual(body(doc), millerExpected);
  assert.deepEqual(sourceMeaning(parseFountain(fountainForSaving(doc))), sourceMeaning(doc));
});
for (const [name, text] of [['PDF columns and page break', fixture], ['CRLF', fixture.replace(/\n/g, '\r\n')], ['Unicode line separators', fixture.replace(/\n/g, '\u2028')]]) test(`substantial annotated synthetic PDF extraction preserves all 65 elements: ${name}`, () => {
  const doc = createDocument({ elements: screenplayPaste(text) });
  assert.deepEqual(body(doc), expected);
  assert.equal(new Set(doc.elements.map(el => el.id)).size, doc.elements.length);
  assert.deepEqual(sourceMeaning(parseFountain(fountainForSaving(doc))), sourceMeaning(doc));
});
test('line normalization retains line and paragraph boundaries instead of joining words', () => {
  assert.equal(normalizeScreenplayClipboard('A\r\nB\rC\u2028D\u2029E\n\f\nF'), 'A\nB\nC\nD\n\nE\nF');
  assert.equal(screenplayPaste('Tess walks toward the window.\nShe looks outside.\nTyler enters the room.'), null);
  const doc = createDocument({ elements: screenplayPaste('INT. ROOM - DAY\n\nTess walks toward the window.\nShe looks outside.\nTyler enters the room.') });
  assert.deepEqual(body(doc), [['scene', 'INT. ROOM - DAY'], ['action', 'Tess walks toward the window.\nShe looks outside.\nTyler enters the room.']]);
});
test('wrapped action and speech retain their literal physical newlines', () => {
  const doc = createDocument({ elements: screenplayPaste('INT. ROOM - DAY\nTess walks toward the window and\nlooks outside.\nTYLER\nI thought that you would\nbe home before midnight.\nTess closes the door.') });
  assert.deepEqual(body(doc), [['scene', 'INT. ROOM - DAY'], ['action', 'Tess walks toward the window and\nlooks outside.'], ['character', 'TYLER'], ['dialogue', 'I thought that you would\nbe home before midnight.'], ['action', 'Tess closes the door.']]);
});
test('PDF action margin overrides speech even for unfamiliar narrative words; uppercase action is not a cue', () => {
  const text = 'INT. ROOM - DAY\n                    TYLER\n          What now?\nThe hall is silent.\nTHE BUILDING IS ON FIRE\nEveryone rushes outside.\n                    TESS (V.O.) (CONT\'D)\n          We need to go.';
  const doc = createDocument({ elements: screenplayPaste(text) });
  assert.deepEqual(body(doc), [['scene', 'INT. ROOM - DAY'], ['character', 'TYLER'], ['dialogue', 'What now?'], ['action', 'The hall is silent.\nTHE BUILDING IS ON FIRE\nEveryone rushes outside.'], ['character', "TESS (V.O.) (CONT'D)"], ['dialogue', 'We need to go.']]);
});
test('a heading without a time and an uppercase transition each end a previous dialogue block', () => {
  const doc = createDocument({ elements: screenplayPaste('TYLER\nHello.\nFADE OUT.\nEXT. FOREST\nTrees surround the road.\nTESS\nWait!\nSMASH CUT TO:\nINT. MILLER HOUSE - NIGHT\nA light flickers.') });
  assert.deepEqual(body(doc).map(([type]) => type), ['character', 'dialogue', 'transition', 'scene', 'action', 'character', 'dialogue', 'transition', 'scene', 'action']);
});
test('ambiguous speech stays speech and a spoken transition phrase is not automatically uppercased', () => {
  const doc = createDocument({ elements: screenplayPaste('TYLER\nI wonder if we should go.\nNothing really makes sense anymore.\nFade out.\n\nTESS\nWhat do you mean?') });
  assert.equal(body(doc)[1][1], 'I wonder if we should go.\nNothing really makes sense anymore.\nFade out.');
  assert.equal(body(doc)[1][0], 'dialogue');
});
test('feature-length synthetic PDF paste uses one transaction, unique IDs and exact undo/redo', () => {
  const original = createDocument({ elements: [createElement('action', 'Before After'), createElement('whitespace', '\n'), createElement('action', 'Untouched')] });
  const initial = caret(original.elements[0].id, 7), history = new EditorHistory(original, initial);
  const text = Array(20).fill(fixture).join('\n');
  const result = history.apply(initial, { type: 'paste', text });
  validateDocument(result.document); assert.equal(body(result.document).filter(([type]) => type === 'scene').length, 100);
  assert.equal(body(result.document)[0][1], 'Before '); assert.equal(body(result.document).at(-2)[1], 'After');
  assert.equal(result.document.elements.at(-1).id, original.elements.at(-1).id);
  assert.equal(history.past.length, 1);
  assert.doesNotThrow(() => fountainForSaving(result.document));
  assert.deepEqual(history.undo(), { document: original, selection: initial });
  assert.deepEqual(history.redo(), result);
});
test('reliable dialogue indentation keeps third-person descriptions inside spoken text', () => {
  const doc = createDocument({ elements: screenplayPaste('INT. ROOM - DAY\n                    TYLER\n          I remember her.\n          She looks toward the window every morning.\nTess opens the door.') });
  assert.deepEqual(body(doc), [['scene', 'INT. ROOM - DAY'], ['character', 'TYLER'], ['dialogue', 'I remember her.\nShe looks toward the window every morning.'], ['action', 'Tess opens the door.']]);
});
