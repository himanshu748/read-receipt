import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { ReceiptStore, loadConfig, readDiff } from '@rr/core';
import helperModule from '../packages/extension/out/helperClient.cjs';
import trackerModule from '../packages/extension/out/tracker.cjs';
import { generateDemoRepo } from './make-demo-repo.mjs';
import { reviewRecording } from './replay-fixture.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { HelperClient } = helperModule;
const { ReceiptTracker } = trackerModule;
const exec = promisify(execFile);
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
await mkdir(join(root, 'work'), { recursive: true });
const scratch = await mkdtemp(join(root, 'work/replay-e2e-'));
const repo = join(scratch, 'repo');
const evidence = { mode: 'synthetic replay', checks: [] };
let helper;
try {
  await generateDemoRepo(repo);
  await writeFile(join(repo, '.git/info/exclude'), '.readreceipt.json\n');
  await writeFile(join(repo, '.readreceipt.json'), JSON.stringify({ minSeconds: 0.3, secondsPerLine: 0.01, minLineSeconds: 0.15 }));
  const git = (...args) => exec('git', args, { cwd: repo });
  await git('add', '.');
  const hunks = await readDiff(repo, 'worktree');
  assert.equal(hunks.length, 6);
  assert.deepEqual(hunks.map((h) => h.id), (await readDiff(repo, 'staged')).map((h) => h.id));
  const cli = join(root, 'packages/extension/runtime/hooks/cli.js');
  await exec(process.execPath, [cli, 'install'], { cwd: repo });
  const blocked = async () => {
    try { await git('commit', '--quiet', '-m', 'Synthetic replay review'); }
    catch (error) {
      assert.match(error.stderr, /unread staged changes/);
      return error.stderr;
    }
    assert.fail('Unread staged changes were committed');
  };
  await blocked(); evidence.checks.push('actual Git commit blocked before review');

  const recording = join(scratch, 'review.json');
  await writeFile(recording, JSON.stringify(reviewRecording(120_000)));
  helper = new HelperClient({ nodePath: process.execPath,
    helperPath: join(root, 'packages/extension/runtime/helper/main.js'),
    mode: 'replay', replayFile: recording, speed: 10 });
  const store = await ReceiptStore.open(repo);
  const tracker = new ReceiptTracker(store, loadConfig(repo));
  tracker.setHunks(hunks);
  helper.onState((state) => { if (!state.eyesOn) tracker.resetClock(); });
  helper.onPhase((phase) => { if (phase.phase !== 'running') tracker.resetClock(); });
  await helper.connect(); helper.send({ type: 'start' });
  const visible = (list) => list.map((hunk) => ({ file: hunk.file, dirty: false,
    ranges: [{ start: hunk.range.start, end: hunk.range.end }] }));
  const tick = (editors, options = {}) => tracker.tick({ nowMs: Date.now(),
    focused: true, panelVisible: true, viewer: helper.state, editors, ...options });
  const until = async (condition, action, timeout = 7000) => {
    const deadline = Date.now() + timeout;
    while (!condition()) {
      if (Date.now() > deadline) throw new Error('Timed out waiting for replay workflow state');
      action(); await delay(50);
    }
  };
  await until(() => helper.state?.eyesOn === true, () => {});
  evidence.checks.push('real helper CLI, authenticated WebSocket and calibration produced replay eyesOn');
  for (let i = 0; i < 5; i++) { tick(visible(hunks), { focused: false }); await delay(50); }
  assert.equal(tracker.summary.read, 0); evidence.checks.push('unfocused editor did not earn receipts');
  const safe = hunks.filter((h) => h.file !== 'auth.js');
  await until(() => tracker.summary.read === 5, () => tick(visible(safe)));
  await tracker.flush();
  const unread = await blocked();
  assert.match(unread, /auth\.js:40/);
  evidence.checks.push('five viewed hunks read; offscreen auth.js:40 still blocked the actual commit');
  tick(visible(hunks), { panelVisible: false });
  await delay(200);
  tick(visible(hunks), { panelVisible: false });
  assert.equal(tracker.summary.read, 5);
  evidence.checks.push('hidden review panel did not earn remaining receipt');
  await until(() => tracker.summary.read === 6, () => tick(visible(hunks)));
  await tracker.flush();
  const disk = JSON.parse(await readFile(store.path, 'utf8'));
  assert.equal(Object.keys(disk.receipts).length, 6);
  assert.ok(Object.values(disk.receipts).every((r) => r.source === 'replay'));
  await git('commit', '--quiet', '-m', 'Synthetic replay review');
  const { stdout: message } = await git('log', '-1', '--format=%B');
  assert.match(message, /Read-Receipt: 6\/6 hunks, .* eyes-on, replay viewer/);
  assert.doesNotMatch(message, /live viewer|overridden|unverified/);
  evidence.checks.push('all six persisted replay receipts allowed actual Git commit with honest trailer');
  evidence.trailer = message.split('\n').find((line) => line.startsWith('Read-Receipt:'));

  await writeFile(join(repo, 'auth.js'), (await readFile(join(repo, 'auth.js'), 'utf8')).replace('sk_live_DEMO_NOT_A_REAL_CREDENTIAL', 'sk_live_DEMO_EDITED_AFTER_REVIEW'));
  await git('add', 'auth.js');
  await blocked(); evidence.checks.push('editing reviewed content invalidated receipt and blocked next commit');
  helper.send({ type: 'stop' }); assert.equal(helper.state, null);
  evidence.checks.push('Stop immediately invalidated helper state');
  evidence.ok = true;
  await writeFile(join(root, 'work/replay-e2e-result.json'), JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  await helper?.shutdown();
  await rm(scratch, { recursive: true, force: true });
}
