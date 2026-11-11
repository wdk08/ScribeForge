import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { installSpeechMock } from '../fixtures/speech-mock.js';
const source = "INT. GARDEN - DAY\n\nRose holds a rose. ROSE watches ANNIE.\n\nROSE (V.O.)\nRose, **Rose** and rose.\n\nANN ^\nRose?\n\nROSE (O.S.) (CONT'D)\n(to Rose)\nYes.\n\nEXT. GARDEN - NIGHT\n\nRose leaves.\n";
test.beforeEach(async ({ context }) => { await context.addInitScript(() => { window.scriptForgeLocalHelperDisabled = true; window.showDirectoryPicker = undefined; }); });
async function doc(page) { return page.evaluate(() => window.scriptForge.getDocument()); }
async function position(page, id, offset) { await page.evaluate(async ({ id, offset }) => { const { restoreSelection } = await import('/js/selection.js'); restoreSelection(document.getElementById('pages'), { anchor: { id, offset }, focus: { id, offset } }); }, { id, offset }); }
async function openCopy(page) {
  await page.addInitScript(installSpeechMock); await page.goto('/');
  const id = await page.evaluate(async source => { const { parseFountain } = await import('/js/fountain.js'), { draftRecord } = await import('/js/session.js'), { repository } = await import('/js/storage.js'); return (await repository.put(draftRecord(parseFountain(source)))).id; }, source);
  await page.goto(`/editor.html?id=${id}`); await page.locator('#recover-changes').click(); await expect(page.locator('#pages')).toContainText('ROSE'); return id;
}
async function review(page, from = 'ROSE', to = 'LILY') { await page.locator('.tools-menu summary').click(); await page.locator('#rename-character').click(); await page.locator('#cr-character').selectOption(from); await page.locator('#cr-name').fill(to); await page.locator('#cr-review').click(); await expect(page.locator('#cr-review-panel')).toBeVisible(); }
async function voices(page, name) { await page.locator('.tools-menu summary').click(); await page.locator('#simulate-table-read').click(); const voice = page.getByLabel(`Voice for ${name}`, { exact: true }); await expect(voice).toBeEnabled(); return voice; }

test('dialogue Tab places the caret inside one parenthetical, keeps lowercase/manual case, enters dialogue, and undoes/redoes naturally', async ({ page }) => {
  await page.goto('/editor.html?sample=1'); await expect(page.locator('#pages')).toContainText('NOAH');
  const initial = await doc(page), speech = initial.elements.find(el => el.type === 'dialogue'); await position(page, speech.id, 3); await page.keyboard.press('Tab');
  let current = await doc(page), par = current.elements[current.elements.findIndex(el => el.id === speech.id) + 1];
  expect(par).toMatchObject({ type: 'parenthetical', text: '()' }); expect(current.elements.find(el => el.id === speech.id)).toEqual(speech);
  expect(await page.evaluate(() => window.scriptForge.getSelection().focus)).toEqual({ id: par.id, offset: 1 });
  const x = await page.locator(`[data-element-id="${par.id}"]`).first().boundingBox(), dialogueX = await page.locator(`[data-element-id="${speech.id}"]`).first().boundingBox(); expect(x.x).toBeGreaterThan(dialogueX.x);
  await page.keyboard.press('ControlOrMeta+z'); expect(await doc(page)).toEqual(initial); await page.keyboard.press('ControlOrMeta+Shift+z');
  await page.keyboard.type('whispering'); expect((await doc(page)).elements.find(el => el.id === par.id).text).toBe('(whispering)');
  await page.keyboard.press('Enter'); const empty = await page.evaluate(() => window.scriptForge.getSelection().focus.id); expect((await doc(page)).elements.find(el => el.id === empty).type).toBe('dialogue');
  await page.keyboard.press('Tab'); expect((await doc(page)).elements.find(el => el.id === empty)).toMatchObject({ type: 'parenthetical', text: '()' }); expect(await page.evaluate(() => window.scriptForge.getSelection().focus.offset)).toBe(1);
  await page.keyboard.type('Softly'); expect((await doc(page)).elements.find(el => el.id === empty).text).toBe('(Softly)');
  await page.locator('[data-format="parenthetical"]').click(); expect((await doc(page)).elements.find(el => el.id === empty).text).toBe('(Softly)');
  await page.keyboard.press('Enter'); await page.keyboard.type("don't move."); const focus = await page.evaluate(() => window.scriptForge.getSelection().focus.id); expect((await doc(page)).elements.find(el => el.id === focus).text).toBe("Don't move.");
});

