import { dialogueGroups } from './document.js';
import { characterIdentity, spokenText } from './table-read-model.js';
export function dialogueStatistics(doc, sort = 'words', ascending = sort === 'name') {
  const characters = new Map();
  for (const group of dialogueGroups(doc)) {
    const speech = group.elements.filter(el => ['dialogue', 'lyric'].includes(el.type) && spokenText(el.text));
    if (!speech.length) continue;
    const identity = characterIdentity(group.character.text);
    const row = characters.get(identity.id) ?? { ...identity, blocks: 0, words: 0 };
    // Each cue's speech is a block, including speech split by parentheticals.
    row.blocks++;
    row.words += speech.reduce((sum, el) => sum + (spokenText(el.text).match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)?.length ?? 0), 0);
    characters.set(row.id, row);
  }
  const rows = [...characters.values()], words = rows.reduce((n, row) => n + row.words, 0);
  for (const row of rows) row.percent = words ? row.words / words * 100 : 0;
  rows.sort((a, b) => (ascending ? 1 : -1) * (sort === 'name' ? a.name.localeCompare(b.name) : a[sort] - b[sort]) || a.name.localeCompare(b.name));
  return { rows, words, characters: rows.length };
}
