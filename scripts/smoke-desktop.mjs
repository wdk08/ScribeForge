import { mkdtemp, readFile, copyFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
const binary = resolve(process.argv[2] ?? 'src-tauri/target/release/bundle/macos/ScriptForge.app/Contents/MacOS/scriptforge');
await access(binary);
const root = await mkdtemp(join(tmpdir(), 'scriptforge-desktop-smoke-'));
if (process.env.SCRIPTFORGE_LAYOUT_SOURCE) await copyFile(process.env.SCRIPTFORGE_LAYOUT_SOURCE, join(root, 'layout.fountain'));
if (process.env.SCRIPTFORGE_PIPER_MODEL && process.env.SCRIPTFORGE_PIPER_CONFIG) {
  await copyFile(process.env.SCRIPTFORGE_PIPER_MODEL, join(root, 'model.onnx'));
  await copyFile(process.env.SCRIPTFORGE_PIPER_CONFIG, join(root, 'model.onnx.json'));
}
for (const restart of [false, true]) {
  await new Promise((resolveRun, reject) => {
    const child = spawn(binary, [], { env: { ...process.env, SCRIPTFORGE_DESKTOP_SMOKE_ROOT: root, ...(restart ? { SCRIPTFORGE_DESKTOP_SMOKE_RESTART: '1' } : {}) }, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = ''; child.stdout.on('data', data => { log += data; }); child.stderr.on('data', data => { log += data; });
    const timer = setTimeout(() => { child.kill(); reject(new Error(`Native smoke test timed out. Evidence: ${root}\n${log.slice(-4000)}`)); }, 180000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('exit', async code => {
      clearTimeout(timer);
      try {
        const report = JSON.parse(await readFile(join(root, restart ? 'restart-report.json' : 'first-report.json'), 'utf8'));
        console.log(JSON.stringify({ phase: restart ? 'restart' : 'first launch', ...report }, null, 2));
        if (code !== 0 || !report.success) throw new Error(`Native smoke test failed. Evidence: ${root}\n${report.error ?? log.slice(-4000)}`);
        resolveRun();
      } catch (error) { reject(error); }
    });
  });
}
console.log(`Native smoke test evidence: ${root}`);
