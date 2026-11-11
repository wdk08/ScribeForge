import { blankCover, coverDimensions, validateCover } from './cover-model.js';
import { coverExport, drawCover, importArtwork } from './cover-render.js';
import { fontName, pageDimensions } from './model.js';
import { $, errorMessage, exportBytes, fileName } from './ui.js';

const names = { text: 'Text box', rect: 'Rectangle', ellipse: 'Ellipse', image: 'Image' };
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function setupCover({ view, get, update, countPages, editable, save }) {
  const dialog = $('cover-workspace');
  const canvas = $('cover-canvas');
  const viewport = $('viewport');
  const options = $('cover-options');
  const inspector = $('cover-inspector');
  const status = $('cover-status');
  const past = [];
  const future = [];
  let cover;
  let selected;
  let gesture;
  let scrollPosition;
  let pageCount;
  let drawVersion = 0;
  const dimensions = () => coverDimensions(pageDimensions(get().settings), pageCount, cover);
  const active = () => cover.elements.find(item => item.id === selected);

  function draw() {
    const version = ++drawVersion;
    const next = document.createElement('canvas');
    void drawCover(next, cover, dimensions(), { preview: true, selected: active() }).then(() => {
      if (version !== drawVersion) return;
      canvas.width = next.width;
      canvas.height = next.height;
      canvas.getContext('2d').drawImage(next, 0, 0);
    }).catch(error => { if (version === drawVersion) status.textContent = errorMessage(error); });
  }

  function render() {
    const item = active();
    const size = dimensions();
    options.querySelectorAll('[data-cover]').forEach(input => {
      const key = input.dataset.cover;
      if (input.type === 'checkbox') input.checked = cover[key];
      else input.value = cover[key] ?? '';
    });
    $('cover-elements').replaceChildren(new Option('Choose an element', ''),
      ...cover.elements.map((element, i) => new Option(`${i + 1}. ${names[element.type]}`, element.id)));
    $('cover-elements').value = item?.id ?? '';
    inspector.hidden = !item;
    inspector.querySelectorAll('[data-element]').forEach(input => {
      const key = input.dataset.element;
      const available = item && Object.hasOwn(item, key);
      input.closest('label').hidden = !available;
      if (!available) return;
      if (input.type === 'checkbox') input.checked = item[key];
      else input.value = ['x', 'y', 'width', 'height'].includes(key) ? String(Math.round(item[key] * 10000) / 100) : item[key];
    });
    $('cover-undo').disabled = !past.length;
    $('cover-redo').disabled = !future.length;
    $('cover-remove-background').disabled = !cover.backgroundImage;
    $('cover-dimensions').textContent = `${size.panels.map(panel => panel.name).join(' · ')}   |   ${size.width.toFixed(1)} × ${size.height.toFixed(1)} pt trim` +
      (cover.layout === 'wrap' ? `   |   ${size.spine.toFixed(1)} pt spine · ${pageCount} manuscript pages` : '');
    status.textContent = size.warning;
    draw();
  }

  function commit(next, before = cover) {
    validateCover(next, fontName);
    if (Object.keys(next).every(key => key === 'elements' ? next.elements.length === before.elements.length &&
      next.elements.every((element, index) => Object.entries(element).every(([field, value]) => before.elements[index][field] === value)) : next[key] === before[key])) { cover = next; render(); return; }
    past.push(before);
    if (past.length > 40) past.shift();
    future.length = 0;
    cover = next;
    update(cover);
    render();
  }
  function perform(action) {
    try { action(); }
    catch (error) { render(); status.textContent = errorMessage(error); }
  }
  function updateElement(next) {
    const elements = cover.elements.map(item => item.id === next.id ? next : item);
    commit({ ...cover, elements });
  }
  function history(from, to) {
    if (!from.length) return;
    to.push(cover);
    cover = from.pop();
    update(cover);
    render();
  }
  function add(type, src) {
    if (!editable()) return;
    const id = crypto.randomUUID();
    const element = { id, type, x: .54, y: .2, width: .38, height: .24 };
    if (cover.layout === 'front') element.x = .1;
    if (type === 'text') Object.assign(element, { text: 'Your title', size: 38, font: 'Georgia', color: '#49339a', bold: false, italic: false, underline: false });
    else if (type === 'image') element.src = src;
    else element.color = '#49339a';
    selected = id;
    commit({ ...cover, elements: [...cover.elements, element] });
  }

  $('open-cover').addEventListener('click', () => {
    scrollPosition = [viewport.scrollLeft, viewport.scrollTop];
    pageCount = countPages();
    cover = get().cover ?? blankCover();
    dialog.showModal();
    render();
  });
  dialog.addEventListener('close', () => {
    gesture = null;
    viewport.scrollTo(...scrollPosition);
    view.focus();
  });
  $('cover-undo').addEventListener('click', () => history(past, future));
  $('cover-redo').addEventListener('click', () => history(future, past));
  $('cover-elements').addEventListener('change', event => { selected = event.target.value; render(); });
  for (const type of ['text', 'rect', 'ellipse']) $(`cover-add-${type}`).addEventListener('click', () => perform(() => add(type)));
  $('cover-remove').addEventListener('click', () => perform(() => commit({ ...cover, elements: cover.elements.filter(item => item.id !== selected) })));
  $('cover-remove-background').addEventListener('click', () => perform(() => commit({ ...cover, backgroundImage: null })));

  options.addEventListener('change', event => {
    const input = event.target;
    const key = input.dataset.cover;
    if (!key || !editable()) return;
    perform(() => {
      const value = input.type === 'checkbox' ? input.checked : input.type === 'number' ?
        (key === 'spine' && input.value === '' ? null : input.valueAsNumber) : input.value;
      commit({ ...cover, [key]: value });
    });
  });
  inspector.addEventListener('change', event => {
    const input = event.target;
    const key = input.dataset.element;
    const item = active();
    if (!key || !item || !editable()) return;
    perform(() => {
      const next = { ...item, [key]: input.type === 'checkbox' ? input.checked : input.type === 'number' ? input.valueAsNumber : input.value };
      if (['x', 'y', 'width', 'height'].includes(key)) {
        next[key] /= 100;
        next.width = clamp(next.width, .01, 1);
        next.height = clamp(next.height, .01, 1);
        next.x = clamp(next.x, 0, 1 - next.width);
        next.y = clamp(next.y, 0, 1 - next.height);
      }
      updateElement(next);
    });
  });

  for (const [key, handler] of [['image', src => add('image', src)], ['background', src => commit({ ...cover, backgroundImage: src })]]) {
    const input = $(`cover-${key}-file`);
    $(`cover-upload-${key}`).addEventListener('click', () => input.click());
    input.addEventListener('change', async () => {
      const file = input.files[0];
      input.value = '';
      if (!file || !editable()) return;
      try { const source = await importArtwork(file); if (dialog.open) handler(source); }
      catch (error) { status.textContent = errorMessage(error); }
    });
  }

  function pointer(event) {
    const rect = canvas.getBoundingClientRect();
    const { width, height } = dimensions();
    return {
      x: ((event.clientX - rect.left) / rect.width * (width + 2 * cover.bleed) - cover.bleed) / width,
      y: ((event.clientY - rect.top) / rect.height * (height + 2 * cover.bleed) - cover.bleed) / height,
    };
  }
  canvas.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !editable()) return;
    const { x, y } = pointer(event);
    const item = active();
    const rect = canvas.getBoundingClientRect();
    const resize = item && Math.abs(x - item.x - item.width) < 10 / rect.width && Math.abs(y - item.y - item.height) < 10 / rect.height;
    const hit = resize ? item : [...cover.elements].reverse().find(element =>
      x >= element.x && x <= element.x + element.width && y >= element.y && y <= element.y + element.height);
    selected = hit?.id;
    if (hit) {
      gesture = { before: cover, item: hit, x, y, resize };
      canvas.setPointerCapture(event.pointerId);
    }
    render();
  });
  canvas.addEventListener('pointermove', event => {
    if (!gesture) return;
    const { before, item, x, y, resize } = gesture;
    const point = pointer(event);
    const next = { ...item };
    if (resize) {
      next.width = clamp(item.width + point.x - x, .01, 1 - item.x);
      next.height = clamp(item.height + point.y - y, .01, 1 - item.y);
    } else {
      next.x = clamp(item.x + point.x - x, 0, 1 - item.width);
      next.y = clamp(item.y + point.y - y, 0, 1 - item.height);
    }
    cover = { ...before, elements: before.elements.map(element => element.id === item.id ? next : element) };
    draw();
  });
  canvas.addEventListener('pointerup', () => {
    if (!gesture) return;
    const { before } = gesture;
    gesture = null;
    perform(() => commit(cover, before));
  });
  canvas.addEventListener('pointercancel', () => {
    if (!gesture) return;
    cover = gesture.before;
    gesture = null;
    render();
  });
  for (const format of ['png', 'pdf']) $(`cover-export-${format}`).addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const bytes = await coverExport(cover, dimensions(), format);
      await exportBytes(`${fileName(get().metadata.title)}-cover.${format}`, bytes, format === 'png' ? 'image/png' : 'application/pdf');
    } catch (error) { status.textContent = errorMessage(error); }
    finally { button.disabled = false; }
  });
  dialog.addEventListener('keydown', event => {
    if (!(event.metaKey || event.ctrlKey)) return;
    const key = event.key.toLowerCase();
    if (key === 's') { event.preventDefault(); void save(); }
    if (['z', 'y'].includes(key) && !event.target.matches('input, textarea, select')) {
      event.preventDefault();
      if (key === 'y' || event.shiftKey) history(future, past);
      else history(past, future);
    }
  });
  if (!editable()) {
    $('open-cover').disabled = true;
  }
}
