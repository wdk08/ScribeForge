import { dialogueGroups } from './document.js';
import { parseInline } from './inline.js';

export const NARRATOR = Object.freeze({ id: 'narrator', name: 'Narrator' });
export function spokenText(text) {
  const plain = nodes => nodes.map(node => ['note', 'boneyard'].includes(node.type) ? '' : node.children ? plain(node.children) : node.text).join('');
  return plain(parseInline(text)).replace(/\s+/g, ' ').trim();
}
export function characterIdentity(text) {
  const name = spokenText(text).replace(/\s*\^$/, '').replace(/(?:\s*\([^()]*\))+\s*$/u, '').trim().replace(/\s+/g, ' ').toUpperCase();
  return { id: `character:${name}`, name: name || 'Unnamed character' };
}

/** A read-only playback projection. No HTML, file writes, or generated audio. */
export function buildTableRead(doc, { readSceneHeadings = false } = {}) {
  const sequence = [], scenes = [], speakers = new Map([[NARRATOR.id, NARRATOR]]);
  const pairs = new Map();
  for (const group of dialogueGroups(doc)) if (group.partnerId) {
    pairs.set(group.partnerId, { parallelGroupId: group.partnerId, side: 'left' });
    pairs.set(group.id, { parallelGroupId: group.partnerId, side: 'right' });
  }
  let character = null, scene = null, pair = null;
  doc.elements.forEach((el, elementIndex) => {
    if (el.type === 'character') { character = characterIdentity(el.text); pair = pairs.get(el.id) ?? null; return; }
    if (el.type === 'scene') {
      scene = { id: el.id, title: spokenText(el.text) || 'Untitled scene', number: scenes.length + 1, elementIndex, startIndex: -1 };
      scenes.push(scene); character = null; pair = null;
    }
    const text = spokenText(el.text);
    const narration = el.type === 'action' || (el.type === 'scene' && readSceneHeadings);
    const dialogue = ['dialogue', 'lyric'].includes(el.type);
    if ((narration || dialogue) && text) {
      const speaker = dialogue && character ? character : NARRATOR;
      speakers.set(speaker.id, speaker);
      sequence.push({ elementId: el.id, elementIndex, type: el.type, text, speakerId: speaker.id, speaker: speaker.name,
        sceneId: scene?.id ?? null, sceneTitle: scene?.title ?? 'Before the first scene', sceneNumber: scene?.number ?? null,
        ...(dialogue && pair ? pair : {}) });
    }
    if (!['character', 'dialogue', 'lyric', 'parenthetical', 'whitespace', 'note', 'boneyard'].includes(el.type)) { character = null; pair = null; }
  });
  // Empty scenes position at the next readable element; a silent tail is disabled.
  let cursor = 0;
  for (const item of scenes) {
    while (cursor < sequence.length && sequence[cursor].elementIndex < item.elementIndex) cursor++;
    item.startIndex = cursor < sequence.length ? cursor : -1;
  }
  return { sequence, scenes, speakers: [...speakers.values()] };
}

export const TABLE_READ_DEFAULTS = Object.freeze({ readSceneHeadings: false, speed: 1 });
export const SPEAKER_DEFAULTS = Object.freeze({ voiceId: '', rate: 1, pitch: 1, volume: 1 });
const bounded = (value, min, max, fallback) => Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
export function speakerSettings(saved = {}) {
  return { voiceId: typeof saved?.voiceId === 'string' ? saved.voiceId : SPEAKER_DEFAULTS.voiceId, rate: bounded(saved?.rate, .5, 2, SPEAKER_DEFAULTS.rate), pitch: bounded(saved?.pitch, 0, 2, SPEAKER_DEFAULTS.pitch), volume: bounded(saved?.volume, 0, 1, SPEAKER_DEFAULTS.volume) };
}
export function tableReadPreferences(saved = {}) {
  const speakers = {};
  for (const [id, value] of Object.entries(saved?.speakers ?? {})) Object.defineProperty(speakers, id, { value: speakerSettings(value), enumerable: true, configurable: true, writable: true });
  return { version: 1, readSceneHeadings: typeof saved?.readSceneHeadings === 'boolean' ? saved.readSceneHeadings : TABLE_READ_DEFAULTS.readSceneHeadings, speed: bounded(saved?.speed, .5, 2, TABLE_READ_DEFAULTS.speed), speakers };
}
export const tableReadPreferenceKey = documentId => `tableRead:${documentId}`;
export async function loadTableReadPreferences(repository, documentId) {
  return tableReadPreferences(await repository.getPreference(tableReadPreferenceKey(documentId), {}));
}
export const voiceId = voice => voice.kind === 'piper' ? voice.voiceURI : JSON.stringify([voice.voiceURI ?? '', voice.name, voice.lang]);
export function orderedVoices(voices) {
  return [...new Map(voices.map(voice => [voiceId(voice), voice])).values()].sort((a, b) => Number(b.default) - Number(a.default) || Number(a.kind === 'piper') - Number(b.kind === 'piper') || `${a.lang} ${a.name}`.localeCompare(`${b.lang} ${b.name}`));
}
export function resolveVoice(voices, saved, speakerIndex = 0) {
  const voice = saved.voiceId && voices.find(item => voiceId(item) === saved.voiceId);
  return { voice: voice || voices[speakerIndex % voices.length] || null, missing: Boolean(saved.voiceId && !voice) };
}

export { speechChunks } from './speech-chunks.js';
