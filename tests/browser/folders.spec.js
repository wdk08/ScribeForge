import { test, expect } from '@playwright/test';
test.beforeEach(async ({ context }) => { await context.addInitScript(() => { window.scriptForgeLocalHelperDisabled = true; }); });
test.beforeEach(async ({ browserName }) => { test.skip(browserName === 'webkit' && !test.info().title.includes('unsupported'), 'Native directory access is not available in WebKit; its recovery fallback is tested.'); });

async function directoryPicker(page) {
  await page.addInitScript(() => {
    window.directoryFixture = navigator.storage.getDirectory().then(root => root.getDirectoryHandle('Screenplays', { create: true }));
    window.folderPickerCalls = 0;
    window.showDirectoryPicker = async () => { window.folderPickerCalls++; return window.directoryFixture; };
  });
}
async function chooseAndCreate(page) {
  await page.goto('/'); await page.locator('#new-screenplay').click();
  await expect(page.locator('#folder-dialog')).toBeVisible();
  await page.locator('#choose-screenplay-folder').click();
  await expect(page.locator('#disk-save-state')).toHaveText('Saved');
}
async function typeAction(page, text) {
  await page.locator('[data-format="action"]').click(); await page.keyboard.type(text);
}

test('first creation chooses a stored folder, writes a file, autosaves, and survives a fresh page session', async ({ page, context }) => {
  await directoryPicker(page); await chooseAndCreate(page);
  const state = await page.evaluate(() => window.scriptForge.getFileState());
  expect(state.fileName).toBe('Untitled Screenplay.fountain');
  await typeAction(page, 'The screenplay saves automatically.');
  await expect(page.locator('#disk-save-state')).toHaveText('Unsaved changes');
  await expect(page.locator('#disk-save-state')).toHaveText('Saved', { timeout: 7000 });
  await page.screenshot({ path: 'test-results/folder-editor-saved.png', fullPage: true });
  const source = await page.evaluate(async name => (await (await (await window.directoryFixture).getFileHandle(name)).getFile()).text(), state.fileName);
  expect(source).toContain('The screenplay saves automatically.');
  await expect(page.locator('#file-autosave')).toBeChecked();
  await expect(page.locator('#file-autosave')).toBeDisabled();
  await page.locator('#pages').click(); await page.keyboard.press('ControlOrMeta+End'); await page.keyboard.type(' Another revision.');
  await expect(page.locator('#disk-save-state')).toHaveText('Saved', { timeout: 7000 });
  const names = await page.evaluate(async () => { const names = []; for await (const name of (await window.directoryFixture).keys()) names.push(name); return names; });
  expect(names).toEqual([state.fileName]);
  const updated = await page.evaluate(async name => (await (await (await window.directoryFixture).getFileHandle(name)).getFile()).text(), state.fileName);
  expect(updated).toContain('Another revision.');
  await page.locator('#home').click(); await expect(page.locator('.script-card')).toHaveCount(1);
  await expect(page.locator('[data-filter]')).toHaveCount(0);
  await expect(page.locator('#storage-info')).toHaveCount(0);
  await page.locator('#new-screenplay').click(); await expect(page.locator('#disk-save-state')).toHaveText('Saved');
  expect(await page.evaluate(() => window.folderPickerCalls)).toBe(0); // A new navigation reinitializes this counter.
  const second = await page.evaluate(() => window.scriptForge.getFileState().fileName);
  expect(second).not.toBe(state.fileName);
  await page.locator('#home').click(); await expect(page.locator('.script-card')).toHaveCount(2);
  await page.screenshot({ path: 'test-results/folder-library.png', fullPage: true });
  const reopened = await context.newPage(); await reopened.goto('/');
  await expect(reopened.locator('.script-card')).toHaveCount(2);
  await reopened.locator('.card-title').last().click();
  await expect(reopened.locator('#pages')).toContainText('The screenplay saves automatically.');
  await expect(reopened.locator('#disk-save-state')).toHaveText('Saved');
  const hasDirectory = await reopened.evaluate(async () => { const { repository } = await import('/js/storage.js'); return Boolean(await repository.getPreference('screenplayFolder', null)); });
  expect(hasDirectory).toBe(true);
});

