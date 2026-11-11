import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile, mkdir, access, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { accumulate, readDiff, ReceiptStore } from '@rr/core';
import { createOverride, installHooks, prepareCommitMessage, runPreCommit } from './index.js';

const exec = promisify(execFile);
const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const roots: string[] = [];
const git = (root: string, args: string[], env = process.env) =>
  exec('git', args, { cwd: root, env, encoding: 'utf8' });

async function fixture(initialCommit = true): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "rr hooks ' "));
  roots.push(root);
  await git(root, ['init', '--quiet']);
  await git(root, ['config', 'user.name', 'Read Receipt Test Fixture']);
  await git(root, ['config', 'user.email', 'read-receipt-tests@example.invalid']);
  await git(root, ['config', 'commit.gpgsign', 'false']);
  await git(root, ['config', 'core.hooksPath', '.git/hooks']);
  await writeFile(join(root, 'code.js'), 'export const value = 1;\n');
  await git(root, ['add', 'code.js']);
  if (initialCommit) {
    await git(root, ['commit', '--quiet', '-m', 'Synthetic fixture baseline']);
    await change(root, 2);
  }
  await installHooks({ repoRoot: root }, { cliPath: CLI });
  return root;
}

async function change(root: string, value: number): Promise<void> {
  await writeFile(join(root, 'code.js'), `export const value = ${value};\n`);
  await git(root, ['add', 'code.js']);
}

async function markRead(root: string, source: 'live' | 'replay' = 'replay'): Promise<void> {
  const store = await ReceiptStore.open(root);
  for (const h of await readDiff(root, 'staged')) {
    let r = store.get(h.id);
    for (let second = 0; second < Math.max(4, Math.ceil(h.lineCount * 0.4)); second++) {
      r = accumulate(r, h, Array.from({ length: h.range.end - h.range.start + 1 }, (_, i) => h.range.start + i), 1, 1000 + second, source);
    }
    store.put(r!);
  }
  await store.flush();
}

