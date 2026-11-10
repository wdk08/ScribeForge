import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { newManuscript } from '../../../js/storyforge/model.js';

const editor = page => page.getByRole('textbox', { name: 'Manuscript editor' });
const font = page => page.getByRole('combobox', { name: 'Font family', exact: true });
const size = page => page.getByRole('textbox', { name: 'Font size in points', exact: true });
const style = page => page.getByRole('combobox', { name: 'Paragraph style', exact: true });
const save = page => expect(page.locator('#save-state')).toHaveText('Saved locally');
async function tool(page, name) {
  await page.locator('.tools-menu summary').click();
  await page.getByRole('button', { name, exact: true }).click();
}
async function open(page, manuscript) {
  await page.goto('/');
  await page.locator('#import-picker').setInputFiles({
    name: 'Test.stf', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(manuscript)),
  });
  await expect(editor(page)).toBeVisible();
}
async function selectText(page, start, end = start) {
  await page.evaluate(({ start, end }) => {
    const root = document.querySelector('.ProseMirror');
    root.focus();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    window.getSelection().setBaseAndExtent(nodes[start[0]], start[1], nodes[end[0]], end[1]);
  }, { start, end });
}

test('font and size resolve at the caret, show mixed selections, and preserve copied typography', async ({ page }) => {
  const book = newManuscript('Typography', undefined, 'Normal line\nA styled heading\n');
  book.settings.styles.section = { font: 'Arial', size: 18 };
  book.content.content[1].attrs.style = 'section';
  book.content.content[0].content = [
    { type: 'text', text: 'Normal ' },
    { type: 'text', text: 'line', marks: [{ type: 'font', attrs: { value: 'Times New Roman' } }, { type: 'size', attrs: { value: 14 } }] },
  ];
  await open(page, book);
  await expect(font(page)).toHaveValue('Georgia');
  await expect(size(page)).toHaveValue('12 pt');
  await selectText(page, [1, 1]);
  await expect(font(page)).toHaveValue('Times New Roman');
  await expect(size(page)).toHaveValue('14 pt');
  await editor(page).press('ArrowLeft');
  await editor(page).press('ArrowLeft');
  await expect(font(page)).toHaveValue('Georgia');
  await expect(size(page)).toHaveValue('12 pt');
  await selectText(page, [2, 4]);
  await expect(font(page)).toHaveValue('Arial');
  await expect(size(page)).toHaveValue('18 pt');
  await selectText(page, [0, 0], [1, 3]);
  await expect(font(page)).toHaveAttribute('placeholder', 'Mixed');
  await expect(size(page)).toHaveAttribute('placeholder', 'Mixed');
  await expect(font(page)).toHaveValue('');
  await font(page).click();
  await size(page).click();
  await expect(page.locator('#save-state')).toHaveText('Saved locally');
  await expect(editor(page).locator('p').first()).toHaveText('Normal line');
  await selectText(page, [2, 0], [2, 8]);
  await expect(font(page)).toHaveValue('Arial');
  await page.evaluate(() => {
    const root = document.querySelector('.ProseMirror');
    const clipboard = new DataTransfer();
    root.dispatchEvent(new ClipboardEvent('copy', { clipboardData: clipboard, bubbles: true }));
    const last = root.lastElementChild;
    window.getSelection().collapse(last, 0);
    window.storyforgeTestClipboard = clipboard;
  });
  await expect(font(page)).toHaveValue('Georgia');
  await page.evaluate(() => document.querySelector('.ProseMirror').dispatchEvent(new ClipboardEvent('paste', {
    clipboardData: window.storyforgeTestClipboard, bubbles: true, cancelable: true,
  })));
  await expect(editor(page).locator('p').last().locator('span[style*="Arial"]')).toContainText('A styled');
  await save(page);
  await page.reload();
  await expect(editor(page).locator('p').last()).toContainText('A styled');
});

