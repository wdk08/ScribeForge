import { test, expect, chromium, webkit } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const text = 'INT. HOUSE - DAY\n\nTYLER (V.O.)\nHello there.\n(quietly)\nI am here.\n\nHe waits.\n\nTYLER (O.S.)\nHello again.\n\nTESS\nAnn and Annie.';
test.beforeEach(async ({ context }) => { await context.addInitScript(() => { window.scriptForgeLocalHelperDisabled = true; window.showDirectoryPicker = undefined; }); });
async function select(page, id, offset = 0, end = offset) {
  await page.evaluate(async ({ id, offset, end }) => {
    const { restoreSelection } = await import('/js/selection.js');
    restoreSelection(document.getElementById('pages'), { anchor: { id, offset }, focus: { id, offset: end } }, { scroll: true });
  }, { id, offset, end });
}
async function start(page, value = text) {
  await page.goto('/editor.html'); await expect(page.locator('#pages')).toHaveAttribute('contenteditable', 'true');
  const action = await page.evaluate(() => window.scriptForge.getDocument().elements.find(el => el.type === 'action'));
  await select(page, action.id);
  if (value) await page.locator('#pages').evaluate((root, value) => {
    const clipboardData = new DataTransfer(); clipboardData.setData('text/plain', value); root.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
  }, value);
}
async function menu(page, name, id) { await page.locator(`.${name}-menu > summary`).click(); await page.locator(`#${id}`).click(); }
async function recover(page) { await expect.poll(async () => await page.locator('#recovery-dialog').isVisible() || await page.locator('#pages').getAttribute('contenteditable') === 'true').toBe(true); if (await page.locator('#recovery-dialog').isVisible()) await page.locator('#recover-changes').click(); await expect(page.locator('#pages')).toHaveAttribute('contenteditable', 'true'); }