async function message(root: string): Promise<string> {
  return (await git(root, ['log', '-1', '--format=%B'])).stdout;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

describe('installed Git hooks on disposable repositories', () => {
  it('blocks unread staged changes, then allows a real replay-labelled commit after review', async () => {
    const root = await fixture();
    await expect(git(root, ['commit', '-m', 'Review attempt'])).rejects.toMatchObject({ stderr: expect.stringContaining('code.js:1') });
    await markRead(root);
    await git(root, ['commit', '--quiet', '-m', 'Reviewed replay changes']);
    const text = await message(root);
    expect(text).toContain('Read-Receipt: 1/1 hunks, 4s eyes-on, replay viewer');
    expect(text).not.toContain('unverified');
    expect(text).not.toContain('overridden');
  });

  it('handles a first commit in a repository without HEAD', async () => {
    const root = await fixture(false);
    await expect(git(root, ['commit', '-m', 'Unread initial commit'])).rejects.toMatchObject({ stderr: expect.stringContaining('unread') });
    await markRead(root, 'live');
    await git(root, ['commit', '--quiet', '-m', 'Reviewed initial commit']);
    expect(await message(root)).toContain('live viewer');
  });

  it('requires coverage of every removed line rather than only the deletion anchor', async () => {
    const root = await fixture();
    await writeFile(join(root, 'code.js'), 'one\ntwo\nthree\nfour\nfive\n');
    await git(root, ['add', 'code.js']);
    await git(root, ['-c', 'core.hooksPath=/dev/null', 'commit', '--quiet', '-m', 'Synthetic deletion baseline']);
    await git(root, ['rm', '--quiet', 'code.js']);
    const h = (await readDiff(root, 'staged'))[0]!;
    expect(h.kind).toBe('delete');
    expect(h.removed).toHaveLength(5);
    const store = await ReceiptStore.open(root);
    const receipt = { id: h.id, file: h.file, lineCount: h.lineCount, eyesOnSec: 4,
      lineSec: [4], buckets: [1000, 1001, 1002, 1003], source: 'replay' as const };
    store.put(receipt);
    await store.flush();
    let output = '';
    expect(await runPreCommit({ repoRoot: root, output: s => { output += s; } })).toBe(1);
    expect(output).toContain('20% lines');
    store.put({ ...receipt, lineSec: [4, 4, 4, 4, 4] });
    await store.flush();
    await git(root, ['commit', '--quiet', '-m', 'Reviewed all removed lines']);
    expect(await message(root)).toContain('1/1 hunks');
    expect(await message(root)).toContain('replay viewer');
  });

  it('binds an override to the staged diff and consumes it exactly once', async () => {
    const root = await fixture();
    await createOverride({ repoRoot: root }, 'Synthetic override test');
    await change(root, 3);
    await expect(git(root, ['commit', '-m', 'Wrong staged diff'])).rejects.toMatchObject({ stderr: expect.stringContaining('unread') });
    await change(root, 2);
    await git(root, ['commit', '--quiet', '-m', 'Explicitly overridden']);
    expect(await message(root)).toContain('overridden (1 unread)');
    await expect(access(join(root, '.git/read-receipt/override.json'))).rejects.toBeTruthy();
    await change(root, 4);
    await expect(git(root, ['commit', '-m', 'Override already consumed'])).rejects.toMatchObject({ stderr: expect.stringContaining('unread') });
  });

  it('honestly labels an environment override', async () => {
    const root = await fixture();
    await git(root, ['commit', '--quiet', '-m', 'Environment override'], { ...process.env, READ_RECEIPT_OVERRIDE: '1' });
    expect(await message(root)).toContain('overridden (1 unread)');
    expect(await message(root)).toContain('no viewer');
    expect(await message(root)).not.toContain('live viewer');
  });

  it('labels --no-verify as unverified even when all receipts are read', async () => {
    const root = await fixture();
    await markRead(root);
    // A stale marker from an unrelated invocation cannot attest this Git commit.
    expect(await runPreCommit({ repoRoot: root, gitPid: 'not-the-git-process' })).toBe(0);
    await git(root, ['commit', '--quiet', '--no-verify', '-m', 'Bypassed gate']);
    expect(await message(root)).toContain('unverified (hook bypassed)');
  });

  it('replaces forged or duplicate receipt trailers and consumes the approval', async () => {
    const root = await fixture();
    await markRead(root);
    await git(root, ['commit', '--quiet', '-m', 'Body\n\nRead-Receipt: forged\nRead-Receipt: forged-again']);
    const text = await message(root);
    expect(text.match(/Read-Receipt:/g)).toHaveLength(1);
    expect(text).not.toContain('forged');
    await expect(access(join(root, '.git/read-receipt/pre-commit.json'))).rejects.toBeTruthy();
  });

  it('rechecks changed hunks when amending and preserves a single current trailer', async () => {
    const root = await fixture();
    await markRead(root);
    await git(root, ['commit', '--quiet', '-m', 'First reviewed commit']);
    await change(root, 3);
    await expect(git(root, ['commit', '--amend', '--no-edit'])).rejects.toMatchObject({ stderr: expect.stringContaining('unread') });
    await markRead(root);
    await git(root, ['commit', '--quiet', '--amend', '--no-edit']);
    expect((await message(root)).match(/Read-Receipt:/g)).toHaveLength(1);
    expect(await message(root)).not.toContain('unverified');
  });

  it('skips empty diffs without stamping a new receipt', async () => {
    const root = await fixture();
    await git(root, ['reset', '--hard', '--quiet', 'HEAD']);
    await git(root, ['commit', '--quiet', '--allow-empty', '-m', 'Empty fixture commit']);
    expect(await message(root)).not.toContain('Read-Receipt:');
  });

  it('skips merge commits in a real non-fast-forward merge', async () => {
    const root = await fixture();
    await git(root, ['reset', '--hard', '--quiet', 'HEAD']);
    const branch = (await git(root, ['branch', '--show-current'])).stdout.trim();
    await git(root, ['checkout', '--quiet', '-b', 'side']);
    await writeFile(join(root, 'side.js'), '// synthetic side change\n');
    await git(root, ['add', '.']);
    await git(root, ['-c', 'core.hooksPath=/dev/null', 'commit', '--quiet', '-m', 'Side fixture']);
    await git(root, ['checkout', '--quiet', branch]);
    await writeFile(join(root, 'main.js'), '// synthetic main change\n');
    await git(root, ['add', '.']);
    await git(root, ['-c', 'core.hooksPath=/dev/null', 'commit', '--quiet', '-m', 'Main fixture']);
    await git(root, ['merge', '--quiet', '--no-ff', 'side', '-m', 'Merge fixture']);
    expect(await message(root)).not.toContain('Read-Receipt:');
  });

  it.each(['relative', 'absolute'])('respects a %s core.hooksPath', async kind => {
    const root = await fixture();
    const configured = kind === 'relative' ? '.custom-hooks' : join(root, 'absolute hooks');
    await git(root, ['config', 'core.hooksPath', configured]);
    const paths = await installHooks({ repoRoot: root }, { cliPath: CLI });
    expect(await realpath(paths[0]!)).toBe(await realpath(join(root, kind === 'relative' ? '.custom-hooks' : 'absolute hooks', 'pre-commit')));
    await expect(git(root, ['commit', '-m', 'Unread with custom path'])).rejects.toMatchObject({ stderr: expect.stringContaining('unread') });
  });

  it('preflights both hooks and refuses foreign hooks without partial installation', async () => {
    const root = await fixture();
    await git(root, ['config', 'core.hooksPath', '.foreign-hooks']);
    await mkdir(join(root, '.foreign-hooks'));
    const foreign = join(root, '.foreign-hooks/prepare-commit-msg');
    await writeFile(foreign, '#!/bin/sh\nprintf existing\n');
    await expect(installHooks({ repoRoot: root }, { cliPath: CLI })).rejects.toThrow('Existing hook left untouched');
    expect(await readFile(foreign, 'utf8')).toContain('printf existing');
    await expect(access(join(root, '.foreign-hooks/pre-commit'))).rejects.toBeTruthy();
  });

  it('does not reuse an expired approval or one already consumed', async () => {
    const root = await fixture();
    await markRead(root);
    const context = { repoRoot: root, gitPid: 'fixture-git' };
    await runPreCommit(context);
    const path = join(root, '.git/read-receipt/pre-commit.json');
    const approval = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
    approval.createdAt = Date.now() - 120_000;
    await writeFile(path, JSON.stringify(approval));
    const msg = join(root, '.git/fixture-msg');
    await writeFile(msg, 'Fixture body\n');
    await prepareCommitMessage(context, msg);
    expect(await readFile(msg, 'utf8')).toContain('unverified');
    await runPreCommit(context);
    await prepareCommitMessage(context, msg);
    expect(await readFile(msg, 'utf8')).not.toContain('unverified');
    await prepareCommitMessage(context, msg);
    expect(await readFile(msg, 'utf8')).toContain('unverified');
  });
});

describe('six-hunk demo generator', () => {
  it('creates exactly six hunks across four files with an unmistakably fake key at auth.js:40-58', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'rr-demo-'));
    roots.push(parent);
    const root = join(parent, 'new-demo');
    const script = fileURLToPath(new URL('../../../scripts/make-demo-repo.mjs', import.meta.url));
    await exec(process.execPath, [script, root]);
    const hunks = await readDiff(root, 'worktree');
    expect(hunks).toHaveLength(6);
    expect(new Set(hunks.map(h => h.file)).size).toBe(4);
    const auth = hunks.find(h => h.file === 'auth.js')!;
    expect(auth.range).toEqual({ start: 40, end: 58 });
    expect(auth.added.join('\n')).toContain('sk_live_DEMO_NOT_A_REAL_CREDENTIAL');
    await expect(exec(process.execPath, [script, root])).rejects.toMatchObject({ stderr: expect.stringContaining('EEXIST') });
    expect(await readDiff(root, 'worktree')).toHaveLength(6);
  });
});
