import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, createElement, dialogueGroups } from '../js/document.js';
import { fountainForSaving } from '../js/session.js';
import { parseFountain, serializeFountain } from '../js/fountain.js';
import { editDocument, caret, editableElements, selectedText, EditorHistory } from '../js/editing.js';
const docWith = (type = 'action', text = '') => createDocument({ elements: [createElement(type, text)] });

test('typing is a pure transaction and preserves stable element/document identity', () => {
  const doc = docWith('action', 'Hello world'), id = doc.elements[0].id;
  const result = editDocument(doc, caret(id, 5), { type: 'insert', text: ', lovely' });
  assert.equal(result.document.elements[0].text, 'Hello, lovely world');
  assert.equal(doc.elements[0].text, 'Hello world');
  assert.equal(result.document.id, doc.id);
  assert.deepEqual(result.selection, caret(id, 13));
});
test('Enter follows screenplay types; empty dialogue returns to action without a phantom cue', () => {
  const doc = docWith('character', 'NOAH');
  let result = editDocument(doc, caret(doc.elements[0].id, 4), { type: 'enter' });
  assert.equal(editableElements(result.document)[1].type, 'dialogue');
  result = editDocument(result.document, result.selection, { type: 'insert', text: 'Hello.' });
  result = editDocument(result.document, result.selection, { type: 'enter' });
  assert.equal(editableElements(result.document).at(-1).type, 'action');
  const count = editableElements(result.document).length;
  result = editDocument(result.document, result.selection, { type: 'enter' });
  assert.equal(editableElements(result.document).length, count);
});
test('Enter splits Action at the caret and parenthetical advances to dialogue', () => {
  const doc = docWith('action', 'OneTwo');
  const result = editDocument(doc, caret(doc.elements[0].id, 3), { type: 'enter' });
  assert.deepEqual(editableElements(result.document).map(el => el.text), ['One', 'Two']);
  assert.equal(result.selection.focus.offset, 0);
  const parenthetical = docWith('parenthetical', '(quietly)');
  assert.equal(editableElements(editDocument(parenthetical, caret(parenthetical.elements[0].id, 9), { type: 'enter' }).document).at(-1).type, 'dialogue');
});
test('multi-element replacement, backwards selections, copy, merge and Unicode deletion', () => {
  const doc = createDocument({ elements: [createElement('action', 'First'), createElement('whitespace', '\n'), createElement('action', 'Second')] });
  const [a, b] = editableElements(doc);
  const selection = { anchor: { id: b.id, offset: 3 }, focus: { id: a.id, offset: 2 } };
  assert.equal(selectedText(doc, selection), 'rst\n\nSec');
  const result = editDocument(doc, selection, { type: 'insert', text: 'x' });
  assert.deepEqual(editableElements(result.document).map(el => el.text), ['Fixond']);
  assert.deepEqual(result.selection, caret(a.id, 3));
  const merged = editDocument(doc, caret(b.id), { type: 'backspace' });
  assert.equal(editableElements(merged.document)[0].text, 'FirstSecond');
  assert.deepEqual(merged.selection, caret(a.id, 5));
  const unicode = docWith('action', 'a🙂b');
  assert.equal(editDocument(unicode, caret(unicode.elements[0].id, 3), { type: 'backspace' }).document.elements[0].text, 'ab');
});
test('format and reverse Tab preserve caret; multi-element format preserves selection', () => {
  const doc = docWith('action', 'Here.');
  const selection = caret(doc.elements[0].id, 2);
  const formatted = editDocument(doc, selection, { type: 'format', elementType: 'scene' });
  assert.equal(formatted.document.elements[0].type, 'scene');
  assert.deepEqual(formatted.selection, selection);
  const tabbed = editDocument(doc, selection, { type: 'tab', reverse: true });
  assert.deepEqual(tabbed.document.elements[0], doc.elements[0]);
  assert.equal(editableElements(tabbed.document).at(-1).type, 'scene');
  const many = parseFountain('First.\n\nSecond.');
  const els = editableElements(many);
  const span = { anchor: { id: els[0].id, offset: 1 }, focus: { id: els[1].id, offset: 4 } };
  const changed = editDocument(many, span, { type: 'format', elementType: 'dialogue' });
  assert.ok(editableElements(changed.document).every(el => el.type === 'dialogue'));
  assert.deepEqual(changed.selection, span);
});
test('dual formatting links the second cue, including when formatting its speech', () => {
  const doc = parseFountain('NOAH\nHello.\n\nAVA\nHi.');
  const speech = editableElements(doc).at(-1);
  const changed = editDocument(doc, caret(speech.id, 2), { type: 'format', elementType: 'dualDialogue' });
  const groups = dialogueGroups(changed.document);
  assert.equal(groups[1].partnerId, groups[0].id);
  assert.equal(speech.text, 'Hi.');
});
test('parenthetical format adds brackets while preserving the caret relative to written text', () => {
  const doc = docWith('action', 'quietly'), id = doc.elements[0].id;
  const result = editDocument(doc, caret(id, 3), { type: 'format', elementType: 'parenthetical' });
  assert.equal(result.document.elements[0].text, '(quietly)');
  assert.deepEqual(result.selection, caret(id, 4));
});
test('plain paste splits paragraphs, preserves literal HTML and selected suffix', () => {
  const doc = docWith('action', 'Before After');
  const result = editDocument(doc, caret(doc.elements[0].id, 7), { type: 'paste', text: '<b>literal</b>\r\n\r\nNext' });
  assert.deepEqual(editableElements(result.document).map(el => el.text), ['Before <b>literal</b>', 'NextAfter']);
  assert.equal(result.selection.focus.offset, 4);
  assert.ok(serializeFountain(result.document, { canonical: true }).includes('<b>literal</b>'));
});
test('undo/redo restores content and caret; typing coalesces but movement and structural edits do not', () => {
  const doc = docWith(); const initial = caret(doc.elements[0].id);
  const history = new EditorHistory(doc, initial);
  history.apply(initial, { type: 'insert', text: 'H' }, 1000);
  history.apply(history.current.selection, { type: 'insert', text: 'i' }, 1100);
  assert.equal(history.past.length, 1);
  assert.equal(history.undo().document.elements[0].text, '');
  assert.deepEqual(history.current.selection, initial);
  assert.equal(history.redo().document.elements[0].text, 'Hi');
  history.apply(history.current.selection, { type: 'enter' }, 1200);
  assert.equal(editableElements(history.undo().document).length, 1);
  history.apply(caret(doc.elements[0].id, 0), { type: 'insert', text: 'A' }, 1300);
  assert.equal(history.future.length, 0);
  assert.equal(history.current.document.elements[0].text, 'AHi');
});
test('structural edits on imported documents export with safe canonical boundaries', () => {
  const doc = parseFountain('INT. ROOM - DAY\n\nA sentence.');
  const el = editableElements(doc).at(-1);
  let result = editDocument(doc, caret(el.id, 2), { type: 'enter' });
  const output = serializeFountain(result.document, { canonical: true });
  assert.deepEqual(editableElements(parseFountain(output)).map(el => [el.type, el.text]), editableElements(result.document).map(el => [el.type, el.text]));
});

