import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { createRepository } from '../js/storage.js';
import { createDraft } from '../js/library.js';
import { createDocument, createElement, meaningfulContent, dialogueGroups } from '../js/document.js';
import { parseFountain, serializeFountain } from '../js/fountain.js';
import { fountainForSaving } from '../js/session.js';
import { titlePageFields, changeTitlePage } from '../js/title-page.js';
import { screenplayPaste } from '../js/screenplay-paste.js';
import { EditorHistory, editDocument, caret, editableElements } from '../js/editing.js';
import { layoutUnits, paginate } from '../js/pagination.js';
const body = doc => doc.elements.filter(el => !['whitespace', 'titleField'].includes(el.type));
const sample = 'INT. HOSPITAL ROOM - NIGHT\n\nNoah sits beside Ava.\n\nNOAH (V.O.)\nAre you okay?\nReally?\n\nAVA ^\n(weakly)\nI have been better.\n\nNoah takes her hand.\n\nFADE OUT.';
const blank = () => createDocument({ elements: [createElement('action', '')] });

test('writer defaults are stored in Fountain on creation, local preferences persist, existing scripts stay independent', async () => {
  const factory = new IDBFactory(), store = createRepository(factory);
  await store.setPreference('writerProfile', { author: 'Morgan', address: '12 Main St\nCity, SC 29301', phone: '(864) 555-0123', email: 'writer@example.com' });
  const first = (await createDraft(store)).recovery.document;
  assert.equal(titlePageFields(first).author, 'Morgan');
  assert.equal(titlePageFields(first).address, '12 Main St\nCity, SC 29301');
  assert.match(fountainForSaving(first), /Contact:/);
  assert.equal(titlePageFields(parseFountain(fountainForSaving(first))).email, 'writer@example.com');
  await store.setPreference('writerProfile', { author: 'W. Morgans' });
  const second = (await createDraft(createRepository(factory))).recovery.document;
  assert.equal(titlePageFields(second).author, 'W. Morgans');
  assert.equal(titlePageFields(first).author, 'Morgan');
  assert.notEqual(first.id, second.id);
});
test('title is canonical, preserves preferred case, metadata edits undo and redo as one field transaction', () => {
  const doc = blank(), initial = caret(doc.elements[0].id), history = new EditorHistory(doc, initial);
  history.apply(initial, { type: 'titlePage', field: 'title', value: 'The Ones' }, 1000);
  history.apply(initial, { type: 'titlePage', field: 'title', value: 'The Signal Returns' }, 1100);
  assert.equal(history.past.length, 1);
  assert.equal(titlePageFields(history.current.document).title, 'The Signal Returns');
  assert.equal(history.current.document.elements.find(el => el.key === 'Title').text, 'The Signal Returns');
  assert.deepEqual(history.undo().document, doc);
  assert.equal(history.redo().document.title, 'The Signal Returns');
  history.apply(initial, { type: 'titlePage', field: 'author', value: 'Morgan' });
  assert.equal(history.past.length, 2);
  assert.equal(titlePageFields(history.current.document).author, 'Morgan');
  assert.equal(titlePageFields(history.undo().document).author, '');
});
test('imported metadata, multiline contact and unknown fields survive edits without duplicates', () => {
  const source = 'Title: My Story\nCredit: A screenplay by\nAuthor: Jane\nContact:\n    Studio Office\n    12345\n    +1 555 123 4567\n    jane@example.com\nDraft date: October 16\nCustom: Private\n\nINT. ROOM - DAY\n\nA room.';
  const doc = parseFountain(source);
  assert.equal(titlePageFields(doc).address, 'Studio Office\n12345');
  const next = changeTitlePage(changeTitlePage(doc, 'phone', '555-987-6543'), 'title', 'My New Story');
  const result = parseFountain(fountainForSaving(next));
  assert.equal(result.title, 'My New Story');
  assert.equal(result.elements.filter(el => el.key === 'Title').length, 1);
  assert.equal(result.elements.find(el => el.key === 'Custom').text, 'Private');
  assert.equal(result.elements.find(el => el.key === 'Draft date').text, 'October 16');
  assert.equal(titlePageFields(result).phone, '555-987-6543');
  assert.deepEqual(body(result).map(el => [el.type, el.text]), body(doc).map(el => [el.type, el.text]));
});
test('metadata-free imports stay byte-identical until edited; placeholders never enter source', () => {
  const source = 'INT. ROOM - DAY\r\n\r\nA room.\r\n', doc = parseFountain(source, { title: 'File Title' });
  assert.equal(titlePageFields(doc).author, '');
  assert.equal(serializeFountain(doc), source);
  assert.equal(fountainForSaving(doc), source);
  const edited = changeTitlePage(doc, 'address', 'A real address');
  const output = fountainForSaving(edited);
  assert.doesNotMatch(output, /\[AUTHOR|\[MAILING|\[PHONE|\[EMAIL/);
  assert.equal(parseFountain(output).title, 'File Title');
  assert.equal(titlePageFields(parseFountain(output)).address, 'A real address');
});
test('title fields are excluded from body navigation and pagination', () => {
  const original = parseFountain('INT. ROOM - DAY\n\nA room.'), edited = changeTitlePage(original, 'author', 'Jane');
  const measure = el => [{ start: 0, end: el.text.length }];
  assert.deepEqual(paginate(layoutUnits(edited, measure)), paginate(layoutUnits(original, measure)));
  assert.equal(editableElements(edited).length, 2);
});
test('clear screenplay paste recognizes every supported dialogue element and serializes safely', () => {
  const elements = screenplayPaste(sample);
  const doc = createDocument({ elements });
  assert.deepEqual(body(doc).map(el => el.type), ['scene', 'action', 'character', 'dialogue', 'character', 'parenthetical', 'dialogue', 'action', 'transition']);
  assert.equal(body(doc)[2].text, 'NOAH (V.O.)');
  assert.equal(body(doc)[3].text, 'Are you okay?\nReally?');
  assert.equal(body(doc)[5].text, '(weakly)');
  assert.equal(dialogueGroups(doc)[1].partnerId, dialogueGroups(doc)[0].id);
  assert.deepEqual(meaningfulContent(parseFountain(serializeFountain(doc, { canonical: true }))), meaningfulContent(doc));
});
test('Markdown wrappers are removed only around clear structure and entire code fences unwrap', () => {
  const text = '```fountain\n**INT. ROOM - DAY**\n\nAn **important** room.\n\n**NOAH**\nHello.\n```';
  const doc = createDocument({ elements: screenplayPaste(text) });
  assert.deepEqual(body(doc).map(el => [el.type, el.text]), [['scene', 'INT. ROOM - DAY'], ['action', 'An **important** room.'], ['character', 'NOAH'], ['dialogue', 'Hello.']]);
  for (const text of ['An ordinary paragraph.\nAnother line.', 'THE BUILDING IS ON FIRE.\nEveryone runs.', '(A thought)\n\nSome prose.', '**A HEADING**\n\nSome prose.', '```\nOrdinary prose\n```']) assert.equal(screenplayPaste(text), null);
});
test('ambiguous uppercase and parenthesized action remain Action inside a screenplay paste', () => {
  const doc = createDocument({ elements: screenplayPaste('INT. ROOM - DAY\n\nTHE BUILDING IS ON FIRE.\nEveryone runs.\n\n(A thought)') });
  assert.equal(body(doc)[1].type, 'action');
  assert.equal(body(doc)[1].text, 'THE BUILDING IS ON FIRE.\nEveryone runs.');
  assert.equal(body(doc).at(-1).type, 'action');
});
test('paste in middle preserves prefix, suffix, neighboring IDs, caret and exact one-step undo', () => {
  const doc = createDocument({ elements: [createElement('action', 'Before After'), createElement('whitespace', '\n'), createElement('action', 'Neighbor')] });
  const initial = caret(doc.elements[0].id, 7), history = new EditorHistory(doc, initial);
  const result = history.apply(initial, { type: 'paste', text: sample });
  const els = body(result.document);
  assert.equal(els[0].text, 'Before '); assert.equal(els[0].id, doc.elements[0].id);
  assert.equal(els.at(-2).text, 'After'); assert.equal(els.at(-1).id, doc.elements.at(-1).id);
  assert.equal(els.at(-3).id, result.selection.focus.id);
  assert.equal(result.selection.focus.offset, 'FADE OUT.'.length);
  assert.doesNotThrow(() => fountainForSaving(result.document));
  assert.deepEqual(history.undo(), { document: doc, selection: initial });
  assert.deepEqual(history.redo(), result);
});
test('selection replacement only removes selected range and preserves metadata', () => {
  let doc = parseFountain('Title: Story\n\n!Alpha remove\n\n!remove Omega\n\n!Untouched');
  const els = body(doc), initial = { anchor: { id: els[0].id, offset: 6 }, focus: { id: els[1].id, offset: 6 } };
  const result = editDocument(doc, initial, { type: 'paste', text: sample });
  assert.equal(body(result.document)[0].text, 'Alpha ');
  assert.equal(body(result.document).at(-2).text, ' Omega');
  assert.equal(body(result.document).at(-1).id, els[2].id);
  assert.equal(result.document.elements[0].text, 'Story');
  assert.doesNotThrow(() => fountainForSaving(result.document));
});
test('single-line and plain-text paste bypass structural reclassification', () => {
  for (const text of ['INT. ROOM - DAY', 'NOAH']) {
    const doc = blank(), result = editDocument(doc, caret(doc.elements[0].id), { type: 'paste', text });
    assert.equal(body(result.document)[0].type, 'action');
    assert.equal(body(result.document)[0].text, text);
  }
  const doc = blank(), result = editDocument(doc, caret(doc.elements[0].id), { type: 'paste', text: sample, plain: true });
  assert.ok(body(result.document).every(el => el.type === 'action'));
});
test('long scene paste paginates without extra empty pages or metadata in body', () => {
  const doc = blank(), result = editDocument(doc, caret(doc.elements[0].id), { type: 'paste', text: Array.from({ length: 120 }, (_, i) => `INT. ROOM ${i} - DAY\n\nA room.\n\nNOAH\nHello.`).join('\n\n') });
  const pages = paginate(layoutUnits(result.document, el => [{ start: 0, end: el.text.length }]));
  assert.equal(body(result.document).filter(el => el.type === 'scene').length, 120);
  assert.ok(pages.length > 1); assert.ok(pages.every(page => page.items.length));
  assert.doesNotThrow(() => fountainForSaving(result.document));
});
test('clearing the credit persists an explicit empty value rather than restoring its display default', () => {
  const doc = blank(), next = changeTitlePage(doc, 'credit', '');
  assert.equal(titlePageFields(next).credit, '');
  assert.equal(titlePageFields(parseFountain(fountainForSaving(next))).credit, '');
});
test('a scene pasted into dialogue retains the original speaker for the unselected suffix', () => {
  const doc = parseFountain('NOAH\nBefore After');
  const speech = body(doc).at(-1);
  const result = editDocument(doc, caret(speech.id, 7), { type: 'paste', text: 'INT. ROOM - DAY\n\nA room.' });
  assert.deepEqual(body(result.document).slice(-2).map(el => [el.type, el.text]), [['character', 'NOAH'], ['dialogue', 'After']]);
  assert.doesNotThrow(() => fountainForSaving(result.document));
});
test('incomplete phone and email typing stays in its field while all content is serialized in Contact', () => {
  let doc = changeTitlePage(blank(), 'address', '123 Main St');
  for (const [field, text] of [['phone', '555-123-4567'], ['email', 'writer@example.com']]) {
    for (let i = 1; i <= text.length; i++) {
      doc = changeTitlePage(doc, field, text.slice(0, i));
      assert.equal(titlePageFields(doc)[field], text.slice(0, i));
      assert.equal(titlePageFields(doc).address, '123 Main St');
      assert.ok(fountainForSaving(doc).includes(text.slice(0, i)));
    }
  }
  const imported = parseFountain(fountainForSaving(doc));
  assert.equal(titlePageFields(imported).phone, '555-123-4567');
  assert.equal(titlePageFields(imported).email, 'writer@example.com');
});
test('paste in a parenthetical keeps both fragments syntactically valid and retains the speaker', () => {
  const doc = parseFountain('NOAH\n(quietly)\nHello.');
  const par = body(doc).find(el => el.type === 'parenthetical');
  const result = editDocument(doc, caret(par.id, 3), { type: 'paste', text: 'INT. ROOM - DAY\n\nA room.' });
  assert.deepEqual(body(result.document).filter(el => el.type === 'parenthetical').map(el => el.text), ['(qu)', '(ietly)']);
  assert.doesNotThrow(() => fountainForSaving(result.document));
});
test('transition phrases spoken inside a dialogue block stay dialogue rather than becoming cuts', () => {
  const doc = createDocument({ elements: screenplayPaste('NOAH\nFade out.\nINT. ROOM - DAY is what it says.\n\nCUT TO:') });
  assert.deepEqual(body(doc).map(el => [el.type, el.text]), [['character', 'NOAH'], ['dialogue', 'Fade out.\nINT. ROOM - DAY is what it says.'], ['transition', 'CUT TO:']]);
  assert.doesNotThrow(() => fountainForSaving(doc));
});
