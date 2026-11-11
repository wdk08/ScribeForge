import { test, expect } from '@playwright/test';
import { installSpeechMock } from '../fixtures/speech-mock.js';
test.beforeEach(async ({ context }) => { await context.addInitScript(() => { window.scriptForgeLocalHelperDisabled = true; window.showDirectoryPicker = undefined; }); });
async function open(page) {
  await page.addInitScript(installSpeechMock); await page.goto('/');
  const id = await page.evaluate(async () => {
    const { createDocument, createElement: el } = await import('/js/document.js'), { draftRecord } = await import('/js/session.js'), { repository } = await import('/js/storage.js');
    const elements = ['INT. HOSPITAL ROOM - DAY', 'INT. HOSPITAL HALLWAY - NIGHT', 'INT. HOSPITAL ROOM - NIGHT', 'EXT. HOSPITAL ENTRANCE - DAY', "INT. MOTHER-IN-LAW'S HOUSE - DAY", 'INT./EXT. CAR - DAY', 'I/E. BOAT - DAY'].flatMap(text => [el('scene', text), el('action', 'A quiet moment.')]); elements.push(el('character', 'NOAH'), el('dialogue', 'Hello.'), el('action', ''));
    return (await repository.put(draftRecord(createDocument({ elements })))).id;
  });
  await page.goto(`/editor.html?id=${id}`); await page.locator('#recover-changes').click(); await expect(page.locator('#pages')).toContainText('NOAH');
}
const doc = page => page.evaluate(() => window.scriptForge.getDocument());
async function position(page, id, offset, end = offset) { await page.evaluate(async ({ id, offset, end }) => { const { restoreSelection } = await import('/js/selection.js'); restoreSelection(document.getElementById('pages'), { anchor: { id, offset }, focus: { id, offset: end } }, { scroll: true }); }, { id, offset, end }); }
async function startHeading(page, text = 'int. hosp') { const last = (await doc(page)).elements.at(-1); await position(page, last.id, 0); await page.keyboard.type(text); await expect(page.locator('#scene-autocomplete')).toBeVisible(); return last.id; }

