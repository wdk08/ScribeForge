import { elementLayout } from './right-margins.js';
import { CLASS_NAMES, PAGE } from './pagination.js';
import { transitionClass } from './transitions.js';

function renderColumn(lines, byId, dual, settings) {
  const column = document.createElement('div');
  column.className = dual ? 'dualColumn' : 'singleColumn';
  const grouped = [];
  for (const line of lines) {
    if (grouped.at(-1)?.id === line.id) {
      grouped.at(-1).end = line.end; grouped.at(-1).count++;
      grouped.at(-1).continuationText = (grouped.at(-1).continuationText ?? '') + (line.continuationText ?? '');
    } else grouped.push({ ...line, count: 1 });
  }
  for (const group of grouped) {
    const model = byId.get(group.id);
    const fragment = document.createElement('div');
    const dualClasses = { character: 'dualChar', parenthetical: 'dualPar', dialogue: 'dualDlg' };
    fragment.className = `screenplay-element ${CLASS_NAMES[group.type] ?? 'actionLine'} ${dual ? dualClasses[group.type] ?? '' : ''} ${transitionClass(model)}`;
    if (group.type === 'scene') {
      fragment.style.fontWeight = settings?.boldSceneHeadings === true ? '700' : '400';
      if (settings?.sceneNumbers === true && group.start === 0 && model.sceneNumber) fragment.dataset.sceneNumber = model.sceneNumber;
    }
    fragment.style.width = `${elementLayout(model, dual, 0, settings).width}px`;
    fragment.dataset.elementId = group.id;
    fragment.dataset.start = group.start;
    fragment.dataset.end = group.end;
    fragment.dataset.type = group.type;
    if (group.continuationText) fragment.dataset.continuationText = group.continuationText;
    fragment.style.height = `${group.count * PAGE.lineHeight}px`;
    if (group.type === 'parenthetical' && group.start > 0) fragment.style.textIndent = '0';
    fragment.setAttribute('aria-label', `${group.type === 'titleField' ? model.key : group.type} element`);
    let text = model.text.slice(group.start, group.end);
    if (group.end < model.text.length && text.endsWith('\n')) text = text.slice(0, -1);
    if (text) fragment.append(document.createTextNode(text));
    if (!text || text.endsWith('\n')) {
      // A trailing newline alone has no native caret rectangle in Chromium.
      // This presentation-only anchor is never copied into the screenplay model.
      const sentinel = document.createElement('span'); sentinel.dataset.caretSentinel = '';
      sentinel.textContent = '\u200b'; fragment.append(sentinel);
    }
    column.append(fragment);
  }
  return column;
}

function renderPage(page, index, byId, doc) {
    const article = document.createElement('article');
    article.className = 'screenplay-page'; article.dataset.page = index + 1;
    const number = document.createElement('div');
    number.className = 'page-number'; number.contentEditable = 'false'; number.textContent = `${index + 1}.`;
    const content = document.createElement('div'); content.className = 'page-content';
    for (const item of page.items) {
      const row = document.createElement('div');
      row.className = item.kind === 'dual' ? 'dualDialogue' : 'singleDialogue';
      row.style.marginTop = `${item.gap}px`;
      item.columns.forEach((lines, col) => {
        const wrapper = document.createElement('div');
        const marker = (text, type, offset = 0) => {
          const label = document.createElement('div');
          label.className = `screenplay-element character continuation ${type} ${item.kind === 'dual' ? 'dual-cue-marker' : ''}`;
          label.contentEditable = 'false'; label.textContent = text;
          label.style.width = `${elementLayout({ type: 'character', rightMarginOffsetPt: offset }, item.kind === 'dual').width}px`;
          label.style.height = `${PAGE.lineHeight}px`; wrapper.append(label);
        };
        if (item.headerHeight) {
          const header = document.createElement('div'); header.style.height = `${item.headerHeight}px`; wrapper.append(header);
          const start = wrapper.childNodes.length;
          for (const line of item.headers[col]) marker(line.text, 'page-continuation', line.rightMarginOffsetPt ?? 0);
          // Markers occupy a measured header area even for the shorter column.
          header.append(...[...wrapper.childNodes].slice(start));
        }
        wrapper.append(renderColumn(lines, byId, item.kind === 'dual', doc.settings));
        if (item.more[col]) {
          const padding = item.bodyHeight - lines.length * PAGE.lineHeight;
          if (padding) { const spacer = document.createElement('div'); spacer.style.height = `${padding}px`; wrapper.append(spacer); }
          marker('(MORE)', 'page-more');
        }
        row.append(wrapper);
      });
      content.append(row);
    }
    article.append(number, content); return article;
}

const rendered = new WeakMap();
/** Composition is the one path where the browser may edit text DOM itself. */
export function invalidateNativeEdit(root, fragment) {
  if (!fragment) return;
  for (const record of rendered.get(root) ?? []) if (record.node.contains(fragment)) record.signature = null;
}
/** Retain unchanged page DOM, so typing does not invalidate an entire screenplay. */
export function renderPages(root, pages, doc) {
  const byId = new Map(doc.elements.map(el => [el.id, el]));
  const previous = rendered.get(root) ?? [], next = [];
  let changedPages = 0;
  pages.forEach((page,index) => {
    // Include visible text and formatting as well as line ranges: an edit can
    // change text without changing the line/page boundaries. IDs are never regenerated.
    const text = page.items.map(item => item.columns.map(column => column.map(line => {
      const el = byId.get(line.id);
      return [el.text.slice(line.start,line.end), el.rightMarginOffsetPt, el.sceneNumber];
    })));
    const signature = JSON.stringify([page,text,doc.settings?.boldSceneHeadings,doc.settings?.sceneNumbers]);
    let node = previous[index]?.node;
    if (previous[index]?.signature !== signature || root.children[index] !== node) {
      node = renderPage(page,index,byId,doc);
      if (root.children[index]) root.replaceChild(node,root.children[index]); else root.append(node);
      changedPages++;
    }
    next.push({signature,node});
  });
  while(root.children.length > pages.length) root.lastElementChild.remove();
  rendered.set(root,next);
  return {changedPages,reusedPages:pages.length-changedPages};
}
