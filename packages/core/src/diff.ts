import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { Hunk } from '@rr/protocol';
import { hunkId } from './hash.js';
import { parseUnifiedDiff, splitContentLines } from './parse.js';

const execFileAsync = promisify(execFile);

/** Empty tree OID — used when the repo has no HEAD yet. */
export const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

const DIFF_FLAGS = [
  '-c',
  'core.quotepath=false',
  'diff',
  '-U0',
  '--no-color',
  '--no-ext-diff',
  '--no-renames',
  '--src-prefix=a/',
  '--dst-prefix=b/',
] as const;

export async function readDiff(
  repoRoot: string,
  mode: 'worktree' | 'staged',
): Promise<Hunk[]> {
  const base = await resolveDiffBase(repoRoot);

  const args =
    mode === 'staged'
      ? [...DIFF_FLAGS, '--cached', base]
      : [...DIFF_FLAGS, base];

  const text = await gitDiffText(repoRoot, args);
  const hunks = parseUnifiedDiff(text);

  if (mode === 'worktree') {
    const untracked = await listUntracked(repoRoot);
    for (const file of untracked) {
      const addHunk = await hunkFromUntracked(repoRoot, file);
      if (addHunk) hunks.push(addHunk);
    }
  }

  return hunks;
}

async function resolveDiffBase(repoRoot: string): Promise<string> {
  try {
    await runGit(repoRoot, ['rev-parse', '--verify', 'HEAD']);
    return 'HEAD';
  } catch {
    return EMPTY_TREE;
  }
}

async function gitDiffText(repoRoot: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    return stdout;
  } catch (err) {
    // git diff exits 1 when differences exist
    const e = err as { code?: number; stdout?: string; stderr?: string };
    if (e.code === 1 && typeof e.stdout === 'string') return e.stdout;
    throw err;
  }
}

async function listUntracked(repoRoot: string): Promise<string[]> {
  const { stdout } = await runGit(repoRoot, [
    '-c',
    'core.quotepath=false',
    'ls-files',
    '--others',
    '--exclude-standard',
    '-z',
  ]);
  if (!stdout) return [];
  return stdout
    .split('\0')
    .filter((p) => p.length > 0)
    .map((p) => p.replace(/\\/g, '/'));
}

async function hunkFromUntracked(
  repoRoot: string,
  file: string,
): Promise<Hunk | null> {
  let buf: Buffer;
  try {
    buf = await readFile(join(repoRoot, file));
  } catch {
    return null;
  }
  // Skip binaries (NUL byte heuristic, matching git's usual posture for text)
  if (buf.includes(0)) return null;

  const content = buf.toString('utf8');
  const added = splitContentLines(content);
  if (added.length === 0) return null;

  const removed: string[] = [];
  const newStart = 1;
  const newLines = added.length;
  return {
    id: hunkId(file, removed, added),
    file,
    kind: 'add',
    oldStart: 0,
    oldLines: 0,
    newStart,
    newLines,
    added,
    removed,
    range: { start: newStart, end: newStart + added.length - 1 },
    lineCount: added.length,
  };
}

async function runGit(
  repoRoot: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}
