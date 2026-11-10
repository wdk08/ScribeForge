import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { releaseInstallers, releasePage } from '../js/scribeforge/browser-download.js';

export const targets = {
  'aarch64-apple-darwin': { bundle: 'dmg', extension: '.dmg', platform: 'darwin-aarch64' },
  'x86_64-apple-darwin': { bundle: 'dmg', extension: '.dmg', platform: 'darwin-x86_64' },
  'x86_64-pc-windows-msvc': { bundle: 'nsis', extension: '.exe', platform: 'windows-x86_64' },
};
const repo = releasePage.replace(/\/latest$/, '');
const updaterEndpoint = `${releasePage}/download/latest.json`;

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const entriesByPath = await Promise.all(entries.map(entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return filesUnder(path);
    return entry.isFile() ? [path] : [];
  }));
  return entriesByPath.flat();
}

function only(paths, accept, label) {
  const matches = paths.filter(accept);
  if (matches.length !== 1) throw new Error(`Expected one ${label}, found ${matches.length}.`);
  return matches[0];
}

async function packageDesktop(target) {
  const platform = targets[target];
  if (!platform) throw new Error('Invalid ScribeForge release target.');
  const environment = { ...process.env };
  for (const [key, value] of Object.entries(environment)) {
    if (value === '' && /^(?:APPLE_|TAURI_SIGNING_|WINDOWS_CERTIFICATE)/.test(key)) delete environment[key];
  }
  const mac = platform.bundle === 'dmg';
  const macSigned = Boolean(mac && environment.APPLE_CERTIFICATE && environment.APPLE_CERTIFICATE_PASSWORD && environment.APPLE_SIGNING_IDENTITY);
  const macNotarized = Boolean(macSigned && environment.APPLE_ID && environment.APPLE_PASSWORD && environment.APPLE_TEAM_ID);
  const windowsSigned = Boolean(!mac && environment.SCRIBEFORGE_WINDOWS_THUMBPRINT);
  const signedUpdates = Boolean(environment.TAURI_SIGNING_PRIVATE_KEY && environment.SCRIBEFORGE_UPDATER_PUBLIC_KEY);
  if (!macSigned) {
    for (const key of Object.keys(environment)) if (key.startsWith('APPLE_')) delete environment[key];
  } else if (!macNotarized) {
    for (const key of ['APPLE_ID', 'APPLE_PASSWORD', 'APPLE_TEAM_ID']) delete environment[key];
  }
  if (!signedUpdates) {
    delete environment.TAURI_SIGNING_PRIVATE_KEY;
    delete environment.TAURI_SIGNING_PRIVATE_KEY_PASSWORD;
    console.warn('ScribeForge updater credentials are incomplete. Packaging manual installers only.');
  }
  if (mac && !macSigned) console.warn('ScribeForge is using ad-hoc signing. The macOS installer will not be notarized.');
  if (!mac && !windowsSigned) console.warn('The ScribeForge Windows installer will be unsigned.');

  const config = { bundle: { createUpdaterArtifacts: signedUpdates } };
  if (mac && !macSigned) config.bundle.macOS = { signingIdentity: '-' };
  if (windowsSigned) config.bundle.windows = {
    certificateThumbprint: environment.SCRIBEFORGE_WINDOWS_THUMBPRINT,
    digestAlgorithm: 'sha256',
    timestampUrl: 'http://timestamp.digicert.com',
  };
  if (signedUpdates) config.plugins = { updater: { endpoints: [updaterEndpoint], pubkey: environment.SCRIBEFORGE_UPDATER_PUBLIC_KEY } };
  const configPath = resolve(process.env.RUNNER_TEMP || 'dist', 'scribeforge-release-config.json');
  await writeFile(configPath, JSON.stringify(config));
  execFileSync(process.execPath, [resolve('node_modules/@tauri-apps/cli/tauri.js'), 'build',
    '--target', target, '--bundles', platform.bundle, '--config', configPath], { stdio: 'inherit', env: environment });
  const bundle = resolve(environment.CARGO_TARGET_DIR || 'src-tauri/target', target, 'release', 'bundle');
  const files = await filesUnder(bundle);
  const installer = only(files, file => file.endsWith(platform.extension) && file.includes(`${platform.bundle}${process.platform === 'win32' ? '\\' : '/'}`), `${target} installer`);
  const output = resolve('dist/release-package');
  await mkdir(output, { recursive: true });
  await copyFile(installer, join(output, basename(installer)));
  let updateAsset;
  if (signedUpdates) {
    const updater = mac ? only(files, file => file.endsWith('.app.tar.gz'), `${target} updater archive`) : installer;
    updateAsset = basename(updater);
    if (updater !== installer) await copyFile(updater, join(output, updateAsset));
    await copyFile(`${updater}.sig`, join(output, `${updateAsset}.sig`));
  }
  await writeFile(join(output, 'metadata.json'), JSON.stringify({
    target, installer: basename(installer), updateAsset, signing: mac ? (macNotarized ? 'notarized' : macSigned ? 'signed' : 'ad-hoc') : (windowsSigned ? 'signed' : 'unsigned'),
  }));
}

