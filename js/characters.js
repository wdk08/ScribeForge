import { validateDocument } from './document.js';
import { characterIdentity, loadTableReadPreferences, tableReadPreferenceKey } from './table-read-model.js';

export function detectedCharacters(doc) {
  return [...new Map(doc.elements.filter(el => el.type === 'character').map(el => { const character = characterIdentity(el.text); return [character.id, character]; })).values()];
}
const word = /[\p{L}\p{M}\p{N}\p{Pc}\u200c\u200d]/u;
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Keep a source offset for each visible character; never replace inline notes,
// comments, escapes or emphasis delimiters as if they were character names.
function projection(text) {
  let plain = ''; const offsets = [];
  const append = (char, offset) => { plain += char; offsets.push(offset); };
  function visit(start, end) {
    for (let i = start; i < end;) {
      if (text[i] === '\\' && /[\\*_\[\]]/.test(text[i + 1] ?? '')) { append(text[i + 1], i + 1); i += 2; continue; }
      const hidden = text.startsWith('[[', i) ? ']]' : text.startsWith('/*', i) ? '*/' : null;
      if (hidden) {
        const close = text.indexOf(hidden, i + 2);
        if (close >= 0 && close < end && (hidden === '*/' || !/\n\n/.test(text.slice(i + 2, close)))) { append('\ufffc', i); i = close + 2; continue; }
      }
      const marker = ['***', '**', '*', '_'].find(m => text.startsWith(m, i));
      if (marker && text[i + marker.length] && !/\s/.test(text[i + marker.length])) {
        let close = i + marker.length;
        while ((close = text.indexOf(marker, close)) >= 0 && close < end) {
          let slashes = 0; for (let p = close - 1; p >= 0 && text[p] === '\\'; p--) slashes++;
          if (slashes % 2 === 0 && !/\s/.test(text[close - 1])) { if (marker === '**' && text.startsWith('***', close)) close++; break; }
          close += marker.length;
        }
        if (close >= 0 && close + marker.length <= end && !/[\r\n]/.test(text.slice(i, close))) { visit(i + marker.length, close); i = close + marker.length; continue; }
      }
      append(text[i], i); i++;
    }
  }
  visit(0, text.length); return { plain, offsets };
}
function replacementCase(before, after) {
  const letters = [...before].filter(char => /\p{L}/u.test(char));
  if (before === before.toUpperCase()) return after.toUpperCase();
  if (before === before.toLowerCase()) return after.toLowerCase();
  const title = value => value.toLowerCase().replace(/(^|[^\p{L}\p{M}\p{N}])(\p{L})/gu, (_, prefix, char) => prefix + char.toUpperCase());
  if (before === title(before)) return title(after);
  let index = 0;
  return [...after].map(char => {
    if (!/\p{L}/u.test(char)) return char;
    const pattern = letters[Math.min(index++, letters.length - 1)];
    return pattern === pattern.toUpperCase() ? char.toUpperCase() : char.toLowerCase();
  }).join('');
}
function sourceEdits(offsets, start, end, after) {
  const runs = [];
  for (let i = start; i < end; i++) {
    const offset = offsets[i];
    if (runs.at(-1)?.end === offset) runs.at(-1).end++;
    else runs.push({ start: offset, end: offset + 1 });
  }
  const chars = [...after];
  if (chars.length < runs.length) throw new Error('The new name is too short to preserve interleaved emphasis in a matching name. Simplify that name’s inline formatting before renaming.');
  let used = 0, covered = 0; const length = end - start;
  return runs.map((run, index) => {
    covered += run.end - run.start;
    const limit = index === runs.length - 1 ? chars.length : Math.max(used + 1, Math.min(chars.length - (runs.length - index - 1), Math.round(chars.length * covered / length)));
    const replacement = chars.slice(used, limit).join(''); used = limit;
    return { ...run, after: replacement };
  });
}
function matches(text, name, replacement, uppercase = false) {
  const { plain, offsets } = projection(text), results = [];
  const pattern = new RegExp(name.split(/\s+/u).map(escape).join('\\s+'), 'giu');
  for (const match of plain.matchAll(pattern)) {
    const start = match.index, end = start + match[0].length;
    const left = [...plain.slice(0, start)].at(-1), right = [...plain.slice(end)][0];
    if ((left && word.test(left)) || (right && word.test(right))) continue;
    const after = uppercase ? replacement : replacementCase(match[0], replacement);
    results.push({ start: offsets[start], end: offsets[end - 1] + 1, before: match[0], after, edits: sourceEdits(offsets, start, end, after) });
  }
  return results;
}
export function previewCharacterRename(doc, from, input) {
  const characters = detectedCharacters(doc), source = characters.find(character => character.id === characterIdentity(from).id);
  if (!source) throw new Error('Choose an existing character.');
  const to = input.trim().replace(/\s+/gu, ' ').toUpperCase();
  if (!to || to.length > 100 || !/\p{L}/u.test(to) || /[\r\n*_[\]\\^#@></()]/u.test(input)) throw new Error('Enter a name of up to 100 characters, without Fountain markup, extensions, or line breaks.');
  const target = characterIdentity(to);
  if (source.id === target.id) throw new Error('Enter a different character name.');
  if (characters.some(character => character.id === target.id)) throw new Error(`A character named ${to} already exists. Choose another name to keep their cues and voices separate.`);
  const cues = [], mentions = [];
  for (const el of doc.elements) {
    if (el.type === 'character' && characterIdentity(el.text).id === source.id) {
      // Extensions are outside the base-name match and remain byte-for-byte intact.
      const base = el.text.replace(/(?:\s*\([^()]*\))+\s*$/u, '');
      const found = matches(base, source.name, to, true);
      if (found.length !== 1) throw new Error(`The cue ${el.text} cannot be renamed safely. Check its name formatting first.`);
      cues.push({ elementId: el.id, edits: found[0].edits });
    } else if (['scene', 'action', 'dialogue', 'parenthetical', 'lyric'].includes(el.type)) {
      for (const match of matches(el.text, source.name, to)) mentions.push({ ...match, id: `${el.id}:${match.start}:${match.end}`, elementId: el.id, type: el.type, context: el.text });
    }
  }
  return { from: source.name, to, fromId: source.id, toId: target.id, cues, mentions, signature: JSON.stringify(doc) };
}
export function renameCharacter(doc, selection, command) {
  if (command.signature !== JSON.stringify(doc)) throw new Error('The screenplay changed after this preview. Review the rename again.');
  const plan = previewCharacterRename(doc, command.from, command.to), selected = new Set(command.mentions);
  const known = new Set(plan.mentions.map(match => match.id));
  if ([...selected].some(id => !known.has(id))) throw new Error('A reviewed mention is no longer available. Review the rename again.');
  const result = structuredClone(doc), next = structuredClone(selection), changes = new Map();
  for (const occurrence of [...plan.cues, ...plan.mentions.filter(match => selected.has(match.id))]) {
    changes.set(occurrence.elementId, [...(changes.get(occurrence.elementId) ?? []), ...occurrence.edits]);
  }
  for (const el of result.elements) {
    const edits = changes.get(el.id); if (!edits) continue;
    const ascending = edits.sort((a, b) => a.start - b.start);
    for (const endpoint of ['anchor', 'focus']) if (next[endpoint].id === el.id) {
      const offset = next[endpoint].offset; let delta = 0;
      for (const edit of ascending) {
        if (offset >= edit.end) delta += edit.after.length - (edit.end - edit.start);
        else if (offset > edit.start) { delta += Math.min(offset - edit.start, edit.after.length) - (offset - edit.start); break; }
        else break;
      }
      next[endpoint].offset = offset + delta;
    }
    for (const edit of [...ascending].reverse()) el.text = el.text.slice(0, edit.start) + edit.after + el.text.slice(edit.end);
  }
  validateDocument(result); return { document: result, selection: next };
}
export async function carryCharacterVoice(repository, documentId, from, to) {
  const prefs = await loadTableReadPreferences(repository, documentId), oldId = characterIdentity(from).id, newId = characterIdentity(to).id;
  // Retain the old key: undo/redo can restore either name without losing a voice.
  if (prefs.speakers[oldId]) prefs.speakers[newId] = { ...prefs.speakers[oldId] };
  else delete prefs.speakers[newId];
  await repository.setPreference(tableReadPreferenceKey(documentId), prefs);
}
