import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { chapterHeading, decodeManuscript, defaultSettings, newManuscript, pageDimensions, pageSizes, paragraphStyle, paragraphFields, plainText, resolvedStyle, schema, styleFields, styleLabel, styleTag, styleValue, styles, isChapterStyle } from './model.js';
import { manuscriptIndex } from './editing.js';

export const MAX_IMPORT = 50 * 1024 * 1024;
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const xml = '<?xml version="1.0" encoding="UTF-8"?>';
const safeXML = text => String(text).replace(/[^\u0009\u000a\u000d\u0020-\ud7ff\ue000-\ufffd\u{10000}-\u{10ffff}]/gu, '\ufffd');
export const escapeXML = text => safeXML(text).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]);
const twip = pt => Math.round(pt * 20);
const css = (fields, definitions) => Object.entries(fields).filter(([key, value]) => Object.hasOwn(definitions, key) && value !== null)
  .map(([key, value]) => `${definitions[key].css}:${styleValue(key, value)}`).join(';');
const styleIds = settings => [...Object.keys(styles), ...Object.keys(settings.customStyles ?? {})];
export const proseStyleCSS = (settings, scope = '') => styleIds(settings).map(key => {
  const { underline, strike, highlight, ...fields } = resolvedStyle(key, settings);
  return `${scope}[data-prose-style="${key}"]:not([data-active-style]),${scope}[data-active-style="${key}"]{${css(fields, styleFields)}}`;
}).join('\n');
const inlineMarkup = {
  bold: 'strong', italic: 'em', underline: 'u', strike: 's', superscript: 'sup', subscript: 'sub',
};
const markCSS = {
  font: value => `font-family:${styleValue('font', value)}`, size: value => `font-size:${value}pt`,
  color: value => `color:${value}`, highlight: value => `background-color:${value}`,
  unbold: () => 'font-weight:normal', unitalic: () => 'font-style:normal', ununderline: () => 'text-decoration:none', unstrike: () => 'text-decoration:none',
};
function xhtmlBlock(node, inferredHeading, settings) {
  if (node.type === schema.nodes.page_break) return '<hr class="page-break" aria-label="Page break"/>';
  const style = paragraphStyle(node, settings);
  const { style: _style, ...overrides } = node.attrs;
  const format = resolvedStyle(style, settings);
  const tag = inferredHeading ? 'h1' : styleTag(style, settings);
  let result = '';
  node.forEach(inline => {
    let text = inline.isText ? escapeXML(inline.text) : '<br/>';
    if (inline.isText) {
      for (const [property, tag] of [['underline', 'u'], ['strike', 's']]) {
        if (format[property] && !inline.marks.some(mark => [property, `un${property}`].includes(mark.type.name))) text = `<${tag}>${text}</${tag}>`;
      }
      if (format.highlight && !schema.marks.highlight.isInSet(inline.marks)) text = `<span style="background-color:${format.highlight}">${text}</span>`;
    }
    for (const mark of [...inline.marks].reverse()) {
      const name = mark.type.name;
      const tag = inlineMarkup[name] ?? 'span';
      const attr = markCSS[name] ? ` style="${escapeXML(markCSS[name](mark.attrs.value))}"` : '';
      text = `<${tag}${attr}>${text}</${tag}>`;
    }
    result += text;
  });
  return `<${tag} data-prose-style="${style}" style="${escapeXML(css(overrides, paragraphFields))}">${result || '<br/>'}</${tag}>`;
}

