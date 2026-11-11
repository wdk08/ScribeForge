import { test, expect } from '@playwright/test';

test.beforeEach(async ({ context }) => { await context.addInitScript(() => { window.scriptForgeLocalHelperDisabled = true; window.showDirectoryPicker = undefined; }); });
async function position(page, text, offset = 0) {
  await page.evaluate(async ({ text, offset }) => {
    const doc = window.scriptForge.getDocument(), el = doc.elements.find(el => el.text === text);
    const { restoreSelection } = await import('/js/selection.js');
    restoreSelection(document.getElementById('pages'), { anchor: { id: el.id, offset }, focus: { id: el.id, offset } }, { scroll: true });
  }, { text, offset });
}
async function paste(page, text) {
  await page.locator('#pages').evaluate((root, text) => {
    const clipboardData = new DataTransfer(); clipboardData.setData('text/plain', text);
    root.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
  }, text);
}
test('title sheet is separate, editable, canonical, keyboard accessible and undoable without moving field focus', async ({ page }) => {
  await page.goto('/editor.html?sample=1'); await expect(page.locator('#pages')).toContainText('NOAH');
  await expect(page.locator('#title-page')).toBeVisible();
  await expect(page.locator('#title-page .page-number')).toHaveCount(0);
  await expect(page.locator('.screenplay-page .page-number').first()).toHaveText('1.');
  const bodyPages = await page.locator('.screenplay-page').count();
  const field = page.getByRole('textbox', { name: 'Title page title', exact: true });
  await field.fill('The Signal Returns');
  await expect(page.locator('#document-title')).toHaveValue('The Signal Returns');
  expect(await page.evaluate(() => window.scriptForge.getDocument().title)).toBe('The Signal Returns');
  await expect(field).toHaveCSS('text-transform', 'uppercase');
  await page.keyboard.press('Tab'); await expect(page.getByRole('textbox', { name: 'Writing credit', exact: true })).toBeFocused();
  await page.keyboard.press('Tab'); await expect(page.getByRole('textbox', { name: 'Author name', exact: true })).toBeFocused();
  await page.keyboard.type('Jane Writer');
  await expect(page.getByRole('textbox', { name: 'Author name', exact: true })).toHaveValue('Jane Writer');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.getByRole('textbox', { name: 'Author name', exact: true })).toHaveValue('');
  await expect(page.getByRole('textbox', { name: 'Author name', exact: true })).toBeFocused();
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(page.getByRole('textbox', { name: 'Author name', exact: true })).toHaveValue('Jane Writer');
  await page.locator('#document-title').fill('A Mixed Case Title'); await expect(field).toHaveValue('A Mixed Case Title');
  expect(await page.locator('.screenplay-page').count()).toBe(bodyPages);
  await page.getByRole('textbox', { name: 'Mailing address', exact: true }).fill('123 Example Street\nExample City, SC 29301');
  await page.getByRole('textbox', { name: 'Phone number', exact: true }).click();
  await page.keyboard.type('(864) 555-0123');
  await expect(page.getByRole('textbox', { name: 'Phone number', exact: true })).toHaveValue('(864) 555-0123');
  await page.getByRole('textbox', { name: 'Email address', exact: true }).click();
  await page.keyboard.type('writer@example.com');
  await expect(page.getByRole('textbox', { name: 'Email address', exact: true })).toHaveValue('writer@example.com');
  await expect(page.getByRole('textbox', { name: 'Mailing address', exact: true })).toHaveValue('123 Example Street\nExample City, SC 29301');
  await expect.poll(() => page.evaluate(() => window.scriptForge.getFileState().recoveryCurrent)).toBe(true);
  const source = await page.evaluate(async () => (await import('/js/session.js')).fountainForSaving(window.scriptForge.getDocument()));
  expect(source).toContain('Title:\n    A Mixed Case Title'); expect(source).toContain('Author:\n    Jane Writer'); expect(source).toContain('writer@example.com');
  await page.evaluate(() => { document.querySelector('.document-viewport').scrollTop = 0; });
  await page.screenshot({ path: 'test-results/title-page-editor.png' });
});
test('writer profile persists and only supplies new screenplay defaults, including after navigation', async ({ page }) => {
  await page.goto('/editor.html?sample=1'); await expect(page.locator('#pages')).toContainText('NOAH');
  await page.locator('#screenplay-settings').click(); await expect(page.locator('#writer-author')).toHaveValue('');
  await page.locator('#writer-author').fill('Writer One'); await page.locator('#writer-address').fill('123 Main St\nCity, SC 12345');
  await page.locator('#writer-phone').fill('555-123-4567'); await page.locator('#writer-email').fill('one@example.com');
  await page.locator('#save-writer-profile').click(); await expect(page.locator('#writer-profile-status')).toContainText('saved');
  await page.locator('#settings-done').click();
  await expect(page.locator('[data-title-field="author"]')).toHaveValue('');
  await page.locator('#home').click(); await expect(page.locator('.script-card')).toHaveCount(1); await page.locator('#new-screenplay').click();
  await expect(page.locator('[data-title-field="author"]')).toHaveValue('Writer One');
  await expect(page.locator('[data-title-field="address"]')).toHaveValue('123 Main St\nCity, SC 12345');
  await page.locator('#screenplay-settings').click(); await expect(page.locator('#writer-author')).toHaveValue('Writer One');
  await page.locator('#writer-author').fill('Writer Two'); await page.locator('#save-writer-profile').click();
  await expect(page.locator('#writer-profile-status')).toContainText('saved'); await page.locator('#settings-done').click();
  await expect(page.locator('[data-title-field="author"]')).toHaveValue('Writer One');
  await page.locator('#home').click(); await expect(page.locator('.script-card')).toHaveCount(2); await page.locator('#new-screenplay').click();
  await expect(page.locator('[data-title-field="author"]')).toHaveValue('Writer Two');
});
test('screenplay paste replaces selected text, preserves neighbors, paginates dual dialogue, and undo restores IDs and caret', async ({ page }) => {
  await page.goto('/editor.html?sample=1'); await expect(page.locator('#pages')).toContainText('NOAH');
  const before = await page.evaluate(() => window.scriptForge.getDocument());
  const text = before.elements.find(el => el.type === 'action').text;
  await position(page, text, 7);
  const initial = await page.evaluate(() => window.scriptForge.getSelection());
  await paste(page, '**INT. HOSPITAL - NIGHT**\n\nNoah enters.\n\n**NOAH**\nHello.\n\nAVA ^\n(softly)\nHi.\n\nCUT TO:');
  const after = await page.evaluate(() => window.scriptForge.getDocument());
  expect(after.elements.some(el => el.type === 'scene' && el.text === 'INT. HOSPITAL - NIGHT')).toBe(true);
  await expect(page.locator('.dualDialogue')).toHaveCount(2);
  expect(after.elements.find(el => el.id === initial.focus.id).text).toBe(text.slice(0, 7));
  const selection = await page.evaluate(() => window.scriptForge.getSelection());
  expect(after.elements.find(el => el.id === selection.focus.id).text).toBe('CUT TO:');
  expect(selection.focus.offset).toBe(7);
  expect(await page.evaluate(async () => (await import('/js/session.js')).fountainForSaving(window.scriptForge.getDocument()))).toContain('.INT. HOSPITAL - NIGHT');
  await page.keyboard.press('ControlOrMeta+z'); expect(await page.evaluate(() => window.scriptForge.getDocument())).toEqual(before);
  expect(await page.evaluate(() => window.scriptForge.getSelection())).toEqual(initial);
  await page.keyboard.press('ControlOrMeta+Shift+z'); expect(await page.evaluate(() => window.scriptForge.getDocument())).toEqual(after);
  await page.screenshot({ path: 'test-results/intelligent-paste.png' });
});
test('Tools plain-text override bypasses structural parsing and single-line paste keeps Action', async ({ page }) => {
  await page.goto('/editor.html'); await expect(page.locator('[data-type="action"]')).toHaveCount(1);
  await position(page, ''); await paste(page, 'INT. ROOM - DAY');
  await expect(page.locator('[data-type="action"]')).toHaveText('INT. ROOM - DAY');
  await page.locator('.tools-menu > summary').click(); await page.locator('#paste-plain-text').click();
  await paste(page, '\n\nINT. OTHER ROOM - NIGHT\n\nNOAH\nHello.');
  expect((await page.evaluate(() => window.scriptForge.getDocument())).elements.some(el => el.type === 'scene')).toBe(false);
});
test('PDF and print include one unnumbered title page, omit placeholders, preserve body numbering and leave source unchanged', async ({ page }) => {
  await page.goto('/editor.html?sample=1'); await expect(page.locator('#pages')).toContainText('NOAH');
  const before = await page.evaluate(() => window.scriptForge.getDocument());
  await page.addScriptTag({ url: '/vendor/jspdf.umd.min.js' });
  const result = await page.evaluate(async () => {
    const { createScreenplayPDF } = await import('/js/pdf-export.js');
    const RealPDF = window.jspdf.jsPDF, writes = [];
    window.jspdf.jsPDF = function(options) {
      const pdf = new RealPDF(options), original = pdf.text;
      pdf.text = function(text, ...args) { writes.push({ text, page: pdf.internal.getCurrentPageInfo().pageNumber }); return original.call(pdf, text, ...args); };
      return pdf;
    };
    const pdf = await createScreenplayPDF(window.scriptForge.getDocument());
    return { pages: pdf.pages, writes, body: window.scriptForge.getPages().length, bytes: Array.from(new Uint8Array(await pdf.blob.arrayBuffer()).slice(0, 5)) };
  });
  expect(result.pages).toBe(result.body + 1);
  expect(result.writes.some(w => w.page === 1 && JSON.stringify(w.text).includes('THE LAST SIGNAL'))).toBe(true);
  expect(result.writes.some(w => w.page === 1 && /^\d+\.$/.test(w.text))).toBe(false);
  expect(result.writes.some(w => w.page === 2 && w.text === '1.')).toBe(false); // WriterSolo omits the first body-page number.
  expect(JSON.stringify(result.writes)).not.toMatch(/\[AUTHOR|\[MAILING|\[PHONE|\[EMAIL/);
  expect(await page.evaluate(() => window.scriptForge.getDocument())).toEqual(before);
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('[data-title-field="author"]')).toBeHidden();
  await expect(page.locator('.title-title .title-print')).toHaveText('The Last Signal');
  await expect(page.locator('.title-author .title-print')).toBeEmpty();
});
test('imported Fountain title metadata appears once and an untouched metadata-free import remains unchanged', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('#empty-state')).toBeVisible();
  const original = 'INT. ROOM - DAY\r\n\r\nA room.\r\n';
  const titled = 'Title: Existing Story\nCredit: A film by\nAuthor: Existing Author\nContact:\n    Studio Office\n    City 12345\n    555-123-4567\n    author@example.com\nCustom: Preserve this\n\nINT. ROOM - DAY\n\nA room.';
  for (const [source, name] of [[titled, 'Existing.fountain'], [original, 'Metadata Free.fountain']]) {
    const id = await page.evaluate(async ({ source, name }) => {
      const { importOpenedFile } = await import('/js/library.js');
      return (await importOpenedFile({ source, name, handle: null, hash: 'fixture' })).id;
    }, { source, name });
    await page.goto(`/editor.html?id=${id}`); await expect(page.locator('#pages')).toContainText('A room.');
    await expect(page.locator('#title-page')).toHaveCount(1); await expect(page.locator('.screenplay-page')).toHaveCount(1);
    if (source === titled) {
      await expect(page.locator('[data-title-field="title"]')).toHaveValue('Existing Story');
      await expect(page.locator('[data-title-field="author"]')).toHaveValue('Existing Author');
      await expect(page.locator('[data-title-field="credit"]')).toHaveValue('A film by');
      await expect(page.locator('[data-title-field="address"]')).toHaveValue('Studio Office\nCity 12345');
      await page.locator('[data-title-field="author"]').fill('Edited Author');
      const saved = await page.evaluate(async () => (await import('/js/session.js')).fountainForSaving(window.scriptForge.getDocument()));
      expect(saved).toContain('Preserve this'); expect(saved.match(/Title:/g)).toHaveLength(1);
    } else {
      await expect(page.locator('[data-title-field="title"]')).toHaveValue('Metadata Free');
      const saved = await page.evaluate(async () => (await import('/js/session.js')).fountainForSaving(window.scriptForge.getDocument()));
      expect(saved).toBe(original);
    }
    await page.locator('#home').click();
    await expect(page).toHaveURL(/\/index\.html$/);
    await expect(page.locator('#new-screenplay')).toBeEnabled();
  }
});
test('long pasted screenplay reflows body pages without adding extra title sheets or empty pages', async ({ page }) => {
  await page.goto('/editor.html'); await expect(page.locator('[data-type="action"]')).toHaveCount(1); await position(page, '');
  const text = Array.from({ length: 90 }, (_, i) => `INT. ROOM ${i} - DAY\n\nA light flickers.\n\nNOAH\nHello from room ${i}.`).join('\n\n');
  await paste(page, text);
  await expect(page.locator('#scene-count')).toHaveText('90'); await expect(page.locator('#title-page')).toHaveCount(1);
  expect(await page.locator('.screenplay-page').count()).toBeGreaterThan(5);
  const pages = await page.evaluate(() => window.scriptForge.getPages());
  expect(pages.every(page => page.items.length && page.used <= 864)).toBe(true);
  const current = await page.evaluate(() => { const doc = window.scriptForge.getDocument(); const selection = window.scriptForge.getSelection(); return { text: doc.elements.find(el => el.id === selection.focus.id).text, offset: selection.focus.offset }; });
  expect(current).toEqual({ text: 'Hello from room 89.', offset: 19 });
  await page.keyboard.press('ControlOrMeta+z'); await expect(page.locator('#scene-count')).toHaveText('0');
});
