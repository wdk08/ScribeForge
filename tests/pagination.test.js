import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFountain } from '../js/fountain.js';
import { layoutUnits, paginate, PAGE } from '../js/pagination.js';
const lines = (id, count, type = 'action') => Array.from({ length: count }, (_, n) => ({ id, type, start: n * 10, end: (n + 1) * 10, height: 16 }));
const unit = (id, count, type = 'action', gap = 0) => ({ kind: 'single', type, gap, columns: [lines(id, count, type)], keep: type === 'character' ? 3 : 1 });
const pages = units => paginate(units, { contentHeight: 160 });

test('long action fills pages without overflow or lost line ranges', () => {
  const result = pages([unit('a', 37)]);
  assert.deepEqual(result.map(page => page.used), [160, 160, 160, 112]);
  assert.deepEqual(result.flatMap(page => page.items.flatMap(item => item.columns[0])), lines('a', 37));
});
test('deleting content reflows earlier pages; pagination never changes units', () => {
  const units = [unit('a', 17), unit('b', 7)];
  const snapshot = JSON.stringify(units);
  assert.equal(pages(units).length, 3);
  assert.equal(JSON.stringify(units), snapshot);
  assert.equal(pages([unit('a', 3), unit('b', 7)]).length, 1);
});
test('scene headings and first action lines stay together at a page boundary', () => {
  const result = pages([unit('a', 9), unit('scene', 1, 'scene'), unit('next', 4)]);
  assert.equal(result[0].items.length, 1);
  assert.equal(result[1].items[0].columns[0][0].id, 'scene');
});
test('character and first spoken lines stay together and continuation consumes measured space', () => {
  const speech = unit('speech', 15, 'character');
  speech.columns[0][0].type = 'character'; speech.columns[0].slice(1).forEach(line => { line.type = 'dialogue'; });
  const result = pages([unit('a', 8), speech]);
  assert.equal(result[0].items.length, 1);
  assert.equal(result[2].items[0].continued, true);
  assert.ok(result.every(page => page.used <= 160));
  assert.equal(result.flatMap(p => p.items.flatMap(item => item.columns[0])).filter(line => line.id === 'speech').length, 15);
});
test('parenthetical avoids an orphan at the bottom of a page', () => {
  const speech = unit('speech', 15, 'character');
  speech.columns[0][9].type = 'parenthetical'; speech.columns[0][10].type = 'dialogue';
  const result = pages([speech]);
  assert.equal(result[0].items[0].columns[0].length, 9);
  assert.equal(result[1].items[0].columns[0][0].type, 'parenthetical');
});
test('unequal dual columns split together, retain every line and never exceed page capacity', () => {
  const dual = { kind: 'dual', type: 'character', columns: [lines('left', 31, 'dialogue'), lines('right', 18, 'dialogue')], gap: 16, keep: 3, speakers: ['NOAH', 'AVA'] };
  const result = pages([unit('before', 4), dual]);
  assert.ok(result.every(page => page.used <= 160));
  assert.deepEqual(result.flatMap(page => page.items.filter(item => item.kind === 'dual').flatMap(item => item.columns[0])), dual.columns[0]);
  assert.deepEqual(result.flatMap(page => page.items.filter(item => item.kind === 'dual').flatMap(item => item.columns[1])), dual.columns[1]);
  assert.ok(result.at(-1).items[0].columns[1].length === 0);
});
test('explicit breaks, gaps, and empty document layout', () => {
  assert.equal(pages([unit('a', 1), { kind: 'break' }, unit('b', 1)]).length, 2);
  assert.equal(pages([{ kind: 'break' }, unit('b', 1)]).length, 1);
  assert.equal(pages([]).length, 1);
  assert.equal(pages([unit('a', 1, 'action', 999)])[0].used, 16);
});
test('layout derives dual pairs and widths without mutating the screenplay', () => {
  const doc = parseFountain('NOAH\nHello.\n\nAVA ^\nHi.\n\nAction.');
  const snapshot = JSON.stringify(doc); const calls = [];
  const units = layoutUnits(doc, (el, dual) => { calls.push([el.id, dual]); return [{ start: 0, end: el.text.length }]; });
  assert.equal(units[0].kind, 'dual');
  assert.equal(units[0].columns.length, 2);
  assert.ok(calls.slice(0, 4).every(call => call[1]));
  assert.equal(units[1].type, 'action');
  assert.equal(JSON.stringify(doc), snapshot);
});
test('wrapped cues and parentheticals keep their first speech lines, including after a scene heading', () => {
  const doc = parseFountain('INT. ROOM - DAY\n\nNOAH (on a distant radio)\n(whispering very quietly)\nHello.');
  const measured = layoutUnits(doc, el => {
    const count = el.type === 'character' || el.type === 'parenthetical' ? 2 : el.type === 'dialogue' ? 12 : 1;
    return lines(el.id, count, el.type);
  });
  assert.equal(measured[1].keep, 6);
  const result = pages([unit('before', 6), ...measured]);
  assert.equal(result[0].items.length, 1);
  assert.equal(result[1].items[0].columns[0][0].type, 'scene');
  assert.ok(result[1].items[1].columns[0].some(line => line.type === 'dialogue'));
});