test('rename preview is nonmutating, mentions can be excluded, one undo/redo restores the whole script, and voice settings follow through reload', async ({ page }) => {
  const id = await openCopy(page); let voice = await voices(page, 'ROSE'); await voice.selectOption({ label: 'Alex · en-US' }); await page.getByLabel('Rate for ROSE', { exact: true }).fill('1.3'); await page.getByLabel('Rate for ROSE', { exact: true }).press('Tab'); await page.locator('#tr-close').click();
  const before = await doc(page); await review(page); expect(await page.locator('#cr-character option').allTextContents()).toEqual(['ROSE', 'ANN']); await expect(page.locator('#cr-counts')).toContainText('Character cues: 2'); expect(await doc(page)).toEqual(before);
  await page.locator('#cr-review-cancel').click(); expect(await doc(page)).toEqual(before);
  await review(page); const matches = page.locator('#cr-matches input'); await expect(matches).toHaveCount(9); await matches.nth(1).uncheck(); await expect(page.locator('#cr-counts')).toContainText('Other mentions: 8 of 9'); await page.screenshot({ path: 'test-results/character-rename-review.png' });
  await page.locator('#cr-confirm').click(); await expect(page.locator('#character-rename-dialog')).not.toBeVisible(); const renamed = await doc(page);
  expect(renamed.elements.map(el => el.id)).toEqual(before.elements.map(el => el.id)); expect(renamed.elements.find(el => el.type === 'action').text).toBe('Lily holds a rose. LILY watches ANNIE.'); expect(renamed.elements.filter(el => el.type === 'character').map(el => el.text)).toEqual(['LILY (V.O.)', 'ANN', "LILY (O.S.) (CONT'D)"]);
  await expect(page.locator('#pages')).toBeFocused(); await page.keyboard.press('ControlOrMeta+z'); expect(await doc(page)).toEqual(before); voice = await voices(page, 'ROSE'); await expect(voice.locator('option:checked')).toHaveText('Alex · en-US'); await page.locator('#tr-close').click();
  await page.keyboard.press('ControlOrMeta+Shift+z'); expect(await doc(page)).toEqual(renamed); voice = await voices(page, 'LILY'); await expect(voice.locator('option:checked')).toHaveText('Alex · en-US'); await expect(page.getByLabel('Rate for LILY', { exact: true })).toHaveValue('1.3'); await page.locator('#tr-close').click();
  await expect.poll(() => page.evaluate(() => window.scriptForge.getFileState().recoveryCurrent)).toBe(true);
  const download = page.waitForEvent('download'); await page.locator('#export').click(); await page.locator('#export-fountain').click(); const file = await download; const exported = await readFile(await file.path(), 'utf8'); expect(exported).toContain('LILY (V.O.)'); expect(exported).toContain('Lily holds a rose.'); expect(exported).not.toContain('ROSE (O.S.)');
  await page.reload(); await page.locator('#recover-changes').click(); expect(await doc(page)).toEqual(renamed); voice = await voices(page, 'LILY'); await expect(voice.locator('option:checked')).toHaveText('Alex · en-US'); await page.locator('#tr-close').click();
  expect((await doc(page)).id).toBe(id);
});

test('rename validates existing names, lets Tab navigate the form, and reports preference failures without changing the screenplay', async ({ page }) => {
  await openCopy(page); const before = await doc(page); await page.locator('.tools-menu summary').click(); await page.locator('#rename-character').click(); await page.locator('#cr-character').focus(); await page.keyboard.press('Tab'); await expect(page.locator('#cr-name')).toBeFocused(); expect(await doc(page)).toEqual(before);
  await page.locator('#cr-name').fill('ANN'); await page.locator('#cr-review').click(); await expect(page.locator('#cr-error')).toContainText('already exists'); expect(await doc(page)).toEqual(before);
  await page.locator('#cr-name').fill('LILY'); await page.locator('#cr-review').click(); await page.evaluate(async () => { const { repository } = await import('/js/storage.js'); window.originalPreferenceWrite = repository.setPreference; repository.setPreference = async () => { throw new Error('Voice settings storage unavailable'); }; });
  await page.locator('#cr-confirm').click(); await expect(page.locator('#cr-error')).toContainText('Rename was not applied'); expect(await doc(page)).toEqual(before); await expect(page.locator('#cr-confirm')).toBeEnabled();
  await page.evaluate(async () => { const { repository } = await import('/js/storage.js'); repository.setPreference = window.originalPreferenceWrite; }); await page.locator('#cr-confirm').click(); await expect(page.locator('#character-rename-dialog')).not.toBeVisible(); expect((await doc(page)).elements.some(el => el.text === 'LILY (V.O.)')).toBe(true);
});

test('a confirmed rename autosaves to the existing linked file and undo autosaves the original names', async ({ page, context, browserName }) => {
  test.skip(browserName === 'webkit', 'WebKit does not expose the native file handles used by this isolated test.');
  await context.addInitScript(source => { window.voiceRenameFile = (async () => { const root = await navigator.storage.getDirectory(), handle = await root.getFileHandle('Rename.fountain', { create: true }); if (!(await handle.getFile()).size) { const writer = await handle.createWritable(); await writer.write(source); await writer.close(); } return handle; })(); window.showOpenFilePicker = async () => [await window.voiceRenameFile]; }, source);
  await page.goto('/'); await page.locator('#open-fountain').click(); await expect(page.locator('#pages')).toContainText('ROSE'); const before = await doc(page);
  await review(page); await page.locator('#cr-confirm').click(); await expect(page.locator('#character-rename-dialog')).not.toBeVisible(); await expect(page.locator('#disk-save-state')).toHaveText('Saved', { timeout: 7000 });
  const read = () => page.evaluate(async () => (await (await window.voiceRenameFile).getFile()).text()); expect(await read()).toContain('LILY (V.O.)'); expect((await doc(page)).id).toBe(before.id);
  await page.keyboard.press('ControlOrMeta+z'); await expect(page.locator('#disk-save-state')).toHaveText('Saved', { timeout: 7000 }); expect(await read()).toContain('ROSE (V.O.)'); expect(await doc(page)).toEqual(before);
});
