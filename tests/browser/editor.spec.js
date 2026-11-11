import { test, expect } from '@playwright/test';
test.beforeEach(async ({ context }) => { await context.addInitScript(() => { window.scriptForgeLocalHelperDisabled = true; }); });

async function select(page, id, offset, endId = id, endOffset = offset) {
  await page.evaluate(async ({ id, offset, endId, endOffset }) => {
    const { restoreSelection } = await import('/js/selection.js');
    restoreSelection(document.getElementById('pages'), { anchor: { id, offset }, focus: { id: endId, offset: endOffset } });
  }, { id, offset, endId, endOffset });
}
async function getElements(page) {
  return page.evaluate(() => window.scriptForge.getDocument().elements.filter(el => !['whitespace', 'pageBreak', 'titleField'].includes(el.type)));
}
async function paste(page, text) {
  await page.locator('#pages').evaluate((root, text) => {
    const data = new DataTransfer(); data.setData('text/plain', text);
    root.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, text);
  await expect(page.locator('#pages')).toHaveAttribute('contenteditable', 'true');
}
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { window.showSaveFilePicker = undefined; window.showDirectoryPicker = undefined; });
  await page.goto('/editor.html?sample=1');
  await expect(page.locator('.screenplay-page').first()).toBeVisible();
});

