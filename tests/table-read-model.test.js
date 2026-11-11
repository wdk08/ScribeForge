import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, createElement } from '../js/document.js';
import { parseFountain, serializeFountain } from '../js/fountain.js';
import { buildTableRead, characterIdentity, spokenText, speechChunks, loadTableReadPreferences, tableReadPreferences, tableReadPreferenceKey, voiceId, resolveVoice } from '../js/table-read-model.js';
import { createRepository } from '../js/storage.js';
import { draftRecord } from '../js/session.js';
import { IDBFactory } from 'fake-indexeddb';
const element = createElement;

test('speaking character detection merges extensions, whitespace and case; Narrator is separate, and silent cues are omitted', () => {
  const doc = createDocument({ elements: [element('character', 'NOAH'), element('dialogue', 'Hello.'), element('character', 'Ava (O.S.)'), element('dialogue', 'Hey.'), element('character', 'NOAH (V.O.) (CONT’D)'), element('dialogue', 'I remember.'), element('character', 'SILENT')] });
  assert.deepEqual(buildTableRead(doc).speakers.map(item => item.name), ['Narrator', 'NOAH', 'AVA']);
  assert.equal(characterIdentity('  Noah  (V.O.) ^').id, 'character:NOAH');
  assert.equal(characterIdentity('Narrator').id, 'character:NARRATOR');
});
test('narration and dialogue preserve element order, omit markup and unspoken elements, and never modify the model', () => {
  const doc = createDocument({ elements: [element('scene', 'INT. ROOM - DAY'), element('action', 'Noah **walks** [[private]] toward the window.'), element('note', 'Do not read.'), element('character', 'NOAH (V.O.)'), element('parenthetical', '(quietly)'), element('dialogue', '*Hello.* /* silent */'), element('section', 'Part one', { depth: 1 }), element('synopsis', 'Do not read.'), element('boneyard', 'Do not read.'), element('transition', 'CUT TO:'), element('action', 'He notices Ava outside.')] });
  const before = structuredClone(doc), read = buildTableRead(doc);
  assert.deepEqual(read.sequence.map(item => [item.speaker, item.text]), [['Narrator', 'Noah walks toward the window.'], ['NOAH', 'Hello.'], ['Narrator', 'He notices Ava outside.']]);
  assert.equal(buildTableRead(doc, { readSceneHeadings: true }).sequence[0].text, 'INT. ROOM - DAY');
  assert.equal(spokenText('An _underlined_ word and **bold *nested* words**.'), 'An underlined word and bold nested words.');
  assert.deepEqual(doc, before);
});
test('dual dialogue reads left then right with independent character identities and a shared future parallel group', () => {
  const doc = parseFountain('NOAH\nLeft speech.\n\nAVA (O.S.) ^\nRight speech.\n\nThe action resumes.');
  const read = buildTableRead(doc);
  assert.deepEqual(read.sequence.map(item => item.speaker), ['NOAH', 'AVA', 'Narrator']);
  assert.equal(read.sequence[0].side, 'left'); assert.equal(read.sequence[1].side, 'right');
  assert.equal(read.sequence[0].parallelGroupId, read.sequence[1].parallelGroupId);
  assert.equal(read.sequence[2].parallelGroupId, undefined);
});
test('scene navigation maps to stable elements, optionally includes headings, and disables a silent tail', () => {
  const doc = createDocument({ elements: [element('action', 'Before scenes.'), element('scene', 'INT. ROOM - DAY'), element('action', 'First scene.'), element('scene', 'EXT. ROAD - NIGHT'), element('character', 'AVA'), element('dialogue', 'Second scene.'), element('scene', 'INT. EMPTY - DAY')] });
  const read = buildTableRead(doc);
  assert.deepEqual(read.scenes.map(item => item.startIndex), [1, 2, -1]);
  assert.equal(read.sequence[2].sceneId, doc.elements[3].id);
  const withHeadings = buildTableRead(doc, { readSceneHeadings: true });
  assert.deepEqual(withHeadings.scenes.map(item => item.startIndex), [1, 3, 5]);
});
test('long speech is split at word or sentence boundaries, without dropping text or splitting surrogate pairs', () => {
  assert.throws(() => [...speechChunks('😀', 1)], RangeError);
  const text = 'A long sentence for a feature screenplay. '.repeat(500);
  const chunks = [...speechChunks(text)];
  assert.ok(chunks.length > 1); assert.ok(chunks.every(item => item.length <= 220));
  assert.equal(chunks.join(' '), text.trim());
  const word = '😀'.repeat(500); const unicode = [...speechChunks(word, 219)];
  assert.equal(unicode.join(''), word); assert.ok(unicode.every(item => !/[\uD800-\uDBFF]$/.test(item)));
});
test('voice preferences persist per stable document ID independently of screenplay records and Fountain source', async () => {
  const factory = new IDBFactory(), store = createRepository(factory, 'table-read');
  const doc = parseFountain('INT. ROOM - DAY\n\nNOAH\nHello.'); const record = await store.put(draftRecord(doc)), source = serializeFountain(doc);
  const preferences = tableReadPreferences({ speakers: { narrator: { voiceId: 'narrator-voice', rate: 1.2, pitch: .8, volume: .4 }, 'character:NOAH': { voiceId: 'another-voice' } }, readSceneHeadings: true, speed: 1.5 });
  await store.setPreference(tableReadPreferenceKey(doc.id), preferences);
  const reopened = createRepository(factory, 'table-read');
  assert.deepEqual(await loadTableReadPreferences(reopened, doc.id), preferences);
  assert.deepEqual(await loadTableReadPreferences(reopened, 'different-script'), tableReadPreferences());
  assert.deepEqual(await store.get(doc.id), record); assert.equal(serializeFountain(doc), source);
});
test('missing voices fall back without erasing assignments; speaker parameters are bounded', () => {
  const voices = [{ voiceURI: 'available', name: 'Samantha', lang: 'en-US' }], saved = { voiceId: 'missing' };
  assert.equal(resolveVoice(voices, saved).voice, voices[0]); assert.equal(resolveVoice(voices, saved).missing, true);
  assert.equal(saved.voiceId, 'missing'); assert.equal(resolveVoice([], saved).voice, null);
  assert.equal(resolveVoice(voices, { voiceId: voiceId(voices[0]) }).missing, false);
  const prefs = tableReadPreferences({ speed: 99, speakers: { narrator: { rate: 99, pitch: -1, volume: -2 } } });
  assert.deepEqual(prefs.speakers.narrator, { voiceId: '', rate: 2, pitch: 0, volume: 0 }); assert.equal(prefs.speed, 2);
});
