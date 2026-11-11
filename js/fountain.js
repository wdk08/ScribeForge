import { createDocument, createElement, meaningfulContent, validateDocument } from './document.js';
import { isCommonTransition } from './transitions.js';
export { parseInline } from './inline.js';

const heading = /^(?:INT\.\/EXT|INT\/EXT|INT|EXT|EST|I\/E)(?:\.|\s)/i;
const keyLine = /^([\p{L}][\p{L} \d_-]*):[ \t]*(.*)$/u;
const signature = el => JSON.stringify(meaningfulContent({ elements: [el] }));

/** Mask hidden syntax for classification while retaining every source character. */
function hiddenRanges(source, diagnostics) {
  const ranges = [];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\\') { i++; continue; }
    const note = source.startsWith('[[', i);
    if (!note && !source.startsWith('/*', i)) continue;
    const end = source.indexOf(note ? ']]' : '*/', i + 2);
    if (end < 0 || (note && /(?:\r\n|\r|\n){2}/.test(source.slice(i, end)))) {
      diagnostics.push({ code: 'unclosed-markup', offset: i, message: `Unclosed ${note ? 'note' : 'boneyard'} retained as text.` });
      continue;
    }
    ranges.push({ start: i, end: end + 2, type: note ? 'note' : 'boneyard' });
    i = end + 1;
  }
  return ranges;
}

function characterName(text) {
  const name = text.replace(/\s*\^$/, '').replace(/\s*\([^)]*\)\s*$/, '').trim();
  return /\p{L}/u.test(name) && name === name.toUpperCase() && name !== name.toLowerCase();
}

