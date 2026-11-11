import { validateCover } from './cover-model.js';
import { Schema } from 'prosemirror-model';

export const styles = {
  normal: { label: 'Normal Text', tag: 'p' },
  chapter: { label: 'Chapter Heading', tag: 'h1', size: 22, bold: true, before: 18, after: 12 },
  section: { label: 'Section Heading', tag: 'h2', size: 17, bold: true, before: 12, after: 6 },
  subheading: { label: 'Subheading', tag: 'h3', size: 14, bold: true, before: 8, after: 4 },
  quote: { label: 'Block Quote', tag: 'blockquote', left: 24, right: 24, italic: true },
  poetry: { label: 'Poetry', tag: 'p', after: 0, leading: 1.2 },
  scene: { label: 'Scene Break', tag: 'p', align: 'center', before: 10, after: 10 },
};

const between = (min, max) => value => typeof value === 'number' && value >= min && value <= max;
const oneOf = (...values) => value => values.includes(value);
const nullable = check => value => value === null || check(value);
export const fontName = value => typeof value === 'string' && /^[\p{L}\p{N} ._+-]{1,80}$/u.test(value);
const color = value => typeof value === 'string' && /^#[\da-f]{6}$/i.test(value);
export const customStyleId = value => typeof value === 'string' && /^custom-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const builtInStyle = value => Object.hasOwn(styles, value);
const styleName = value => builtInStyle(value) || customStyleId(value);

const bool = value => typeof value === 'boolean';
export const paragraphFields = {
  align: { label: 'Alignment', check: oneOf('left', 'center', 'right', 'justify'), css: 'text-align' },
  indent: { label: 'First-line indent (pt)', check: between(-144, 288), css: 'text-indent', unit: 'pt', min: -144, max: 288 },
  left: { label: 'Left indent (pt)', check: between(0, 288), css: 'margin-left', unit: 'pt', min: 0, max: 288 },
  right: { label: 'Right indent (pt)', check: between(0, 288), css: 'margin-right', unit: 'pt', min: 0, max: 288 },
  before: { label: 'Space before (pt)', check: between(0, 144), css: 'padding-top', unit: 'pt', min: 0, max: 144 },
  after: { label: 'Space after (pt)', check: between(0, 144), css: 'padding-bottom', unit: 'pt', min: 0, max: 144 },
  leading: { label: 'Line spacing', check: between(0.5, 5), css: 'line-height', min: 0.5, max: 5 },
};

const size = between(4, 144);
export const styleFields = {
  ...paragraphFields,
  font: { label: 'Font family', check: fontName, css: 'font-family' },
  size: { label: 'Font size (pt)', check: size, css: 'font-size', unit: 'pt', min: 4, max: 144 },
  bold: { label: 'Bold', check: bool, css: 'font-weight' },
  italic: { label: 'Italic', check: bool, css: 'font-style' },
  underline: { label: 'Underline', check: bool, css: 'text-decoration' },
  color: { label: 'Text color', check: color, css: 'color' },
  strike: { label: 'Strikethrough', check: bool, css: 'text-decoration' },
  highlight: { label: 'Highlight color', check: color, css: 'background-color' },
};
export const defaultSettings = {
  font: 'Georgia', size: 12, leading: 1.5, defaultStyle: 'normal',
  pageSize: 'letter', width: 612, height: 792,
  top: 72, bottom: 72, left: 72, right: 72,
  header: '', footer: '', pageNumbers: false, styles: {},
};
const validStyleFields = fields => record(fields) && Object.entries(fields)
  .every(([key, value]) => Object.hasOwn(styleFields, key) && styleFields[key].check(value));
export const validCustomStyle = (id, style) => customStyleId(id) && keys(style, ['name', 'role', 'fields']) &&
  shortText(style.name) && Boolean(style.name.trim()) && style.name.length <= 80 &&
  ['paragraph', 'chapter'].includes(style.role) && validStyleFields(style.fields);