test('Cmd/Ctrl-click continuation preserves extensions, caret, undo, autosave and reopen', async ({ page }) => {
  await start(page);
  const cues = await page.evaluate(() => window.scriptForge.getDocument().elements.filter(el => el.type === 'character'));
  const second = page.locator(`[data-element-id="${cues[1].id}"]`).first();
  await expect(second).toHaveAttribute('data-continuation-text', " (CONT'D)");
  await second.click({ modifiers: ['ControlOrMeta'] });
  await expect(page.locator(`[data-element-id="${cues[1].id}"]`).first()).not.toHaveAttribute('data-continuation-text');
  expect(await page.evaluate(id => window.scriptForge.getDocument().elements.find(el => el.id === id).text, cues[1].id)).toBe('TYLER (O.S.)');
  await page.keyboard.press('ControlOrMeta+z'); await expect(page.locator(`[data-element-id="${cues[1].id}"]`).first()).toHaveAttribute('data-continuation-text');
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect.poll(() => page.evaluate(() => window.scriptForge.getFileState().recoveryCurrent)).toBe(true);
  await page.reload(); await recover(page);
  expect(await page.evaluate(id => window.scriptForge.getDocument().elements.find(el => el.id === id).continuation, cues[1].id)).toBe('off');
  await page.locator(`[data-element-id="${cues[0].id}"]`).first().click({ modifiers: ['ControlOrMeta'] });
  await expect(page.locator(`[data-element-id="${cues[0].id}"]`).first()).toHaveAttribute('data-continuation-text', " (CONT'D)");
});
test('find highlights multiple pages, advanced filters, replace one/all, undo and Escape', async ({ page }) => {
  await start(page, Array(28).fill('INT. HOSPITAL - DAY\n\nAnn sees ann and Annie.\n\nTESS\nAnn calls Ann.').join('\n\n'));
  expect(await page.locator('.screenplay-page').count()).toBeGreaterThan(1);
  await page.keyboard.press('ControlOrMeta+f'); await expect(page.locator('#find-query')).toBeFocused();
  await page.locator('#find-query').fill('Ann'); await expect(page.locator('#find-count')).toHaveText('1 of 140');
  await expect(page.locator('.search-highlight.current')).toHaveCount(1);
  await page.locator('#find-advanced').click(); await page.locator('#find-word').check(); await expect(page.locator('#find-count')).toHaveText('1 of 112');
  await page.locator('#find-case').check(); await expect(page.locator('#find-count')).toHaveText('1 of 84');
  for (const type of ['scene', 'action', 'character', 'parenthetical', 'transition']) await page.locator(`[name="find-type"][value="${type}"]`).uncheck();
  await expect(page.locator('#find-count')).toHaveText('1 of 56');
  await page.locator('#find-query').focus(); await page.keyboard.press('Shift+Enter'); await expect(page.locator('#find-count')).toHaveText('56 of 56');
  expect(await page.locator('.document-viewport').evaluate(el => el.scrollTop)).toBeGreaterThan(1500);
  await page.locator('#find-expand').click(); await page.locator('#replace-text').fill('Jane'); await page.locator('#replace-one').click(); await expect(page.locator('#find-count')).toHaveText('55 of 55');
  await page.locator('#replace-all').click(); await expect(page.locator('#find-count')).toHaveText('0 of 0');
  await page.keyboard.press('Escape'); await page.keyboard.press('ControlOrMeta+z');
  expect(await page.evaluate(() => window.scriptForge.getDocument().elements.filter(el => el.type === 'dialogue').map(el => el.text).join(' ').match(/Ann/g).length)).toBe(55);
  await menu(page, 'file', 'version-history'); await expect(page.locator('#version-list')).toContainText('Before Replace All');
});
test('statistics normalize speaking cues and refresh/sort without changing screenplay', async ({ page }) => {
  await start(page); const before = await page.evaluate(() => window.scriptForge.getDocument());
  await menu(page, 'tools', 'dialogue-statistics');
  await expect(page.locator('#statistics-totals')).toHaveText('Total Dialogue Words: 10 · Total Speaking Characters: 2');
  await expect(page.locator('#statistics-rows tr').first()).toContainText('TYLER'); await expect(page.locator('#statistics-rows tr').first()).toContainText('70.0%');
  await page.locator('[data-stat-sort="name"]').click(); await expect(page.locator('#statistics-rows tr').first()).toContainText('TESS');
  expect(await page.evaluate(() => window.scriptForge.getDocument())).toEqual(before);
  const speech = before.elements.find(el => el.type === 'dialogue');
  await select(page, speech.id, speech.text.length); await page.keyboard.type(' More.');
  await expect(page.locator('#statistics-totals')).toHaveText('Total Dialogue Words: 11 · Total Speaking Characters: 2');
});
test('theme persists across pages and restart, follows system, focus keeps editing and recovery', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' }); await start(page, '');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.locator('#screenplay-settings').click(); await page.locator('[name="appearance"][value="light"]').check();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.locator('[name="appearance"][value="dark"]').check(); await page.locator('#settings-done').click();
  await page.keyboard.press('ControlOrMeta+Shift+f'); await expect(page.locator('body')).toHaveClass(/focus-mode/); await expect(page.locator('.app-header')).toBeHidden();
  await page.keyboard.type('Focus writing.'); await expect(page.locator('[data-type="action"]')).toHaveText('Focus writing.');
  await expect.poll(() => page.evaluate(() => window.scriptForge.getFileState().recoveryCurrent)).toBe(true);
  await page.keyboard.press('ControlOrMeta+f'); await page.keyboard.press('Escape'); await expect(page.locator('body')).toHaveClass(/focus-mode/);
  await page.keyboard.press('Escape'); await expect(page.locator('body')).not.toHaveClass(/focus-mode/);
  await page.screenshot({ path: 'test-results/final-editor-dark.png', fullPage: true });
  await page.reload(); await recover(page); await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.locator('#home').click(); await expect(page).toHaveURL(/index.html/); await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});
