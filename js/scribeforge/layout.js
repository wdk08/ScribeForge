import { pageDimensions, styleValue } from './model.js';
import { proseStyleCSS } from './formats.js';
import { desktop } from './storage.js';
import { $ } from './ui.js';

const pointScale = 4 / 3;
const quoteCSS = value => '"' + value.replace(/["\\]/g, '\\$&') + '"';

export function applyLayout(settings) {
  const { width, height } = pageDimensions(settings);
  const paper = $('pages').style;
  paper.setProperty('--paper-width', `${width}pt`);
  paper.setProperty('--paper-height', `${height}pt`);
  paper.setProperty('--paper-padding', `${settings.top}pt ${settings.right}pt ${settings.bottom}pt ${settings.left}pt`);
  paper.setProperty('--paper-vertical-padding', `${settings.top + settings.bottom}pt`);
  paper.setProperty('--prose-font', styleValue('font', settings.font));
  paper.setProperty('--prose-size', `${settings.size}pt`);
  paper.setProperty('--prose-leading', settings.leading);
  const rules = proseStyleCSS(settings, '.prose-content > ');
  $('manuscript-style').textContent = rules;
  $('paper-spec').textContent = `${{ letter: 'US Letter', a4: 'A4', a5: 'A5', custom: 'Custom' }[settings.pageSize]} · ${settings.font} ${settings.size} pt`;
  $('print-style').textContent = `
    @page {
      size: ${width}pt ${height}pt;
      margin: ${settings.top}pt ${settings.right}pt ${settings.bottom}pt ${settings.left}pt;
      @top-center { content: ${settings.header ? quoteCSS(settings.header) : 'none'}; font: 10pt Georgia; color: #333; }
      @bottom-center { content: ${settings.footer ? quoteCSS(settings.footer) : 'none'}; font: 10pt Georgia; color: #333; }
      @bottom-right { content: ${settings.pageNumbers ? 'counter(page)' : 'none'}; font: 10pt Georgia; color: #333; }
    }`;
  setZoom(settings);
}

export function setZoom(settings) {
  const { width } = pageDimensions(settings);
  const chosen = $('zoom').value;
  const viewport = $('viewport');
  const style = getComputedStyle(viewport);
  const available = viewport.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - 2;
  const scale = chosen === 'fit' ? Math.max(0.25, Math.min(1, available / (width * pointScale))) : Number(chosen);
  $('pages').style.setProperty('--page-zoom', scale);
}

export async function exportPDF() {
  // The system PDF printer uses the same typography and line wrapping as the
  // editor, including installed-font fallback for Unicode and emoji.
  await document.fonts.ready;
  const isMac = /Mac/.test(navigator.platform);
  if (desktop && isMac) await desktop.core.invoke('print_manuscript');
  else window.print();
}
