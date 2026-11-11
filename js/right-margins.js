import { elementColumn, FORMAT } from './screenplay-format.js';
import { transitionClass } from './transitions.js';

const columnType = el => transitionClass(el) ? 'action' : el.type;
export function rightMarginBounds(el, dual = false) {
  const base = elementColumn(columnType(el), dual);
  // Retain at least 0.75in; dual elements stay inside their own column.
  const maxWidth = dual ? FORMAT.dualWidth - base.offset : FORMAT.width - FORMAT.right - base.left;
  return { min: Math.ceil((base.width - maxWidth) * .75), max: Math.floor((base.width - Math.min(72, base.width)) * .75) };
}
export function elementLayout(el, dual = false, column = 0, settings = {}) {
  const base = elementColumn(columnType(el), dual, column);
  const numbered = el.type === 'scene' && settings.sceneNumbers === true && el.sceneNumber;
  // Numbered headings share the reserved page gutter; stored offsets stay intact.
  const defaultWidth = numbered ? Math.min(base.width, FORMAT.sceneNumberRight - FORMAT.sceneNumberWidth - base.left) : base.width;
  const width = Math.max(Math.min(72, defaultWidth), defaultWidth - (el.rightMarginOffsetPt ?? 0) / .75);
  return { ...base, width, right: base.left + width };
}
