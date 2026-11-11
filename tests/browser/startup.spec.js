import { test, expect } from '@playwright/test';
test.beforeEach(async ({ context }) => { await context.addInitScript(() => { window.scriptForgeLocalHelperDisabled = true; }); });
test.beforeEach(async ({ page }) => { await page.addInitScript(() => { window.showDirectoryPicker = undefined; }); });

for (const failure of ['constructor', 'send']) {
  test(`sample, editing and Home work when browser messaging fails at ${failure}`, async ({ page }) => {
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(failure => {
      window.BroadcastChannel = class {
        constructor() { if (failure === 'constructor') throw new DOMException('Messaging unavailable', 'SecurityError'); }
        postMessage() { throw new DOMException('Messaging unavailable', 'InvalidStateError'); }
      };
    }, failure);
    await page.goto('/');
    await expect(page.locator('#empty-state')).toBeVisible();
    await page.locator('#sample-script').click();
    await expect(page.locator('#pages')).toContainText('INT. RELAY STATION - NIGHT');
    await expect(page.locator('#scene-count')).toHaveText('2');
    const scene = page.locator('[data-type="scene"]').first();
    await scene.click(); await page.keyboard.press('End'); await page.keyboard.type(' TEST');
    await expect(page.locator('#pages')).toContainText('TEST');
    await page.locator('#home').click();
    await expect(page.locator('.card-title')).toHaveText('The Last Signal');
    await page.locator('.card-title').click(); await page.locator('#recover-changes').click();
    await expect(page.locator('#pages')).toContainText('TEST');
    expect(errors).toEqual([]);
    if (failure === 'constructor') await page.screenshot({ path: 'test-results/editor-startup-restored.png', fullPage: true });
  });
}

test('module loading failure shows an error and Home remains functional', async ({ page }) => {
  await page.route('**/js/editing.js', route => route.abort());
  await page.goto('/editor.html?sample=1');
  await expect(page.locator('.startup-error')).toContainText('ScriptForge could not start');
  await page.locator('#home').click();
  await expect(page.locator('#new-screenplay')).toBeVisible();
  await expect(page.locator('#empty-state')).toBeVisible();
});

test('home actions wait for their handlers when the home module loads slowly',async({page})=>{
 let ready;const gate=new Promise(resolve=>{ready=resolve;});
 await page.route('**/js/home.js',async route=>{await gate;await route.continue();});
 await page.goto('/',{waitUntil:'domcontentloaded'});
 await expect(page.locator('#new-screenplay')).toBeDisabled();await expect(page.locator('#open-fountain')).toBeDisabled();
 ready();await page.locator('#new-screenplay').click();
 await expect(page.locator('.screenplay-page')).toBeVisible();
});
