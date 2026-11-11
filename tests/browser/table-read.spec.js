import { test, expect } from '@playwright/test';
import { installSpeechMock } from '../fixtures/speech-mock.js';
test.beforeEach(async ({ context }) => { await context.addInitScript(() => { window.scriptForgeLocalHelperDisabled = true; window.showDirectoryPicker = undefined; }); });
async function screenplay(page, { long = false } = {}) {
  await page.goto('/'); await expect(page.locator('#empty-state')).toBeVisible();
  const id = await page.evaluate(async ({ long }) => {
    const { createDocument, createElement: el } = await import('/js/document.js'); const { draftRecord } = await import('/js/session.js'); const { repository } = await import('/js/storage.js');
    const elements = long ? Array.from({ length: 400 }, (_, index) => [el('scene', `INT. ROOM ${index + 1} - DAY`), el('action', index === 0 ? 'A long paragraph for the table read. '.repeat(300) : `Action in room ${index + 1}.`), el('character', 'NOAH'), el('dialogue', `Line ${index + 1}.`)]).flat() : [
      el('scene', 'INT. ROOM - DAY'), el('action', 'Noah walks toward the window.'), el('action', 'He notices Ava outside.'), el('character', 'NOAH'), el('parenthetical', '(quietly)'), el('dialogue', 'Hello, **Ava**. [[private thought]]'), el('character', 'AVA (O.S.)', { dual: true }), el('dialogue', 'Hey, Noah.'), el('section', 'Hidden section', { depth: 1 }), el('synopsis', 'Hidden synopsis'), el('note', 'Hidden note'), el('character', 'NOAH (V.O.)'), el('dialogue', 'I remember that day.'), el('scene', 'EXT. PARK - DAY'), el('action', 'A car pulls away.'), el('transition', 'FADE OUT:'), el('scene', 'INT. EMPTY - DAY'),
    ];
    return (await repository.put(draftRecord(createDocument({ title: 'The Table Read', elements })))).id;
  }, { long });
  await page.goto(`/editor.html?id=${id}`); await page.locator('#recover-changes').click(); await expect(page.locator('#pages')).toContainText('NOAH'); return id;
}
async function launch(page) { await page.locator('.tools-menu summary').click(); await page.locator('#simulate-table-read').click(); await expect(page.locator('#table-read-dialog')).toBeVisible(); await expect(page.locator('#tr-preference-status')).not.toContainText('Loading'); }
async function active(page) { return page.evaluate(() => { const u = window.speechMock.active; return u ? { text: u.text, voice: u.voice?.name, rate: u.rate, pitch: u.pitch, volume: u.volume } : null; }); }
async function finish(page) { await page.evaluate(() => window.speechMock.finish()); }

