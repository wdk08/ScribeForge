/** Decorate the actual focused writing fragment; never measure or change its layout. */
export function setupActiveElement(root) {
  let active = null;
  const update = () => {
    const selection = root.ownerDocument.defaultView.getSelection();
    const node = selection?.focusNode;
    const fragment = (node?.nodeType === 1 ? node : node?.parentElement)?.closest('[data-element-id]');
    const next = root.ownerDocument.activeElement === root && root.contains(fragment) ? fragment : null;
    if (next === active) return;
    active?.classList.remove('active-writing-area');
    active = next;
    active?.classList.add('active-writing-area');
  };
  root.ownerDocument.addEventListener('selectionchange', update);
  root.addEventListener('focus', update);
  root.addEventListener('blur', () => { active?.classList.remove('active-writing-area'); active = null; });
  return { update };
}
