import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => { window.scriptForgeLocalHelperDisabled = true; window.showDirectoryPicker = undefined; });
});

test('card menu exports recovery edits, confirms deletion, persists removal and offers undo', async ({ page }) => {
  await page.goto('/'); await page.locator('#new-screenplay').click();
  await expect(page.locator('#pages')).toBeVisible();
  await page.locator('[data-format="action"]').click(); await page.keyboard.type('This latest draft can be exported.');
  await page.locator('#home').click(); await expect(page.locator('.script-card')).toHaveCount(1);
  await page.getByLabel('Options for Untitled Screenplay').click();
  await page.screenshot({ path: 'test-results/library-card-menu.png', fullPage: true });
  const download = page.waitForEvent('download'); await page.locator('.card-menu-options').getByRole('button', { name: 'Export as Fountain', exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('Untitled Screenplay.fountain');
  expect(await readFile(await file.path(), 'utf8')).toContain('This latest draft can be exported.');
  await expect(page).toHaveURL(/index.html$/);
  await page.getByLabel('Options for Untitled Screenplay').click(); await page.locator('.delete-script').click();
  await expect(page.locator('#delete-script-dialog')).toContainText('file on your computer stays intact');
  await page.locator('#cancel-delete-script').click(); await expect(page.locator('.script-card')).toHaveCount(1);
  await page.getByLabel('Options for Untitled Screenplay').click(); await page.locator('.delete-script').click(); await page.locator('#confirm-delete-script').click();
  await expect(page.locator('.script-card')).toHaveCount(0); await page.locator('#undo-delete-script').click();
  await expect(page.locator('.script-card')).toHaveCount(1);
  await page.getByLabel('Options for Untitled Screenplay').focus(); await page.keyboard.press('Enter'); await expect(page.locator('.card-menu')).toHaveAttribute('open', '');
  await page.keyboard.press('Escape'); await expect(page.locator('.card-menu')).not.toHaveAttribute('open', '');
  await page.getByLabel('Options for Untitled Screenplay').click(); await page.locator('.delete-script').click(); await page.locator('#confirm-delete-script').click();
  await expect(page.locator('.script-card')).toHaveCount(0); await page.reload(); await expect(page.locator('.script-card')).toHaveCount(0);
});