test('unsupported directory access uses recovery and never repeatedly prompts', async ({ page }) => {
  await page.addInitScript(() => { window.showDirectoryPicker = undefined; window.showSaveFilePicker = undefined; });
  await page.goto('/'); await page.locator('#screenplay-folder').click();
  await expect(page.locator('#folder-dialog')).toContainText('does not support directory access');
  await page.locator('#folder-close').click();
  await page.locator('#new-screenplay').click(); await expect(page.locator('.screenplay-page')).toBeVisible();
  await expect(page.locator('#disk-save-state')).toHaveText('Unsaved changes');
  await typeAction(page, 'Recovery remains available.');
  await expect.poll(() => page.evaluate(() => window.scriptForge.getFileState().recoveryCurrent)).toBe(true);
  await page.locator('#home').click();
  await expect(page.locator('.script-card')).toHaveCount(1);
  await page.locator('#new-screenplay').click();
  await expect(page.locator('.screenplay-page')).toBeVisible(); await expect(page.locator('#folder-dialog')).toBeHidden();
});

test('a file opened outside the chosen folder autosaves to its original handle', async ({ page }) => {
  await directoryPicker(page);
  await page.addInitScript(() => {
    window.externalFile = navigator.storage.getDirectory().then(async root => {
      const handle = await root.getFileHandle('Original-location.fountain', { create: true });
      if (!(await handle.getFile()).size) { const writer = await handle.createWritable(); await writer.write('INT. ROOM - DAY\n\nOriginal action.'); await writer.close(); }
      return handle;
    });
    window.showOpenFilePicker = async () => [await window.externalFile];
  });
  await chooseAndCreate(page); await page.locator('#home').click(); await page.locator('#open-fountain').click();
  await expect(page.locator('#disk-save-state')).toHaveText('Saved');
  await page.evaluate(async () => {
    const el = window.scriptForge.getDocument().elements.find(el => el.type === 'action');
    const { restoreSelection } = await import('/js/selection.js');
    restoreSelection(document.getElementById('pages'), { anchor: { id: el.id, offset: 0 }, focus: { id: el.id, offset: el.text.length } });
  });
  await page.keyboard.type('Changed at its original location.');
  await expect(page.locator('#disk-save-state')).toHaveText('Saved', { timeout: 7000 });
  expect(await page.evaluate(async () => (await (await window.externalFile).getFile()).text())).toContain('Changed at its original location.');
  expect(await page.evaluate(() => window.scriptForge.getFileState().fileName)).toBe('Original-location.fountain');
});

test('revoked access reports disk failure while retaining recovery and never opening another picker', async ({ page }) => {
  await directoryPicker(page);
  await page.addInitScript(() => {
    const original = FileSystemFileHandle.prototype.queryPermission;
    FileSystemFileHandle.prototype.queryPermission = function (...args) {
      return window.fileAccessRevoked ? Promise.resolve('denied') : original.apply(this, args);
    };
    window.permissionPrompts = 0;
    const request = FileSystemFileHandle.prototype.requestPermission;
    FileSystemFileHandle.prototype.requestPermission = function (...args) { window.permissionPrompts++; return request.apply(this, args); };
  });
  await chooseAndCreate(page);
  const name = await page.evaluate(() => window.scriptForge.getFileState().fileName);
  await page.evaluate(() => { window.fileAccessRevoked = true; });
  await typeAction(page, 'These unsaved changes are safe in recovery.');
  await expect(page.locator('#disk-save-state')).toHaveText('Save failed', { timeout: 7000 });
  await expect.poll(() => page.evaluate(() => window.scriptForge.getFileState().recoveryCurrent)).toBe(true);
  const recovery = await page.evaluate(async () => {
    const { repository } = await import('/js/storage.js');
    return (await repository.get(window.scriptForge.getDocument().id)).recovery.document.elements.find(el => el.type === 'action').text;
  });
  expect(recovery).toBe('These unsaved changes are safe in recovery.');
  expect(await page.evaluate(() => window.permissionPrompts)).toBe(0);
  expect(await page.evaluate(async name => (await (await (await window.directoryFixture).getFileHandle(name)).getFile()).text(), name)).toContain('FADE IN:');
});

