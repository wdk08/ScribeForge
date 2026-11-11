import { test, expect } from '@playwright/test';
const source = 'Title: Scene spacing proof\n\nINT. FIRST ROOM - DAY\n\nTess watches him leave.\n\nEXT. PARK - NIGHT\n\nTyler walks toward the forest.\n\nTYLER\nI will be right back.\n\nINT. CABIN - NIGHT\n\nEXT. CABIN - NIGHT\n\nA light glows.\n\nCUT TO:\n\nINT. FINAL ROOM - DAY\n\nThe end.';
test.beforeEach(async ({ context }) => { await context.addInitScript(() => { window.scriptForgeLocalHelperDisabled = true; window.showDirectoryPicker = undefined; }); });
async function seed(page, text = source) {
  await page.goto('/'); await expect(page.locator('#empty-state')).toBeVisible();
  const id = await page.evaluate(async text => {
    const { parseFountain } = await import('/js/fountain.js');
    const { repository } = await import('/js/storage.js');
    const { draftRecord } = await import('/js/session.js');
    const record = draftRecord(parseFountain(text)); record.recovery.dirty = false;
    await repository.put(record); return record.id;
  }, text);
  await page.goto(`/editor.html?id=${id}`);
  await expect(page.locator('#pages')).toHaveAttribute('contenteditable', 'true');
  await page.locator('#zoom').selectOption('1');
}
test('editor and PDF share heading gaps, page placement, and existing horizontal formatting', async ({ page }) => {
  await seed(page);
  await page.addScriptTag({ url: '/vendor/jspdf.umd.min.js' });
  const result = await page.evaluate(async () => {
    const doc = window.scriptForge.getDocument(), before = JSON.stringify(doc);
    const { fontBaseline } = await import('/js/screenplay-format.js'); const measure = document.getElementById('measurement'); const baseline = fontBaseline(measure);
    const { serializeFountain } = await import('/js/fountain.js');
    const fountain = serializeFountain(doc), PDF = window.jspdf.jsPDF, writes = [];
    window.jspdf.jsPDF = function(options) {
      const pdf = new PDF(options), text = pdf.text;
      pdf.text = function(value, x, y, options) {
        writes.push({ text: value, x, y, align: options?.align, page: pdf.internal.getCurrentPageInfo().pageNumber });
        return text.call(pdf, value, x, y, options);
      }; return pdf;
    };
    const { createScreenplayPDF } = await import('/js/pdf-export.js');
    const pdf = await createScreenplayPDF(doc); window.spacingProofPDF = pdf.blob;
    const elements = [...document.querySelectorAll('#pages [data-element-id]')].map(el => {
      const box = el.getBoundingClientRect(), page = el.closest('.screenplay-page'), origin = page.querySelector('.page-content').getBoundingClientRect();
      return { type: el.dataset.type, text: el.textContent, top: box.top - origin.top, bottom: box.bottom - origin.top,
        x: box.left - origin.left, page: Number(page.dataset.page), align: getComputedStyle(el).textAlign };
    });
    return { elements, writes, baseline, pages: pdf.pages, unchanged: before === JSON.stringify(window.scriptForge.getDocument()), sameFountain: fountain === serializeFountain(doc) };
  });
  expect(result.unchanged && result.sameFountain).toBe(true);
  expect(result.elements[0].top).toBeCloseTo(0, 1);
  for (let i = 1; i < result.elements.length; i++) {
    const el = result.elements[i], previous = result.elements[i - 1];
    if (el.type === 'scene') expect(el.top - previous.bottom).toBeCloseTo(32, 1);
    else if (previous.type === 'scene') expect(el.top - previous.bottom).toBeCloseTo(16, 1);
  }
  for (const el of result.elements) {
    const write = result.writes.find(item => item.page === el.page + 1 && item.text === el.text.toUpperCase())
      ?? result.writes.find(item => item.page === el.page + 1 && item.text === el.text);
    expect(write, el.text).toBeTruthy();
    expect(write.y).toBeCloseTo((96 + el.top + result.baseline) * .75, 1);
  }
  expect(result.elements.find(el => el.type === 'character').x).toBeCloseTo(192, 1);
  expect(result.elements.find(el => el.type === 'dialogue').x).toBeCloseTo(96, 1);
  expect(result.elements.find(el => el.type === 'transition').align).toBe('right');
  expect(result.writes.find(item => item.text === 'CUT TO:').align).toBe('right');
  const download = page.waitForEvent('download');
  await page.evaluate(() => { const link = document.createElement('a'); link.href = URL.createObjectURL(window.spacingProofPDF); link.download = 'scene-spacing.pdf'; link.click(); });
  await (await download).saveAs('test-results/scene-spacing.pdf');
  await page.screenshot({ path: 'test-results/scene-spacing-editor.png', fullPage: true });
});
test('editing near a page boundary repaginates, keeps heading with action, and suppresses its top gap', async ({ page }) => {
  const longAction = Array.from({ length: 47 }, (_, i) => `Measured line ${i + 1}.`).join('\n');
  await seed(page, `INT. FIRST - DAY\n\n${longAction}\n\nEXT. NEXT - NIGHT\n\nA new scene starts.`);
  await expect(page.locator('#pages .screenplay-page')).toHaveCount(1);
  const action = page.locator('[data-type="action"]').first();
  await action.click(); await page.keyboard.press('End');
  await page.keyboard.press('Shift+Enter'); await page.keyboard.type('One additional measured line.');
  await expect(page.locator('#pages .screenplay-page')).toHaveCount(2);
  const placement = await page.evaluate(() => {
    const scene = [...document.querySelectorAll('[data-type="scene"]')].find(el => el.textContent === 'EXT. NEXT - NIGHT');
    const page = scene.closest('.screenplay-page'), content = page.querySelector('.page-content');
    const zoom = Number(getComputedStyle(document.getElementById('pages')).getPropertyValue('--page-zoom'));
    return { page: page.dataset.page, top: (scene.getBoundingClientRect().top - content.getBoundingClientRect().top) / zoom,
      action: page.querySelector('[data-type="action"]').textContent,
      numbered: [...document.querySelectorAll('#pages .page-number')].map(el => el.textContent),
      valid: window.scriptForge.getPages().every(page => page.used <= 864) };
  });
  expect(placement).toEqual({ page: '2', top: 0, action: 'A new scene starts.', numbered: ['1.', '2.'], valid: true });
  await page.addScriptTag({ url: '/vendor/jspdf.umd.min.js' });
  const exported = await page.evaluate(async () => {
    const PDF = window.jspdf.jsPDF, writes = [];
    window.jspdf.jsPDF = function(options) {
      const pdf = new PDF(options), original = pdf.text;
      pdf.text = function(text, x, y, options) {
        writes.push({ text, y, page: pdf.internal.getCurrentPageInfo().pageNumber });
        return original.call(pdf, text, x, y, options);
      }; return pdf;
    };
    const result = await (await import('/js/pdf-export.js')).createScreenplayPDF(window.scriptForge.getDocument());
    const {fontBaseline}=await import('/js/screenplay-format.js'); const baseline=fontBaseline(document.getElementById('measurement'));
    return { baseline, pages: result.pages, heading: writes.find(item => item.text === 'EXT. NEXT - NIGHT'), action: writes.find(item => item.text === 'A new scene starts.') };
  });
  expect(exported.pages).toBe(3); expect(exported.heading.page).toBe(3); expect(exported.heading.y).toBeCloseTo((96+exported.baseline)*.75, 2); expect(exported.action.y-exported.heading.y).toBe(24);
  await page.keyboard.press('ControlOrMeta+z'); await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('#pages .screenplay-page')).toHaveCount(1);
});