export function exportEpub(manuscript) {
  const { metadata, settings, documentId } = manuscript;
  const doc = schema.nodeFromJSON(manuscript.content);
  const chapterTitles = new Map(manuscriptIndex(doc, settings).chapters.map(({ pos, title }) => [pos, title]));
  const sections = [];
  let current = { title: metadata.title || 'Manuscript', blocks: [] };
  doc.forEach((node, pos) => {
    if (chapterTitles.has(pos)) {
      if (current.blocks.length) sections.push(current);
      current = { title: chapterTitles.get(pos), blocks: [] };
    }
    current.blocks.push(xhtmlBlock(node, chapterTitles.has(pos), settings));
  });
  sections.push(current);
  const wrap = (title, body) => `${xml}<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en"><head><meta charset="utf-8"/><title>${escapeXML(title)}</title><link rel="stylesheet" href="prose.css"/></head><body>${body}</body></html>`;
  const names = sections.map((_, i) => `section-${i + 1}.xhtml`);
  const manifest = names.map((name, i) => `<item id="s${i}" href="${name}" media-type="application/xhtml+xml"/>`).join('');
  const spine = names.map((_, i) => `<itemref idref="s${i}"/>`).join('');
  const navigation = sections.map(({ title }, i) => `<li><a href="${names[i]}">${escapeXML(title)}</a></li>`).join('');
  return zipSync({
    mimetype: [strToU8('application/epub+zip'), { level: 0 }],
    'META-INF/container.xml': strToU8(`${xml}<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="EPUB/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`),
    'EPUB/book.opf': strToU8(`${xml}<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="story-id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="story-id">urn:storyforge:${documentId}</dc:identifier><dc:title>${escapeXML(metadata.title || 'Manuscript')}</dc:title><dc:creator>${escapeXML(metadata.author)}</dc:creator><dc:language>en</dc:language><meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="css" href="prose.css" media-type="text/css"/>${manifest}</manifest><spine>${spine}</spine></package>`),
    'EPUB/nav.xhtml': strToU8(wrap('Contents', `<nav epub:type="toc" id="toc"><h1>Contents</h1><ol>${navigation}</ol></nav>`)),
    'EPUB/prose.css': strToU8(`body{font-family:${styleValue('font', settings.font)};font-size:${settings.size}pt;line-height:${settings.leading}}p,h1,h2,h3,blockquote{font:inherit;margin:0;padding-bottom:6pt;white-space:pre-wrap;overflow-wrap:break-word}.page-break{border:0;break-after:page;page-break-after:always}\n${proseStyleCSS(settings)}`),
    ...Object.fromEntries(sections.map(({ title, blocks }, i) => [`EPUB/${names[i]}`, strToU8(wrap(title, blocks.join('')))])),
  });
}