test('File and Tools share dropdown behavior and keyboard navigation, and launch existing tools without duplicates', async ({ page }) => {
  await open(page); const file = page.locator('.file-menu'), tools = page.locator('.tools-menu'); const before = await doc(page);
  await tools.locator('summary').click(); await expect(tools).toHaveAttribute('open', ''); await tools.locator('summary').click(); await expect(tools).not.toHaveAttribute('open', '');
  await file.locator('summary').click(); await tools.locator('summary').click(); await expect(file).not.toHaveAttribute('open', ''); await expect(tools).toHaveAttribute('open', '');
  await file.locator('summary').click(); await expect(tools).not.toHaveAttribute('open', ''); await page.keyboard.press('Escape'); await expect(file).not.toHaveAttribute('open', '');
  await tools.locator('summary').focus(); await page.keyboard.press('ArrowDown'); await expect(page.locator('#simulate-table-read')).toBeFocused(); await page.keyboard.press('ArrowDown'); await expect(page.locator('#rename-character')).toBeFocused(); await page.keyboard.press('Enter'); await expect(page.locator('#character-rename-dialog')).toBeVisible(); await page.locator('#cr-cancel').click();
  await tools.locator('summary').click(); await page.locator('#simulate-table-read').click(); await expect(page.locator('#table-read-dialog')).toBeVisible(); await expect(tools).not.toHaveAttribute('open', ''); await page.locator('#tr-close').click();
  await tools.locator('summary').click(); await page.locator('#document-title').click(); await expect(tools).not.toHaveAttribute('open', ''); expect(await doc(page)).toEqual(before);
  expect(await page.locator('#simulate-table-read').count()).toBe(1); expect(await page.locator('#rename-character').count()).toBe(1);
});
test('Settings hosts the same Voice Library and folder controls, retains preferences, and voice renaming preserves model bytes and IDs', async ({ page }) => {
  await open(page); const before = await doc(page);
  await page.evaluate(async () => {
    const { repository } = await import('/js/storage.js'), { voiceStore } = await import('/js/voice-storage.js');
    await repository.setPreference('screenplayFolder', { kind: 'directory', name: 'Existing ScriptForge Folder' });
    await voiceStore().add({ id: 'settings-test', fingerprint: 'settings-test-fingerprint', modelHash: 'unchanged', model: new Blob([new Uint8Array([1, 2, 3])]), config: { num_speakers: 1, espeak: { voice: 'en-us' } }, name: 'Existing Voice', size: 3 });
  });
  await page.locator('#screenplay-settings').click(); await expect(page.locator('#settings-folder-name')).toHaveText('Existing ScriptForge Folder'); await expect(page.locator('.editing-bar #voice-library')).toHaveCount(0); await expect(page.locator('.editing-bar #screenplay-folder')).toHaveCount(0);
  await page.locator('#screenplay-folder').click(); await expect(page.locator('#folder-dialog')).toBeVisible(); await page.locator('#folder-close').click(); await expect(page.locator('#screenplay-settings-dialog')).toBeVisible();
  await page.locator('#voice-library').click(); await expect(page.locator('#voice-library-dialog')).toBeVisible(); await expect(page.locator('.vl-card h3')).toHaveText('Existing Voice');
  await page.getByLabel('Rename imported Existing Voice', { exact: true }).click(); await page.getByLabel('New voice name for Existing Voice', { exact: true }).fill('Renamed Voice'); await page.getByRole('button', { name: 'Save name', exact: true }).click(); await expect(page.locator('.vl-card h3')).toHaveText('Renamed Voice'); await page.locator('#vl-close').click(); await expect(page.locator('#voice-library')).toBeFocused();
  await page.locator('#settings-done').click(); await page.locator('#screenplay-settings').click(); await expect(page.locator('#settings-folder-name')).toHaveText('Existing ScriptForge Folder'); await page.locator('#settings-done').click();
  const saved = await page.evaluate(async () => { const { repository } = await import('/js/storage.js'), { voiceStore } = await import('/js/voice-storage.js'); const record = await voiceStore().get('settings-test'); return { folder: await repository.getPreference('screenplayFolder'), voice: { id: record.id, fingerprint: record.fingerprint, bytes: [...new Uint8Array(await record.model.arrayBuffer())], name: record.name } }; });
  expect(saved.folder.name).toBe('Existing ScriptForge Folder'); expect(saved.voice).toEqual({ id: 'settings-test', fingerprint: 'settings-test-fingerprint', bytes: [1, 2, 3], name: 'Renamed Voice' }); expect(await doc(page)).toEqual(before);
});
for (const accept of ['mouse', 'Enter', 'Tab']) test(`scene autocomplete accepts with ${accept}, keeps one separator and caret, and undoes/redoes as one edit`, async ({ page }) => {
  await open(page); const id = await startHeading(page); const popup = page.locator('#scene-autocomplete'); await expect(popup.getByRole('option')).toHaveCount(2); await expect(popup.getByRole('option').first()).toHaveText('INT. HOSPITAL ROOM'); await expect(popup.getByRole('option').first().locator('mark')).toHaveText('INT. HOSP'); expect(await page.evaluate(() => window.scriptForge.getSelection().focus.id)).toBe(id);
  const before = await doc(page);
  if (accept === 'mouse') await popup.getByRole('option').first().click(); else { await page.keyboard.press('ArrowDown'); await page.keyboard.press(accept); }
  await expect(popup).toBeHidden(); const completed = await doc(page); expect(completed.elements.at(-1)).toMatchObject({ id, type: 'scene', text: 'INT. HOSPITAL ROOM - ' }); expect(completed.elements.length).toBe(before.elements.length); expect(await page.evaluate(() => window.scriptForge.getSelection().focus)).toEqual({ id, offset: 'INT. HOSPITAL ROOM - '.length });
  await page.keyboard.press('ControlOrMeta+z'); expect(await doc(page)).toEqual(before); await page.keyboard.press('ControlOrMeta+Shift+z'); expect(await doc(page)).toEqual(completed); await page.keyboard.type('NIGHT'); expect((await doc(page)).elements.at(-1).text).toBe('INT. HOSPITAL ROOM - NIGHT');
});
test('typing filters and Escape dismisses without stealing normal Enter/Tab; existing time and trailing separators are preserved', async ({ page }) => {
  await open(page); const id = await startHeading(page, 'INT. H'); const popup = page.locator('#scene-autocomplete'); await expect(popup.getByRole('option')).toHaveCount(2); await page.keyboard.type('OSPITAL R'); await expect(popup.getByRole('option')).toHaveCount(1); await page.keyboard.press('Escape'); await expect(popup).toBeHidden(); await page.keyboard.press('Enter'); expect((await doc(page)).elements.at(-1).type).toBe('action');
  const speech = (await doc(page)).elements.find(el => el.type === 'dialogue'); await position(page, speech.id, 1); await page.keyboard.press('Tab'); const parId = await page.evaluate(() => window.scriptForge.getSelection().focus.id); expect((await doc(page)).elements.find(el => el.id === parId)).toMatchObject({ type: 'parenthetical', text: '()' });
  await position(page, id, 0, (await doc(page)).elements.find(el => el.id === id).text.length); await page.keyboard.type('INT. HOSP - NIGHT'); await expect(popup).toBeHidden(); await position(page, id, 9); await page.keyboard.press('Backspace'); await page.keyboard.type('P'); await expect(popup).toBeVisible(); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter'); expect((await doc(page)).elements.find(el => el.id === id).text).toBe('INT. HOSPITAL ROOM - NIGHT');
  await position(page, id, 0, (await doc(page)).elements.find(el => el.id === id).text.length); await page.keyboard.type('INT. HOSP - '); await expect(popup).toBeVisible(); await popup.getByRole('option').first().click(); expect((await doc(page)).elements.find(el => el.id === id).text).toBe('INT. HOSPITAL ROOM - ');
});
test('unhighlighted suggestions do not consume Enter, remain bounded on mobile, and locations update after model edits', async ({ page }) => {
  await open(page); const id = await startHeading(page, 'INT.'); const popup = page.locator('#scene-autocomplete'); await expect(page.locator('#pages')).not.toHaveAttribute('aria-activedescendant'); await page.keyboard.press('Enter'); expect((await doc(page)).elements.at(-1).type).toBe('action'); await expect(popup).toBeHidden();
  const old = (await doc(page)).elements.find(el => el.type === 'scene'); await position(page, old.id, 0, old.text.length); await page.keyboard.type('INT. SHERIFF OFFICE - NIGHT'); await page.keyboard.press('Enter'); const next = await page.evaluate(() => window.scriptForge.getSelection().focus.id); await page.keyboard.type('INT. SHER'); await expect(popup.getByRole('option')).toHaveText('INT. SHERIFF OFFICE');
  await page.setViewportSize({ width: 390, height: 780 }); await page.locator('#outline-toggle').click(); await position(page, next, 'INT. SHER'.length); await page.keyboard.type('I'); const bounds = await popup.boundingBox(); expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(390); expect(bounds.y + bounds.height).toBeLessThanOrEqual(780); await page.screenshot({ path: 'test-results/scene-autocomplete-mobile.png' });
});

