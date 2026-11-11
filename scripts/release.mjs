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
const gitOutput = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
const git = (...args) => gitOutput(...args).trim();
const status = () => gitOutput('status', '--porcelain=v1', '-z', '--no-renames', '-uall').split('\0').filter(Boolean);
const normalize = contents => contents.replace(/\r\n/g, '\n');
const run = (program, args) => execFileSync(program, args, { cwd, stdio: 'inherit' });
const read = file => normalize(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'));
const readHead = file => normalize(gitOutput('show', `HEAD:${file}`));
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
    const data = JSON.parse(readHead(file));
    data.version = version;
    if (file === 'package-lock.json') data.packages[''].version = version;
    return JSON.stringify(data, null, 2) + '\n';
  };
  const replace = (file, before, after) => {
    const text = readHead(file);
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

function remoteRefs(tag) {
  return new Map(git('ls-remote', 'origin', 'refs/heads/main', `refs/tags/${tag}`).split('\n')
    .filter(Boolean).map(line => line.split('\t').reverse()));
}

function verifyRefs(tag, head, refs = remoteRefs(tag)) {
  if (refs.has(`refs/tags/${tag}`)) throw new Error(`The tag ${tag} already exists on origin.`);
  const remoteMain = refs.get('refs/heads/main');
  if (!remoteMain) throw new Error('The remote main branch could not be found.');
  git('merge-base', '--is-ancestor', remoteMain, head);
  const tagged = Boolean(git('tag', '--list', tag));
  if (tagged && git('rev-parse', `refs/tags/${tag}^{commit}`) !== head) {
    throw new Error(`The local tag ${tag} points to a different commit. Review it before retrying.`);
  }
  return tagged;
}

function expectedChanges(changes, files) {
  return changes.every(entry => {
    const code = entry.slice(0, 2);
    const file = entry.slice(3);
    if (!files.has(file) || ![' M', 'M ', 'A ', '??'].includes(code)) return false;
    const expected = files.get(file);
    if (read(file) !== expected) return false;
    return code[0] === ' ' || code === '??' || normalize(gitOutput('show', `:${file}`)) === expected;
  });
}

async function release() {
  if (!process.stdin.isTTY) throw new Error('Run npm run release from an interactive terminal.');
  if (git('branch', '--show-current') !== 'main') throw new Error('Switch to main before releasing.');
  for (const args of [['--all'], ['--push', '--all']]) {
    if (!originURLs.includes(git('remote', 'get-url', ...args, 'origin'))) throw new Error('Origin must point to wdk08/ScribeForge.');
  }
  const head = git('rev-parse', 'HEAD');
  const committed = JSON.parse(readHead('package.json')).version;
  const current = JSON.parse(read('package.json')).version;
  const currentTag = `v${current}`;
  const changes = status();
  const currentNotes = releaseNotesPath(currentTag);
  const files = current === committed ? new Map() : versionFiles(committed, releaseVersion(committed, current));
  // An interrupted run may have generated and staged the notes along with the bump.
  if (changes.includes(`?? ${currentNotes}`) || changes.includes(`A  ${currentNotes}`)) {
    files.set(currentNotes, read(currentNotes));
  }
  if (!expectedChanges(changes, files)) {
    throw new Error('Commit unrelated changes and retry with a clean working tree or a prepared version bump.');
  }

  const refs = remoteRefs(currentTag);
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    let tag = currentTag;
    if (refs.has(`refs/tags/${currentTag}`)) {
      if (changes.length) throw new Error(`The tag ${currentTag} already exists on origin. Review the pending version changes.`);
      const choice = (await prompt.question(`Current version ${current}. Enter patch, minor, major, or a custom version: `)).trim();
      const version = releaseVersion(current, choice);
      tag = `v${version}`;
      for (const [file, contents] of versionFiles(current, version)) files.set(file, contents);
    } else {
      console.log(`Resuming prepared release ${tag}.`);
    }

    const tagged = verifyRefs(tag, head, tag === currentTag ? refs : undefined);
    const notes = releaseNotesPath(tag);
    if (!existsSync(new URL(`../${notes}`, import.meta.url))) {
      const summary = (await prompt.question('One-line release summary: ')).trim();
      if (!summary) throw new Error('A release summary is required.');
      mkdirSync(new URL(`../${dirname(notes)}/`, import.meta.url), { recursive: true });
      files.set(notes, `# ScribeForge ${tag}\n\n${summary}\n`);
    }
    if (tagged && (files.size || changes.length)) {
      throw new Error(`The local tag ${tag} already exists. Review the prepared files before retrying.`);
    }
    if (git('rev-parse', 'HEAD') !== head || status().join('\0') !== changes.join('\0') || !expectedChanges(changes, files)) {
      throw new Error('The working tree changed during release preparation. Review it before retrying.');
    }
    for (const [file, contents] of files) write(file, contents);
    validate(tag);
    const confirmation = await prompt.question(`Type ${tag} to publish the release to wdk08/ScribeForge: `);
    if (confirmation.trim() !== tag) {
      console.log('Publication cancelled. The prepared release is available for another run.');
      return;
    }
    const changed = status();
    if (git('rev-parse', 'HEAD') !== head || !expectedChanges(changed, files) ||
      [...files].some(([file, contents]) => read(file) !== contents)) {
      throw new Error('The working tree changed during validation. Review it before releasing.');
    }
    if (verifyRefs(tag, head) !== tagged) throw new Error(`The local tag ${tag} changed during validation.`);
    if (changed.length) {
      run('git', ['add', '--', ...new Set(changed.map(entry => entry.slice(3)))]);
      run('git', ['commit', '-m', `release: ScribeForge ${tag}`]);
    }
    if (!tagged) run('git', ['tag', '-a', tag, '-m', `ScribeForge ${tag}`]);
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
