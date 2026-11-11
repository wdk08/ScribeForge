export const SEARCH_TYPES = ['scene', 'action', 'character', 'parenthetical', 'dialogue', 'transition'];
const word = char => Boolean(char && /[\p{L}\p{N}\p{M}_]/u.test(char));
export function findMatches(doc, query, { caseSensitive = false, wholeWord = false, types = SEARCH_TYPES } = {}) {
  if (!query) return [];
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(escaped, caseSensitive ? 'gu' : 'giu');
  const result = [], included = new Set(types);
  for (const el of doc.elements) if (included.has(el.type)) {
    for (const match of el.text.matchAll(pattern)) {
      const start = match.index, end = start + match[0].length;
      const before = wholeWord ? [...el.text.slice(Math.max(0, start - 2), start)].at(-1) : '', after = wholeWord ? [...el.text.slice(end, end + 2)][0] : '';
      if (!wholeWord || (!word(before) && !word(after))) result.push({ id: el.id, start, end, text: match[0] });
    }
  }
  return result;
}
export function replaceMatches(document, matches, replacement) {
  const doc = structuredClone(document), byId = new Map();
  for (const match of matches) {
    if (!byId.has(match.id)) byId.set(match.id, []);
    byId.get(match.id).push(match);
  }
  for (const el of doc.elements) if (byId.has(el.id)) {
    for (const match of byId.get(el.id).sort((a, b) => b.start - a.start)) {
      if (el.text.slice(match.start, match.end) !== match.text) throw new Error('Search results changed. Search again.');
      el.text = el.text.slice(0, match.start) + replacement + el.text.slice(match.end);
    }
  }
  return doc;
}
