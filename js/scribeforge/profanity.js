import { dictionaryEntries } from './analysis.js';
import { analyzeProfanity, defaultProfanityGroups, variationKey } from './profanity-matching.js';
import { $, getPreference, setPreference } from './ui.js';

function readGroups() {
  const stored = getPreference('profanity-groups', null);
  if (Array.isArray(stored) && stored.every(group => typeof group?.name === 'string' &&
    Array.isArray(group.variations) && group.variations.every(variant => typeof variant?.text === 'string'))) return stored;
  const groups = defaultProfanityGroups();
  // Retain dictionary entries and disabled settings from the first ScribeForge build.
  const disabled = new Set(getPreference('dictionary-disabled', []));
  try {
    for (const entry of dictionaryEntries(getPreference('dictionary', ''))) {
      let group = groups.find(item => variationKey(item.name) === entry.key);
      if (!group) {
        group = { name: entry.name, enabled: true, variations: [] };
        groups.push(group);
      }
      if (disabled.has(entry.key)) group.enabled = false;
      for (const variant of entry.variants) {
        const existing = group.variations.find(item => variationKey(item.text) === variationKey(variant.text));
        if (!existing) group.variations.push({ text: variant.text, enabled: !disabled.has(variant.key) });
        else if (disabled.has(variant.key)) existing.enabled = false;
      }
    }
  } catch { /* Keep the original stored dictionary available for manual recovery. */ }
  return groups;
}

function node(tag, text = '') {
  const element = document.createElement(tag);
  element.textContent = text;
  return element;
}
function button(text, action) {
  const control = node('button', text);
  control.type = 'button';
  control.onclick = action;
  return control;
}
function field(label, value, change, type = 'text') {
  const wrapper = node('label', label + ' ');
  const input = node('input');
  input.type = type;
  if (type === 'checkbox') input.checked = value;
  else input.value = value;
  input.onchange = () => change(type === 'checkbox' ? input.checked : input.value);
  wrapper.append(input);
  return wrapper;
}

