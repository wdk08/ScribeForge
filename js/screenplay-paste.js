import { createElement } from './document.js';
import { parseFountain } from './fountain.js';
import { hasScenePrefix, sceneLocation } from './scene-locations.js';
import { isCommonTransition } from './transitions.js';

const unwrapBold = text => /^\*\*[^\n]+\*\*$/.test(text) ? text.slice(2, -2) : text;
function cue(text) {
  const name = text.replace(/^@/, '').replace(/\s*\^$/, '').replace(/(?:\s*\([^()]*\))+\s*$/, '').trim();
  // A sentence, heading, or long shouted action is not a reliable character cue.
  return name.length > 0 && name.length <= 45 && name.split(/\s+/).length <= 5
    && /\p{L}/u.test(name) && name === name.toUpperCase() && !/[.!?:;,]/.test(name)
    && !hasScenePrefix(name) && !isCommonTransition(name) && !/^[!>#=~]/.test(name);
}

/** Keep all supplied physical line boundaries; never turn PDF lines into spaces. */
export const normalizeScreenplayClipboard = text => text.replace(/\r\n|\r|\u2028/g, '\n').replace(/\u2029/g, '\n\n').replace(/\n?\f\n?/g, '\n');
const indentation = text => [...(text.match(/^[ \t\u00a0]*/) ?? [''])[0]].reduce((width, char) => width + (char === '\t' ? 4 - width % 4 : 1), 0);
const cueName = text => text.replace(/^@/, '').replace(/\s*\^$/, '').replace(/(?:\s*\([^()]*\))+\s*$/, '').trim().toUpperCase();
const narrativeVerbs = 'sits|stands|looks|walks|runs|enters|exits|leaves|turns|steps|moves|opens|closes|pulls|pushes|reaches|takes|puts|picks|sets|drops|falls|rises|nods|shakes|smiles|frowns|stares|glances|watches|waits|pauses|hesitates|grabs|holds|hands|crosses|leans|kneels|sighs|shrugs|gestures|points|approaches|stops|starts|drives|follows|backs|sinks|slams|flickers|flashes|rings|rolls|fades|begins|continues';
const narrativeLine = new RegExp(`^([\\p{L}\\p{M}][\\p{L}\\p{M}'’.-]*(?:[ \\t]+[\\p{L}\\p{M}][\\p{L}\\p{M}'’.-]*){0,4})[ \\t]+(${narrativeVerbs})\\b`, 'iu');
function narrative(text, names) {
  const match = text.match(narrativeLine);
  if (!match) return false;
  const subject = match[1].toUpperCase();
  return names.has(subject) || /^(?:HE|SHE|THEY|IT|WE)$/.test(subject)
    || /^(?:A|AN|THE) /.test(subject)
    || /^[\p{Lu}][\p{Ll}'’-]+(?: [\p{Lu}][\p{Ll}'’-]+){0,2}$/u.test(match[1]);
}