export const styleLabel = (id, settings) => settings.customStyles?.[id]?.name ?? styles[id]?.label ?? styles.normal.label;
export const isChapterStyle = (id, settings) => id === 'chapter' || settings?.customStyles?.[id]?.role === 'chapter';
export const styleTag = (id, settings) => isChapterStyle(id, settings) ? 'h1' : styles[id]?.tag ?? 'p';
const chapterNumber = '(?:[0-9]+|[ivxlcdm]+|(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand)(?:[ -](?:one|two|three|four|five|six|seven|eight|nine|hundred|thousand))*)';
const automaticHeading = new RegExp(`^chapter\\s+${chapterNumber}(?:\\s*[:–—-]\\s*[^\\n]*)?$`, 'iu');

export function automaticChapter(node, settings) {
  if (node?.type.name !== 'paragraph' || node.attrs.chapterMode === 'off' || isChapterStyle(node.attrs.style, settings)) return false;
  return automaticHeading.test(node.textContent.trim());
}

export function paragraphStyle(node, settings) {
  return automaticChapter(node, settings) ? settings?.chapterStyle ?? 'chapter' : node?.attrs.style ?? 'normal';
}

export function chapterHeading(node, settings) {
  return node?.attrs.chapterMode !== 'off' &&
    (isChapterStyle(node?.attrs.style, settings) || automaticChapter(node, settings));
}

export function resolvedParagraph(node, settings) {
  const format = resolvedStyle(paragraphStyle(node, settings), settings);
  for (const key of Object.keys(paragraphFields)) if (node?.attrs[key] != null) format[key] = node.attrs[key];
  return format;
}

export function resolvedStyle(id, settings) {
  return {
    font: settings.font, size: settings.size, leading: settings.leading, align: 'left',
    indent: 0, left: 0, right: 0, before: 0, after: 6, bold: false, italic: false, underline: false, strike: false,
    ...settings.styles.normal,
    ...(builtInStyle(id) ? styles[id] : settings.customStyles?.[id]?.fields),
    ...settings.styles[id],
  };
}

const settingsChecks = {
  font: fontName, size, leading: paragraphFields.leading.check, defaultStyle: styleName,
  pageSize: oneOf('letter', 'a4', 'a5', 'custom'), width: between(216, 1440), height: between(216, 1440),
  top: between(0, 288), bottom: between(0, 288), left: between(0, 288), right: between(0, 288),
  header: shortText, footer: shortText, pageNumbers: bool,
  styles: value => record(value) && Object.entries(value).every(([name, fields]) =>
    builtInStyle(name) && validStyleFields(fields)),
};
export const pageSizes = {
  letter: { width: 612, height: 792 },
  a4: { width: 595.28, height: 841.89 },
  a5: { width: 419.53, height: 595.28 },
};

export function pageDimensions(settings) {
  const { width, height } = pageSizes[settings.pageSize] ?? settings;
  if (!settings.orientation) return { width, height };
  const short = Math.min(width, height);
  const long = Math.max(width, height);
  return settings.orientation === 'landscape' ? { width: long, height: short } : { width: short, height: long };
}

export function validateSettings(settings) {
  if (!record(settings) || !keys(settings, Object.keys(settingsChecks), ['customStyles', 'orientation', 'indentStep', 'chapterStyle']) ||
    !Object.entries(settingsChecks).every(([key, check]) => check(settings[key])) ||
    (Object.hasOwn(settings, 'customStyles') && (!record(settings.customStyles) ||
      !Object.entries(settings.customStyles).every(([id, style]) => validCustomStyle(id, style)))) ||
    (settings.orientation !== undefined && !['portrait', 'landscape'].includes(settings.orientation)) ||
    (settings.indentStep !== undefined && !between(1, 144)(settings.indentStep)) ||
    (settings.chapterStyle !== undefined && !styleName(settings.chapterStyle)) ||
    [settings.defaultStyle, settings.chapterStyle].some(id => customStyleId(id) && !Object.hasOwn(settings.customStyles ?? {}, id))) {
    throw new Error('The manuscript contains invalid page settings or paragraph styles.');
  }
  const { width, height } = pageDimensions(settings);
  if (width - settings.left - settings.right < 72 || height - settings.top - settings.bottom < 72) {
    throw new Error('Page margins must leave at least one inch of writing space.');
  }
  return settings;
}