test('initial browser render, accurate Letter pages, dual layout and no runtime errors', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.reload(); await page.locator('#recover-changes').click(); await expect(page.locator('.dualDialogue')).toHaveCount(1);
  const columns = page.locator('.dualDialogue .dualColumn');
  const left = await columns.nth(0).boundingBox(), right = await columns.nth(1).boundingBox();
  expect(right.x).toBeGreaterThan(left.x + left.width); expect(right.y).toBe(left.y);
  const paper = await page.locator('.screenplay-page').first().boundingBox();
  expect(paper.width / paper.height).toBeCloseTo(816 / 1056, 2);
  expect(errors).toEqual([]);
  await page.screenshot({ path: 'test-results/editor-desktop.png', fullPage: true });
});
test('middle typing, format, caret offset, split, Tab, undo and redo', async ({ page }) => {
  const action = (await getElements(page)).find(el => el.type === 'action');
  await select(page, action.id, 6);
  await page.keyboard.type('new ');
  expect((await getElements(page)).find(el => el.id === action.id).text).toContain('A tinynew  light');
  expect(await page.evaluate(() => window.scriptForge.getSelection().focus.offset)).toBe(10);
  await page.locator('[data-format="scene"]').click();
  expect(await page.evaluate(() => window.scriptForge.getSelection().focus.offset)).toBe(10);
  await page.keyboard.press('Tab');
  expect((await getElements(page)).find(el => el.id === action.id).type).toBe('scene');
  expect((await getElements(page)).at(-1).type).toBeDefined();
  expect(await page.evaluate(() => window.scriptForge.getDocument().elements.find(el => el.id === window.scriptForge.getSelection().focus.id).type)).toBe('action');
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => window.scriptForge.getSelection().focus.offset)).toBe(0);
  await page.keyboard.press('ControlOrMeta+z');
  expect(await page.evaluate(() => window.scriptForge.getSelection().focus.offset)).toBe(10);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  expect(await page.evaluate(() => window.scriptForge.getSelection().focus.offset)).toBe(0);
});
test('character Enter leads to dialogue; empty speech returns to action; Backspace merges', async ({ page }) => {
  const char = (await getElements(page)).find(el => el.type === 'character');
  await select(page, char.id, char.text.length);
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => window.scriptForge.getDocument().elements.find(el => el.id === window.scriptForge.getSelection().focus.id).type)).toBe('dialogue');
  await page.keyboard.type('New speech.');
  await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
  expect(await page.evaluate(() => window.scriptForge.getDocument().elements.find(el => el.id === window.scriptForge.getSelection().focus.id).type)).toBe('action');
  await page.keyboard.press('Backspace');
  expect(await page.evaluate(() => window.scriptForge.getSelection().focus.offset)).toBe(11);
});
test('multiple-element replacement and plain-text paste never inject HTML', async ({ page }) => {
  const elements = await getElements(page); const a = elements[1], b = elements[4];
  await select(page, a.id, 2, b.id, 5);
  await paste(page, '<b>literal</b>\n\nSecond paragraph.');
  expect(await page.locator('#pages b').count()).toBe(0);
  const updated = await getElements(page);
  expect(updated.find(el => el.id === a.id).text).toBe('A <b>literal</b>');
  expect(updated.some(el => el.id === elements[2].id)).toBe(false);
  await page.keyboard.press('ControlOrMeta+z');
  expect(await getElements(page)).toEqual(elements);
});
test('measured wrapped paragraphs flow across pages; caret survives reflow and deletion', async ({ page }) => {
  const action = (await getElements(page)).find(el => el.type === 'action');
  await select(page, action.id, 0, action.id, action.text.length);
  const text = 'A very long sentence stretches across the page while preserving every word. '.repeat(180);
  await paste(page, text);
  const pages = await page.evaluate(() => window.scriptForge.getPages());
  expect(pages.length).toBeGreaterThan(3);
  expect(pages.every(page => page.used <= 864)).toBe(true);
  const fragments = page.locator(`[data-element-id="${action.id}"]`);
  expect(await fragments.count()).toBeGreaterThan(2);
  // The rendered lines must stay within each page's content rectangle.
  const overflows = await page.locator('.page-content').evaluateAll(contents => contents.flatMap(content => {
    const bottom = content.getBoundingClientRect().bottom;
    return [...content.querySelectorAll('[data-element-id]')].filter(el => el.getBoundingClientRect().bottom > bottom + 1).map(el => el.dataset.elementId);
  }));
  expect(overflows).toEqual([]);
  const middle = Math.floor(text.length / 2);
  await select(page, action.id, middle); await page.keyboard.type('X');
  expect(await page.evaluate(() => window.scriptForge.getSelection().focus)).toEqual({ id: action.id, offset: middle + 1 });
  await select(page, action.id, 1, action.id, text.length + 1); await page.keyboard.press('Backspace');
  await expect.poll(() => page.locator('.screenplay-page').count()).toBeLessThan(pages.length);
  expect(await page.evaluate(() => window.scriptForge.getSelection().focus)).toEqual({ id: action.id, offset: 1 });
});
test('dual dialogue wraps and continues side by side without data loss', async ({ page }) => {
  const elements = await getElements(page);
  const dualChar = elements.find(el => el.dual), rightSpeech = elements[elements.indexOf(dualChar) + 1];
  const priorCue = elements.slice(0, elements.indexOf(dualChar)).findLast(el => el.type === 'character');
  const leftSpeech = elements[elements.indexOf(priorCue) + 1];
  const leftText = 'Left speech goes on and on. '.repeat(130), rightText = 'Right speech carries an answer. '.repeat(90);
  await select(page, leftSpeech.id, 0, leftSpeech.id, leftSpeech.text.length); await paste(page, leftText);
  await select(page, rightSpeech.id, 0, rightSpeech.id, rightSpeech.text.length); await paste(page, rightText);
  expect(await page.locator('.dualDialogue').count()).toBeGreaterThan(2);
  const current = await getElements(page);
  expect(current.find(el => el.id === leftSpeech.id).text).toBe(leftText);
  expect(current.find(el => el.id === rightSpeech.id).text).toBe(rightText);
  expect(await page.evaluate(() => window.scriptForge.getPages().every(page => page.used <= 864))).toBe(true);
  expect(await page.locator('.continuation').count()).toBeGreaterThan(0);
  await page.screenshot({ path: 'test-results/editor-dual.png', fullPage: true });
});
test('selection crosses a page split using keyboard and formatting keeps offset', async ({ page }) => {
  const action = (await getElements(page)).find(el => el.type === 'action');
  await select(page, action.id, 0, action.id, action.text.length); await paste(page, 'Wrapped text for a page split. '.repeat(300));
  const split = await page.locator(`[data-element-id="${action.id}"]`).nth(1).getAttribute('data-start');
  await select(page, action.id, Number(split) - 1); await page.keyboard.press('ArrowRight');
  expect(await page.evaluate(() => window.scriptForge.getSelection().focus.offset)).toBe(Number(split));
  await page.keyboard.type('Z');
  expect(await page.evaluate(() => window.scriptForge.getSelection().focus.offset)).toBe(Number(split) + 1);
  await page.locator('[data-format="dialogue"]').click();
  expect(await page.evaluate(() => window.scriptForge.getSelection().focus.offset)).toBe(Number(split) + 1);
});
test('IME text commits once and restores the model caret', async ({ page }) => {
  const action = (await getElements(page)).find(el => el.type === 'action');
  await select(page, action.id, 2);
  await page.locator('#pages').evaluate(root => {
    root.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    root.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '你好' }));
  });
  expect((await getElements(page)).find(el => el.id === action.id).text).toBe(action.text.slice(0, 2) + '你好' + action.text.slice(2));
  expect(await page.evaluate(() => window.scriptForge.getSelection().focus.offset)).toBe(4);
});
test('Fountain export is an actual downloadable file', async ({ page }) => {
  await page.locator('.file-menu summary').click();
  const download = page.waitForEvent('download'); await page.locator('#export').click(); await page.locator('#export-fountain').click();
  const file = await download; expect(file.suggestedFilename()).toBe('The Last Signal.fountain');
  await file.saveAs('test-results/exported.fountain');
});
test('vertical navigation crosses a page gap and returns to the same text column', async ({ page }) => {
  const action = (await getElements(page)).find(el => el.type === 'action');
  await select(page, action.id, 0, action.id, action.text.length);
  await paste(page, 'The same repeated words wrap naturally across each measured screenplay line. '.repeat(150));
  const split = Number(await page.locator(`[data-element-id="${action.id}"]`).nth(1).getAttribute('data-start'));
  const lines = await page.evaluate(id => window.scriptForge.getPages().flatMap(page => page.items.flatMap(item => item.columns.flat())).filter(line => line.id === id), action.id);
  const firstNextPage = lines.findIndex(line => line.start === split), previousLine = lines[firstNextPage - 1];
  await select(page, action.id, previousLine.start + 5);
  await page.keyboard.press('ArrowDown');
  const after = await page.evaluate(() => window.scriptForge.getSelection().focus);
  expect(after.id).toBe(action.id); expect(after.offset).toBeGreaterThanOrEqual(split);
  expect(after.offset).toBeLessThan(lines[firstNextPage].end);
  await page.keyboard.press('ArrowUp');
  const back = await page.evaluate(() => window.scriptForge.getSelection().focus.offset);
  expect(Math.abs(back - previousLine.start - 5)).toBeLessThanOrEqual(1);
});
test('new screenplay writes naturally and exports multiline dialogue after Enter', async ({ page }) => {
  await page.locator('.file-menu summary').click();
  await page.locator('#new-document').click();
  await expect(page.locator('#document-title')).toHaveValue('Untitled Screenplay');
  await page.keyboard.type('INT. STUDIO - DAY'); await page.keyboard.press('Enter');
  await page.keyboard.type('A light turns on.'); await page.keyboard.press('Enter');
  await page.locator('[data-format="character"]').click(); await page.keyboard.type('NOAH'); await page.keyboard.press('Enter');
  await page.keyboard.type('First line.'); await page.keyboard.press('Shift+Enter'); await page.keyboard.type('Second line.');
  const speech = (await getElements(page)).find(el => el.type === 'dialogue');
  expect(speech.text).toBe('First line.\nSecond line.');
  const download = page.waitForEvent('download'); await page.locator('#export').click(); await page.locator('#export-fountain').click();
  await (await download).saveAs('test-results/new-screenplay.fountain');
});
test('copy and cut use model text and restore with undo', async ({ page }) => {
  const action = (await getElements(page)).find(el => el.type === 'action');
  await select(page, action.id, 2, action.id, 12);
  const copied = await page.locator('#pages').evaluate(root => {
    const data = new DataTransfer(); root.dispatchEvent(new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true })); return data.getData('text/plain');
  });
  expect(copied).toBe(action.text.slice(2, 12));
  await page.locator('#pages').evaluate(root => {
    root.dispatchEvent(new ClipboardEvent('cut', { clipboardData: new DataTransfer(), bubbles: true, cancelable: true }));
  });
  expect((await getElements(page)).find(el => el.id === action.id).text).toBe(action.text.slice(0, 2) + action.text.slice(12));
  await page.keyboard.press('ControlOrMeta+z');
  expect((await getElements(page)).find(el => el.id === action.id).text).toBe(action.text);
});
test('manual dialogue line break has a visible caret and Enter creates action below intact speech', async ({ page }) => {
  const speech = (await getElements(page)).find(el => el.type === 'dialogue');
  await select(page, speech.id, speech.text.length);
  const yBefore = await page.evaluate(() => { const range = window.getSelection().getRangeAt(0); return range.getBoundingClientRect().top + document.querySelector('.document-viewport').scrollTop; });
  await page.keyboard.press('Shift+Enter');
  const yAfter = await page.evaluate(() => { const range = window.getSelection().getRangeAt(0); return range.getBoundingClientRect().top + document.querySelector('.document-viewport').scrollTop; });
  expect(yAfter).toBeGreaterThan(yBefore + 10);
  await page.keyboard.type('Another line.');
  expect((await getElements(page)).find(el => el.id === speech.id).text).toBe(`${speech.text}\nAnother line.`);
  await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
  await page.keyboard.type('quietly'); await page.locator('[data-format="parenthetical"]').click();
  expect(await page.evaluate(() => window.scriptForge.getDocument().elements.find(el => el.id === window.scriptForge.getSelection().focus.id).text)).toBe('(Quietly)');
  expect(await page.evaluate(() => window.scriptForge.getSelection().focus.offset)).toBe(8);
});
test('mouse placement, Home/End and word navigation keep typing at the intended model offset', async ({ page }) => {
  const action = (await getElements(page)).find(el => el.type === 'action');
  await page.locator(`[data-element-id="${action.id}"]`).scrollIntoViewIfNeeded();
  const box = await page.locator(`[data-element-id="${action.id}"]`).boundingBox();
  await page.mouse.click(box.x + 45, box.y + 8);
  const clicked = await page.evaluate(() => window.scriptForge.getSelection().focus);
  expect(clicked.id).toBe(action.id);
  await page.keyboard.type('X');
  expect((await getElements(page)).find(el => el.id === action.id).text).toBe(action.text.slice(0, clicked.offset) + 'X' + action.text.slice(clicked.offset));
  await page.keyboard.press('Home');
  expect(await page.evaluate(() => window.scriptForge.getSelection().focus.offset)).toBe(0);
  await page.keyboard.press('Control+ArrowRight');
  expect(await page.evaluate(() => window.scriptForge.getSelection().focus.offset)).toBeGreaterThan(0);
  await page.keyboard.press('End');
  const atEnd = await page.evaluate(() => window.scriptForge.getSelection().focus.offset);
  await page.keyboard.type('Z');
  expect(await page.evaluate(() => window.scriptForge.getSelection().focus.offset)).toBe(atEnd + 1);
});
test('feature-length layout measures real text and remains responsive for subsequent edits', async ({ page }) => {
  const timings = await page.evaluate(async () => {
    const { parseFountain } = await import('/js/fountain.js');
    const { createMeasurer, layoutUnits, paginate } = await import('/js/pagination.js');
    const { renderPages } = await import('/js/renderer.js');
    const { updateElement } = await import('/js/document.js');
    const source = Array.from({ length: 180 }, (_, i) => `INT. ROOM ${i} - DAY\n\n${'An actor crosses the room and listens. '.repeat(8)}\n\nNOAH\n${'This is a line of dialogue that wraps. '.repeat(5)}\n\n`).join('');
    const doc = parseFountain(source);
    const host = document.createElement('div'); host.className = 'measurement'; document.body.append(host);
    const measure = createMeasurer(host); const start = performance.now();
    const pages = paginate(layoutUnits(doc, measure)); const first = performance.now() - start;
    const action = doc.elements.find(el => el.type === 'action');
    const edited = updateElement(doc, action.id, { text: 'X' + action.text });
    const after = performance.now(); const changed = paginate(layoutUnits(edited, measure));
    const renderRoot = document.createElement('div'); renderRoot.className = 'pages';
    renderPages(renderRoot, changed, edited);
    const subsequent = performance.now() - after; host.remove();
    return { first, subsequent, count: pages.length, safe: changed.every(page => page.used <= 864) };
  });
  expect(timings.count).toBeGreaterThan(40); expect(timings.safe).toBe(true);
  expect(timings.first).toBeLessThan(10000); expect(timings.subsequent).toBeLessThan(1500);
  console.log('Feature-length layout timing (ms):', timings);
});
test('mobile viewport fits pages and toolbar without horizontal document overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await expect.poll(async () => (await page.locator('.screenplay-page').first().boundingBox())?.width ?? Infinity).toBeLessThan(390);
  await page.screenshot({ path: 'test-results/editor-mobile.png', fullPage: true });
  await page.locator('#zoom').selectOption('1');
  expect((await page.locator('.screenplay-page').first().boundingBox()).width).toBe(816);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  expect(await page.locator('.document-viewport').evaluate(el => el.scrollWidth)).toBeGreaterThan(390);
});

