import { EditorState, NodeSelection, Plugin, TextSelection } from 'prosemirror-state';
import { baseKeymap, chainCommands, exitCode, splitBlockAs } from 'prosemirror-commands';
import { history, redo, undo } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { countWords, isChapterStyle, paragraphFields, paragraphText, resolvedStyle, schema } from './model.js';

const namedNumber = '(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand)';
const number = `(?:[0-9]{1,4}|[ivxlcdm]{1,8}|${namedNumber}(?:[ -]${namedNumber}){0,5})`;
const chapterPattern = new RegExp(`^(?:chapter\\s+${number}|prologue|epilogue)(?:\\s*[:–—]\\s*[^.!?\\n]{1,95})?$`, 'iu');

export function manuscriptIndex(doc, settings) {
  const blocks = [];
  const chapters = [];
  let words = 0;
  let characters = 0;
  let nonSpace = 0;
  let paragraphs = 0;
  let active = null;
  doc.forEach((node, pos) => {
    if (node.type !== schema.nodes.paragraph) return;
    const text = paragraphText(node);
    const title = text.trim();
    const explicit = isChapterStyle(node.attrs.style, settings);
    const inferred = node.attrs.style === 'normal' && title.length <= 120 && chapterPattern.test(title);
    const blockWords = countWords(text);
    words += blockWords;
    characters += Array.from(text).length;
    nonSpace += Array.from(text.replace(/\s/gu, '')).length;
    paragraphs += 1;
    blocks.push({ node, pos, text });
    if (explicit || inferred) {
      active = { pos, title: title || 'Untitled chapter', words: 0, explicit };
      chapters.push(active);
    } else if (active) active.words += blockWords;
  });
  return { blocks, chapters, words, characters, nonSpace, paragraphs };
}

export function activeChapter(chapters, position) {
  let first = 0;
  let last = chapters.length;
  while (first < last) {
    const mid = (first + last) >>> 1;
    if (chapters[mid].pos < position) first = mid + 1;
    else last = mid;
  }
  return first - 1;
}

export function findMatches(blocks, query, { exactCase = false, wholeWord = false } = {}) {
  if (!query) return [];
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const word = /[\p{L}\p{N}\p{M}_]/u;
  const regex = new RegExp(escaped, exactCase ? 'gu' : 'giu');
  const adjacent = (text, index) => {
    if (index < 0 || index >= text.length) return false;
    const unit = text.charCodeAt(index);
    const start = unit >= 0xdc00 && unit <= 0xdfff && index > 0 ? index - 1 : index;
    return word.test(String.fromCodePoint(text.codePointAt(start)));
  };
  return blocks.flatMap(({ text, pos }) => Array.from(text.matchAll(regex))
    .filter(match => !wholeWord || (!adjacent(text, match.index - 1) && !adjacent(text, match.index + match[0].length)))
    .map(match => ({ from: pos + 1 + match.index, to: pos + 1 + match.index + match[0].length, text: match[0] })));
}

export function replaceMatches(state, matches, text) {
  const tr = state.tr;
  for (const { from, to } of [...matches].reverse()) {
    // Retain the existing marks at each replacement offset, extending the final
    // run when the replacement is longer than the match.
    const runs = [];
    const codePoints = Array.from(text);
    let used = 0;
    state.doc.nodesBetween(from, to, (node, pos) => {
      if (!node.isInline) return;
      const end = Math.min(to, pos + node.nodeSize);
      const length = node.isText ? Array.from(node.text.slice(Math.max(0, from - pos), end - pos)).length : 1;
      const next = end === to ? codePoints.length : used + length;
      const part = codePoints.slice(used, next).join('');
      if (part) runs.push(schema.text(part, node.marks));
      used = next;
    });
    tr.replaceWith(from, to, runs);
  }
  return tr;
}

export const selectRange = (view, from, to = from) => {
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)).scrollIntoView());
  view.focus();
};

const searchPlugin = new Plugin({
  state: {
    init: () => DecorationSet.empty,
    apply(tr, current) {
      const data = tr.getMeta(searchPlugin);
      if (!data) return current.map(tr.mapping, tr.doc);
      return DecorationSet.create(tr.doc, data.matches.map(({ from, to }, i) =>
        Decoration.inline(from, to, { class: i === data.active ? 'prose-match current' : 'prose-match' })));
    },
  },
  props: { decorations: state => searchPlugin.getState(state) },
});
export const showMatches = (view, matches, active) => view.dispatch(view.state.tr.setMeta(searchPlugin, { matches, active }));

function baseEmphasis(style, name, settings) {
  return resolvedStyle(style, settings)[name];
}

function emphasisAt(marks, style, name, settings) {
  return Boolean(schema.marks[name].isInSet(marks) ||
    (baseEmphasis(style, name, settings) && !schema.marks[`un${name}`].isInSet(marks)));
}

