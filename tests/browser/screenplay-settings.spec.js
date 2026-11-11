import { test, expect } from '@playwright/test';
test.beforeEach(async ({ context }) => { await context.addInitScript(() => { window.scriptForgeLocalHelperDisabled = true; window.showDirectoryPicker = undefined; }); });

test('a new draft has one blank line after Fade In and typing retains its model caret', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('#empty-state')).toBeVisible(); await page.locator('#new-screenplay').click();
  await expect(page.locator('[data-type="transition"]')).toHaveText('FADE IN:');
  const gap = await page.evaluate(() => {
    const a = document.querySelector('[data-type="transition"]').getBoundingClientRect(), b = document.querySelector('[data-type="action"]').getBoundingClientRect();
    const zoom = Number(getComputedStyle(document.getElementById('pages')).getPropertyValue('--page-zoom'));
    return (b.top - a.bottom) / zoom;
  });
  expect(gap).toBeCloseTo(16, 0);
  await page.locator('[data-type="action"]').click(); await page.keyboard.type('A quiet room.');
  await expect(page.locator('[data-type="action"]')).toHaveText('A quiet room.');
  expect(await page.evaluate(() => window.scriptForge.getSelection().focus.offset)).toBe(13);
});

test('per-script settings persist, default unchecked, show numbers without modifying heading text, and support undo', async ({ page }) => {
  await page.goto('/editor.html?sample=1'); await expect(page.locator('#pages')).toContainText('NOAH');
  const before = await page.evaluate(() => window.scriptForge.getDocument());
  await expect(page.locator('[data-type="scene"]').first()).toHaveCSS('font-weight', '400');
  await page.locator('#screenplay-settings').click();
  await expect(page.locator('#bold-scene-headings')).not.toBeChecked(); await expect(page.locator('#scene-numbers')).not.toBeChecked();
  await page.locator('#bold-scene-headings').check(); await page.locator('#scene-numbers').check();
  await expect(page.locator('[data-type="scene"]').first()).toHaveCSS('font-weight', '700');
  await expect(page.locator('[data-scene-number="1"]')).toHaveCount(1); await expect(page.locator('[data-scene-number="2"]')).toHaveCount(1);
  const numbered = await page.evaluate(() => window.scriptForge.getDocument());
  expect(numbered.elements.map(el => [el.id, el.text])).toEqual(before.elements.map(el => [el.id, el.text]));
  await page.locator('#settings-done').click();
  await expect(page.locator('#pages')).toBeFocused();
  await page.keyboard.press('ControlOrMeta+z'); await expect(page.locator('[data-scene-number]')).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+Shift+z'); await expect(page.locator('[data-scene-number]')).toHaveCount(2);
  await expect.poll(() => page.evaluate(() => window.scriptForge.getFileState().recoveryCurrent)).toBe(true);
  await page.locator('#home').click(); await expect(page.locator('.script-card')).toHaveCount(1);
  await page.locator('.card-title').click(); await page.locator('#recover-changes').click();
  await expect(page.locator('[data-type="scene"]').first()).toHaveCSS('font-weight', '700');
  await page.locator('#screenplay-settings').click(); await expect(page.locator('#scene-numbers')).toBeChecked();
  await page.screenshot({ path: 'test-results/screenplay-settings.png' });
  await page.locator('#settings-done').click(); await page.locator('#home').click();
  await expect(page.locator('.script-card')).toHaveCount(1); await page.locator('#new-screenplay').click();
  await expect(page.locator('[data-type="transition"]')).toHaveText('FADE IN:');
  await page.locator('#screenplay-settings').click(); await expect(page.locator('#bold-scene-headings')).not.toBeChecked(); await expect(page.locator('#scene-numbers')).not.toBeChecked();
});

test('Redo Numbers repairs imported numbers, edits keep them sequential, and PDF honors styling and number visibility', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('#empty-state')).toBeVisible();
  const id = await page.evaluate(async () => {
    const { parseFountain } = await import('/js/fountain.js'); const { draftRecord } = await import('/js/session.js'); const { repository } = await import('/js/storage.js');
    return (await repository.put(draftRecord(parseFountain('INT. ROOM - DAY #9#\n\nAn empty room.\n\nEXT. ROAD - DAY #9#\n\nA car waits.')))).id;
  });
  await page.goto(`/editor.html?id=${id}`); await page.locator('#recover-changes').click(); await expect(page.locator('[data-type="scene"]')).toHaveCount(2);
  await page.locator('#screenplay-settings').click(); await page.locator('#redo-scene-numbers').click();
  expect(await page.evaluate(() => window.scriptForge.getDocument().elements.filter(el => el.type === 'scene').map(el => el.sceneNumber))).toEqual(['1', '2']);
  await page.locator('#scene-numbers').check(); await page.locator('#settings-done').click();
  await page.locator('[data-type="action"]').first().click(); await page.locator('[data-format="scene"]').click();
  expect(await page.evaluate(() => window.scriptForge.getDocument().elements.filter(el => el.type === 'scene').map(el => el.sceneNumber))).toEqual(['1', '2', '3']);
  await page.addScriptTag({ url: '/vendor/jspdf.umd.min.js' });
  const results = await page.evaluate(async () => {
    const RealPDF = window.jspdf.jsPDF; let writes = [];
    window.jspdf.jsPDF = function(options) {
      const pdf = new RealPDF(options), original = pdf.text;
      pdf.text = function(text, x, y, ...args) { writes.push({ text, x, y, style: pdf.getFont().fontStyle }); return original.call(pdf, text, x, y, ...args); };
      return pdf;
    };
    const { createScreenplayPDF } = await import('/js/pdf-export.js');
    const doc = window.scriptForge.getDocument(); await createScreenplayPDF(doc); const normal = writes;
    writes = []; doc.settings.boldSceneHeadings = true; doc.settings.sceneNumbers = false; await createScreenplayPDF(doc);
    return { normal, bold: writes };
  });
  expect(results.normal.find(item => item.text === 'INT. ROOM - DAY').style).toBe('normal');
  expect(results.bold.find(item => item.text === 'INT. ROOM - DAY').style).toBe('bold');
  expect(results.normal.filter(item => item.text === '1')).toHaveLength(2);
  expect(results.bold.filter(item => item.text === '1')).toHaveLength(0);
});