test('Tab replaces only blank lines and preserves filled lines above the new element', () => {
  for (const [from, text, offset, to, blank] of [
    ['dialogue', '', 0, 'parenthetical', true],
    ['dialogue', '  ', 1, 'parenthetical', true],
    ['parenthetical', '()', 1, 'dialogue', true],
    ['parenthetical', '(quietly)', 4, 'dialogue', false],
    ['character', 'NOAH', 4, 'parenthetical', false],
    ['character', '', 0, 'transition', true],
    ['character', '  ', 1, 'transition', true],
  ]) {
    const doc = docWith(from, text), id = doc.elements[0].id;
    const result = editDocument(doc, caret(id, offset), { type: 'tab' });
    const elements = editableElements(result.document), added = elements.at(-1);
    assert.equal(added.type, to, `${from}: ${text}`);
    assert.equal(added.text, to === 'parenthetical' ? '()' : '');
    assert.deepEqual(result.selection, caret(added.id, to === 'parenthetical' ? 1 : 0));
    if (blank) assert.equal(added.id, id);
    else assert.deepEqual(elements[0], doc.elements[0]);
  }
});
test('Enter always starts dialogue after a character, including an empty character', () => {
  for (const text of ['', 'NOAH']) {
    const doc = docWith('character', text);
    const result = editDocument(doc, caret(doc.elements[0].id, text.length), { type: 'enter' });
    assert.equal(editableElements(result.document).at(-1).type, 'dialogue');
    assert.equal(result.selection.focus.offset, 0);
  }
});
test('Tab on the empty line after speech retains the preceding dialogue', () => {
  const doc = parseFountain('NOAH\nHello.'); const speech = editableElements(doc).at(-1);
  const entered = editDocument(doc, caret(speech.id, speech.text.length), { type: 'insert', text: '\n' });
  const result = editDocument(entered.document, entered.selection, { type: 'tab' });
  assert.deepEqual(editableElements(result.document).map(el => [el.type, el.text]), [['character', 'NOAH'], ['dialogue', 'Hello.\n'], ['parenthetical', '()']]);
  assert.equal(result.selection.focus.offset, 1);
  assert.equal(editableElements(result.document)[1].id, speech.id);
  assert.doesNotThrow(() => fountainForSaving(result.document));
});
test('typing INT. or EXT. recognizes a scene immediately without moving the caret or changing case', () => {
  for (const prefix of ['int.', 'ext.', 'InT.', 'EXT.']) {
    const doc = docWith('action', prefix.slice(0, -1)), id = doc.elements[0].id;
    const result = editDocument(doc, caret(id, 3), { type: 'insert', text: '.' });
    assert.equal(result.document.elements[0].type, 'scene');
    assert.equal(result.document.elements[0].text, prefix);
    assert.deepEqual(result.selection, caret(id, 4));
    assert.doesNotThrow(() => serializeFountain(result.document, { canonical: true }));
  }
});
test('automatic scene detection preserves neighboring action lines and supports undo', () => {
  const doc = docWith('action', 'Before.\nint\nAfter.'), id = doc.elements[0].id;
  const history = new EditorHistory(doc, caret(id, 11));
  const result = history.apply(caret(id, 11), { type: 'insert', text: '.' });
  assert.deepEqual(editableElements(result.document).map(el => [el.type, el.text]), [['action', 'Before.'], ['scene', 'int.'], ['action', 'After.']]);
  assert.equal(result.selection.focus.offset, 4);
  assert.equal(history.undo().document.elements[0].text, doc.elements[0].text);
});
test('spoken prefixes and manual Action overrides do not get reclassified unexpectedly', () => {
  const speech = docWith('dialogue', 'int');
  assert.equal(editDocument(speech, caret(speech.elements[0].id, 3), { type: 'insert', text: '.' }).document.elements[0].type, 'dialogue');
  const forcedAction = docWith('action', 'INT.');
  assert.equal(editDocument(forcedAction, caret(forcedAction.elements[0].id, 4), { type: 'insert', text: ' ROOM' }).document.elements[0].type, 'action');
});

