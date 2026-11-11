import test from 'node:test';
import assert from 'node:assert/strict';
import {createDocument,createElement,validateDocument,meaningfulContent} from '../js/document.js';
import {EditorHistory,caret,editDocument,selectedText} from '../js/editing.js';
import {elementLayout,rightMarginBounds} from '../js/right-margins.js';
import {parseFountain} from '../js/fountain.js';
import {fountainForSaving,documentFingerprint} from '../js/session.js';
import {FORMAT} from '../js/screenplay-format.js';

test('symmetrical scene numbers reserve their gutter only for numbered headings without changing stored margins',()=>{
 const scene=createElement('scene','INT. ROOM - DAY',{sceneNumber:'1025',rightMarginOffsetPt:3});
 assert.equal(FORMAT.width-FORMAT.sceneNumberRight,FORMAT.sceneNumberLeft);
 const normal=elementLayout(scene),numbered=elementLayout(scene,false,0,{sceneNumbers:true});
 assert.equal(normal.left,numbered.left);assert.equal(normal.width,572);assert.equal(numbered.width,548);
 assert.ok(numbered.right<=FORMAT.sceneNumberRight-FORMAT.sceneNumberWidth);
 assert.equal(scene.rightMarginOffsetPt,3);
 scene.rightMarginOffsetPt=rightMarginBounds(scene).max;
 assert.equal(elementLayout(scene,false,0,{sceneNumbers:true}).width,72);
 assert.equal(elementLayout(createElement('action','Unrelated.'),false,0,{sceneNumbers:true}).width,576);
});

test('margin adjustments are exact points, local to selection, reset without zero, undoable',()=>{
 const doc=createDocument({elements:[createElement('action','One.'),createElement('action','Two.'),createElement('action','Three.')]});
 const [a,b,c]=doc.elements,selection={anchor:{id:a.id,offset:1},focus:{id:b.id,offset:2}},history=new EditorHistory(doc,selection);
 for(let i=0;i<3;i++)history.apply(selection,{type:'rightMargin',delta:5});
 let next=history.current.document;
 assert.deepEqual(next.elements.map(e=>e.rightMarginOffsetPt),[15,15,undefined]);assert.deepEqual(history.current.selection,selection);
 assert.equal(elementLayout(next.elements[1]).left,elementLayout(b).left);assert.equal((elementLayout(b).width-elementLayout(next.elements[1]).width)*.75,15);
 history.apply(caret(b.id,1),{type:'rightMargin',delta:-5});assert.equal(history.current.document.elements[1].rightMarginOffsetPt,10);
 history.apply(caret(b.id),{type:'rightMargin',reset:true});assert.equal('rightMarginOffsetPt' in history.current.document.elements[1],false);
 assert.equal(history.undo().document.elements[1].rightMarginOffsetPt,10);assert.equal('rightMarginOffsetPt' in history.redo().document.elements[1],false);
 assert.notEqual(documentFingerprint(doc),documentFingerprint(next));assert.deepEqual(meaningfulContent(parseFountain(fountainForSaving(next))),meaningfulContent(doc));
 assert.equal(JSON.stringify(next).includes('rightMarginOffsetPt'),true);assert.equal(fountainForSaving(next).includes('rightMarginOffsetPt'),false);
});
test('invalid offsets reject and accumulated margins clamp to printable/dual bounds',()=>{
 const doc=parseFountain('ANN\nHello.\n\nBOB ^\nReply.');const el=doc.elements.find(e=>e.type==='dialogue'),bounds=rightMarginBounds(el,true);
 for(const value of [0,NaN,Infinity,1.2,999,-999]){const bad=structuredClone(doc);bad.elements.find(e=>e.id===el.id).rightMarginOffsetPt=value;assert.throws(()=>validateDocument(bad));}
 const legacy=structuredClone(doc);legacy.elements.find(e=>e.id===el.id).rightMarginOffsetPt=3;validateDocument(legacy);assert.equal(legacy.elements.find(e=>e.id===el.id).rightMarginOffsetPt,3);
 let next=doc;for(let i=0;i<250;i++)next=editDocument(next,caret(el.id),{type:'rightMargin',delta:5}).document;
 assert.equal(next.elements.find(e=>e.id===el.id).rightMarginOffsetPt,bounds.max);
 for(let i=0;i<250;i++)next=editDocument(next,caret(el.id),{type:'rightMargin',delta:-5}).document;
 assert.equal(next.elements.find(e=>e.id===el.id).rightMarginOffsetPt,undefined);assert.equal(bounds.min,0);
});
test('manual line breaks stay in one action/dialogue and round trip including empty/trailing lines',()=>{
 for(const type of ['action','dialogue']){
  const doc=createDocument({elements:[...(type==='dialogue'?[createElement('character','ANN')]:[]),createElement(type,'First.Second.')]});
  const el=doc.elements.at(-1),history=new EditorHistory(doc,caret(el.id,6));
  let next=history.apply(history.current.selection,{type:'lineBreak'});
  assert.equal(next.document.elements.at(-1).text,'First.\nSecond.');assert.equal(next.document.elements.length,doc.elements.length);
  assert.equal(history.undo().document.elements.at(-1).text,'First.Second.');history.redo();
  next=history.apply(history.current.selection,{type:'backspace'});assert.equal(next.document.elements.at(-1).text,'First.Second.');
  for(const text of ['First.\nSecond.','First.\n\nSecond.','First.\n']){
   const copy=structuredClone(doc);copy.elements.at(-1).text=text;
   const source=fountainForSaving(copy),parsed=parseFountain(source);
   assert.equal(parsed.elements.find(e=>e.type===type).text,text);assert.deepEqual(meaningfulContent(parsed),meaningfulContent(copy));
  }
  const broken=editDocument(doc,caret(el.id,6),{type:'lineBreak'}).document;
  const copied=selectedText(broken,{anchor:{id:el.id,offset:0},focus:{id:el.id,offset:broken.elements.at(-1).text.length}});
  const pasted=editDocument(doc,{anchor:{id:el.id,offset:0},focus:{id:el.id,offset:el.text.length}},{type:'paste',text:copied});
  assert.equal(pasted.document.elements.at(-1).text,'First.\nSecond.');assert.equal(pasted.document.elements.at(-1).type,type);assert.equal(pasted.document.elements.length,doc.elements.length);
 }
});
