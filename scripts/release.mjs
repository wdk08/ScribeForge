import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { releaseNotesPath } from './release-desktop.mjs';

const cwd = fileURLToPath(new URL('..', import.meta.url));
const repo = 'https://github.com/wdk08/ScribeForge';
const originURLs = [repo, `${repo}.git`, 'git@github.com:wdk08/ScribeForge.git', 'ssh://git@github.com/wdk08/ScribeForge.git'];
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
const run = (program, args) => execFileSync(program, args, { cwd, stdio: 'inherit' });
const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const write = (file, contents) => writeFileSync(new URL(`../${file}`, import.meta.url), contents);
const npm = (...args) => run(process.execPath, [process.env.npm_execpath, 'run', ...args]);

function validate(tag) {
  npm('verify:release', '--', tag);
  for (const script of ['check', 'test', 'build:browser', 'test:pages', 'test:browser', 'test:desktop']) npm(script);
}

function releaseVersion(current, choice) {
  const parts = current.split('.').map(Number);
  const index = ['major', 'minor', 'patch'].indexOf(choice);
  if (index >= 0) {
    parts[index]++;
    parts.fill(0, index + 1);
    return parts.join('.');
  }
  if (!versionPattern.test(choice)) throw new Error('Choose patch, minor, major, or a version such as 2.1.0.');
  const difference = choice.split('.').map((part, i) => Number(part) - parts[i]).find(Boolean);
  if (!(difference > 0)) throw new Error('The custom version must be greater than the current version.');
  return choice;
}

function versionFiles(current, version) {
  const json = file => {
    const data = JSON.parse(read(file));
    data.version = version;
    if (file === 'package-lock.json') data.packages[''].version = version;
    return JSON.stringify(data, null, 2) + '\n';
  };
  const replace = (file, before, after) => {
    const text = read(file);
    if (!text.includes(before)) throw new Error(`Unexpected version in ${file}.`);
    return text.replace(before, after);
  };
  const cargoVersion = `name = "scribeforge"\nversion = "${current}"`;
  const nextCargoVersion = `name = "scribeforge"\nversion = "${version}"`;
  return new Map([
    ...['package.json', 'package-lock.json', 'src-tauri/tauri.conf.json'].map(file => [file, json(file)]),
    ...['src-tauri/Cargo.toml', 'src-tauri/Cargo.lock'].map(file => [file, replace(file, cargoVersion, nextCargoVersion)]),
    ['index.html', replace('index.html', `<span>ScribeForge ${current}</span>`, `<span>ScribeForge ${version}</span>`)],
    ['README.md', replace('README.md', `# ScribeForge ${current}\n`, `# ScribeForge ${version}\n`)],
  ]);
}

function verifyRefs(tag) {
  const refs = new Map(git('ls-remote', 'origin', 'refs/heads/main', `refs/tags/${tag}`).split('\n')
    .filter(Boolean).map(line => line.split('\t').reverse()));
  if (refs.has(`refs/tags/${tag}`) || git('tag', '--list', tag)) throw new Error(`The tag ${tag} already exists.`);
  const remoteMain = refs.get('refs/heads/main');
  if (!remoteMain) throw new Error('The remote main branch could not be found.');
  git('merge-base', '--is-ancestor', remoteMain, 'HEAD');
}

async function release() {
  if (!process.stdin.isTTY) throw new Error('Run npm run release from an interactive terminal.');
  if (git('branch', '--show-current') !== 'main') throw new Error('Switch to main before releasing.');
  if (git('status', '--porcelain')) throw new Error('Commit your changes and use a clean working tree before releasing.');
  for (const args of [['--all'], ['--push', '--all']]) {
    if (!originURLs.includes(git('remote', 'get-url', ...args, 'origin'))) throw new Error('Origin must point to wdk08/ScribeForge.');
  }
  const current = JSON.parse(read('package.json')).version;
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const choice = (await prompt.question(`Current version ${current}. Enter patch, minor, major, or a custom version: `)).trim();
    const version = releaseVersion(current, choice);
    const tag = `v${version}`;
    verifyRefs(tag);
    const files = versionFiles(current, version);
    const notes = releaseNotesPath(tag);
    if (!existsSync(new URL(`../${notes}`, import.meta.url))) {
      const summary = (await prompt.question('One-line release summary: ')).trim();
      if (!summary) throw new Error('A release summary is required.');
      mkdirSync(new URL(`../${dirname(notes)}/`, import.meta.url), { recursive: true });
      files.set(notes, `# ScribeForge ${tag}\n\n${summary}\n`);
    }
    const head = git('rev-parse', 'HEAD');
    for (const [file, contents] of files) write(file, contents);
    validate(tag);
    const confirmation = await prompt.question(`Type ${tag} to commit and push the release to wdk08/ScribeForge: `);
    if (confirmation.trim() !== tag) {
      console.log('Publication cancelled. The version changes and notes are available for review.');
      return;
    }
    const changed = git('status', '--porcelain', '-uall').split('\n').filter(Boolean);
    if (git('rev-parse', 'HEAD') !== head || changed.some(line => !files.has(line.slice(3))) ||
      [...files].some(([file, contents]) => read(file) !== contents)) {
      throw new Error('The working tree changed during validation. Review it before releasing.');
    }
    verifyRefs(tag);
    run('git', ['add', '--', ...files.keys()]);
    run('git', ['commit', '-m', `release: ScribeForge ${tag}`]);
    run('git', ['tag', '-a', tag, '-m', `ScribeForge ${tag}`]);
    run('git', ['push', '--atomic', 'origin', 'HEAD:refs/heads/main', `refs/tags/${tag}`]);
    console.log(`GitHub Actions will build and publish ${repo}/releases/tag/${tag}`);
  } finally {
    prompt.close();
  }
}

try {
  const [flag, tag, ...rest] = process.argv.slice(2);
  if (flag === '--check' && tag && !rest.length) validate(tag);
  else if (flag === undefined) await release();
  else throw new Error('Usage: npm run release [-- --check vX.Y.Z]');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