export function emphasisActive(state, name, settings) {
  const { selection, storedMarks } = state;
  const { $from, from, to } = selection;
  if (selection.empty) return emphasisAt(storedMarks ?? $from.marks(), $from.parent.attrs.style, name, settings);
  let active = false;
  state.doc.nodesBetween(from, to, (node, _pos, parent) => {
    if (node.isInline && emphasisAt(node.marks, parent.attrs.style, name, settings)) active = true;
  });
  return active;
}

export function toggleEmphasis(name, getSettings) {
  return (state, dispatch) => {
    const settings = getSettings();
    const { selection } = state;
    const { from, to, $from } = selection;
    const enabled = !emphasisActive(state, name, settings);
    const mark = schema.marks[name];
    const inverse = schema.marks[`un${name}`];
    const override = style => baseEmphasis(style, name, settings) === enabled ? null : (enabled ? mark : inverse).create();
    const tr = state.tr;
    if (selection.empty) {
      tr.removeStoredMark(mark).removeStoredMark(inverse);
      const explicit = override($from.parent.attrs.style);
      if (explicit) tr.addStoredMark(explicit);
    } else {
      tr.removeMark(from, to, mark).removeMark(from, to, inverse);
      state.doc.nodesBetween(from, to, (node, pos, parent) => {
        if (!node.isInline) return;
        const explicit = override(parent.attrs.style);
        if (explicit) tr.addMark(Math.max(from, pos), Math.min(to, pos + node.nodeSize), explicit);
      });
    }
    dispatch?.(tr);
    return true;
  };
}

export function selectionFormatting(state, settings) {
  const { from, to, $from, empty } = state.selection;
  const properties = ['font', 'size', 'color', 'bold', 'italic', 'underline', ...Object.keys(paragraphFields)];
  let result;
  function include(attrs, marks) {
    const format = resolvedStyle(attrs.style, settings);
    for (const key of Object.keys(paragraphFields)) if (attrs[key] != null) format[key] = attrs[key];
    for (const mark of marks) {
      const name = mark.type.name;
      if (properties.includes(name)) format[name] = mark.attrs.value ?? true;
      else if (['unbold', 'unitalic', 'ununderline'].includes(name)) format[name.slice(2)] = false;
    }
    if (!result) result = Object.fromEntries(properties.map(key => [key, format[key]]));
    else for (const key of properties) if (result[key] !== format[key]) result[key] = null;
  }
  if (empty) include($from.parent.attrs, state.storedMarks ?? $from.marks());
  else state.doc.nodesBetween(from, to, (node, _pos, parent) => {
    if (node.isInline) include(parent.attrs, node.marks);
    else if (node.isTextblock && !node.content.size) include(node.attrs, []);
  });
  if (!result) include($from.parent.attrs, []);
  return result;
}

export function changeParagraph(fields, { clearOverrides = false } = {}) {
  return (state, dispatch) => {
    const { from, to, $from } = state.selection;
    const transaction = state.tr;
    const change = (node, pos) => {
      if (node.type !== schema.nodes.paragraph) return;
      transaction.setNodeMarkup(pos, null, { ...(clearOverrides ? { style: node.attrs.style } : node.attrs), ...fields });
      if (clearOverrides) transaction.removeMark(pos + 1, pos + node.nodeSize - 1);
      return false;
    };
    if (from === to && $from.depth) change($from.parent, $from.before());
    else state.doc.nodesBetween(from, to, change);
    if (!transaction.docChanged) return false;
    dispatch?.(transaction);
    return true;
  };
}

export function insertPageBreak(state, dispatch) {
  if (!dispatch) return true;
  const { $to } = state.selection;
  const tr = state.tr;
  let pos = $to.pos;
  if ($to.depth) {
    if ($to.parentOffset === 0) pos = $to.before();
    else if ($to.parentOffset === $to.parent.content.size) pos = $to.after();
    else {
      tr.split(pos);
      pos++;
    }
  }
  const node = schema.nodes.page_break.create();
  tr.insert(pos, node);
  if (!tr.doc.nodeAt(pos + 1) || tr.doc.nodeAt(pos + 1).type === node.type) {
    tr.insert(pos + 1, schema.nodes.paragraph.create());
  }
  tr.setSelection(TextSelection.create(tr.doc, pos + 2));
  dispatch(tr.scrollIntoView());
  return true;
}

export function deletionSize(transaction, state) {
  if (!transaction.docChanged || transaction.getMeta('history$') || transaction.getMeta('allowLargeDelete')) return 0;
  let removed = 0;
  let inserted = 0;
  for (let i = 0; i < transaction.steps.length; i++) {
    transaction.steps[i].getMap().forEach((from, to, start, end) => {
      removed += transaction.docs[i].textBetween(from, to, '\n', '\n').length;
      inserted += end - start;
    });
  }
  return Math.max(0, removed - inserted);
}