export function setupProfanityAnalyzer({ getDocument, navigate }) {
  const dialog = $('profanity-dialog'), dictionary = $('profanity-dictionary');
  const groupFilter = $('profanity-group'), variationFilter = $('profanity-variation'), chapterFilter = $('profanity-chapter');
  const status = $('profanity-status');
  let groups, analyzedGroups, analyzedDocument, analysis, timer, visibleCount = 100;

  function change(edit, structural = true) {
    try {
      const next = structuredClone(groups);
      edit(next);
      // Preserve focus while editing fields. Structural edits rebuild the list.
      groups = next;
      try { setPreference('profanity-groups', next); }
      catch (error) { groups = readGroups(); throw error; }
      if (structural) renderDictionary();
      status.textContent = '';
      refresh();
      return true;
    } catch (error) { status.textContent = error.message; return false; }
  }

  function checkedLabel(label, checked, edit) {
    const wrapper = field(label, checked, () => {}, 'checkbox');
    const input = wrapper.querySelector('input');
    input.onchange = () => { if (!change(next => edit(next, input.checked), false)) input.checked = !input.checked; };
    return wrapper;
  }

  function textField(label, value, edit) {
    const wrapper = field(label, value, () => {});
    const input = wrapper.querySelector('input');
    input.maxLength = 120;
    let saved = value;
    input.onchange = () => {
      if (change(next => edit(next, input.value), false)) saved = input.value;
      else input.value = saved;
    };
    return wrapper;
  }

  function term(value) {
    const cleaned = value.trim();
    if (!cleaned || cleaned.length > 120) throw new Error('Enter a name or phrase of up to 120 characters.');
    return cleaned;
  }

  function updateVariation(next, gi, vi, value) {
    const variants = next[gi].variations, text = term(value);
    if (variants.some((item, i) => i !== vi && variationKey(item.text) === variationKey(text))) throw new Error('This variation already exists in the group.');
    if (vi === undefined) variants.push({ text, enabled: true });
    else variants[vi].text = text;
  }

  function renderDictionary() {
    dictionary.replaceChildren();
    groups.forEach((group, gi) => {
      const section = node('fieldset');
      section.append(node('legend', group.name),
        textField('Group name', group.name, (next, value) => {
          next[gi].name = term(value);
          section.querySelector('legend').textContent = next[gi].name;
        }),
        checkedLabel('Enabled', group.enabled, (next, checked) => { next[gi].enabled = checked; }),
        button('Delete group', () => change(next => next.splice(gi, 1))));
      group.variations.forEach((variation, vi) => {
        const row = node('div');
        row.append(textField('Variation ' + (vi + 1), variation.text, (next, value) => updateVariation(next, gi, vi, value)),
          checkedLabel('Enabled', variation.enabled, (next, checked) => { next[gi].variations[vi].enabled = checked; }),
          button('Remove variation', () => change(next => next[gi].variations.splice(vi, 1))));
        section.append(row);
      });
      const entry = node('input');
      entry.maxLength = 120;
      entry.setAttribute('aria-label', 'New variation for ' + group.name);
      section.append(entry, button('Add variation', () => change(next => updateVariation(next, gi, undefined, entry.value))));
      dictionary.append(section);
    });
  }

  function fillOptions(select, all, entries) {
    const selected = select.value;
    select.replaceChildren(new Option(all, ''), ...entries.map(([value, label]) => new Option(label, value)));
    select.value = entries.some(([value]) => value === selected) ? selected : '';
  }

  function refresh() {
    if (!dialog.open) return;
    const doc = getDocument();
    if (doc !== analyzedDocument || groups !== analyzedGroups) {
      analysis = analyzeProfanity(doc, groups);
      analyzedDocument = doc;
      analyzedGroups = groups;
    }
    fillOptions(groupFilter, 'All groups', groups.map((group, i) => [String(i), group.name]));
    fillOptions(variationFilter, 'All variations', groups.flatMap((group, i) => groupFilter.value && groupFilter.value !== String(i) ? [] :
      group.variations.map((variant, j) => [i + ':' + j, group.name + ' · ' + variant.text])));
    fillOptions(chapterFilter, 'All chapters', analysis.chapters.map(scene => [scene.id || 'front', scene.label]));
    const matches = analysis.matches.filter(match =>
      (!groupFilter.value || groupFilter.value === String(match.groupIndex)) &&
      (!variationFilter.value || variationFilter.value === match.groupIndex + ':' + match.variationIndex) &&
      (!chapterFilter.value || chapterFilter.value === (match.chapterId || 'front')));
    $('profanity-totals').textContent = analysis.matches.length + ' occurrences · ' + analysis.unique + ' unique variations · ' + matches.length + ' shown by filters';
    const expanded = new Set([...$('profanity-counts').querySelectorAll('details[open]')].map(item => item.dataset.group));
    $('profanity-counts').replaceChildren(...groups.map((group, i) => {
      const counts = analysis.variationCounts[i];
      const list = node('ul');
      list.append(...group.variations.map((variant, j) => node('li', variant.text + ' · ' + counts[j] + (variant.enabled ? '' : ' (off)'))));
      const row = node('details');
      row.dataset.group = group.name;
      row.open = expanded.has(group.name);
      row.append(node('summary', group.name + ' · ' + counts.reduce((a, b) => a + b, 0) + (group.enabled ? '' : ' (off)')), list);
      return row;
    }));
    const chapterCounts = new Map();
    for (const match of matches) chapterCounts.set(match.chapterId, (chapterCounts.get(match.chapterId) ?? 0) + 1);
    const breakdown = new Map(analysis.chapters.map(scene => [scene.id, scene.label]));
    $('profanity-chapter-counts').replaceChildren(...[...chapterCounts].map(([id, count]) => node('li', breakdown.get(id) + ' · ' + count)));
    $('profanity-occurrences').replaceChildren(...matches.slice(0, visibleCount).map(match => {
      const row = node('li');
      row.append(button(match.text + ' · ' + breakdown.get(match.chapterId), () => {
        if (getDocument() !== analyzedDocument) { refresh(); return; }
        navigate(match);
      }));
      return row;
    }));
    $('profanity-more').hidden = visibleCount >= matches.length;
  }

  groups = readGroups();
  window.addEventListener('storage', event => {
    if (event.key !== 'scribeforge.profanity-groups' && event.key !== null) return;
    groups = readGroups();
    if (dialog.open) renderDictionary();
    refresh();
  });
  $('profanity').onclick = () => {
    if (!dialog.open) { dialog.show(); renderDictionary(); }
    refresh();
  };
  $('profanity-close').onclick = () => dialog.close();
  $('profanity-add-group').onclick = () => {
    const input = $('profanity-new-group');
    if (change(next => next.push({ name: term(input.value), enabled: true, variations: [] }))) input.value = '';
  };
  $('profanity-reset').onclick = () => { $('profanity-reset-confirm').showModal(); };
  $('profanity-reset-yes').onclick = () => {
    change(next => next.splice(0, next.length, ...defaultProfanityGroups()));
    $('profanity-reset-confirm').close();
  };
  for (const filter of [groupFilter, variationFilter, chapterFilter]) filter.onchange = () => { visibleCount = 100; refresh(); };
  $('profanity-more').onclick = () => { visibleCount += 100; refresh(); };
  dialog.addEventListener('keydown', event => { if (event.key === 'Escape') dialog.close(); });
  return () => {
    if (!dialog.open) return;
    clearTimeout(timer);
    timer = setTimeout(refresh, 200);
  };
}
