import { expect, test } from '@playwright/test';
import { releaseAPI, releasePage } from '../../../js/scribeforge/browser-download.js';

const menu = page => page.locator('.browser-download');
const download = page => menu(page).locator('summary');
const tag = 'v1.0.0-scribeforge';

test('browser download discovers ScribeForge installers and keeps the release fallback', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'userAgentData', {
    value: { platform: 'Windows', getHighEntropyValues: async () => ({ architecture: 'x86' }) },
  }));
  const names = ['ScribeForge_test_aarch64.dmg', 'ScribeForge_test_x64.dmg', 'ScribeForge_test_x64-setup.exe'];
  await page.route(releaseAPI, route => route.fulfill({ json: {
    tag_name: tag,
    assets: names.map(name => ({
      name, size: 1024, state: 'uploaded',
      browser_download_url: `https://github.com/wdk08/ScribeForge/releases/download/${tag}/${name}`,
    })),
  }, headers: { 'Access-Control-Allow-Origin': '*' } }));
  await page.goto('/');
  await expect(download(page)).toHaveText('Download');
  await download(page).click();
  await expect(menu(page).getByRole('link').first()).toHaveText('Windows — x64');
  await expect(menu(page).getByRole('link', { name: 'macOS — Intel' })).toHaveAttribute('href', /wdk08\/ScribeForge\/releases\/download/);
  await expect(menu(page).getByRole('link', { name: 'macOS — Apple Silicon' })).toBeVisible();
  await expect(menu(page).getByRole('link', { name: 'View ScribeForge releases' })).toHaveAttribute('href', releasePage);
});

test('download keeps a fallback when release assets are unavailable', async ({ page }) => {
  await page.route(releaseAPI, route => route.fulfill({ status: 404, headers: { 'Access-Control-Allow-Origin': '*' } }));
  await page.goto('/');
  await download(page).click();
  await expect(menu(page).getByRole('status')).toContainText('currently unavailable');
  await expect(menu(page).getByRole('link', { name: 'View ScribeForge releases' })).toHaveAttribute('href', releasePage);
});

test('desktop webview mode omits browser download and keeps the cleaned header', async ({ page }) => {
  await page.addInitScript(() => {
    window.__TAURI__ = {
      core: { invoke: async command => command === 'manuscripts' || command === 'associated_manuscripts' ? [] : null },
      event: { listen: async () => () => {} },
    };
  });
  await page.goto('/');
  await expect(page.locator('#new-manuscript')).toBeEnabled();
  await expect(menu(page)).toHaveCount(0);
  await expect(page.locator('.library-header .local-label, .library-intro .eyebrow, .library-intro p')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText(/Fountain files are your documents|Browser snapshots are your safety net/);
});