export function editorState(manuscript, { confirmDelete = () => true, defaultStyle = () => manuscript.settings.defaultStyle, getSettings = () => manuscript.settings } = {}) {
  const nextParagraph = node => {
    const current = node.attrs.style;
    const style = ['poetry', 'quote'].includes(current) || (current.startsWith('custom-') && !isChapterStyle(current, getSettings()))
      ? current : defaultStyle();
    return { type: schema.nodes.paragraph, attrs: style === node.attrs.style ? node.attrs : { style } };
  };
  const enter = chainCommands(splitBlockAs(nextParagraph), baseKeymap.Enter);
  const lineBreak = (state, dispatch) => {
    if (state.selection instanceof NodeSelection) return false;
    dispatch?.(state.tr.replaceSelectionWith(schema.nodes.hard_break.create()).scrollIntoView());
    return true;
  };
  let decoratedDoc;
  let decoratedSettings;
  let decorations;
  const inheritedFormatting = new Plugin({ props: { decorations(state) {
    const settings = getSettings();
    if (decoratedDoc === state.doc && decoratedSettings === settings) return decorations;
    decoratedDoc = state.doc;
    decoratedSettings = settings;
    const ids = [...Object.keys(settings.styles), ...Object.keys(settings.customStyles ?? {})];
    const underlined = new Set(ids.filter(id => resolvedStyle(id, settings).underline));
    if (settings.styles.normal?.underline) for (const id of ['normal', 'chapter', 'section', 'subheading', 'quote', 'poetry', 'scene']) {
      if (resolvedStyle(id, settings).underline) underlined.add(id);
    }
    const customHeadings = new Set(Object.keys(settings.customStyles ?? {}).filter(id => isChapterStyle(id, settings)));
    if (!underlined.size && !customHeadings.size) return decorations = DecorationSet.empty;
    const items = [];
    state.doc.forEach((block, pos) => {
      if (customHeadings.has(block.attrs.style)) {
        items.push(Decoration.node(pos, pos + block.nodeSize, { role: 'heading', 'aria-level': '1', 'data-chapter-heading': '' }));
      }
      if (underlined.has(block.attrs.style)) block.forEach((node, offset) => {
        if (node.isText && !schema.marks.ununderline.isInSet(node.marks)) {
          items.push(Decoration.inline(pos + offset + 1, pos + offset + 1 + node.nodeSize, { class: 'prose-style-underline' }));
        }
      });
    });
    return decorations = DecorationSet.create(state.doc, items);
  } } });
  return EditorState.create({
    doc: schema.nodeFromJSON(manuscript.content),
    plugins: [
      history(), searchPlugin, inheritedFormatting,
      new Plugin({ filterTransaction(tr, state) {
        const size = deletionSize(tr, state);
        return !size || confirmDelete(size, state, tr);
      } }),
      keymap({
        'Mod-z': undo, 'Mod-Shift-z': redo, 'Mod-y': redo,
        'Mod-b': toggleEmphasis('bold', getSettings), 'Mod-i': toggleEmphasis('italic', getSettings), 'Mod-u': toggleEmphasis('underline', getSettings),
        Enter: enter, 'Shift-Enter': chainCommands(exitCode, lineBreak),
      }),
      keymap(baseKeymap),
    ],
  });
}

export function textChanges(before, after) {
  if (before.eq(after)) return { added: 0, deleted: 0 };
  const changedFrom = before.content.findDiffStart(after.content);
  if (changedFrom === null) return { added: 0, deleted: 0 };
  const { a, b } = before.content.findDiffEnd(after.content);
  const from = Math.min(changedFrom, a, b);
  const oldText = before.textBetween(Math.max(0, from - 1), Math.max(a, changedFrom), '\n', '\n');
  const newText = after.textBetween(Math.max(0, from - 1), Math.max(b, changedFrom), '\n', '\n');
  let start = 0;
  while (start < oldText.length && start < newText.length && oldText[start] === newText[start]) start++;
  let oldEnd = oldText.length;
  let newEnd = newText.length;
  while (oldEnd > start && newEnd > start && oldText[oldEnd - 1] === newText[newEnd - 1]) { oldEnd--; newEnd--; }
  // A word that is still being typed remains the same word in the counters.
  if (oldEnd === start && /[\p{L}\p{N}\p{M}]/u.test(oldText[start - 1] ?? '')) {
    while (start < newEnd && /[\p{L}\p{N}\p{M}]/u.test(newText[start])) start++;
  }
  const added = countWords(newText.slice(start, newEnd));
  const deleted = start < oldEnd ? countWords(oldText.slice(start, oldEnd)) : 0;
  return { added, deleted };
}