test('cast, playback controls, sequential dual voices, highlighting and completion leave the editor model and caret untouched', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message)); await page.addInitScript(installSpeechMock); await screenplay(page);
  await page.evaluate(async () => { const { restoreSelection } = await import('/js/selection.js'); const el = window.scriptForge.getDocument().elements.find(item => item.type === 'action'); restoreSelection(document.getElementById('pages'), { anchor: { id: el.id, offset: 5 }, focus: { id: el.id, offset: 5 } }); });
  const before = await page.evaluate(() => ({ doc: window.scriptForge.getDocument(), selection: window.scriptForge.getSelection() }));
  await launch(page); await expect(page.locator('.tr-voice-card')).toHaveCount(3); await expect(page.locator('#tr-title')).toHaveText('The Table Read');
  await page.getByLabel('Voice for NOAH', { exact: true }).selectOption({ label: 'Alex · en-US' });
  await page.getByLabel('Voice for AVA', { exact: true }).selectOption({ label: 'Karen · en-AU' });
  await page.getByLabel('Rate for NOAH', { exact: true }).fill('1.4'); await page.getByLabel('Rate for NOAH', { exact: true }).press('Tab');
  await page.getByLabel('Pitch for NOAH', { exact: true }).fill('0.7'); await page.getByLabel('Pitch for NOAH', { exact: true }).press('Tab');
  await page.getByLabel('Volume for NOAH', { exact: true }).fill('0.3'); await page.getByLabel('Volume for NOAH', { exact: true }).press('Tab');
  await page.locator('#tr-speed').selectOption('1.25'); await page.getByLabel('Preview NOAH', { exact: true }).click();
  expect(await active(page)).toEqual({ text: 'Hello, Ava.', voice: 'Alex', rate: 1.75, pitch: .7, volume: .3 });
  await page.locator('#tr-play').click(); expect((await active(page)).text).toBe('Noah walks toward the window.');
  await expect(page.locator('.tr-active')).toHaveCount(1); await expect(page.locator('.tr-active')).toContainText('Noah walks');
  const count = await page.evaluate(() => window.speechMock.history.length);
  await page.locator('#tr-pause').click(); await expect(page.locator('#tr-state')).toHaveText('paused');
  await page.locator('#tr-play').click(); await expect(page.locator('#tr-state')).toHaveText('playing');
  expect(await page.evaluate(() => window.speechMock.history.length)).toBe(count);
  await page.locator('#tr-next').click(); expect((await active(page)).text).toBe('He notices Ava outside.');
  await page.locator('#tr-next').click(); expect((await active(page)).voice).toBe('Alex');
  await page.screenshot({ path: 'test-results/table-read-desktop.png' });
  await finish(page); expect(await active(page)).toMatchObject({ text: 'Hey, Noah.', voice: 'Karen' });
  await finish(page); expect(await active(page)).toMatchObject({ text: 'I remember that day.', voice: 'Alex' });
  await finish(page); expect(await active(page)).toMatchObject({ text: 'A car pulls away.', voice: 'Samantha' });
  await finish(page); await expect(page.locator('#tr-state')).toHaveText('completed'); await expect(page.locator('#tr-percent')).toHaveText('100%'); await expect(page.locator('.tr-active')).toHaveCount(0);
  await page.locator('#tr-restart').click(); expect((await active(page)).text).toBe('Noah walks toward the window.');
  await page.locator('#tr-stop').click(); await expect(page.locator('#tr-state')).toHaveText('stopped'); await expect(page.locator('#tr-progress')).toHaveValue('0');
  await page.locator('#tr-close').click(); await expect(page.locator('#table-read-dialog')).not.toBeVisible();
  expect(await page.evaluate(() => ({ doc: window.scriptForge.getDocument(), selection: window.scriptForge.getSelection() }))).toEqual(before);
  expect(await page.evaluate(() => ({ active: window.speechMock.active, listeners: window.speechMock.voiceListeners.size, peak: window.speechMock.peakPending }))).toEqual({ active: null, listeners: 0, peak: 1 });
  await expect(page.locator('#pages')).toBeFocused(); await page.keyboard.type('new '); await expect(page.locator('#pages')).toContainText('Noah new walks');
  expect(errors).toEqual([]);
});

test('voice settings persist across reopening and reload, remain per script, and never change screenplay records or Fountain', async ({ page }) => {
  await page.addInitScript(installSpeechMock); const id = await screenplay(page);
  const before = await page.evaluate(async id => { const { repository } = await import('/js/storage.js'); const { fountainForSaving } = await import('/js/session.js'); return { record: await repository.get(id), source: fountainForSaving(window.scriptForge.getDocument()) }; }, id);
  await launch(page); await page.getByLabel('Voice for NOAH', { exact: true }).selectOption({ label: 'Alex · en-US' });
  await page.getByLabel('Pitch for Narrator', { exact: true }).fill('0.8'); await page.getByLabel('Pitch for Narrator', { exact: true }).press('Tab');
  await page.locator('#tr-read-headings').check(); await page.locator('#tr-speed').selectOption('1.5');
  await expect(page.locator('#tr-preference-status')).toContainText('saved'); await page.locator('#tr-close').click(); await expect(page.locator('#table-read-dialog')).not.toBeVisible();
  const after = await page.evaluate(async id => { const { repository } = await import('/js/storage.js'); const { fountainForSaving } = await import('/js/session.js'); return { record: await repository.get(id), source: fountainForSaving(window.scriptForge.getDocument()) }; }, id);
  expect(after).toEqual(before);
  page.on('dialog', dialog => dialog.accept()); await page.reload(); await page.locator('#recover-changes').click(); await launch(page);
  await expect(page.locator('#tr-read-headings')).toBeChecked(); await expect(page.locator('#tr-speed')).toHaveValue('1.5'); await expect(page.getByLabel('Pitch for Narrator', { exact: true })).toHaveValue('0.8');
  expect(await page.getByLabel('Voice for NOAH', { exact: true }).inputValue()).toContain('test:alex');
  await page.locator('#tr-close').click(); await expect(page.locator('#table-read-dialog')).not.toBeVisible();
  await page.locator('#home').click(); await expect(page.locator('.script-card')).toHaveCount(1); await page.locator('#new-screenplay').click(); await expect(page.locator('#pages')).toContainText('FADE IN:'); await launch(page);
  await expect(page.locator('#tr-read-headings')).not.toBeChecked(); await expect(page.locator('#tr-speed')).toHaveValue('1'); await expect(page.getByLabel('Pitch for Narrator', { exact: true })).toHaveValue('1'); await expect(page.locator('.tr-voice-card')).toHaveCount(1);
});

