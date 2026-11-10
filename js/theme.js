// Synchronous head script applies the persisted theme before styles paint.
(() => {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  let preference = 'system';
  try {
    const saved = localStorage.getItem('scribeforge-theme');
    const previous = localStorage.getItem('storyforge-theme');
    preference = saved ?? previous ?? 'system';
    if (saved === null && previous !== null) localStorage.setItem('scribeforge-theme', previous);
  } catch {}
  const valid = value => ['light', 'dark', 'system'].includes(value) ? value : 'system';
  function apply() {
    preference = valid(preference);
    document.documentElement.dataset.theme = preference === 'system' ? media.matches ? 'dark' : 'light' : preference;
    document.documentElement.style.colorScheme = document.documentElement.dataset.theme;
    for (const input of document.querySelectorAll('[name="appearance"]')) input.checked = input.value === preference;
  }
  window.scribeForgeTheme = { get: () => preference, set(value) {
    localStorage.setItem('scribeforge-theme', valid(value)); preference = valid(value); apply();
  } };
  media.addEventListener('change', apply);
  window.addEventListener('storage', event => { if (event.key === 'scribeforge-theme') { preference = valid(event.newValue); apply(); } });
  document.addEventListener('DOMContentLoaded', apply); apply();
})();
