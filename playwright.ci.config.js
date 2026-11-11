import config from './playwright.config.js';
// Use full Chromium's current headless renderer, matching retail Chrome/Edge.
// Linux's hinted glyph advances otherwise round Courier Prime to integer pixels;
// fractional advances match the font outlines used by the desktop apps and PDF.
export default {...config,use:{...config.use,channel:'chromium',browserName:'chromium',launchOptions:{args:['--font-render-hinting=none']}}};