test('version history safety backup, preview, restore, undo and independent persistence', async ({ page }) => {
  await start(page); const original = await page.evaluate(() => window.scriptForge.getDocument());
  await menu(page, 'file', 'version-history'); await page.locator('#version-snapshot').click(); await expect(page.locator('#version-list')).toContainText('Manual Backup');
  await page.locator('#versions-close').click();
  const action = original.elements.find(el => el.type === 'action' && el.text === 'He waits.'); await select(page, action.id, action.text.length); await page.keyboard.type(' New ending.');
  await menu(page, 'file', 'version-history');
  await page.locator('#version-list label').filter({ hasText: 'Manual Backup' }).locator('input').check(); await expect(page.locator('#version-preview')).toContainText('He waits.');
  await page.locator('#version-restore').click(); await page.locator('#restore-confirm').click(); await expect(page.locator('#versions-dialog')).toBeHidden();
  expect(await page.evaluate(() => window.scriptForge.getDocument())).toEqual(original);
  // Dialog close events restore editor focus asynchronously; wait before sending Undo.
  await expect(page.locator('#pages')).toBeFocused();
  await page.keyboard.press('ControlOrMeta+z'); expect(await page.evaluate(() => window.scriptForge.getDocument().elements.some(el => el.text.includes('New ending.')))).toBe(true);
  await menu(page, 'file', 'version-history'); await expect(page.locator('#version-list')).toContainText('Before Restore');
  await page.locator('#versions-close').click(); await expect.poll(() => page.evaluate(() => window.scriptForge.getFileState().recoveryCurrent)).toBe(true);
  await page.reload(); await recover(page); await menu(page, 'file', 'version-history'); await expect(page.locator('#version-list')).toContainText('Before Restore');
});
test('backup failure blocks destructive replace without losing text or disabling recovery', async ({ page }) => {
  await start(page, 'Ann '.repeat(100));
  await page.evaluate(async () => { const { backups } = await import('/js/backups.js'); backups.store.add = async () => { throw new Error('Simulated quota failure'); }; });
  await page.keyboard.press('ControlOrMeta+Shift+h'); await page.locator('#find-query').fill('Ann'); await page.locator('#replace-text').fill('Jane');
  await page.locator('#replace-all').click(); await expect(page.locator('#notice')).toContainText('Simulated quota failure');
  expect(await page.evaluate(() => window.scriptForge.getDocument().elements.some(el => el.text.includes('Jane')))).toBe(false);
  await page.keyboard.press('Escape'); await page.keyboard.type('Safe');
  await expect.poll(() => page.evaluate(() => window.scriptForge.getFileState().recoveryCurrent)).toBe(true);
});
test('automatic backups count active editing, deduplicate and disabling leaves autosave enabled', async ({ page }) => {
  await start(page, '');
  await page.locator('#screenplay-settings').click(); await page.locator('#backup-interval').selectOption('1'); await expect(page.locator('#backup-status')).toContainText('saved'); await page.locator('#settings-done').click();
  await page.evaluate(() => { const now = Date.now.bind(Date); let offset = 0; Date.now = () => now() + offset; window.advanceEditingTime = () => { offset += 20000; }; });
  for (let i = 0; i < 5; i++) { await page.evaluate(() => window.advanceEditingTime()); await page.keyboard.type(String(i)); }
  await menu(page, 'file', 'version-history'); await expect(page.locator('#version-list label')).toHaveCount(2);
  await page.locator('#version-refresh').click(); await expect(page.locator('#version-list label')).toHaveCount(2); await page.locator('#versions-close').click();
  await page.locator('#screenplay-settings').click(); await page.locator('#backups-enabled').uncheck(); await expect(page.locator('#backup-status')).toContainText('saved'); await page.locator('#settings-done').click();
  for (let i = 0; i < 5; i++) { await page.evaluate(() => window.advanceEditingTime()); await page.keyboard.type('x'); }
  await expect.poll(() => page.evaluate(() => window.scriptForge.getFileState().recoveryCurrent)).toBe(true);
  await menu(page, 'file', 'version-history'); await expect(page.locator('#version-list label')).toHaveCount(2);
});
test('damaged working document can restore an independent backup and preserves the damaged record', async ({ page }) => {
  await start(page); const original = await page.evaluate(() => window.scriptForge.getDocument());
  await menu(page, 'file', 'version-history'); await page.locator('#version-snapshot').click(); await expect(page.locator('#version-list')).toContainText('Manual Backup'); await page.locator('#versions-close').click();
  await expect.poll(() => page.evaluate(() => window.scriptForge.getFileState().recoveryCurrent)).toBe(true);
  await page.evaluate(async () => {
    const { repository } = await import('/js/storage.js'); const id = window.scriptForge.getDocument().id;
    const record = await repository.get(id); record.recovery = { document: { id, version: 1, title: 'Damaged', elements: null }, dirty: true }; await repository.put(record, record.revision);
  });
  await page.reload(); await expect(page.locator('#versions-dialog')).toBeVisible();
  await page.locator('#version-list label').filter({ hasText: 'Manual Backup' }).locator('input').check();
  await page.locator('#version-restore').click(); await page.locator('#restore-confirm').click(); await expect(page.locator('#pages')).toHaveAttribute('contenteditable', 'true');
  expect(await page.evaluate(() => window.scriptForge.getDocument())).toEqual(original);
  await expect.poll(() => page.evaluate(() => window.scriptForge.getFileState().recoveryCurrent)).toBe(true);
  await menu(page, 'file', 'version-history'); await expect(page.locator('#version-list')).toContainText('Damaged Working Copy');
});
test('dark pages and dialogs are readable, system responds, PDF output and pagination remain identical', async ({ page }) => {
  await start(page); const before = await page.evaluate(() => window.scriptForge.getDocument());
  async function pdfData(theme) {
    return page.evaluate(async theme => {
      window.scriptForgeTheme.set(theme);
      const { createScreenplayPDF } = await import('/js/pdf-export.js'); const pdf = await createScreenplayPDF(window.scriptForge.getDocument());
      const data = new TextDecoder('latin1').decode(await pdf.blob.arrayBuffer()).replace(/\/CreationDate \([^)]*\)/g, '/CreationDate (fixed)').replace(/\/ID \[[^\]]*\]/g, '/ID [fixed]');
      return { data, pages: window.scriptForge.getPages() };
    }, theme);
  }
  const light = await pdfData('light'), dark = await pdfData('dark'); expect(dark).toEqual(light);
  await expect(page.locator('#title-page')).toHaveCSS('background-color', 'rgb(26, 26, 26)');
  await expect(page.locator('.screenplay-page').first()).toHaveCSS('background-color', 'rgb(26, 26, 26)');
  await page.locator('#screenplay-settings').click(); await page.screenshot({ path: 'test-results/final-settings-dark.png' });
  await page.locator('[name="appearance"][value="system"]').check(); await page.emulateMedia({ colorScheme: 'light' }); await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.emulateMedia({ colorScheme: 'dark' }); await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.locator('#settings-done').click(); expect(await page.evaluate(() => window.scriptForge.getDocument())).toEqual(before);
  const last = await page.evaluate(() => window.scriptForge.getDocument().elements.findLast(el => el.type === 'dialogue')); await select(page, last.id, 0);
  await page.keyboard.press('ControlOrMeta+f'); await page.locator('#find-query').fill('Hello'); await page.screenshot({ path: 'test-results/final-editor-dark.png' });
  await page.emulateMedia({ media: 'print' }); await expect(page.locator('#title-page')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
});
test('backup restore retains the existing linked file association and autosaves to that file', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'Native file handle fixture uses Chromium OPFS; WebKit helper autosaving is covered separately.');
  await page.addInitScript(() => {
    window.fixture = navigator.storage.getDirectory().then(async directory => {
      const handle = await directory.getFileHandle('History.fountain', { create: true });
      const writer = await handle.createWritable(); await writer.write('INT. ROOM - DAY\n\nOriginal action.'); await writer.close(); return handle;
    });
    window.showOpenFilePicker = async () => [await window.fixture];
  });
  await page.goto('/'); await page.locator('#open-fountain').click(); await expect(page.locator('#pages')).toHaveAttribute('contenteditable', 'true');
  const action = await page.evaluate(() => window.scriptForge.getDocument().elements.find(el => el.type === 'action'));
  await menu(page, 'file', 'version-history'); await expect(page.locator('#version-list label')).toHaveCount(1); await page.locator('#versions-close').click();
  await select(page, action.id, action.text.length); await page.keyboard.type(' Changed.'); await expect(page.locator('#disk-save-state')).toHaveText('Saved');
  await menu(page, 'file', 'version-history'); await page.locator('#version-list input').first().check(); await page.locator('#version-restore').click(); await page.locator('#restore-confirm').click(); await expect(page.locator('#versions-dialog')).toBeHidden();
  await expect(page.locator('#disk-save-state')).toHaveText('Saved');
  const state = await page.evaluate(async () => ({ file: window.scriptForge.getFileState().fileName, text: await (await (await window.fixture).getFile()).text() }));
  expect(state.file).toBe('History.fountain'); expect(state.text).toContain('Original action.'); expect(state.text).not.toContain('Changed.');
});

