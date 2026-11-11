import { test, expect } from '@playwright/test';
test.beforeEach(async ({ context }) => { await context.addInitScript(() => { window.scriptForgeLocalHelperDisabled = true; }); });

test('common transitions capitalize and align; Fade In stays left in editor and measurement', async ({ page }) => {
  await page.goto('/editor.html?new=1');
  await expect(page.locator('.screenplay-page')).toBeVisible();
  await page.locator('[data-format="action"]').click();
  const transitions = ['Fade In:', 'Cut To:', 'Dissolve to:', 'Fade to Black.', 'Fade out.'];
  for (const text of transitions) {
    await page.keyboard.type(text);
    const element = page.locator('[data-type="transition"]').last();
    await expect(element).toHaveText(text.toUpperCase());
    const alignment = await element.evaluate(el => getComputedStyle(el).textAlign);
    expect(alignment).toBe(text === 'Fade In:' ? 'left' : 'right');
    expect(await page.evaluate(() => window.scriptForge.getSelection().focus.offset)).toBe(text.length);
    await page.keyboard.press('Enter');
  }
  await page.screenshot({ path: `test-results/transitions-${test.info().project.name || test.info().project.use.browserName || 'chrome'}.png`, fullPage: true });
  expect(await page.evaluate(() => window.scriptForge.getPages().every(page => page.used <= 864))).toBe(true);
});
