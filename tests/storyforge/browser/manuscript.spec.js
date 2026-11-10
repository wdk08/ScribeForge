import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { strFromU8, unzipSync } from 'fflate';
import { newManuscript } from '../../../js/storyforge/model.js';

const editor = page => page.getByRole('textbox', { name: 'Manuscript editor' });
const importFile = (page, name, buffer, mimeType = 'application/octet-stream') =>
  page.locator('#import-picker').setInputFiles({ name, buffer, mimeType });
async function openText(page, text) {
  await page.goto('/');
  await importFile(page, 'Test Manuscript.txt', Buffer.from(text), 'text/plain');
  await expect(editor(page)).toBeVisible();
}
async function exported(page, format) {
  await page.locator('#export').click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator(`.export-options [data-export=${format}]`).click(),
  ]);
  return readFile(await download.path());
}

test('StoryForge library, logo, rich-text autosave, chapter navigation and editing history', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await openText(page, 'Chapter One\nOne two three\nChapter Two: The End\nLast words');
  await expect(page.getByRole('navigation', { name: 'Chapters' }).getByRole('button')).toHaveCount(2);
  await expect(page.locator('header .brand-logo')).toHaveAttribute('src', './StoryForge.png');
  const first = page.getByRole('button', { name: /Chapter One/ });
  const second = page.getByRole('button', { name: /Chapter Two/ });
  await expect(first).toContainText('3 words');
  await second.click();
  await expect(second).toHaveAttribute('aria-current', 'location');
  await expect.poll(() => page.evaluate(() => window.getSelection().anchorNode.parentElement.textContent)).toBe('Chapter Two: The End');

  await editor(page).locator('p').nth(1).click();
  await editor(page).press('Home');
  await page.evaluate(() => {
    const text = document.querySelectorAll('.ProseMirror p')[1].firstChild;
    window.getSelection().setBaseAndExtent(text, 0, text, 3);
  });
  await expect(page.getByRole('button', { name: 'Bold', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Bold', exact: true }).click();
  await expect(editor(page).locator('strong')).toHaveText('One');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(editor(page).locator('strong')).toHaveCount(0);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(editor(page).locator('strong')).toHaveText('One');

  await page.getByRole('button', { name: 'Justify', exact: true }).click();
  await page.getByRole('button', { name: 'Paragraph…' }).click();
  await page.locator('#paragraph-dialog').getByLabel('First-line indent (pt)', { exact: true }).fill('-12');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(editor(page).locator('p').nth(1)).toHaveCSS('text-align', 'justify');
  await page.getByRole('textbox', { name: 'Manuscript title' }).fill('My Draft 🪶');
  await expect(page.locator('#save-state')).toHaveText('Saved locally');
  await page.reload();
  await expect(editor(page).locator('strong')).toHaveText('One');
  await expect(page.getByRole('textbox', { name: 'Manuscript title' })).toHaveValue('My Draft 🪶');
  await expect(editor(page).locator('p').nth(1)).toHaveCSS('text-indent', '-16px');
  await page.getByRole('link', { name: 'Home' }).click();
  await expect(page.getByRole('button', { name: 'My Draft 🪶', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('DOCX import and exports round-trip styling, Unicode, page breaks and book structure', async ({ page }) => {
  const manuscript = newManuscript('Prose 🐉', undefined, 'Opening\nSnowfall 雪 🐉\nChapter Two\nThe end.');
  manuscript.content.content[0].attrs.style = 'chapter';
  manuscript.content.content[1] = { type: 'paragraph', attrs: { align: 'center' }, content: [
    { type: 'text', text: 'Snow', marks: [{ type: 'bold' }, { type: 'font', attrs: { value: 'Georgia' } }] },
    { type: 'text', text: 'fall 雪 🐉', marks: [{ type: 'italic' }, { type: 'highlight', attrs: { value: '#fff0a3' } }] },
  ] };
  manuscript.content.content.splice(2, 0, { type: 'page_break' });
  await page.goto('/');
  await importFile(page, 'Original.stf', Buffer.from(JSON.stringify(manuscript)));
  await expect(editor(page)).toContainText('Snowfall 雪 🐉');
  const stf = JSON.parse(await exported(page, 'stf'));
  expect(stf.documentId).toBe(manuscript.documentId);
  const docx = await exported(page, 'docx');
  const epub = unzipSync(await exported(page, 'epub'));
  expect(strFromU8(epub['EPUB/nav.xhtml'])).toContain('Chapter Two');
  await page.getByRole('link', { name: 'Home' }).click();
  await importFile(page, 'Word Copy.docx', docx);
  await expect(editor(page).locator('h1')).toHaveText('Opening');
  await expect(editor(page).locator('strong')).toHaveText('Snow');
  await expect(editor(page).locator('em')).toHaveText('fall 雪 🐉');
  await expect(editor(page).locator('hr[data-page-break]')).toHaveCount(1);
  await expect(editor(page).locator('p').first()).toHaveCSS('text-align', 'center');

  await page.locator('.tools-menu summary').click();
  await page.getByRole('button', { name: 'Find & Replace' }).click();
  await page.getByLabel('Find', { exact: true }).fill('Snowfall');
  await expect(page.locator('#find-count')).toHaveText('1 of 1');
  await page.getByRole('button', { name: 'Replace', exact: true }).click();
  await page.getByLabel('Replace with', { exact: true }).fill('Raincloud');
  await page.getByRole('button', { name: 'Replace All' }).click();
  await expect(editor(page).locator('strong')).toHaveText('Rain');
  await expect(editor(page).locator('em')).toHaveText('cloud 雪 🐉');
  await page.getByRole('button', { name: 'Close search' }).click();

  await page.locator('.tools-menu summary').click();
  await page.getByRole('button', { name: 'Profanity Analyzer' }).click();
  await page.getByText('Edit dictionary', { exact: true }).click();
  await page.getByLabel('New group name').fill('Weather');
  await page.getByRole('button', { name: 'Add group', exact: true }).click();
  const weather = page.locator('#profanity-dictionary fieldset').filter({ has: page.locator('legend', { hasText: /^Weather$/ }) });
  await weather.getByLabel('New variation for Weather').fill('raincloud');
  await weather.getByRole('button', { name: 'Add variation', exact: true }).click();
  await page.getByRole('button', { name: 'Raincloud · Opening' }).click();
  await expect.poll(() => page.evaluate(() => window.getSelection().toString())).toBe('Raincloud');
});

test('PDF printing uses custom paper, preserves Unicode, and honors manual breaks', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'PDF capture requires Chromium.');
  const manuscript = newManuscript('Print sample', undefined, 'Chapter 1\nSnow & rain 雪 🐉\fChapter 2\nNext page.');
  manuscript.settings = { ...manuscript.settings, pageSize: 'custom', width: 450, height: 620, header: 'StoryForge Proof', footer: 'Draft', pageNumbers: true };
  await page.goto('/');
  await importFile(page, 'Print.stf', Buffer.from(JSON.stringify(manuscript)));
  await expect(editor(page)).toContainText('Snow & rain');
  await page.evaluate(() => { window.print = () => { window.printRequested = true; }; });
  await page.locator('#export').click();
  await page.getByRole('button', { name: 'PDF (.pdf)', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.printRequested)).toBe(true);
  const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
  const source = pdf.toString('latin1');
  expect(source).toMatch(/^%PDF-/);
  expect(source).toMatch(/\/Count 2\b/);
  const dimensions = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(source);
  expect(Number(dimensions?.[1])).toBeCloseTo(450, 0);
  expect(Number(dimensions?.[2])).toBeCloseTo(620, 0);
  expect(source).toContain('/ToUnicode');
});

test('large deletion confirmation protects unsaved prose and recovery opens a copy', async ({ page }) => {
  await openText(page, 'Chapter 1\n' + 'A long story about snow and winter. '.repeat(260));
  page.once('dialog', async dialog => {
    expect(dialog.message()).toMatch(/page\(s\) of text/);
    await dialog.dismiss();
  });
  await editor(page).press('ControlOrMeta+a');
  await editor(page).press('Backspace');
  await expect(editor(page)).toContainText('A long story');
  await page.getByRole('textbox', { name: 'Manuscript title' }).fill('Revised draft');
  await expect(page.locator('#save-state')).toHaveText('Saved locally');
  const originalURL = page.url();
  await page.locator('.file-menu summary').click();
  await page.getByRole('button', { name: 'Recovery checkpoint' }).click();
  await expect(page.locator('#recovery-preview')).toContainText('A long story');
  await page.getByRole('button', { name: 'Open as new manuscript' }).click();
  await expect(page.getByRole('textbox', { name: 'Manuscript title' })).toHaveValue('Test Manuscript');
  expect(page.url()).not.toBe(originalURL);
});
