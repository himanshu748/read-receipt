import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { generateDemoRepo } from './make-demo-repo.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let editor = process.env.RR_EDITOR_EXECUTABLE;
if (!editor) {
  const cursor = '/Applications/Cursor.app/Contents/MacOS/Cursor';
  try { await access(cursor); editor = cursor; }
  catch { editor = await (await import('@vscode/test-electron')).downloadAndUnzipVSCode('stable'); }
}
await access(editor);
await mkdir(join(root,'work'),{recursive:true});
const scratch=await mkdtemp(join(root,'work/editor-e2e-'));
const repo=join(scratch,'repo');
// macOS IPC socket paths must stay below 104 bytes; the Documents path exceeds it.
const user=await mkdtemp(join(process.platform === 'darwin' ? '/tmp' : tmpdir(),'rr-editor-profile-'));
const evidence=join(scratch,'result.json');
const report=join(root,'work/editor-e2e-result.json');
await generateDemoRepo(repo);
await writeFile(join(repo,'.git/info/exclude'),'.readreceipt.json\n');
await writeFile(join(repo,'.readreceipt.json'),JSON.stringify({minSeconds:0.5,secondsPerLine:0.01,minLineSeconds:0.25}));
const {execFile}=await import('node:child_process');
await new Promise((done,fail)=>execFile('git',['add','.'],{cwd:repo},error=>error?fail(error):done()));
await mkdir(join(user,'User'),{recursive:true});
await writeFile(join(user,'User/settings.json'),JSON.stringify({
  'readReceipt.nodePath':process.execPath,'readReceipt.helper.mode':'replay',
  'telemetry.telemetryLevel':'off','update.mode':'none','extensions.autoUpdate':false,
  'workbench.startupEditor':'none','workbench.editor.enablePreview':false,
  'editor.fontSize':12,'editor.lineHeight':18,'editor.minimap.enabled':false,
  'window.restoreWindows':'none','files.autoSave':'off',
}));
const env={...process.env,RR_EDITOR_RESULT:evidence};delete env.ELECTRON_RUN_AS_NODE;
const args=[repo,'--new-window','--user-data-dir='+user,'--extensions-dir='+join(scratch,'extensions'),
  '--extensionDevelopmentPath='+join(root,'packages/extension'),
  '--extensionTestsPath='+join(root,'scripts/editor-tests.cjs'),
  '--disable-extensions','--disable-workspace-trust','--skip-welcome','--skip-release-notes'];
if (editor.includes('Cursor')) args.push('--classic');
const child=spawn(editor,args,{env,stdio:['ignore','pipe','pipe']});
// Keep potentially verbose editor diagnostics in the disposable local test profile.
let log='';child.stdout.on('data',chunk=>{log+=chunk;});child.stderr.on('data',chunk=>{log+=chunk;});
const timer=setTimeout(()=>child.kill('SIGTERM'),120_000);
try {
  const code=await new Promise((done,fail)=>{child.on('error',fail);child.on('exit',done);});
  child.stdout.destroy(); child.stderr.destroy();
  await writeFile(join(root,'work/editor-e2e.log'),log);
  const result=JSON.parse(await readFile(evidence,'utf8'));
  await writeFile(report,JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result,null,2));
  if(code!==0||!result.ok)process.exitCode=1;
} catch(error) {console.error(error.message);process.exitCode=1;await writeFile(join(root,'work/editor-e2e.log'),log);}
finally {clearTimeout(timer);await rm(scratch,{recursive:true,force:true});await rm(user,{recursive:true,force:true});}
