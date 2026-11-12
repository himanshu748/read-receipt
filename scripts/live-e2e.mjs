// Physical SDK/helper + tracker/Git integration. Viewport input is simulated, not an editor test.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { ReceiptStore, loadConfig, readDiff } from '@rr/core';
import helperModule from '../packages/extension/out/helperClient.cjs';
import trackerModule from '../packages/extension/out/tracker.cjs';

if (!process.argv.includes('--live-consent')) throw new Error('Explicit approval of one <=90 second camera test, derived-vitals transmission and existing-credit use is required. Pass --live-consent.');
if (!process.env.SMARTSPECTRA_API_KEY?.trim()) throw new Error('SMARTSPECTRA_API_KEY is required outside the repository.');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const exec = promisify(execFile), delay = ms => new Promise(done => setTimeout(done, ms));
await mkdir(join(root, 'work'), { recursive: true });
const scratch = await mkdtemp(join(root, 'work/live-native-'));
const repo = join(scratch, 'repo'); await mkdir(repo);
const report = { mode: 'physical camera; simulated editor viewport', sdk: '3.5.0',
  maxCameraSeconds: 90, checks: [], previewFrames: 0, everEyesOn: false, ok: false };
let helper, firstError, tracker;
const ownedPids = new Set();
const helperPath = join(root, 'packages/extension/runtime/helper/main.js');
const findHelpers = async () => {
  try { const { stdout } = await exec('pgrep', ['-f', helperPath]); return stdout.trim().split(/\s+/).map(Number).filter(Number.isInteger); }
  catch { return []; }
};
assert.deepEqual(await findHelpers(), [], 'no other task-owned native helper is running');
const git = (...args) => exec('git', args, { cwd: repo });
try {
  await git('init', '-q'); await git('config', 'user.name', 'Read Receipt Live Test Fixture');
  await git('config', 'user.email', 'read-receipt-fixture@example.invalid');
  for (const file of ['first.js', 'second.js']) await writeFile(join(repo, file), 'export const value = 1;\n');
  await git('add', '.'); await git('commit', '-qm', 'Disposable native camera test baseline');
  for (const file of ['first.js', 'second.js']) await writeFile(join(repo, file), 'export const value = 2;\n');
  await git('add', '.');
  await exec(process.execPath, [join(root, 'packages/extension/runtime/hooks/cli.js'), 'install'], { cwd: repo });
  await assert.rejects(git('commit', '-qm', 'Must block before live review'), error => /unread staged changes/.test(error.stderr));
  report.checks.push('actual Git commit blocked with no receipts');
  const hunks = await readDiff(repo, 'worktree'); assert.equal(hunks.length, 2);
  const { HelperClient } = helperModule, { ReceiptTracker } = trackerModule;
  tracker = new ReceiptTracker(await ReceiptStore.open(repo), loadConfig(repo)); tracker.setHunks(hunks);
  helper = new HelperClient({ nodePath: process.execPath, helperPath, mode: 'live',
    apiKey: process.env.SMARTSPECTRA_API_KEY, liveConsent: true, camera: 0 });
  helper.onError(error => { firstError ??= error; tracker.resetClock(); });
  helper.onState(state => { report.everEyesOn ||= state.eyesOn; report.lastPauseReasons = state.pauseReasons; if (!state.eyesOn) tracker.resetClock(); });
  helper.onPhase(phase => { if (phase.phase !== 'running') tracker.resetClock(); });
  helper.onPreviewFrame(() => { report.previewFrames++; });
  await helper.connect(); for (const pid of await findHelpers()) ownedPids.add(pid);
  console.log('Starting the single approved physical camera session; no frames or raw metrics will be saved.');
  const started = Date.now(); helper.send({ type: 'start' }); helper.send({ type: 'preview', enabled: true, maxFps: 5 });
  const deadline = started + 85_000;
  const tick = visible => tracker.tick({ nowMs: Date.now(), focused: true, panelVisible: true,
    viewer: helper.state, editors: visible.map(hunk => ({ file: hunk.file, dirty: false,
      ranges: [{ start: hunk.range.start, end: hunk.range.end }] })) });
  const until = async (condition, visible = []) => {
    while (!condition()) {
      if (firstError) throw new Error(firstError.message);
      if (helper.phase === 'stopped' || helper.phase === 'error' || Date.now() > deadline) throw new Error('Live viewer unavailable before the bounded session ended.');
      tick(visible); await delay(50);
    }
  };
  await until(() => helper.state?.source === 'live' && helper.state.eyesOn);
  report.checks.push('real native camera SDK, calibrated face and pulse/pressure produced live eyes-on');
  await until(() => tracker.summary.read === 1, [hunks[0]]); await tracker.flush();
  await assert.rejects(git('commit', '-qm', 'Must block unviewed second file'), error => /second\.js/.test(error.stderr));
  report.checks.push('live viewer plus simulated first-file visibility earned one receipt; unviewed file blocked Git');
  await until(() => tracker.summary.read === 2, [hunks[1]]); await tracker.flush();
  await git('commit', '-qm', 'Disposable physical camera and simulated viewport integration');
  const { stdout } = await git('log', '-1', '--format=%B');
  report.trailer = stdout.split('\n').find(line => line.startsWith('Read-Receipt:'));
  assert.match(report.trailer, /2\/2 hunks, .* eyes-on, live viewer/);
  assert.ok(report.previewFrames > 0, 'native preview reached client in memory');
  report.checks.push('two receipts allowed actual Git commit with live viewer trailer; in-memory preview received');
  report.sessionElapsedSeconds = Math.round((Date.now() - started) / 100) / 10;
  helper.send({ type: 'stop' }); assert.equal(helper.state, null);
  report.checks.push('Stop immediately invalidated client viewer state'); report.ok = true;
} catch (error) { report.error = error.message; if (firstError) report.helperError = firstError; process.exitCode = 1; }
finally {
  await helper?.shutdown();
  const stoppedBy = Date.now() + 3000;
  while ([...ownedPids].some(pid => { try { process.kill(pid, 0); return true; } catch { return false; } }) && Date.now() < stoppedBy) await delay(50);
  report.helperAbsentAfterStop = [...ownedPids].every(pid => { try { process.kill(pid, 0); return false; } catch { return true; } });
  if (!report.helperAbsentAfterStop) { report.ok = false; process.exitCode = 1; }
  await writeFile(join(root, 'work/live-e2e-result.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2)); await rm(scratch, { recursive: true, force: true });
}
