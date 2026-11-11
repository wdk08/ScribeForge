// Copyright (C) 2026 wdk08. SPDX-License-Identifier: GPL-3.0-only
// Install a real signed production update into a disposable app installation.
// Windows installation is restricted to a pristine GitHub-hosted runner.
// No production endpoint, private signing key or user data.
import { mkdtemp, readFile, writeFile, cp, mkdir, readdir, symlink, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, dirname, basename } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:https';

const windows = process.platform === 'win32';
if (!windows && process.platform !== 'darwin') throw new Error('Installed update testing supports macOS and Windows.');
if (windows && !(process.env.GITHUB_ACTIONS === 'true' && process.env.RUNNER_ENVIRONMENT === 'github-hosted' && process.env.GITHUB_REPOSITORY === 'wdk08/ScriptForge')) throw new Error('Windows installer tests require a disposable GitHub-hosted ScriptForge runner; never run against an existing personal installation.');
const source = process.cwd(), bundle = resolve(process.argv[2] ?? 'src-tauri/target/release/bundle');
const toVersion = JSON.parse(await readFile('package.json')).version;
const fromVersion = '1.0.0';
if (toVersion === fromVersion) throw new Error('Installed update validation requires a newer candidate than the published baseline.');
const target = process.argv[3];
const find = async directory => (await Promise.all((await readdir(directory, { withFileTypes: true })).map(entry => entry.isDirectory() ? find(join(directory, entry.name)) : [join(directory, entry.name)]))).flat();
const archives = (await find(bundle)).filter(path => path.endsWith(windows ? '.exe' : '.app.tar.gz'));
if (archives.length !== 1) throw new Error('Exactly one already verified production update archive is required.');
const archive = archives[0], signature = await readFile(`${archive}.sig`, 'utf8');
// macOS /var and /tmp are symlinks; the official updater correctly rejects
// executable paths through symlinks. Launch the disposable app by its real path.
const root = await realpath(await mkdtemp(join(tmpdir(), 'scriptforge-desktop-smoke-')));
console.log(`Installed update evidence: ${root}`);
const tree = join(root, 'source'); await mkdir(tree);
// Rebuild the actual published baseline source, not the candidate with an older
// version label. Only isolated diagnostics/endpoint configuration is patched.
execFileSync('tar', ['-xf', '-', '-C', tree], { input: execFileSync('git', ['archive', `v${fromVersion}`], { maxBuffer: 256 * 1024 * 1024 }) });
await symlink(resolve('node_modules'), join(tree, 'node_modules'), windows ? 'junction' : 'dir');
const replaceOnce = async (file, before, after) => {
  const text = await readFile(join(tree, file), 'utf8');
  if (text.split(before).length !== 2) throw new Error(`Isolated test patch no longer matches ${file}`);
  await writeFile(join(tree, file), text.replace(before, after));
};
// Only this disposable older test build may check for updates in diagnostics.
// The candidate production source/build and signed archive remain unmodified.
await replaceOnce('src-tauri/src/updates.rs', 'std::env::var_os("SCRIPTFORGE_DESKTOP_SMOKE_ROOT").is_none()\n        && ', '');
await writeFile(join(root, 'stress.js'), `window.scriptForgeUpdateProofVersions = ${JSON.stringify({ from: fromVersion, to: toVersion })};\n` + await readFile('scripts/installed-update-proof.js', 'utf8'));
const payload = await readFile(archive);
const openssl = windows ? join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Git/usr/bin/openssl.exe') : 'openssl';
execFileSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(root, 'tls.key'), '-out', join(root, 'tls.crt'), '-days', '1', '-subj', '/CN=localhost'], { stdio: 'ignore' });
let manifest;
const server = createServer({ key: await readFile(join(root, 'tls.key')), cert: await readFile(join(root, 'tls.crt')) }, (request, response) => {
  const body = request.url === '/latest.json' ? Buffer.from(JSON.stringify(manifest)) : request.url === '/payload' ? payload : null;
  if (!body) { response.writeHead(404); response.end(); return; }
  response.writeHead(200, { 'Content-Length': body.length }); response.end(body);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let windowsEnvironment = false;
// RunAsUser may restart from Explorer rather than inheriting the old app's env.
// Set only the diagnostic markers in this disposable VM's user environment and
// notify Explorer; always remove them afterward. Never change system trust/TLS.
const diagnosticEnvironment = enabled => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `
$ErrorActionPreference = 'Stop'
${enabled ? "if (Test-Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\ScriptForge') { throw 'Requires a pristine runner without an installed ScriptForge.' }" : ''}
[Environment]::SetEnvironmentVariable('SCRIPTFORGE_DESKTOP_SMOKE_ROOT', ${enabled ? '$env:SCRIPTFORGE_DESKTOP_SMOKE_ROOT' : '$null'}, 'User')
[Environment]::SetEnvironmentVariable('SCRIPTFORGE_IMPORT_STRESS', ${enabled ? "'1'" : '$null'}, 'User')
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class EnvironmentNotice { [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr SendMessageTimeout(IntPtr hwnd, uint msg, UIntPtr wparam, string lparam, uint flags, uint timeout, out UIntPtr result); }'
$result = [UIntPtr]::Zero
[EnvironmentNotice]::SendMessageTimeout([IntPtr]0xffff, 0x1a, [UIntPtr]::Zero, 'Environment', 2, 5000, [ref]$result) | Out-Null
`], { env: { ...process.env, SCRIPTFORGE_DESKTOP_SMOKE_ROOT: root }, stdio: 'pipe' });
try {
  const endpoint = `https://127.0.0.1:${server.address().port}`;
  manifest = { version: toVersion, notes: 'Isolated installed-app update proof', pub_date: new Date().toISOString(), platforms: { [windows ? 'windows-x86_64' : `darwin-${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}`]: { url: `${endpoint}/payload`, signature } } };
  const config = { version: fromVersion, bundle: { createUpdaterArtifacts: false }, plugins: { updater: { endpoints: [`${endpoint}/latest.json`], dangerousAcceptInvalidCerts: true } } };
  await writeFile(join(tree, 'update-test.json'), JSON.stringify(config));
  const targetRoot = resolve(process.env.SCRIPTFORGE_UPDATE_TEST_TARGET_ROOT ?? 'src-tauri/target');
  const args = ['build', '--config', 'update-test.json', '--bundles', windows ? 'nsis' : 'app', ...(target ? ['--target', target] : [])];
  const log = join(root, 'build.log');
  await new Promise((resolveBuild, reject) => {
    const child = spawn(process.execPath, [join(source, 'node_modules/@tauri-apps/cli/tauri.js'), ...args], { cwd: tree, env: { ...process.env, CARGO_TARGET_DIR: targetRoot, TAURI_SIGNING_PRIVATE_KEY: '', TAURI_SIGNING_PRIVATE_KEY_PASSWORD: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { output += data; });
    child.on('error', reject); child.on('exit', async code => { await writeFile(log, output); code === 0 ? resolveBuild() : reject(new Error(`Older test build failed; see ${log}\n${output.slice(-3000)}`)); });
  });
  const bundleOutput = join(targetRoot, ...(target ? [target] : []), 'release/bundle');
  const installed = join(root, 'installed', ...(windows ? [] : ['ScriptForge.app']));
  await mkdir(dirname(installed), { recursive: true });
  if (windows) {
    diagnosticEnvironment(true); windowsEnvironment = true;
    const installers = (await find(join(bundleOutput, 'nsis'))).filter(path => path.endsWith('.exe') && basename(path).includes(fromVersion));
    if (installers.length !== 1) throw new Error('Exactly one older test installer is required.');
    execFileSync(installers[0], ['/S', '/NS', `/D=${installed}`], { stdio: 'pipe', timeout: 120000 });
  } else await cp(join(bundleOutput, 'macos/ScriptForge.app'), installed, { recursive: true });
  const binary = join(installed, windows ? 'scriptforge.exe' : 'Contents/MacOS/scriptforge');
  const child = spawn(binary, [], { env: { ...process.env, SCRIPTFORGE_DESKTOP_SMOKE_ROOT: root, SCRIPTFORGE_IMPORT_STRESS: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { output += data; });
  child.on('error', error => { output += String(error); });
  const deadline = Date.now() + 240000; let report, checkpointCreated = false, editsCheckpointed = false;
  while (Date.now() < deadline) {
    try { report = JSON.parse(await readFile(join(root, 'first-report.json'), 'utf8')); break; } catch {}
    try {
      const checkpoint = JSON.parse(await readFile(join(root, 'scripts/Update checkpoint.fountain'), 'utf8'));
      if (!checkpointCreated) { checkpointCreated = true; console.log('Older installed app created its isolated file/recovery checkpoint.'); }
      if (!editsCheckpointed && checkpoint.checks?.length) { editsCheckpointed = true; console.log('Updater completed download/install preparation and checkpointed pending edits before restart.'); }
    } catch { /* The checkpoint appears only after the old app initializes. */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  await writeFile(join(root, 'native.log'), output);
  if (!report?.success || !report.installedAndRestarted) {
    const diagnostics = { checkpointCreated, editsCheckpointed, exitCode: child.exitCode, signalCode: child.signalCode };
    child.kill();
    throw new Error(`Installed update failed: ${JSON.stringify(report ?? { error: 'Timed out' })}. Diagnostics: ${JSON.stringify(diagnostics)}. Evidence: ${root}\nNative output: ${output.slice(-8000)}`);
  }
  if (!windows) execFileSync('codesign', ['--verify', '--deep', '--strict', installed]);
  console.log(JSON.stringify({ ...report, archive: basename(archive), evidence: root }, null, 2));
} finally { try { if (windowsEnvironment) diagnosticEnvironment(false); } finally { server.close(); } }
