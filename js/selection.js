import { editableElements, caret } from './editing.js';
import { textRangeRect } from './screenplay-format.js';

export function domPoint(node, offset, root) {
  const element = (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement)?.closest('[data-element-id]');
  if (!element || !root.contains(element)) return null;
  const range = document.createRange();
  range.selectNodeContents(element);
  try { range.setEnd(node, offset); } catch { return null; }
  return { id: element.dataset.elementId, offset: Math.min(Number(element.dataset.end), Number(element.dataset.start) + range.toString().length) };
}

export function readSelection(root) {
  const selection = window.getSelection();
  if (!selection?.anchorNode || !selection.focusNode) return null;
  const anchor = domPoint(selection.anchorNode, selection.anchorOffset, root);
  const focus = domPoint(selection.focusNode, selection.focusOffset, root);
  return anchor && focus ? { anchor, focus } : null;
}

export function restoreSelection(root, modelSelection, { scroll = false } = {}) {
  if (!modelSelection) return;
  function locate(point) {
    const fragments = [...root.querySelectorAll(`[data-element-id="${CSS.escape(point.id)}"]`)];
    const fragment = fragments.find(el => point.offset >= Number(el.dataset.start) && point.offset < Number(el.dataset.end))
      ?? fragments.findLast(el => point.offset >= Number(el.dataset.start)) ?? fragments[0];
    if (!fragment) return null;
    const sentinel = fragment.querySelector('[data-caret-sentinel]');
    if (sentinel && point.offset >= Number(fragment.dataset.end)) return { node: sentinel.firstChild, offset: 0, fragment };
    const offset = Math.min(fragment.textContent.length, Math.max(0, point.offset - Number(fragment.dataset.start)));
    const walker = document.createTreeWalker(fragment, NodeFilter.SHOW_TEXT);
    let node, remaining = offset;
    while ((node = walker.nextNode())) {
      if (remaining <= node.length) return { node, offset: remaining, fragment };
      remaining -= node.length;
    }
    return { node: fragment, offset: 0, fragment };
  }
  const anchor = locate(modelSelection.anchor), focus = locate(modelSelection.focus);
  if (!anchor || !focus) return;
  root.focus({ preventScroll: true });
  window.getSelection().setBaseAndExtent(anchor.node, anchor.offset, focus.node, focus.offset);
  if (scroll) {
    const range = document.createRange(); range.setStart(focus.node, focus.offset); range.collapse(true);
    const rect = range.getBoundingClientRect();
    const viewport = root.closest('.document-viewport');
    if (viewport) {
      const bounds = viewport.getBoundingClientRect();
      const top = rect.top < bounds.top + 16 ? rect.top - bounds.top - 16
        : rect.bottom > bounds.bottom - 16 ? rect.bottom - bounds.bottom + 16 : 0;
      const left = rect.left < bounds.left + 16 ? rect.left - bounds.left - 16
        : rect.right > bounds.right - 16 ? rect.right - bounds.right + 16 : 0;
      viewport.scrollBy({ top, left, behavior: 'instant' });
    }
  }
}

export function adjacentCaret(doc, selection, direction) {
  const els = editableElements(doc);
  const index = els.findIndex(el => el.id === selection.focus.id);
  const other = els[index + direction];
  return other ? caret(other.id, direction < 0 ? other.text.length : 0) : selection;
}

const navigationCache = new WeakMap();
/** Move by measured visual lines, including across the physical gap between pages. */
export function verticalCaret(root, pages, selection, direction, preferredX = null) {
  const viewport = root.closest('.document-viewport');
  const bounds = viewport.getBoundingClientRect();
  const contentTop = y => y + viewport.scrollTop - bounds.top;
  const contentLeft = x => x + viewport.scrollLeft - bounds.left;
  let cache = navigationCache.get(root);
  if (cache?.pages !== pages) {
    const fragments = [...root.querySelectorAll('[data-element-id]')];
    const byId = new Map();
    for (const fragment of fragments) {
      if (!byId.has(fragment.dataset.elementId)) byId.set(fragment.dataset.elementId, []);
      byId.get(fragment.dataset.elementId).push(fragment);
    }
    const entries = [];
    for (const page of pages) for (const item of page.items) item.columns.forEach((column, col) => {
      for (const line of column) {
        const fragment = byId.get(line.id)?.find(el => line.start === Number(el.dataset.start))
          ?? byId.get(line.id)?.find(el => line.start >= Number(el.dataset.start) && line.start <= Number(el.dataset.end));
        if (!fragment) continue;
        const sentinel = line.start === Number(fragment.dataset.end) ? fragment.querySelector('[data-caret-sentinel]') : null;
        const node = sentinel?.firstChild ?? fragment.firstChild;
        const base = sentinel ? line.start : Number(fragment.dataset.start);
        let rect;
        if (node?.nodeType === Node.TEXT_NODE) {
          const offset = Math.min(node.length, line.start - base);
          const range = document.createRange(); range.setStart(node, offset); range.setEnd(node, Math.min(node.length, offset + 1)); rect = textRangeRect(range);
        } else rect = fragment.getBoundingClientRect();
        entries.push({ ...line, node, base, fragment, column: col, dual: item.kind === 'dual', top: contentTop(rect.top), left: contentLeft(rect.left) });
      }
    });
    cache = { pages, entries }; navigationCache.set(root, cache);
  }
  const point = selection.focus;
  const current = cache.entries.find(line => line.id === point.id && point.offset >= line.start && point.offset < line.end)
    ?? cache.entries.findLast(line => line.id === point.id);
  if (!current) return { selection, preferredX };
  const caretRange = document.createRange();
  if (current.node?.nodeType === Node.TEXT_NODE) {
    caretRange.setStart(current.node, Math.min(current.node.length, point.offset - current.base));
    caretRange.collapse(true);
  } else caretRange.selectNodeContents(current.fragment);
  const x = preferredX ?? contentLeft(caretRange.getBoundingClientRect().left);
  const candidates = cache.entries.filter(line => (line.top - current.top) * direction > 1 && (!current.dual || !line.dual || current.column === line.column));
  candidates.sort((a, b) => Math.abs(a.top - current.top) - Math.abs(b.top - current.top) || Math.abs(a.left - x) - Math.abs(b.left - x));
  const target = candidates[0];
  if (!target) return { selection, preferredX: x };
  let offset = target.start;
  if (target.node?.nodeType === Node.TEXT_NODE) {
    const range = document.createRange();
    let lo = target.start - target.base;
    let hi = Math.min(target.node.length, target.end - target.base);
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      range.setStart(target.node, mid); range.setEnd(target.node, mid);
      if (contentLeft(range.getBoundingClientRect().left) <= x) lo = mid;
      else hi = mid - 1;
    }
    offset = target.base + lo;
    // The newline belongs to the line before it, not the next visual line.
    if (target.node.textContent[offset - target.base - 1] === '\n') offset--;
  }
  return { selection: caret(target.id, offset), preferredX: x };
}