test('restarting the browser reopens the stored directory and saved screenplay', async ({ playwright }) => {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os'); const { join } = await import('node:path');
  const profile = await mkdtemp(join(tmpdir(), 'scriptforge-folder-test-'));
  let context;
  try {
    context = await playwright.chromium.launchPersistentContext(profile, { channel: process.env.CI ? undefined : 'chrome', headless: true, baseURL: 'http://localhost:4173' });
    let page = context.pages()[0]; await directoryPicker(page); await chooseAndCreate(page);
    await typeAction(page, 'This file survives a browser restart.');
    await expect(page.locator('#disk-save-state')).toHaveText('Saved', { timeout: 7000 });
    const id = await page.evaluate(() => window.scriptForge.getDocument().id);
    await context.close(); context = null;
    context = await playwright.chromium.launchPersistentContext(profile, { channel: process.env.CI ? undefined : 'chrome', headless: true, baseURL: 'http://localhost:4173' });
    page = context.pages()[0]; await page.goto('http://localhost:4173/');
    await expect(page.locator('.script-card')).toHaveCount(1); await page.locator('.card-title').click();
    await expect(page.locator('#pages')).toContainText('This file survives a browser restart.');
    await expect(page.locator('#disk-save-state')).toHaveText('Saved');
    expect(await page.evaluate(() => window.scriptForge.getDocument().id)).toBe(id);
    await page.locator('#home').click(); await page.locator('#new-screenplay').click();
    await expect(page.locator('#disk-save-state')).toHaveText('Saved');
    await expect(page.locator('#folder-dialog')).toBeHidden();
  } finally { await context?.close(); await rm(profile, { recursive: true, force: true }); }
});

test('renaming a folder screenplay updates its filename without stacking files or overwriting conflicts', async ({ page }) => {
  await directoryPicker(page); await chooseAndCreate(page);
  const initial = await page.evaluate(() => window.scriptForge.getFileState());
  const doc = await page.evaluate(() => window.scriptForge.getDocument());
  expect(doc.elements.filter(el => el.type !== 'titleField').map(el => [el.type, el.text])).toEqual([['transition', 'FADE IN:'], ['action', '']]);
  expect(await page.locator('.transition-left').first().textContent()).toBe('FADE IN:');
  const conflict = 'Named Film.fountain';
  await page.evaluate(async name => {
    const handle = await (await window.directoryFixture).getFileHandle(name, { create: true });
    const writer = await handle.createWritable(); await writer.write('Another screenplay.'); await writer.close();
  }, conflict);
  await page.locator('#document-title').fill('Named Film'); await page.locator('#document-title').press('Tab');
  await expect(page.locator('#disk-save-state')).toHaveText('Saved', { timeout: 7000 });
  const renamed = await page.evaluate(() => window.scriptForge.getFileState().fileName);
  expect(renamed).toBe('Named Film (2).fountain');
  const entries = await page.evaluate(async () => { const entries = {}; for await (const [name, handle] of (await window.directoryFixture).entries()) entries[name] = await (await handle.getFile()).text(); return entries; });
  expect(entries[initial.fileName]).toBeUndefined(); expect(entries[conflict]).toBe('Another screenplay.');
  expect(entries[renamed]).toContain('FADE IN:');
  await page.locator('#document-title').fill('Final Film'); await page.locator('#document-title').press('Tab');
  await expect(page.locator('#disk-save-state')).toHaveText('Saved', { timeout: 7000 });
  const names = await page.evaluate(async () => { const names = []; for await (const name of (await window.directoryFixture).keys()) names.push(name); return names; });
  expect(names.sort()).toEqual([conflict, 'Final Film.fountain'].sort());
  await page.locator('#home').click(); await page.locator('.card-title').click();
  await expect(page.locator('#disk-save-state')).toHaveText('Saved');
  await expect(page.locator('#document-title')).toHaveValue('Final Film');
});

