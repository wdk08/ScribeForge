import { rightMarginBounds } from './right-margins.js';
/** The document is JSON-serializable data, never rendered HTML. */
export const ELEMENT_TYPES = Object.freeze([
  'titleField', 'scene', 'action', 'character', 'dialogue', 'parenthetical',
  'transition', 'centered', 'lyric', 'section', 'synopsis', 'note', 'boneyard',
  'pageBreak', 'whitespace',
]);

export function newId() {
  return globalThis.crypto?.randomUUID?.() ?? `sf-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function createElement(type, text = '', attributes = {}) {
  if (!ELEMENT_TYPES.includes(type)) throw new TypeError(`Unknown element type: ${type}`);
  if (typeof text !== 'string') throw new TypeError('Element text must be a string.');
  return { ...attributes, id: newId(), type, text };
}

export function createDocument({ title = 'Untitled Screenplay', elements = [] } = {}) {
  const doc = { id: newId(), version: 1, title, elements: structuredClone(elements), diagnostics: [] };
  validateDocument(doc);
  return doc;
}

export function validateDocument(doc) {
  if (!doc || doc.version !== 1 || typeof doc.id !== 'string' || !Array.isArray(doc.elements)) {
    throw new TypeError('Invalid ScriptForge document.');
  }
  const ids = new Set();
  for (const el of doc.elements) {
    if (!ELEMENT_TYPES.includes(el.type) || typeof el.text !== 'string' || !el.id || ids.has(el.id)) {
      throw new TypeError('Invalid element or duplicate element identifier.');
    }
    ids.add(el.id);
    if (el.type === 'titleField' && !/^[\p{L}][\p{L} \d_-]*$/u.test(el.key ?? '')) {
      throw new TypeError('Title fields require a valid key.');
    }
    if (el.type === 'section' && (!Number.isInteger(el.depth) || el.depth < 1)) {
      throw new TypeError('Section depth must be a positive integer.');
    }
    if (el.sceneNumber != null && !/^[\w.-]+$/.test(el.sceneNumber)) {
      throw new TypeError('Invalid scene number.');
    }
  }
  const dual = dualElementIds(doc);
  for (const el of doc.elements) if (el.rightMarginOffsetPt !== undefined) {
    const bounds = rightMarginBounds(el, dual.has(el.id));
    if (['titleField','whitespace','pageBreak'].includes(el.type) || !Number.isInteger(el.rightMarginOffsetPt) || el.rightMarginOffsetPt === 0 || el.rightMarginOffsetPt < bounds.min || el.rightMarginOffsetPt > bounds.max) throw new TypeError('Invalid element right-margin override.');
  }
  return doc;
}

export function dualElementIds(doc) {
  const groups = dialogueGroups(doc), byId = new Map(groups.map(g => [g.id,g])), ids = new Set();
  for (const group of groups) if (group.partnerId) for (const member of [group,byId.get(group.partnerId)]) {
    ids.add(member.id); for (const el of member.elements) ids.add(el.id);
  }
  return ids;
}

/** Pure updates support future undo history without DOM or storage dependencies. */
export function updateElement(doc, id, changes) {
  validateDocument(doc);
  if (!doc.elements.some(el => el.id === id)) throw new RangeError('Element was not found.');
  if ('id' in changes || 'source' in changes) throw new TypeError('Element identity and source provenance cannot be edited.');
  const next = structuredClone(doc);
  next.elements = next.elements.map(el => el.id === id ? { ...el, ...changes } : el);
  return validateDocument(next);
}

/** Semantic projection for import/export checks; excludes presentation and provenance. */
export function meaningfulContent(doc) {
  return doc.elements.filter(el => el.type !== 'whitespace').map(el => ({
    type: el.type, text: el.text,
    ...(el.type === 'titleField' ? { key: el.key } : {}),
    ...(el.type === 'scene' ? { sceneNumber: el.sceneNumber ?? null } : {}),
    ...(el.type === 'section' ? { depth: el.depth } : {}),
    ...(el.type === 'character' ? { dual: Boolean(el.dual) } : {}),
  }));
}

/** Renderer/table-read clients can resolve simultaneous speech without HTML. */
export function dialogueGroups(doc) {
  const groups = [];
  let group = null;
  for (const el of doc.elements) {
    if (el.type === 'character') {
      group = { id: el.id, character: el, elements: [] };
      const previous = groups.at(-1);
      if (el.dual && previous && previous.endIndex === groups.length - 1) group.partnerId = previous.id;
      groups.push(group);
    } else if (group && ['dialogue', 'parenthetical', 'lyric'].includes(el.type)) {
      group.elements.push(el);
    } else if (!['whitespace', 'note', 'boneyard'].includes(el.type)) {
      group = null;
    }
    // Only adjacent dialogue blocks can form a simultaneous pair.
    if (group) group.endIndex = groups.length - 1;
    else if (groups.length) delete groups.at(-1).endIndex;
  }
  return groups.map(({ endIndex, ...group }) => group);
}