/** Shared recognition only: callers retain the original text and choose evidence. */
export function classifyScreenplayLine(text, { inDialogue = false, allowCue = false,
  allowTransition = true, allowParenthetical = inDialogue, names = new Set(), fallback = inDialogue ? 'dialogue' : 'action' } = {}) {
  const candidate = unwrapBold(text.trim());
  if (hasScenePrefix(candidate) && (!inDialogue || candidate === candidate.toUpperCase()
    || Boolean(sceneLocation(candidate.replace(/\s+#[\w.-]+#\s*$/, ''))?.qualifier))
    || /^\.[\p{L}\p{N}]/u.test(candidate)) return 'scene';
  if ((allowTransition && isCommonTransition(candidate)) || /^>[^<]+$/.test(candidate)) return 'transition';
  if (allowCue && (cue(candidate) || (names.has(cueName(candidate)) && cue(candidate.toUpperCase())))
    && !narrative(candidate, names)) return 'character';
  if (allowParenthetical && /^\([^\n]*\)$/.test(candidate)) return 'parenthetical';
  return fallback;
}

/** Conservative single-fragment use of the same paste recognition rules. */
export function classifyReturnFragment(text, { originalType, before, previous, following, characters = [] }) {
  if (!text.trim() || text.includes('\n')) return 'action';
  const names = new Set(characters.map(cueName)), candidate = text.trim();
  const known = names.has(cueName(candidate));
  // Speech mentioning a name is not evidence of a new speaker. A suffix of a
  // split cue is also usually a word fragment, rather than another character.
  const speechContext = ['character', 'dialogue', 'parenthetical', 'lyric'].includes(originalType);
  const finishedHeading = originalType === 'scene' && Boolean(sceneLocation(before)?.qualifier);
  const allowCue = !speechContext && (known || finishedHeading || following?.type === 'dialogue');
  let type = classifyScreenplayLine(text, { allowCue, allowParenthetical: true, names,
    inDialogue: originalType === 'dialogue', fallback: 'action',
    allowTransition: originalType !== 'dialogue' || candidate === candidate.toUpperCase() });
  if (type !== 'action') return type;
  const fromCue = originalType === 'character' && cue(before.trim())
    && (/\s$/.test(before) || /^\s/.test(text)) && !narrative(candidate, names);
  const fromParenthetical = originalType === 'parenthetical' && /^\(.*\)$/.test(before.trim())
    && ['character', 'dialogue', 'parenthetical'].includes(previous?.type) && !narrative(candidate, names);
  if (fromCue || fromParenthetical) type = 'dialogue';
  return type;
}

/** PDF layout is evidence, not content. Uncertain wraps remain literal newlines. */
export function screenplayPaste(text) {
  let normalized = normalizeScreenplayClipboard(text);
  if (!normalized.includes('\n')) return null;
  const fenced = normalized.match(/^\s*(`{3,}|~{3,})(?:fountain|screenplay|text)?[^\S\n]*\n([\s\S]*?)\n\1\s*$/i);
  if (fenced) normalized = fenced[2];
  const lines = normalized.split('\n').map(raw => ({ raw, text: raw.trim(), indent: indentation(raw) }));
  const nextVisible = new Array(lines.length); let nextIndex = -1;
  for (let i = lines.length - 1; i >= 0; i--) { nextVisible[i] = nextIndex; if (lines[i].text) nextIndex = i; }
  const candidates = lines.map(line => unwrapBold(line.text));
  const names = new Set(candidates.filter(cue).map(cueName));
  const headingIndents = lines.filter((line, i) => hasScenePrefix(candidates[i])).map(line => line.indent);
  const baseIndent = (headingIndents.length ? headingIndents : lines.filter(line => line.text).map(line => line.indent)).reduce((minimum, width) => Math.min(minimum, width), 10000);
  const pdfLayout = lines.some((line, i) => cue(candidates[i]) && line.indent >= baseIndent + 6);
  const columnNames = new Set(lines.filter((line, i) => cue(candidates[i]) && line.indent >= baseIndent + 6).map(line => cueName(unwrapBold(line.text))));
  let currentBase = baseIndent;
  const output = []; let dialogue = false, action = false, detected = false, speechIndent = null, afterCue = false, afterParenthetical = false;
  const separated = () => { if (output.length && output.at(-1) !== '') output.push(''); };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i], { raw, text: trimmed, indent } = line, candidate = candidates[i];
    const n = nextVisible[i], next = n < 0 ? '' : candidates[n];
    if (!trimmed) {
      // PDF layout can add a blank between a clearly indented cue and its speech.
      // All other blank separators terminate dialogue before classification.
      if ((afterCue || afterParenthetical) && pdfLayout && n >= 0 && lines[n].indent > currentBase + 2
        && (/^\(.*\)$/.test(next) || lines[n].indent <= speechIndent + 2)) continue;
      output.push(''); dialogue = false; action = false; afterCue = false; afterParenthetical = false; speechIndent = null; continue;
    }
    const previous = (lines[i - 1]?.text ?? '');
    const forcedCue = candidate.startsWith('@');
    const cueFollowedBySpeech = cue(candidate) && !narrative(candidate, names) && next && !hasScenePrefix(next) && (forcedCue || !cue(next) || (pdfLayout && indent >= currentBase + 6 && lines[n].indent < indent - 3 && lines[n].indent > currentBase + 2))
      && (!isCommonTransition(next) || next !== next.toUpperCase());
    const cueColumn = !pdfLayout || forcedCue || candidate !== trimmed || indent >= currentBase + 6 || columnNames.has(cueName(candidate));
    const cueSpacing = n === i + 1 || forcedCue || (pdfLayout && indent >= currentBase + 6 && lines[n]?.indent > currentBase + 2);
    const kind = classifyScreenplayLine(candidate, { inDialogue: dialogue, names,
      allowCue: Boolean(cueFollowedBySpeech && cueSpacing && cueColumn),
      allowTransition: !dialogue || candidate === candidate.toUpperCase() || candidate !== trimmed });
    if (kind === 'scene') {
      if (pdfLayout) currentBase = indent;
      separated(); output.push(candidate.startsWith('.') ? candidate : `.${candidate}`);
      if (n === i + 1) output.push(''); dialogue = false; action = false; afterCue = false; afterParenthetical = false; speechIndent = null; detected = true;
    } else if (kind === 'transition') {
      separated(); output.push(candidate.startsWith('>') ? candidate : `>${candidate.toUpperCase()}`);
      if (n === i + 1) output.push(''); dialogue = false; action = false; afterCue = false; afterParenthetical = false; speechIndent = null; detected = true;
    } else if (kind === 'character') {
      separated(); output.push(`@${candidate.replace(/^@/, '')}`);
      dialogue = true; action = false; afterCue = true; afterParenthetical = false; detected = true;
      let speech = n;
      if (/^\(.*\)$/.test(next) && nextVisible[n] >= 0) speech = nextVisible[n];
      speechIndent = speech >= 0 ? lines[speech].indent : null;
    } else {
      const parenthetical = dialogue && /^\(.*\)$/.test(trimmed);
      const layoutAction = dialogue && !parenthetical && !afterCue && pdfLayout && speechIndent != null
        && indent <= currentBase + 2 && indent + 3 <= speechIndent;
      const proseAction = !parenthetical && !afterCue && (!pdfLayout || speechIndent == null || indent < speechIndent - 2) && narrative(trimmed, names)
        && /[.!?…]['"’”)]?$/.test(previous);
      if (layoutAction || (dialogue && proseAction)) { separated(); dialogue = false; action = false; speechIndent = null; }
      const content = pdfLayout ? raw.trimStart() : raw;
      if (dialogue) output.push(content);
      else {
        output.push(action ? content : `!${content}`); action = true;
      }
      afterCue = false; afterParenthetical = parenthetical;
    }
  }
  if (!detected) return null;
  const doc = parseFountain(output.join('\n'));
  return doc.elements.map(({ source, ...el }) => el);
}

export function insertScreenplayPaste(doc, range, elements) {
  const first = range.elements[range.first], last = range.elements[range.last];
  const prefix = first.text.slice(0, range.start.offset), suffix = last.text.slice(range.end.offset);
  const begin = doc.elements.findIndex(el => el.id === first.id), end = doc.elements.findIndex(el => el.id === last.id);
  const inserted = [...elements];
  while (inserted[0]?.type === 'whitespace') inserted.shift();
  while (inserted.at(-1)?.type === 'whitespace') inserted.pop();
  const target = inserted.at(-1);
  const replacement = [];
  const fragmentText = (element, text) => element.type === 'parenthetical' ? `(${text.replace(/^\(/, '').replace(/\)$/, '')})` : text;
  if (prefix) replacement.push({ ...first, text: fragmentText(first, prefix) }, createElement('whitespace', '\n'));
  replacement.push(...inserted);
  if (suffix && ['dialogue', 'parenthetical'].includes(last.type)) {
    const cue = doc.elements.slice(0, end + 1).reverse().find(el => el.type === 'character');
    if (cue) replacement.push(createElement('whitespace', '\n'), createElement('character', cue.text, { dual: false }));
  }
  if (suffix) replacement.push(...(['dialogue', 'parenthetical'].includes(last.type) ? [] : [createElement('whitespace', '\n')]), { ...(last.id !== first.id || !prefix ? last : createElement(last.type, suffix)), text: fragmentText(last, suffix) });
  doc.elements.splice(begin, end - begin + 1, ...replacement);
  return { anchor: { id: target.id, offset: target.text.length }, focus: { id: target.id, offset: target.text.length } };
}
