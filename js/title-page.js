import { createElement, validateDocument } from './document.js';

export const TITLE_CONTACT = Object.freeze({ width: 320, right: 96, left: 96, bottom: 100, lineHeight: 20 });
const contactAdvance = 16 * 1228 / 2048; // Untracked 16px Courier Prime 1.203.
/** One shared bottom-left block; each line is left-aligned at its origin. */
export function titleContactLayout(pageWidth = 816, pageHeight = 1056, scale = 1, text = '') {
  const raw = text.split('\n');
  const maxWidth = pageWidth - TITLE_CONTACT.left - TITLE_CONTACT.right;
  const width = Math.min(maxWidth, Math.max(TITLE_CONTACT.width, ...raw.map(line => [...line].length * contactAdvance + 1)));
  // Shared wrapping, including unusually long unbroken email/address tokens.
  const maxChars = Math.max(1, Math.floor(width / contactAdvance));
  const lines = raw.flatMap(line => {
    const result = [], chars = [...line];
    while (chars.length > maxChars) {
      let end = chars.slice(0, maxChars + 1).lastIndexOf(' ');
      if (end < 1) end = maxChars;
      result.push(chars.splice(0, end).join(''));
      if (chars[0] === ' ') chars.shift();
    }
    result.push(chars.join('')); return result;
  });
  return { x: TITLE_CONTACT.left * scale,
    bottom: (pageHeight - TITLE_CONTACT.bottom) * scale,
    width: width * scale, lineHeight: TITLE_CONTACT.lineHeight * scale, lines };
}

const keys = { title: 'Title', credit: 'Credit', author: 'Author', contact: 'Contact' };
const fieldText = (doc, key) => doc.elements.filter(el => el.type === 'titleField' && el.key.toLowerCase() === key).map(el => el.text).join('\n');
const emailLine = text => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text.trim());
const phoneLine = text => (text.match(/\d/g) ?? []).length >= 7 && /^[+\d\s().-]+(?:\s*(?:x|ext\.?)[\s\d]+)?$/i.test(text.trim());

/** Contact stays standard multiline Fountain metadata, including unfamiliar address lines. */
export function titlePageFields(doc) {
  const contactText = fieldText(doc, 'contact');
  const lines = contactText.split('\n');
  let email = '', phone = '';
  if (emailLine(lines.at(-1) ?? '')) email = lines.pop();
  if (phoneLine(lines.at(-1) ?? '')) phone = lines.pop();
  const contact = doc.contactLayout?.text === contactText && ['address', 'phone', 'email'].every(key => typeof doc.contactLayout[key] === 'string') ? doc.contactLayout : { address: lines.join('\n'), phone, email };
  return { title: doc.title, credit: doc.elements.some(el => el.type === 'titleField' && /^credit$/i.test(el.key)) ? fieldText(doc, 'credit') : 'Written by', author: fieldText(doc, 'author'), address: contact.address, phone: contact.phone, email: contact.email };
}
function upsert(doc, key, text) {
  const matches = doc.elements.filter(el => el.type === 'titleField' && el.key.toLowerCase() === key.toLowerCase());
  if (matches.length) {
    matches[0].text = text;
    doc.elements = doc.elements.filter(el => !matches.slice(1).includes(el));
  } else {
    let index = 0;
    while (doc.elements[index]?.type === 'titleField') index++;
    doc.elements.splice(index, 0, createElement('titleField', text, { key }));
  }
}
export function changeTitlePage(document, field, value) {
  if (!['title', 'credit', 'author', 'address', 'phone', 'email'].includes(field) || typeof value !== 'string') throw new TypeError('Invalid title-page field.');
  const doc = structuredClone(document), fields = titlePageFields(doc);
  value = value.replace(/\r\n|\r/g, '\n');
  if (field !== 'address') value = value.replace(/\n/g, ' ');
  fields[field] = value;
  if (field === 'title') doc.title = value;
  // The canonical title is always used when title metadata is explicitly edited.
  upsert(doc, 'Title', doc.title);
  if (['address', 'phone', 'email'].includes(field)) {
    const text = [fields.address, fields.phone, fields.email].filter(Boolean).join('\n');
    upsert(doc, 'Contact', text);
    // The standard Contact field owns all text. This layout hint only keeps
    // partially typed phone/email text in its control until it can be inferred.
    doc.contactLayout = { text, address: fields.address, phone: fields.phone, email: fields.email };
  }
  else if (field !== 'title') upsert(doc, keys[field], value);
  return validateDocument(doc);
}
export function withWriterProfile(document, profile = {}) {
  let doc = changeTitlePage(document, 'title', document.title);
  doc = changeTitlePage(doc, 'credit', 'Written by');
  for (const field of ['author', 'address', 'phone', 'email']) if (typeof profile?.[field] === 'string' && profile[field]) doc = changeTitlePage(doc, field, profile[field]);
  return doc;
}

/** Editor controls and print text are separate so placeholders never reach output. */
export function setupTitlePage(root, onEdit, onUndo) {
  const fields = ['title', 'credit', 'author', 'address', 'phone', 'email'];
  const labels = { title: 'Title page title', credit: 'Writing credit', author: 'Author name', address: 'Mailing address', phone: 'Phone number', email: 'Email address' };
  const placeholders = { title: '[SCREENPLAY TITLE]', credit: 'Written by', author: '[AUTHOR NAME]', address: '[MAILING ADDRESS]', phone: '[PHONE NUMBER]', email: '[EMAIL ADDRESS]' };
  const center = document.createElement('div'); center.className = 'title-page-center';
  const contact = document.createElement('div'); contact.className = 'title-page-contact';
  const controls = new Map();
  for (const field of fields) {
    const wrapper = document.createElement('div'); wrapper.className = `title-field title-${field}`;
    const input = document.createElement('textarea'); input.rows = 1; input.dataset.titleField = field;
    input.setAttribute('aria-label', labels[field]); input.placeholder = placeholders[field]; input.spellcheck = field !== 'email';
    const printed = document.createElement('div'); printed.className = 'title-print';
    input.addEventListener('input', () => { resize(input); onEdit(field, input.value); });
    input.addEventListener('keydown', event => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); onUndo(event.shiftKey); }
      if (event.key === 'Enter' && field !== 'address') { event.preventDefault(); controls.get(fields[fields.indexOf(field) + 1])?.input.focus(); }
    });
    wrapper.append(input, printed); (['title', 'credit', 'author'].includes(field) ? center : contact).append(wrapper);
    controls.set(field, { input, printed });
  }
  for (const [key, value] of Object.entries(TITLE_CONTACT)) root.style.setProperty(`--title-contact-${key}`, `${value}px`);
  root.style.setProperty('--title-contact-left', `${titleContactLayout().x}px`);
  root.append(center, contact);
  function resize(input) { input.style.height = 'auto'; input.style.height = `${Math.max(20, input.scrollHeight)}px`; }
  let renderedValues = '';
  return { update(doc) {
    const values = titlePageFields(doc);
    const signature = JSON.stringify(values);
    if (signature === renderedValues) return;
    renderedValues = signature;
    const layout = titleContactLayout(816, 1056, 1, [values.address, values.phone, values.email].filter(Boolean).join('\n'));
    root.style.setProperty('--title-contact-left', `${layout.x}px`);
    root.style.setProperty('--title-contact-width', `${layout.width}px`);
    for (const [field, { input, printed }] of controls) {
      if (input.value !== values[field]) input.value = values[field];
      resize(input);
      if (printed.textContent !== values[field]) printed.textContent = values[field];
    }
  } };
}
