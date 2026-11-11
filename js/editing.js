import { rightMarginBounds } from './right-margins.js';
import { dualElementIds } from './document.js';
import { toggleContinuation } from './continuations.js';
import { replaceMatches } from './search.js';
import { changeTitlePage } from './title-page.js';
import { screenplayPaste, insertScreenplayPaste, normalizeScreenplayClipboard, classifyReturnFragment } from './screenplay-paste.js';
import { createElement, validateDocument, dialogueGroups } from './document.js';
import { screenplaySettings, changeScreenplaySettings, redoSceneNumbers } from './screenplay-settings.js';
import { hasScenePrefix, completeSceneLocation } from './scene-locations.js';
import { renameCharacter } from './characters.js';
import { isCommonTransition } from './transitions.js';

export const EDIT_TYPES = ['scene', 'action', 'character', 'parenthetical', 'dialogue', 'transition'];
export const editableElements = doc => doc.elements.filter(el => !['whitespace', 'pageBreak', 'titleField'].includes(el.type));
const point = (id, offset) => ({ id, offset });
export const caret = (id, offset = 0) => ({ anchor: point(id, offset), focus: point(id, offset) });

export function orderedSelection(doc, selection) {
  const els = editableElements(doc);
  const a = els.findIndex(el => el.id === selection.anchor.id);
  const b = els.findIndex(el => el.id === selection.focus.id);
  if (a < 0 || b < 0) throw new RangeError('Selection references a missing element.');
  const clamp = (p, index) => point(p.id, Math.max(0, Math.min(els[index].text.length, p.offset)));
  const anchor = clamp(selection.anchor, a), focus = clamp(selection.focus, b);
  return a < b || (a === b && anchor.offset <= focus.offset)
    ? { start: anchor, end: focus, first: a, last: b, elements: els }
    : { start: focus, end: anchor, first: b, last: a, elements: els };
}

export function nextType(el) {
  if (el.type === 'character' || el.type === 'parenthetical') return 'dialogue';
  return 'action';
}

function replaceRange(doc, selection, insertion = '') {
  const range = orderedSelection(doc, selection);
  const first = range.elements[range.first], last = range.elements[range.last];
  const offset = range.start.offset;
  if (range.first !== range.last && offset === 0 && range.end.offset < last.text.length) {
    // The first paragraph was entirely selected. Its format must not be
    // transferred onto surviving speech (or other text) from the last paragraph.
    const begin = doc.elements.findIndex(el => el.id === first.id), end = doc.elements.findIndex(el => el.id === last.id);
    last.text = insertion + last.text.slice(range.end.offset);
    doc.elements.splice(begin, end - begin);
    return caret(last.id, insertion.length);
  }
  first.text = first.text.slice(0, offset) + insertion + last.text.slice(range.end.offset);
  if (range.first !== range.last) {
    const begin = doc.elements.findIndex(el => el.id === first.id);
    const end = doc.elements.findIndex(el => el.id === last.id);
    doc.elements.splice(begin + 1, end - begin);
  }
  return caret(first.id, offset + insertion.length);
}

function insertAfter(doc, el, added) {
  const index = doc.elements.findIndex(item => item.id === el.id);
  const separator = ['dialogue', 'parenthetical'].includes(added.type) ? [] : [createElement('whitespace', '\n')];
  doc.elements.splice(index + 1, 0, ...separator, added);
}

function lineAt(text, offset) {
  const start = offset ? text.lastIndexOf('\n', offset - 1) + 1 : 0;
  const newline = text.indexOf('\n', offset);
  const end = newline < 0 ? text.length : newline;
  return { start, end, text: text.slice(start, end) };
}

const blankLine = (el, text) => !(el.type === 'parenthetical' ? text.replace(/^\(\s*\)$/, '') : text).trim();