const paragraphAttrs = {
  style: { default: 'normal' },
  chapterMode: { default: null },
  ...Object.fromEntries(Object.keys(paragraphFields).map(key => [key, { default: null }])),
};
const attrValidators = {
  style: styleName,
  chapterMode: oneOf(null, 'off'),
  ...Object.fromEntries(Object.entries(paragraphFields).map(([key, field]) => [key, nullable(field.check)])),
};

export function styleValue(key, value) {
  if (key === 'font') return `"${value}", serif`;
  if (key === 'bold') return value ? 'bold' : 'normal';
  if (key === 'italic') return value ? 'italic' : 'normal';
  if (key === 'underline') return value ? 'underline' : 'none';
  return `${value}${styleFields[key]?.unit ?? ''}`;
}

function paragraphDOM(node) {
  const { style, chapterMode, ...overrides } = node.attrs;
  const attrs = { 'data-prose-style': style };
  if (chapterMode === 'off') attrs['data-chapter-mode'] = 'off';
  const declarations = [];
  for (const [key, value] of Object.entries(overrides)) {
    if (value === null) continue;
    attrs[`data-prose-${key}`] = value;
    declarations.push(`${paragraphFields[key].css}:${styleValue(key, value)}`);
  }
  if (declarations.length) attrs.style = declarations.join(';');
  return [styleTag(style), attrs, 0];
}

function parseParagraph(dom, fallback) {
  const style = dom.dataset.proseStyle;
  const attrs = { style: builtInStyle(style) ? style : fallback, chapterMode: dom.dataset.chapterMode === 'off' ? 'off' : null };
  for (const [key, { css, check, unit }] of Object.entries(paragraphFields)) {
    const raw = dom.dataset[`prose${key[0].toUpperCase()}${key.slice(1)}`];
    const cssValue = dom.style.getPropertyValue(css);
    const value = raw ?? (unit && cssValue.endsWith('px') ? String(parseFloat(cssValue) * 0.75) : cssValue.replace(/pt$/, ''));
    const parsed = key === 'align' ? value : value === '' ? null : Number(value);
    if (check(parsed)) attrs[key] = parsed;
  }
  return attrs;
}

function styledMark(tag, css, check, parse = value => value, render = value => value) {
  return {
    attrs: { value: {} },
    parseDOM: [{
      style: css,
      getAttrs(value) {
        const parsed = parse(value);
        return check(parsed) ? { value: parsed } : false;
      },
    }],
    toDOM: mark => [tag, { style: `${css}:${render(mark.attrs.value)}` }, 0],
  };
}

function parseColor(value) {
  const rgb = /^rgb\(\s*(\d+),\s*(\d+),\s*(\d+)\)$/.exec(value);
  if (rgb) return '#' + rgb.slice(1).map(channel => Number(channel).toString(16).padStart(2, '0')).join('');
  return value;
}

