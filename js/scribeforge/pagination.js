import { Plugin } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { chapterHeading, pageDimensions, schema } from './model.js';

const pixels = points => points * 4 / 3;
const pageGap = 24;
const tolerance = 0.1;

export const pageFlow = new Plugin({
  state: {
    init: () => DecorationSet.empty,
    apply(tr, current) {
      return tr.getMeta(pageFlow) ?? current.map(tr.mapping, tr.doc);
    },
  },
  props: { decorations: state => pageFlow.getState(state) },
});

export function planPages(blocks, limit, separation) {
  let used = 0;
  const breaks = [];
  const nextPage = pos => {
    breaks.push({ pos, height: Math.max(0, limit - used) + separation });
    used = 0;
  };
  for (const [index, block] of blocks.entries()) {
    if (block.manual) {
      nextPage(block.pos + 1);
      continue;
    }
    const following = blocks[index + 1];
    const keep = block.heading && following && !following.manual ?
      Math.min(following.height, following.height > limit ? following.lineHeight * 2 : following.height) : 0;
    const firstPart = block.height > limit ? block.lineHeight * 2 : block.height;
    if (used > tolerance && used + Math.min(limit, firstPart + keep) > limit + tolerance) nextPage(block.pos);
    if (block.height <= limit) {
      used += block.height;
      continue;
    }
    const lines = block.lines();
    for (const [i, line] of lines.entries()) {
      const height = (lines[i + 1]?.top ?? block.height) - line.top;
      if (i && used > tolerance && used + height > limit + tolerance) nextPage(line.pos);
      used += height;
    }
  }
  return { breaks, count: breaks.length + 1 };
}

function lineStarts(view, block, pos, scale) {
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode(node) {
      if (node.nodeType === Node.TEXT_NODE) return node.length ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      if (node.classList.contains('page-spacer')) return NodeFilter.FILTER_REJECT;
      return node.tagName === 'BR' ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    },
  });
  const range = document.createRange();
  const lines = [];
  function add(rect, position) {
    const last = lines.at(-1);
    // Superscripts and differently sized runs on the same line overlap vertically.
    if (last && Math.min(last.bottom, rect.bottom) - Math.max(last.top, rect.top) >
      Math.min(last.bottom - last.top, rect.height) * 0.35) {
      last.top = Math.min(last.top, rect.top);
      last.bottom = Math.max(last.bottom, rect.bottom);
    } else if (!last || rect.top > last.top + tolerance) {
      lines.push({ top: rect.top, bottom: rect.bottom, pos: position });
    }
  }
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const index = Array.prototype.indexOf.call(node.parentNode.childNodes, node);
      add(node.getBoundingClientRect(), view.posAtDOM(node.parentNode, index));
      continue;
    }
    range.setStart(node, 0);
    range.setEnd(node, node.length);
    const rects = [...range.getClientRects()];
    const start = view.posAtDOM(node, 0);
    rects.forEach((rect, index) => {
      let offset = 0;
      if (index && rect.top > rects[index - 1].top + tolerance) {
        let low = 1;
        let high = node.length;
        while (low < high) {
          const mid = (low + high) >>> 1;
          range.setEnd(node, mid);
          if (range.getClientRects().length > index) high = mid;
          else low = mid + 1;
        }
        offset = low - 1;
        if (offset && /[\udc00-\udfff]/u.test(node.data[offset])) offset--;
      }
      add(rect, start + offset);
    });
  }
  const firstTop = lines[0]?.top ?? 0;
  const padding = parseFloat(getComputedStyle(block).paddingTop) || 0;
  const starts = [{ top: 0, pos: pos + 1 }];
  for (const line of lines.slice(1)) {
    const top = (line.top - firstTop) / scale + padding;
    if (line.pos > starts.at(-1).pos && top > starts.at(-1).top) starts.push({ top, pos: line.pos });
  }
  return starts;
}

