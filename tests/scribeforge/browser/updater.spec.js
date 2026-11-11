import { expect, test } from '@playwright/test';
import { newManuscript } from '../../../js/scribeforge/model.js';

const editor = page => page.getByRole('textbox', { name: 'Manuscript editor' });
const notification = page => page.getByRole('dialog', { name: 'ScribeForge update available' });

async function openDesktop(page) {
  const manuscript = newManuscript('Updater fixture', undefined, 'Original paragraph.');
  await page.addInitScript(record => {
    localStorage.setItem('scribeforge.autosave', 'false');
    const listeners = new Map();
    const fixture = window.updateFixture = {
      calls: [], saveFails: false, downloadFails: false,
      respond: null, current: record.current,
    };
    window.__TAURI__ = {
      event: {
        async listen(name, callback) {
          listeners.set(name, callback);
          return () => listeners.delete(name);
        },
      },
      core: {
        async invoke(command, args) {
          switch (command) {
            case 'associated_manuscripts': return [];
            case 'desktop_update_check':
              fixture.calls.push('check');
              if (sessionStorage.getItem('update-deferred')) return null;
              return new Promise(resolve => { fixture.respond = resolve; });
            case 'desktop_update_dismiss':
              fixture.calls.push('dismiss');
              sessionStorage.setItem('update-deferred', 'true');
              return;
            case 'desktop_update_download':
              fixture.calls.push('download');
              if (fixture.downloadFails) throw new Error('Fixture signature mismatch');
              listeners.get('scribeforge-update-progress')?.({ payload: { downloaded: 50, total: 100 } });
              return new Promise(resolve => { fixture.respond = resolve; });
            case 'desktop_update_install':
              fixture.calls.push('install');
              return;
            case 'manuscripts':
              if (args.action === 'get') return record;
              if (args.action === 'put') {
                fixture.calls.push('save');
                if (fixture.saveFails) throw new Error('Fixture disk unavailable');
                fixture.current = args.body.current;
                return 2;
              }
          }
          throw new Error(`Unexpected command ${command}`);
        },
      },
    };
  }, { id: manuscript.documentId, current: manuscript, revision: 1 });
  await page.goto(`/editor.html?id=${manuscript.documentId}`);
  await expect(editor(page)).toBeEditable();
  await page.waitForFunction(() => window.updateFixture.respond !== null);
}

test('startup leaves the editor usable and Later defers the update without downloading', async ({ page }) => {
  await openDesktop(page);
  await editor(page).fill('Writing while the update check runs.');
  await page.evaluate(() => window.updateFixture.respond({ version: '2.0.0' }));
  await expect(notification(page)).toBeVisible();
  await expect(editor(page)).toBeFocused();
  await notification(page).getByRole('button', { name: 'Later' }).click();
  await expect(notification(page)).toHaveCount(0);
  expect(await page.evaluate(() => window.updateFixture.calls)).toEqual(['check', 'dismiss']);
  await expect(editor(page)).toHaveText('Writing while the update check runs.');
});

test('Update Now reports progress and errors, then saves pending prose before installation', async ({ page }) => {
  await openDesktop(page);
  await editor(page).fill('Save this before restarting.');
  await page.evaluate(() => {
    window.updateFixture.downloadFails = true;
    window.updateFixture.respond({ version: '2.0.0' });
  });
  const update = notification(page);
  await update.getByRole('button', { name: 'Update Now' }).click();
  await expect(update.getByRole('alert')).toContainText('Fixture signature mismatch');
  await page.evaluate(() => Object.assign(window.updateFixture, { downloadFails: false, saveFails: true }));
  await update.getByRole('button', { name: 'Retry Update' }).click();
  await expect(update.getByRole('status')).toHaveText('50% downloaded');
  await page.evaluate(() => window.updateFixture.respond());
  await expect(update.getByRole('alert')).toContainText('Fixture disk unavailable');
  expect(await page.evaluate(() => window.updateFixture.calls)).toEqual(['check', 'download', 'download', 'save']);
  await page.evaluate(() => { window.updateFixture.saveFails = false; });
  await update.getByRole('button', { name: 'Retry Update' }).click();
  await expect(update.getByRole('status')).toHaveText('50% downloaded');
  await page.evaluate(() => window.updateFixture.respond());
  await expect.poll(() => page.evaluate(() => window.updateFixture.calls.slice(-2))).toEqual(['save', 'install']);
  expect(await page.evaluate(() => window.updateFixture.current.content.content[0].content[0].text)).toBe('Save this before restarting.');
});

test('browser mode has no desktop updater', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'YOUR STORIES' })).toBeVisible();
  await expect(page.locator('#desktop-update')).toHaveCount(0);
});
