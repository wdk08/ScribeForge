import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { newManuscript } from '../../../js/scribeforge/model.js';

const manuscriptEditor = page => page.getByRole('textbox', { name: 'Manuscript editor' });
const sheets = page => page.locator('.manuscript-page');
const settings = page => page.getByRole('dialog', { name: 'Manuscript settings' });

async function open(page, text, options = {}) {
  const manuscript = newManuscript('Revision proof', undefined, text);
  Object.assign(manuscript.settings, options);
  await page.goto('/');
  await page.locator('#import-picker').setInputFiles({ name: 'Revision.stf', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(manuscript)) });
  await expect(manuscriptEditor(page)).toBeEditable();
}

test('Tab indents selected paragraphs and undo, redo and outside focus still work', async ({ page }) => {
  await open(page, 'First paragraph.\nSecond paragraph.', { indentStep: 24 });
  const editor = manuscriptEditor(page);
  await editor.press('ControlOrMeta+a');
  await editor.press('Tab');
  for (const paragraph of await editor.locator('p').all()) await expect(paragraph).toHaveCSS('margin-left', '32px');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(editor.locator('p').last()).toHaveCSS('margin-left', '0px');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(editor.locator('p').last()).toHaveCSS('margin-left', '32px');
  await editor.press('Shift+Tab');
  await expect(editor.locator('p').last()).toHaveCSS('margin-left', '0px');
  const title = page.getByRole('textbox', { name: 'Manuscript title' });
  await title.focus();
  await title.press('Tab');
  await expect(title).not.toBeFocused();
});

test('long paragraphs flow between real pages and edits and settings repaginate', async ({ page, browserName }) => {
  const long = 'A long paragraph keeps flowing, one line at a time. '.repeat(130);
  await open(page, long, { pageSize: 'a5', top: 36, bottom: 36, left: 36, right: 36 });
  const editor = manuscriptEditor(page);
  await expect.poll(() => sheets(page).count()).toBeGreaterThan(2);
  const fit = await editor.evaluate(element => {
    const paper = element.parentElement;
    const pages = [...paper.querySelectorAll('.manuscript-page')].map(node => node.getBoundingClientRect());
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    while (walker.nextNode()) {
      range.selectNodeContents(walker.currentNode);
      for (const rect of range.getClientRects()) {
        if (rect.height && rect.width && !pages.some(page => rect.top >= page.top - 1 && rect.bottom <= page.bottom + 1)) return false;
      }
    }
    return true;
  });
  expect(fit).toBe(true);
  const before = await sheets(page).count();
  await page.once('dialog', dialog => dialog.accept());
  await editor.fill('Short manuscript.');
  await expect(sheets(page)).toHaveCount(1);
  expect(before).toBeGreaterThan(1);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await settings(page).getByLabel('Orientation').selectOption('landscape');
  await settings(page).getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'Page Break', exact: true }).click();
  await expect(sheets(page)).toHaveCount(2);
  if (browserName === 'chromium') {
    const pdf = (await page.pdf({ preferCSSPageSize: true })).toString('latin1');
    expect(pdf).toMatch(/\/Count 2\b/);
    const [, width, height] = pdf.match(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/) ?? [];
    expect(Number(width)).toBeCloseTo(595.28, 0);
    expect(Number(height)).toBeCloseTo(419.53, 0);
  }
});

test('chapter style applies while typing, manual suppression persists, and Add Style captures marks', async ({ page }) => {
  await open(page, 'Body text');
  const editor = manuscriptEditor(page);
  await editor.fill('Chapter 12: The Beginning');
  const nav = page.getByRole('navigation', { name: 'Chapters' });
  await expect(nav.getByRole('button', { name: /Chapter 12/ })).toBeVisible();
  const styles = page.getByRole('combobox', { name: 'Paragraph style', exact: true });
  await styles.selectOption('chapter-off');
  await expect(nav.getByRole('button', { name: /Chapter 12/ })).toHaveCount(0);
  await expect(page.locator('#save-state')).toHaveText('Saved locally');
  await page.reload();
  await expect(nav.getByRole('button', { name: /Chapter 12/ })).toHaveCount(0);
  await editor.locator('p').first().click();
  await styles.selectOption('chapter-auto');
  await expect(nav.getByRole('button', { name: /Chapter 12/ })).toBeVisible();
  await editor.press('ControlOrMeta+a');
  await page.getByRole('button', { name: 'Strikethrough', exact: true }).click();
  await styles.selectOption('create-style');
  const styleDialog = page.getByRole('dialog', { name: 'Custom Paragraph Styles' });
  await expect(styleDialog.getByLabel('Strikethrough', { exact: true })).toHaveValue('true');
  await expect(styleDialog.getByLabel('Style role')).toHaveValue('chapter');
  await styleDialog.getByLabel('Style name').fill('My chapter look');
  await styleDialog.getByRole('button', { name: 'Save Style', exact: true }).click();
  await styleDialog.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await settings(page).getByLabel('Automatic chapter heading style').selectOption({ label: 'My chapter look' });
  await settings(page).getByRole('button', { name: 'Done' }).click();
  await expect(editor.getByRole('heading', { name: /Chapter 12/ })).toBeVisible();
  await expect(styles.locator('option:checked')).toHaveText('My chapter look');
});