function w(tag, attributes = {}, body = null) {
  const attrs = Object.entries(attributes).filter(([, value]) => value !== null && value !== undefined)
    .map(([name, value]) => ` w:${name}="${escapeXML(value)}"`).join('');
  return body === null ? `<w:${tag}${attrs}/>` : `<w:${tag}${attrs}>${body}</w:${tag}>`;
}
const val = (tag, value) => w(tag, { val: value });
const docxProps = {
  bold: v => val('b', v === false ? 0 : 1), italic: v => val('i', v === false ? 0 : 1), underline: () => val('u', 'single'),
  unbold: () => val('b', 0), unitalic: () => val('i', 0), ununderline: () => val('u', 'none'),
  strike: value => val('strike', value === false ? 0 : 1), unstrike: () => val('strike', 0), superscript: () => val('vertAlign', 'superscript'), subscript: () => val('vertAlign', 'subscript'),
  font: v => w('rFonts', { ascii: v, hAnsi: v, eastAsia: v, cs: v }),
  size: v => val('sz', Math.round(v * 2)), color: v => val('color', v.slice(1).toUpperCase()),
  highlight: v => w('shd', { val: 'clear', fill: v.slice(1).toUpperCase() }),
};
function paragraphProperties(fields) {
  const props = [];
  const { align, indent, left, right, before, after, leading } = fields;
  if ([before, after, leading].some(value => value != null)) {
    props.push(w('spacing', { before: before == null ? null : twip(before), after: after == null ? null : twip(after),
      line: leading == null ? null : Math.round(leading * 240), lineRule: leading == null ? null : 'auto' }));
  }
  if ([left, right, indent].some(value => value != null)) {
    props.push(w('ind', { left: left == null ? null : twip(left), right: right == null ? null : twip(right),
      firstLine: indent == null || indent < 0 ? null : twip(indent), hanging: indent < 0 ? twip(-indent) : null }));
  }
  if (align) props.push(val('jc', align === 'justify' ? 'both' : align));
  return props.join('');
}
const docxStyles = { normal: 'Normal', chapter: 'Heading1', section: 'Heading2', subheading: 'Heading3', quote: 'Quote', poetry: 'Poetry', scene: 'SceneBreak' };
const docxText = text => safeXML(text).split(/([\t\n])/).map(part => {
  if (part === '\t') return w('tab');
  if (part === '\n') return w('br');
  return part ? `<w:t xml:space="preserve">${escapeXML(part)}</w:t>` : '';
}).join('');
const relationship = (id, type, target) => `<Relationship Id="${id}" Type="${R}/${type}" Target="${target}"/>`;
const relationships = body => `${xml}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${body}</Relationships>`;
export function exportDocx(manuscript) {
  const { metadata, settings } = manuscript;
  const { width, height } = pageDimensions(settings);
  const doc = schema.nodeFromJSON(manuscript.content);
  const wordStyle = id => docxStyles[id] ?? id.replaceAll('-', '');
  let content = '';
  doc.forEach(node => {
    if (node.type === schema.nodes.page_break) {
      content += w('p', {}, w('r', {}, w('br', { type: 'page' })));
      return;
    }
    let body = w('pPr', {}, val('pStyle', wordStyle(paragraphStyle(node, settings))) + (chapterHeading(node, settings) ? w('keepNext') : '') + paragraphProperties(node.attrs) + (chapterHeading(node, settings) ? val('outlineLvl', 0) : ''));
    node.forEach(inline => {
      const properties = inline.marks.map(mark => docxProps[mark.type.name](mark.attrs.value)).join('');
      body += w('r', {}, (properties ? w('rPr', {}, properties) : '') + (inline.isText ? docxText(inline.text) : w('br')));
    });
    content += w('p', {}, body);
  });
  const definitions = styleIds(settings).map(key => {
    const fields = resolvedStyle(key, settings);
    const outline = isChapterStyle(key, settings) ? 0 : ['chapter', 'section', 'subheading'].indexOf(key);
    const pp = paragraphProperties(fields) + (outline >= 0 ? val('outlineLvl', outline) : '');
    const rp = ['font', 'size', 'bold', 'italic', 'color', 'strike', 'highlight'].filter(key => Object.hasOwn(fields, key)).map(key => docxProps[key](fields[key])).join('') +
      (fields.underline ? docxProps.underline() : '');
    return w('style', { type: 'paragraph', styleId: wordStyle(key), default: key === 'normal' ? 1 : null },
      val('name', styleLabel(key, settings)) + (key === 'normal' ? '' : val('basedOn', 'Normal')) + w('pPr', {}, pp) + w('rPr', {}, rp));
  }).join('');
  const defaultRun = docxProps.font(settings.font) + docxProps.size(settings.size);
  const styleXML = `${xml}<w:styles xmlns:w="${W}">${w('docDefaults', {}, w('rPrDefault', {}, w('rPr', {}, defaultRun)))}${definitions}</w:styles>`;
  const parts = {
    'word/styles.xml': styleXML,
    'docProps/core.xml': `${xml}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${escapeXML(metadata.title)}</dc:title><dc:creator>${escapeXML(metadata.author)}</dc:creator></cp:coreProperties>`,
    '_rels/.rels': relationships(relationship('doc', 'officeDocument', 'word/document.xml') +
      '<Relationship Id="metadata" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'),
  };
  let refs = '';
  let rels = relationship('styles', 'styles', 'styles.xml');
  let overrides = '';
  for (const kind of ['header', 'footer']) {
    if (!settings[kind] && (kind !== 'footer' || !settings.pageNumbers)) continue;
    const pageField = kind === 'footer' && settings.pageNumbers ? w('fldSimple', { instr: 'PAGE' }, w('r', {}, docxText('1'))) : '';
    const tag = kind === 'header' ? 'hdr' : 'ftr';
    parts[`word/${kind}1.xml`] = `${xml}<w:${tag} xmlns:w="${W}">${w('p', {}, w('r', {}, docxText(settings[kind] + (pageField && settings[kind] ? '   ·   ' : ''))) + pageField)}</w:p></w:${tag}>`;
    refs += `<w:${kind}Reference w:type="default" r:id="${kind}"/>`;
    rels += relationship(kind, kind, `${kind}1.xml`);
    overrides += `<Override PartName="/word/${kind}1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${kind}+xml"/>`;
  }
  const size = w('pgSz', { w: twip(width), h: twip(height), orient: width > height ? 'landscape' : null });
  const margin = w('pgMar', { top: twip(settings.top), right: twip(settings.right), bottom: twip(settings.bottom), left: twip(settings.left),
    header: twip(settings.top / 2), footer: twip(settings.bottom / 2), gutter: 0 });
  parts['word/document.xml'] = `${xml}<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${content}${w('sectPr', {}, refs + size + margin)}</w:body></w:document>`;
  parts['word/_rels/document.xml.rels'] = relationships(rels);
  parts['[Content_Types].xml'] = `${xml}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>${overrides}</Types>`;
  return zipSync(Object.fromEntries(Object.entries(parts).map(([key, value]) => [key, strToU8(value)])));
}

