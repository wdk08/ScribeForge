import { access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
const directory = join(tmpdir(), 'scriptforge-piper-proof');
const model = process.env.SCRIPTFORGE_PIPER_MODEL || join(directory, 'en_US-lessac-low.onnx');
const config = process.env.SCRIPTFORGE_PIPER_CONFIG || join(directory, 'en_US-lessac-low.onnx.json');
try { await Promise.all([access(model), access(config)]); }
catch { console.error('Real voice fixture missing. Run npm run fetch:piper-test-voice, or set SCRIPTFORGE_PIPER_MODEL and SCRIPTFORGE_PIPER_CONFIG. No mock fallback is used.'); process.exit(1); }
const child = spawn(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', 'tests/browser/piper-proof.spec.js', 'tests/browser/onnx-voices.spec.js', '--workers=1', ...process.argv.slice(2)], {
  stdio: 'inherit', env: { ...process.env, SCRIPTFORGE_PIPER_MODEL: model, SCRIPTFORGE_PIPER_CONFIG: config },
});
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
