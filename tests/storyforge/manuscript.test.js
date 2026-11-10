import test from 'node:test';
import assert from 'node:assert/strict';
import { TextSelection } from 'prosemirror-state';
import { undo, redo } from 'prosemirror-history';
import { strFromU8, unzipSync } from 'fflate';
import { dictionaryEntries, libraryActivity, writingActivity } from '../../js/storyforge/analysis.js';
import { activeChapter, changeParagraph, editorState, findMatches, insertPageBreak, manuscriptIndex, replaceMatches, textChanges } from '../../js/storyforge/editing.js';
import { analyzeProfanity, defaultProfanityGroups } from '../../js/storyforge/profanity-matching.js';
import { readingSequence } from '../../js/storyforge/reading.js';
import { exportDocx, exportEpub, exportText } from '../../js/storyforge/formats.js';
import { decodeManuscript, encodeManuscript, newManuscript, plainText, schema, textDocument } from '../../js/storyforge/model.js';

const prose = () => {
  const m = newManuscript('My 漢字 novel 🪶');
  m.metadata.author = 'M. Writer';
  m.settings = { ...m.settings, pageSize: 'a4', header: 'My Novel', footer: 'Draft', pageNumbers: true,
    styles: { chapter: { align: 'center' } } };
  m.content.content = [
    { type: 'paragraph', attrs: { style: 'chapter' }, content: [{ type: 'text', text: 'The Night & the Sea' }] },
    { type: 'paragraph', attrs: { align: 'justify', indent: -12, left: 30, leading: 1.8, after: 18 }, content: [
      { type: 'text', text: 'Snow', marks: [{ type: 'bold' }, { type: 'font', attrs: { value: 'Georgia' } }] },
      { type: 'text', text: 'fall', marks: [{ type: 'italic' }, { type: 'color', attrs: { value: '#49339a' } }] },
      { type: 'text', text: ' 雪 🐉' }, { type: 'hard_break' }, { type: 'text', text: '  This is a soft line.  ' },
    ] },
    { type: 'page_break' },
    { type: 'paragraph', content: [{ type: 'text', text: 'Chapter Two: At Sea' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Chapter two has begun.' }] },
    { type: 'paragraph' },
  ];
  return m;
};

test('STF preserves metadata, mixed marks, paragraph overrides, spacing and Unicode across saves', () => {
  const m = prose();
  const opened = decodeManuscript(encodeManuscript(m));
  assert.deepEqual(opened, m);
  assert.equal(schema.nodeFromJSON(opened.content).child(1).attrs.indent, -12);
  assert.match(exportText(opened), /Snowfall 雪 🐉\n  This is a soft line\.  /u);
  assert.equal(opened.documentId, m.documentId);
});

test('STF rejects unknown nodes, fields, invalid CSS and future versions', () => {
  const future = prose();
  future.version = 2;
  assert.throws(() => decodeManuscript(future), /Unsupported StoryForge document version 2/);
  const invalid = prose();
  invalid.content.content.push({ type: 'script', content: [] });
  assert.throws(() => decodeManuscript(invalid), /unsupported content/);
  const css = prose();
  css.content.content[1].content[0].marks[1].attrs.value = 'Georgia; position:fixed';
  assert.throws(() => decodeManuscript(css), /unsupported content/);
  assert.throws(() => decodeManuscript('<script>'), /valid StoryForge JSON/);
  assert.throws(() => decodeManuscript({ ...prose(), ignored: 'important' }), /unsupported content/);
});

test('chapter headings and counts follow reading order while ordinary prose stays out of the outline', () => {
  const doc = schema.nodeFromJSON(prose().content);
  const { chapters, paragraphs } = manuscriptIndex(doc);
  assert.deepEqual(chapters.map(({ title, words, explicit }) => [title, words, explicit]), [
    ['The Night & the Sea', 7, true], ['Chapter Two: At Sea', 4, false],
  ]);
  assert.equal(activeChapter(chapters, chapters[1].pos + 1), 1);
  assert.equal(paragraphs, 5);
  const more = manuscriptIndex(textDocument('Prologue\nThe rain\nCHAPTER XII\nWords here\nEpilogue\nThe end.\nChapter thirteen was hard.'));
  assert.deepEqual(more.chapters.map(chapter => chapter.title), ['Prologue', 'CHAPTER XII', 'Epilogue']);
});

test('search and replacement span rich runs, preserve the marks, and undo and redo', () => {
  let state = editorState(prose());
  const matches = findMatches(manuscriptIndex(state.doc).blocks, 'snowfall', { wholeWord: true });
  assert.equal(matches.length, 1);
  assert.equal(findMatches(manuscriptIndex(state.doc).blocks, 'snowfall', { exactCase: true }).length, 0);
  assert.equal(findMatches(manuscriptIndex(state.doc).blocks, 'snow', { wholeWord: true }).length, 0);
  const original = state.doc;
  state = state.apply(replaceMatches(state, matches, 'Raincloud'));
  assert.equal(state.doc.child(1).child(0).text, 'Rain');
  assert.equal(state.doc.child(1).child(0).marks[0].type.name, 'bold');
  assert.equal(state.doc.child(1).child(1).text, 'cloud');
  assert.equal(state.doc.child(1).child(1).marks[0].type.name, 'italic');
  const changed = state.doc;
  assert.ok(undo(state, tr => { state = state.apply(tr); }));
  assert.ok(original.eq(state.doc));
  assert.ok(redo(state, tr => { state = state.apply(tr); }));
  assert.ok(changed.eq(state.doc));
});

test('paragraph style changes preserve explicit formatting and large deletions can be declined', () => {
  const doc = prose();
  let large = 0;
  let state = editorState(doc, { confirmDelete: size => { large = size; return false; } });
  const start = state.doc.firstChild.nodeSize + 1;
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, start)));
  changeParagraph({ style: 'quote' })(state, tr => { state = state.apply(tr); });
  assert.equal(state.doc.child(1).attrs.style, 'quote');
  assert.equal(state.doc.child(1).attrs.indent, -12);
  assert.equal(state.doc.child(1).attrs.align, 'justify');
  const original = state.doc;
  assert.equal(state.applyTransaction(state.tr.delete(start, start + 8)).transactions.length, 0);
  assert.equal(large, 8);
  assert.ok(original.eq(state.doc));
});