const measureOne = el => [{ start: 0, end: el.text.length, height: PAGE.lineHeight }];
const compact = source => {
  const doc = parseFountain(source);
  doc.elements = doc.elements.filter(el => el.type !== 'whitespace');
  return doc;
};
test('scene spacing follows action and dialogue without inserting model elements', () => {
  const doc = compact('INT. FIRST - DAY\n\nAn action.\n\nEXT. SECOND - DAY\n\nANN\nHello.\n\nINT. THIRD - NIGHT\n\nAnother action.');
  const before = structuredClone(doc);
  const units = layoutUnits(doc, measureOne);
  assert.deepEqual(units.map(item => [item.type, item.gap]), [
    ['scene', 0], ['action', 16], ['scene', 32], ['character', 16], ['scene', 32], ['action', 16],
  ]);
  assert.deepEqual(doc, before);
  assert.equal(paginate(units)[0].used, 224);
});
test('page-leading heading has no gap, opening transitions separate headings, and source separators are not doubled', () => {
  const first = layoutUnits(compact('FADE IN:\n\nINT. FIRST - DAY\n\nAction.'), measureOne);
  assert.equal(first[1].gap, 32); // Opening content uses the reference heading separation.
  const doc = parseFountain('INT. FIRST - DAY\n\nAction.\n\nEXT. NEXT - DAY\n\nNext action.');
  const units = layoutUnits(doc, measureOne);
  assert.equal(units[2].gap, 32);
  assert.equal(units[3].gap, 16);
  assert.equal(paginate(units)[0].items[0].gap, 0);
});
test('later scene spacing counts toward a page boundary and is suppressed on a new page', () => {
  const units = layoutUnits(compact('INT. FIRST - DAY\n\nAction.\n\nEXT. NEXT - DAY\n\nNext action.'), measureOne);
  assert.equal(paginate(units, { contentHeight: 128 }).length, 1);
  const result = paginate(units, { contentHeight: 96 });
  assert.equal(result.length, 2);
  assert.deepEqual(result.map(page => page.used), [48, 48]);
  assert.equal(result[1].items[0].columns[0][0].type, 'scene');
  assert.equal(result[1].items[0].gap, 0);
  assert.equal(result[1].items[1].gap, 16);
  assert.ok(result.every(page => page.used <= 96));
  const afterBreak = paginate([units[0], units[1], { kind: 'break' }, units[2], units[3]]);
  assert.equal(afterBreak[1].items[0].gap, 0);
});
test('consecutive headings stay with the following scene beginning when the chain fits', () => {
  const units = layoutUnits(compact('INT. FIRST - DAY\n\nEXT. SECOND - DAY\n\nINT. THIRD - DAY\n\nThe scene begins.'), measureOne);
  assert.deepEqual(units.map(item => item.gap), [0, 32, 32, 16]);
  const result = pages([unit('before', 3), ...units]);
  assert.equal(result[0].items.length, 1);
  assert.equal(result[1].items.length, 4);
  assert.equal(result[1].used, 144);
});
test('typed paragraphs need no whitespace elements to get proper block and attached-dialogue spacing', () => {
  const doc = compact('INT. ROOM - DAY\n\nFirst action.\n\nSecond action.\n\nANN\n(quietly)\nHello.\n(then)\nStill here.\n\nBOB\nYes.\n\nAn action.');
  const before = structuredClone(doc), units = layoutUnits(doc, measureOne);
  assert.deepEqual(units.map(unit => unit.gap), [0,16,16,16,16,16]);
  assert.deepEqual(units[3].columns[0].map(line=>line.type), ['character','parenthetical','dialogue','parenthetical','dialogue']);
  assert.deepEqual(doc,before);
});

