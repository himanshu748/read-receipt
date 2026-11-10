import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { readDiff, EMPTY_TREE } from './diff.js';
import { hunkId } from './hash.js';
// EMPTY_TREE is module-internal; imported here to assert the documented OID.

const execFileAsync = promisify(execFile);
const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })),
  );
});

async function initRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'rr-diff-'));
  dirs.push(dir);
  await execFileAsync('git', ['init'], { cwd: dir });
  await execFileAsync('git', ['config', 'user.email', 't@example.com'], {
    cwd: dir,
  });
  await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  return dir;
}

async function commitAll(repo: string, msg = 'c'): Promise<void> {
  await execFileAsync('git', ['add', '-A'], { cwd: repo });
  await execFileAsync('git', ['commit', '-m', msg, '--allow-empty'], {
    cwd: repo,
  });
}

describe('readDiff', () => {
  it('returns empty for empty repo with no files', async () => {
    const repo = await initRepo();
    const hunks = await readDiff(repo, 'worktree');
    expect(hunks).toEqual([]);
  });

  it('diffs against empty tree when there is no HEAD', async () => {
    const repo = await initRepo();
    await writeFile(join(repo, 'hello.ts'), 'hello\n', 'utf8');
    await execFileAsync('git', ['add', 'hello.ts'], { cwd: repo });
    // still no HEAD commit — staged against empty tree
    const hunks = await readDiff(repo, 'staged');
    expect(hunks.length).toBeGreaterThanOrEqual(1);
    expect(hunks[0]!.file).toBe('hello.ts');
    expect(hunks[0]!.kind).toBe('add');
    // sanity: empty tree constant is the documented OID
    expect(EMPTY_TREE).toBe('4b825dc642cb6eb9a060e54bf8d69288fbee4904');
  });

  it('includes untracked files as whole-file adds in worktree mode', async () => {
    const repo = await initRepo();
    await writeFile(join(repo, 'tracked.ts'), 'base\n', 'utf8');
    await commitAll(repo);

    await writeFile(join(repo, 'fresh.ts'), 'line1\nline2\n', 'utf8');
    const hunks = await readDiff(repo, 'worktree');
    const fresh = hunks.find((h) => h.file === 'fresh.ts');
    expect(fresh).toBeDefined();
    expect(fresh!.kind).toBe('add');
    expect(fresh!.added).toEqual(['line1', 'line2']);
    expect(fresh!.id).toBe(hunkId('fresh.ts', [], ['line1', 'line2']));
  });

  it('does not include untracked in staged mode', async () => {
    const repo = await initRepo();
    await writeFile(join(repo, 't.ts'), 'x\n', 'utf8');
    await commitAll(repo);
    await writeFile(join(repo, 'u.ts'), 'y\n', 'utf8');
    const staged = await readDiff(repo, 'staged');
    expect(staged.find((h) => h.file === 'u.ts')).toBeUndefined();
  });

  it('skips binary untracked files', async () => {
    const repo = await initRepo();
    await writeFile(join(repo, 'a.ts'), 'a\n', 'utf8');
    await commitAll(repo);
    await writeFile(join(repo, 'bin.dat'), Buffer.from([0x00, 0x01, 0x02]));
    const hunks = await readDiff(repo, 'worktree');
    expect(hunks.find((h) => h.file === 'bin.dat')).toBeUndefined();
  });

  it('parses modify / delete / new file from a real git diff', async () => {
    const repo = await initRepo();
    await mkdir(join(repo, 'src'), { recursive: true });
    await writeFile(join(repo, 'src/keep.ts'), 'one\ntwo\nthree\n', 'utf8');
    await writeFile(join(repo, 'src/gone.ts'), 'bye\n', 'utf8');
    await commitAll(repo);

    await writeFile(join(repo, 'src/keep.ts'), 'one\nTWO\nthree\nfour\n', 'utf8');
    await rm(join(repo, 'src/gone.ts'));
    await writeFile(join(repo, 'src/new.ts'), 'brand\n', 'utf8');
    await execFileAsync('git', ['add', '-A'], { cwd: repo });

    const hunks = await readDiff(repo, 'staged');
    const files = new Set(hunks.map((h) => h.file));
    expect(files.has('src/keep.ts')).toBe(true);
    expect(files.has('src/gone.ts')).toBe(true);
    expect(files.has('src/new.ts')).toBe(true);

    const gone = hunks.find((h) => h.file === 'src/gone.ts')!;
    expect(gone.kind).toBe('delete');

    const neu = hunks.find((h) => h.file === 'src/new.ts')!;
    expect(neu.kind).toBe('add');
    expect(neu.added).toEqual(['brand']);
  });

  it('handles unicode paths from git', async () => {
    const repo = await initRepo();
    const name = 'café.ts';
    await writeFile(join(repo, name), 'a\n', 'utf8');
    await commitAll(repo);
    await writeFile(join(repo, name), 'b\n', 'utf8');
    const hunks = await readDiff(repo, 'worktree');
    expect(hunks.some((h) => h.file === name)).toBe(true);
  });
});
