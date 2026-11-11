import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFountain, serializeFountain } from '../js/fountain.js';
import { createElement } from '../js/document.js';
import { automaticContinuations, continuedCue } from '../js/continuations.js';
import { characterIdentity, buildTableRead } from '../js/table-read-model.js';
import { detectedCharacters } from '../js/characters.js';
import { EditorHistory, caret } from '../js/editing.js';
import { layoutUnits, paginate } from '../js/pagination.js';
const resumed = interruption => parseFountain(`INT. HOUSE - NIGHT\n\nTYLER\nAre you okay?\n\n${interruption}\n\nTYLER\nI am trying to help.`);
for (const [label, interruption] of [['Action', '!Tess looks away.'], ['Transition', '>CUT TO:'], ['Centered', '>A MOMENT PASSES<'], ['explicit page break', '===']]) test(`same speaker after ${label} derives one continuation without model changes`, () => {
  const doc = resumed(interruption), snapshot = structuredClone(doc), cues = doc.elements.filter(el => el.type === 'character');
  assert.deepEqual([...automaticContinuations(doc)], [cues[1].id]);
  assert.equal(continuedCue(cues[1].text), "TYLER (CONT'D)");
  assert.deepEqual(doc, snapshot);
  assert.equal(serializeFountain(doc), serializeFountain(snapshot));
});
for (const [label, source] of [
  ['another speaking character', 'TYLER\nHello.\n\nTESS\nHello.\n\n!Tess looks away.\n\nTYLER\nAgain.'],
  ['scene boundary', 'INT. HOUSE - NIGHT\n\nTYLER\nGoodnight.\n\n!He turns.\n\nEXT. HOUSE - NIGHT\n\nTYLER\nTomorrow.'],
  ['no interruption', 'TYLER\nHello.\n\nTYLER\nAgain.'],
  ['blank drafting action', 'TYLER\nHello.\n\nTYLER\nAgain.'],
  ['only annotations', 'TYLER\nHello.\n\n[[a note]]\n\nTYLER\nAgain.'],
]) test(`no generated continuation for ${label}`, () => {
  const doc = parseFountain(source);
  if (label === 'blank drafting action') doc.elements.splice(3, 0, createElement('action', ''));
  assert.equal(automaticContinuations(doc).size, 0);
});
for (const cue of ["TYLER (CONT'D)", 'TYLER (CONT’D)', "TYLER (V.O.) (CONT'D)", 'TYLER (O.S.) (CONTINUED)']) test(`explicit extension is preserved without duplicate: ${cue}`, () => {
  const source = `TYLER\nHello.\n\n!He sits.\n\n@${cue}\nAgain.`;
  const doc = parseFountain(source);
  assert.equal(automaticContinuations(doc).size, 0); assert.equal(continuedCue(cue), cue);
  assert.equal(serializeFountain(doc), source);
});
for (const extension of ['V.O.', 'O.S.']) test(`other extensions survive derived continuation: ${extension}`, () => {
  const doc = parseFountain(`TYLER (${extension})\nHello.\n\n!He sits.\n\nTYLER (${extension})\nAgain.`);
  const last = doc.elements.filter(el => el.type === 'character').at(-1);
  assert.ok(automaticContinuations(doc).has(last.id));
  assert.equal(continuedCue(last.text), `TYLER (${extension}) (CONT'D)`);
});
test('continuations follow editing, clearing/deleting interruptions, undo and redo with no separate history entries', () => {
  const doc = parseFountain('TYLER\nHello.\n\nTYLER\nAgain.');
  const speech = doc.elements.find(el => el.type === 'dialogue'), history = new EditorHistory(doc, caret(speech.id, speech.text.length));
  const entered = history.apply(history.current.selection, { type: 'enter' });
  assert.equal(automaticContinuations(entered.document).size, 0);
  const typed = history.apply(entered.selection, { type: 'insert', text: 'Tess looks away.' });
  assert.equal(automaticContinuations(typed.document).size, 1); assert.equal(history.past.length, 2);
  assert.equal(automaticContinuations(history.undo().document).size, 0);
  assert.equal(automaticContinuations(history.redo().document).size, 1);
  const without = structuredClone(typed.document); without.elements = without.elements.filter(el => el.id !== entered.selection.focus.id);
  assert.equal(automaticContinuations(without).size, 0);
});
test('an intervening speaking character removes the automatic indicator; Table Read and rename identities stay stable', () => {
  const doc = resumed('!Tess looks away.'), before = structuredClone(doc), table = buildTableRead(doc);
  assert.equal(automaticContinuations(doc).size, 1);
  assert.deepEqual(detectedCharacters(doc).map(el => el.name), ['TYLER']);
  assert.equal(characterIdentity(continuedCue('TYLER (V.O.)')).id, characterIdentity('TYLER').id);
  assert.deepEqual(buildTableRead(doc), table); assert.deepEqual(doc, before);
  const lastCue = doc.elements.findLastIndex(el => el.type === 'character');
  const changed = structuredClone(doc);
  changed.elements.splice(lastCue, 0, createElement('character', 'TESS'), createElement('dialogue', 'I am fine.'), createElement('whitespace', '\n'));
  assert.equal(automaticContinuations(changed).size, 0);
});
test('derived suffix is measured and paginated while caret offsets remain within original cue text', () => {
  const doc = resumed('!Tess looks away.'), snapshot = structuredClone(doc), measured = [];
  const units = layoutUnits(doc, el => {
    measured.push(el.text);
    return Array.from({ length: Math.max(1, Math.ceil(el.text.length / 10)) }, (_, i) => ({ start: i * 10, end: Math.min(el.text.length, (i + 1) * 10) }));
  });
  assert.ok(measured.includes("TYLER (CONT'D)"));
  const cue = doc.elements.filter(el => el.type === 'character').at(-1), lines = units.flatMap(unit => unit.columns?.flat() ?? []).filter(line => line.id === cue.id);
  assert.ok(lines.every(line => line.start <= cue.text.length && line.end <= cue.text.length));
  assert.equal(lines.map(line => line.displayText).join(''), "TYLER (CONT'D)");
  assert.equal(lines.map(line => line.continuationText).join(''), " (CONT'D)");
  assert.ok(paginate(units, { contentHeight: 160 }).every(page => page.used <= 160));
  assert.deepEqual(doc, snapshot);
});
test('Fountain round trip recreates automatic indicators without adding them to saved names', () => {
  const doc = resumed('!Tess looks away.'), output = serializeFountain(doc);
  assert.equal(automaticContinuations(parseFountain(output)).size, 1);
  assert.doesNotMatch(output, /CONT/);
});
test('dual-dialogue cues do not gain a sequential continuation', () => {
  const doc = parseFountain('TYLER\nHello.\n\n!He turns.\n\nTYLER\nAgain.\n\nTESS ^\nWait.');
  assert.equal(automaticContinuations(doc).size, 0);
});
