import { libraryActivity, writingDuration } from './analysis.js';

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}

export function setupLibraryStatistics(button, list) {
  const dialog = node('dialog', undefined, 'writing-statistics');
  dialog.setAttribute('aria-label', 'Writing Statistics');
  document.body.append(dialog);
  const number = value => Math.round(value).toLocaleString();

  button.addEventListener('click', async () => {
    const close = node('button', 'Close', 'secondary-button');
    close.onclick = () => dialog.close();
    dialog.replaceChildren(node('h1', 'Writing Statistics'), close);
    dialog.showModal();
    try {
      const manuscripts = await list();
      const { totals, days } = libraryActivity(manuscripts);
      const cards = node('div', undefined, 'writing-totals');
      const metrics = [
        ['Total writing time', writingDuration(totals.activeMs)], ['Editing time', writingDuration(totals.editingMs)],
        ['Words written (added)', number(totals.added)], ['Words deleted', number(totals.deleted)],
        ['Net words', number(totals.added - totals.deleted)], ['Writing sessions', number(totals.sessions)],
        ['Words / active hour', totals.activeMs ? number(totals.added * 3600000 / totals.activeMs) : '—'],
      ];
      for (const [label, value] of metrics) {
        const card = node('div');
        card.append(node('strong', value), node('span', label));
        cards.append(card);
      }
      const bars = node('div', undefined, 'writing-days');
      const week = days.slice(-7);
      const max = Math.max(3600000, ...week.map(day => day.activeMs));
      for (const day of week) {
        const row = node('div');
        const progress = node('progress');
        progress.max = max;
        progress.value = day.activeMs;
        progress.setAttribute('aria-label', `${day.key} active writing time`);
        row.append(node('span', `${day.key} · ${writingDuration(day.activeMs)} · ${number(day.added)} added / ${number(day.deleted)} deleted`), progress);
        bars.append(row);
      }
      dialog.append(cards, node('h2', 'Daily activity · last seven days'), bars, node('h2', 'Manuscripts'));
      for (const { metadata, activity } of manuscripts) {
        if (!activity) continue;
        dialog.append(node('p', `${metadata.title || 'Untitled Manuscript'} · ${writingDuration(activity.activeMs)} active · ${number(activity.added)} added / ${number(activity.deleted)} deleted · ${number(activity.sessions)} sessions`));
      }
    } catch (error) { dialog.append(node('p', `Statistics unavailable: ${error.message}`)); }
  });
}
