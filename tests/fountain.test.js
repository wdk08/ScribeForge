import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseFountain, serializeFountain, parseInline } from '../js/fountain.js';
import { createDocument, createElement, updateElement, meaningfulContent, dialogueGroups } from '../js/document.js';

const elements = text => parseFountain(text).elements.filter(el => el.type !== 'whitespace');
const types = text => elements(text).map(el => el.type);
const fixture = await readFile(new URL('./fixtures/complex.fountain', import.meta.url), 'utf8');

test('complex fixture: semantic and exact source round trips', () => {
  const doc = parseFountain(fixture);
  assert.equal(serializeFountain(doc), fixture);
  assert.deepEqual(meaningfulContent(parseFountain(serializeFountain(doc))), meaningfulContent(doc));
  for (const type of ['titleField', 'scene', 'action', 'character', 'dialogue', 'parenthetical', 'transition', 'centered', 'lyric', 'section', 'synopsis', 'note', 'boneyard', 'pageBreak']) {
    assert.ok(doc.elements.some(el => el.type === type), type);
  }
  assert.equal(doc.elements.find(el => el.type === 'scene').sceneNumber, '1A');
  assert.ok(doc.elements.find(el => el.type === 'action').text.includes('    An indented'));
});

test('scene heading prefixes, case, blank boundaries, forced scenes and ellipses', () => {
  for (const prefix of ['INT.', 'ext.', 'EST ', 'INT./EXT.', 'INT/EXT ', 'I/E.']) {
    assert.equal(elements(`${prefix} ROOM - DAY\n\nAction.`)[0].type, 'scene');
  }
  assert.deepEqual(types('.Anywhere\n\n...a pause'), ['scene', 'action']);
  assert.equal(elements('int. room\nAction.')[0].type, 'action');
  assert.equal(elements('Before.\nINT. ROOM\n\nAfter.')[0].type, 'action');
});

test('dialogue, extensions, numeric action, multilingual forced cues and parentheticals', () => {
  assert.deepEqual(types('NOAH (on radio)\nFirst.\nSecond.\n(a beat)\nLast.'), ['character', 'dialogue', 'parenthetical', 'dialogue']);
  assert.deepEqual(types('23\nA number.'), ['action']);
  assert.deepEqual(types('@小明\n你好。'), ['character', 'dialogue']);
  assert.deepEqual(types('!LOUD ACTION\nAnother line.'), ['action']);
  assert.equal(elements('NOAH\nFirst.\n  \nSecond.')[1].text, 'First.\n\nSecond.');
});

test('dual dialogue exposes two adjacent blocks with multiline speech', () => {
  const doc = parseFountain("NOAH\nI'm coming!\nAnother line.\n\nAVA    ^\n(urgent)\nHurry up!");
  const groups = dialogueGroups(doc);
  assert.equal(groups.length, 2);
  assert.equal(groups[1].partnerId, groups[0].id);
  assert.equal(groups[1].elements[0].type, 'parenthetical');
  assert.equal(groups[0].elements[0].text, "I'm coming!\nAnother line.");
  assert.ok(serializeFountain(doc).includes('AVA    ^'));
  const separated = dialogueGroups(parseFountain('A\nHi.\n\nAction.\n\nB ^\nBye.'));
  assert.equal(separated[1].partnerId, undefined);
});

test('transition disambiguation preserves trailing spaces', () => {
  assert.deepEqual(types('CUT TO:\n\nAction.'), ['transition', 'action']);
  assert.equal(elements('CUT TO: \n\nAction.')[0].type, 'action');
  assert.deepEqual(types('>Fade to black.\n\n> THE END <'), ['transition', 'centered']);
});

test('title keys, continuation values, and unknown metadata survive', () => {
  const doc = parseFountain('Title:\n    A Film\n    A Subtitle\nAuthors: One\n    Two\nUnknown: Value\n\nAction.');
  assert.equal(doc.title, 'A Film\nA Subtitle');
  assert.equal(doc.elements[1].text, 'One\nTwo');
  assert.equal(doc.elements[2].key, 'Unknown');
  assert.equal(elements('He says: hello\nUnindented action.')[0].type, 'action');
});

