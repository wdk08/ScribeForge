const starter = {
  Fuck: 'fuck|fucks|fucked|fucking|fucker|fuckers|motherfucker|motherfuckers|motherfucking',
  Shit: 'shit|shits|shitting|shitty|bullshit|bullshitting|horseshit|batshit',
  Ass: 'ass|asses|asshole|assholes|dumbass|dumbasses|jackass|jackasses|badass|badasses',
  Bitch: 'bitch|bitches|bitching|bitchy|son of a bitch|sons of bitches',
  Damn: 'damn|damned|dammit|damnit|goddamn|goddammit|goddamned',
  Hell: 'hell|hellish|what the hell|hell no',
  Crap: 'crap|craps|crappy|crapping|holy crap',
  Bastard: 'bastard|bastards',
  Piss: 'piss|pissed|pissing|pisses|piss off|pissed off',
};

export function defaultProfanityGroups() {
  return Object.entries(starter).map(([name, words]) => ({
    name, enabled: true,
    variations: words.split('|').map(text => ({ text, enabled: true })),
  }));
}

export const variationKey = text => text.trim().replace(/[‘’]/g, "'").replace(/\s+/gu, ' ').toLowerCase();
const word = '[\\p{L}\\p{M}\\p{N}\\p{Pc}]';
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function analyzeProfanity(index, groups) {
  const owners = new Map();
  groups.forEach((group, groupIndex) => {
    if (!group.enabled) return;
    group.variations.forEach((variation, variationIndex) => {
      const key = variationKey(variation.text);
      if (variation.enabled && key && !owners.has(key)) owners.set(key, { groupIndex, variationIndex });
    });
  });
  const patterns = [...owners.keys()].sort((a, b) => b.length - a.length).map(key =>
    key.split(/( |')/).map(part => part === ' ' ? '\\s+' : part === "'" ? "['‘’]" : escape(part)).join(''));
  const apostrophe = "['‘’]";
  const previousWord = new RegExp(word + '(?:' + apostrophe + ')?$', 'u');
  const regex = patterns.length ? new RegExp(
    '(?=(' + patterns.join('|') + ')(?!' + word + '|' + apostrophe + word + '))', 'giu') : null;
  const matches = [], chapters = [{ id: '', label: 'Before first chapter' }];
  const variationCounts = groups.map(group => group.variations.map(() => 0));
  if (!regex) return { matches, chapters, variationCounts, unique: 0 };
  const headings = new Map(index.chapters.map(chapter => [chapter.pos, chapter.title]));
  for (const { pos, text } of index.blocks) {
    if (headings.has(pos)) chapters.push({ id: String(pos), label: headings.get(pos) });
    const candidates = [...text.matchAll(regex)].sort((a, b) => b[1].length - a[1].length || a.index - b.index);
    const used = new Uint8Array(text.length), found = [];
    for (const candidate of candidates) {
      const start = candidate.index, end = start + candidate[1].length;
      // Check the left boundary without lookbehind for older macOS WebViews.
      if (previousWord.test(text.slice(Math.max(0, start - 4), start)) || used.subarray(start, end).includes(1)) continue;
      const owner = owners.get(variationKey(candidate[1]));
      if (!owner) continue;
      used.fill(1, start, end);
      variationCounts[owner.groupIndex][owner.variationIndex]++;
      found.push({ ...owner, chapterId: chapters.at(-1).id,
        start: pos + 1 + start, end: pos + 1 + end, text: candidate[1] });
    }
    matches.push(...found.sort((a, b) => a.start - b.start));
  }
  return { matches, chapters, variationCounts, unique: variationCounts.flat().filter(Boolean).length };
}