test('scene selection, Start Reading Here, progress jumps and native speech errors are synchronized', async ({ page }) => {
  await page.addInitScript(installSpeechMock); await screenplay(page); await launch(page);
  await page.locator('#tr-read-headings').check(); await page.locator('#tr-play').click(); expect((await active(page)).text).toBe('INT. ROOM - DAY');
  await page.locator('#tr-read-headings').uncheck();
  const scene = await page.locator('#tr-scene option').filter({ hasText: 'EXT. PARK' }).getAttribute('value');
  await page.locator('#tr-scene').selectOption(scene); await expect(page.locator('#tr-position')).toContainText('Scene 2'); expect(await active(page)).toBe(null);
  await page.locator('#tr-play').click(); expect((await active(page)).text).toBe('A car pulls away.');
  await page.locator('#tr-progress').fill('50'); await page.locator('#tr-progress').dispatchEvent('change'); expect((await active(page)).text).toBe('Hey, Noah.');
  await page.locator('#tr-script').getByRole('button', { name: 'He notices Ava outside.', exact: true }).click(); expect((await active(page)).text).toBe('Hey, Noah.');
  await page.locator('#tr-read-here').click(); expect((await active(page)).text).toBe('He notices Ava outside.'); await expect(page.locator('.tr-active')).toHaveText('He notices Ava outside.');
  await page.evaluate(() => window.speechMock.fail('network')); await expect(page.locator('#tr-state')).toHaveText('error'); await expect(page.locator('#tr-error')).toContainText('installed local voice');
  await page.locator('#tr-play').click(); expect((await active(page)).text).toBe('He notices Ava outside.'); await expect(page.locator('#tr-error')).toBeHidden();
  await page.locator('#tr-read-headings').check(); const firstScene = await page.locator('#tr-scene option').filter({ hasText: 'INT. ROOM' }).getAttribute('value');
  await page.locator('#tr-scene').selectOption(firstScene); await page.locator('#tr-play').click(); expect((await active(page)).text).toBe('INT. ROOM - DAY');
  await page.keyboard.press('Escape'); await expect(page.locator('#table-read-dialog')).not.toBeVisible(); expect(await active(page)).toBe(null);
  await launch(page); expect(await page.evaluate(() => window.speechMock.voiceListeners.size)).toBe(1); await page.locator('#tr-play').click();
  await page.evaluate(() => window.addEventListener('pagehide', () => sessionStorage.setItem('table-read-exit', JSON.stringify({ active: window.speechMock.active, listeners: window.speechMock.voiceListeners.size })), { once: true }));
  await page.goto('/'); expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('table-read-exit')))).toEqual({ active: null, listeners: 0 });
});

test('asynchronous and disappearing voices preserve assignments and preview errors remain visible', async ({ page }) => {
  await page.addInitScript(installSpeechMock, { empty: true }); await screenplay(page); await launch(page);
  await expect(page.locator('#tr-play')).toBeDisabled(); await expect(page.locator('#tr-engine-notice')).toContainText('No voices');
  await page.evaluate(() => window.speechMock.updateVoices()); await expect(page.locator('#tr-play')).toBeEnabled();
  await page.getByLabel('Voice for NOAH', { exact: true }).selectOption({ label: 'Alex · en-US' });
  const saved = await page.getByLabel('Voice for NOAH', { exact: true }).inputValue();
  await page.evaluate(() => window.speechMock.updateVoices(window.speechMock.voices.filter(voice => voice.name !== 'Alex')));
  await expect(page.locator('[data-speaker-id="character:NOAH"] .tr-voice-warning')).toContainText('unavailable');
  await expect(page.getByLabel('Voice for NOAH', { exact: true })).toHaveValue(saved);
  await page.getByLabel('Preview NOAH', { exact: true }).click(); expect((await active(page)).voice).not.toBe('Alex');
  await page.evaluate(() => window.speechMock.fail('voice-unavailable')); await expect(page.locator('#tr-error')).toContainText('Select another voice');
  await page.evaluate(() => window.speechMock.updateVoices()); await expect(page.getByLabel('Voice for NOAH', { exact: true })).toHaveValue(saved); await expect(page.locator('.tr-voice-warning')).toHaveCount(0);
  await page.locator('#tr-close').click(); await expect(page.locator('#table-read-dialog')).not.toBeVisible(); expect(await page.evaluate(() => window.speechMock.voiceListeners.size)).toBe(0);
});