test('Tab preserves filled lines while Return replaces the selection and splits every type', () => {
  for (const type of ['action', 'scene', 'character', 'dialogue', 'parenthetical', 'transition']) {
    const doc = docWith(type, type === 'parenthetical' ? '(quietly)' : 'Filled line');
    const id = doc.elements[0].id;
    for (const command of [{ type: 'enter' }, { type: 'tab' }, { type: 'tab', reverse: true }]) {
      const result = editDocument(doc, { anchor: { id, offset: 1 }, focus: { id, offset: 3 } }, command);
      if (command.type === 'enter') assert.deepEqual(editableElements(result.document).map(e => e.text), type === 'parenthetical'
        ? ['()',doc.elements[0].text.slice(3,-1)] : [doc.elements[0].text.slice(0,1),doc.elements[0].text.slice(3)]);
      else assert.deepEqual(result.document.elements[0], doc.elements[0]);
      assert.equal(editableElements(result.document).length, 2);
      assert.notEqual(result.selection.focus.id, id);
    }
  }
});
test('deleting the contents of a parenthetical clears its automatic brackets and supports undo', () => {
  for (const command of ['backspace', 'delete', 'insert']) {
    const doc = docWith('parenthetical', '(quietly)'), id = doc.elements[0].id;
    const selection = { anchor: { id, offset: 1 }, focus: { id, offset: 8 } };
    const history = new EditorHistory(doc, selection);
    const result = history.apply(selection, { type: command, text: '' });
    assert.equal(result.document.elements[0].text, '');
    assert.deepEqual(result.selection, caret(id));
    assert.equal(history.undo().document.elements[0].text, '(quietly)');
  }
  const doc = docWith('parenthetical', '(x)'), id = doc.elements[0].id;
  const erased = editDocument(doc, caret(id, 2), { type: 'backspace' });
  assert.equal(erased.document.elements[0].text, '');
  const retyped = editDocument(erased.document, erased.selection, { type: 'insert', text: 'new' });
  assert.equal(retyped.document.elements[0].text, '(new)');
  assert.deepEqual(retyped.selection, caret(id, 4));
});
test('character typing, pasting and formatting capitalize model text with Unicode-safe caret offsets', () => {
  const doc = docWith('character', ''), id = doc.elements[0].id;
  const typed = editDocument(doc, caret(id), { type: 'insert', text: 'straße' });
  assert.equal(typed.document.elements[0].text, 'STRASSE');
  assert.deepEqual(typed.selection, caret(id, 7));
  const pasted = editDocument(doc, caret(id), { type: 'paste', text: 'noah (v.o.)' });
  assert.equal(pasted.document.elements[0].text, 'NOAH (V.O.)');
  const action = docWith('action', 'ava'), aid = action.elements[0].id;
  const formatted = editDocument(action, caret(aid, 2), { type: 'format', elementType: 'character' });
  assert.equal(formatted.document.elements[0].text, 'AVA');
  assert.deepEqual(formatted.selection, caret(aid, 2));
});

