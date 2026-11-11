import test from 'node:test';
import assert from 'node:assert/strict';
import {createDocument,createElement} from '../js/document.js';
import {editDocument,caret} from '../js/editing.js';
import {fountainForSaving} from '../js/session.js';

for(const [type,text] of [['scene','INT. ROOM - NIGHT'],['action','One 🙂 café. Two!'],['character','BOB (V.O.)'],
 ['dialogue','(softly)Hello, BOB.'],['parenthetical','(whispering softly)'],['transition','DISSOLVE TO:'],
 ['centered','ONE TWO THREE'],['lyric','Sing softly.'],['section','One] Two'],['synopsis','One < two'],
 ['note','One] two'],['boneyard','One * two'],['dialogue','[[note]]is literal.'],['dialogue','/*aside*/is literal.'],
 ['action','A  '],['dialogue','Hi  '],['parenthetical','(a  )']])test(`every cursor split in valid ${type}: ${JSON.stringify(text)} saves without changing its live state`,()=>{
 const el=createElement(type,text,type==='section'?{depth:1}:{});
 const original=createDocument({elements:[createElement('character','ALICE'),el]});
 assert.doesNotThrow(()=>fountainForSaving(original));
 let offset=0;const failures=[];
 for(const char of text){
  offset+=char.length;if(offset>=text.length)break;
  const state=editDocument(original,caret(el.id,offset),{type:'enter'}),before=structuredClone(state.document);
  try{fountainForSaving(state.document);}catch(error){failures.push({offset,error:error.message});}
  assert.deepEqual(state.document,before);
 }
 assert.deepEqual(failures,[]);
});
