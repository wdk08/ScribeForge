/** US Letter screenplay profile, in CSS px (96/in); PDF uses the same values at 72/in. */
export const FORMAT = Object.freeze({
  font: 'Courier Prime', fontSize: 16, letterSpacing: -.3, lineHeight: 16,
  width: 816, height: 1056, left: 144, right: 96, top: 96, bottom: 96,
  contentWidth: 576, contentHeight: 864,
  pageNumberX: 720, pageNumberY: 48, sceneNumberLeft: 72,
  get sceneNumberRight() { return this.width - this.sceneNumberLeft; },
  sceneNumberWidth: 48,
  sceneBefore: 32, paragraphGap: 16,
  dualWidth: 264, dualStep: 312,
  parentheticalHang: 16 * 1228 / 2048, // One untracked advance in bundled Courier Prime.
});
const single = Object.freeze({
  scene: [0, 576], action: [0, 576], character: [192, 360],
  dialogue: [96, 330.24], parenthetical: [144, 240], transition: [0, 528],
});
/** Dialogue attachments live inside one unit; separate paragraphs get one blank line. */
export function spacingBefore(previous, current) {
  if (!previous || previous.kind === 'break') return 0;
  if (current.type === 'scene') return FORMAT.sceneBefore;
  if (previous.type === 'scene' || previous.type === 'transition') return FORMAT.paragraphGap;
  if (previous.blank || current.blank) return 0;
  return FORMAT.paragraphGap;
}
export function elementColumn(type, dual = false, column = 0) {
  const [offset, width] = dual
    ? type === 'character' ? [48, 216] : type === 'parenthetical' ? [24, 216] : [0, FORMAT.dualWidth]
    : single[type] ?? [0, FORMAT.contentWidth];
  const left = FORMAT.left + (dual ? column * FORMAT.dualStep : 0) + offset;
  return { left, right: left + width, width, offset };
}
export function applyScreenplayFormat(doc = document) {
  const vars = { 'paper-width': FORMAT.width, 'paper-height': FORMAT.height, 'body-left': FORMAT.left,
    'body-right': FORMAT.right, 'body-top': FORMAT.top, 'body-bottom': FORMAT.bottom,
    'body-width': FORMAT.contentWidth, 'body-height': FORMAT.contentHeight,
    'screenplay-font-size': FORMAT.fontSize, 'screenplay-line-height': FORMAT.lineHeight,
    'screenplay-tracking': FORMAT.letterSpacing, 'page-number-x': FORMAT.pageNumberX, 'page-number-y': FORMAT.pageNumberY,
    'scene-number-left': FORMAT.sceneNumberLeft - FORMAT.left, 'scene-number-right': FORMAT.sceneNumberRight - FORMAT.left,
    'scene-number-width': FORMAT.sceneNumberWidth,
    'dual-width': FORMAT.dualWidth, 'dual-gap': FORMAT.dualStep - FORMAT.dualWidth,
    'parenthetical-hang': FORMAT.parentheticalHang };
  for (const type of Object.keys(single)) { const c = elementColumn(type); vars[`${type}-offset`] = c.offset; vars[`${type}-width`] = c.width; }
  for (const type of ['character', 'parenthetical']) { const c = elementColumn(type, true); vars[`dual-${type}-offset`] = c.offset; vars[`dual-${type}-width`] = c.width; }
  for (const [key, value] of Object.entries(vars)) doc.documentElement.style.setProperty(`--${key}`, `${value}px`);
}
let fontReady;
export function ensureScreenplayFonts(doc = document) {
  if (!fontReady) fontReady = Promise.all(['normal 400', 'normal 700', 'italic 400', 'italic 700'].map(style =>
    doc.fonts.load(`${style} ${FORMAT.fontSize}px "${FORMAT.font}"`).then(faces => {
      if (!faces.length) throw new Error('The bundled Courier Prime font could not load. Reload to retry.');
    }))).catch(error => { fontReady = null; throw new Error(`The bundled Courier Prime fonts could not load. Reload to retry. ${error.message}`, { cause: error }); });
  return fontReady;
}
/** WebKit can prepend a zero-width rectangle from the PREVIOUS line at a wrap. */
export function textRangeRect(range) {
  const rects = [...range.getClientRects()];
  return rects.findLast(rect => rect.width > 0) ?? rects.at(-1) ?? range.getBoundingClientRect();
}
/** Read the actual font baseline in a fixed line box, rather than guessing PDF ascent. */
export function fontBaseline(container, fontSize = FORMAT.fontSize, lineHeight = FORMAT.lineHeight, bold = false) {
  const box = document.createElement('div'), marker = document.createElement('span');
  box.style.cssText = `font:${bold ? 700 : 400} ${fontSize}px/${lineHeight}px "${FORMAT.font}";white-space:nowrap;`;
  marker.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline;';
  box.append(document.createTextNode('M'), marker); container.replaceChildren(box);
  return marker.getBoundingClientRect().top - box.getBoundingClientRect().top;
}
if (typeof document !== 'undefined') applyScreenplayFormat(document);
