import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, createElement, ELEMENT_TYPES } from '../js/document.js';
import { caret, editableElements, editDocument, EditorHistory } from '../js/editing.js';
import { classifyReturnFragment, screenplayPaste } from '../js/screenplay-paste.js';
import { parseFountain } from '../js/fountain.js';
import { fountainForSaving } from '../js/session.js';

const body = result => editableElements(result.document);
const split = (type, text, offset, attrs = {}) => {
  const el = createElement(type, text, attrs), doc = createDocument({ elements: [el] });
  const history = new EditorHistory(doc, caret(el.id, offset));
  return { el, doc, history, result: history.apply(history.current.selection, { type: 'enter' }) };
};

for (const type of ELEMENT_TYPES.filter(t => !['titleField','pageBreak','whitespace'].includes(t))) {
  test(`Smart Return splits ${type} exactly, at offset zero in one undo step`, () => {
    const text = 'Préfix🙂suffix — café!?', offset = text.indexOf('suffix');
    const { el, doc, history, result } = split(type, text, offset, type === 'section' ? { depth: 2 } : {});
    const [first, second] = body(result);
    assert.equal(first.type, type); assert.equal(first.id, el.id);
    assert.equal(first.text, text.slice(0, offset)); assert.equal(second.text, text.slice(offset));
    assert.equal(second.type, 'action'); assert.notEqual(second.id, first.id);
    assert.equal(first.text + second.text, text); assert.deepEqual(result.selection, caret(second.id));
    assert.deepEqual(history.undo(), { document: doc, selection: caret(el.id, offset) });
    assert.deepEqual(history.redo(), result); assert.equal(history.past.length, 1);
  });
}

test('the requested Scene Heading → SOPHIA example is exact and portable', () => {
  const prefix = "INT. LUKE'S ROOM - NIGHT", text = prefix + 'SOPHIA';
  const { result } = split('scene', text, prefix.length);
  assert.deepEqual(body(result).map(e => [e.type,e.text]), [['scene',prefix],['character','SOPHIA']]);
  assert.deepEqual(editableElements(parseFountain(fountainForSaving(result.document))).map(e => [e.type,e.text]), body(result).map(e => [e.type,e.text]));
});

test('shared paste/Return recognition agrees on clear scene, cue, parenthetical and transition syntax', () => {
  for (const [tail, type] of [['EXT. PARK - DAY','scene'], ['SOPHIA','character'], ['(whispering)','parenthetical'], ['CUT TO:','transition']]) {
    assert.equal(classifyReturnFragment(tail, { originalType:'scene', before:'INT. ROOM - DAY' }), type);
    const paste = screenplayPaste(type === 'parenthetical' ? `SOPHIA\n${tail}\nA response.` : `INT. ROOM - DAY\n\nSOPHIA\nHello.\n\n${tail}\nA response.`);
    assert.ok(paste.some(e => e.type === type && e.text === tail));
  }
});

test('classification uses known names and following speech but does not mistake spoken names or prose for cues', () => {
  for (const originalType of ['action','scene']) assert.equal(classifyReturnFragment('Sophia', { originalType, before:'A beat.', characters:['SOPHIA (V.O.)'] }), 'character');
  for (const tail of ['SOPHIA','SOPHIA WALKS AWAY','billion dinosaurs!','int. is just a word here']) {
    assert.equal(classifyReturnFragment(tail, { originalType:'dialogue', before:'Hello ', characters:['SOPHIA'] }), 'action');
  }
  assert.equal(classifyReturnFragment('NOAH', { originalType:'action', before:'A beat.', following:{type:'dialogue',text:'Hi.'} }), 'character');
  assert.equal(classifyReturnFragment('THE DOOR', { originalType:'action', before:'An uncertain phrase ' }), 'action');
  assert.equal(classifyReturnFragment('AH', { originalType:'character', before:'NO' }), 'action');
  assert.equal(classifyReturnFragment('NIGHT', { originalType:'scene', before:'INT. ROOM - ' }), 'action');
  assert.equal(classifyReturnFragment('>fade out.', { originalType:'dialogue', before:'A beat.' }), 'transition');
  assert.equal(classifyReturnFragment('SOPHIA', { originalType:'dialogue', before:'I love ', following:{type:'dialogue'}, characters:['SOPHIA'] }), 'action');
  assert.equal(classifyReturnFragment('Hello.', { originalType:'character', before:'NOAH ' }), 'dialogue');
  assert.equal(classifyReturnFragment('Hello.', { originalType:'parenthetical', before:'(quietly)', previous:{type:'character',text:'NOAH'} }), 'dialogue');
});

test('splitting does not autocorrect, capitalize, trim spaces or manufacture parentheses', () => {
  for (const [type, text, at] of [['action','Teh lower case',3],['character','NOAHlower',4],['transition','FADElower',4],['scene','INT. x  cut to:',8]]) {
    const { result } = split(type,text,at);
    assert.equal(body(result).map(e => e.text).join(''), text);
    assert.equal(body(result)[0].type,type);
  }
});