const local = (parent, name) => parent && Array.from(parent.children).find(node => node.namespaceURI === W && node.localName === name);
const attr = (node, key = 'val') => node?.getAttributeNS(W, key) ?? null;
const asNumber = value => value === null || value === '' ? undefined : Number(value);
const scaled = (value, divisor) => value === null || value === '' ? undefined : Number(value) / divisor;
const colorValue = value => /^[\da-f]{6}$/i.test(value ?? '') ? '#' + value.toLowerCase() : undefined;
const highlightColors = {
  black: '#000000', blue: '#0000ff', cyan: '#00ffff', green: '#00ff00', magenta: '#ff00ff', red: '#ff0000', yellow: '#ffff00',
  white: '#ffffff', darkBlue: '#000080', darkCyan: '#008080', darkGreen: '#008000', darkMagenta: '#800080',
  darkRed: '#800000', darkYellow: '#808000', darkGray: '#808080', lightGray: '#c0c0c0',
};
const enabled = node => node && !['0', 'false', 'off', 'none'].includes(attr(node));
const hasProperty = (node, name) => Boolean(local(node, name));
function readRun(properties) {
  const values = {};
  for (const [key, tag] of Object.entries({ bold: 'b', italic: 'i', underline: 'u', strike: 'strike' })) {
    if (hasProperty(properties, tag)) values[key] = enabled(local(properties, tag));
  }
  const vertical = attr(local(properties, 'vertAlign'));
  if (vertical) Object.assign(values, { superscript: vertical === 'superscript', subscript: vertical === 'subscript' });
  const fonts = local(properties, 'rFonts');
  const font = attr(fonts, 'ascii') ?? attr(fonts, 'hAnsi');
  if (font && styleFields.font.check(font)) values.font = font;
  const size = scaled(attr(local(properties, 'sz')), 2);
  if (styleFields.size.check(size)) values.size = size;
  const color = colorValue(attr(local(properties, 'color')));
  if (color) values.color = color;
  const highlight = highlightColors[attr(local(properties, 'highlight'))] ?? colorValue(attr(local(properties, 'shd'), 'fill'));
  if (highlight) values.highlight = highlight;
  return values;
}
function readParagraph(properties) {
  const spacing = local(properties, 'spacing');
  const indent = local(properties, 'ind');
  const hanging = scaled(attr(indent, 'hanging'), 20);
  const jc = attr(local(properties, 'jc'));
  const fields = {
    align: { both: 'justify', start: 'left', end: 'right' }[jc] ?? jc,
    left: scaled(attr(indent, 'left') ?? attr(indent, 'start'), 20),
    right: scaled(attr(indent, 'right') ?? attr(indent, 'end'), 20),
    indent: hanging === undefined ? scaled(attr(indent, 'firstLine'), 20) : -hanging,
    before: scaled(attr(spacing, 'before'), 20), after: scaled(attr(spacing, 'after'), 20),
    leading: [null, 'auto'].includes(attr(spacing, 'lineRule')) ? scaled(attr(spacing, 'line'), 240) : undefined,
  };
  return Object.fromEntries(Object.entries(fields).filter(([key, value]) => paragraphFields[key].check(value)));
}
function readXML(bytes, name) {
  if (!bytes) return null;
  const data = strFromU8(bytes);
  if (/<!DOCTYPE|<!ENTITY/i.test(data)) throw new Error(`Unsupported XML declaration in ${name}.`);
  const doc = new DOMParser().parseFromString(data, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error(`The Word package contains invalid XML in ${name}.`);
  return doc.documentElement;
}

export function importDocx(bytes, fallbackTitle) {
  let expanded = 0;
  const parts = unzipSync(bytes, { filter(file) {
    if (!/^(word\/(?:document|styles|header1|footer1)\.xml|docProps\/core\.xml)$/.test(file.name)) return false;
    expanded += file.originalSize;
    if (expanded > MAX_IMPORT) throw new Error('The expanded Word document exceeds 50 MB.');
    return true;
  } });
  const root = readXML(parts['word/document.xml'], 'document.xml');
  const body = local(root, 'body');
  if (!body) throw new Error('This file does not contain a supported Word manuscript.');
  const rootStyle = readXML(parts['word/styles.xml'], 'styles.xml');
  const defaults = local(rootStyle, 'docDefaults');
  const defaultRun = readRun(local(local(defaults, 'rPrDefault'), 'rPr'));
  const defaultsParagraph = readParagraph(local(local(defaults, 'pPrDefault'), 'pPr'));
  const styleLookup = new Map(Array.from(rootStyle?.children ?? []).filter(node => node.localName === 'style').map(node => [attr(node, 'styleId'), node]));
  const core = readXML(parts['docProps/core.xml'], 'core.xml');
  const metadata = name => Array.from(core?.children ?? []).find(node => node.localName === name)?.textContent?.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 200);
  const settings = structuredClone(defaultSettings);
  if (defaultRun.font) settings.font = defaultRun.font;
  if (defaultRun.size) settings.size = defaultRun.size;
  if (defaultsParagraph.leading) settings.leading = defaultsParagraph.leading;
  const warnings = new Set();
  const manuscript = newManuscript(metadata('title') || fallbackTitle, settings);
  manuscript.metadata.author = metadata('creator') ?? '';
  const section = local(body, 'sectPr');
  const page = local(section, 'pgSz');
  const margin = local(section, 'pgMar');
  const width = scaled(attr(page, 'w'), 20);
  const height = scaled(attr(page, 'h'), 20);
  if (width >= 216 && width <= 1440 && height >= 216 && height <= 1440) {
    Object.assign(manuscript.settings, { pageSize: 'custom', width, height });
    manuscript.settings.orientation = width > height ? 'landscape' : 'portrait';
    for (const [preset, size] of Object.entries(pageSizes)) {
      if (Math.abs(size.width - Math.min(width, height)) < 0.1 && Math.abs(size.height - Math.max(width, height)) < 0.1) manuscript.settings.pageSize = preset;
    }
  } else if (page) warnings.add('Unsupported page dimensions use ScribeForge defaults.');
  for (const side of ['left', 'right', 'top', 'bottom']) {
    const value = scaled(attr(margin, side), 20);
    if (value >= 0 && value <= 288) manuscript.settings[side] = value;
  }
  if (pageDimensions(manuscript.settings).width - manuscript.settings.left - manuscript.settings.right < 72 ||
    pageDimensions(manuscript.settings).height - manuscript.settings.top - manuscript.settings.bottom < 72) {
    for (const side of ['left', 'right', 'top', 'bottom']) manuscript.settings[side] = 36;
    warnings.add('Margins were adjusted to leave room for text.');
  }
  const knownStyles = new Map(Object.entries(docxStyles).map(([key, value]) => [value.toLowerCase(), key]));
  const blocks = [];
  function inherited(id, seen = new Set()) {
    const style = styleLookup.get(id);
    if (!style || seen.has(id) || seen.size >= 50) return { paragraph: {}, run: {}, kind: knownStyles.get(id?.toLowerCase()) };
    seen.add(id);
    const parent = inherited(attr(local(style, 'basedOn')), seen);
    const props = local(style, 'pPr');
    const level = asNumber(attr(local(props, 'outlineLvl')));
    return {
      kind: knownStyles.get(id?.toLowerCase()) ?? ['chapter', 'section', 'subheading'][level] ?? parent.kind,
      paragraph: { ...parent.paragraph, ...readParagraph(props) },
      run: { ...parent.run, ...readRun(local(style, 'rPr')) },
    };
  }
  const defaultStyle = [...styleLookup].find(([, definition]) => attr(definition, 'type') === 'paragraph' && attr(definition, 'default') === '1')?.[0] ?? 'Normal';
  // Map conventional Word styles to their ScribeForge equivalents. Other Word
  // styles carry their supported paragraph and run values as explicit overrides.
  for (const [id, definition] of styleLookup) {
    const kind = knownStyles.get(id?.toLowerCase());
    if (!kind) continue;
    const fields = { ...readParagraph(local(definition, 'pPr')), ...readRun(local(definition, 'rPr')) };
    manuscript.settings.styles[kind] = Object.fromEntries(Object.entries(fields).filter(([key]) => Object.hasOwn(styleFields, key)));
  }
  function paragraph(p) {
    const pp = local(p, 'pPr');
    const id = attr(local(pp, 'pStyle')) ?? defaultStyle;
    const style = inherited(id);
    const kind = style.kind ?? 'normal';
    const presentation = { ...manuscript.settings.styles.normal, ...styles[kind], ...manuscript.settings.styles[kind] };
    const inheritedFields = Object.entries({ ...defaultsParagraph, ...style.paragraph }).filter(([key, value]) => value !== presentation[key]);
    const props = { style: kind, ...Object.fromEntries(inheritedFields), ...readParagraph(pp) };
    if (local(pp, 'numPr')) warnings.add('List numbering was omitted. Item text is preserved.');
    if (local(pp, 'sectPr')) warnings.add('Multiple Word sections use one ScribeForge page layout.');
    let inlines = [];
    let afterBreak = false;
    const flush = () => { blocks.push(schema.nodes.paragraph.create(props, inlines)); inlines = []; };
    if (enabled(local(pp, 'pageBreakBefore'))) blocks.push(schema.nodes.page_break.create());
    function readChildren(parent) {
      for (const child of parent.children) {
        const name = child.localName;
        if (name === 'r') {
          const rPr = local(child, 'rPr');
          const charStyle = inherited(attr(local(rPr, 'rStyle')));
          const direct = { ...charStyle.run, ...readRun(rPr) };
          const values = { ...defaultRun, ...style.run, ...direct };
          const marks = [];
          for (const [key, value] of Object.entries(values)) {
            if (['bold', 'italic', 'underline', 'strike'].includes(key)) {
              if (Object.hasOwn(direct, key) || value !== Boolean(presentation[key])) marks.push(schema.marks[value ? key : `un${key}`].create());
            } else if (value && schema.marks[key]) {
              const inheritedValue = presentation[key] ?? manuscript.settings[key];
              if (Object.hasOwn(direct, key) || (key !== 'font' && key !== 'size') || value !== inheritedValue) {
                marks.push(schema.marks[key].create(typeof value === 'boolean' ? null : { value }));
              }
            }
          }
          for (const part of child.children) {
            if (['t', 'tab', 'noBreakHyphen', 'softHyphen'].includes(part.localName)) {
              const text = { tab: '\t', noBreakHyphen: '\u2011', softHyphen: '\u00ad' }[part.localName] ?? part.textContent;
              if (text) inlines.push(schema.text(text, marks));
            } else if (part.localName === 'br' && attr(part, 'type') === 'page') {
              if (inlines.length) flush();
              blocks.push(schema.nodes.page_break.create()); afterBreak = true;
            } else if (['br', 'cr'].includes(part.localName)) inlines.push(schema.nodes.hard_break.create());
            else if (!['rPr', 'lastRenderedPageBreak'].includes(part.localName)) warnings.add('Images, fields, notes, or other embedded Word objects may be omitted.');
          }
        } else if (['hyperlink', 'ins', 'moveTo', 'fldSimple', 'smartTag', 'sdt', 'sdtContent', 'customXml'].includes(name)) {
          if (name === 'hyperlink') warnings.add('Hyperlink labels are preserved as text.');
          readChildren(child);
        } else if (!['pPr', 'bookmarkStart', 'bookmarkEnd', 'proofErr'].includes(name)) {
          if (['del', 'moveFrom'].includes(name)) warnings.add('Tracked deletions were omitted.');
          else if (child.textContent.trim()) throw new Error(`Unsupported Word paragraph content (${name}). Use Word to simplify the document before importing.`);
        }
      }
    }
    readChildren(p);
    if (!afterBreak || inlines.length) flush();
  }
  function walk(parent) {
    for (const node of parent.children) {
      if (node.localName === 'p') paragraph(node);
      else if (node.localName === 'tbl') {
        warnings.add('Table cells were converted to paragraphs in reading order.');
        for (const child of node.getElementsByTagNameNS(W, 'p')) paragraph(child);
      } else if (['sdt', 'sdtContent', 'customXml', 'ins'].includes(node.localName)) walk(node);
      else if (node.localName !== 'sectPr') throw new Error(`Unsupported Word document content (${node.localName}). The source file was preserved.`);
    }
  }
  walk(body);
  for (const kind of ['header', 'footer']) {
    const part = readXML(parts[`word/${kind}1.xml`], kind);
    if (!part) continue;
    const pageField = Array.from(part.getElementsByTagNameNS(W, 'fldSimple')).find(node => attr(node, 'instr')?.trim() === 'PAGE');
    if (pageField) { manuscript.settings.pageNumbers = true; pageField.remove(); }
    const text = Array.from(part.getElementsByTagNameNS(W, 't')).map(node => node.textContent).join('').replace(/\s+·\s*$/, '').trim();
    manuscript.settings[kind] = text.replace(/[\u0000-\u001f]/g, ' ').slice(0, 200);
  }
  if (!blocks.length) blocks.push(schema.nodes.paragraph.create());
  manuscript.content = schema.nodes.doc.create(null, blocks).toJSON();
  return { manuscript: decodeManuscript(manuscript), warnings: [...warnings] };
}

export async function readImport(file) {
  if (file.size > MAX_IMPORT) throw new Error('Choose a manuscript under 50 MB.');
  const title = file.name.replace(/\.[^.]+$/, '');
  if (/\.docx$/i.test(file.name)) return importDocx(new Uint8Array(await file.arrayBuffer()), title);
  const text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
  if (/\.stf$/i.test(file.name)) return { manuscript: decodeManuscript(text), warnings: [] };
  if (/\.txt$/i.test(file.name)) return { manuscript: decodeManuscript(newManuscript(title, defaultSettings, text)), warnings: [] };
  throw new Error('Choose an STF, DOCX, or UTF-8 TXT manuscript.');
}

export function exportText(manuscript) {
  return plainText(schema.nodeFromJSON(manuscript.content));
}
