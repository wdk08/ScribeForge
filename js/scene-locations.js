import { validateDocument } from './document.js';
const prefixPattern = /^(INT\.\s*\/\s*EXT\.?|EXT\.\s*\/\s*INT\.?|INT\s*\/\s*EXT\.?|EXT\s*\/\s*INT\.?|I\/E\.|I\/E(?=\s)|INT\.|EXT\.|EST\.|INT(?=\s)|EXT(?=\s)|EST(?=\s))/i;
const clean = text => text.trim().replace(/\s+/gu, ' ');
const key = text => clean(text).toLocaleUpperCase('en-US');
const qualifiers = new Set(['DAY', 'NIGHT', 'DAWN', 'DUSK', 'MORNING', 'AFTERNOON', 'EVENING', 'SUNRISE', 'SUNSET', 'NOON', 'MIDNIGHT', 'CONTINUOUS', 'CONTINUOUS ACTION', 'LATER', 'MOMENTS LATER', 'A MOMENT LATER', 'SAME TIME', 'SAME', 'DAY/NIGHT', 'NIGHT/DAY', 'FLASHBACK', 'PRESENT DAY']);
function isQualifier(value) {
  const text = key(value);
  return qualifiers.has(text) || /^(?:(?:THE )?NEXT|EARLY|LATE|FOLLOWING|PREVIOUS|SAME) (?:DAY|NIGHT|MORNING|AFTERNOON|EVENING)$/.test(text);
}
export function sceneLocation(text) {
  const leading = text.length - text.trimStart().length, source = text.trimStart(), match = source.match(prefixPattern);
  if (!match) return null;
  const prefix = clean(match[0]), kind = prefix.toUpperCase().replace(/[.\s]/g, ''), bodyStart = leading + match[0].length;
  const body = text.slice(bodyStart); let cut = body.length, qualifier = null;
  const separators = [...body.matchAll(/\s+[-–—](?:\s+|$)/gu)];
  for (const separator of separators.reverse()) {
    const suffix = clean(body.slice(separator.index + separator[0].length));
    if (!suffix || isQualifier(suffix)) { cut = separator.index; qualifier = suffix; break; }
  }
  const location = clean(body.slice(0, cut));
  const label = `${prefix}${location ? ` ${location}` : ''}`;
  const locationEnd = bodyStart + body.slice(0, cut).trimEnd().length;
  return { prefix, kind, location, label, qualifier, locationEnd, key: `${kind}:${key(location)}` };
}
export const hasScenePrefix = text => Boolean(sceneLocation(text));

/** Re-extract only changed headings. The document remains the sole persistent index. */
export class SceneLocationIndex {
  constructor() { this.document = null; this.records = new Map(); this.locations = []; this.order = ''; }
  update(doc) {
    if (doc === this.document) return;
    const records = new Map(); let changed = false;
    for (const el of doc.elements) if (el.type === 'scene') {
      const previous = this.records.get(el.id);
      if (!previous || previous.text !== el.text) { records.set(el.id, { text: el.text, location: sceneLocation(el.text) }); changed = true; }
      else records.set(el.id, previous);
    }
    const order = JSON.stringify([...records.keys()]);
    if (changed || order !== this.order) {
      const groups = new Map(); let position = 0;
      for (const { location } of records.values()) {
        if (location?.location) {
          const existing = groups.get(location.key);
          if (existing) existing.count++;
          else groups.set(location.key, { label: location.label, kind: location.kind, location: location.location, key: location.key, count: 1, order: position });
        }
        position++;
      }
      this.locations = [...groups.values()];
    }
    this.document = doc; this.records = records; this.order = order;
  }
  suggest(doc, text) {
    this.update(doc); const query = sceneLocation(text); if (!query) return [];
    const fragment = key(query.location);
    return this.locations.filter(location => location.kind === query.kind && key(location.location).startsWith(fragment) && key(location.location) !== fragment)
      .sort((a, b) => b.count - a.count || a.order - b.order)
      .map(location => ({...location,label:key(location.label),location:key(location.location)}));
  }
}
export function completeSceneLocation(doc, selection, command) {
  const result = structuredClone(doc), el = result.elements.find(el => el.id === command.elementId);
  if (!el || el.type !== 'scene' || el.text !== command.before) throw new Error('The heading changed. Choose the location again.');
  const current = sceneLocation(el.text), chosen = sceneLocation(command.location);
  if (!current || !chosen?.location || current.kind !== chosen.kind) throw new Error('Choose a compatible scene location.');
  const label = key(chosen.label);
  el.text = `${label} - ${key(current.qualifier ?? '')}`;
  const point = { id: el.id, offset: label.length + 3 };
  validateDocument(result); return { document: result, selection: { anchor: { ...point }, focus: { ...point } } };
}
