import { elementLayout } from './right-margins.js';
import { automaticContinuations, continuedCue } from './continuations.js';
import { dialogueGroups } from './document.js';
import { transitionClass } from './transitions.js';
import { FORMAT, textRangeRect, spacingBefore } from './screenplay-format.js';

export const PAGE = FORMAT;
// Presentation spacing only: two blank lines before later headings, one after.
export const SCENE_SPACING = Object.freeze({ before: FORMAT.sceneBefore, after: FORMAT.paragraphGap });
export const CLASS_NAMES = { scene: 'sceneHeader', action: 'actionLine', character: 'character', parenthetical: 'parenthetical', dialogue: 'dialogue', transition: 'transition', centered: 'centered', lyric: 'lyric', titleField: 'titleField', section: 'section', synopsis: 'synopsis', note: 'note', boneyard: 'boneyard' };

/** Build layout units without changing model content or assigning visual page IDs to it. */
export function layoutUnits(doc, measure) {
  const groups = dialogueGroups(doc);
  const byCharacter = new Map(groups.map(group => [group.id, group]));
  const partners = new Map(groups.filter(group => group.partnerId).map(group => [group.partnerId, group]));
  const consumed = new Set();
  const indices = new Map(doc.elements.map((el,index) => [el.id,index]));
  const continuations = automaticContinuations(doc, groups);
  const units = [];
  let gap = 0;
  const lines = (el, dual) => {
    const display = continuations.has(el.id) ? continuedCue(el.text) : null;
    return measure(display ? { ...el, text: display } : el, dual, doc.settings).map(line => ({ ...line, id: el.id, type: el.type,
      ...(display ? { start: Math.min(line.start, el.text.length), end: Math.min(line.end, el.text.length),
        displayText: display.slice(line.start, line.end), continuationText: display.slice(Math.max(line.start, el.text.length), line.end) } : {}) }));
  };
  for (const el of doc.elements) {
    if (el.type === 'titleField') continue;
    if (consumed.has(el.id)) continue;
    if (el.type === 'whitespace') { gap += Math.max(1, (el.text.match(/\r\n|\r|\n/g) ?? []).length) * PAGE.lineHeight; continue; }
    if (el.type === 'pageBreak') { units.push({ kind: 'break' }); gap = 0; continue; }
    gap = Math.max(gap, spacingBefore(units.at(-1), { type: el.type, blank: !el.text.trim() }));
    const group = byCharacter.get(el.id);
    if (group) {
      const partner = partners.get(group.id);
      const members = [group, ...(partner ? [partner] : [])];
      const columns = members.map(member => [member.character, ...member.elements].flatMap(item => {
        consumed.add(item.id); return lines(item, Boolean(partner));
      }));
      // Separators inside an already grouped speech cannot leak into the gap
      // AFTER it. This applies to single speech just as it does to dual pairs.
      const a = indices.get(group.character.id), last = partner ?? group;
      const b = indices.get((last.elements.at(-1) ?? last.character).id);
      for (let i=a;i<=b;i++) if (doc.elements[i].type === 'whitespace') consumed.add(doc.elements[i].id);
      units.push({ kind: partner ? 'dual' : 'single', type: 'character', gap, columns,
        // Page continuations ignore the separate manual after-Action override.
        // Measure extended cues with the same font and column as ordinary cues.
        continuationColumns: members.map(member => {
          const text = continuedCue(member.character.text);
          return measure({ ...member.character, text }, Boolean(partner), doc.settings)
            .map(line => ({ text: text.slice(line.start, line.end), type: 'character', ...(member.character.rightMarginOffsetPt ? { rightMarginOffsetPt: member.character.rightMarginOffsetPt } : {}) }));
        }),
        speakers: members.map(member => member.character.text), speakerStates: members.map(member => member.character.continuation ?? null), keep: Math.max(...columns.map(column => {
          const firstSpeech = column.findIndex(line => ['dialogue', 'lyric'].includes(line.type));
          return firstSpeech < 0 ? column.length : firstSpeech + Math.min(2, column.length - firstSpeech);
        })) });
    } else {
      units.push({ kind: 'single', type: el.type, blank: !el.text.trim(), gap, columns: [lines(el, false)], keep: 1 });
    }
    gap = 0;
  }
  return units;
}

