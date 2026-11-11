import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
const model = process.env.SCRIPTFORGE_PIPER_MODEL;
const config = process.env.SCRIPTFORGE_PIPER_CONFIG;
test('a real Piper ONNX model produces decoded playable speech in the browser', async ({ page }) => {
  test.skip(!model || !config, 'Set SCRIPTFORGE_PIPER_MODEL and SCRIPTFORGE_PIPER_CONFIG to run the real inference proof.');
  test.setTimeout(180000);
  await page.goto('/');
  await page.evaluate(() => { const input = document.createElement('input'); input.type = 'file'; input.multiple = true; input.id = 'proof-files'; document.body.append(input); });
  await page.locator('#proof-files').setInputFiles([model, config]);
  const result = await page.evaluate(async () => {
    const { PiperRuntime } = await import('/js/piper-runtime.js'); const { wavBlob, PIPER_TEST_TEXT } = await import('/js/piper-config.js');
    const files = [...document.getElementById('proof-files').files], voice = files.find(file => file.name.endsWith('.onnx')), configFile = files.find(file => file.name.endsWith('.json'));
    const runtime = new PiperRuntime();
    try {
      const started = performance.now(), output = await runtime.synthesize({ modelId: 'reference', model: voice, config: JSON.parse(await configFile.text()), text: PIPER_TEST_TEXT });
      const wav = wavBlob(output.samples, output.sampleRate), ctx = new AudioContext(), decoded = await ctx.decodeAudioData(await wav.arrayBuffer());
      const audio = document.createElement('audio'); audio.id = 'proof-audio'; audio.controls = true; audio.src = URL.createObjectURL(wav); document.body.append(audio);
      const button = document.createElement('button'); button.id = 'proof-play'; button.textContent = 'Play generated Piper audio'; button.onclick = () => audio.play(); document.body.append(button);
      const bytes = new Uint8Array(await wav.arrayBuffer()); let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
      await ctx.close();
      return { duration: decoded.duration, sampleRate: decoded.sampleRate, sampleCount: output.samples.length, phonemeCount: output.phonemeCount, rms: Math.sqrt(output.samples.reduce((sum, value) => sum + value * value, 0) / output.samples.length), elapsed: performance.now() - started, wav: btoa(binary) };
    } finally { runtime.dispose(); }
  });
  expect(result.duration).toBeGreaterThan(1); expect(result.rms).toBeGreaterThan(.001); expect(result.phonemeCount).toBeGreaterThan(20);
  await writeFile('test-results/piper-real-proof.wav', Buffer.from(result.wav, 'base64')); delete result.wav; console.log(JSON.stringify(result));
  await page.locator('#proof-play').click();
  await expect.poll(() => page.locator('#proof-audio').evaluate(audio => audio.ended), { timeout: 20000 }).toBe(true);
});