test('v1.2 profanity matching keeps original groups, longest phrases, whole words and chapter offsets', () => {
  const doc = textDocument('Chapter One\nWhat  the hell, shell, hellish.\nChapter Two\nHell no.');
  const groups = defaultProfanityGroups();
  const index = manuscriptIndex(doc);
  const result = analyzeProfanity(index, groups);
  assert.deepEqual(result.matches.map(match => match.text), ['What  the hell', 'hellish', 'Hell no']);
  assert.equal(result.matches[0].chapterId, '0');
  assert.equal(doc.textBetween(result.matches[0].start, result.matches[0].end), 'What  the hell');
  const hell = groups.find(group => group.name === 'Hell');
  hell.variations.find(variant => variant.text === 'hell no').enabled = false;
  assert.equal(analyzeProfanity(index, groups).matches.at(-1).text, 'Hell');
  assert.throws(() => dictionaryEntries('malformed'), /Line 1/);
});

test('Read to Me starts at the cursor or selection and reads only prose content', () => {
  const doc = textDocument('First part\nA second paragraph.');
  assert.deepEqual(readingSequence(doc, { from: 7, to: 11 }, 'selection').map(item => item.text), ['part']);
  assert.deepEqual(readingSequence(doc, { from: 7, to: 7 }, 'cursor').map(item => item.text), ['part', 'A second paragraph.']);
});

test('library statistics count each live manuscript once and omit recovery snapshots', () => {
  const a = { id: 'a', activity: { added: 5, deleted: 1, sessions: 2 }, previous: { activity: { added: 5 } } };
  const b = { id: 'b', activity: { added: 2, deleted: 2, sessions: 1 } };
  const removed = { id: 'removed', deletedAt: 1, activity: { added: 100 } };
  const { totals } = libraryActivity([a, a, b, removed]);
  assert.deepEqual(totals, { activeMs: 0, editingMs: 0, added: 7, deleted: 3, sessions: 3 });
});

test('writing activity counts edits, elapsed activity and sessions', () => {
  let now = 0;
  const activity = writingActivity(null, () => true, () => now);
  activity.update(textChanges(textDocument(''), textDocument('A new word')));
  now = 2000;
  activity.update(textChanges(textDocument('A new word'), textDocument('A word')));
  now += 360000;
  activity.update({ added: 1, deleted: 0 });
  assert.deepEqual(activity.snapshot(), { activeMs: 2000, editingMs: 2000, added: 4, deleted: 1, sessions: 2 });
});

test('DOCX export packages text and formatting, and EPUB preserves semantic chapters and order', () => {
  const docx = unzipSync(exportDocx(prose()));
  const main = strFromU8(docx['word/document.xml']);
  assert.match(main, /w:val="Heading1"/);
  assert.match(main, /w:hanging="240"/);
  assert.match(main, /w:val="49339A"/);
  assert.match(main, /w:type="page"/);
  assert.match(main, /雪 🐉/u);
  assert.match(strFromU8(docx['word/footer1.xml']), /w:instr="PAGE"/);
  const epub = exportEpub(prose());
  assert.equal(new DataView(epub.buffer).getUint16(8, true), 0);
  const book = unzipSync(epub);
  assert.equal(strFromU8(book.mimetype), 'application/epub+zip');
  assert.match(strFromU8(book['EPUB/section-1.xhtml']), /<h1[^>]*>The Night &amp; the Sea<\/h1>/);
  assert.match(strFromU8(book['EPUB/section-2.xhtml']), /<h1[^>]*>Chapter Two: At Sea<\/h1>/);
  assert.match(strFromU8(book['EPUB/nav.xhtml']), /section-1\.xhtml.+section-2\.xhtml/);
});

test('long manuscript indexing and cross-run search retain all text', () => {
  const source = Array.from({ length: 180 }, (_, index) => `Chapter ${index + 1}\n${'A reader sailed over the ocean.\n'.repeat(115)}`).join('');
  const doc = textDocument(source);
  const before = performance.now();
  const index = manuscriptIndex(doc);
  assert.equal(index.chapters.length, 180);
  assert.equal(index.chapters.at(-1).words, 115 * 6);
  assert.equal(findMatches(index.blocks, 'the ocean', { wholeWord: true }).length, 180 * 115);
  assert.equal(plainText(doc), source);
  assert.ok(performance.now() - before < 5000);
});

test('whole-word search handles supplementary-plane letters and mid-paragraph breaks preserve all text', () => {
  let state = editorState(newManuscript('My draft', undefined, '𐐀word word 🐉'));
  assert.equal(findMatches(manuscriptIndex(state.doc).blocks, 'word', { wholeWord: true }).length, 1);
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 8)));
  insertPageBreak(state, tr => { state = state.apply(tr); });
  assert.equal(state.doc.child(1).type.name, 'page_break');
  assert.equal(plainText(state.doc).replace('\f', ''), '𐐀word word 🐉');
});