test('all 127 imported scenes are reachable inside a bounded, independent scene list', async ({ page }) => {
  await page.goto('/');
  const source = Array.from({ length: 127 }, (_, i) => `INT. ROOM ${i + 1} - DAY\n\nAn actor enters room ${i + 1}.\n\n`).join('');
  const chooser = page.waitForEvent('filechooser');
  await page.locator('#import-copy').click();
  await (await chooser).setFiles({ name: '127-scenes.fountain', mimeType: 'text/plain', buffer: Buffer.from(source) });
  await expect(page.locator('#scene-list .scene-link')).toHaveCount(127);
  const list = page.locator('#scene-list');
  expect(await list.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
  await list.evaluate(el => { el.scrollTop = el.scrollHeight; });
  const prior = await list.evaluate(el => el.scrollTop);
  await list.locator('.scene-link').last().click();
  const lastScene = (await getElements(page)).filter(el => el.type === 'scene').at(-1);
  expect(await page.evaluate(() => window.scriptForge.getSelection().focus.id)).toBe(lastScene.id);
  expect(await page.locator('.document-viewport').evaluate(el => el.scrollTop)).toBeGreaterThan(1000);
  await page.keyboard.type('X');
  expect(await list.evaluate(el => el.scrollTop)).toBe(prior);
  const geometry = await page.evaluate(() => {
    const viewport = document.querySelector('.document-viewport').getBoundingClientRect();
    const caret = window.getSelection().getRangeAt(0).getBoundingClientRect();
    return { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight,
      screenWidth: innerWidth, screenHeight: innerHeight, visible: caret.top >= viewport.top && caret.bottom <= viewport.bottom };
  });
  expect(geometry.width).toBeLessThanOrEqual(geometry.screenWidth);
  expect(geometry.height).toBeLessThanOrEqual(geometry.screenHeight);
  expect(geometry.visible).toBe(true);
  await page.screenshot({ path: 'test-results/editor-127-scenes.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(844);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('typing lowercase scene prefixes formats immediately and preserves the caret', async ({ page }) => {
  const action = (await getElements(page)).find(el => el.type === 'action');
  for (const prefix of ['int.', 'ext.']) {
    await select(page, action.id, 0, action.id, action.text.length);
    await page.keyboard.type(prefix);
    const current = (await getElements(page)).find(el => el.id === action.id);
    expect(current.type).toBe('scene'); expect(current.text).toBe(prefix[0].toUpperCase() + prefix.slice(1));
    expect(await page.evaluate(() => window.scriptForge.getSelection().focus)).toEqual({ id: action.id, offset: 4 });
    await page.keyboard.type(' room - day');
    expect((await getElements(page)).find(el => el.id === action.id).text).toBe(`${prefix[0].toUpperCase() + prefix.slice(1)} room - day`);
    await page.keyboard.press('ControlOrMeta+z');
    expect((await getElements(page)).find(el => el.id === action.id)).toEqual(action);
  }
});

test('character Tab creates a parenthetical below; Tab leaves filled lines intact and end Return leaves dialogue for action', async ({ page }) => {
  const char = (await getElements(page)).find(el => el.type === 'character');
  const active = () => page.evaluate(() => {
    const selection = window.scriptForge.getSelection().focus;
    const element = window.scriptForge.getDocument().elements.find(el => el.id === selection.id);
    return { id: element.id, type: element.type, text: element.text, offset: selection.offset };
  });
  await select(page, char.id, 2); await page.keyboard.press('Tab');
  expect(await active()).toMatchObject({ type: 'parenthetical', text: '()', offset: 1 });
  expect((await getElements(page)).find(el => el.id === char.id)).toEqual(char);
  const parenthetical = await active();
  await page.keyboard.type('quietly'); await page.keyboard.press('Tab');
  expect(await active()).toMatchObject({ type: 'dialogue', text: '', offset: 0 });
  expect((await getElements(page)).find(el => el.id === parenthetical.id).text).toBe('(quietly)');
  await page.keyboard.press('Tab');
  expect(await active()).toMatchObject({ type: 'parenthetical', text: '()', offset: 1 });
  await page.keyboard.press('Tab');
  expect(await active()).toMatchObject({ type: 'dialogue', text: '', offset: 0 });
  await page.keyboard.type('A spoken line.'); const speech = await active();
  await select(page, speech.id, speech.text.length); await page.keyboard.press('Enter');
  expect(await active()).toMatchObject({ type: 'action', text: '', offset: 0 });
  expect((await getElements(page)).find(el => el.id === speech.id).text).toBe('A spoken line.');
  const action = await active(); await page.keyboard.press('Tab');
  expect(await active()).toMatchObject({ id: action.id, type: 'character', text: '', offset: 0 });
  await page.keyboard.press('Tab');
  expect(await active()).toMatchObject({ id: action.id, type: 'transition', text: '', offset: 0 });
});

test('character capitalization, parenthetical erasure, undo and new-line editing work together', async ({ page }) => {
  await page.locator('.file-menu summary').click(); await page.locator('#new-document').click();
  await expect(page.locator('#document-title')).toHaveValue('Untitled Screenplay');
  await page.keyboard.type('int. studio - day'); await page.keyboard.press('Enter');
  await page.keyboard.type('A light turns on.'); await page.keyboard.press('Enter');
  await page.keyboard.press('Tab'); await page.keyboard.type('noah');
  const char = (await getElements(page)).find(el => el.type === 'character');
  expect(char.text).toBe('NOAH');
  expect(await page.evaluate(() => window.scriptForge.getSelection().focus.offset)).toBe(4);
  await page.keyboard.press('Tab');
  const par = (await getElements(page)).find(el => el.type === 'parenthetical');
  await page.keyboard.type('softly'); await select(page, par.id, 1, par.id, 7);
  await page.keyboard.press('Backspace');
  expect((await getElements(page)).find(el => el.id === par.id).text).toBe('');
  await page.keyboard.press('ControlOrMeta+z');
  expect((await getElements(page)).find(el => el.id === par.id).text).toBe('(softly)');
  await select(page, par.id, 7); await page.keyboard.press('Enter');
  await page.keyboard.type('The signal is still alive.'); await page.keyboard.press('Enter');
  await page.keyboard.type('The room falls silent.');
  expect((await getElements(page)).map(el => [el.type, el.text])).toEqual([
    ['transition', 'FADE IN:'], ['scene', 'Int. studio - day'], ['action', 'A light turns on.'], ['character', 'NOAH'],
    ['parenthetical', '(softly)'], ['dialogue', 'The signal is still alive.'], ['action', 'The room falls silent.']
  ]);
  await page.screenshot({ path: 'test-results/editor-new-line-shortcuts.png', fullPage: true });
  const download = page.waitForEvent('download'); await page.locator('#export').click(); await page.locator('#export-fountain').click();
  await (await download).saveAs('test-results/shortcut-screenplay.fountain');
});

test('new lines capitalize, common typos correct, and an established name becomes a character on Enter', async ({ page }) => {
  const action = (await getElements(page)).findLast(el => el.type === 'action');
  await select(page, action.id, 0, action.id, action.text.length);
  await page.keyboard.type('teh room is quiet.');
  expect((await getElements(page)).find(el => el.id === action.id).text).toBe('The room is quiet.');
  expect(await page.evaluate(() => window.scriptForge.getSelection().focus.offset)).toBe(18);
  await page.keyboard.press('Shift+Enter'); await page.keyboard.type('another light flickers.');
  expect((await getElements(page)).find(el => el.id === action.id).text).toBe('The room is quiet.\nAnother light flickers.');
  await page.keyboard.press('Enter'); await page.keyboard.type('noah');
  const candidate = await page.evaluate(() => window.scriptForge.getSelection().focus.id);
  expect((await getElements(page)).find(el => el.id === candidate).text).toBe('Noah');
  await page.keyboard.press('Enter');
  expect((await getElements(page)).find(el => el.id === candidate)).toMatchObject({ type: 'character', text: 'NOAH' });
  expect(await page.evaluate(() => window.scriptForge.getDocument().elements.find(el => el.id === window.scriptForge.getSelection().focus.id).type)).toBe('dialogue');
  await page.keyboard.type('recieve the message.');
  await page.screenshot({ path: 'test-results/editor-writing-assistance.png', fullPage: true });
  expect((await getElements(page)).some(el => el.type === 'dialogue' && el.text === 'Receive the message.')).toBe(true);
  await page.keyboard.press('ControlOrMeta+z');
  await page.keyboard.press('ControlOrMeta+z');
  expect((await getElements(page)).find(el => el.id === candidate)).toMatchObject({ type: 'action', text: 'Noah' });
  await page.keyboard.press('ControlOrMeta+Shift+z');
  expect((await getElements(page)).find(el => el.id === candidate).type).toBe('character');
});
