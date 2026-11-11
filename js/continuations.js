import { dialogueGroups } from './document.js';
import { characterIdentity } from './table-read-model.js';

export const hasContinuation = text => /\(\s*(?:CONT['’]D|CONT\.?|CONTINUED)\s*\)/i.test(text);
export const continuedCue = (text, state) => state === 'off' ? text.replace(/\s*\(\s*(?:CONT['’]D|CONT\.?|CONTINUED)\s*\)/gi, '').trimEnd() : hasContinuation(text) ? text : `${text} (CONT'D)`;

/** Derived from actual speech and visible interruptions; never edits cue text. */
export function automaticContinuations(doc, groups = dialogueGroups(doc)) {
  const result = new Set(), paired = new Set();
  for (const group of groups) if (group.partnerId) { paired.add(group.id); paired.add(group.partnerId); }
  const identities = new Map();
  const speakerId = text => { if (!identities.has(text)) identities.set(text, characterIdentity(text).id); return identities.get(text); };
  let active = null, last = null, interrupted = false;
  for (const el of doc.elements) {
    if (el.type === 'scene') { active = null; last = null; interrupted = false; }
    else if (el.type === 'character') active = { cue: el, speaker: speakerId(el.text), paired: paired.has(el.id), spoken: false };
    else if (['dialogue', 'lyric'].includes(el.type) && el.text.trim() && active) {
      if (!active.spoken && last && last.speaker === active.speaker && interrupted && !active.paired && !last.paired && !hasContinuation(active.cue.text)) result.add(active.cue.id);
      active.spoken = true; last = active; interrupted = false;
    } else if (['action', 'transition', 'centered', 'pageBreak'].includes(el.type) && (el.text.trim() || el.type === 'pageBreak')) {
      if (last) interrupted = true;
      active = null;
    }
  }
  for (const el of doc.elements) if (el.type === 'character') {
    if (el.continuation === 'on') result.add(el.id);
    if (el.continuation === 'off') result.delete(el.id);
  }
  return result;
}

export function toggleContinuation(document, id) {
  const doc = structuredClone(document), cue = doc.elements.find(el => el.id === id && el.type === 'character');
  if (!cue) return doc;
  const visible = hasContinuation(cue.text) || automaticContinuations(doc).has(id);
  cue.text = cue.text.replace(/\s*\(\s*(?:CONT['’]D|CONT\.?|CONTINUED)\s*\)/gi, '').trimEnd();
  cue.continuation = visible ? 'off' : 'on';
  return doc;
}
