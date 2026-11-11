import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const fixture = await readFile(new URL('../fixtures/synthetic-pdf-extract.txt', import.meta.url), 'utf8');
const expected = JSON.parse(await readFile(new URL('../fixtures/synthetic-pdf-extract.expected.json', import.meta.url), 'utf8'));
const body = doc => doc.elements.filter(el => !['titleField', 'whitespace'].includes(el.type)).map(el => [el.type, el.text]);
test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => { window.scriptForgeLocalHelperDisabled = true; window.showDirectoryPicker = undefined; });
  await context.route('**/js/pagination.js', async route => {
    const response = await route.fetch(), source = await response.text();
    const signature = 'export function paginate(units, { contentHeight = PAGE.contentHeight, lineHeight = PAGE.lineHeight } = {}) {';
    expect(source).toContain(signature);
    await route.fulfill({response,body:source.replace(signature,signature+'\n window.__paginationCalls=(window.__paginationCalls??0)+1;')});
  });
});
async function select(page, id, offset, end = offset) {
  await page.evaluate(async ({ id, offset, end }) => {
    const { restoreSelection } = await import('/js/selection.js');
    restoreSelection(document.getElementById('pages'), { anchor: { id, offset }, focus: { id, offset: end } }, { scroll: true });
  }, { id, offset, end });
}
async function paste(page, text) {
  return page.locator('#pages').evaluate(async (root, text) => {
    // A single layout transaction may update several retained pages. Count
    // pagination calls, rather than treating each page DOM mutation as a reflow.
    const before = window.__paginationCalls ?? 0;
    const start = performance.now(), clipboardData = new DataTransfer(); clipboardData.setData('text/plain', text);
    root.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
    await Promise.resolve(); return { elapsed: performance.now() - start, renders: window.__paginationCalls - before };
  }, text);
}
async function blank(page) {
  await page.goto('/editor.html'); await expect(page.locator('[data-type="action"]')).toHaveCount(1);
  const action = await page.evaluate(() => window.scriptForge.getDocument().elements.find(el => el.type === 'action'));
  await select(page, action.id, 0); return action;
}
test('substantial PDF-style clipboard text keeps every annotated element and wrap before/after insertion and undo/redo', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const action = await blank(page); await page.keyboard.type('Before After'); await select(page, action.id, 7);
  const before = await page.evaluate(() => window.scriptForge.getDocument()), initial = await page.evaluate(() => window.scriptForge.getSelection());
  const timing = await paste(page, fixture);
  const after = await page.evaluate(() => window.scriptForge.getDocument());
  expect(body(after)).toEqual([['transition', 'FADE IN:'], ['action', 'Before '], ...expected, ['action', 'After']]);
  expect(timing.renders).toBe(1); expect(new Set(after.elements.map(el => el.id)).size).toBe(after.elements.length);
  const multiline = after.elements.find(el => el.type === 'action' && el.text.includes('folded letter'));
  await expect(page.locator(`[data-element-id="${multiline.id}"]`).first()).toHaveCSS('white-space', 'pre-wrap');
  const geometry = await page.locator(`[data-element-id="${multiline.id}"]`).first().evaluate(el => {
    const text = el.firstChild, line = text.textContent.indexOf('\n');
    const range = document.createRange(); range.setStart(text, 0); range.setEnd(text, 1); const first = range.getBoundingClientRect();
    range.setStart(text, line + 1); range.setEnd(text, line + 2); const next = range.getBoundingClientRect();
    return { first: first.top, next: next.top };
  });
  expect(geometry.next).toBeGreaterThan(geometry.first + 10);
  const roundTrip = await page.evaluate(async () => {
    const { parseFountain } = await import('/js/fountain.js'), { fountainForSaving } = await import('/js/session.js');
    return parseFountain(fountainForSaving(window.scriptForge.getDocument()));
  });
  const withoutContinuation = rows => rows.map(([type, text]) => [type, type === 'character' ? text.replace(/ \(CONT'D\)/g, '') : text]);
  expect(withoutContinuation(body(roundTrip))).toEqual(withoutContinuation(body(after)));
  await page.keyboard.press('ControlOrMeta+z'); expect(await page.evaluate(() => window.scriptForge.getDocument())).toEqual(before);
  expect(await page.evaluate(() => window.scriptForge.getSelection())).toEqual(initial);
  await page.keyboard.press('ControlOrMeta+Shift+z'); expect(await page.evaluate(() => window.scriptForge.getDocument())).toEqual(after);
  expect(errors).toEqual([]);
});
test('flat PDF text with missing blank lines recognizes Action after speech, parentheticals, headings and transitions', async ({ page }) => {
  await blank(page);
  await paste(page, 'INT. MILLER HOUSE - NIGHT\nTess sits on the couch.\nTYLER\nAre you okay?\nTess looks toward him.\nTESS\n(quietly)\nI am fine.\nTyler stands.\nCUT TO:\nEXT. MILLER HOUSE - NIGHT\nA car pulls into the driveway.');
  const doc = await page.evaluate(() => window.scriptForge.getDocument());
  expect(body(doc).slice(1).map(([type]) => type)).toEqual(['scene', 'action', 'character', 'dialogue', 'action', 'character', 'parenthetical', 'dialogue', 'action', 'transition', 'scene', 'action']);
  expect(doc.elements.find(el => el.text === 'Tess looks toward him.').type).toBe('action');
  expect(doc.elements.find(el => el.text === 'Tyler stands.').type).toBe('action');
});
test('feature-length PDF-style paste reflows once, retains all 100 scenes and stays within page limits', async ({ page }) => {
  await blank(page); const timing = await paste(page, Array(20).fill(fixture).join('\n'));
  expect(timing.renders).toBe(1); expect(timing.elapsed).toBeLessThan(8000);
  const result = await page.evaluate(async () => {
    const doc = window.scriptForge.getDocument(); const { validateDocument } = await import('/js/document.js'); validateDocument(doc);
    return { scenes: doc.elements.filter(el => el.type === 'scene').length, meaningful: doc.elements.filter(el => !['whitespace', 'titleField'].includes(el.type)).length,
      pages: window.scriptForge.getPages(), text: doc.elements.at(-1).text, selection: window.scriptForge.getSelection() };
  });
  expect(result.scenes).toBe(100); expect(result.meaningful).toBe(1301); expect(result.pages.length).toBeGreaterThan(10);
  expect(result.pages.every(page => page.used <= 864 && page.items.length)).toBe(true);
  expect(result.text).toBe('FADE TO BLACK.'); expect(result.selection.focus.offset).toBe(14);
  await page.keyboard.press('ControlOrMeta+z'); await expect(page.locator('#scene-count')).toHaveText('0');
});
test('automatic continuation follows character identity, interruption editing, other speakers and scene boundaries with stable caret', async ({ page }) => {
  await blank(page); await paste(page, 'INT. HOUSE - NIGHT\n\nTYLER\nHello.\n\nTess looks away.\n\nTYLER\nI am trying to help.');
  const doc = await page.evaluate(() => window.scriptForge.getDocument()), cues = doc.elements.filter(el => el.type === 'character'), action = doc.elements.find(el => el.text === 'Tess looks away.');
  const cue = page.locator(`[data-element-id="${cues[1].id}"]`);
  await expect(cue).toHaveAttribute('data-continuation-text', " (CONT'D)"); await expect(cue).toHaveText('TYLER');
  const pseudo = await cue.evaluate(el => getComputedStyle(el, '::after').content); expect(pseudo).toContain("CONT'D");
  await select(page, cues[1].id, 5); await page.keyboard.type('X'); await expect(cue).not.toHaveAttribute('data-continuation-text');
  await page.keyboard.press('Backspace'); await expect(cue).toHaveAttribute('data-continuation-text', " (CONT'D)");
  expect(await page.evaluate(() => window.scriptForge.getSelection().focus)).toEqual({ id: cues[1].id, offset: 5 });
  await select(page, action.id, 0, action.text.length); await page.keyboard.press('Backspace');
  await expect(cue).not.toHaveAttribute('data-continuation-text');
  await page.keyboard.press('ControlOrMeta+z'); await expect(cue).toHaveAttribute('data-continuation-text', " (CONT'D)");
  await select(page, action.id, action.text.length); await paste(page, 'TESS\nI know.');
  await expect(cue).not.toHaveAttribute('data-continuation-text');
  await page.keyboard.press('ControlOrMeta+z'); await expect(cue).toHaveAttribute('data-continuation-text', " (CONT'D)");
  await select(page, action.id, action.text.length); await paste(page, 'EXT. ROAD - NIGHT\n\nA car waits.');
  await expect(cue).not.toHaveAttribute('data-continuation-text');
  await page.keyboard.press('ControlOrMeta+z'); await expect(cue).toHaveAttribute('data-continuation-text', " (CONT'D)");
  await select(page, cues[1].id, 0, 5); await page.keyboard.type("TYLER (V.O.) (CONT'D)");
  await expect(cue).not.toHaveAttribute('data-continuation-text'); await expect(cue).toHaveText("TYLER (V.O.) (CONT'D)");
  const result = await page.evaluate(async () => {
    const doc = window.scriptForge.getDocument(), { fountainForSaving } = await import('/js/session.js'), { buildTableRead } = await import('/js/table-read-model.js');
    return { source: fountainForSaving(doc), speakers: buildTableRead(doc).speakers.map(speaker => speaker.id) };
  });
  expect(result.source.match(/CONT'D/g)).toHaveLength(1); expect(result.speakers).toEqual(['narrator', 'character:TYLER']);
});
async function capturePDF(page, doc) {
  await page.addScriptTag({ url: '/vendor/jspdf.umd.min.js' });
  return page.evaluate(async doc => {
    const RealPDF = window.jspdf.jsPDF, writes = [];
    window.jspdf.jsPDF = function(options) {
      const pdf = new RealPDF(options), original = pdf.text;
      pdf.text = function(text, x, y, options) { writes.push({ text, x, y, options, page: pdf.internal.getCurrentPageInfo().pageNumber }); return original.call(pdf, text, x, y, options); }; return pdf;
    };
    const { createScreenplayPDF } = await import('/js/pdf-export.js');
    const output = await createScreenplayPDF(doc ?? window.scriptForge.getDocument());
    window.pdfRepairBlob = output.blob; return { writes, pages: output.pages };
  }, doc);
}
test('derived extensions are measured, printed and exported once while model, copy, Fountain and Table Read keep original names', async ({ page }) => {
  await blank(page); await paste(page, 'INT. HOUSE - NIGHT\n\nTYLER (V.O.)\nHello.\n\nTess looks away.\n\nTYLER (V.O.)\nAgain.');
  const before = await page.evaluate(() => window.scriptForge.getDocument());
  const last = before.elements.filter(el => el.type === 'character').at(-1);
  const lines = await page.evaluate(id => window.scriptForge.getPages().flatMap(page => page.items.flatMap(item => item.columns.flat())).filter(line => line.id === id), last.id);
  expect(lines.map(line => line.displayText).join('')).toBe("TYLER (V.O.) (CONT'D)");
  expect(lines.every(line => line.start <= last.text.length && line.end <= last.text.length)).toBe(true);
  await select(page, last.id, 0, last.text.length);
  const copy = await page.locator('#pages').evaluate(root => { const clipboardData = new DataTransfer(); root.dispatchEvent(new ClipboardEvent('copy', { clipboardData, bubbles: true, cancelable: true })); return clipboardData.getData('text/plain'); });
  expect(copy).toBe('TYLER (V.O.)');
  const pdf = await capturePDF(page);
  expect(pdf.writes.some(write => write.text === "TYLER (V.O.) (CONT'D)")).toBe(true);
  expect(pdf.writes.some(write => /CONT.D.*CONT.D/.test(String(write.text)))).toBe(false);
  expect(await page.evaluate(() => window.scriptForge.getDocument())).toEqual(before);
  await page.emulateMedia({ media: 'print' });
  expect(await page.locator(`[data-element-id="${last.id}"]`).evaluate(el => getComputedStyle(el, '::after').content)).toContain("CONT'D");
});
test('contact block is visibly in the lower-left with identical left edges for fields, printed glyphs and PDF output', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1200 }); await blank(page);
  for (const [field, value] of Object.entries({ title: 'The Signal Returns', author: 'Example Writer', address: '123 Example Street\nExample City, SC 29301', phone: '(864) 555-0123', email: 'writer@example.com' })) await page.locator(`[data-title-field="${field}"]`).fill(value);
  const before = await page.evaluate(() => window.scriptForge.getDocument());
  await page.locator('#zoom').selectOption('0.75');
  const rects = await page.evaluate(() => {
    const page = document.getElementById('title-page').getBoundingClientRect(), contact = document.querySelector('.title-page-contact').getBoundingClientRect();
    return { relativeLeft: (contact.left - page.left) / page.width, relativeTop: (contact.top - page.top) / page.height,
      width: contact.width / page.width, right: (page.right - contact.right) / page.width,
      fields: [...document.querySelectorAll('.title-page-contact textarea')].map(el => ({ left: el.getBoundingClientRect().left, width: el.getBoundingClientRect().width, align: getComputedStyle(el).textAlign })) };
  });
  expect(rects.relativeLeft).toBeCloseTo(96 / 816, 2); expect(rects.relativeTop).toBeGreaterThan(.75);
  expect(rects.right).toBeCloseTo(400 / 816, 2); expect(rects.width).toBeCloseTo(320 / 816, 2);
  expect(new Set(rects.fields.map(field => field.left)).size).toBe(1); expect(new Set(rects.fields.map(field => field.width)).size).toBe(1);
  expect(rects.fields.every(field => field.align === 'left')).toBe(true);
  await expect(page.locator('.title-page-contact')).not.toContainText('Example Writer');
  await expect(page.locator('.title-page-contact textarea')).toHaveCount(3);
  await page.evaluate(() => { document.querySelector('.document-viewport').scrollTop = 0; });
  await page.screenshot({ path: 'test-results/pdf-repair-title.png' });
  const pdf = await capturePDF(page), cover = pdf.writes.filter(write => write.page === 1);
  const contact = cover.filter(write => ['123 Example Street', 'Example City, SC 29301', '(864) 555-0123', 'writer@example.com'].includes(write.text));
  expect(contact.map(write => write.text)).toEqual(['123 Example Street', 'Example City, SC 29301', '(864) 555-0123', 'writer@example.com']);
  expect(contact.every(write => write.x === 72 && write.options.align === 'left')).toBe(true);
  expect(cover.flatMap(write => write.text).filter(text => text === 'Example Writer')).toHaveLength(1);
  expect(await page.evaluate(() => window.scriptForge.getDocument())).toEqual(before);
  const download = page.waitForEvent('download');
  await page.evaluate(() => { const link = document.createElement('a'); link.href = URL.createObjectURL(window.pdfRepairBlob); link.download = 'Title Page.pdf'; link.click(); });
  await (await download).saveAs('test-results/pdf-repair-title.pdf');
  await page.emulateMedia({ media: 'print' });
  const printedLefts = await page.locator('.title-page-contact .title-print').evaluateAll(fields => fields.map(el => { const range = document.createRange(); range.setStart(el.firstChild, 0); range.setEnd(el.firstChild, 1); return range.getBoundingClientRect().left; }));
  expect(Math.max(...printedLefts) - Math.min(...printedLefts)).toBeLessThan(.1);
});
test('a generated extension wrapping onto another line is measured without creating editable suffix text or moving the caret', async ({ page }) => {
  const name = 'DETECTIVE ALEXANDER JONATHAN MARSHALL';
  await blank(page); await paste(page, `INT. HOUSE - NIGHT\n\n${name}\nHello.\n\nTess looks away.\n\n${name}\nAgain.`);
  const cue = await page.evaluate(() => window.scriptForge.getDocument().elements.filter(el => el.type === 'character').at(-1));
  const fragment = page.locator(`[data-element-id="${cue.id}"]`);
  await expect(fragment).toHaveAttribute('data-continuation-text', " (CONT'D)");
  const lines = await page.evaluate(id => window.scriptForge.getPages().flatMap(page => page.items.flatMap(item => item.columns.flat())).filter(line => line.id === id), cue.id);
  expect(lines.length).toBeGreaterThan(1); expect(lines.map(line => line.displayText).join('')).toBe(`${name} (CONT'D)`);
  await select(page, cue.id, name.length); await page.keyboard.type('X');
  await expect(fragment).toHaveText(`${name}X`); await expect(fragment).not.toHaveAttribute('data-continuation-text');
  expect(await page.evaluate(() => window.scriptForge.getSelection().focus.offset)).toBe(name.length + 1);
  await page.keyboard.press('Backspace'); await expect(fragment).toHaveAttribute('data-continuation-text', " (CONT'D)");
  expect(await page.evaluate(() => window.scriptForge.getSelection().focus.offset)).toBe(name.length);
});
