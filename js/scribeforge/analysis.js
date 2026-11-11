export function dictionaryEntries(source) {
  const groups = new Map();
  const seen = new Set();
  for (const [index, line] of source.split('\n').entries()) {
    if (!line.trim()) continue;
    const [group, term, alternatives = '', ...extra] = line.split('|').map(value => value.trim());
    if (!group || !term || extra.length) throw new Error(`Line ${index + 1} needs a group and a term or phrase.`);
    const groupKey = group.toLocaleLowerCase();
    if (!groups.has(groupKey)) groups.set(groupKey, { key: groupKey, name: group, variants: [] });
    for (const text of [term, ...alternatives.split(',').map(value => value.trim()).filter(Boolean)]) {
      const key = `${groupKey}\u0000${text.toLocaleLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      groups.get(groupKey).variants.push({ key, text, term, group });
    }
  }
  return [...groups.values()];
}

export function writingActivity(initial, enabled, clock = Date.now) {
  const data = {
    activeMs: 0, editingMs: 0, added: 0, deleted: 0, sessions: 0,
    ...initial,
  };
  const days = structuredClone(data.days ?? {});
  let last = null;
  return {
    update(change) {
      if (!enabled()) { last = null; return; }
      const now = clock();
      const elapsed = last === null ? Infinity : now - last;
      if (elapsed > 5 * 60 * 1000) data.sessions++;
      if (elapsed <= 30000) {
        data.activeMs += elapsed;
        if (change.deleted || !change.added) data.editingMs += elapsed;
      }
      data.added += change.added;
      data.deleted += change.deleted;
      const key = dayKey(now);
      const day = days[key] ??= { activeMs: 0, added: 0, deleted: 0 };
      if (elapsed <= 30000) day.activeMs += elapsed;
      day.added += change.added;
      day.deleted += change.deleted;
      for (const old of Object.keys(days).sort().slice(0, -35)) delete days[old];
      last = now;
    },
    snapshot: ({ includeDays = false } = {}) => {
      const { days: _previous, ...totals } = data;
      return includeDays ? { ...totals, days: structuredClone(days) } : totals;
    },
  };
}

export function statisticsRows(index, pages, activity) {
  const number = value => value.toLocaleString();
  const duration = ms => `${Math.floor(ms / 3600000)} h ${Math.floor(ms / 60000) % 60} m`;
  return [
    ['Words', number(index.words)], ['Characters', number(index.characters)], ['Characters excluding spaces', number(index.nonSpace)],
    ['Paragraphs', number(index.paragraphs)], ['Chapters', number(index.chapters.length)], ['Manuscript pages', number(pages)],
    ['Active writing time', duration(activity.activeMs)], ['Editing time', duration(activity.editingMs)],
    ['Words added', number(activity.added)], ['Words deleted', number(activity.deleted)], ['Net word changes', number(activity.added - activity.deleted)],
    ['Writing sessions', number(activity.sessions)], ['Words per active hour', activity.activeMs > 0 ? number(Math.round(activity.added * 3600000 / activity.activeMs)) : '—'],
  ];
}

const activityKeys = ['activeMs', 'editingMs', 'added', 'deleted', 'sessions'];
const dateFormat = new Intl.DateTimeFormat('sv-SE');
const dayKey = time => dateFormat.format(time);
export const writingDuration = ms => `${Math.floor(ms / 3600000)} h ${Math.floor(ms / 60000) % 60} m`;

export function libraryActivity(records, now = new Date()) {
  const days = Array.from({ length: 14 }, (_, index) => {
    const day = new Date(now);
    day.setDate(day.getDate() - 13 + index);
    return { date: day, key: dayKey(day), activeMs: 0, added: 0, deleted: 0 };
  });
  const totals = Object.fromEntries(activityKeys.map(key => [key, 0]));
  const unique = new Map(records.filter(record => !record.deletedAt).map(record => [record.id, record]));
  for (const { activity } of unique.values()) {
    for (const key of activityKeys) totals[key] += activity?.[key] ?? 0;
    for (const day of days) {
      for (const key of ['activeMs', 'added', 'deleted']) day[key] += activity?.days?.[day.key]?.[key] ?? 0;
    }
  }
  return { totals, days };
}