test('hidden syntax is preserved and cannot be interpreted as speech', () => {
  assert.deepEqual(types('/*\nNOAH\nSecret.\n*/\n\nAction.'), ['boneyard', 'action']);
  assert.deepEqual(types('[[NOAH\nA note.]]\n\nAction.'), ['note', 'action']);
  const inline = elements('He /* does not\nactually */ leave.')[0];
  assert.equal(inline.type, 'action');
  assert.ok(inline.text.includes('/*'));
  const malformed = parseFountain('/* missing closure\n\nAction.');
  assert.equal(malformed.diagnostics[0].code, 'unclosed-markup');
  assert.equal(serializeFountain(malformed), '/* missing closure\n\nAction.');
  assert.equal(elements('[[not closed\n\nLater.]]')[0].type, 'action');
});

test('emphasis nests, escapes remain literal, notes stay distinct, no HTML parsing', () => {
  assert.deepEqual(parseInline('_an *italic* word_'), [{ type: 'underline', children: [{ type: 'text', text: 'an ' }, { type: 'italic', children: [{ type: 'text', text: 'italic' }] }, { type: 'text', text: ' word' }] }]);
  assert.equal(parseInline('***strong***')[0].type, 'boldItalic');
  assert.equal(parseInline('**bold**')[0].type, 'bold');
  assert.equal(parseInline('**bold *italic***')[0].children[1].type, 'italic');
  assert.equal(parseInline('_**bold italic**_')[0].children[0].type, 'bold');
  assert.deepEqual(parseInline('\\*literal\\* <script>'), [{ type: 'text', text: '*literal* <script>' }]);
  assert.deepEqual(parseInline('*open\nclose*'), [{ type: 'text', text: '*open\nclose*' }]);
  assert.equal(parseInline('Hello [[private]]!')[1].type, 'note');
});

test('BOM, CRLF, CR, tabs, blank lines, Unicode and missing final newline are lossless', () => {
  for (const source of ['', '\n\n', '\uFEFFTitle: Test\r\n\r\n!Action\r\n\r\n', '!Tab\ttext\r\r...é🙂', 'NOAH\nHi.\n  \nBye.', '\uFEFF']) {
    assert.equal(serializeFountain(parseFountain(source)), source);
  }
});

test('pure edits retain IDs, leave original untouched and serialize changed content', () => {
  const original = parseFountain('INT. ROOM - DAY #2#\n\nAn action.\n\nNOAH\nHello.\n');
  const action = original.elements.find(el => el.type === 'action');
  const edited = updateElement(original, action.id, { text: 'ALL CAPS\nStill action.' });
  assert.equal(original.elements.find(el => el.id === action.id).text, 'An action.');
  assert.equal(edited.id, original.id);
  const exported = serializeFountain(edited);
  assert.ok(exported.includes('!ALL CAPS\nStill action.'));
  assert.deepEqual(meaningfulContent(parseFountain(exported)), meaningfulContent(edited));
  assert.deepEqual(meaningfulContent(JSON.parse(JSON.stringify(edited))), meaningfulContent(edited));
});

test('new structured documents serialize and reparse without DOM dependencies', () => {
  const doc = createDocument({ elements: [
    createElement('titleField', 'A Film', { key: 'Title' }),
    createElement('scene', 'INT. ROOM - DAY'),
    createElement('action', 'Someone arrives.'),
    createElement('character', 'McClane'),
    createElement('parenthetical', '(quietly)'),
    createElement('dialogue', 'Hello.'),
    createElement('character', 'Ava', { dual: true }),
    createElement('dialogue', 'Goodbye.'),
  ] });
  assert.deepEqual(meaningfulContent(parseFountain(serializeFountain(doc))), meaningfulContent(doc));
});

