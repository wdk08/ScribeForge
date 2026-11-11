import { test, expect } from '@playwright/test';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createLocalFiles } from '../../scripts/local-files.mjs';

test('Safari-style file access selects a folder, autosaves, renames, reopens, and handles an offline helper', async ({ page }) => {
  const folder = await mkdtemp(join(tmpdir(), 'scriptforge-browser-helper-'));
  const helper = createLocalFiles({ configPath: join(folder, '.grants.json'), enabled: true, picker: async () => folder });
  let offline = false, picks = 0;
  try {
    await page.addInitScript(() => { window.showDirectoryPicker = undefined; window.showOpenFilePicker = undefined; window.showSaveFilePicker = undefined; });
    await page.route('**/api/local-files/*', async route => {
      const action = new URL(route.request().url()).pathname.split('/').at(-1);
      if (offline && action !== 'status') { await route.abort(); return; }
      if (action === 'choose-folder') picks++;
      try { await route.fulfill({ json: await helper.run(action, route.request().postDataJSON()) }); }
      catch (error) { await route.fulfill({ status: 400, json: { error: { name: error.name, message: error.message, current: error.current } } }); }
    });
    await page.goto('/'); await page.locator('#new-screenplay').click();
    await expect(page.locator('#folder-dialog')).toBeVisible(); await page.locator('#choose-screenplay-folder').click();
    await expect(page.locator('#pages')).toBeVisible(); await expect(page.locator('#disk-save-state')).toHaveText('Saved');
    await page.locator('#document-title').fill('Safari Film'); await page.locator('#document-title').press('Tab');
    await page.locator('[data-format="action"]').click(); await page.keyboard.type('Written in Safari.');
    await expect(page.locator('#disk-save-state')).toHaveText('Saved', { timeout: 8000 });
    expect(await readFile(join(folder, 'Safari Film.fountain'), 'utf8')).toContain('Written in Safari.');
    expect((await readdir(folder)).filter(name => name.endsWith('.fountain'))).toEqual(['Safari Film.fountain']);
    await page.locator('#home').click(); await page.locator('.card-title').click();
    await expect(page.locator('#pages')).toContainText('Written in Safari.'); await expect(page.locator('#disk-save-state')).toHaveText('Saved');
    expect(picks).toBe(1);
    let downloads = 0; page.on('download', () => downloads++);
    await page.locator('#pages').click(); await page.keyboard.press('ControlOrMeta+End'); await page.keyboard.type(' Manual save.');
    await page.locator('#save').click(); await expect(page.locator('#disk-save-state')).toHaveText('Saved');
    expect(await readFile(join(folder, 'Safari Film.fountain'), 'utf8')).toContain('Manual save.');
    await page.locator('#pages').click(); await page.keyboard.press('ControlOrMeta+End'); await page.keyboard.type(' Keyboard save.'); await page.keyboard.press('ControlOrMeta+s');
    await expect(page.locator('#disk-save-state')).toHaveText('Saved');
    expect(await readFile(join(folder, 'Safari Film.fountain'), 'utf8')).toContain('Keyboard save.');
    expect(downloads).toBe(0);
    offline = true; await page.locator('#pages').click(); await page.keyboard.press('ControlOrMeta+End'); await page.keyboard.type(' Preserved while offline.');
    await expect(page.locator('#disk-save-state')).toHaveText('Save failed', { timeout: 8000 });
    await expect(page.locator('#document-banner')).toContainText('offline');
    await expect.poll(() => page.evaluate(() => window.scriptForge.getFileState().recoveryCurrent)).toBe(true);
    expect(await readFile(join(folder, 'Safari Film.fountain'), 'utf8')).not.toContain('Preserved while offline.');
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test('the helper rejects calls from another origin and refuses ungranted file references', async ({ request }) => {
  const denied = await request.post('/api/local-files/status', { headers: { Origin: 'https://example.com', 'X-ScriptForge-Local': '1' }, data: {} });
  expect(denied.status()).toBe(403);
  const badGrant = await request.post('/api/local-files/read', { headers: { Origin: 'http://localhost:4173', 'X-ScriptForge-Local': '1' }, data: { handle: { token: 'ungranted', name: 'outside.fountain', kind: 'file' } } });
  expect(badGrant.status()).toBe(400); expect((await badGrant.json()).error.name).toBe('FilePermissionError');
});

test('Safari helper autosaves an unfinished numbered scene after Fade In without losing text or stopping later saves', async ({ page }) => {
  const folder = await mkdtemp(join(tmpdir(), 'scriptforge-scene-save-'));
  const helper = createLocalFiles({ configPath: join(folder, '.grants.json'), enabled: true, picker: async () => folder });
  try {
    await page.addInitScript(() => { window.showDirectoryPicker = undefined; window.showOpenFilePicker = undefined; window.showSaveFilePicker = undefined; });
    await page.route('**/api/local-files/*', async route => {
      try { await route.fulfill({ json: await helper.run(new URL(route.request().url()).pathname.split('/').at(-1), route.request().postDataJSON()) }); }
      catch (error) { await route.fulfill({ status: 400, json: { error: { name: error.name, message: error.message } } }); }
    });
    await page.goto('/'); await expect(page.locator('#empty-state')).toBeVisible(); await page.locator('#new-screenplay').click();
    await page.locator('#choose-screenplay-folder').click(); await expect(page.locator('#disk-save-state')).toHaveText('Saved');
    let downloads = 0; page.on('download', () => downloads++);
    await page.locator('[data-format="scene"]').click();
    await page.locator('#screenplay-settings').click(); await page.locator('#scene-numbers').check(); await page.locator('#settings-done').click();
    await page.locator('#save').click(); await expect(page.locator('#disk-save-state')).toHaveText('Saved');
    await page.locator('[data-type="scene"]').click(); await page.keyboard.type('INT. ');
    await expect(page.locator('#disk-save-state')).toHaveText('Saved', { timeout: 8000 });
    let doc = await page.evaluate(() => window.scriptForge.getDocument());
    expect(doc.elements.find(el => el.type === 'scene').text).toBe('INT. ');
    const { parseFountain } = await import('../../js/fountain.js');
    const name = (await page.evaluate(() => window.scriptForge.getFileState())).fileName;
    expect(parseFountain(await readFile(join(folder, name), 'utf8')).elements.find(el => el.type === 'scene').text).toBe('INT.');
    await page.keyboard.type('ROOM - DAY ');
    await expect(page.locator('#disk-save-state')).toHaveText('Saved', { timeout: 8000 });
    expect((await page.evaluate(() => window.scriptForge.getDocument())).elements.find(el => el.type === 'scene').text).toBe('INT. ROOM - DAY ');
    await page.keyboard.press('Enter'); await page.keyboard.type('A quiet room.');
    await expect(page.locator('#disk-save-state')).toHaveText('Saved', { timeout: 8000 });
    const parsed = parseFountain(await readFile(join(folder, name), 'utf8'));
    expect(parsed.elements.filter(el => !['whitespace', 'titleField'].includes(el.type)).map(el => [el.type, el.text])).toEqual([['transition', 'FADE IN:'], ['scene', 'INT. ROOM - DAY'], ['action', 'A quiet room.']]);
    expect(parsed.elements.find(el => el.type === 'scene').sceneNumber).toBe('1');
    expect(await page.evaluate(() => window.scriptForge.getSelection().focus.offset)).toBe(13);
    expect(downloads).toBe(0);
  } finally { await rm(folder, { recursive: true, force: true }); }
});
