import { expect, test } from '@playwright/test';
import { newManuscript } from '../../../js/scribeforge/model.js';
import { releaseAPI, releasePage } from '../../../js/scribeforge/browser-download.js';

test('the Pages build loads from /ScribeForge/, shows Download and reopens an offline manuscript', async ({ page, context }) => {
  const failures = [];
  page.on('pageerror', error => failures.push(error.message));
  await page.route(releaseAPI, route => route.fulfill({ status: 404, headers: { 'Access-Control-Allow-Origin': '*' } }));
  const oldManuscript = newManuscript('Previous Pages manuscript', undefined, 'A manuscript saved before the rename.');
  await page.route('**/ScribeForge/migration-fixture', route => route.fulfill({ body: '<title>Migration fixture</title>', contentType: 'text/html' }));
  await page.goto('./migration-fixture');
  await page.evaluate(async manuscript => {
    localStorage.setItem('storyforge-theme', 'dark');
    localStorage.setItem('storyforge.autosave', 'false');
    localStorage.setItem('scribeforge.autosave', 'true');
    await new Promise((resolve, reject) => {
      const request = indexedDB.open('com.storyforge.desktop.manuscripts', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('manuscripts', { keyPath: 'id' });
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('manuscripts', 'readwrite');
        tx.objectStore('manuscripts').put({ id: manuscript.documentId, current: manuscript, revision: 1, updated: Date.now() });
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onabort = () => reject(tx.error);
      };
      request.onerror = () => reject(request.error);
    });
  }, oldManuscript);
  await page.goto('./');
  await page.getByRole('button', { name: 'Previous Pages manuscript', exact: true }).click();
  await expect(page.locator('.ProseMirror')).toHaveText('A manuscript saved before the rename.');
  await page.getByRole('link', { name: 'Home' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate(() => localStorage.getItem('scribeforge.autosave'))).toBe('true');
  await expect(page).toHaveTitle(/ScribeForge/);
  await expect(page.locator('.brand-logo')).toHaveJSProperty('complete', true);
  expect(await page.locator('.brand-logo').evaluate(image => image.naturalWidth)).toBeGreaterThan(0);
  await page.locator('.browser-download summary').click();
  await expect(page.getByRole('link', { name: 'View ScribeForge releases' })).toHaveAttribute('href', releasePage);
  await page.locator('.browser-download summary').click();
  await expect(page.locator('.library-header .local-label, .library-intro .eyebrow, .library-intro p')).toHaveCount(0);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => null));
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await page.locator('#new-manuscript').click();
  await expect(page).toHaveURL(/\/ScribeForge\/editor\.html\?id=/);
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeEditable();
  await editor.fill('A ScribeForge production proof 🪶');
  await expect(page.locator('#save-state')).toHaveText('Saved locally');
  await context.setOffline(true);
  await page.reload();
  await expect(editor).toHaveText('A ScribeForge production proof 🪶');
  await expect(page.locator('.browser-download summary')).toHaveText('Download');
  expect(await page.evaluate(async () => (await indexedDB.databases()).map(db => db.name))).toContain('com.scribeforge.desktop.manuscripts');
  expect(failures).toEqual([]);
});
