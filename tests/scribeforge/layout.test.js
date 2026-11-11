import test from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from 'fflate';
import { blankCover, coverDimensions, pointsPerMillimeter } from '../../js/scribeforge/cover-model.js';
import { exportDocx } from '../../js/scribeforge/formats.js';
import { chapterHeading, decodeManuscript, encodeManuscript, newManuscript, pageDimensions, paragraphStyle, schema } from '../../js/scribeforge/model.js';
import { planPages } from '../../js/scribeforge/pagination.js';

test('page planning keeps headings with body text and splits oversized paragraphs between lines', () => {
  const plan = planPages([
    { pos: 0, height: 70 },
    { pos: 4, height: 20, heading: true },
    { pos: 10, height: 22 },
    { pos: 20, height: 168, lineHeight: 24, lines: () => Array.from({ length: 7 }, (_, i) => ({ top: i * 24, pos: 21 + i * 5 })) },
    { pos: 81, manual: true },
  ], 100, 44);
  assert.deepEqual(plan.breaks.map(item => item.pos), [4, 31, 51, 82]);
  assert.equal(plan.count, 5);
});

test('A5 landscape and a manual page break survive DOCX export', () => {
  const manuscript = newManuscript('Layout', undefined, 'CHAPTER 1\nText.\fNext page.');
  Object.assign(manuscript.settings, { pageSize: 'a5', orientation: 'landscape', left: 45, right: 36, top: 36, bottom: 36 });
  assert.deepEqual(pageDimensions(manuscript.settings), { width: 595.28, height: 419.53 });
  const xml = strFromU8(unzipSync(exportDocx(manuscript))['word/document.xml']);
  assert.match(xml, /w:pgSz w:w="11906" w:h="8391" w:orient="landscape"/);
  assert.match(xml, /w:left="900"/);
  assert.match(xml, /w:br w:type="page"/);
  assert.match(xml, /w:pStyle w:val="Heading1"/);
  assert.match(xml, /w:keepNext/);
});

test('the project heading style and manual suppression survive a manuscript round trip', () => {
  const manuscript = newManuscript('Heading', undefined, 'chapter one\nThe word chapter belongs in this sentence.\nCHAPTER 12: The Beginning');
  manuscript.settings.chapterStyle = 'section';
  manuscript.content.content[2].attrs.chapterMode = 'off';
  const roundTrip = decodeManuscript(encodeManuscript(manuscript));
  const doc = schema.nodeFromJSON(roundTrip.content);
  assert.equal(paragraphStyle(doc.child(0), roundTrip.settings), 'section');
  assert.equal(chapterHeading(doc.child(0), roundTrip.settings), true);
  assert.equal(chapterHeading(doc.child(1), roundTrip.settings), false);
  assert.equal(chapterHeading(doc.child(2), roundTrip.settings), false);
});

test('cover trim, spine, and artwork settings persist without changing the manuscript', () => {
  const manuscript = newManuscript('Cover proof', undefined, 'First paragraph.');
  const original = structuredClone(manuscript.content);
  manuscript.cover = { ...blankCover(), layout: 'wrap', bleed: 9, paper: .12, background: '#49339a' };
  const roundTrip = decodeManuscript(encodeManuscript(manuscript));
  assert.deepEqual(roundTrip.content, original);
  assert.deepEqual(roundTrip.cover, manuscript.cover);
  const trim = pageDimensions(roundTrip.settings);
  const spread = coverDimensions(trim, 81, roundTrip.cover);
  assert.deepEqual(spread.panels.map(panel => panel.name), ['Back', 'Spine', 'Front']);
  assert.equal(spread.spine, 41 * .12 * pointsPerMillimeter);
  assert.ok(coverDimensions(trim, 1, roundTrip.cover).warning);
  assert.equal(coverDimensions(trim, 1, { ...roundTrip.cover, spine: 20 }).spine, 20);
  assert.throws(() => encodeManuscript({ ...manuscript, cover: { ...manuscript.cover, backgroundImage: 'https://example.invalid/image.png' } }), /invalid cover/);
});
