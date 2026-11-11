import { validateDocument } from './document.js';

export function screenplaySettings(doc) {
  return { boldSceneHeadings: doc.settings?.boldSceneHeadings === true, sceneNumbers: doc.settings?.sceneNumbers === true };
}

/** Number scene metadata, never the heading text or stable element IDs. */
export function redoSceneNumbers(doc) {
  let number = 0;
  for (const element of doc.elements) {
    if (element.type === 'scene') element.sceneNumber = String(++number);
  }
  return validateDocument(doc);
}

export function changeScreenplaySettings(document, changes) {
  const doc = structuredClone(document);
  for (const key of ['boldSceneHeadings', 'sceneNumbers']) {
    if (key in changes && typeof changes[key] !== 'boolean') throw new TypeError('Screenplay settings must be checkboxes.');
  }
  doc.settings = { ...screenplaySettings(doc), ...changes };
  if (doc.settings.sceneNumbers) redoSceneNumbers(doc);
  return doc;
}
