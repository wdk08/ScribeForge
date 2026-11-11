// Explicit opt-in download of a real test voice. Never runs in the application.
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
const directory = join(tmpdir(), 'scriptforge-piper-proof');
const base = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/low/';
console.log('Reference voice terms: https://huggingface.co/rhasspy/piper-voices/blob/main/en/en_US/lessac/low/MODEL_CARD');
await mkdir(directory, { recursive: true });
for (const [file, expected] of [
  ['en_US-lessac-low.onnx', 'f7d01dde371555732c4c314111ac79672b1a5ce2fc19266ab42178fd8df7f375'],
  ['en_US-lessac-low.onnx.json', '45754dfdebb3b8661c3fc564713772deec6e064feeb5b4e9594857dc7305193a'],
  ['MODEL_CARD', null],
]) {
  const response = await fetch(`${base}${file}`); if (!response.ok) throw new Error(`Download failed: ${file} (${response.status})`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (expected && createHash('sha256').update(bytes).digest('hex') !== expected) throw new Error(`Reference checksum changed: ${file}. Review upstream before using another model.`);
  await writeFile(join(directory, file), bytes); console.log(`Stored ${join(directory, file)}`);
}
