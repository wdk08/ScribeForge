import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, openSync, readSync, closeSync } from 'node:fs';
import vm from 'node:vm';
import { parseFountain } from '../js/fountain.js';
import { fountainForSaving } from '../js/session.js';

const archive = process.env.SCRIPTFORGE_WRITERSOLO_ASAR ?? '/Applications/WriterSolo.app/Contents/Resources/app.asar';
test('installed WriterSolo Fountain importer recognizes exported elements and continuation states without metadata leakage', { skip: !existsSync(archive) }, () => {
  // Run the installed application's own importer, without launching it or changing user files.
  // No proprietary code is copied into this repository.
  const fd = openSync(archive, 'r'); let code;
  try {
    const prefix = Buffer.alloc(16); readSync(fd, prefix, 0, 16, 0);
    const bytes = Buffer.alloc(prefix.readUInt32LE(12)); readSync(fd, bytes, 0, bytes.length, 16);
    const header = JSON.parse(bytes.toString()), entry = header.files.script.files['legacy.bundle.js'];
    const bundle = Buffer.alloc(entry.size); readSync(fd, bundle, 0, bundle.length, 8 + prefix.readUInt32LE(4) + Number(entry.offset));
    const source = bundle.toString(), marker = source.indexOf('this.fountain=a');
    assert.ok(marker >= 0, 'Installed WriterSolo importer layout changed; update this adapter.');
    code = source.slice(source.lastIndexOf('(function(){', marker), source.indexOf('}).call(this);', marker) + '}).call(this);'.length);
  } finally { closeSync(fd); }
  const context = { module: { exports: {} }, special_formats: ['bold', 'italic', 'underline'], $: { trim: value => value.trim() }, _: { isUndefined: value => value === undefined } };
  vm.runInNewContext(code, context, { timeout: 2000 });
  const input = 'FADE IN:\n\nInt. house - night\n\nMorgan looks over.\n\nMORGAN (V.O.)\n(quietly)\nI hear it too.\n\nMorgan turns a dial.\n\nMORGAN (O.S.)\nThere it is... I hear a signal.\n\nCUT TO:';
  const doc = parseFountain(input), cues = doc.elements.filter(el => el.type === 'character');
  cues[0].continuation = 'off'; cues[1].continuation = 'on';
  const exported = fountainForSaving(doc), tokens = JSON.parse(JSON.stringify(context.module.exports.parse(exported, true).tokens));
  const content = tokens.filter(token => ['transition', 'scene_heading', 'action', 'character', 'parenthetical', 'dialogue'].includes(token.type));
  assert.deepEqual(content.map(token => [token.type, token.text]), [
    ['transition', 'FADE IN:'], ['scene_heading', 'INT. HOUSE - NIGHT'], ['action', 'Morgan looks over.'],
    ['character', 'MORGAN (V.O.)'], ['parenthetical', '(quietly)'], ['dialogue', 'I hear it too.'],
    ['action', 'Morgan turns a dial.'], ['character', "MORGAN (O.S.) (CONT'D)"], ['dialogue', 'There it is... I hear a signal.'], ['transition', 'CUT TO:'],
  ]);
  assert.doesNotMatch(JSON.stringify(tokens), /ScriptForge|continuations v1|"state"/);
  const old = input + '\n\n/* ScriptForge continuations v1\n[{"index":1,"text":"MORGAN","state":"on"}]\n*/\n';
  assert.match(JSON.stringify(context.module.exports.parse(old, true).tokens), /ScriptForge continuations v1/);
});
