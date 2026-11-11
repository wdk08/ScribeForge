import test from 'node:test';import assert from 'node:assert/strict';
import {createDocument,createElement as e,validateDocument} from '../js/document.js';
import {editDocument,EditorHistory,caret} from '../js/editing.js';import {layoutUnits,paginate} from '../js/pagination.js';
const text=(n,line='A short line.')=>Array(n).fill(line).join('\n');
const measure=el=>{let start=0;return el.text.split('\n').map(s=>{const line={start,end:start+s.length+1,height:16};start=line.end;line.end=Math.min(el.text.length,line.end);return line;});};
for(const first of ['character','parenthetical'])for(const command of ['backspace','delete'])test(`${command} from start of ${first} retains surviving Dialogue identity/type and reflows on the first edit`,()=>{
 const action=e('action',text(40)),cue=e('character','ANN'),parenthetical=e('parenthetical','(quietly)'),speech=e('dialogue',text(18));
 const doc=createDocument({elements:[action,cue,...(first==='parenthetical'?[parenthetical]:[]),speech]});const start=first==='character'?cue:parenthetical;
 const selection={anchor:{id:start.id,offset:0},focus:{id:speech.id,offset:14}},history=new EditorHistory(doc,selection),original=structuredClone(doc);
 for(let i=0;i<3;i++){
  const result=history.apply(selection,{type:command});const remaining=result.document.elements.find(el=>el.id===speech.id);
  assert.equal(remaining?.type,'dialogue');assert.equal(remaining.text,speech.text.slice(14));assert.equal(result.document.elements.some(el=>el.id===start.id),false);assert.deepEqual(result.selection,caret(speech.id));validateDocument(result.document);
  const units=layoutUnits(result.document,measure),pages=paginate(units),snapshot=structuredClone(result.document);assert.ok(pages[0].used>=848);
  for(let repeat=0;repeat<5;repeat++)assert.deepEqual(paginate(layoutUnits(result.document,measure)),pages);
  assert.deepEqual(result.document,snapshot);assert.deepEqual(history.undo().document,original);assert.deepEqual(history.redo().document,result.document);history.undo();
 }
});
test('internal dialogue separators cannot turn into a gap after the grouped speech',()=>{
 const doc=createDocument({elements:[e('character','ANN'),e('whitespace','\n'),e('parenthetical','(quietly)'),e('whitespace','\n\n\n'),e('dialogue','Hello.'),e('action','The door opens.')]});
 const units=layoutUnits(doc,measure);assert.equal(units.length,2);assert.equal(units[1].gap,16);
});

test('unfinished cue and parenthetical stay mid-page until dialogue is drafted',()=>{
 for(const parts of [[e('character','')],[e('character','LUKE')],[e('character','LUKE'),e('parenthetical','()')],[e('character','LUKE'),e('parenthetical','(whispering)')]]){
  const doc=createDocument({elements:[e('action',text(8)),...parts]});
  const pages=paginate(layoutUnits(doc,measure));assert.equal(pages.length,1);assert.ok(pages[0].used<864);
 }
});

test('completed speech still moves intact when its cue cannot fit with spoken lines',()=>{
 const doc=createDocument({elements:[e('action',text(51)),e('character','LUKE'),e('parenthetical','(whispering)'),e('dialogue','Come here.\nQuickly.')]});
 const pages=paginate(layoutUnits(doc,measure));assert.equal(pages.length,2);assert.equal(pages[0].items.length,1);assert.equal(pages[1].items[0].columns[0][0].type,'character');
});