test('independent backups survive closing and restarting the browser process', async ({ browserName }) => {
  const profile = await mkdtemp(join(tmpdir(), 'scriptforge-backup-restart-'));
  let context;
  async function launch() {
    context = await (browserName === 'webkit' ? webkit : chromium).launchPersistentContext(profile, { headless: true, ...(browserName === 'webkit' ? {} : { channel: process.env.CI ? undefined : 'chrome' }), baseURL: 'http://localhost:4173' });
    await context.addInitScript(() => { window.scriptForgeLocalHelperDisabled = true; window.showDirectoryPicker = undefined; });
    return context.pages()[0] ?? await context.newPage();
  }
  try {
    let page = await launch(); await start(page, 'Restart proof.');
    const id = await page.evaluate(() => window.scriptForge.getDocument().id);
    await menu(page, 'file', 'version-history'); await page.locator('#version-snapshot').click(); await expect(page.locator('#version-list')).toContainText('Manual Backup'); await page.locator('#versions-close').click();
    await page.locator('#home').click(); await expect(page).toHaveURL(/index.html/); await context.close(); context = null;
    page = await launch(); await page.goto(`/editor.html?id=${id}`); await recover(page);
    await expect(page.locator('#pages')).toContainText('Restart proof.'); await menu(page, 'file', 'version-history'); await expect(page.locator('#version-list')).toContainText('Manual Backup');
  } finally { await context?.close(); await rm(profile, { recursive: true, force: true }); }
});
