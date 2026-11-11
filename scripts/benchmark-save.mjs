// Synthetic screenplay only; never opens or writes a user's document.
import { createDocument, createElement as el } from '../js/document.js';
import { fountainForSaving } from '../js/session.js';
import { parseFountain } from '../js/fountain.js';
const doc = createDocument({ elements: Array.from({ length: 400 }, (_, i) => [el('scene', `INT. ROOM ${i} - DAY`), el('action', 'The room is quiet. '.repeat(14)), el('character', 'NOAH'), el('dialogue', 'We should leave before the signal disappears. '.repeat(6))]).flat() });
const imported = parseFountain(fountainForSaving(doc)), result = {};
for (const [name, value] of [['canonical', doc], ['imported', imported]]) {
  const samples = []; let source;
  for (let i = 0; i < 7; i++) { const start = performance.now(); source = fountainForSaving(value); samples.push(Number((performance.now() - start).toFixed(2))); }
  result[name] = { scenes: 400, bytes: Buffer.byteLength(source), milliseconds: samples, medianMs: [...samples].sort((a, b) => a - b)[3] };
}
console.log(JSON.stringify(result, null, 2));