/** Pure line-based packing; line boundaries come from actual browser layout measurements. */
export function paginate(units, { contentHeight = PAGE.contentHeight, lineHeight = PAGE.lineHeight } = {}) {
  if (contentHeight < lineHeight * 4) throw new RangeError('A page must fit at least four lines.');
  const pages = [{ items: [], used: 0 }];
  const newPage = () => { if (pages.at(-1).items.length) pages.push({ items: [], used: 0 }); };
  const headingKeepLines = index => {
    let count = Math.max(...units[index].columns.map(column => column.length));
    // Keep consecutive headings together with the beginning of their scene when
    // the chain fits. Page-top gap suppression is handled by the packing loop.
    for (let next = index + 1; next < units.length && units[next].kind !== 'break'; next++) {
      const following = units[next];
      count += (following.gap ?? 0) / lineHeight;
      const height = Math.max(...following.columns.map(column => column.length));
      if (following.type === 'scene') { count += height; continue; }
      count += following.type === 'character' ? following.keep ?? 1 : Math.min(2, height);
      break;
    }
    return count;
  };
  for (let index = 0; index < units.length; index++) {
    const unit = units[index];
    if (unit.kind === 'break') { newPage(); continue; }
    const columns = unit.columns.map(column => [...column]);
    let continued = false;
    while (columns.some(column => column.length)) {
      let page = pages.at(-1);
      let gap = page.items.length && !continued ? Math.min(unit.gap ?? 0, contentHeight - lineHeight) : 0;
      const headingKeep = unit.type === 'scene' ? headingKeepLines(index) : unit.keep ?? 1;
      const needed = Math.min(contentHeight, Math.max(1, headingKeep) * lineHeight + gap);
      if (!continued && page.items.length && page.used + needed > contentHeight) {
        newPage(); page = pages.at(-1); gap = 0;
      }
      const speech = unit.type === 'character';
      const headers = columns.map((column, col) => continued && speech && column.length
        ? unit.continuationColumns?.[col] ?? [{ type: 'character', text: continuedCue(unit.speakers?.[col] ?? '') }] : []);
      const headerRows = Math.max(0, ...headers.map(lines => lines.length));
      const continuationHeight = headerRows * lineHeight;
      let capacity = Math.floor((contentHeight - page.used - gap - continuationHeight) / lineHeight);
      if (capacity < 1) {
        if (!page.items.length) throw new RangeError('The continued character cue is too tall for a screenplay page. Shorten the cue or its extensions.');
        newPage(); continue;
      }
      // Reserve the outgoing MORE line BEFORE splitting dialogue. Both dual
      // columns advance together; only a column with remaining speech gets MORE.
      if (speech && columns.some(column => column.length > capacity)) capacity--;
      if (capacity < 1) {
        if (!page.items.length) throw new RangeError('The continued cue and dialogue cannot fit on this page. Shorten the character cue.');
        newPage(); continue;
      }
      // A parenthetical at the split stays with the first spoken line after it.
      while (capacity > 1 && columns.some(column => column[capacity - 1]?.type === 'parenthetical' && column.length > capacity)) capacity--;
      // Keep existing speech with its cue. A cue/parenthetical still being
      // drafted has no speech to strand and must not be pushed to a new page.
      if (!continued && speech && page.items.length && columns.some(column =>
        column.some(line => ['dialogue', 'lyric'].includes(line.type)) &&
        !column.slice(0, capacity).some(line => ['dialogue', 'lyric'].includes(line.type)))) {
        newPage(); continue;
      }
      const chunks = columns.map(column => column.splice(0, capacity));
      const count = Math.max(...chunks.map(chunk => chunk.length));
      const more = columns.map(column => speech && column.some(line => ['dialogue', 'lyric'].includes(line.type)));
      const moreHeight = more.some(Boolean) ? lineHeight : 0;
      const height = count * lineHeight + continuationHeight + moreHeight;
      page.items.push({ kind: unit.kind, gap, columns: chunks, headers, headerHeight: continuationHeight,
        more, moreHeight, bodyHeight: count * lineHeight, continued, speakers: unit.speakers ?? [], speakerStates: unit.speakerStates ?? [], height });
      page.used += gap + height;
      if (columns.some(column => column.length)) { continued = true; newPage(); }
    }
  }
  return pages;
}

/** Browser DOM measurement, cached per text/type/column width. No line-count guesses. */
export function createMeasurer(container) {
  const cache = new Map();
  return (el, dual = false, settings = {}) => {
    const key = JSON.stringify([el.type, el.text, dual, el.rightMarginOffsetPt ?? 0, settings.boldSceneHeadings === true, el.type === 'scene' && settings.sceneNumbers === true && Boolean(el.sceneNumber)]);
    if (cache.has(key)) return cache.get(key);
    const paragraph = document.createElement('div');
    paragraph.className = `screenplay-element ${CLASS_NAMES[el.type] ?? 'actionLine'} ${dual ? 'dualMeasure' : ''} ${transitionClass(el)}`;
    if (el.type === 'scene') paragraph.style.fontWeight = settings.boldSceneHeadings === true ? '700' : '400';
    paragraph.style.width = `${elementLayout(el, dual, 0, settings).width}px`;
    const node = document.createTextNode(el.text + '\u200b');
    paragraph.append(node); container.replaceChildren(paragraph);
    const range = document.createRange();
    const y = offset => {
      range.setStart(node, offset); range.setEnd(node, offset + 1);
      return textRangeRect(range).top;
    };
    const result = [];
    let start = 0;
    while (start <= el.text.length) {
      const top = y(start);
      let lo = start, hi = el.text.length;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (Math.abs(y(mid) - top) < 1) lo = mid;
        else hi = mid - 1;
      }
      const end = Math.min(el.text.length, lo + 1);
      result.push({ start, end, height: PAGE.lineHeight });
      if (lo >= el.text.length) break;
      start = lo + 1;
    }
    // Prevent unbounded stale text measurements in long editing sessions.
    if (cache.size >= 3000) cache.delete(cache.keys().next().value);
    cache.set(key, result);
    return result;
  };
}
