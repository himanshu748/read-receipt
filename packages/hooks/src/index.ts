import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, chmod, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { loadConfig, readDiff, ReceiptStore, statusOf, thresholdSec, unionEyesOnSec } from '@rr/core';
import type { Hunk, HunkReceipt } from '@rr/protocol';

const exec = promisify(execFile);
const MANAGED = '# read-receipt managed hook v1';
const MARKER_TTL_MS = 60_000;

export interface HookContext {
  repoRoot: string;
  /** Git invocation PID supplied by our shell shims, not the Node child PID. */
  gitPid?: string;
  env?: NodeJS.ProcessEnv;
  output?: (message: string) => void;
}

interface Evaluation {
  root: string;
  directory: string;
  fingerprint: string;
  hunks: Hunk[];
  receipts: HunkReceipt[];
  unread: Hunk[];
  read: number;
  replay: boolean;
}

interface Approval {
  version: 1;
  fingerprint: string;
  gitPid: string;
  createdAt: number;
  overridden: boolean;
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await exec('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return stdout;
}

export async function repositoryRoot(cwd: string): Promise<string> {
  return (await git(cwd, ['rev-parse', '--show-toplevel'])).trim();
}

async function gitPath(root: string, name: string): Promise<string> {
  const path = (await git(root, ['rev-parse', '--git-path', name])).trim();
  return isAbsolute(path) ? path : resolve(root, path);
}

async function exists(path: string): Promise<boolean> {
  try { await access(path, constants.F_OK); return true; } catch { return false; }
}

async function remove(path: string): Promise<void> {
  try { await unlink(path); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

async function save(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

async function readJson(path: string): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = JSON.parse(await readFile(path, 'utf8'));
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown> : null;
  } catch { return null; }
}

async function evaluate(cwd: string): Promise<Evaluation> {
  const root = await repositoryRoot(cwd);
  const directory = await gitPath(root, 'read-receipt');
  let base: string;
  try { base = (await git(root, ['rev-parse', '--verify', 'HEAD'])).trim(); }
  catch { base = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'; }
  const patch = await git(root, ['diff', '--cached', '--binary', '--full-index', '--no-ext-diff', '--no-textconv', base]);
  const fingerprint = createHash('sha256').update(base).update('\0').update(patch).digest('hex');
  const hunks = await readDiff(root, 'staged');
  const cfg = loadConfig(root);
  const store = await ReceiptStore.open(root);
  const receipts = hunks.map(h => store.get(h.id)).filter((r): r is HunkReceipt => r !== undefined);
  const unread = hunks.filter(h => statusOf(store.get(h.id), h, cfg) !== 'read');
  return { root, directory, fingerprint, hunks, receipts, unread, read: hunks.length - unread.length,
    replay: receipts.some(r => r.source === 'replay') };
}

async function isMerge(root: string): Promise<boolean> {
  return exists(await gitPath(root, 'MERGE_HEAD'));
}

/** Validate the staged diff. A successful invocation is consumed by prepare-commit-msg. */
export async function runPreCommit(context: HookContext): Promise<number> {
  const state = await evaluate(context.repoRoot);
  const approvalPath = join(state.directory, 'pre-commit.json');
  await remove(approvalPath);
  if (await isMerge(state.root) || state.hunks.length === 0) return 0;
  const overridePath = join(state.directory, 'override.json');
  const token = await readJson(overridePath);
  const tokenMatches = token?.version === 1 && token.fingerprint === state.fingerprint;
  const overridden = state.unread.length > 0 &&
    ((context.env ?? process.env)['READ_RECEIPT_OVERRIDE'] === '1' || tokenMatches);
  if (tokenMatches) await remove(overridePath);
  if (state.unread.length > 0 && !overridden) {
    const cfg = loadConfig(state.root);
    const store = await ReceiptStore.open(state.root);
    context.output?.('Read Receipt: unread staged changes:\n');
    for (const h of state.unread) {
      const r = store.get(h.id);
      const length = h.kind === 'delete' ? h.removed.length : h.range.end - h.range.start + 1;
      const covered = r?.lineSec.slice(0, length).filter(s => s >= cfg.minLineSeconds).length ?? 0;
      const percent = Math.round(covered / length * 100);
      context.output?.(`${h.file}:${h.range.start}  (${(r?.eyesOnSec ?? 0).toFixed(1)} s of ${thresholdSec(h.lineCount, cfg).toFixed(1)} s, ${percent}% lines)\n`);
    }
    context.output?.('Review the hunks, or use rr-hook override for this staged diff.\n');
    return 1;
  }
  const approval: Approval = { version: 1, fingerprint: state.fingerprint,
    gitPid: context.gitPid ?? String(process.ppid), createdAt: Date.now(), overridden };
  await save(approvalPath, approval);
  return 0;
}

export async function createOverride(context: HookContext, reason?: string): Promise<void> {
  const state = await evaluate(context.repoRoot);
  if (state.hunks.length === 0) throw new Error('No staged text changes to override.');
  await save(join(state.directory, 'override.json'), {
    version: 1, fingerprint: state.fingerprint, createdAt: Date.now(), ...(reason ? { reason } : {}),
  });
  context.output?.('One-shot override saved for the current staged diff.\n');
}

export function formatDuration(seconds: number): string {
  const rounded = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(rounded / 60);
  return minutes ? `${minutes}m${String(rounded % 60).padStart(2, '0')}s` : `${rounded}s`;
}

/** Recompute the receipt rather than accepting a caller-supplied trailer. */
export async function prepareCommitMessage(context: HookContext, messageFile: string, source?: string): Promise<void> {
  const state = await evaluate(context.repoRoot);
  const approvalPath = join(state.directory, 'pre-commit.json');
  const approval = await readJson(approvalPath);
  await remove(approvalPath);
  if (source === 'merge' || await isMerge(state.root) || state.hunks.length === 0) return;
  const age = Date.now() - Number(approval?.createdAt);
  const verified = approval?.version === 1 && approval.fingerprint === state.fingerprint &&
    approval.gitPid === (context.gitPid ?? String(process.ppid)) && Number.isFinite(age) && age >= 0 && age <= MARKER_TTL_MS &&
    (state.unread.length === 0 || approval.overridden === true);
  const viewer = state.receipts.length === 0 ? 'no viewer' : `${state.replay ? 'replay' : 'live'} viewer`;
  let value = `${state.read}/${state.hunks.length} hunks, ${formatDuration(unionEyesOnSec(state.receipts))} eyes-on, ${viewer}`;
  if (!verified) value += ', unverified (hook bypassed)';
  else if (approval?.overridden === true) value += `, overridden (${state.unread.length} unread)`;
  const path = resolve(context.repoRoot, messageFile);
  // This key is tool-owned. Remove stale/duplicate copies before Git adds exactly one trailer.
  const previous = await readFile(path, 'utf8');
  const clean = previous.replace(/^Read-Receipt:[^\r\n]*(?:\r?\n[ \t]+[^\r\n]*)*/gim, '').trimEnd();
  await writeFile(path, `${clean}\n`, 'utf8');
  await git(state.root, ['interpret-trailers', '--in-place', '--if-exists', 'replace', '--if-missing', 'add', '--trailer', `Read-Receipt: ${value}`, path]);
}

function quoteShell(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

/** Install only our own hooks. Existing user hooks are never silently replaced. */
export async function installHooks(context: HookContext, options: { nodePath?: string; cliPath?: string } = {}): Promise<string[]> {
  const root = await repositoryRoot(context.repoRoot);
  const hooksPath = await gitPath(root, 'hooks');
  const nodePath = options.nodePath ?? process.execPath;
  const cliPath = options.cliPath ?? fileURLToPath(new URL('./cli.js', import.meta.url));
  const paths = ['pre-commit', 'prepare-commit-msg'].map(name => join(hooksPath, name));
  // Preflight both files before writing either one.
  for (const path of paths) {
    if (await exists(path)) {
      const content = await readFile(path, 'utf8');
      if (!content.includes(MANAGED)) throw new Error(`Existing hook left untouched: ${path}. Integrate Read Receipt into it manually or choose a dedicated core.hooksPath.`);
    }
  }
  await mkdir(hooksPath, { recursive: true });
  for (const [index, command] of ['pre-commit', 'prepare-commit-msg'].entries()) {
    const path = paths[index]!;
    const script = `#!/bin/sh\n${MANAGED}\nexec ${quoteShell(nodePath)} ${quoteShell(cliPath)} ${command} "$@" --git-pid "$PPID"\n`;
    await writeFile(path, script, { mode: 0o755 });
    await chmod(path, 0o755);
  }
  context.output?.(`Installed Read Receipt hooks in ${hooksPath}\n`);
  return paths;
}
