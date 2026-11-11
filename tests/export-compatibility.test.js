import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, createElement, meaningfulContent } from '../js/document.js';
import { parseFountain } from '../js/fountain.js';
import { fountainForSaving } from '../js/session.js';
import { titleContactLayout } from '../js/title-page.js';

export function exportFixture() {
  return createDocument({ elements: [
    createElement('transition', 'FADE IN:'), createElement('scene', 'Int. house - night'),
    createElement('action', 'Morgan and Casey inspect a radio.'),
    createElement('character', 'CASEY'), createElement('dialogue', 'Can you hear it?'),
    createElement('action', 'Morgan looks over.'),
    createElement('character', 'MORGAN (V.O.)', { continuation: 'off' }), createElement('parenthetical', '(quietly)'), createElement('dialogue', 'I hear it too.'),
    createElement('action', 'Morgan turns a dial.'),
    createElement('character', 'MORGAN (O.S.)', { continuation: 'on' }), createElement('dialogue', 'There it is... I hear a signal.'),
    createElement('action', 'He waits.'), createElement('character', 'MORGAN'), createElement('dialogue', 'Still here.'),
    createElement('scene', 'Ext. house - night'), createElement('transition', 'CUT TO:'),
  ] });
}
test('portable Fountain contains effective cue text and uppercase headings, not internal override metadata', () => {
  const doc = exportFixture(), before = structuredClone(doc), output = fountainForSaving(doc), parsed = parseFountain(output);
  assert.doesNotMatch(output, /ScriptForge|continuations v1|"state"|"index"|"text"|\[\{/);
  assert.deepEqual(doc, before);
  assert.deepEqual(parsed.elements.filter(el => el.type === 'character').map(el => el.text), ['CASEY', 'MORGAN (V.O.)', "MORGAN (O.S.) (CONT'D)", "MORGAN (CONT'D)"]);
  assert.deepEqual(parsed.elements.filter(el => el.type === 'scene').map(el => el.text), ['INT. HOUSE - NIGHT', 'EXT. HOUSE - NIGHT']);
  const expected = meaningfulContent(doc).map(el => ({ ...el, ...(el.type === 'scene' ? { text: el.text.toUpperCase() } : {}) }));
  expected[10].text = "MORGAN (O.S.) (CONT'D)"; expected[13].text = "MORGAN (CONT'D)";
  assert.deepEqual(meaningfulContent(parsed), expected);
  assert.match(output, /FADE IN:\n\n\.INT\. HOUSE - NIGHT\n\n!Morgan/);
  assert.match(output, /@MORGAN \(V\.O\.\)\n\(quietly\)\nI hear it too\.\n\n!Morgan turns a dial\./);
  assert.equal((output.match(/CONT'D/g) ?? []).length, 2);
});
test('Forced Off strips explicit continuations while preserving every other extension; Forced On never duplicates', () => {
  for (const text of ["ANN (V.O.) (CONT'D) (O.S.)", 'ANN (CONT’D) (O.C.)', 'ANN (CONTINUED) (on phone)']) {
    for (const state of ['on', 'off']) {
      const doc = createDocument({ elements: [createElement('character', text, { continuation: state }), createElement('dialogue', 'Hello.')] });
      const result = parseFountain(fountainForSaving(doc)).elements.find(el => el.type === 'character').text;
      assert.equal((result.match(/\(CONT(?:['’]D|INUED)\)/gi) ?? []).length, state === 'on' ? 1 : 0);
      for (const extension of text.match(/\((?!CONT)[^)]*\)/gi) ?? []) assert.ok(result.includes(extension));
    }
  }
});
test('legacy metadata can be read but is never re-exported; internal snapshots retain overrides', () => {
  const source = '@MORGAN\nHello.\n\n!He turns.\n\n@MORGAN\nAgain.\n';
  const legacy = source + '\n/* ScriptForge continuations v1\n[{"index":0,"text":"MORGAN","state":"on"},{"index":1,"text":"MORGAN","state":"off"}]\n*/\n';
  const doc = parseFountain(legacy), savedInternal = structuredClone(doc), output = fountainForSaving(doc);
  assert.deepEqual(doc.elements.filter(el => el.type === 'character').map(el => el.continuation), ['on', 'off']);
  assert.deepEqual(savedInternal, doc); assert.doesNotMatch(output, /ScriptForge|state|index/);
  assert.deepEqual(parseFountain(output).elements.filter(el => el.type === 'character').map(el => el.text), ["MORGAN (CONT'D)", 'MORGAN']);
  assert.equal(fountainForSaving(doc), output);
});
test('contact layout has one shared left origin and constant line spacing at editor/PDF scale', () => {
  assert.deepEqual(titleContactLayout(), { x: 96, bottom: 956, width: 320, lineHeight: 20, lines: [''] });
  assert.deepEqual(titleContactLayout(816, 1056, .75), { x: 72, bottom: 717, width: 240, lineHeight: 15, lines: [''] });
});

test('contact width grows toward the right for ordinary email and caps at page margins', () => {
 const email='screenwriter.longname@example.com', layout=titleContactLayout(816,1056,1,email);
 assert.deepEqual(layout.lines,[email]); assert.equal(layout.x,96);assert.ok(layout.x+layout.width<=720); assert.ok(layout.x>=96);
 const long='x'.repeat(200)+'@example.com', wrapped=titleContactLayout(816,1056,1,long);
 assert.equal(wrapped.width,624);assert.equal(wrapped.x,96);assert.equal(wrapped.lines.join(''),long);
});
