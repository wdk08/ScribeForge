import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const source = path => fileURLToPath(new URL(path, import.meta.url));
const theme = readFileSync(source('./js/theme.js'), 'utf8');

export default defineConfig({
  base: '/ScribeForge/',
  publicDir: false,
  define: { __SCRIBEFORGE_DEV__: 'false', __SCRIBEFORGE_OFFLINE__: 'true' },
  plugins: [{
    name: 'scribeforge-browser-entries',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        return html.replace('<script src="./js/theme.js"></script>', () => `<script>${theme}</script>`)
          .replace('src="./app/library.js"', 'src="./js/scribeforge/home.js"')
          .replace('src="./app/manuscript.js"', 'src="./js/scribeforge/editor.js"');
      },
    },
  }],
  build: {
    outDir: 'dist/browser',
    target: ['safari15.6', 'chrome105', 'firefox103'],
    rollupOptions: { input: { library: source('./index.html'), manuscript: source('./editor.html') } },
  },
});
