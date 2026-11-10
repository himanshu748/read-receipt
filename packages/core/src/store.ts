import { execFile } from 'node:child_process';
import {
  mkdir,
  rename,
  readFile,
  writeFile,
  unlink,
} from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { HunkId, HunkReceipt, ReceiptStoreFile } from '@rr/protocol';

const execFileAsync = promisify(execFile);

const GC_TTL_SEC = 14 * 24 * 60 * 60;
const STORE_VERSION = 1 as const;

/** On-disk shape: protocol ReceiptStoreFile plus lastSeen for GC. */
interface StoreDisk extends ReceiptStoreFile {
  lastSeen?: Record<HunkId, number>;
}

export class ReceiptStore {
  private readonly dir: string;
  private readonly filePath: string;
  private receipts: Map<HunkId, HunkReceipt>;
  /** unix seconds — last time the id was observed via get/put. */
  private lastSeen: Map<HunkId, number>;
  private nowFn: () => number;

  private constructor(
    dir: string,
    receipts: Map<HunkId, HunkReceipt>,
    lastSeen: Map<HunkId, number>,
    nowFn: () => number = () => Math.floor(Date.now() / 1000),
  ) {
    this.dir = dir;
    this.filePath = join(dir, 'receipts.json');
    this.receipts = receipts;
    this.lastSeen = lastSeen;
    this.nowFn = nowFn;
  }

  /** Resolve `.git/read-receipt/` via `git rev-parse --git-dir`. */
  static async open(
    repoRoot: string,
    opts?: { now?: () => number },
  ): Promise<ReceiptStore> {
    const gitDir = await resolveGitDir(repoRoot);
    const dir = join(gitDir, 'read-receipt');
    await mkdir(dir, { recursive: true });

    const filePath = join(dir, 'receipts.json');
    const nowFn = opts?.now ?? (() => Math.floor(Date.now() / 1000));
    const loaded = await loadOrRecover(filePath, nowFn);
    return new ReceiptStore(dir, loaded.receipts, loaded.lastSeen, nowFn);
  }

  get(id: HunkId): HunkReceipt | undefined {
    const r = this.receipts.get(id);
    if (r) this.lastSeen.set(id, this.nowFn());
    return r;
  }

  put(r: HunkReceipt): void {
    this.receipts.set(r.id, r);
    this.lastSeen.set(r.id, this.nowFn());
  }

  /** Atomic write (tmp + rename). GC receipts absent > 14 days. */
  async flush(): Promise<void> {
    const now = this.nowFn();
    for (const [id, seen] of [...this.lastSeen.entries()]) {
      if (now - seen > GC_TTL_SEC) {
        this.receipts.delete(id);
        this.lastSeen.delete(id);
      }
    }
    for (const id of [...this.lastSeen.keys()]) {
      if (!this.receipts.has(id)) this.lastSeen.delete(id);
    }

    const disk: StoreDisk = {
      version: STORE_VERSION,
      updatedAt: new Date(now * 1000).toISOString(),
      receipts: Object.fromEntries(this.receipts),
      lastSeen: Object.fromEntries(this.lastSeen),
    };

    await mkdir(this.dir, { recursive: true });
    const tmp = `${this.filePath}.${process.pid}.${now}.tmp`;
    const body = `${JSON.stringify(disk, null, 2)}\n`;
    await writeFile(tmp, body, 'utf8');
    await rename(tmp, this.filePath);
  }

  /** Absolute path to receipts.json (useful in tests). */
  get path(): string {
    return this.filePath;
  }
}

async function resolveGitDir(repoRoot: string): Promise<string> {
  const { stdout } = await execFileAsync(
    'git',
    ['rev-parse', '--git-dir'],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  const raw = stdout.trim();
  return isAbsolute(raw) ? raw : resolve(repoRoot, raw);
}

async function loadOrRecover(
  filePath: string,
  nowFn: () => number,
): Promise<{
  receipts: Map<HunkId, HunkReceipt>;
  lastSeen: Map<HunkId, number>;
}> {
  let text: string;
  try {
    text = await readFile(filePath, 'utf8');
  } catch {
    return { receipts: new Map(), lastSeen: new Map() };
  }

  try {
    const parsed = JSON.parse(text) as unknown;
    if (!isStoreDisk(parsed)) throw new Error('invalid store shape');
    const receipts = new Map<HunkId, HunkReceipt>(
      Object.entries(parsed.receipts).map(([id, r]) => [id, r as HunkReceipt]),
    );
    const lastSeen = new Map<HunkId, number>();
    const rawSeen = parsed.lastSeen ?? {};
    const fallback = nowFn();
    for (const id of receipts.keys()) {
      const s = rawSeen[id];
      lastSeen.set(id, typeof s === 'number' ? s : fallback);
    }
    return { receipts, lastSeen };
  } catch {
    const bak = `${filePath}.bak`;
    try {
      await rename(filePath, bak);
    } catch {
      try {
        await writeFile(bak, text, 'utf8');
        await unlink(filePath);
      } catch {
        /* ignore */
      }
    }
    return { receipts: new Map(), lastSeen: new Map() };
  }
}

function isStoreDisk(x: unknown): x is StoreDisk {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return false;
  const o = x as Record<string, unknown>;
  if (o.version !== 1) return false;
  if (typeof o.updatedAt !== 'string') return false;
  if (
    typeof o.receipts !== 'object' ||
    o.receipts === null ||
    Array.isArray(o.receipts)
  ) {
    return false;
  }
  return true;
}
