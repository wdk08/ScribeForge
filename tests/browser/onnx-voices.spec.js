import { test, expect } from '@playwright/test';
import { installSpeechMock } from '../fixtures/speech-mock.js';
const modelPath = process.env.SCRIPTFORGE_PIPER_MODEL, configPath = process.env.SCRIPTFORGE_PIPER_CONFIG;
test.beforeEach(async ({ context }) => { await context.addInitScript(() => { window.scriptForgeLocalHelperDisabled = true; window.showDirectoryPicker = undefined; }); });

test('Voice Library rejects unsupported ONNX/config pairs without creating models or affecting the screenplay', async ({ page }) => {
  await page.addInitScript(installSpeechMock); await page.goto('/editor.html?sample=1'); await expect(page.locator('#pages')).toContainText('NOAH');
  const before = await page.evaluate(() => window.scriptForge.getDocument());
  await page.locator('#screenplay-settings').click(); await page.locator('#voice-library').click(); await expect(page.locator('#voice-library-dialog')).toBeVisible();
  await page.locator('#vl-model').setInputFiles({ name: 'not-piper.onnx', mimeType: 'application/octet-stream', buffer: Buffer.from([1, 2, 3]) });
  await page.locator('#vl-config').setInputFiles({ name: 'not-piper.onnx.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ architecture: 'some-other-tts' })) });
  await page.locator('#vl-import').click(); await expect(page.locator('#vl-error')).toContainText('only Piper VITS');
  await expect(page.locator('.vl-card')).toHaveCount(0); await expect(page.locator('#vl-import')).toBeEnabled();
  await page.locator('#vl-close').click(); await expect(page.locator('#voice-library-dialog')).not.toBeVisible(); expect(await page.evaluate(() => window.scriptForge.getDocument())).toEqual(before);
});

test('real imported Piper voice persists, previews, and shares a table read with browser voices including pause/resume and cancellation', async ({ page }) => {
  test.skip(!modelPath || !configPath, 'Set SCRIPTFORGE_PIPER_MODEL and SCRIPTFORGE_PIPER_CONFIG to test a real imported voice.'); test.setTimeout(180000);
  const external = []; page.on('request', request => { if (/^https?:/.test(request.url()) && !new URL(request.url()).hostname.match(/^(localhost|127\.0\.0\.1)$/)) external.push(request.url()); });
  const errors = []; page.on('pageerror', error => errors.push(error.message)); await page.addInitScript(installSpeechMock);
  await page.goto('/'); await expect(page.locator('#empty-state')).toBeVisible(); await page.locator('#voice-library').click();
  await page.locator('#vl-model').setInputFiles(modelPath); await page.locator('#vl-config').setInputFiles(configPath); await page.locator('#vl-name').fill('Reference Piper'); await page.locator('#vl-text').fill('Hello from ScriptForge.');
  await page.locator('#vl-import').click(); await page.waitForFunction(() => document.querySelector('#vl-status').textContent.includes('is stored and ready') || !document.querySelector('#vl-error').hidden, null, { timeout: 120000 }); expect(await page.locator('#vl-error').textContent()).toBe(''); await expect(page.locator('#vl-status')).toContainText('is stored and ready'); await expect(page.locator('.vl-card')).toHaveCount(1);
  await expect.poll(() => page.locator('#vl-audio').evaluate(audio => Number.isFinite(audio.duration) && audio.duration > .1)).toBe(true);
  await page.locator('#vl-close').click(); await expect(page.locator('#voice-library-dialog')).not.toBeVisible();
  await page.reload(); await page.locator('#voice-library').click(); await expect(page.locator('.vl-card')).toHaveCount(1);
  await page.locator('#vl-text').fill('This voice survived reopening.'); await page.getByLabel('Preview imported Reference Piper', { exact: true }).click(); await expect(page.locator('#vl-status')).toHaveText('Preview finished.', { timeout: 30000 });
  await page.screenshot({ path: 'test-results/voice-library-real.png' });
  await page.locator('#vl-close').click(); await expect(page.locator('#voice-library-dialog')).not.toBeVisible();
  const id = await page.evaluate(async () => {
    const { createDocument, createElement: el } = await import('/js/document.js'), { draftRecord } = await import('/js/session.js'), { repository } = await import('/js/storage.js');
    return (await repository.put(draftRecord(createDocument({ title: 'Mixed Voice Read', elements: [el('scene', 'INT. ROOM - DAY'), el('action', 'The read begins.'), el('character', 'NOAH'), el('dialogue', 'Hello from the imported voice.'), el('character', 'AVA'), el('dialogue', 'The browser voice returns.')] })))).id;
  });
  await page.goto(`/editor.html?id=${id}`); await page.locator('#recover-changes').click(); await expect(page.locator('#pages')).toContainText('NOAH');
  const before = await page.evaluate(() => window.scriptForge.getDocument());
  await page.locator('.tools-menu summary').click(); await page.locator('#simulate-table-read').click(); await expect(page.getByLabel('Voice for NOAH', { exact: true }).locator('option').filter({ hasText: 'Reference Piper' })).toHaveCount(1);
  await page.getByLabel('Voice for NOAH', { exact: true }).selectOption({ label: 'Reference Piper (Piper) · en-US' });
  await page.locator('#tr-play').click(); expect(await page.evaluate(() => window.speechMock.active?.text)).toBe('The read begins.');
  await page.evaluate(() => window.speechMock.finish()); await expect(page.locator('#tr-engine-activity')).toContainText('Generating Reference Piper');
  await page.locator('#tr-pause').click(); await expect(page.locator('#tr-state')).toHaveText('paused');
  await expect(page.locator('#tr-engine-activity')).toHaveText('', { timeout: 30000 }); await expect(page.locator('#tr-state')).toHaveText('paused');
  expect(await page.evaluate(() => window.speechMock.active)).toBe(null); await page.locator('#tr-play').click();
  await expect.poll(() => page.evaluate(() => window.speechMock.active?.text), { timeout: 30000 }).toBe('The browser voice returns.');
  expect(await page.evaluate(() => window.speechMock.history.map(utterance => utterance.text))).toEqual(['The read begins.', 'The browser voice returns.']);
  await page.evaluate(() => window.speechMock.finish()); await expect(page.locator('#tr-state')).toHaveText('completed');
  const localParagraph = page.locator('#tr-script').getByRole('button', { name: 'Hello from the imported voice.', exact: true });
  await localParagraph.click(); await page.locator('#tr-read-here').click(); await page.locator('#tr-stop').click(); await expect(page.locator('#tr-state')).toHaveText('stopped'); await expect(page.locator('#tr-engine-activity')).toHaveText('');
  await page.locator('#tr-read-here').click(); await expect(page.locator('#tr-engine-activity')).toContainText('Generating');
  await page.locator('#tr-next').click(); expect(await page.evaluate(() => window.speechMock.active?.text)).toBe('The browser voice returns.');
  await page.locator('#tr-close').click(); await expect(page.locator('#table-read-dialog')).not.toBeVisible(); expect(await page.evaluate(() => window.scriptForge.getDocument())).toEqual(before);
  await page.locator('.tools-menu summary').click(); await page.locator('#simulate-table-read').click(); await expect(page.getByLabel('Voice for NOAH', { exact: true })).toHaveValue(/^piper:/);
  await page.locator('#tr-voice-library').click(); await expect(page.locator('#voice-library-dialog')).toBeVisible(); await expect(page.locator('.vl-card')).toHaveCount(1); await page.locator('#vl-close').click(); await expect(page.locator('#table-read-dialog')).toBeVisible();
  expect(external).toEqual([]); expect(errors).toEqual([]);
});

test('invalid model graphs fail the real inference check and are not stored', async ({ page }) => {
  test.skip(!configPath, 'Uses a real Piper configuration with deliberately invalid model bytes.'); test.setTimeout(60000);
  await page.goto('/'); await page.locator('#voice-library').click();
  await page.locator('#vl-model').setInputFiles({ name: 'broken.onnx', mimeType: 'application/octet-stream', buffer: Buffer.from([1, 2, 3, 4]) });
  await page.locator('#vl-config').setInputFiles(configPath); await page.locator('#vl-import').click();
  await expect(page.locator('#vl-error')).toContainText('Piper synthesis failed', { timeout: 30000 }); await expect(page.locator('.vl-card')).toHaveCount(0);
});
