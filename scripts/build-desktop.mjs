import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, context } from 'esbuild';

const root = fileURLToPath(new URL('..', import.meta.url));
export const legalFiles = ['LICENSE', 'COPYRIGHT', 'THIRD_PARTY_NOTICES.md', 'SOURCE_CODE.md'];
const assets = [
  'index.html', 'editor.html', 'StoryForge.png', 'js/theme.js',
  ...['editor', 'home', 'files', 'layout', 'editor-features', 'theme', 'prose', 'table-read', 'profanity', 'writing-statistics'].map(name => `css/${name}.css`),
];

export async function copyNotices(output) {
  for (const file of legalFiles) await cp(resolve(root, file), resolve(output, file));
  const runtimeLicenses = ['fflate', 'orderedmap', 'rope-sequence', 'w3c-keyname',
    ...['commands', 'history', 'keymap', 'model', 'state', 'transform', 'view'].map(name => `prosemirror-${name}`)];
  await mkdir(resolve(output, 'notices'), { recursive: true });
  for (const pkg of runtimeLicenses) {
    await cp(resolve(root, 'node_modules', pkg, 'LICENSE'), resolve(output, 'notices', `${pkg}.txt`));
  }
}

export async function prepare(target, dev, watch = false) {
  const output = resolve(root, 'dist', target);
  await rm(output, { recursive: true, force: true });
  for (const asset of assets) {
    const path = resolve(output, asset);
    await mkdir(dirname(path), { recursive: true });
    await cp(resolve(root, asset), path);
  }
  await copyNotices(output);
  const options = {
    absWorkingDir: root, entryPoints: { library: 'js/storyforge/home.js', manuscript: 'js/storyforge/editor.js' },
    bundle: true, format: 'esm', target: ['safari15.6', 'chrome105', 'firefox103'], outdir: resolve(output, 'app'),
    define: { __STORYFORGE_DEV__: JSON.stringify(dev), __STORYFORGE_OFFLINE__: 'false' },
    legalComments: 'linked', minify: !dev,
  };
  if (watch) {
    const devBundle = await context(options);
    await devBundle.rebuild();
    await devBundle.watch();
  } else await build(options);
  console.log(`Prepared StoryForge ${target}: ${output}`);
  return output;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await prepare('desktop', process.argv.includes('--dev'));
}
