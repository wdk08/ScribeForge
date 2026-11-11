import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { hospitalElements } from '../fixtures/hospital-paste-expected.js';
const hospital = await readFile(new URL('../fixtures/hospital-paste.txt', import.meta.url), 'utf8');
const bodyProjection = doc => doc.elements.filter(el => !['whitespace', 'titleField'].includes(el.type)).map(el => [el.type, el.text]);
test.beforeEach(async ({ context }) => { await context.addInitScript(() => { window.scriptForgeLocalHelperDisabled = true; window.showDirectoryPicker = undefined; }); });
async function select(page, id, offset) {
  await page.evaluate(async ({ id, offset }) => {
    const { restoreSelection } = await import('/js/selection.js');
    restoreSelection(document.getElementById('pages'), { anchor: { id, offset }, focus: { id, offset } }, { scroll: true });
  }, { id, offset });
}
async function paste(page, text) {
  await page.locator('#pages').evaluate((root, text) => {
    const clipboardData = new DataTransfer(); clipboardData.setData('text/plain', text);
    root.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
  }, text);
}
for (const markdown of [false, true]) test(`complete hospital scene paste formats every element, preserves surrounding text and undoes/redoes: Markdown ${markdown}`, async ({ page }) => {
  await page.goto('/editor.html'); await expect(page.locator('[data-type="action"]')).toHaveCount(1);
  await page.locator('[data-type="action"]').click(); await page.keyboard.type('Before After');
  const before = await page.evaluate(() => window.scriptForge.getDocument()), action = before.elements.find(el => el.type === 'action');
  await select(page, action.id, 7); const initial = await page.evaluate(() => window.scriptForge.getSelection());
  const text = markdown ? hospital.replace(/^(INT\..*|EXT\..*|NOAH|AVA|NURSE)$/gm, '**$1**') : hospital;
  await paste(page, text);
  const after = await page.evaluate(() => window.scriptForge.getDocument());
  expect(bodyProjection(after)).toEqual([['transition', 'FADE IN:'], ['action', 'Before '], ...hospitalElements, ['action', 'After']]);
  expect(after.elements.find(el => el.id === action.id).text).toBe('Before ');
  const selection = await page.evaluate(() => window.scriptForge.getSelection());
  expect(after.elements.find(el => el.id === selection.focus.id).text).toBe(hospitalElements.at(-1)[1]);
  expect(selection.focus.offset).toBe(hospitalElements.at(-1)[1].length);
  const roundTrip = await page.evaluate(async () => {
    const { fountainForSaving } = await import('/js/session.js'), { parseFountain } = await import('/js/fountain.js');
    return parseFountain(fountainForSaving(window.scriptForge.getDocument()));
  });
  expect(bodyProjection(roundTrip)).toEqual(bodyProjection(after));
  expect(await page.locator('[data-type="character"]').count()).toBe(5);
  await page.keyboard.press('ControlOrMeta+z'); expect(await page.evaluate(() => window.scriptForge.getDocument())).toEqual(before);
  expect(await page.evaluate(() => window.scriptForge.getSelection())).toEqual(initial);
  await page.keyboard.press('ControlOrMeta+Shift+z'); expect(await page.evaluate(() => window.scriptForge.getDocument())).toEqual(after);
});
test('a missing separator no longer swallows subsequent character exchanges and scenes', async ({ page }) => {
  await page.goto('/editor.html'); await expect(page.locator('[data-type="action"]')).toHaveCount(1);
  const action = await page.evaluate(() => window.scriptForge.getDocument().elements.find(el => el.type === 'action'));
  await select(page, action.id, 0); await paste(page, hospital.replace(/\n\n/g, '\n'));
  const doc = await page.evaluate(() => window.scriptForge.getDocument());
  expect(doc.elements.filter(el => el.type === 'character').map(el => el.text)).toEqual(['NOAH', 'AVA', 'NOAH', 'AVA', 'NURSE']);
  await expect(page.locator('#scene-count')).toHaveText('2');
  await expect(page.locator('[data-type="transition"]').last()).toHaveText('CUT TO:');
  await expect(page.locator('[data-type="action"]').last()).toHaveText('Noah walks toward his car.');
});
test('all six Command and Ctrl formatting shortcuts preserve text, ID and caret on later pages with undo/redo', async ({ page }) => {
  await page.goto('/editor.html'); await expect(page.locator('[data-type="action"]')).toHaveCount(1);
  const initialAction = await page.evaluate(() => window.scriptForge.getDocument().elements.find(el => el.type === 'action'));
  await select(page, initialAction.id, 0);
  await paste(page, 'A quiet room.\n\n'.repeat(90) + 'Noah enters.');
  expect(await page.locator('.screenplay-page').count()).toBeGreaterThan(1);
  const before = await page.evaluate(() => window.scriptForge.getDocument()), last = before.elements.at(-1);
  await select(page, last.id, 4); await page.keyboard.press('ControlOrMeta+2');
  expect(await page.evaluate(() => window.scriptForge.getSelection().focus)).toEqual({ id: last.id, offset: 4 });
  for (const modifier of ['Meta', 'Control']) for (const [index, type] of ['scene', 'action', 'character', 'parenthetical', 'dialogue', 'transition'].entries()) {
    await select(page, last.id, 4);
    await page.keyboard.press(`${modifier}+${index + 1}`);
    const after = await page.evaluate(() => window.scriptForge.getDocument()), el = after.elements.find(el => el.id === last.id);
    expect(el.type).toBe(type); expect(after.elements).toHaveLength(before.elements.length);
    expect(el.text).toBe(type === 'parenthetical' ? `(${last.text})` : ['character', 'transition'].includes(type) ? last.text.toUpperCase() : last.text);
    expect(await page.evaluate(() => window.scriptForge.getSelection().focus)).toEqual({ id: last.id, offset: type === 'parenthetical' ? 5 : 4 });
    if (type !== 'action') {
      await page.keyboard.press('ControlOrMeta+z'); expect(await page.evaluate(() => window.scriptForge.getDocument())).toEqual(before);
      await page.keyboard.press('ControlOrMeta+Shift+z'); expect(await page.evaluate(() => window.scriptForge.getDocument())).toEqual(after);
      await page.keyboard.press('ControlOrMeta+z');
    }
  }
});
test('shortcuts handle blank lines and retain Character to Parenthetical Tab behavior, without affecting other inputs', async ({ page }) => {
  await page.goto('/editor.html'); await expect(page.locator('[data-type="action"]')).toHaveCount(1);
  const before = await page.evaluate(() => window.scriptForge.getDocument()), action = before.elements.find(el => el.type === 'action');
  for (const [index, type] of ['scene', 'action', 'character', 'parenthetical', 'dialogue', 'transition'].entries()) {
    await select(page, action.id, 0); await page.keyboard.press(`ControlOrMeta+${index + 1}`);
    const doc = await page.evaluate(() => window.scriptForge.getDocument()), el = doc.elements.find(el => el.id === action.id);
    expect(el.type).toBe(type); expect(el.text).toBe(type === 'parenthetical' ? '()' : '');
    expect(doc.elements).toHaveLength(before.elements.length);
    if (type !== 'action') await page.keyboard.press('ControlOrMeta+z');
  }
  await select(page, action.id, 0); await page.keyboard.press('ControlOrMeta+3'); await page.keyboard.type('noah'); await page.keyboard.press('Tab');
  await expect(page.locator('[data-type="character"]')).toHaveText('NOAH');
  await expect(page.locator('[data-type="parenthetical"]')).toHaveText('()');
  const unchanged = await page.evaluate(() => window.scriptForge.getDocument());
  await page.locator('[data-title-field="title"]').click(); await page.keyboard.press('Control+6');
  expect(await page.evaluate(() => window.scriptForge.getDocument())).toEqual(unchanged);
  await page.locator('#document-title').click(); await page.keyboard.press('Control+3');
  expect(await page.evaluate(() => window.scriptForge.getDocument())).toEqual(unchanged);
  await page.locator('#screenplay-settings').click(); await expect(page.locator('#writer-author')).toBeEnabled();
  await page.locator('#writer-author').click(); await page.keyboard.press('Control+4');
  expect(await page.evaluate(() => window.scriptForge.getDocument())).toEqual(unchanged);
});
test('title contact block contains only left-aligned address, phone and email in editor, print and PDF; Author metadata is retained', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1200 });
  await page.goto('/editor.html'); await expect(page.locator('[data-type="action"]')).toHaveCount(1);
  for (const [field, value] of Object.entries({ author: 'Example Writer', address: '123 Example Street\nExample City, SC 29301', phone: '(864) 555-0123', email: 'writer@example.com' })) await page.locator(`[data-title-field="${field}"]`).fill(value);
  const before = await page.evaluate(() => window.scriptForge.getDocument());
  await expect(page.locator('.title-page-center [data-title-field="author"]')).toHaveValue('Example Writer');
  await expect(page.locator('.title-page-contact [data-title-field]')).toHaveCount(3);
  await expect(page.locator('.title-contact-author')).toHaveCount(0);
  await expect(page.locator('.title-page-contact')).not.toContainText('Example Writer');
  for (const field of ['address', 'phone', 'email']) await expect(page.locator(`[data-title-field="${field}"]`)).toHaveCSS('text-align', 'left');
  const source = await page.evaluate(async () => (await import('/js/session.js')).fountainForSaving(window.scriptForge.getDocument()));
  expect(source).toContain('Author:\n    Example Writer'); expect(source).toContain('Contact:\n    123 Example Street');
  await page.addScriptTag({ url: '/vendor/jspdf.umd.min.js' });
  const result = await page.evaluate(async () => {
    const RealPDF = window.jspdf.jsPDF, writes = [];
    window.jspdf.jsPDF = function(options) {
      const pdf = new RealPDF(options), original = pdf.text;
      pdf.text = function(text, x, y, options) { writes.push({ text, x, y, options, page: pdf.internal.getCurrentPageInfo().pageNumber }); return original.call(pdf, text, x, y, options); };
      return pdf;
    };
    const { createScreenplayPDF } = await import('/js/pdf-export.js');
    const output = await createScreenplayPDF(window.scriptForge.getDocument()); return { writes, pages: output.pages, body: window.scriptForge.getPages().length };
  });
  const cover = result.writes.filter(w => w.page === 1);
  expect(cover.flatMap(w => w.text).filter(text => text === 'Example Writer')).toHaveLength(1);
  const contact = cover.filter(w => ['123 Example Street', 'Example City, SC 29301', '(864) 555-0123', 'writer@example.com'].includes(w.text));
  expect(contact.map(w => w.text)).toEqual(['123 Example Street', 'Example City, SC 29301', '(864) 555-0123', 'writer@example.com']);
  expect(contact.every(w => w.options.align === 'left' && w.x === 72)).toBe(true); expect(result.pages).toBe(result.body + 1);
  expect(await page.evaluate(() => window.scriptForge.getDocument())).toEqual(before);
  await page.locator('#zoom').selectOption('0.75');
  await page.evaluate(() => { document.querySelector('.document-viewport').scrollTop = 0; });
  await page.screenshot({ path: 'test-results/editor-title-contact.png' });
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.title-author .title-print')).toHaveText('Example Writer');
  await expect(page.locator('.title-page-contact')).not.toContainText('Example Writer');
  for (const field of ['address', 'phone', 'email']) { await expect(page.locator(`.title-${field} .title-print`)).toHaveCSS('text-align', 'left'); await expect(page.locator(`[data-title-field="${field}"]`)).toBeHidden(); }
});
