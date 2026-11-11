import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, createElement } from '../js/document.js';
import { printableDocument } from '../js/pdf-export.js';

test('PDF preparation removes annotations and emphasis delimiters without changing the structured screenplay', () => {
  const original = createDocument({ elements: [createElement('action', 'A **bold** word and *italic* text [[private note]].'), createElement('note', 'Private note.'), createElement('transition', 'FADE IN:')] });
  const before = structuredClone(original);
  const printable = printableDocument(original);
  assert.equal(printable.elements[0].text, 'A bold word and italic text .');
  assert.equal(printable.elements.length, 2);
  assert.equal(printable.elements[0].id, original.elements[0].id);
  assert.deepEqual(original, before);
});
