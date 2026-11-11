import test from 'node:test';
import assert from 'node:assert/strict';
import { elementColumn, FORMAT, textRangeRect } from '../js/screenplay-format.js';
test('element boundaries preserve distinct right margins and dual columns', () => {
  const pt = type => { const c = elementColumn(type); return [c.left*.75,c.right*.75,c.width*.75]; };
  assert.deepEqual(pt('action'), [108,540,432]); assert.deepEqual(pt('scene'), [108,540,432]);
  assert.deepEqual(pt('character'), [252,522,270]);
  assert.deepEqual(pt('parenthetical'), [216,396,180]);
  assert.deepEqual(pt('transition'), [108,504,396]);
  assert.ok(Math.abs(pt('dialogue')[1]-427.68)<.001);
  assert.equal(elementColumn('dialogue',true,1).left,456);
  assert.equal(FORMAT.width*.75,612); assert.equal(FORMAT.height*.75,792);
});
test('macOS WebKit previous-line zero-width rectangles cannot steal a wrapped word', () => {
  const previous = {x:431,y:0,width:0,height:18}, glyph = {x:96,y:16,width:10,height:18};
  assert.equal(textRangeRect({getClientRects:()=>[previous,glyph]}),glyph);
  assert.equal(textRangeRect({getClientRects:()=>[previous]}),previous);
  const caret={width:0,y:16}; assert.equal(textRangeRect({getClientRects:()=>[],getBoundingClientRect:()=>caret}),caret);
});