const corrections = new Map(Object.entries({ teh: 'the', adn: 'and', recieve: 'receive', seperate: 'separate',
  definately: 'definitely', occured: 'occurred', untill: 'until', becuase: 'because', thier: 'their',
  wierd: 'weird', acheive: 'achieve', tommorow: 'tomorrow' }));

function capitalizeInsertion(text, prefix) {
  let needsCapital = !/\p{L}/u.test(prefix.slice(prefix.lastIndexOf('\n') + 1));
  return [...text].map(char => {
    if (char === '\n') { needsCapital = true; return char; }
    if (needsCapital && /\p{L}/u.test(char)) { needsCapital = false; return char.toUpperCase(); }
    return char;
  }).join('');
}

function correctWord(doc, next, completed = false) {
  const el = doc.elements.find(item => item.id === next.focus.id);
  if (!['action', 'dialogue', 'parenthetical'].includes(el?.type)) return next;
  const at = next.focus.offset;
  const match = el.text.slice(0, at).match(/(^|[^\p{L}'’])([\p{L}]+)([\s.,!?;:)]*)$/u);
  if (!match || (!match[3] && !completed)) return next;
  const word = match[2], corrected = corrections.get(word.toLowerCase());
  if (!corrected) return next;
  const replacement = word === word.toUpperCase() ? corrected.toUpperCase()
    : word[0] === word[0].toUpperCase() ? corrected[0].toUpperCase() + corrected.slice(1) : corrected;
  const start = at - match[3].length - word.length;
  el.text = el.text.slice(0, start) + replacement + el.text.slice(start + word.length);
  return caret(el.id, at + replacement.length - word.length);
}

function recognizeCharacter(doc, el, selection) {
  if (el.type !== 'action' || selection.focus.id !== el.id) return { el, selection };
  const key = text => text.replace(/\s*\([^)]*\)\s*$/, '').trim().toUpperCase();
  const line = lineAt(el.text, selection.focus.offset);
  const name = line.text.trim().toUpperCase();
  if (!name) return { el, selection };
  const index = doc.elements.indexOf(el);
  const known = dialogueGroups(doc).some(group => doc.elements.indexOf(group.character) < index
    && key(group.character.text) === name && group.elements.some(item => item.type === 'dialogue' && item.text.trim()));
  if (!known) return { el, selection };
  const prefix = el.text.slice(0, line.start).replace(/\n$/, '');
  const suffix = el.text.slice(line.end).replace(/^\n/, '');
  let cue = el;
  if (prefix) {
    el.text = prefix; cue = createElement('character', name); insertAfter(doc, el, cue);
  } else { el.type = 'character'; el.text = name; delete el.dual; }
  if (suffix) insertAfter(doc, cue, createElement('action', suffix));
  return { el: cue, selection: caret(cue.id, name.length) };
}

function advanceLine(doc, el, selection, type, forceInsert = false) {
  const originalType = el.type;
  const line = lineAt(el.text, selection.focus.offset);
  const text = type === 'parenthetical' ? '()' : '';
  if (!forceInsert && blankLine(el, line.text)) {
    // Only a blank drafting line may be replaced; preserve all surrounding text.
    const prefix = el.text.slice(0, line.start).replace(/\n$/, '');
    const suffix = el.text.slice(line.end).replace(/^\n/, '');
    let target = el;
    if (prefix) {
      el.text = prefix;
      target = createElement(type, text); insertAfter(doc, el, target);
    } else {
      el.type = type; el.text = text;
      delete el.dual; delete el.continuation; delete el.sceneNumber; delete el.key; delete el.depth;
    }
    if (suffix) insertAfter(doc, target, createElement(originalType, suffix));
    return caret(target.id, type === 'parenthetical' ? 1 : 0);
  }
  // Tab and non-Action Enter leave filled elements intact.
  const added = createElement(type, text);
  insertAfter(doc, el, added);
  return caret(added.id, type === 'parenthetical' ? 1 : 0);
}

function finishTyping(doc, next, original) {
  const originals = new Map(original.elements.map(el => [el.id, el]));
  for (const item of editableElements(doc)) {
    const before = originals.get(item.id);
    if (['character', 'transition'].includes(item.type) && (before?.type !== item.type || before.text !== item.text)) {
      const text = item.text;
      item.text = text.toUpperCase();
      for (const endpoint of ['anchor', 'focus']) if (next[endpoint].id === item.id) {
        next[endpoint].offset = text.slice(0, next[endpoint].offset).toUpperCase().length;
      }
    }
    if (item.type === 'parenthetical' && !before?.text && item.text && !item.text.startsWith('(')) {
      item.text = `(${item.text})`;
      for (const endpoint of ['anchor', 'focus']) if (next[endpoint].id === item.id) next[endpoint].offset++;
    }
  }
}

function clearEmptyParenthetical(doc, next) {
  const item = doc.elements.find(el => el.id === next.focus.id);
  if (item?.type === 'parenthetical' && /^\(\s*\)$/.test(item.text)) {
    item.text = ''; next = caret(item.id);
  }
  return next;
}

function recognizeTypedScene(doc, selection, original, originalSelection) {
  const el = doc.elements.find(item => item.id === selection.focus.id);
  if (el?.type !== 'action') return selection;
  const line = lineAt(el.text, selection.focus.offset);
  const scenePrefix = { test: hasScenePrefix };
  if (!scenePrefix.test(line.text)) return selection;
  const before = original.elements.find(item => item.id === el.id);
  // A manually forced Action remains Action when its prefix was already present.
  if (before && scenePrefix.test(lineAt(before.text, orderedSelection(original, originalSelection).start.offset).text)) return selection;
  const leading = line.text.length - line.text.trimStart().length;
  const prefix = el.text.slice(0, line.start).replace(/\n$/, '');
  const suffix = el.text.slice(line.end).replace(/^\n/, '');
  let scene = el;
  if (prefix) {
    el.text = prefix;
    scene = createElement('scene', line.text.trimStart()); insertAfter(doc, el, scene);
  } else { el.type = 'scene'; el.text = line.text.trimStart(); }
  if (suffix) insertAfter(doc, scene, createElement('action', suffix));
  return caret(scene.id, Math.max(0, selection.focus.offset - line.start - leading));
}

function recognizeTypedTransition(doc, selection) {
  const el = doc.elements.find(item => item.id === selection.focus.id);
  if (el?.type !== 'action') return selection;
  const line = lineAt(el.text, selection.focus.offset);
  if (!isCommonTransition(line.text)) return selection;
  const prefix = el.text.slice(0, line.start).replace(/\n$/, '');
  const suffix = el.text.slice(line.end).replace(/^\n/, '');
  let transition = el;
  if (prefix) {
    el.text = prefix; transition = createElement('transition', line.text); insertAfter(doc, el, transition);
  } else el.type = 'transition';
  transition.text = line.text;
  if (suffix) insertAfter(doc, transition, createElement('action', suffix));
  return caret(transition.id, selection.focus.offset - line.start);
}

/** All changes are pure model transactions; the browser only supplies intent and offsets. */
export function editDocument(document, selection, command) {
  if (command.type === 'toggleContinuation') {
    const doc = toggleContinuation(document, command.id), next = structuredClone(selection);
    const cue = doc.elements.find(el => el.id === command.id);
    for (const point of [next.anchor, next.focus]) if (point.id === cue?.id) point.offset = Math.min(point.offset, cue.text.length);
    return { document: doc, selection: next };
  }
  if (command.type === 'replaceMatches') {
    const doc = replaceMatches(document, command.matches, command.replacement);
    const next = structuredClone(selection);
    for (const point of [next.anchor, next.focus]) { const el = doc.elements.find(el => el.id === point.id); if (el) point.offset = Math.min(point.offset, el.text.length); }
    return { document: doc, selection: next };
  }
  if (command.type === 'restoreVersion') {
    const doc = structuredClone(validateDocument(command.document)), el = doc.elements.find(el => !['titleField', 'whitespace', 'pageBreak'].includes(el.type));
    if (!el) { const action = createElement('action', ''); doc.elements.push(action); return { document: doc, selection: caret(action.id) }; }
    return { document: doc, selection: caret(el.id) };
  }
  if (command.type === 'titlePage') return { document: changeTitlePage(document, command.field, command.value), selection: structuredClone(selection) };
  if (command.type === 'completeSceneLocation') return completeSceneLocation(document, selection, command);
  if (command.type === 'renameCharacter') return renameCharacter(document, selection, command);
  if (command.type === 'settings') return { document: changeScreenplaySettings(document, command.changes), selection: structuredClone(selection) };
  if (command.type === 'renumber') return { document: redoSceneNumbers(structuredClone(document)), selection: structuredClone(selection) };
  const doc = structuredClone(document);
  let next = structuredClone(selection);
  const range = orderedSelection(doc, next);
  let el = range.elements[range.first];
  const collapsed = range.first === range.last && range.start.offset === range.end.offset;
  // Typing inside an automatically closed parenthetical leaves the caret just
  // before its closing bracket; Return there still advances to Dialogue.
  const parentheticalEnd = el.type === 'parenthetical' && el.text.endsWith(')')
    && range.start.offset === el.text.length - 1;
  const smartReturn = command.type === 'enter' && (!collapsed
    || (range.start.offset > 0 && range.start.offset < el.text.length && !parentheticalEnd));
  switch (command.type) {
    case 'rightMargin': {
      if (!command.reset && ![5,-5].includes(command.delta)) throw new TypeError('Margins change by exactly five points.');
      const dual = dualElementIds(doc);
      for (const item of range.elements.slice(range.first, range.last + 1)) {
        const bounds = rightMarginBounds(item, dual.has(item.id));
        const offset = command.reset ? 0 : Math.max(bounds.min, Math.min(bounds.max, (item.rightMarginOffsetPt ?? 0) + command.delta));
        if (offset) item.rightMarginOffsetPt = offset; else delete item.rightMarginOffsetPt;
      }
      break;
    }
    case 'lineBreak':
      next = replaceRange(doc, next, '\n');
      break;
    case 'insert':
      next = replaceRange(doc, next, el.type === 'parenthetical' ? command.text.replace(/\r\n|\r/g, '\n') : capitalizeInsertion(command.text.replace(/\r\n|\r/g, '\n'), el.text.slice(0, range.start.offset)));
      if (command.text) next = correctWord(doc, next);
      break;
    case 'enter': {
      if (smartReturn) {
        const last = range.elements[range.last];
        const enclosed = el === last && el.type === 'parenthetical' && /^\([\s\S]*\)$/.test(el.text);
        const before = el.text.slice(0, enclosed ? Math.max(1, range.start.offset) : range.start.offset);
        const text = last.text.slice(enclosed ? Math.min(range.end.offset, last.text.length - 1) : range.end.offset, enclosed ? -1 : undefined);
        const type = classifyReturnFragment(text, { originalType: last.type, before,
          previous: range.elements[range.first - 1], following: range.elements[range.last + 1],
          characters: doc.elements.filter(item => item.type === 'character').map(item => item.text) });
        const added = createElement(type, text);
        if (type === last.type && last.rightMarginOffsetPt) added.rightMarginOffsetPt = last.rightMarginOffsetPt;
        const begin = doc.elements.indexOf(el), end = doc.elements.indexOf(last);
        el.text = before + (enclosed ? ')' : '');
        doc.elements.splice(begin + 1, end - begin);
        insertAfter(doc, el, added);
        next = caret(added.id);
        break;
      }
      const recognized = recognizeCharacter(doc, el, next);
      el = recognized.el; next = recognized.selection;
      if (collapsed && next.focus.offset === el.text.length) next = correctWord(doc, next, true);
      if (el.type === 'action' && el.text.length) {
        next = replaceRange(doc, next);
        el = doc.elements.find(item => item.id === next.focus.id);
        if (el.type === 'action') {
          const at = next.focus.offset, added = createElement('action', el.text.slice(at));
          if (el.rightMarginOffsetPt) added.rightMarginOffsetPt = el.rightMarginOffsetPt;
          el.text = el.text.slice(0, at);
          insertAfter(doc, el, added);
          next = caret(added.id);
          break;
        }
      }
      next = advanceLine(doc, el, next, nextType(el));
      break;
    }
    case 'backspace':
    case 'delete': {
      if (!collapsed) { next = clearEmptyParenthetical(doc, replaceRange(doc, next)); break; }
      const backwards = command.type === 'backspace';
      const at = range.start.offset;
      if (el.type === 'parenthetical' && blankLine(el, el.text) && el.text) {
        el.text = ''; next = caret(el.id); break;
      }
      if ((backwards && at > 0) || (!backwards && at < el.text.length)) {
        // Delete a full Unicode code point rather than half a surrogate pair.
        const count = backwards ? [...el.text.slice(0, at)].at(-1).length : [...el.text.slice(at)][0].length;
        const start = backwards ? at - count : at;
        el.text = el.text.slice(0, start) + el.text.slice(start + count);
        next = clearEmptyParenthetical(doc, caret(el.id, start));
      } else {
        const other = range.elements[range.first + (backwards ? -1 : 1)];
        if (other) {
          const left = backwards ? other : el, right = backwards ? el : other;
          if (right.type === 'parenthetical') right.text = right.text.replace(/^\(([\s\S]*)\)$/, '$1');
          next = replaceRange(doc, { anchor: point(left.id, left.text.length), focus: point(right.id, 0) });
        }
      }
      break;
    }
    case 'format': {
      const dualType = command.elementType.startsWith('dual');
      const type = dualType ? command.elementType.slice(4).toLowerCase() : command.elementType;
      if (!EDIT_TYPES.includes(type)) throw new TypeError('Unsupported editor format.');
      for (const item of range.elements.slice(range.first, range.last + 1)) {
        if (command.unwrapParenthetical && item.type === 'parenthetical' && /^\([\s\S]*\)$/.test(item.text)) {
          item.text = item.text.slice(1, -1);
          for (const endpoint of ['anchor', 'focus']) if (next[endpoint].id === item.id) next[endpoint].offset = Math.max(0, Math.min(item.text.length, next[endpoint].offset - 1));
        }
        item.type = type;
        if (type === 'parenthetical' && !/^\([\s\S]*\)$/.test(item.text)) {
          item.text = `(${item.text})`;
          for (const endpoint of ['anchor', 'focus']) if (next[endpoint].id === item.id) next[endpoint].offset++;
        }
        if (type === 'character') item.dual = dualType;
        else { delete item.dual; delete item.continuation; }
        delete item.key; delete item.depth; delete item.sceneNumber;
      }
      if (dualType && type !== 'character') {
        for (let i = range.first; i >= 0; i--) {
          const cue = range.elements[i];
          if (cue.type === 'character') { cue.dual = true; break; }
          if (i < range.first && !['dialogue', 'parenthetical'].includes(cue.type)) break;
        }
      }
      // The caret/selection is preserved even if the layout changes.
      break;
    }
    case 'tab': {
      const order = EDIT_TYPES;
      const index = Math.max(0, order.indexOf(el.type));
      let type = order[(index + (command.reverse ? order.length - 1 : 1)) % order.length];
      if (!command.reverse) {
        if (el.type === 'character') type = blankLine(el, el.text) ? 'transition' : 'parenthetical';
        else if (el.type === 'parenthetical') type = 'dialogue';
        else if (el.type === 'dialogue') type = 'parenthetical';
      }
      next = advanceLine(doc, el, next, type, !command.reverse && el.type === 'dialogue' && Boolean(el.text.trim()));
      break;
    }
    case 'paste': {
      const text = normalizeScreenplayClipboard(command.text);
      const structured = !command.plain && screenplayPaste(text);
      if (structured) { next = insertScreenplayPaste(doc, range, structured); break; }
      const chunks = text.split(/\n\n+/);
      next = replaceRange(doc, next, chunks.shift());
      el = doc.elements.find(item => item.id === next.focus.id);
      if (chunks.length) {
        const tail = el.text.slice(next.focus.offset);
        el.text = el.text.slice(0, next.focus.offset);
        for (const chunk of chunks) {
          const added = createElement('action', chunk);
          insertAfter(doc, el, added); el = added;
        }
        next = caret(el.id, el.text.length);
        el.text += tail;
      }
      break;
    }
    default: throw new TypeError(`Unknown editing command: ${command.type}`);
  }
  if (command.type === 'insert') next = recognizeTypedScene(doc, next, document, selection);
  if (command.type === 'insert') next = recognizeTypedTransition(doc, next);
  // Splitting is structural, never typing: do not uppercase/correct fragments or
  // manufacture parentheses in either surviving half.
  if (!smartReturn) finishTyping(doc, next, document);
  if (command.type === 'insert' && !command.text) next = clearEmptyParenthetical(doc, next);
  if (screenplaySettings(doc).sceneNumbers) redoSceneNumbers(doc);
  const dual = dualElementIds(doc);
  for (const item of doc.elements) if (item.rightMarginOffsetPt !== undefined) {
    const bounds = rightMarginBounds(item, dual.has(item.id));
    const offset = Math.max(bounds.min,Math.min(bounds.max,item.rightMarginOffsetPt));
    if (offset) item.rightMarginOffsetPt = offset; else delete item.rightMarginOffsetPt;
  }
  validateDocument(doc);
  return { document: doc, selection: next };
}

export function selectedText(doc, selection) {
  const { start, end, first, last, elements } = orderedSelection(doc, selection);
  return elements.slice(first, last + 1).map((el, i, list) =>
    el.text.slice(i === 0 ? start.offset : 0, i === list.length - 1 ? end.offset : el.text.length)).join('\n\n');
}

export class EditorHistory {
  constructor(document, selection, limit = 100) {
    this.current = { document, selection }; this.past = []; this.future = []; this.limit = limit;
    this.lastEdit = null;
  }
  apply(selection, command, time = Date.now()) {
    const before = { document: this.current.document, selection: structuredClone(selection) };
    const after = editDocument(before.document, selection, command);
    if (JSON.stringify(before.document) === JSON.stringify(after.document)) {
      // Reapplying a format must not restore an older typing caret.
      if (command.type === 'format') { this.current = { document: before.document, selection: after.selection }; this.lastEdit = null; }
      return this.current;
    }
    const continuous = ((command.type === 'insert' && this.lastEdit?.type === 'insert') || (command.type === 'titlePage' && this.lastEdit?.type === 'titlePage' && command.field === this.lastEdit.field))
      && time - this.lastEdit.time < 750 && JSON.stringify(selection) === JSON.stringify(this.current.selection);
    if (!continuous) {
      this.past.push(before);
      if (this.past.length > this.limit) this.past.shift();
    }
    this.future = []; this.current = after; this.lastEdit = { type: command.type, field: command.field, time };
    return after;
  }
  undo() {
    if (this.past.length) { this.future.push(this.current); this.current = this.past.pop(); }
    this.lastEdit = null; return this.current;
  }
  redo() {
    if (this.future.length) { this.past.push(this.current); this.current = this.future.pop(); }
    this.lastEdit = null; return this.current;
  }
}
