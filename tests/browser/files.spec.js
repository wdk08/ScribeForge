import { test, expect } from '@playwright/test';
test.beforeEach(async ({ context }) => { await context.addInitScript(() => { window.scriptForgeLocalHelperDisabled = true; }); });
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';

const fixture = fileURLToPath(new URL('../fixtures/complex.fountain', import.meta.url));
async function fallback(page) {
  await page.addInitScript(() => { window.showOpenFilePicker = undefined; window.showSaveFilePicker = undefined; window.showDirectoryPicker = undefined; });
}
async function native(context) {
  await context.addInitScript(() => {
    window.showDirectoryPicker = undefined;
    const ready = (async () => {
      const directory = await navigator.storage.getDirectory();
      const handle = await directory.getFileHandle('Connected.fountain', { create: !sessionStorage.getItem('fixture-created') });
      if (!(await handle.getFile()).size) { const writer = await handle.createWritable(); await writer.write('Title: Connected Film\n\nINT. ROOM - DAY\n\nOriginal action.\n'); await writer.close(); }
      sessionStorage.setItem('fixture-created', 'true'); return { directory, handle };
    })();
    window.fileFixture = { ready };
    ready.catch(() => {});
    window.showOpenFilePicker = async () => [(await ready).handle];
    window.showSaveFilePicker = async () => (await ready).handle;
  });
}
async function importCopy(page) {
  await page.goto('/');
  const chooser = page.waitForEvent('filechooser'); await page.locator('#import-copy').click();
  await (await chooser).setFiles(fixture);
  await expect(page.locator('.screenplay-page').first()).toBeVisible();
}
async function editAction(page, text = 'Changed action.') {
  await page.evaluate(async text => {
    const doc = window.scriptForge.getDocument(); const el = doc.elements.find(el => el.type === 'action');
    const { restoreSelection } = await import('/js/selection.js');
    restoreSelection(document.getElementById('pages'), { anchor: { id: el.id, offset: 0 }, focus: { id: el.id, offset: el.text.length } });
    const data = new DataTransfer(); data.setData('text/plain', text);
    document.getElementById('pages').dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, text);
}
async function recovered(page) { await expect(page.locator('#recovery-dialog')).toBeVisible(); await page.locator('#recover-changes').click(); }
async function recoverySaved(page) { await expect.poll(() => page.evaluate(() => window.scriptForge?.getFileState()?.recoveryCurrent)).toBe(true); }
async function openNative(page) {
  await page.goto('/'); await page.locator('#open-fountain').click();
  await expect(page.locator('#document-title')).toHaveValue('Connected Film');
  await expect(page.locator('.screenplay-page').first()).toBeVisible();
}

test('homepage creates a persistent draft, searches recents and resumes recovery', async ({ page }) => {
  await fallback(page); await page.goto('/');
  await expect(page.locator('#empty-state')).toBeVisible(); await page.locator('#new-screenplay').click();
  await expect(page.locator('#pages')).toBeVisible();
  await page.locator('#document-title').fill('My New Screenplay'); await page.locator('#document-title').press('Tab');
  await page.locator('[data-format="action"]').click(); await page.keyboard.type('The draft survives a restart.');
  await recoverySaved(page); const id = await page.evaluate(() => window.scriptForge.getDocument().id);
  await page.locator('#home').click(); await expect(page.locator('.card-title')).toHaveText('My New Screenplay');
  await page.locator('#search').fill('missing'); await expect(page.locator('.script-card')).toHaveCount(0);
  await page.locator('#search').fill('New'); await expect(page.locator('.script-card')).toHaveCount(1);
  await page.locator('.card-title').click(); await recovered(page);
  expect(await page.evaluate(() => window.scriptForge.getDocument().id)).toBe(id);
  await expect(page.locator('#pages')).toContainText('The draft survives a restart.');
});
test('copy import retains original source while portable export preserves screenplay semantics', async ({ page }) => {
  await fallback(page); await importCopy(page);
  await expect(page.locator('#document-title')).toHaveValue('The Last Signal');
  await page.locator('.file-menu summary').click();
  const downloading = page.waitForEvent('download'); await page.locator('#export').click(); await page.locator('#export-fountain').click();
  const path = await (await downloading).path();
  const output = await readFile(path, 'utf8'), original = await readFile(fixture, 'utf8');
  const comparison = await page.evaluate(async ({ output, original }) => {
    const { parseFountain } = await import('/js/fountain.js'), { meaningfulContent } = await import('/js/document.js'), { repository } = await import('/js/storage.js');
    const record = await repository.get(window.scriptForge.getDocument().id);
    return { exported: meaningfulContent(parseFountain(output)), imported: meaningfulContent(parseFountain(original)), cached: record.cachedSource };
  }, { output, original });
  expect(comparison.exported).toEqual(comparison.imported); expect(comparison.cached).toBe(original);
  expect(output).toContain('@NOAH (on radio)'); expect(output).not.toContain('ScriptForge continuations');
  await expect(page.locator('#document-banner')).toContainText('browser copy');
});
test('reload offers recovery and restores model IDs, text and selection without changing a file', async ({ page }) => {
  await fallback(page); await importCopy(page); await editAction(page, 'Recovered <b>plain text</b>.'); await recoverySaved(page);
  const before = await page.evaluate(() => ({ doc: window.scriptForge.getDocument(), selection: window.scriptForge.getSelection() }));
  page.on('dialog', dialog => dialog.accept()); await page.reload(); await recovered(page);
  expect(await page.evaluate(() => window.scriptForge.getDocument())).toEqual(before.doc);
  expect(await page.evaluate(() => window.scriptForge.getSelection())).toEqual(before.selection);
  await expect(page.locator('#document-banner')).toContainText('Recovered unsaved changes');
  expect(await page.locator('#pages b').count()).toBe(0);
});
test('Export downloads a copy without claiming the draft was saved to disk', async ({ page }) => {
  await fallback(page); await importCopy(page); await editAction(page, 'A downloaded revision.');
  const download = page.waitForEvent('download'); await page.locator('#export').click(); await page.locator('#export-fountain').click(); await download;
  expect(await page.evaluate(() => window.scriptForge.getFileState().dirty)).toBe(true);
  await expect(page.locator('#file-autosave')).toBeChecked();
  await expect(page.locator('#file-autosave')).toBeDisabled();
  await expect(page.locator('#save')).toBeVisible(); await expect(page.locator('#save-as')).toHaveCount(0);
  await page.locator('#home').click(); await page.locator('.card-title').click(); await recovered(page);
  await expect(page.locator('#pages')).toContainText('A downloaded revision.');
});
test('actual structured-cloned handles reopen and direct Save updates the selected file', async ({ page, context }) => {
  await native(context); await openNative(page); await editAction(page, 'Direct file revision.');
  await expect.poll(() => page.evaluate(() => window.scriptForge.getFileState().dirty)).toBe(false);
  const source = await page.evaluate(async () => (await (await window.fileFixture.ready).handle.getFile()).text());
  expect(source).toContain('Direct file revision.');
  await page.locator('#home').click(); await expect(page.locator('.file-badge')).toHaveText('LINKED LOCAL FILE');
  await page.locator('.card-title').click(); await expect(page.locator('#pages')).toContainText('Direct file revision.');
  expect(await page.evaluate(() => window.scriptForge.getFileState().fileName)).toBe('Connected.fountain');
});
test('outside changes stop Save and reviewed replacement never happens automatically', async ({ page, context }) => {
  await native(context); await openNative(page); await editAction(page, 'My revision.');
  await page.evaluate(async () => { const { handle } = await window.fileFixture.ready; const writer = await handle.createWritable(); await writer.write('Outside writer edit.\n'); await writer.close(); });
  await expect(page.locator('#review-file-error')).toBeVisible({ timeout: 7000 });
  await page.locator('#review-file-error').click(); await expect(page.locator('#file-conflict-dialog')).toBeVisible();
  await expect(page.locator('#disk-version')).toHaveValue('Outside writer edit.\n');
  expect(await page.evaluate(async () => (await (await window.fileFixture.ready).handle.getFile()).text())).toBe('Outside writer edit.\n');
  await page.locator('#conflict-overwrite').click();
  await expect.poll(() => page.evaluate(() => window.scriptForge.getFileState().dirty)).toBe(false);
  expect(await page.evaluate(async () => (await (await window.fileFixture.ready).handle.getFile()).text())).toContain('My revision.');
});
test('Export keeps the linked file identity and autosaving stays enabled', async ({ page, context }) => {
  await native(context); await openNative(page);
  const originalId = await page.evaluate(() => window.scriptForge.getDocument().id);
  await editAction(page, 'Autosaved revision.');
  await expect.poll(async () => page.evaluate(async () => (await (await window.fileFixture.ready).handle.getFile()).text())).toContain('Autosaved revision.');
  const download = page.waitForEvent('download'); await page.locator('#export').click(); await page.locator('#export-fountain').click(); await download;
  expect(await page.evaluate(() => window.scriptForge.getDocument().id)).toBe(originalId);
  await expect(page.locator('#file-autosave')).toBeChecked(); await expect(page.locator('#file-autosave')).toBeDisabled();
  await editAction(page, 'Second automatic revision.');
  await expect.poll(async () => page.evaluate(async () => (await (await window.fileFixture.ready).handle.getFile()).text())).toContain('Second automatic revision.');
  expect(await page.evaluate(() => window.scriptForge.getFileState().fileName)).toBe('Connected.fountain');
  await page.locator('#home').click(); await expect(page.locator('.script-card')).toHaveCount(1);
});
test('a missing file opens a cached copy with a clear error rather than discarding the screenplay', async ({ page, context }) => {
  await native(context); await openNative(page);
  await page.evaluate(async () => { const { directory } = await window.fileFixture.ready; await directory.removeEntry('Connected.fountain'); });
  await page.locator('#home').click(); await page.locator('.card-title').click();
  await expect(page.locator('#document-banner')).toContainText('moved or deleted');
  await expect(page.locator('#recreate-file')).toBeVisible();
  await expect(page.locator('#pages')).toContainText('Original action.');
});
test('storage failure is visible and does not erase a previously committed recovery', async ({ page }) => {
  await fallback(page); await importCopy(page); await editAction(page, 'First recovery.'); await recoverySaved(page);
  await page.evaluate(async () => { const { repository } = await import('/js/storage.js'); repository.put = async () => { throw new DOMException('Storage full', 'QuotaExceededError'); }; });
  await editAction(page, 'New text stays in memory.');
  await expect(page.locator('#document-banner')).toContainText('Recovery could not be saved');
  await expect(page.locator('#pages')).toContainText('New text stays in memory.');
  const previous = await page.evaluate(async () => { const { repository } = await import('/js/storage.js'); return (await repository.get(window.scriptForge.getFileState().id)).recovery.document.elements.find(el => el.type === 'action').text; });
  expect(previous).toBe('First recovery.');
});
test('saved-version choice keeps the unsaved recovery as a separate recent entry', async ({ page }) => {
  await fallback(page); await importCopy(page); await editAction(page, 'Keep my recovery.'); await recoverySaved(page);
  const originalId = await page.evaluate(() => window.scriptForge.getDocument().id);
  page.on('dialog', dialog => dialog.accept()); await page.reload(); await page.locator('#open-saved').click();
  await expect(page.locator('.screenplay-page').first()).toBeVisible();
  await expect(page.locator('#pages')).not.toContainText('Keep my recovery.');
  const retained = await page.evaluate(async id => { const { repository } = await import('/js/storage.js'); return (await repository.get(id)).recovery.document.elements.find(el => el.type === 'action').text; }, originalId);
  expect(retained).toBe('Keep my recovery.');
});
test('homepage renders useful previews and fits mobile', async ({ page }) => {
  await fallback(page); await importCopy(page); await page.locator('#home').click();
  await expect(page.locator('.script-card')).toHaveCount(1);
  await page.screenshot({ path: 'test-results/library-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: 'test-results/library-mobile.png', fullPage: true });
});


test('Home updates when another tab creates, imports and renames scripts without a page reload', async ({ page, context }) => {
  await fallback(page); await page.goto('/');
  await expect(page.locator('.script-card')).toHaveCount(0);
  const editor = await context.newPage(); await fallback(editor); await editor.goto('/');
  await editor.locator('#new-screenplay').click();
  await expect(page.locator('.script-card')).toHaveCount(1);
  await expect(editor.locator('.screenplay-page').first()).toBeVisible();
  await editor.locator('#document-title').fill('Visible in both tabs');
  await editor.locator('#document-title').press('Tab'); await recoverySaved(editor);
  await expect(page.locator('.card-title')).toHaveText('Visible in both tabs');
  await importCopy(editor);
  await expect(page.locator('.script-card')).toHaveCount(2);
  await expect(page.locator('.card-title').filter({ hasText: 'The Last Signal' })).toHaveCount(1);
  await page.reload(); await expect(page.locator('.script-card')).toHaveCount(2);
  await page.screenshot({ path: 'test-results/library-synchronized.png', fullPage: true });
});

test('Home refreshes on focus and keeps its existing cards through a temporary read failure', async ({ page, context }) => {
  await fallback(page); await page.goto('/'); await page.locator('#new-screenplay').click();
  await page.locator('#home').click(); await expect(page.locator('.script-card')).toHaveCount(1);
  await page.evaluate(async () => {
    const { repository } = await import('/js/storage.js');
    const list = repository.list;
    repository.list = async () => { throw new Error('Temporary read failure'); };
    window.restoreLibraryRead = () => { repository.list = list; };
    window.dispatchEvent(new Event('focus'));
  });
  await expect(page.locator('#library-error')).toContainText('Temporary read failure');
  await expect(page.locator('.script-card')).toHaveCount(1);
  await page.evaluate(() => { window.restoreLibraryRead(); window.dispatchEvent(new Event('focus')); });
  await expect(page.locator('#library-error')).toBeHidden();
  await expect(page.locator('.script-card')).toHaveCount(1);
});
