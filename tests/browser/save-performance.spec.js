import { test, expect } from '@playwright/test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createLocalFiles } from '../../scripts/local-files.mjs';

test('Fountain save timing uses real helper writes and reports Saved only after the file is replaced', async ({ page }) => {
  const folder = await mkdtemp(join(tmpdir(), 'scriptforge-save-speed-')), path = join(folder, 'Speed.fountain');
  const source = Array.from({ length: 80 }, (_, i) => `INT. ROOM ${i} - DAY\n\nA quiet room with a window.\n\nNOAH\nWe need to leave.\n`).join('\n');
  const helper = createLocalFiles({ configPath: join(folder, '.grants.json'), enabled: true, picker: async () => path }); const actions = []; let writeGate;
  try {
    await writeFile(path, source);
    await page.addInitScript(() => { window.showOpenFilePicker = undefined; window.showSaveFilePicker = undefined; window.showDirectoryPicker = undefined; });
    await page.route('**/api/local-files/*', async route => {
      const action = new URL(route.request().url()).pathname.split('/').at(-1); actions.push(action);
      try { if (action === 'write' && writeGate) await writeGate; await route.fulfill({ json: await helper.run(action, route.request().postDataJSON()) }); }
      catch (error) { await route.fulfill({ status: 400, json: { error: { name: error.name, message: error.message, current: error.current } } }); }
    });
    await page.goto('/'); await page.locator('#open-fountain').click(); await expect(page.locator('#disk-save-state')).toHaveText('Saved');
    const edit = async text => {
      await page.evaluate(async text => {
        const { restoreSelection } = await import('/js/selection.js'), doc = window.scriptForge.getDocument(), el = doc.elements.find(el => el.type === 'action');
        restoreSelection(document.getElementById('pages'), { anchor: { id: el.id, offset: 0 }, focus: { id: el.id, offset: el.text.length } });
        window.saveTiming = { start: performance.now() };
        const observer = new MutationObserver(() => { if (document.getElementById('disk-save-state').textContent === 'Saved') { window.saveTiming.elapsed = performance.now() - window.saveTiming.start; observer.disconnect(); } }); observer.observe(document.getElementById('disk-save-state'), { childList: true });
        const clipboardData = new DataTransfer(); clipboardData.setData('text/plain', text); document.getElementById('pages').dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
      }, text);
    };
    actions.length = 0; await edit('An automatic save timing sample.'); await expect.poll(() => page.evaluate(() => window.saveTiming.elapsed), { timeout: 8000 }).toBeGreaterThan(0);
    const automaticMs = await page.evaluate(() => window.saveTiming.elapsed), automaticActions = [...actions]; expect(await readFile(path, 'utf8')).toContain('An automatic save timing sample.');
    actions.length = 0; await edit('A manual save timing sample.'); await page.locator('#save').click(); await expect(page.locator('#disk-save-state')).toHaveText('Saved');
    const manualMs = await page.evaluate(() => window.saveTiming.elapsed); expect(await readFile(path, 'utf8')).toContain('A manual save timing sample.');
    expect(automaticActions).toEqual(['write']); expect(actions).toEqual(['permission', 'write']);
    console.log(JSON.stringify({ automaticMs: Math.round(automaticMs), manualMs: Math.round(manualMs), automaticActions, manualActions: actions }));
    let release; writeGate = new Promise(resolve => { release = resolve; });
    try {
      await edit('A deliberately delayed disk write.'); await page.locator('#save').click(); await expect(page.locator('#disk-save-state')).toHaveText('Saving…');
      expect(await readFile(path, 'utf8')).toContain('A manual save timing sample.');
    } finally { release(); }
    await expect(page.locator('#disk-save-state')).toHaveText('Saved'); expect(await readFile(path, 'utf8')).toContain('A deliberately delayed disk write.');
  } finally { await rm(folder, { recursive: true, force: true }); }
});
