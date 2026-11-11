import { test, expect } from '@playwright/test';
test.beforeEach(async ({ context }) => { await context.addInitScript(() => { window.scriptForgeLocalHelperDisabled = true; }); });
test.beforeEach(async ({ page }) => { await page.addInitScript(() => { window.showDirectoryPicker = undefined; }); });

const source = 'Title: Selected Film\n\nINT. STUDIO - DAY\n\nThe selected screenplay appears.\n';

test('a readable picker handle that cannot be cloned still opens the selected Fountain file', async ({ page }) => {
  const errors = []; page.on('pageerror', error => { errors.push(error.message); console.log('Browser error:', error.message); });
  await page.addInitScript(source => {
    // Embedded browsers may return a readable handle that IndexedDB cannot clone.
    window.showOpenFilePicker = async () => [{ name: 'selected.fountain', getFile: async () => new File([source], 'selected.fountain'), isSameEntry: async () => false }];
  }, source);
  await page.goto('/'); await page.locator('#open-fountain').click();
  await expect(page.locator('#pages')).toContainText('The selected screenplay appears.');
  await expect(page.locator('#document-banner')).toContainText('file reference');
  await page.locator('#home').click();
  await expect(page.locator('.card-title')).toHaveText('Selected Film');
  await page.locator('.card-title').click();
  await expect(page.locator('#pages')).toContainText('The selected screenplay appears.');
  expect(errors).toEqual([]);
});

test('three consecutive new screenplays commit unique IDs and appear when returning Home', async ({ page }) => {
  const errors = []; page.on('pageerror', error => { errors.push(error.message); console.log('Browser error:', error.message); });
  await page.goto('/'); const ids = [];
  for (let i = 1; i <= 3; i++) {
    await page.locator('#new-screenplay').click();
    await expect(page.locator('.screenplay-page')).toBeVisible();
    const snapshot = await page.evaluate(async () => {
      const { repository } = await import('/js/storage.js');
      const id = window.scriptForge.getDocument().id;
      const stored = await repository.get(id);
      return { id, storedId: stored?.recovery.document.id, revision: stored?.revision };
    });
    expect(snapshot.storedId).toBe(snapshot.id); expect(snapshot.revision).toBeGreaterThan(0); ids.push(snapshot.id);
    await page.locator('#home').click(); await expect(page.locator('.script-card')).toHaveCount(i);
    await expect(page.locator('#new-screenplay')).toBeEnabled();
  }
  expect(new Set(ids).size).toBe(3); expect(errors).toEqual([]);
});

test('creation recovers after a browser closes its cached IndexedDB connection', async ({ page }) => {
  await page.addInitScript(() => {
    const open = indexedDB.open.bind(indexedDB);
    indexedDB.open = (...args) => {
      const request = open(...args);
      request.addEventListener('success', () => { window.closeRecoveryConnection = () => request.result.close(); });
      return request;
    };
  });
  await page.goto('/'); await expect(page.locator('#empty-state')).toBeVisible();
  await page.evaluate(() => window.closeRecoveryConnection());
  await page.locator('#new-screenplay').click();
  await expect(page.locator('.screenplay-page')).toBeVisible();
  await page.locator('#home').click(); await expect(page.locator('.script-card')).toHaveCount(1);
});

