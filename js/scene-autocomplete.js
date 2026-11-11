import { SceneLocationIndex, sceneLocation } from './scene-locations.js';

export function setupSceneAutocomplete({ root, getDocument, getSelection, apply }) {
  const index = new SceneLocationIndex(), popup = document.createElement('div'); popup.id = 'scene-autocomplete'; popup.className = 'scene-autocomplete'; popup.role = 'listbox'; popup.setAttribute('aria-label', 'Scene locations'); popup.hidden = true; document.body.append(popup);
  root.setAttribute('aria-autocomplete', 'list'); root.setAttribute('aria-controls', popup.id); root.setAttribute('aria-expanded', 'false');
  let options = [], selected = -1, snapshot, armed = false, dismissed = '', accepting = false, signature = '', frame;
  const selectionKey = () => { const doc = getDocument(), selection = getSelection(), el = doc?.elements.find(el => el.id === selection?.focus.id); return `${el?.id}:${el?.text}:${selection?.focus.offset}`; };
  function hide({ dismiss = false } = {}) {
    if (dismiss) dismissed = selectionKey(); popup.hidden = true; root.setAttribute('aria-expanded', 'false'); root.removeAttribute('aria-activedescendant'); selected = -1; signature = '';
  }
  function position() {
    if (popup.hidden) return;
    const selection = window.getSelection(), node = selection?.focusNode;
    const fragment = (node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement)?.closest('[data-element-id]');
    if (!fragment || !root.contains(fragment) || fragment.dataset.elementId !== snapshot?.id) { hide(); return; }
    const rect = fragment.getBoundingClientRect(), viewport = root.closest('.document-viewport').getBoundingClientRect();
    if (rect.bottom < viewport.top || rect.top > viewport.bottom) { hide(); return; }
    const width = Math.min(390, innerWidth - 24), bottom = Math.min(innerHeight - 12, viewport.bottom), below = bottom - rect.bottom - 5, above = rect.top - Math.max(12, viewport.top) - 5;
    const flip = below < 55 && above > below, available = Math.max(0, flip ? above : below);
    if (available < 28) { hide(); return; }
    popup.style.width = `${width}px`; popup.style.maxHeight = `${Math.min(288, available)}px`;
    popup.style.left = `${Math.max(12, Math.min(rect.left, innerWidth - width - 12))}px`;
    popup.style.top = `${flip ? rect.top - Math.min(popup.scrollHeight, 288, available) - 5 : rect.bottom + 5}px`;
  }
  function highlight(next) {
    selected = next; for (const [i, button] of [...popup.children].entries()) button.setAttribute('aria-selected', String(i === selected));
    if (selected >= 0) { root.setAttribute('aria-activedescendant', popup.children[selected].id); popup.children[selected].scrollIntoView({ block: 'nearest' }); }
    else root.removeAttribute('aria-activedescendant');
  }
  function accept(option) {
    if (!snapshot) return; accepting = true; const current = snapshot; hide();
    try { apply({ type: 'completeSceneLocation', elementId: current.id, before: current.text, location: option.label }); }
    finally { accepting = false; dismissed = selectionKey(); armed = false; hide(); }
  }
  function update({ edited = false } = {}) {
    if (accepting) return;
    const doc = getDocument(), selection = getSelection();
    if (!doc || !selection || document.activeElement !== root || selection.anchor.id !== selection.focus.id || selection.anchor.offset !== selection.focus.offset) { hide(); return; }
    const el = doc.elements.find(el => el.id === selection.focus.id);
    if (edited) { armed = true; dismissed = ''; }
    if (!el || el.type !== 'scene') { armed = false; snapshot = null; hide(); return; }
    if (snapshot && snapshot.id !== el.id && !edited) armed = false;
    const query = sceneLocation(el.text);
    if (!armed || !query || (query.qualifier && selection.focus.offset > query.locationEnd) || dismissed === selectionKey()) { hide(); return; }
    options = index.suggest(doc, el.text); snapshot = { id: el.id, text: el.text };
    if (!options.length) { hide(); return; }
    const nextSignature = JSON.stringify([el.id, el.text, options.map(option => [option.key, option.label])]);
    if (signature !== nextSignature) {
      signature = nextSignature; const tree = document.createDocumentFragment();
      options.forEach((option, i) => {
        const button = document.createElement('button'); button.type = 'button'; button.role = 'option'; button.id = `scene-location-${i}`; button.tabIndex = -1; button.setAttribute('aria-selected', 'false');
        const normalized = option.label.length - option.location.length + (query.location ? query.location.length : -1);
        const mark = document.createElement('mark'); mark.textContent = option.label.slice(0, normalized); button.append(mark, option.label.slice(normalized));
        button.addEventListener('mousedown', event => event.preventDefault()); button.addEventListener('click', () => accept(option)); tree.append(button);
      });
      popup.replaceChildren(tree); selected = -1; root.removeAttribute('aria-activedescendant');
    }
    popup.hidden = false; root.setAttribute('aria-expanded', 'true'); position();
  }
  function keydown(event) {
    if (popup.hidden || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.isComposing) return false;
    if (event.key === 'Escape') { event.preventDefault(); hide({ dismiss: true }); return true; }
    if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); highlight((selected + (event.key === 'ArrowDown' ? 1 : selected < 0 ? options.length : -1) + options.length) % options.length); return true; }
    if (['Enter', 'Tab'].includes(event.key) && selected >= 0) { event.preventDefault(); accept(options[selected]); return true; }
    return false;
  }
  document.addEventListener('mousedown', event => { if (!popup.contains(event.target)) { armed = false; hide({ dismiss: true }); } });
  document.addEventListener('focusin', event => { if (event.target !== root && !root.contains(event.target) && !popup.contains(event.target)) hide({ dismiss: true }); });
  root.addEventListener('compositionstart', () => hide());
  const reposition = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(position); };
  window.addEventListener('scroll', reposition, true); window.addEventListener('resize', reposition);
  return { update, keydown, hide };
}
