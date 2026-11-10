import { defaultSettings, fontName, isChapterStyle, paragraphFields, resolvedStyle, styleFields, styleLabel, styles, validCustomStyle, validateSettings } from './model.js';
import { $, errorMessage, getPreference, setPreference } from './ui.js';

const styleOptions = Object.entries(styles).map(([key, { label }]) => [key, label]);
const alignOptions = ['left', 'center', 'right', 'justify'].map(value => [value, value[0].toUpperCase() + value.slice(1)]);
const pageOptions = [['letter', 'US Letter'], ['a4', 'A4'], ['custom', 'Custom']];
const writing = {
  author: { label: 'Author', type: 'text', maxLength: 200 },
  font: { label: 'Default font', list: 'fonts', maxLength: 80 },
  size: styleFields.size, leading: paragraphFields.leading,
  defaultStyle: { label: 'Default paragraph style', options: styleOptions },
};
const marginFields = Object.fromEntries(['top', 'right', 'bottom', 'left'].map(side => [side, { label: `${side[0].toUpperCase() + side.slice(1)} margin (pt)`, min: 0, max: 288 }]));
const page = {
  pageSize: { label: 'Page size', options: pageOptions },
  width: { label: 'Custom width (pt)', min: 216, max: 1440 }, height: { label: 'Custom height (pt)', min: 216, max: 1440 },
  ...marginFields,
  header: { label: 'Header text', maxLength: 200 }, footer: { label: 'Footer text', maxLength: 200 },
  pageNumbers: { label: 'Page numbers', options: [['false', 'Off'], ['true', 'On']], parse: value => value === 'true' },
};
const styleDefs = { ...styleFields,
  font: { ...styleFields.font, list: 'fonts', maxLength: 80 },
  bold: { ...styleFields.bold, options: [['true', 'Bold'], ['false', 'Regular']], parse: value => value === 'true' },
  italic: { ...styleFields.italic, options: [['true', 'Italic'], ['false', 'Regular']], parse: value => value === 'true' },
  underline: { ...styleFields.underline, options: [['true', 'Underlined'], ['false', 'Regular']], parse: value => value === 'true' },
};

function options(control, entries) {
  control.replaceChildren(...entries.map(([value, name]) => new Option(name, value)));
}

function fields(container, defs, optional) {
  const inputs = {};
  for (const [key, field] of Object.entries(defs)) {
    const label = document.createElement('label');
    label.textContent = field.label;
    const items = field.options ?? (key === 'align' ? alignOptions : null);
    const input = document.createElement(items ? 'select' : 'input');
    if (items) options(input, optional ? [['', 'Use style default'], ...items] : items);
    else if (field.min !== undefined) Object.assign(input, { type: 'number', min: field.min, max: field.max, step: 'any' });
    else {
      if (field.maxLength) input.maxLength = field.maxLength;
      if (field.list) input.setAttribute('list', field.list);
    }
    input.name = key;
    input.setAttribute('aria-label', field.label);
    input.required = !optional && (field.min !== undefined || key === 'font');
    label.append(input);
    container.append(label);
    inputs[key] = input;
  }
  return {
    fill(values) { for (const [key, input] of Object.entries(inputs)) input.value = values[key] ?? ''; },
    read() { return Object.fromEntries(Object.entries(inputs).map(([key, input]) => {
      const raw = input.value;
      if (optional && raw === '') return [key, null];
      const value = defs[key].parse ? defs[key].parse(raw) : input.type === 'number' ? Number(raw) : raw;
      if (defs[key].check && !defs[key].check(value)) throw new Error(`Check ${defs[key].label.toLowerCase()}.`);
      return [key, value];
    })); },
  };
}