test('permission and storage errors stay visible, leave prior records intact, and allow retry', async ({ page }) => {
  await page.addInitScript(() => {
    window.showOpenFilePicker = async () => { throw new DOMException('File permission denied', 'NotAllowedError'); };
  });
  await page.goto('/'); await page.locator('#new-screenplay').click();
  await expect(page.locator('.screenplay-page')).toBeVisible();
  const id = await page.evaluate(() => window.scriptForge.getDocument().id);
  await page.locator('#home').click();
  await expect(page.locator('.script-card')).toHaveCount(1);
  await page.locator('#open-fountain').click();
  await expect(page.locator('#library-error')).toContainText('File permission denied');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('#library-error')).toContainText('File permission denied');
  await page.evaluate(async () => {
    const { repository } = await import('/js/storage.js');
    const put = repository.put;
    repository.put = async () => { throw new DOMException('Recovery storage is full', 'QuotaExceededError'); };
    window.restoreWrites = () => { repository.put = put; };
  });
  await page.locator('#new-screenplay').click();
  await expect(page.locator('#library-error')).toContainText('Recovery storage is full');
  await expect(page.locator('.script-card')).toHaveCount(1);
  const prior = await page.evaluate(async id => {
    const { repository } = await import('/js/storage.js'); return (await repository.get(id)).id;
  }, id); expect(prior).toBe(id);
  await page.evaluate(() => window.restoreWrites());
  await page.locator('#new-screenplay').click(); await expect(page.locator('.screenplay-page')).toBeVisible();
  await page.locator('#home').click(); await expect(page.locator('.script-card')).toHaveCount(2);
});

test('a restored Home page reenables actions and refreshes the recent list', async ({ page }) => {
  await page.goto('/');
  await page.locator('#new-screenplay').click(); await expect(page.locator('.screenplay-page')).toBeVisible();
  await page.locator('#home').click(); await expect(page.locator('.script-card')).toHaveCount(1);
  await page.evaluate(() => {
    document.getElementById('new-screenplay').disabled = true;
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  });
  await expect(page.locator('#new-screenplay')).toBeEnabled();
  await page.locator('#new-screenplay').click(); await expect(page.locator('.screenplay-page')).toBeVisible();
  await page.locator('#home').click(); await expect(page.locator('.script-card')).toHaveCount(2);
  await page.screenshot({ path: 'test-results/library-multiple-drafts.png', fullPage: true });
});

