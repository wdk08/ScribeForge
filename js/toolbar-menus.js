export function setupToolbarMenus() {
  const menus = [...document.querySelectorAll('.editing-bar .toolbar-menu')];
  function closeAll(except = null) { for (const menu of menus) if (menu !== except) { menu.open = false; menu.querySelector('summary').setAttribute('aria-expanded', 'false'); } }
  for (const menu of menus) {
    const summary = menu.querySelector('summary'); summary.setAttribute('aria-expanded', 'false');
    summary.addEventListener('click', event => { event.preventDefault(); const open = !menu.open; closeAll(); menu.open = open; summary.setAttribute('aria-expanded', String(open)); });
    menu.addEventListener('toggle', () => { if (menu.open) closeAll(menu); summary.setAttribute('aria-expanded', String(menu.open)); });
    menu.addEventListener('click', event => { if (event.target.closest('button')) closeAll(); });
    menu.addEventListener('keydown', event => {
      const buttons = [...menu.querySelectorAll('button:not(:disabled)')]; const at = buttons.indexOf(document.activeElement);
      if (event.key === 'Escape') { event.preventDefault(); closeAll(); summary.focus(); }
      else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault(); closeAll(menu); menu.open = true; summary.setAttribute('aria-expanded', 'true');
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : event.key === 'ArrowDown' ? (at + 1) % buttons.length : (at < 0 ? buttons.length - 1 : at - 1 + buttons.length) % buttons.length;
        buttons[next]?.focus();
      }
    });
  }
  document.addEventListener('click', event => { if (!menus.some(menu => menu.contains(event.target))) closeAll(); });
  document.addEventListener('focusin', event => { if (!menus.some(menu => menu.contains(event.target))) closeAll(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') { const menu = menus.find(menu => menu.open); if (menu) { event.preventDefault(); closeAll(); menu.querySelector('summary').focus(); } } });
  return { closeAll };
}
