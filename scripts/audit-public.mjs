import {execFileSync} from 'node:child_process';
import {readFile,lstat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
export async function auditPublic(){
 const files=[...new Set(execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{encoding:'utf8'}).split('\0').filter(Boolean))].sort(),findings=[];
 const rules=[['private key',/-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/],['GitHub token',/\b(?:gh[pousr]_[A-Za-z0-9_]{30,}|github_pat_[A-Za-z0-9_]{50,})\b/],['API credential',/\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{24,}|AIza[A-Za-z0-9_-]{30,}|AKIA[A-Z0-9]{16})\b/],['personal absolute path',/\/(?:Users|home)\/[A-Za-z0-9_.-]+\//]];
 for(const file of files){
  if(/(?:^|\/)(?:\.env(?:\..*)?|\.scriptforge-local\.json)$|\.(?:key|p12|pfx|pem|sqlite3?|db)$/i.test(file)&&file!=='.env.example'){findings.push({file,kind:'credential or user-data file'});continue;}
  if (/^(?:validation|user-data|local-data|screenplays|scripts-local|backups|recovery|node_modules|dist)\//.test(file)||file.startsWith('src-tauri/target/')){findings.push({file,kind:'excluded local/generated material staged'});continue;}
  if (/\.(?:fountain|pdf)$/i.test(file)&&! /^(?:tests\/fixtures\/|assets\/)/.test(file)){findings.push({file,kind:'document outside curated fixtures needs review'});continue;}
  const meta=await lstat(file);if(meta.isSymbolicLink()){findings.push({file,kind:'symlink needs publication review'});continue;}if(meta.size>4_000_000||/\.(?:wasm|data|png|ico|icns|ttf|wav|pdf)$/i.test(file))continue;
  const source=await readFile(file,'utf8');
  for(const [kind,pattern]of rules)if(pattern.test(source))findings.push({file,kind});
  // License notices legitimately include upstream author contact information.
  if(!/^(?:vendor\/|assets\/fonts\/)/.test(file)){
   const emails=source.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)??[];
   if(emails.some(email=>!/^\d+x\d+@\d+x\.png$/.test(email)&&!/@(?:example\.(?:com|org|net)|users\.noreply\.github\.com)$/.test(email)))findings.push({file,kind:'email needs manual review'});
  }
 }
 return {files,count:files.length,findings,notes:['Pattern scan and manual review are complementary; this is not a guarantee that all sensitive information is detectable.','Excluded local validation contains historical screenplay screenshots/PDFs and is not part of this source set.','GPLv3 source/notice and binary correspondence must be verified before publication.']};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){const result=await auditPublic();console.log(JSON.stringify(result,null,2));if(result.findings.length)process.exitCode=1;}