test('typed logical lines capitalize their first letter with punctuation and Unicode, preserving middle edits and paste', () => {
  const doc = docWith('action', ''), id = doc.elements[0].id;
  let result = editDocument(doc, caret(id), { type: 'insert', text: '...élise arrives.\n  another line.' });
  assert.equal(result.document.elements[0].text, '...Élise arrives.\n  Another line.');
  assert.equal(result.selection.focus.offset, result.document.elements[0].text.length);
  result = editDocument(doc, caret(id), { type: 'insert', text: 'ß' });
  assert.equal(result.document.elements[0].text, 'SS'); assert.equal(result.selection.focus.offset, 2);
  const middle = docWith('action', 'A  room');
  assert.equal(editDocument(middle, caret(middle.elements[0].id, 2), { type: 'insert', text: 'quiet' }).document.elements[0].text, 'A quiet room');
  assert.equal(editDocument(doc, caret(id), { type: 'paste', text: 'preserve pasted case' }).document.elements[0].text, 'preserve pasted case');
});

test('common-word autocorrection adjusts caret, preserves character names and remains undoable', () => {
  for (const [typo, expected] of [['teh ', 'The '], ['recieve.', 'Receive.'], ['wierd!', 'Weird!']]) {
    const doc = docWith('action', ''), id = doc.elements[0].id;
    const history = new EditorHistory(doc, caret(id));
    const result = history.apply(caret(id), { type: 'insert', text: typo });
    assert.equal(result.document.elements[0].text, expected);
    assert.equal(result.selection.focus.offset, expected.length);
    assert.equal(history.undo().document.elements[0].text, '');
  }
  const doc = docWith('character', '');
  assert.equal(editDocument(doc, caret(doc.elements[0].id), { type: 'insert', text: 'teh ' }).document.elements[0].text, 'TEH ');
});