for(const accept of ['mouse','Enter'])test(`lowercase saved/imported locations display and insert uppercase with ${accept}`,async({page})=>{
 await page.goto('/');const id=await page.evaluate(async()=>{
  const {parseFountain}=await import('/js/fountain.js'),{draftRecord}=await import('/js/session.js'),{repository}=await import('/js/storage.js'),{createElement}=await import('/js/document.js');
  const doc=parseFountain('.int. callahan house - day\n\nA quiet room.\n\n.INT. Callahan HOUSE - NIGHT\n\nAnother room.\n\n.int. callahan hospital - night\n\nA hallway.');doc.elements.push(createElement('action',''));const r=draftRecord(doc);r.recovery.dirty=false;await repository.put(r);return r.id;
 });
 await page.goto(`/editor.html?id=${id}`);await expect(page.locator('#pages')).toHaveAttribute('contenteditable','true');
 const target=(await doc(page)).elements.at(-1);await position(page,target.id,0);await page.keyboard.type('int. cal');
 const options=page.locator('#scene-autocomplete').getByRole('option');await expect(options).toHaveText(['INT. CALLAHAN HOUSE','INT. CALLAHAN HOSPITAL']);
 if(accept==='mouse')await options.first().click();else{await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');}
 expect((await doc(page)).elements.at(-1).text).toBe('INT. CALLAHAN HOUSE - ');
 await page.locator('#home').click();await page.locator('.card-title').click();await page.locator('#recover-changes').click();await expect(page.locator('#pages')).toHaveAttribute('contenteditable','true');
 const scene=(await doc(page)).elements.at(-1);await position(page,scene.id,0,scene.text.length);await page.keyboard.type('iNt. ca');await expect(options).toHaveText(['INT. CALLAHAN HOUSE','INT. CALLAHAN HOSPITAL']);
});