test('custom paragraph styles keep overrides, round-trip as chapters, and survive library edits or deletion', async ({ page, browser }) => {
  test.slow();
  const book = newManuscript('Custom Styles', undefined, 'The Turning Tide\nA wave crossed the sand.');
  book.content.content[0].attrs.align = 'right';
  await open(page, book);
  await style(page).selectOption('create-style');
  const dialog = page.getByRole('dialog', { name: 'Custom Paragraph Styles' });
  await expect(dialog.getByLabel('Alignment', { exact: true })).toHaveValue('right');
  await expect(dialog.getByLabel('Font family', { exact: true })).toHaveValue('Georgia');
  await dialog.getByLabel('Style name').fill('My Chapter Heading');
  await dialog.getByLabel('Style role').selectOption('chapter');
  await dialog.getByLabel('Alignment', { exact: true }).selectOption('center');
  await dialog.getByLabel('Font size (pt)', { exact: true }).fill('22');
  await dialog.getByLabel('Text color', { exact: true }).fill('#49339a');
  await dialog.getByLabel('Bold', { exact: true }).selectOption('true');
  await dialog.getByLabel('Underline', { exact: true }).selectOption('true');
  await dialog.getByRole('button', { name: 'Save & Apply', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Chapters' }).getByRole('button', { name: /The Turning Tide/ })).toContainText('5 words');
  const heading = editor(page).getByRole('heading', { name: 'The Turning Tide' });
  await expect(heading).toHaveCSS('text-align', 'right');
  await expect(heading).toHaveCSS('color', 'rgb(73, 51, 154)');
  await expect(size(page)).toHaveValue('22 pt');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(heading).toHaveCount(0);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(heading).toBeVisible();
  await save(page);

  await page.locator('#export').click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'StoryForge (.stf)', exact: true }).click();
  const portable = JSON.parse(await readFile(await (await download).path()));
  const other = await browser.newPage();
  await open(other, portable);
  await expect(editor(other).getByRole('heading', { name: 'The Turning Tide' })).toHaveCSS('color', 'rgb(73, 51, 154)');
  await other.close();

  await page.getByRole('link', { name: 'Home' }).click();
  await page.locator('#new-manuscript').click();
  await expect(editor(page)).toBeVisible();
  await editor(page).fill('A second book');
  await style(page).selectOption({ label: 'My Chapter Heading' });
  await expect(editor(page).getByRole('heading', { name: 'A second book' })).toHaveCSS('text-align', 'center');
  await style(page).selectOption('manage-styles');
  await dialog.getByLabel('Style name').fill('Revised Heading');
  await dialog.getByLabel('Font size (pt)', { exact: true }).fill('28');
  await dialog.getByRole('button', { name: 'Save Style', exact: true }).click();
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await save(page);
  await page.reload();
  await expect(editor(page).getByRole('heading', { name: 'A second book' })).toHaveCSS('font-size', '29.3333px');
  await expect(style(page)).toHaveValue(/^custom-/);
});

test('the library exports, confirms deletion, restores via Undo, and aggregates writing statistics', async ({ page }) => {
  await page.goto('/');
  await page.locator('#new-manuscript').click();
  await expect(editor(page)).toBeVisible();
  await page.getByRole('textbox', { name: 'Manuscript title' }).fill('Library Proof');
  await editor(page).fill('A new story begins');
  await save(page);
  await page.getByRole('link', { name: 'Home' }).click();
  await page.getByRole('button', { name: 'Writing Statistics', exact: true }).click();
  const stats = page.getByRole('dialog', { name: 'Writing Statistics' });
  await expect(stats.locator('.writing-totals div').filter({ hasText: 'Words written (added)' })).toContainText('4');
  await expect(stats.locator('progress')).toHaveCount(7);
  await stats.getByRole('button', { name: 'Close' }).click();
  const menu = page.locator('summary[aria-label="Options for Library Proof"]');
  await menu.click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export as StoryForge (.stf)' }).click();
  const portable = await readFile(await (await download).path());
  expect(JSON.parse(portable).metadata.title).toBe('Library Proof');
  await menu.click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: 'Delete from the library?' });
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('button', { name: 'Open Library Proof' })).toBeVisible();
  await menu.click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await confirm.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('button', { name: 'Open Library Proof' })).toHaveCount(0);
  expect(JSON.parse(portable).content.content[0].content[0].text).toBe('A new story begins');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open Library Proof' })).toBeVisible();
});