export function setupSettings({ get, apply, focusEditor, applyParagraph, currentParagraph }) {
  const writingFields = fields($('writing-fields'), writing, false);
  const pageFields = fields($('page-fields'), page, false);
  const { align: _align, ...paragraphDialogFields } = paragraphFields;
  const paragraph = fields($('paragraph-fields'), paragraphDialogFields, true);
  const margins = fields($('paragraph-margin-fields'), marginFields, false);
  const styleFields = fields($('style-fields'), styleDefs, true);
  options($('custom-style'), styleOptions);
  let customStyles;
  let selected;
  const captureStyle = () => {
    customStyles[selected] = Object.fromEntries(Object.entries(styleFields.read()).filter(([, value]) => value !== null));
  };
  $('settings').addEventListener('click', () => {
    const manuscript = get();
    const defaultStyleOptions = [...styleOptions, ...Object.entries(manuscript.settings.customStyles ?? {}).map(([id, style]) => [id, style.name])];
    options($('writing-fields').querySelector('[name="defaultStyle"]'), defaultStyleOptions);
    writingFields.fill({ ...manuscript.settings, author: manuscript.metadata.author });
    pageFields.fill(manuscript.settings);
    customStyles = structuredClone(manuscript.settings.styles);
    $('custom-style').value = selected = 'normal';
    styleFields.fill(customStyles[selected] ?? {});
    $('setting-autosave').checked = getPreference('autosave', true);
    $('setting-activity').checked = getPreference('activity', true);
    $('setting-focus').checked = getPreference('focus', false);
    $('set-defaults').checked = false;
    $('settings-error').textContent = '';
    $('settings-dialog').showModal();
  });
  $('custom-style').addEventListener('change', event => {
    try {
      captureStyle();
      selected = event.target.value;
      styleFields.fill(customStyles[selected] ?? {});
      $('settings-error').textContent = '';
    } catch (error) {
      event.target.value = selected;
      $('settings-error').textContent = errorMessage(error);
    }
  });
  $('reset-style').addEventListener('click', () => styleFields.fill({}));
  $('settings-form').addEventListener('submit', event => {
    event.preventDefault();
    try {
      captureStyle();
      const { author, ...writer } = writingFields.read();
      const settings = validateSettings({ ...defaultSettings, ...get().settings, ...writer, ...pageFields.read(), styles: customStyles });
      if (!fontName(settings.font)) throw new Error('Enter a valid font name.');
      if ($('set-defaults').checked) setPreference('defaults', settings);
      for (const key of ['autosave', 'activity', 'focus']) setPreference(key, $(`setting-${key}`).checked);
      window.scribeForgeTheme.set(document.querySelector('[name=appearance]:checked')?.value ?? 'system');
      apply(settings, author);
      $('settings-dialog').close();
      focusEditor();
    } catch (error) { $('settings-error').textContent = errorMessage(error); }
  });
  $('paragraph-format').addEventListener('click', () => {
    paragraph.fill(currentParagraph());
    margins.fill(get().settings);
    $('paragraph-error').textContent = '';
    $('paragraph-dialog').showModal();
  });
  $('paragraph-form').addEventListener('submit', event => {
    event.preventDefault();
    try {
      const manuscript = get();
      const values = margins.read();
      const settings = validateSettings({ ...manuscript.settings, ...values });
      applyParagraph(paragraph.read());
      if (Object.keys(values).some(key => values[key] !== manuscript.settings[key])) apply(settings, manuscript.metadata.author);
      $('paragraph-dialog').close();
      focusEditor();
    } catch (error) { $('paragraph-error').textContent = errorMessage(error); }
  });
}