test('failed old-name removal stays tracked and is retried after reopening', async ({ page }) => {
  await directoryPicker(page); await chooseAndCreate(page);
  const initial = await page.evaluate(() => window.scriptForge.getFileState().fileName);
  await page.evaluate(() => {
    const remove = FileSystemDirectoryHandle.prototype.removeEntry;
    FileSystemDirectoryHandle.prototype.removeEntry = function (...args) {
      if (!window.cleanupAllowed) return Promise.reject(new DOMException('Temporary folder failure', 'NotAllowedError'));
      return remove.apply(this, args);
    };
  });
  await page.locator('#document-title').fill('Retried Film'); await page.locator('#document-title').press('Tab');
  await expect(page.locator('#disk-save-state')).toHaveText('Save failed', { timeout: 7000 });
  const pending = await page.evaluate(async () => { const { repository } = await import('/js/storage.js'); return (await repository.get(window.scriptForge.getDocument().id)).pendingRenames.length; });
  expect(pending).toBe(1);
  await page.locator('#home').click(); await page.locator('.card-title').click();
  await expect(page.locator('#disk-save-state')).toHaveText('Saved');
  const names = await page.evaluate(async () => { const names = []; for await (const name of (await window.directoryFixture).keys()) names.push(name); return names; });
  expect(names).toEqual(['Retried Film.fountain']); expect(names).not.toContain(initial);
});

test('New opens immediately even while the initial disk write is waiting', async ({ page }) => {
  await directoryPicker(page);
  await page.goto('/'); await page.locator('#new-screenplay').click(); await page.locator('#choose-screenplay-folder').click();
  await expect(page.locator('#pages')).toBeVisible(); await expect(page.locator('#disk-save-state')).toHaveText('Saved');
  await page.locator('#home').click();
  await page.addInitScript(() => {
    const create = FileSystemFileHandle.prototype.createWritable;
    FileSystemFileHandle.prototype.createWritable = async function (...args) {
      await new Promise(resolve => { window.releaseInitialWrite = resolve; });
      return create.apply(this, args);
    };
  });
  await page.locator('#new-screenplay').click();
  await expect(page.locator('#pages')).toBeVisible(); await expect(page.locator('#disk-save-state')).toHaveText('Saving…');
  await page.evaluate(() => window.releaseInitialWrite()); await expect(page.locator('#disk-save-state')).toHaveText('Saved');
});

test('a deleted file can be recreated without losing edits, overwriting another file, or changing document ID', async ({ page }) => {
  await directoryPicker(page); await chooseAndCreate(page);
  const original = await page.evaluate(() => window.scriptForge.getFileState());
  await page.evaluate(async name => { await (await window.directoryFixture).removeEntry(name); }, original.fileName);
  await typeAction(page, 'I continued writing after deleting the file.');
  await expect(page.locator('#disk-save-state')).toHaveText('Save failed', { timeout: 7000 });
  await expect(page.locator('#document-banner')).toContainText('moved or deleted');
  await expect.poll(() => page.evaluate(() => window.scriptForge.getFileState().recoveryCurrent)).toBe(true);
  // A different file appears at the old name before recovery. Preserve it.
  await page.evaluate(async name => {
    const file = await (await window.directoryFixture).getFileHandle(name, { create: true });
    const writer = await file.createWritable(); await writer.write('Someone else owns this file.'); await writer.close();
  }, original.fileName);
  await page.locator('#recreate-file').click();
  await expect(page.locator('#disk-save-state')).toHaveText('Saved');
  expect(await page.evaluate(() => window.scriptForge.getFileState().id)).toBe(original.id);
  expect(await page.evaluate(() => window.scriptForge.getFileState().fileName)).toBe('Untitled Screenplay (2).fountain');
  expect(await page.evaluate(async name => (await (await (await window.directoryFixture).getFileHandle(name)).getFile()).text(), original.fileName)).toBe('Someone else owns this file.');
  await page.locator('#pages').click(); await page.keyboard.press('ControlOrMeta+End'); await page.keyboard.type(' Autosaving works again.');
  await expect(page.locator('#disk-save-state')).toHaveText('Saved', { timeout: 7000 });
  const source = await page.evaluate(async () => (await (await (await window.directoryFixture).getFileHandle(window.scriptForge.getFileState().fileName)).getFile()).text());
  expect(source).toContain('I continued writing after deleting the file. Autosaving works again.');
  await page.locator('#home').click(); await expect(page.locator('.script-card')).toHaveCount(1);
  await page.locator('.card-title').click(); await expect(page.locator('#pages')).toContainText('Autosaving works again.');
});