test('edited dialogue preserves intentional empty speech lines and hidden notes', () => {
  const doc = parseFountain('NOAH\nHello.\n  \nGoodbye. [[Private note]]\n');
  const speech = doc.elements.find(el => el.type === 'dialogue');
  const edited = updateElement(doc, speech.id, { text: speech.text.replace('Hello.', 'Welcome.') });
  const source = serializeFountain(edited);
  assert.ok(source.includes('\n  \n'));
  assert.ok(source.includes('[[Private note]]'));
  assert.deepEqual(meaningfulContent(parseFountain(source)), meaningfulContent(edited));
});

test('scene numbers, sections, title values and dual flags can be edited safely', () => {
  let doc = parseFountain(fixture);
  const scene = doc.elements.find(el => el.type === 'scene');
  doc = updateElement(doc, scene.id, { sceneNumber: '2B' });
  const section = doc.elements.find(el => el.type === 'section');
  doc = updateElement(doc, section.id, { depth: 3 });
  const title = doc.elements.find(el => el.key === 'Title');
  doc = updateElement(doc, title.id, { text: 'New title\nSubtitle' });
  const character = doc.elements.find(el => el.dual);
  doc = updateElement(doc, character.id, { dual: false });
  assert.deepEqual(meaningfulContent(parseFountain(serializeFountain(doc))), meaningfulContent(doc));
});

test('unsafe structural exports and invalid models fail without mutation', () => {
  const doc = parseFountain('NOAH\nHello.');
  const edited = updateElement(doc, doc.elements[1].id, { text: 'Hi.\n\nAn accidental action.' });
  const snapshot = JSON.stringify(edited);
  assert.deepEqual(meaningfulContent(parseFountain(serializeFountain(edited))),meaningfulContent(edited));
  const ambiguous = updateElement(doc,doc.elements[1].id,{text:'Hi.\n(An actual parenthetical)'});
  assert.throws(() => serializeFountain(ambiguous), /without changing its meaning/);
  assert.equal(JSON.stringify(edited), snapshot);
  assert.throws(() => updateElement(doc, 'missing', {}), /not found/);
  assert.throws(() => createElement('unsupported'), /Unknown/);
  assert.throws(() => parseFountain(null), /string/);
  assert.throws(() => createDocument({ elements: [createElement('section', 'Act', { depth: -1 })] }), /depth/);
});

test('feature-length input remains complete through round trip', () => {
  const source = Array.from({ length: 400 }, (_, i) => `INT. ROOM - DAY #${i + 1}#\n\nA long paragraph with *emphasis*.\nAnother line.\n\nNOAH\nHello ${i}.\n\n`).join('');
  const doc = parseFountain(source);
  assert.equal(doc.elements.filter(el => el.type === 'scene').length, 400);
  assert.equal(serializeFountain(doc), source);
});

test('canonical separators retain LF, CRLF and CR output, including split CRLF whitespace fragments', () => {
  for (const newline of ['\n', '\r\n', '\r']) {
    const doc = createDocument({ elements: [createElement('scene', 'INT. ROOM - DAY'), createElement('action', 'The room is quiet.'), createElement('character', 'NOAH'), createElement('parenthetical', '(softly)'), createElement('dialogue', 'Hello.')] });
    doc.source = { newline, bom: '\uFEFF' };
    const output = serializeFountain(doc, { canonical: true }); assert.equal(output, `\uFEFF.INT. ROOM - DAY${newline}${newline}!The room is quiet.${newline}${newline}@NOAH${newline}(softly)${newline}Hello.${newline}`);
    const split = createDocument({ elements: [createElement('scene', 'INT. ROOM - DAY'), createElement('whitespace', '\r'), createElement('whitespace', '\n'), createElement('action', 'A room.')] }); split.source = { newline: '\r\n' };
    assert.equal(serializeFountain(split, { canonical: true }), '.INT. ROOM - DAY\r\n\r\n!A room.\r\n');
  }
});