export const markValues = { font: fontName, size, color, highlight: color };
export const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: {
      group: 'block', content: 'inline*', attrs: paragraphAttrs,
      parseDOM: [
        ...['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre'].map(tag => ({
          tag,
          getAttrs: dom => parseParagraph(dom, ({
            h1: 'chapter', h2: 'section', h3: 'subheading', h4: 'subheading',
            h5: 'subheading', h6: 'subheading', blockquote: 'quote', pre: 'poetry',
          })[tag] ?? 'normal'),
          preserveWhitespace: tag === 'pre' ? 'full' : true,
        })),
      ],
      toDOM: paragraphDOM,
    },
    text: { group: 'inline' },
    hard_break: { inline: true, group: 'inline', selectable: false, linebreakReplacement: true, parseDOM: [{ tag: 'br' }], toDOM: () => ['br'] },
    page_break: {
      group: 'block', atom: true,
      parseDOM: [{ tag: 'hr[data-page-break]' }],
      toDOM: () => ['hr', { 'data-page-break': '', 'aria-label': 'Manual page break' }],
    },
  },
  marks: {
    bold: { excludes: 'unbold', parseDOM: [{ tag: 'strong' }, { tag: 'b' }, { style: 'font-weight', getAttrs: value => /^(bold|bolder|[5-9]00)$/.test(value) && null }], toDOM: () => ['strong', 0] },
    italic: { excludes: 'unitalic', parseDOM: [{ tag: 'em' }, { tag: 'i' }, { style: 'font-style=italic' }], toDOM: () => ['em', 0] },
    unbold: { excludes: 'bold', parseDOM: [{ style: 'font-weight=normal' }, { style: 'font-weight=400' }], toDOM: () => ['span', { style: 'font-weight:normal' }, 0] },
    unitalic: { excludes: 'italic', parseDOM: [{ style: 'font-style=normal' }], toDOM: () => ['span', { style: 'font-style:normal' }, 0] },
    ununderline: { excludes: 'underline', parseDOM: [{ tag: 'span[data-prose-no-underline]' }], toDOM: () => ['span', { 'data-prose-no-underline': '' }, 0] },
    underline: { excludes: 'ununderline', parseDOM: [{ tag: 'u' }, { style: 'text-decoration', getAttrs: value => value.includes('underline') ? null : false }], toDOM: () => ['u', 0] },
    unstrike: { excludes: 'strike', parseDOM: [{ tag: 'span[data-prose-no-strike]' }], toDOM: () => ['span', { 'data-prose-no-strike': '' }, 0] },
    strike: { excludes: 'unstrike', parseDOM: [{ tag: 's' }, { tag: 'del' }, { tag: 'strike' }, { style: 'text-decoration', getAttrs: value => value.includes('line-through') ? null : false }], toDOM: () => ['s', 0] },
    superscript: { excludes: 'subscript', parseDOM: [{ tag: 'sup' }], toDOM: () => ['sup', 0] },
    subscript: { excludes: 'superscript', parseDOM: [{ tag: 'sub' }], toDOM: () => ['sub', 0] },
    font: styledMark('span', 'font-family', fontName, value => value.split(',')[0].trim().replace(/^["']|["']$/g, ''), value => styleValue('font', value)),
    size: styledMark('span', 'font-size', size, value => /^\d+(?:\.\d+)?(?:px|pt)$/.test(value) ? parseFloat(value) * (value.endsWith('px') ? 0.75 : 1) : null, value => `${value}pt`),
    color: styledMark('span', 'color', color, parseColor),
    highlight: styledMark('span', 'background-color', color, parseColor),
  },
});

function record(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function shortText(value) { return typeof value === 'string' && value.length <= 200 && !/[\u0000-\u001f]/.test(value); }
const keys = (value, required, optional = []) => record(value) &&
  required.every(key => Object.hasOwn(value, key)) &&
  Object.keys(value).every(key => required.includes(key) || optional.includes(key));
export const validId = value => typeof value === 'string' && /^[\w-]{1,120}$/.test(value);
const allowedMarks = Object.keys(schema.marks);

function validateMarks(marks) {
  if (!Array.isArray(marks) || marks.length > allowedMarks.length) return false;
  const types = new Set();
  for (const mark of marks) {
    if (!keys(mark, ['type'], ['attrs']) || !allowedMarks.includes(mark.type) || types.has(mark.type)) return false;
    const check = Object.hasOwn(markValues, mark.type) && markValues[mark.type];
    if (check ? !keys(mark.attrs, ['value']) || !check(mark.attrs.value) : Object.hasOwn(mark, 'attrs')) return false;
    types.add(mark.type);
  }
  return ![['subscript', 'superscript'], ['bold', 'unbold'], ['italic', 'unitalic'], ['underline', 'ununderline'], ['strike', 'unstrike']].some(pair => pair.every(type => types.has(type)));
}

function validInline(node) {
  if (!keys(node, ['type'], ['text', 'marks']) ||
    (Object.hasOwn(node, 'marks') && !validateMarks(node.marks))) return false;
  if (node.type === 'hard_break') return !Object.hasOwn(node, 'text');
  return node.type === 'text' && typeof node.text === 'string' && node.text.length > 0 &&
    !/[\u0000-\u0008\u000b-\u001f]/.test(node.text);
}

function validBlock(block) {
  if (!keys(block, ['type'], ['attrs', 'content'])) return false;
  if (block.type === 'page_break') return Object.keys(block).length === 1;
  return block.type === 'paragraph' &&
    (!Object.hasOwn(block, 'attrs') || (record(block.attrs) && Object.entries(block.attrs).every(([key, value]) =>
      Object.hasOwn(attrValidators, key) && attrValidators[key](value)))) &&
    (!Object.hasOwn(block, 'content') || (Array.isArray(block.content) && block.content.every(validInline)));
}

export function decodeManuscript(value) {
  let document;
  try { document = typeof value === 'string' ? JSON.parse(value.replace(/^\uFEFF/, '')) : value; }
  catch { throw new Error('This file does not contain valid ScribeForge JSON.'); }
  if (!record(document) || document.format !== 'storyforge') throw new Error('This is not a ScribeForge manuscript.');
  if (document.version !== 1) throw new Error(`Unsupported ScribeForge document version ${String(document.version)}.`);
  if (!keys(document, ['format', 'version', 'documentId', 'metadata', 'settings', 'content'], ['cover']) || !validId(document.documentId) ||
    !keys(document.metadata, ['title', 'author']) || !Object.values(document.metadata).every(shortText) ||
    !keys(document.content, ['type', 'content']) || document.content.type !== 'doc' ||
    !Array.isArray(document.content.content) || !document.content.content.length || !document.content.content.every(validBlock)) {
    throw new Error('The manuscript contains invalid or unsupported content. The original file was preserved.');
  }
  validateSettings(document.settings);
  if (Object.hasOwn(document, 'cover')) validateCover(document.cover, fontName);
  if (document.content.content.some(block => customStyleId(block.attrs?.style) &&
    !Object.hasOwn(document.settings.customStyles ?? {}, block.attrs.style))) {
    throw new Error('The manuscript is missing a custom paragraph style.');
  }
  schema.nodeFromJSON(document.content).check();
  return document;
}

export function newManuscript(title = 'Untitled Manuscript', settings = defaultSettings, source = '') {
  return {
    format: 'storyforge', version: 1, documentId: crypto.randomUUID(),
    metadata: { title: title.slice(0, 200), author: '' }, settings: structuredClone(settings),
    content: textDocument(source, settings.defaultStyle).toJSON(),
  };
}

export function textDocument(source, style = 'normal') {
  return schema.nodes.doc.create(null, source.replace(/\r\n?/g, '\n').split('\f').flatMap((page, index) => [
    ...(index ? [schema.nodes.page_break.create()] : []),
    ...page.split('\n').map(text => schema.nodes.paragraph.create({ style }, text ? schema.text(text) : null)),
  ]));
}

export const encodeManuscript = manuscript => JSON.stringify(decodeManuscript(manuscript), null, 2) + '\n';
export const wordPattern = /[\p{L}\p{N}][\p{L}\p{N}\p{M}]*(?:['’\u2010\u2011-][\p{L}\p{N}][\p{L}\p{N}\p{M}]*)*/gu;
export const countWords = text => text.match(wordPattern)?.length ?? 0;
export const paragraphText = node => node.textBetween(0, node.content.size, '', '\n');
export function plainText(doc) {
  let previousWasParagraph = false;
  const blocks = [];
  doc.forEach(node => {
    const paragraph = node.type === schema.nodes.paragraph;
    if (paragraph && previousWasParagraph) blocks.push('\n');
    blocks.push(paragraph ? paragraphText(node) : '\f');
    previousWasParagraph = paragraph;
  });
  return blocks.join('');
}