export function createPagination(view, paper) {
  const sheets = document.createElement('div');
  sheets.className = 'page-sheets';
  sheets.setAttribute('aria-hidden', 'true');
  paper.append(sheets);
  let cache = new WeakMap();
  let lastSettings;
  let lastDocument;
  let lastScale;
  let lastPlan = { count: 1, breaks: [] };

  return function reflow(settings, force = false) {
    if (view.composing || !paper.offsetWidth) return lastPlan;
    const { width, height } = pageDimensions(settings);
    const scale = paper.getBoundingClientRect().width / pixels(width);
    if (!force && settings === lastSettings && view.state.doc === lastDocument && scale === lastScale) return lastPlan;
    if (force || settings !== lastSettings || scale !== lastScale) cache = new WeakMap();
    const scroll = paper.closest('.document-viewport');
    const caret = view.hasFocus() ? view.coordsAtPos(view.state.selection.head).top : null;
    const scrollTop = scroll.scrollTop;
    const blocks = [];
    const limit = pixels(height - settings.top - settings.bottom);
    view.dom.classList.add('measuring-pages');
    try {
      view.state.doc.forEach((node, pos) => {
        if (node.type === schema.nodes.page_break) { blocks.push({ pos, manual: true }); return; }
        const dom = view.nodeDOM(pos);
        if (!dom) return;
        let measured = cache.get(node);
        if (!measured) {
          const blockHeight = dom.getBoundingClientRect().height / scale;
          const lineHeight = parseFloat(getComputedStyle(dom).lineHeight) || 20;
          measured = {
            height: blockHeight, lineHeight, heading: chapterHeading(node, settings),
            lines: blockHeight > limit ? lineStarts(view, dom, pos, scale).map(line => ({ ...line, pos: line.pos - pos })) : [],
          };
          cache.set(node, measured);
        }
        blocks.push({ ...measured, pos, lines: () => measured.lines.map(line => ({ ...line, pos: line.pos + pos })) });
      });
    } finally { view.dom.classList.remove('measuring-pages'); }
    const plan = planPages(blocks, limit, pixels(settings.top + settings.bottom) + pageGap);
    const decorations = DecorationSet.create(view.state.doc, plan.breaks.map(({ pos, height }, index) =>
      Decoration.widget(pos, () => {
        const spacer = document.createElement('span');
        spacer.className = 'page-spacer';
        spacer.style.height = `${height}px`;
        spacer.setAttribute('aria-hidden', 'true');
        return spacer;
      }, { key: `page-${index}-${height}`, side: -1 })));
    view.dispatch(view.state.tr.setMeta(pageFlow, decorations).setMeta('addToHistory', false)
      .setMeta('skipStatus', true).setStoredMarks(view.state.storedMarks));
    if (plan.count !== lastPlan.count || !sheets.firstChild || settings !== lastSettings) {
      sheets.replaceChildren(...Array.from({ length: plan.count }, (_, index) => {
        const sheet = document.createElement('div');
        sheet.className = 'manuscript-page';
        sheet.style.top = `${index * (pixels(height) + pageGap)}px`;
        sheet.style.height = `${pixels(height)}px`;
        if (settings.header) {
          const header = document.createElement('span');
          header.className = 'manuscript-page-header';
          header.textContent = settings.header;
          sheet.append(header);
        }
        const footer = document.createElement('span');
        footer.className = 'manuscript-page-footer';
        footer.textContent = [settings.footer, String(index + 1)].filter(Boolean).join(' · ');
        sheet.append(footer);
        return sheet;
      }));
    }
    paper.style.minHeight = `${plan.count * pixels(height) + (plan.count - 1) * pageGap}px`;
    if (caret !== null) scroll.scrollTop = scrollTop + view.coordsAtPos(view.state.selection.head).top - caret;
    lastSettings = settings;
    lastDocument = view.state.doc;
    lastScale = scale;
    return lastPlan = plan;
  };
}
