import { elementLayout } from './right-margins.js';
import { isDesktop, exportDesktop } from './desktop.js';
import { titlePageFields, titleContactLayout } from './title-page.js';
import { createMeasurer, layoutUnits, paginate, PAGE } from './pagination.js';
import { fountainFilename } from './files.js';
import { parseInline } from './inline.js';
import { transitionClass } from './transitions.js';
import { FORMAT, elementColumn, ensureScreenplayFonts, fontBaseline } from './screenplay-format.js';
let library;
async function pdfLibrary() {
  if (!library) library = new Promise((resolve, reject) => {
    if (window.jspdf) { resolve(window.jspdf.jsPDF); return; }
    const script = document.createElement('script'); script.src = new URL('../vendor/jspdf.umd.min.js', import.meta.url).href;
    script.onload = () => window.jspdf ? resolve(window.jspdf.jsPDF) : reject(new Error('PDF library could not be loaded.'));
    script.onerror = () => reject(new Error('PDF export could not load its local library.')); document.head.append(script);
  }).catch(error => { library = null; throw error; });
  return library;
}
const printable = new Set(['titleField', 'scene', 'action', 'character', 'parenthetical', 'dialogue', 'transition', 'centered', 'lyric', 'whitespace', 'pageBreak']);
export function printableDocument(document) {
  const doc = structuredClone(document);
  const plain = nodes => nodes.map(node => ['note', 'boneyard'].includes(node.type) ? '' : node.children ? plain(node.children) : node.text).join('');
  doc.elements = doc.elements.filter(el => printable.has(el.type)).map(el => ({ ...el, text: plain(parseInline(el.text)) }));
  return doc;
}
async function fontData(name) {
  const response = await fetch(new URL(`../assets/fonts/CourierPrime-${name}.ttf`, import.meta.url));
  if (!response.ok) throw new Error('PDF export could not load its local Courier font.');
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
export async function createScreenplayPDF(document) {
  const [PDF, regular, bold] = await Promise.all([pdfLibrary(), fontData('Regular'), fontData('Bold'), ensureScreenplayFonts()]);
  const doc = printableDocument(document);
  const measure = window.document.createElement('div'); measure.className = 'measurement pdf-measure'; measure.setAttribute('aria-hidden', 'true'); window.document.body.append(measure);
  let pages, baseline, boldBaseline;
  try {
    pages = paginate(layoutUnits(doc, createMeasurer(measure)));
    baseline = fontBaseline(measure); boldBaseline = fontBaseline(measure, FORMAT.fontSize, FORMAT.lineHeight, true);
  } finally { measure.remove(); }
  const pdf = new PDF({ unit: 'pt', format: 'letter', compress: true });
  pdf.addFileToVFS('CourierPrime-Regular.ttf', regular); pdf.addFont('CourierPrime-Regular.ttf', 'CourierPrime', 'normal');
  pdf.addFileToVFS('CourierPrime-Bold.ttf', bold); pdf.addFont('CourierPrime-Bold.ttf', 'CourierPrime', 'bold');
  // jsPDF otherwise truncates each TTF advance to an integer in 1/1000 em,
  // accumulating a measurable drift across a full line. Preserve the real widths.
  for (const style of ['normal', 'bold']) {
    pdf.setFont('CourierPrime', style);
    const metadata = pdf.getFont().metadata;
    const glyphs = [...new Set(Object.values(metadata.cmap.unicode.codeMap))];
    metadata.Unicode.widths = glyphs.flatMap(glyph => [glyph, [metadata.widthOfGlyph(glyph)]]);
  }
  pdf.setProperties({ title: doc.title, creator: 'ScriptForge' });
  const byId = new Map(doc.elements.map(el => [el.id, el]));
  const scale = .75;
  pdf.setFont('CourierPrime', 'normal'); pdf.setFontSize(12);
  const title = titlePageFields(doc);
  const titleLines = pdf.splitTextToSize(title.title.toUpperCase(), 444);
  pdf.text(titleLines, 306, 240, { align: 'center', baseline: 'top', lineHeightFactor: 1.25 });
  const creditY = 240 + titleLines.length * 15 + 36;
  const creditLines = pdf.splitTextToSize(title.credit, 444);
  pdf.text(creditLines, 306, creditY, { align: 'center', baseline: 'top', lineHeightFactor: 1.25 });
  pdf.text(pdf.splitTextToSize(title.author, 444), 306, creditY + creditLines.length * 15 + 15, { align: 'center', baseline: 'top', lineHeightFactor: 1.25 });
  const contact = [title.address, title.phone, title.email].filter(Boolean).join('\n');
  if (contact) {
    const layout = titleContactLayout(PAGE.width, PAGE.height, scale, contact);
    const lines = layout.lines;
    const top = layout.bottom - lines.length * layout.lineHeight;
    lines.forEach((line, index) => {
      pdf.text(line, layout.x, top + index * layout.lineHeight, { align: 'left', baseline: 'top' });
    });
  }
  pages.forEach((page, index) => {
    pdf.addPage('letter', 'portrait');
    pdf.setFont('CourierPrime', 'normal'); pdf.setFontSize(12);
    pdf.setCharSpace(0);
    if (index > 0) pdf.text(`${index + 1}.`, FORMAT.pageNumberX * scale, (FORMAT.pageNumberY + baseline) * scale, { baseline: 'alphabetic' });
    let y = FORMAT.top;
    for (const item of page.items) {
      y += item.gap;
      const marker = (text, col, rowY) => {
        pdf.setFont('CourierPrime', 'normal'); pdf.setFontSize(12); pdf.setCharSpace(FORMAT.letterSpacing * scale);
        pdf.text(text.toUpperCase().replace(/\n$/, ''), elementColumn('character', item.kind === 'dual', col).left * scale, (rowY + baseline) * scale, { baseline: 'alphabetic' });
      };
      item.headers.forEach((lines, col) => lines.forEach((line, row) => marker(line.text, col, y + row * PAGE.lineHeight)));
      y += item.headerHeight;
      item.columns.forEach((lines, col) => lines.forEach((line, row) => {
        const model = byId.get(line.id), dual = item.kind === 'dual';
        let text = (line.displayText ?? model.text.slice(line.start, line.end)).replace(/\n$/, '');
        if (['scene', 'character', 'transition'].includes(model.type)) text = text.toUpperCase();
        const bold = model.type === 'scene' && doc.settings?.boldSceneHeadings === true;
        pdf.setFont('CourierPrime', bold ? 'bold' : 'normal'); pdf.setFontSize(12);
        pdf.setCharSpace(FORMAT.letterSpacing * scale);
        // Refuse missing font glyphs rather than silently dropping screenplay text.
        const glyphs = pdf.getFont().metadata.cmap.unicode.codeMap;
        if ([...text].some(char => !glyphs[char.codePointAt(0)] && char !== '\n' && char !== '\t')) throw new Error('The PDF font does not support some characters in this screenplay. Fountain export preserves all characters.');
        const column = elementLayout(model, dual, col, doc.settings);
        let x = column.left, width = column.width;
        if (model.type === 'parenthetical' && line.start === 0 && text.startsWith('(')) x -= FORMAT.parentheticalHang;
        
        const textY = (y + row * PAGE.lineHeight + (bold ? boldBaseline : baseline)) * scale;
        let align = 'left';
        if (model.type === 'transition' && !transitionClass(model)) { align = 'right'; x += width; }
        if (model.type === 'centered' || model.type === 'titleField') { align = 'center'; x += width / 2; }
        if (model.type === 'scene' && doc.settings?.sceneNumbers === true && line.start === 0 && model.sceneNumber) {
          pdf.text(model.sceneNumber, FORMAT.sceneNumberLeft * scale, textY, { baseline: 'alphabetic' });
          pdf.text(model.sceneNumber, FORMAT.sceneNumberRight * scale, textY, { align: 'right', baseline: 'alphabetic' });
        }
        if (text) pdf.text(text, x * scale, textY, { align, baseline: 'alphabetic' });
      }));
      item.more.forEach((more, col) => { if (more) marker('(MORE)', col, y + item.bodyHeight); });
      y += item.bodyHeight + item.moreHeight;
    }
  });
  return { blob: pdf.output('blob'), pages: pages.length + 1, name: fountainFilename(doc.title).replace(/\.fountain$/, '.pdf') };
}
export async function exportPDF(document) {
  const result = await createScreenplayPDF(document);
  if (isDesktop()) { await exportDesktop(result.blob, result.name); return result; }
  const url = URL.createObjectURL(result.blob), link = window.document.createElement('a');
  link.href = url; link.download = result.name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  return result;
}
