// Opt-in physical-camera test. Uses the normal extension commands and consent UI.
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

if (!process.argv.includes('--live-consent')) throw new Error('Pass --live-consent only after approving one physical camera session (<=90 seconds), derived-vitals transmission and existing-credit use.');
if (process.platform !== 'darwin') throw new Error('This interactive test runner currently supports macOS; the live adapter has separate platform support.');
const key = process.env.SMARTSPECTRA_API_KEY;
if (!key?.trim()) throw new Error('Set SMARTSPECTRA_API_KEY outside the repository.');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
await mkdir(join(root, 'work'), { recursive: true });
const scratch = await mkdtemp(join(root, 'work/live-editor-'));
const repo = join(scratch, 'rr-live-camera-fixture');
const profile = await mkdtemp('/tmp/rr-live-profile-');
const resultPath = join(scratch, 'result.json');
const progressPath = join(root, 'work/live-editor-progress.json');
await rm(progressPath, { force: true });
await mkdir(repo);
const git = (...args) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' });
git('init', '-q'); git('config', 'user.name', 'Read Receipt Camera Test Fixture');
git('config', 'user.email', 'read-receipt-fixture@example.invalid');
for (const file of ['first.js', 'second.js']) await writeFile(join(repo, file), 'export const reviewValue = 1;\n');
git('add', '.'); git('commit', '-qm', 'Disposable camera test baseline');
for (const file of ['first.js', 'second.js']) await writeFile(join(repo, file), 'export const reviewValue = 2;\n');
git('add', '.');
await mkdir(join(profile, 'User'), { recursive: true });
await writeFile(join(profile, 'User/settings.json'), JSON.stringify({
  'readReceipt.nodePath': process.execPath, 'readReceipt.helper.mode': 'live',
  'readReceipt.helper.cameraIndex': 0, 'telemetry.telemetryLevel': 'off',
  'update.mode': 'none', 'extensions.autoUpdate': false, 'window.restoreWindows': 'none',
  'workbench.startupEditor': 'none', 'workbench.editor.enablePreview': false,
}));
const previousClipboard = execFileSync('pbpaste');
execFileSync('pbcopy', { input: key.trim() });
const env = { ...process.env, RR_LIVE_RESULT: resultPath, RR_LIVE_PROGRESS: progressPath };
delete env.SMARTSPECTRA_API_KEY; delete env.ELECTRON_RUN_AS_NODE;
const editor = process.env.RR_EDITOR_EXECUTABLE ?? '/Applications/Cursor.app/Contents/MacOS/Cursor';
const args = [repo, '--new-window', '--user-data-dir=' + profile, '--extensions-dir=' + join(scratch, 'extensions'),
  '--extensionDevelopmentPath=' + join(root, 'packages/extension'), '--extensionTestsPath=' + join(root, 'scripts/live-editor-tests.cjs'),
  '--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes'];
if (editor.includes('Cursor')) args.push('--classic');
const child = spawn(editor, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
// Diagnostics can contain sensitive/native output: do not persist raw editor logs.
child.stdout.resume(); child.stderr.resume();
const timer = setTimeout(() => child.kill('SIGTERM'), 240_000);
try {
  const code = await new Promise((done, fail) => { child.once('error', fail); child.once('exit', done); });
  child.stdout.destroy(); child.stderr.destroy();
  const result = JSON.parse(await readFile(resultPath, 'utf8'));
  await writeFile(join(root, 'work/live-editor-e2e-result.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
  if (code !== 0 || !result.ok) process.exitCode = 1;
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally {
  clearTimeout(timer); execFileSync('pbcopy', { input: previousClipboard });
  await rm(profile, { recursive: true, force: true }); await rm(scratch, { recursive: true, force: true });
}
