import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
test.beforeEach(async ({ context }) => { await context.addInitScript(() => { window.scriptForgeLocalHelperDisabled = true; window.showDirectoryPicker = undefined; }); });

test('editor and homepage PDF exports download actual PDFs without changing the screenplay', async ({ page }) => {
  await page.goto('/editor.html?sample=1'); await expect(page.locator('#pages')).toContainText('NOAH');
  const before = await page.evaluate(() => window.scriptForge.getDocument());
  await page.locator('#export').click();
  const pdfDownload = page.waitForEvent('download'); await page.locator('#export-pdf').click();
  const pdf = await pdfDownload; expect(pdf.suggestedFilename()).toBe('The Last Signal.pdf');
  await pdf.saveAs('test-results/screenplay-export.pdf');
  expect((await readFile(await pdf.path())).subarray(0, 5).toString()).toBe('%PDF-');
  expect(await page.evaluate(() => window.scriptForge.getDocument())).toEqual(before);
  await page.locator('#home').click(); await page.getByLabel('Options for The Last Signal').click();
  const libraryPDF = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export as PDF', exact: true }).click();
  expect((await readFile(await (await libraryPDF).path())).subarray(0, 5).toString()).toBe('%PDF-');
});

test('Save and Ctrl/Cmd+S write the linked file immediately without downloads or Save As', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'Native OPFS file-handle fixture is Chromium-specific; WebKit manual saving is covered by the local-helper workflow.');
  await page.addInitScript(() => {
    window.fixture = navigator.storage.getDirectory().then(async directory => {
      const handle = await directory.getFileHandle('Manual.fountain', { create: true });
      if (!(await handle.getFile()).size) { const writer = await handle.createWritable(); await writer.write('INT. ROOM - DAY\n\nOriginal.'); await writer.close(); }
      return handle;
    });
    window.showOpenFilePicker = async () => [await window.fixture];
    window.showSaveFilePicker = async () => { throw new Error('Save As must not be called.'); };
  });
  let downloads = 0; page.on('download', () => downloads++);
  await page.goto('/'); await page.locator('#open-fountain').click(); await expect(page.locator('#pages')).toBeVisible();
  await page.evaluate(async () => {
    const el = window.scriptForge.getDocument().elements.find(el => el.type === 'action');
    const { restoreSelection } = await import('/js/selection.js'); restoreSelection(document.getElementById('pages'), { anchor: { id: el.id, offset: 0 }, focus: { id: el.id, offset: el.text.length } });
  });
  await page.keyboard.type('Saved immediately.'); await page.locator('#save').click(); await expect(page.locator('#disk-save-state')).toHaveText('Saved');
  expect(await page.evaluate(async () => (await (await window.fixture).getFile()).text())).toContain('Saved immediately.');
  await page.locator('#pages').click(); await page.keyboard.press('ControlOrMeta+End'); await page.keyboard.type(' Via keyboard.'); await page.keyboard.press('ControlOrMeta+s');
  await expect(page.locator('#disk-save-state')).toHaveText('Saved');
  expect(await page.evaluate(async () => (await (await window.fixture).getFile()).text())).toContain('Via keyboard.');
  expect(downloads).toBe(0);
});

test('Save on an unlinked draft offers folder setup and does not download', async ({ page }) => {
  let downloads = 0; page.on('download', () => downloads++);
  await page.goto('/'); await page.locator('#new-screenplay').click(); await expect(page.locator('#pages')).toBeVisible();
  await page.locator('#save').click(); await expect(page.locator('#folder-dialog')).toBeVisible(); expect(downloads).toBe(0);
});