export function setupStyleLibrary({ settings, selectedStyle, selectionFormat, apply, focusEditor, report }) {
  const readLibrary = () => Object.fromEntries(Object.entries(getPreference('paragraph-styles', {}))
    .filter(([id, style]) => validCustomStyle(id, style)));
  const writeLibrary = value => setPreference('paragraph-styles', value);
  const dialog = $('style-library-dialog');
  const picker = $('saved-style');
  const toolbar = $('paragraph-style');
  const name = $('saved-style-name');
  const role = $('saved-style-role');
  const editorFields = fields($('saved-style-fields'), styleDefs, true);
  let editingId = '';
  let source;

  function refresh() {
    const library = readLibrary();
    const embedded = Object.entries(settings().customStyles ?? {}).filter(([id]) => !library[id]);
    options(toolbar, [...styleOptions, ...Object.entries(library).map(([id, style]) => [id, style.name]),
      ...embedded.map(([id, style]) => [id, `${style.name} (manuscript)`]),
      ['create-style', 'Create Style from Selection…'], ['manage-styles', 'Manage Styles…']]);
    toolbar.value = selectedStyle();
  }
  function loadStyle(id, definition = null) {
    editingId = id;
    source = definition ?? readLibrary()[id] ?? { name: '', role: 'paragraph', fields: {} };
    options(picker, [['', 'New style'], ...Object.entries(readLibrary()).map(([key, style]) => [key, style.name])]);
    picker.value = id;
    name.value = source.name;
    role.value = source.role;
    editorFields.fill(source.fields);
    $('delete-style').disabled = !id;
    $('duplicate-style').disabled = !id;
    $('style-library-error').textContent = '';
  }
  function open(create) {
    if (create) {
      const selected = selectedStyle();
      const effective = { ...resolvedStyle(selected, settings()) };
      for (const [key, value] of Object.entries(selectionFormat())) if (value != null) effective[key] = value;
      const fields = Object.fromEntries(Object.keys(styleFields).filter(key => effective[key] !== undefined).map(key => [key, effective[key]]));
      loadStyle('', { name: '', role: isChapterStyle(selected, settings()) ? 'chapter' : 'paragraph', fields });
    } else loadStyle(readLibrary()[selectedStyle()] ? selectedStyle() : Object.keys(readLibrary())[0] ?? '');
    $('clear-style-overrides').checked = false;
    dialog.showModal();
    name.focus();
  }

  toolbar.addEventListener('change', () => {
    const id = toolbar.value;
    toolbar.value = selectedStyle();
    if (id === 'create-style' || id === 'manage-styles') { open(id === 'create-style'); return; }
    try { apply(id, settings().customStyles?.[id] ?? readLibrary()[id]); }
    catch (error) { report(errorMessage(error)); }
  });
  picker.addEventListener('change', () => loadStyle(picker.value));
  $('duplicate-style').addEventListener('click', () => {
    const library = readLibrary();
    const names = new Set(Object.values(library).map(style => style.name.toLocaleLowerCase()));
    let suffix = ' copy';
    let number = 2;
    while (names.has((source.name.slice(0, 80 - suffix.length) + suffix).toLocaleLowerCase())) suffix = ` copy ${number++}`;
    loadStyle('', { ...source, name: source.name.slice(0, 80 - suffix.length) + suffix });
    name.select();
  });
  $('delete-style').addEventListener('click', () => {
    try {
      const library = readLibrary();
      delete library[editingId];
      writeLibrary(library);
      refresh();
      loadStyle(Object.keys(library)[0] ?? '');
      $('style-library-error').textContent = 'Style removed from the library. Manuscripts retain their copies.';
    } catch (error) { $('style-library-error').textContent = errorMessage(error); }
  });
  $('style-library-form').addEventListener('submit', event => {
    event.preventDefault();
    try {
      const library = readLibrary();
      const definition = { name: name.value.trim(), role: role.value,
        fields: Object.fromEntries(Object.entries(editorFields.read()).filter(([, value]) => value !== null)) };
      const unique = definition.name.toLocaleLowerCase();
      if (Object.values(styles).some(style => style.label.toLocaleLowerCase() === unique) ||
        Object.entries(library).some(([id, style]) => id !== editingId && style.name.toLocaleLowerCase() === unique)) {
        throw new Error('Choose a name that differs from the other saved styles.');
      }
      const unchanged = editingId && JSON.stringify(library[editingId]) === JSON.stringify(definition);
      const id = unchanged ? editingId : `custom-${crypto.randomUUID()}`;
      if (!validCustomStyle(id, definition)) throw new Error('Enter a valid style name and formatting.');
      // An edited style is a new revision. Earlier paragraphs keep their embedded definition.
      if (editingId) delete library[editingId];
      library[id] = definition;
      writeLibrary(library);
      refresh();
      if (event.submitter?.id === 'save-apply-style') {
        apply(id, definition, { clearOverrides: $('clear-style-overrides').checked });
        dialog.close();
        focusEditor();
      } else {
        loadStyle(id);
        $('style-library-error').textContent = 'Style saved.';
      }
    } catch (error) { $('style-library-error').textContent = errorMessage(error); }
  });
  refresh();
  return { refresh };
}
