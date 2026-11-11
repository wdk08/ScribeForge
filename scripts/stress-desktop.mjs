import { mkdtemp, readFile, writeFile, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
const root = await mkdtemp(join(tmpdir(), 'scriptforge-desktop-smoke-'));
const editorProof=process.argv.includes('--editor'),draftingProof=process.argv.includes('--drafting'),updateProof=process.argv.includes('--updates');
const fixtures=editorProof?await Promise.all([10,50,100,150].map(n=>readFile(`/tmp/scriptforge-editor-profile-fixtures/${n}.json`,'utf8').then(JSON.parse))):null;
await writeFile(join(root,'stress.js'), (editorProof?`window.scriptForgeProfileFixtures=${JSON.stringify(fixtures)};\n`:'')+await readFile(updateProof?'scripts/desktop-update-proof.js':draftingProof?'scripts/desktop-drafting-proof.js':editorProof?'scripts/desktop-editor-proof.js':'scripts/desktop-import-stress.js','utf8'));
console.log(`Stress evidence: ${root}`);
if(process.argv.includes('--manual')) await writeFile(join(root,'manual-shortcuts'),'1');
let app = resolve('src-tauri/target/release/bundle/macos/ScriptForge.app');
if(process.argv.includes('--isolated-app')) {
 const isolated=join(root,'ScriptForge Editor Proof.app');await cp(app,isolated,{recursive:true});
 const plist=join(isolated,'Contents/Info.plist');
 for(const [key,value] of Object.entries({CFBundleIdentifier:'com.scriptforge.editor-proof',CFBundleName:'ScriptForge Editor Proof',CFBundleDisplayName:'ScriptForge Editor Proof'}))execFileSync('/usr/libexec/PlistBuddy',['-c',`Set :${key} ${value}`,plist]);
 execFileSync('codesign',['--force','--deep','--sign','-',isolated]);app=isolated;
}
const binary = join(app,'Contents/MacOS/scriptforge');
const child = spawn(binary, [], {env:{...process.env,SCRIPTFORGE_DESKTOP_SMOKE_ROOT:root,SCRIPTFORGE_IMPORT_STRESS:'1'},stdio:['ignore','pipe','pipe']});
let log = ''; const memory=[];
child.stdout.on('data', data => {log+=data;}); child.stderr.on('data', data => {log+=data;});
const sample=setInterval(()=>{try{memory.push({at:Date.now(),rssKB:Number(execFileSync('ps',['-o','rss=','-p',String(child.pid)],{encoding:'utf8'}).trim())});}catch{}},2000);
const timer=setTimeout(()=>child.kill(),300000);
child.on('exit',async code=>{clearTimeout(timer);clearInterval(sample);await writeFile(join(root,'native.log'),log);await writeFile(join(root,'memory.json'),JSON.stringify(memory,null,2));try{const report=JSON.parse(await readFile(join(root,'first-report.json'),'utf8'));console.log(JSON.stringify({root,code,...report},null,2));process.exitCode=report.success?0:1;}catch{console.error(`Stress failed (${code}). Evidence: ${root}\n${log.slice(-3000)}`);process.exitCode=1;}});
