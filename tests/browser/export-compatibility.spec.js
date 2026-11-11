import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
const script = 'Title: Export Compatibility\nAuthor: Example Writer\nContact:\n    123 Main Street, Apartment 4B\n    Example City, SC 29301\n    (864) 555-1234\n    writer@example.com\n\nFADE IN:\n\nInt. house - night\n\nMorgan and Casey inspect a radio.\n\nCASEY\nCan you hear it?\n\nMorgan looks over.\n\nMORGAN (V.O.)\n(quietly)\nI hear it too.\n\nMorgan turns a dial.\n\nMORGAN (O.S.)\nThere it is... I hear a signal.\n\nMorgan waits.\n\nMORGAN\nStill here.\n\nExt. house - night';
test.beforeEach(async ({ context }) => { await context.addInitScript(() => { window.scriptForgeLocalHelperDisabled = true; window.showDirectoryPicker = undefined; }); });
async function seed(page) {
  await page.goto('/');
  const id = await page.evaluate(async script => {
    const { parseFountain } = await import('/js/fountain.js'), { draftRecord } = await import('/js/session.js'), { repository } = await import('/js/storage.js');
    const doc = parseFountain(script), cues = doc.elements.filter(el => el.type === 'character'); cues[1].continuation = 'off'; cues[2].continuation = 'on';
    const record = draftRecord(doc); record.recovery.dirty = false; await repository.put(record); return record.id;
  }, script);
  await page.goto(`/editor.html?id=${id}`); await expect(page.locator('#pages')).toHaveAttribute('contenteditable', 'true');
}
async function fountainDownload(page, editor) {
  const download = page.waitForEvent('download');
  if (editor) { await page.locator('#export').click(); await page.locator('#export-fountain').click(); }
  else { await page.getByLabel('Options for Export Compatibility').click(); await page.getByRole('button', { name: 'Export as Fountain', exact: true }).click(); }
  const file = await download; return readFile(await file.path(), 'utf8');
}
test('editor and homepage export portable Fountain with visible continuations and keep internal overrides', async ({ page }) => {
  await seed(page); const original = await page.evaluate(() => window.scriptForge.getDocument());
  const exported = await fountainDownload(page, true);
  expect(exported).not.toMatch(/ScriptForge|continuations v1|"state"|"index"/);
  const parsed = await page.evaluate(async source => (await import('/js/fountain.js')).parseFountain(source), exported);
  expect(parsed.elements.filter(el => el.type === 'character').map(el => el.text)).toEqual(['CASEY', 'MORGAN (V.O.)', "MORGAN (O.S.) (CONT'D)", "MORGAN (CONT'D)"]);
  expect(parsed.elements.filter(el => el.type === 'scene').map(el => el.text)).toEqual(['INT. HOUSE - NIGHT', 'EXT. HOUSE - NIGHT']);
  expect(parsed.elements.filter(el => el.type === 'parenthetical').map(el => el.text)).toEqual(['(quietly)']);
  expect(await page.evaluate(() => window.scriptForge.getDocument())).toEqual(original);
  await page.locator('#home').click(); expect(await fountainDownload(page, false)).toBe(exported);
  await page.getByRole('button', { name: 'Export Compatibility', exact: true }).click(); await expect(page.locator('#pages')).toHaveAttribute('contenteditable', 'true');
  expect(await page.evaluate(() => window.scriptForge.getDocument().elements.filter(el => el.type === 'character').map(el => el.continuation ?? null))).toEqual([null, 'off', 'on', null]);
});
for (const [name, address, email] of [
  ['requested', '123 Main Street, Apartment 4B\nExample City, SC 29301', 'writer@example.com'],
  ['short', '7 Oak Road\nCity, SC 29301', 'a@example.com'],
  ['long', '123 Main Street, Apartment 4B, Building Seven\nExample City, South Carolina 29301', 'screenwriter@example.com'],
]) test(`contact glyphs use a fixed left edge in editor/print and every PDF line: ${name}`, async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1300 }); await seed(page);
  await page.locator('[data-title-field="address"]').fill(address); await page.locator('[data-title-field="email"]').fill(email);
  await page.locator('#zoom').selectOption('1'); await page.locator('.document-viewport').evaluate(el => { el.scrollTop = 0; });
  await expect(page.locator('.title-page-center')).toHaveCSS('text-align', 'center');
  const before = await page.evaluate(() => window.scriptForge.getDocument());
  const geometry = await page.evaluate(() => {
    const page = document.getElementById('title-page').getBoundingClientRect(), block = document.querySelector('.title-page-contact').getBoundingClientRect();
    return { x: block.left - page.left, y: block.top - page.top, fields: [...document.querySelectorAll('.title-page-contact textarea')].map(el => ({ x: el.getBoundingClientRect().left - page.left, align: getComputedStyle(el).textAlign, height: el.getBoundingClientRect().height })) };
  });
  expect(geometry.x).toBeGreaterThanOrEqual(96); expect(geometry.y).toBeGreaterThan(700); expect(geometry.fields.every(field => Math.abs(field.x - geometry.x) < 2 && field.align === 'left')).toBe(true);
  await page.locator('[data-title-field="title"]').focus(); await page.screenshot({ path: `test-results/export-contact-${name}-editor.png` });
  await page.addScriptTag({ url: '/vendor/jspdf.umd.min.js' });
  const writes = await page.evaluate(async () => {
    const PDF = window.jspdf.jsPDF, writes = [];
    window.jspdf.jsPDF = function(options) {
      const pdf = new PDF(options), original = pdf.text;
      pdf.text = function(text, x, y, options) { if (pdf.internal.getCurrentPageInfo().pageNumber === 1) writes.push({ text, x, y, options }); return original.call(pdf, text, x, y, options); }; return pdf;
    };
    const { createScreenplayPDF } = await import('/js/pdf-export.js'); const result = await createScreenplayPDF(window.scriptForge.getDocument()); window.contactProofBlob = result.blob; return writes;
  });
  const lines = writes.filter(write => write.options.align === 'left');
  expect(lines.length).toBeGreaterThanOrEqual(4); expect(new Set(lines.map(line => line.x)).size).toBe(1); expect(lines[0].x).toBeCloseTo((geometry.x-1)*.75,0);
  expect(lines.at(-1).text).toBe(email); expect(lines.some(line => line.text === '(864) 555-1234')).toBe(true);
  for (let i = 1; i < lines.length; i++) expect(lines[i].y - lines[i - 1].y).toBe(15);
  const download = page.waitForEvent('download'); await page.evaluate(() => {
    const link = document.createElement('a'); link.href = URL.createObjectURL(window.contactProofBlob); link.download = 'Contact alignment.pdf'; link.click();
  }); await (await download).saveAs(`test-results/export-contact-${name}.pdf`);
  // Independent glyph extraction verifies the PDF content, beyond calls to jsPDF.
  const python = process.env.SCRIPTFORGE_PDF_PYTHON ?? join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3');
  if (existsSync(python)) {
    const rows = JSON.parse(execFileSync(python, ['-c', `import pdfplumber,json,sys
with pdfplumber.open(sys.argv[1]) as pdf:
 rows={}
 for word in pdf.pages[0].extract_words(x_tolerance=1,y_tolerance=2):
  if word['top']>600: rows.setdefault(round(word['top'],2),[]).append(word)
 print(json.dumps([{'y':y,'x':min(w['x0'] for w in words)} for y,words in rows.items()]))`, `test-results/export-contact-${name}.pdf`], { encoding: 'utf8' }));
    expect(rows.length).toBe(lines.length); expect(rows.every(row => Math.abs(row.x - lines[0].x) < .1)).toBe(true);
    for (let i = 1; i < rows.length; i++) expect(rows[i].y - rows[i-1].y).toBeCloseTo(15, 1);
  }

  await page.emulateMedia({ media: 'print' });
  const starts = await page.locator('.title-page-contact .title-print').evaluateAll(fields => fields.flatMap(el => {
    const node = el.firstChild, text = node.textContent, starts = [];
    for (let at = 0; at < text.length; at++) if (at === 0 || text[at - 1] === '\n') { const range = document.createRange(); range.setStart(node, at); range.setEnd(node, at + 1); starts.push(range.getBoundingClientRect().left); }
    return starts;
  }));
  expect(Math.max(...starts) - Math.min(...starts)).toBeLessThan(.5);
  expect(await page.evaluate(() => window.scriptForge.getDocument())).toEqual(before);
});