export async function assembleRelease(input, output, tag, publicKey) {
  const version = tag.match(/^v(\d+\.\d+\.\d+)(?:-scribeforge)?$/)?.[1];
  if (!version) throw new Error('Invalid release tag.');
  const files = await filesUnder(input);
  const descriptors = files.filter(file => basename(file) === 'metadata.json');
  if (descriptors.length !== Object.keys(targets).length) throw new Error('A package descriptor is required for each release target.');
  const assets = [];
  const platforms = {};
  const targetsSeen = new Set();
  const copied = new Set();
  const signingNotes = [];
  await mkdir(output, { recursive: true });
  async function include(directory, name) {
    if (typeof name !== 'string' || basename(name) !== name || !name.startsWith('ScribeForge')) throw new Error('Invalid ScribeForge artifact name.');
    const source = join(directory, name);
    const info = await stat(source);
    if (!info.isFile() || info.size === 0 || copied.has(name)) throw new Error(`Invalid or duplicate release asset: ${name}`);
    copied.add(name);
    await copyFile(source, join(output, name));
    return {
      name, size: info.size, state: 'uploaded', browser_download_url: `${repo}/download/${tag}/${encodeURIComponent(name)}`,
    };
  }
  for (const descriptor of descriptors) {
    const { target, installer, updateAsset, signing } = JSON.parse(await readFile(descriptor, 'utf8'));
    if (!Object.hasOwn(targets, target) || targetsSeen.has(target)) throw new Error('Invalid or duplicate release target.');
    targetsSeen.add(target);
    const directory = dirname(descriptor);
    const asset = await include(directory, installer);
    assets.push(asset);
    signingNotes.push(`- ${targets[target].platform} installer: ${signing}`);
    if (updateAsset) {
      if (!publicKey) throw new Error('The ScribeForge updater public key is missing.');
      const update = updateAsset === installer ? asset : await include(directory, updateAsset);
      await include(directory, `${updateAsset}.sig`);
      const signature = (await readFile(join(directory, `${updateAsset}.sig`), 'utf8')).trim();
      const pubkeyText = Buffer.from(publicKey.trim(), 'base64').toString('utf8');
      const sigText = Buffer.from(signature, 'base64').toString('utf8');
      const pubkeyLine = pubkeyText.split(/\r?\n/)[1];
      if (!pubkeyLine || !sigText.startsWith('untrusted comment:')) throw new Error('Invalid ScribeForge updater key or signature format.');
      const verificationSignature = join(directory, 'verify.minisig');
      await writeFile(verificationSignature, sigText);
      execFileSync('minisign', ['-Vm', join(directory, updateAsset), '-P', pubkeyLine, '-x', verificationSignature], { stdio: 'inherit' });
      platforms[targets[target].platform] = { signature, url: update.browser_download_url };
    }
  }
  releaseInstallers({ tag_name: tag, assets });
  const manifestCount = Object.keys(platforms).length;
  if (manifestCount && manifestCount !== Object.keys(targets).length) throw new Error('Signed updater assets are incomplete.');
  if (manifestCount) {
    await writeFile(join(output, 'latest.json'), JSON.stringify({ version, pub_date: new Date().toISOString(), platforms }, null, 2) + '\n');
  }
  return signingNotes.sort();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, arg] = process.argv.slice(2);
  if (command === 'package') await packageDesktop(arg);
  else if (command === 'assemble') {
    const notes = await assembleRelease('dist/downloads', 'dist/release-assets', arg, process.env.SCRIBEFORGE_UPDATER_PUBLIC_KEY);
    const releaseNotes = await readFile(`releases/${arg}.md`, 'utf8');
    await writeFile('dist/release-notes.md', `${releaseNotes.trimEnd()}\n\n### Installer signing\n\n${notes.join('\n')}\n`);
  } else throw new Error('Expected package or assemble.');
}