test('Enter recognizes only an exact previously speaking character and starts dialogue in one undo step', () => {
  const doc = parseFountain('NOAH (V.O.)\nHello.\n\n!noah');
  const action = editableElements(doc).at(-1), history = new EditorHistory(doc, caret(action.id, action.text.length));
  const result = history.apply(history.current.selection, { type: 'enter' });
  assert.equal(result.document.elements.find(el => el.id === action.id).type, 'character');
  assert.equal(result.document.elements.find(el => el.id === action.id).text, 'NOAH');
  assert.equal(editableElements(result.document).at(-1).type, 'dialogue');
  assert.equal(result.selection.focus.offset, 0);
  assert.deepEqual(history.undo().document, doc);
  for (const text of ['Noah walks in.', 'Unknown', 'Noah\nAnother line']) {
    const el = createElement('action', text); const candidate = { ...doc, elements: [...doc.elements.slice(0, -1), el] };
    const changed = editDocument(candidate, caret(el.id, text.length), { type: 'enter' });
    assert.equal(changed.document.elements.find(item => item.id === el.id).type, 'action');
  }
  const cueOnly = parseFountain('@NOAH\n\n!Noah'); const el = editableElements(cueOnly).at(-1);
  assert.equal(editDocument(cueOnly, caret(el.id, 4), { type: 'enter' }).document.elements.find(item => item.id === el.id).type, 'action');
});

test('Return inside a multiline Action preserves its type and exact text; end-of-element autocorrect remains', () => {
  const doc = parseFountain('NOAH\nHello.\n\n!The room is still.\nnoah\nThe light flickers.');
  const el = editableElements(doc).at(-1);
  const result = editDocument(doc, caret(el.id, 'The room is still.\nnoah'.length), { type: 'enter' });
  assert.deepEqual(editableElements(result.document).slice(-2).map(el => [el.type, el.text]), [
    ['action', 'The room is still.\nnoah'], ['action', '\nThe light flickers.']
  ]);
  const typo = docWith('action', 'Teh'), id = typo.elements[0].id;
  assert.equal(editDocument(typo, caret(id, 3), { type: 'enter' }).document.elements[0].text, 'The');
});

test('common typed transitions automatically format and capitalize without moving the caret', () => {
  for (const text of ['fade in:', 'cut to:', 'dissolve to:', 'fade to black.', 'fade out.', 'smash cut to:']) {
    const doc = docWith('action', ''), id = doc.elements[0].id;
    const result = editDocument(doc, caret(id), { type: 'insert', text });
    assert.equal(result.document.elements[0].type, 'transition');
    assert.equal(result.document.elements[0].text, text.toUpperCase());
    assert.deepEqual(result.selection, caret(id, text.length));
    assert.doesNotThrow(() => serializeFountain(result.document, { canonical: true }));
  }
  const speech = docWith('dialogue', '');
  assert.equal(editDocument(speech, caret(speech.elements[0].id), { type: 'insert', text: 'cut to:' }).document.elements[0].type, 'dialogue');
});

for(const position of ['beginning','middle','end'])test(`Action Return splits at the ${position}, preserving text, IDs, margin and undo`,()=>{
 const text='Luke walks into the bedroom and closes the door behind him.',doc=docWith('action',text),el=doc.elements[0];el.rightMarginOffsetPt=15;
 const offset=position==='beginning'?0:position==='end'?text.length:text.indexOf('and');const history=new EditorHistory(doc,caret(el.id,offset));
 const result=history.apply(history.current.selection,{type:'enter'}),actions=editableElements(result.document);
 assert.deepEqual(actions.map(e=>[e.type,e.text]),[['action',text.slice(0,offset)],['action',text.slice(offset)]]);
 assert.equal(actions[0].id,el.id);assert.notEqual(actions[1].id,el.id);assert.equal(actions[1].rightMarginOffsetPt,15);assert.deepEqual(result.selection,caret(actions[1].id));
 assert.equal(actions.map(e=>e.text).join(''),text);assert.deepEqual(history.undo().document,doc);assert.deepEqual(history.redo().document,result.document);
 if(position==='middle')assert.deepEqual(parseFountain(fountainForSaving(result.document)).elements.filter(e=>e.type==='action').map(e=>e.text),[text.slice(0,offset),text.slice(offset)]);
 const soft=editDocument(doc,caret(el.id,offset),{type:'lineBreak'});assert.equal(editableElements(soft.document).length,1);assert.equal(soft.document.elements[0].text,text.slice(0,offset)+'\n'+text.slice(offset));
});