/** Tolerant parsing: unknown or malformed syntax remains Action, never discarded. */
function parseBody(source, options = {}) {
  if (typeof source !== 'string') throw new TypeError('Fountain input must be a string.');
  const doc = createDocument({ title: options.title });
  if (options.id) doc.id = options.id;
  const bom = source.startsWith('\uFEFF') ? '\uFEFF' : '';
  const content = source.slice(bom.length);
  const ranges = hiddenRanges(content, doc.diagnostics);
  const masked = content.split('');
  for (const range of ranges) {
    for (let p = range.start; p < range.end; p++) if (!/[\r\n]/.test(masked[p])) masked[p] = ' ';
  }
  const visible = masked.join('');
  const lines = [];
  const matcher = /([^\r\n]*)(\r\n|\n|\r|$)/g;
  let match;
  while ((match = matcher.exec(content)) && match[0]) {
    lines.push({ raw: match[1], eol: match[2], start: match.index, end: matcher.lastIndex,
      visible: visible.slice(match.index, match.index + match[1].length) });
  }
  const add = (type, start, end, text, attributes = {}) => {
    const el = createElement(type, text, attributes);
    el.source = { raw: content.slice(lines[start].start, lines[end - 1].end),
      start: lines[start].start + bom.length, end: lines[end - 1].end + bom.length, line: start + 1,
      baseline: signature(el) };
    doc.elements.push(el);
    return el;
  };
  let i = 0;
  // A title page can have arbitrary keys and indented multiline values.
  if (lines[0] && keyLine.test(lines[0].raw) && !/TO:\s*$/.test(lines[0].raw) && !isCommonTransition(lines[0].raw)) {
    let end = 0;
    while (end < lines.length && lines[end].raw !== '') end++;
    const valid = lines.slice(0, end).every(line => keyLine.test(line.raw) || /^(?: {3,}|\t)/.test(line.raw));
    if (valid) {
      while (i < end) {
        const start = i;
        const [, key, first] = lines[i++].raw.match(keyLine);
        const values = first ? [first] : [];
        while (i < end && !keyLine.test(lines[i].raw)) values.push(lines[i++].raw.replace(/^(?: {3,}|\t)/, ''));
        add('titleField', start, i, values.join('\n'), { key });
      }
      doc.title = doc.elements.find(el => /^title$/i.test(el.key))?.text ?? doc.title;
    }
  }
  let inDialogue = false;
  const isBoundary = n => n === 0 || lines[n - 1].raw === '';
  function classify(n, dialogue) {
    const line = lines[n];
    const text = line.visible.trim();
    const afterBlank = n + 1 === lines.length || lines[n + 1].raw === '';
    if (line.raw === '') return 'whitespace';
    if (/^={3,}$/.test(text)) return 'pageBreak';
    if (/^#+(?:\s|$)/.test(text)) return 'section';
    if (/^=(?!=)/.test(text)) return 'synopsis';
    if (/^!/.test(text)) return 'action';
    if (/^\.[\p{L}\p{N}]/u.test(text)) return 'scene';
    if (/^>.*<$/.test(text)) return 'centered';
    if (/^>/.test(text)) return 'transition';
    if (/^~/.test(text)) return 'lyric';
    if (/^@/.test(text)) return 'character';
    if (!dialogue && isBoundary(n) && afterBlank && heading.test(text)) return 'scene';
    if (!dialogue && isBoundary(n) && afterBlank && !/[ \t]$/.test(line.visible) && isCommonTransition(text)) return 'transition';
    if (!dialogue && isBoundary(n) && afterBlank && /TO:$/.test(line.visible.trimStart()) && characterName(text)) return 'transition';
    if (!dialogue && isBoundary(n) && !afterBlank && characterName(text)) return 'character';
    if (dialogue) return /^\(.*\)$/.test(text) ? 'parenthetical' : 'dialogue';
    return 'action';
  }
  while (i < lines.length) {
    const start = i;
    const line = lines[i];
    const range = ranges.find(r => r.start >= line.start && r.start <= line.start + line.raw.length && !content.slice(line.start, r.start).trim());
    if (range) {
      let end = i;
      while (end < lines.length && lines[end].end < range.end) end++;
      if (end < lines.length && !content.slice(range.end, lines[end].start + lines[end].raw.length).trim()) {
        add(range.type, i, end + 1, content.slice(range.start + 2, range.end - 2));
        i = end + 1; continue;
      }
    }
    const type = classify(i, inDialogue);
    let text = line.raw;
    const attrs = {};
    i++;
    if (type === 'whitespace') {
      while (i < lines.length && lines[i].raw === '') i++;
      text = content.slice(line.start, lines[i - 1].end);
      inDialogue = false;
    } else if (type === 'scene') {
      text = text.trim().replace(/^\.(?=[\p{L}\p{N}])/u, '');
      const number = text.match(/\s+#([\w.-]+)#\s*$/);
      if (number) { attrs.sceneNumber = number[1]; text = text.slice(0, number.index); }
      inDialogue = false;
    } else if (type === 'character') {
      text = text.trim().replace(/^@/, '');
      attrs.dual = /\^$/.test(text);
      text = text.replace(/\s*\^$/, '');
      inDialogue = true;
    } else if (['action', 'dialogue'].includes(type)) {
      if (type === 'action') { text = text.replace(/^(\s*)!/, '$1'); inDialogue = false; }
      else text = text.trim() ? text.trimStart() : text;
      // Two bare spaces encode a manual blank line. An explicit ! Action
      // instead carries literal spaces (including a space-only Return suffix).
      if (text === '  ' && !/^\s*!/.test(line.raw)) text = '';
      while (i < lines.length && classify(i, inDialogue) === type && !/^\s*!/.test(lines[i].raw)
        && !ranges.some(r => r.start >= lines[i].start && r.start < lines[i].end && !content.slice(lines[i].start, r.start).trim())) {
        text += '\n' + (lines[i].raw === '  ' ? '' : type === 'dialogue' && lines[i].raw.trim() ? lines[i].raw.trimStart() : lines[i].raw);
        i++;
      }
    } else if (type === 'section') {
      attrs.depth = line.visible.trim().match(/^#+/)[0].length;
      text = text.trim().replace(/^#+\s*/, ''); inDialogue = false;
    } else if (type === 'synopsis') {
      text = text.trim().replace(/^=\s*/, ''); inDialogue = false;
    } else if (type === 'centered') {
      text = text.trim().slice(1, -1).trim(); inDialogue = false;
    } else if (type === 'transition') {
      text = text.trim().replace(/^>\s*/, ''); inDialogue = false;
    } else if (type === 'lyric') text = text.trimStart().slice(1);
    else if (type === 'parenthetical') text = text.trim();
    else if (type === 'pageBreak') { text = ''; inDialogue = false; }
    add(type, start, i, text, attrs);
  }
  doc.source = { bom, newline: content.match(/\r\n|\n|\r/)?.[0] ?? '\n' };
  return validateDocument(doc);
}

function encode(el, newline) {
  const text = el.text.replace(/\r\n|\r|\n/g, newline);
  const breaks = text.split(newline).map(line => line === '' ? '  ' : line).join(newline);
  switch (el.type) {
    case 'titleField': return `${el.key}:${newline}${text.split(newline).map(line => `    ${line}`).join(newline)}`;
    case 'scene': return `.${text}${el.sceneNumber ? ` #${el.sceneNumber}#` : ''}`;
    case 'action': return `!${text.split(newline).map((line,index) => index && !line ? '  ' : line).join(newline)}`;
    case 'dialogue': return breaks;
    case 'character': return `@${text}${el.dual ? ' ^' : ''}`;
    case 'transition': return `>${text}`;
    case 'centered': return `>${text}<`;
    case 'lyric': return `~${text}`;
    case 'section': return `${'#'.repeat(el.depth)} ${text}`;
    case 'synopsis': return `= ${text}`;
    case 'note': return `[[${text}]]`;
    case 'boneyard': return `/*${text}*/`;
    case 'pageBreak': return '===';
    default: return text;
  }
}

/** Lossless for unchanged imports; edits are verified by reparsing before export. */
export function serializeFountain(doc, { canonical = false } = {}) {
  validateDocument(doc);
  const newline = doc.source?.newline ?? '\n';
  const chunks = []; let endings = 0, hasOutput = false, endsCR = false;
  // Track only newly appended text, rather than rescanning an ever-growing
  // output string for every element (quadratic on long canonical exports).
  function append(text) {
    if (!text) return; chunks.push(text); let at = text.length, count = 0;
    while (at > 0) {
      const char = text[at - 1];
      if (char === '\n') { count++; at--; if (at > 0 && text[at - 1] === '\r') at--; }
      else if (char === '\r') { count++; at--; }
      else break;
    }
    endings = at === 0 ? endings + count - (endsCR && text.startsWith('\n') ? 1 : 0) : count;
    endsCR = text.endsWith('\r'); hasOutput = true;
  }
  append(doc.source?.bom ?? '');
  const imported = Boolean(doc.source);
  let previous = null;
  let previousMeaningful = null;
  for (const el of doc.elements) {
    if (canonical && el.type !== 'whitespace') {
      const attached = ['dialogue', 'parenthetical'].includes(el.type)
        && ['character', 'dialogue', 'parenthetical', 'lyric'].includes(previousMeaningful?.type);
      const titleAttached = el.type === 'titleField' && previousMeaningful?.type === 'titleField';
      const needed = previousMeaningful && !attached && !titleAttached ? 2 : previousMeaningful ? 1 : 0;
      append(newline.repeat(Math.max(0, needed - endings)) + encode(el, newline) + newline);
    }
    else if (el.source && el.source.baseline === signature(el)) append(el.source.raw);
    else if (el.type === 'whitespace') append(el.text);
    else {
      if (hasOutput && !endings) append(newline);
      if (!imported && previous && !['dialogue', 'parenthetical'].includes(el.type)
        && !(el.type === 'titleField' && previous.type === 'titleField')) append(newline);
      const end = el.source?.raw.match(/(\r\n|\n|\r)$/)?.[0] ?? (imported ? '' : newline);
      append(encode(el, newline) + end);
    }
    previous = el;
    if (el.type !== 'whitespace') previousMeaningful = el;
  }
  const output = chunks.join('');
  const reparsed = parseFountain(output);
  if (JSON.stringify(meaningfulContent(doc)) !== JSON.stringify(meaningfulContent(reparsed))) {
    throw new Error('Cannot export this element arrangement without changing its meaning. Add appropriate blank separators or correct the element syntax. The document has not been changed.');
  }
  return output;
}

// Read legacy ScriptForge footers for migration only. New Fountain files never write them.
export function parseFountain(source, options = {}) {
  if (typeof source !== 'string') throw new TypeError('Fountain input must be a string.');
  const match = source.match(/\n\/\* ScriptForge continuations v1\n([^\n]+)\n\*\/\s*$/);
  const doc = parseBody(match ? source.slice(0, match.index) : source, options);
  if (match) {
    try {
      const cues = doc.elements.filter(el => el.type === 'character');
      for (const item of JSON.parse(match[1])) {
        const cue = cues[item.index];
        if (cue?.text === item.text && ['on', 'off'].includes(item.state)) cue.continuation = item.state;
      }
    } catch { doc.diagnostics.push({ code: 'continuation-metadata', message: 'Invalid ScriptForge continuation metadata was ignored.' }); }
  }
  return doc;
}