function speechUnit(count, cue = 'SOPHIA (V.O.)', state) {
  return { ...unit('speech',count,'character'), speakers:[cue],speakerStates:[state],
    continuationColumns:[[{text:`${cue} (CONT'D)`,type:'character'}]],
    columns:[[...lines('cue',1,'character'),...lines('words',count-1,'dialogue')]] };
}
test('page-break MORE reserves its line and a full-size cue even with manual continuation off',()=>{
  const speech=speechUnit(11,'SOPHIA (V.O.)','off'), snapshot=structuredClone(speech);
  const result=pages([speech]);
  assert.deepEqual(result.map(p=>p.used),[160,48]);
  assert.deepEqual(result[0].items[0].more,[true]);
  assert.deepEqual(result[1].items[0].headers[0],[{type:'character',text:"SOPHIA (V.O.) (CONT'D)"}]);
  assert.deepEqual(result.flatMap(p=>p.items.flatMap(i=>i.columns[0])),speech.columns[0]);
  assert.deepEqual(speech,snapshot);
  assert.deepEqual(pages([speechUnit(10)])[0].items[0].more,[false]);
});
test('three-plus page speech has markers only at actual splits and removes them when shortened',()=>{
  const result=pages([speechUnit(36)]);
  assert.equal(result.length,5);
  assert.ok(result.slice(0,-1).every(p=>p.items[0].more[0]));
  assert.equal(result.at(-1).items[0].more[0],false);
  assert.ok(result.slice(1).every(p=>p.items[0].headers[0].length===1));
  const short=pages([speechUnit(4)]);
  assert.equal(short.length,1);assert.equal(short[0].items[0].headerHeight,0);assert.equal(short[0].items[0].moreHeight,0);
});
test('multi-line repeated cues consume their measured height and never duplicate CONT markers',()=>{
  const doc=parseFountain("ANN (O.S.) (CONT'D)\n"+'Words. '.repeat(100));
  const units=layoutUnits(doc,el=>el.type==='character'?lines(el.id,2,el.type):lines(el.id,30,el.type));
  assert.equal(units[0].continuationColumns[0].length,2);
  assert.equal(units[0].speakers[0].match(/CONT'D/g).length,1);
  const result=pages(units);
  assert.ok(result.slice(1).every(p=>p.items[0].headerHeight===32));
  assert.ok(result.every(p=>p.used<=160&&p.items[0].columns[0].some(l=>l.type==='dialogue')));
});
test('dual continuation keeps columns, reserves MORE, and never repeats an exhausted speaker',()=>{
  const unit={kind:'dual',type:'character',gap:0,keep:3,speakers:['A','B (O.S.)'],
    columns:[[...lines('a-cue',1,'character'),...lines('a',24,'dialogue')],[...lines('b-cue',1,'character'),...lines('b',5,'dialogue')]]};
  const result=pages([unit]);
  assert.deepEqual(result[0].items[0].more,[true,false]);
  assert.deepEqual(result[1].items[0].headers[1],[]);
  assert.deepEqual(result.flatMap(p=>p.items.flatMap(i=>i.columns[0])),unit.columns[0]);
  assert.deepEqual(result.flatMap(p=>p.items.flatMap(i=>i.columns[1])),unit.columns[1]);
  assert.ok(result.every(p=>p.used<=160));
});