test('cover editing shares manuscript storage and exports PNG and PDF separately', async ({ page }) => {
  await open(page, 'Chapter One\nA manuscript.\fNext page.');
  const editor = manuscriptEditor(page);
  await expect(sheets(page)).toHaveCount(2);
  await editor.locator('p').last().click();
  await page.getByRole('button', { name: 'Cover', exact: true }).click();
  const cover = page.getByRole('dialog', { name: 'Cover', exact: true });
  await cover.getByRole('combobox', { name: 'Cover layout', exact: true }).selectOption('two');
  await expect(cover.locator('#cover-dimensions')).toContainText('Back · Front');
  await cover.getByRole('combobox', { name: 'Cover layout', exact: true }).selectOption('wrap');
  await expect(cover.locator('#cover-dimensions')).toContainText('0.3 pt spine · 2 manuscript pages');
  await cover.getByLabel('Manual spine width (pt)').fill('18');
  await cover.getByLabel('Manual spine width (pt)').blur();
  await expect(cover.locator('#cover-dimensions')).toContainText('18.0 pt spine');
  await cover.getByRole('button', { name: 'Add text box' }).click();
  await cover.getByLabel('Text', { exact: true }).fill('The new cover');
  await cover.getByLabel('Text', { exact: true }).blur();
  await cover.getByRole('button', { name: 'Undo cover edit' }).click();
  await expect(cover.getByLabel('Text', { exact: true })).toHaveValue('Your title');
  await cover.getByRole('button', { name: 'Redo cover edit' }).click();
  await expect(cover.getByLabel('Text', { exact: true })).toHaveValue('The new cover');
  const canvas = cover.locator('canvas');
  const bounds = await canvas.boundingBox();
  await page.mouse.move(bounds.x + bounds.width * .6, bounds.y + bounds.height * .27);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * .64, bounds.y + bounds.height * .31);
  await page.mouse.up();
  expect(Number(await cover.getByLabel('Left (%)').inputValue())).toBeGreaterThan(54);
  const png = await page.evaluate(() => {
    const tiny = document.createElement('canvas');
    tiny.width = tiny.height = 8;
    tiny.getContext('2d').fillRect(0, 0, 8, 8);
    return tiny.toDataURL().split(',')[1];
  });
  await page.locator('#cover-background-file').setInputFiles({ name: 'Artwork.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await expect(cover.getByRole('button', { name: 'Remove background image' })).toBeEnabled();
  for (const format of ['PNG', 'PDF']) {
    const download = page.waitForEvent('download');
    await cover.getByRole('button', { name: `Export ${format}` }).click();
    const bytes = await readFile(await (await download).path());
    if (format === 'PNG') expect(bytes.subarray(1, 4).toString()).toBe('PNG');
    else expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  }
  await cover.getByRole('button', { name: 'Back to Manuscript' }).click();
  await expect(editor).toBeFocused();
  await expect(sheets(page)).toHaveCount(2);
  await expect(page.locator('#save-state')).toHaveText('Saved locally');
  await page.locator('#export').click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'ScribeForge (.stf)', exact: true }).click();
  const portable = JSON.parse(await readFile(await (await download).path(), 'utf8'));
  expect(portable.cover.elements[0].text).toBe('The new cover');
  expect(portable.cover.backgroundImage).toMatch(/^data:image\/png;base64,/);
  await page.reload();
  await page.getByRole('button', { name: 'Cover', exact: true }).click();
  await cover.getByLabel('Cover element').selectOption({ label: '1. Text box' });
  await expect(cover.getByLabel('Text', { exact: true })).toHaveValue('The new cover');
});