test('Read to Me uses one local voice and supports pause, resume, speed, and stop', async ({ page }) => {
  await page.addInitScript(() => {
    window.speechEvents = [];
    const synthesis = new EventTarget();
    const local = { name: 'Narrator', voiceURI: 'local', lang: 'en-US', default: true, localService: true };
    synthesis.getVoices = () => [local, { ...local, name: 'Remote', voiceURI: 'remote', localService: false }];
    synthesis.speak = utterance => {
      window.speechEvents.push(['speak', utterance.text, utterance.voice.voiceURI, utterance.rate]);
      window.speechUtterance = utterance;
      utterance.onstart?.();
    };
    for (const action of ['pause', 'resume', 'cancel']) synthesis[action] = () => window.speechEvents.push([action]);
    Object.defineProperty(window, 'speechSynthesis', { value: synthesis, configurable: true });
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: class { constructor(text) { this.text = text; } }, configurable: true });
  });
  await open(page, newManuscript('Read', undefined, 'Chapter One\nThe river moved.'));
  await tool(page, 'Read to Me');
  const dialog = page.getByRole('dialog', { name: 'Read to Me' });
  await expect(dialog.getByLabel('Voice').locator('option')).toHaveCount(1);
  await dialog.getByRole('button', { name: 'Play', exact: true }).click();
  await dialog.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(dialog.getByRole('status')).toHaveText('Paused');
  await dialog.getByRole('button', { name: 'Resume', exact: true }).click();
  await dialog.getByLabel('Playback speed').selectOption('1.5');
  await page.evaluate(() => window.speechUtterance.onend());
  await expect.poll(() => page.evaluate(() => window.speechEvents.filter(event => event[0] === 'speak'))).toEqual([
    ['speak', 'Chapter One', 'local', 1], ['speak', 'The river moved.', 'local', 1.5],
  ]);
  await dialog.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(dialog.getByRole('status')).toHaveText('Stopped');
});

test('the restored analyzer retains v1.2 defaults, chapter filters and custom variations', async ({ page }) => {
  const book = newManuscript('Profanity Proof', undefined, 'Chapter One\nWhat the hell, shell.\nChapter Two\nBlue moon and blue moons.');
  await open(page, book);
  await tool(page, 'Profanity Analyzer');
  const panel = page.getByRole('dialog', { name: 'Profanity Analyzer' });
  await expect(panel.locator('#profanity-totals')).toContainText('1 occurrences');
  await expect(panel.getByRole('button', { name: 'What the hell · Chapter One' })).toBeVisible();
  await panel.getByText('Edit dictionary', { exact: true }).click();
  await panel.getByLabel('New group name').fill('Moon');
  await panel.getByRole('button', { name: 'Add group', exact: true }).click();
  const group = panel.locator('fieldset').filter({ has: page.locator('legend', { hasText: /^Moon$/ }) });
  await group.getByLabel('New variation for Moon').fill('blue moon');
  await group.getByRole('button', { name: 'Add variation', exact: true }).click();
  await page.reload();
  await tool(page, 'Profanity Analyzer');
  await panel.locator('#profanity-chapter').selectOption({ label: 'Chapter Two' });
  await expect(panel.locator('#profanity-totals')).toContainText('2 occurrences');
  await panel.getByRole('button', { name: 'Blue moon · Chapter Two' }).click();
  await expect.poll(() => page.evaluate(() => window.getSelection().toString())).toBe('Blue moon');
});

test('all toolbar alignment commands apply across paragraphs and retain paragraph spacing and margins', async ({ page }) => {
  await open(page, newManuscript('Alignment proof', undefined, 'First paragraph\nSecond paragraph'));
  await selectText(page, [0, 1], [1, 8]);
  for (const [label, alignment] of [['Align Left', 'left'], ['Align Center', 'center'], ['Align Right', 'right'], ['Justify', 'justify']]) {
    const button = page.getByRole('button', { name: label, exact: true });
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await expect(editor(page).locator('p').first()).toHaveCSS('text-align', alignment);
    await expect(editor(page).locator('p').last()).toHaveCSS('text-align', alignment);
  }
  await page.getByRole('button', { name: 'Paragraph…' }).click();
  const settings = page.locator('#paragraph-dialog');
  await expect(settings.getByLabel('Alignment', { exact: true })).toHaveCount(0);
  await settings.getByLabel('First-line indent (pt)').fill('-10');
  await settings.getByLabel('Space after (pt)').fill('9');
  await settings.getByLabel('Left margin (pt)').fill('60');
  await settings.getByRole('button', { name: 'Apply' }).click();
  await save(page);
  await page.reload();
  await expect(editor(page).locator('p').first()).toHaveCSS('text-align', 'justify');
  await expect(editor(page).locator('p').first()).toHaveCSS('padding-bottom', '12px');
  await expect(page.locator('#pages')).toHaveCSS('padding-left', '80px');
});