test('reload and real Back/Forward show all recents after restored search and filters', async ({ page }) => {
  page.on('dialog', dialog => dialog.accept());
  await page.goto('/');
  await page.locator('#new-screenplay').click(); await expect(page.locator('.screenplay-page')).toBeVisible();
  await page.locator('#home').click(); await expect(page.locator('.script-card')).toHaveCount(1);
  await page.locator('#search').fill('does not match');
  await expect(page.locator('.script-card')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.script-card')).toHaveCount(1);
 
  await page.locator('#new-screenplay').click(); await expect(page.locator('.screenplay-page')).toBeVisible();
  await page.goBack();
  await expect(page.locator('.script-card')).toHaveCount(2);
  await expect(page.locator('#search')).toHaveValue('');
  await expect(page.locator('[data-filter]')).toHaveCount(0);
  await page.goForward(); await expect(page.locator('.screenplay-page')).toBeVisible();
  await page.goBack(); await expect(page.locator('.script-card')).toHaveCount(2);
});

test('navigation clears restored filters and reload preserves recents with messaging unavailable', async ({ page }) => {
  await page.addInitScript(() => { window.BroadcastChannel = undefined; });
  await page.goto('/'); await page.locator('#new-screenplay').click();
  await expect(page.locator('.screenplay-page')).toBeVisible(); await page.locator('#home').click();
  await expect(page.locator('.script-card')).toHaveCount(1);
  await page.locator('#search').fill('missing');
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await expect(page.locator('.script-card')).toHaveCount(1);
  await expect(page.locator('#search')).toHaveValue('');
  await expect(page.locator('[data-filter]')).toHaveCount(0);
  await page.reload(); await expect(page.locator('.script-card')).toHaveCount(1);
  await page.screenshot({ path: 'test-results/library-reload-restored.png', fullPage: true });
});

test('Home arrow loads recents when storage reads take longer than the refresh timer', async ({ page }) => {
  await page.goto('/'); await page.locator('#new-screenplay').click();
  await expect(page.locator('.screenplay-page')).toBeVisible();
  await page.evaluate(async () => {
    const { restoreSelection } = await import('/js/selection.js'); const el = window.scriptForge.getDocument().elements.find(el => el.type === 'action');
    restoreSelection(document.getElementById('pages'), { anchor: { id: el.id, offset: 0 }, focus: { id: el.id, offset: 0 } });
  });
  await page.keyboard.type('A draft for navigation.');
  await expect(page.locator('#pages')).toContainText('A draft for navigation.');
  await page.locator('#home').click(); await expect(page.locator('.script-card')).toHaveCount(1);
  await page.locator('.card-title').click(); await page.locator('#recover-changes').click();
  await expect(page.locator('.screenplay-page')).toBeVisible();
  await page.route('**/js/home.js', async route => {
    const response = await route.fetch();
    const script = await response.text();
    await route.fulfill({ response, body: script.replace("const $ =", "const realList = repository.list.bind(repository); repository.list = async () => { const rows = await realList(); await new Promise(resolve => setTimeout(resolve, 3500)); return rows; };\nconst $ =") });
  });
  await page.locator('#home').click();
  await expect(page.locator('.script-card')).toHaveCount(1, { timeout: 10000 });
  await expect(page.locator('.card-title')).toHaveText('Untitled Screenplay');
  await page.screenshot({ path: 'test-results/library-home-arrow.png', fullPage: true });
});

test('Home arrow flushes once and starts no extra writes while the editor is leaving', async ({ page }) => {
  await page.goto('/'); await page.locator('#new-screenplay').click();
  await expect(page.locator('.screenplay-page')).toBeVisible();
  await page.evaluate(async () => {
    const { DocumentSession } = await import('/js/session.js');
    const flush = DocumentSession.prototype.flush;
    sessionStorage.setItem('leaving-flushes', '0');
    DocumentSession.prototype.flush = function (...args) {
      sessionStorage.setItem('leaving-flushes', String(Number(sessionStorage.getItem('leaving-flushes')) + 1));
      return flush.apply(this, args);
    };
  });
  await page.locator('#home').click(); await expect(page.locator('.script-card')).toHaveCount(1);
  expect(await page.evaluate(() => Number(sessionStorage.getItem('leaving-flushes')))).toBe(1);
});

test('ten imports survive saves, Home navigation, same files, large copies and invalid input', async ({page}) => {
  test.setTimeout(180000);
  const errors=[]; page.on('pageerror', error=>errors.push(error.message));
  await page.goto('/');
  const ids=[];
  for(let i=0;i<10;i++) {
    const source=`Title: Stress ${i}\n\n`+Array.from({length:i===5?100:2},(_,n)=>`INT. ROOM ${n} - DAY\n\nImport stability proof. ${'Action. '.repeat(30)}\n\nANN\nHello there.\n`).join('\n');
    const chooserPromise=page.waitForEvent('filechooser');
    await page.locator('#import-copy').click();
    await (await chooserPromise).setFiles({name:i%2?'repeated.fountain':`stress-${i}.fountain`,mimeType:'text/plain',buffer:Buffer.from(source)});
    await expect(page.locator('#pages')).toContainText('Import stability proof.');
    ids.push(await page.evaluate(()=>window.scriptForge.getDocument().id));
    const action=page.locator('[data-type=action]').first();await action.click();await page.keyboard.type(' Edited');
    await page.locator('#home').click();await expect(page.locator('.script-card')).toHaveCount(i+1);
  }
  expect(new Set(ids).size).toBe(10);
  const invalidChooser=page.waitForEvent('filechooser');
  await page.locator('#import-copy').click();
  await (await invalidChooser).setFiles({name:'invalid.fountain',mimeType:'text/plain',buffer:Buffer.from('bad\0binary')});
  await expect(page.locator('#library-error')).toContainText('binary');await expect(page.locator('.script-card')).toHaveCount(10);
  await page.goto(`/editor.html?id=${ids[0]}`);await page.locator('#recover-changes').click();await expect(page.locator('#pages')).toContainText('Edited');
  expect(errors).toEqual([]);
});