test('Parenthetical splits retain balanced brackets on the original and move only the inner suffix', () => {
  const {result}=split('parenthetical','(whispering softly)',11);
  assert.deepEqual(body(result).map(e=>[e.type,e.text]),[['parenthetical','(whispering)'],['action',' softly']]);
  for(const [text,offset] of [['(quietly)',4],['(🙂 café!)',3]]){
    const {result}=split('parenthetical',text,offset),[first,second]=body(result);
    assert.equal(first.text,text.slice(0,offset)+')');assert.equal(second.text,text.slice(offset,-1));
    assert.equal(first.text.slice(0,-1)+second.text+')',text);
  }
  const el=createElement('parenthetical','(quietly)'),doc=createDocument({elements:[el]});
  for(const [start,end] of [[2,9],[0,9],[1,8]]){
    const result=editDocument(doc,{anchor:{id:el.id,offset:start},focus:{id:el.id,offset:end}},{type:'enter'});
    assert.ok(/^\(.*\)$/.test(body(result)[0].text));assert.equal(body(result)[1].text,'');
  }
});

test('a Parenthetical split before existing Dialogue saves without modifying either live element', () => {
  const doc=parseFountain('@NOAH\n(whispering softly)\nStay here.');
  const par=doc.elements.find(e=>e.type==='parenthetical');
  const result=editDocument(doc,caret(par.id,11),{type:'enter'}),before=structuredClone(result.document),warnings=[];
  const source=fountainForSaving(result.document,{onWarning:w=>warnings.push(w)});
  assert.deepEqual(result.document,before);assert.equal(body(result).at(-1).type,'dialogue');
  assert.ok(source.includes('(whispering)'));assert.ok(source.includes(' softly'));assert.ok(source.includes('Stay here.'));
  assert.equal(warnings.length,1);assert.match(warnings[0],/Exact text and types remain/);
});

test('split Note delimiters and multiline forced-syntax fragments save literal text with explicit warnings', () => {
  for(const [type,text,at] of [['note','one]two',4],['section','First\nSecondThird',12],['action','First\n@NOAH\nNext words',2]]){
    const {result}=split(type,text,at,type==='section'?{depth:1}:{}),before=structuredClone(result.document),warnings=[];
    const source=fountainForSaving(result.document,{onWarning:w=>warnings.push(w)});
    assert.deepEqual(result.document,before);assert.equal(warnings.length,1);
    const parsed=editableElements(parseFountain(source));
    const originalLines=body(result).flatMap(e=>e.text.split('\n'));
    assert.deepEqual(parsed.flatMap(e=>e.text.split('\n')),originalLines);
  }
});

test('forward/reverse selections replace only the selected text and retain all neighbours', () => {
  for (const reverse of [false,true]) {
    const els = [createElement('scene','INT. ROOM - DAY'),createElement('action','Before selected after'),createElement('transition','CUT TO:')];
    const doc = createDocument({elements:els}), [scene,el,transition] = els;
    const start={id:el.id,offset:7},end={id:el.id,offset:15};
    const selection={anchor:reverse?end:start,focus:reverse?start:end};
    const result=editDocument(doc,selection,{type:'enter'}), out=body(result);
    assert.equal(out[1].text,'Before ');assert.equal(out[2].text,' after');
    assert.deepEqual(out[0],scene);assert.deepEqual(out[3],transition);assert.deepEqual(result.selection,caret(out[2].id));
    const cross=editDocument(doc,{anchor:{id:scene.id,offset:4},focus:{id:el.id,offset:15}},{type:'enter'});
    assert.deepEqual(body(cross).map(e=>[e.type,e.text]),[['scene','INT.'],['action',' after'],['transition','CUT TO:']]);
  }
});

test('boundaries, empty elements and Shift Return retain established behaviour', () => {
  for (const type of ['scene','action','character','dialogue','parenthetical','transition','centered','lyric','section','synopsis','note','boneyard']) {
    const el=createElement(type,type==='parenthetical'?'(quietly)': ['character','transition'].includes(type)?'HELLO WORLD':'Hello world',type==='section'?{depth:1}:{}),doc=createDocument({elements:[el]});
    for (const at of [0,el.text.length]) {
      const result=editDocument(doc,caret(el.id,at),{type:'enter'});
      if(type!=='action') assert.deepEqual(result.document.elements[0],el);
      else assert.equal(body(result).map(e=>e.text).join(''),el.text);
    }
    const soft=editDocument(doc,caret(el.id,3),{type:'lineBreak'});
    assert.equal(body(soft).length,1);assert.equal(body(soft)[0].text,el.text.slice(0,3)+'\n'+el.text.slice(3));
  }
  for (const [type,next] of [['character','dialogue'],['parenthetical','dialogue'],['action','action'],['dialogue','action']]) {
    const el=createElement(type,''),doc=createDocument({elements:[el]});
    assert.equal(body(editDocument(doc,caret(el.id),{type:'enter'}))[0].type,next);
  }
});

test('Action splits preserve custom width and portable Fountain text; IDs remain unique across repeated splits', () => {
  const { result }=split('action','OneTwoThree',3,{rightMarginOffsetPt:15});
  assert.equal(body(result)[1].rightMarginOffsetPt,15);
  const again=editDocument(result.document,caret(body(result)[1].id,3),{type:'enter'});
  assert.deepEqual(body(again).map(e=>e.text),['One','Two','Three']);
  assert.equal(new Set(again.document.elements.map(e=>e.id)).size,again.document.elements.length);
  assert.deepEqual(editableElements(parseFountain(fountainForSaving(again.document))).map(e=>e.text),['One','Two','Three']);
});
