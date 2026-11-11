import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { hospitalElements } from './fixtures/hospital-paste-expected.js';
import { screenplayPaste } from '../js/screenplay-paste.js';
import { createDocument, createElement, meaningfulContent } from '../js/document.js';
import { EditorHistory, caret } from '../js/editing.js';
import { parseFountain } from '../js/fountain.js';
import { fountainForSaving } from '../js/session.js';
const source = readFileSync(new URL('./fixtures/hospital-paste.txt', import.meta.url), 'utf8');
const projection = doc => doc.elements.filter(el => !['whitespace', 'titleField'].includes(el.type)).map(el => [el.type, el.text]);

for (const [label, text] of [
  ['original', source], ['CRLF', source.replace(/\n/g, '\r\n')],
  ['space-only separators', source.replace(/\n\n/g, '\n \t\n')],
  ['Markdown', source.replace(/^(INT\..*|EXT\..*|NOAH|AVA|NURSE)$/gm, '**$1**')],
]) test(`complete supplied hospital scene is classified from beginning to end: ${label}`, () => {
  const doc = createDocument({ elements: screenplayPaste(text) });
  assert.deepEqual(projection(doc), hospitalElements);
  assert.deepEqual(meaningfulContent(parseFountain(fountainForSaving(doc))), meaningfulContent(doc));
});
test('lost separators do not trap later cues, parentheticals, transitions and headings inside dialogue', () => {
  const doc = createDocument({ elements: screenplayPaste(source.replace(/\n\n/g, '\n')) });
  assert.deepEqual(doc.elements.filter(el => el.type === 'character').map(el => el.text), ['NOAH', 'AVA', 'NOAH', 'AVA', 'NURSE']);
  assert.equal(doc.elements.filter(el => el.type === 'scene').length, 2);
  assert.equal(doc.elements.find(el => el.type === 'parenthetical').text, '(weakly)');
  assert.equal(doc.elements.find(el => el.type === 'transition').text, 'CUT TO:');
  assert.deepEqual(projection(doc).at(-1), ['action', 'Noah walks toward his car.']);
  assert.doesNotThrow(() => fountainForSaving(doc));
});
test('a missing separator before a clear later heading ends speech without swallowing the next scene', () => {
  const doc = createDocument({ elements: screenplayPaste('NOAH\nHello.\nEXT. HOSPITAL - NIGHT\n\nNoah walks away.') });
  assert.deepEqual(projection(doc), [['character', 'NOAH'], ['dialogue', 'Hello.'], ['scene', 'EXT. HOSPITAL - NIGHT'], ['action', 'Noah walks away.']]);
});
test('uppercase action and ordinary spoken transition phrases are retained conservatively', () => {
  const doc = createDocument({ elements: screenplayPaste('NOAH\nFade out.\n\nTHE BUILDING IS ON FIRE.\nEveryone runs.\n\nAVA\nI know.') });
  assert.deepEqual(projection(doc), [['character', 'NOAH'], ['dialogue', 'Fade out.'], ['action', 'THE BUILDING IS ON FIRE.\nEveryone runs.'], ['character', 'AVA'], ['dialogue', 'I know.']]);
});
test('the complete hospital scene inserted into a paragraph preserves neighbors and exact undo/redo', () => {
  const doc = createDocument({ elements: [createElement('action', 'Before After'), createElement('whitespace', '\n'), createElement('action', 'Untouched')] });
  const initial = caret(doc.elements[0].id, 7), history = new EditorHistory(doc, initial);
  const result = history.apply(initial, { type: 'paste', text: source });
  assert.deepEqual(projection(result.document), [['action', 'Before '], ...hospitalElements, ['action', 'After'], ['action', 'Untouched']]);
  assert.equal(result.document.elements.at(-1).id, doc.elements.at(-1).id);
  assert.equal(result.selection.focus.offset, hospitalElements.at(-1)[1].length);
  assert.doesNotThrow(() => fountainForSaving(result.document));
  assert.deepEqual(history.undo(), { document: doc, selection: initial });
  assert.deepEqual(history.redo(), result);
});
for (const type of ['scene', 'action', 'character', 'parenthetical', 'dialogue', 'transition']) test(`formatting ${type} preserves element identity, caret and history on filled and blank lines`, () => {
  for (const text of ['Noah enters.', '']) {
    const el = createElement('scene', text), doc = createDocument({ elements: [el] });
    const initial = caret(el.id, Math.min(4, text.length)), history = new EditorHistory(doc, initial);
    const result = history.apply(initial, { type: 'format', elementType: type });
    assert.equal(result.document.elements.length, 1); assert.equal(result.document.elements[0].id, el.id);
    assert.equal(result.document.elements[0].type, type);
    assert.equal(result.document.elements[0].text, type === 'parenthetical' ? `(${text})` : ['character', 'transition'].includes(type) ? text.toUpperCase() : text);
    assert.equal(result.selection.focus.offset, initial.focus.offset + (type === 'parenthetical' ? 1 : 0));
    assert.deepEqual(history.undo().document, doc);
    assert.deepEqual(history.redo().document, result.document);
  }
});
test('applying the current format is a no-op that retains the newly placed caret without adding undo history', () => {
  const el = createElement('action', 'Noah enters.'), doc = createDocument({ elements: [el] });
  const history = new EditorHistory(doc, caret(el.id, 0));
  const result = history.apply(caret(el.id, 4), { type: 'format', elementType: 'action' });
  assert.deepEqual(result.document, doc); assert.deepEqual(result.selection, caret(el.id, 4));
  assert.equal(history.past.length, 0);
});
test('existing blank separators around headings and transitions are preserved without adding extra blank lines', () => {
  const doc = createDocument({ elements: screenplayPaste(source) });
  assert.ok(doc.elements.filter(el => el.type === 'whitespace').every(el => el.text === '\n'));
  assert.deepEqual(projection(doc), hospitalElements);
});