test('unsupported speech and storage failures are actionable and do not affect normal editing', async ({ page }) => {
  await page.addInitScript(installSpeechMock, { unsupported: true }); await screenplay(page); await launch(page);
  await expect(page.locator('#tr-engine-notice')).toContainText('does not support'); await expect(page.locator('#tr-play')).toBeDisabled();
  await page.locator('#tr-close').click(); await expect(page.locator('#table-read-dialog')).not.toBeVisible(); await expect(page.locator('#pages')).toBeFocused();
  await page.evaluate(async () => { const { repository } = await import('/js/storage.js'); const original = repository.getPreference; repository.getPreference = (...args) => args[0].startsWith('tableRead:') ? Promise.reject(new Error('Test storage unavailable')) : original(...args); });
  await page.locator('.tools-menu summary').click(); await page.locator('#simulate-table-read').click(); await expect(page.locator('#tr-error')).toContainText('Voice settings could not be loaded'); await expect(page.locator('#tr-read-headings')).toBeDisabled();
  await page.locator('#tr-close').click(); await expect(page.locator('#table-read-dialog')).not.toBeVisible(); await expect(page.locator('#pages')).toContainText('NOAH');
});

test('a feature-length preview stays bounded, queues one short utterance, and scrolls by stable element ID on a small screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 }); await page.addInitScript(installSpeechMock); await screenplay(page, { long: true }); await launch(page);
  await page.locator('#tr-play').click(); expect((await active(page)).text.length).toBeLessThanOrEqual(220); expect(await page.evaluate(() => window.speechMock.history.length)).toBe(1);
  await finish(page); expect(await page.evaluate(() => window.speechMock.history.length)).toBe(2); await expect(page.locator('#tr-position')).toContainText('Element 1 of 800');
  const last = page.locator('#tr-script [data-type="dialogue"]').last(); await last.click(); await page.locator('#tr-read-here').click(); await expect(page.locator('.tr-active')).toHaveText('Line 400.');
  const bounds = await page.evaluate(() => { const el = document.querySelector('.tr-active').getBoundingClientRect(), box = document.getElementById('tr-script').getBoundingClientRect(); return { top: el.top, bottom: el.bottom, boxTop: box.top, boxBottom: box.bottom, width: document.documentElement.scrollWidth, viewport: innerWidth, peak: window.speechMock.peakPending }; });
  expect(bounds.width).toBeLessThanOrEqual(bounds.viewport); expect(bounds.top).toBeGreaterThanOrEqual(bounds.boxTop - 1); expect(bounds.bottom).toBeLessThanOrEqual(bounds.boxBottom + 1); expect(bounds.peak).toBe(1);
  await page.screenshot({ path: 'test-results/table-read-mobile.png' });
  await page.locator('#tr-close').click(); await expect(page.locator('#table-read-dialog')).not.toBeVisible();
});


test('failed preference writes are reported, retain session choices, and can be retried without touching the screenplay', async ({ page }) => {
  await page.addInitScript(installSpeechMock); await screenplay(page); await launch(page);
  const before = await page.evaluate(() => window.scriptForge.getDocument());
  await page.evaluate(async () => {
    const { repository } = await import('/js/storage.js'); const original = repository.setPreference; let fail = true;
    repository.setPreference = (...args) => { if (args[0].startsWith('tableRead:') && fail) { fail = false; return Promise.reject(new Error('Test write failed')); } return original(...args); };
  });
  await page.getByLabel('Voice for NOAH', { exact: true }).selectOption({ label: 'Alex · en-US' });
  await expect(page.locator('#tr-error')).toContainText('Voice settings could not be saved'); expect(await page.getByLabel('Voice for NOAH', { exact: true }).inputValue()).toContain('test:alex');
  await page.getByLabel('Pitch for NOAH', { exact: true }).fill('0.9'); await page.getByLabel('Pitch for NOAH', { exact: true }).press('Tab');
  await expect(page.locator('#tr-preference-status')).toContainText('saved'); await expect(page.locator('#tr-error')).toBeHidden();
  expect(await page.evaluate(() => window.scriptForge.getDocument())).toEqual(before);
  await page.locator('#tr-close').click(); await expect(page.locator('#table-read-dialog')).not.toBeVisible(); await launch(page);
  expect(await page.getByLabel('Voice for NOAH', { exact: true }).inputValue()).toContain('test:alex'); await expect(page.getByLabel('Pitch for NOAH', { exact: true })).toHaveValue('0.9');
});
