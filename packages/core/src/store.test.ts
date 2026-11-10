import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import type { HunkReceipt } from '@rr/protocol';
import { ReceiptStore } from './store.js';

const execFileAsync = promisify(execFile);
const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })),
  );
});

async function initRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'rr-store-'));
  dirs.push(dir);
  await execFileAsync('git', ['init'], { cwd: dir });
  await execFileAsync('git', ['config', 'user.email', 't@t'], { cwd: dir });
  await execFileAsync('git', ['config', 'user.name', 't'], { cwd: dir });
  return dir;
}

function receipt(id: string): HunkReceipt {
  return {
    id,
    file: 'f.ts',
    lineCount: 1,
    eyesOnSec: 1,
    lineSec: [1],
    buckets: [1],
    source: 'live',
  };
}

describe('ReceiptStore', () => {
  it('atomically writes receipts.json under .git/read-receipt/', async () => {
    const repo = await initRepo();
    const store = await ReceiptStore.open(repo);
    store.put(receipt('abc123'));
    await store.flush();

    const raw = await readFile(store.path, 'utf8');
    const parsed = JSON.parse(raw) as {
      version: number;
      receipts: Record<string, HunkReceipt>;
    };
    expect(parsed.version).toBe(1);
    expect(parsed.receipts['abc123']?.eyesOnSec).toBe(1);
    expect(store.path.replace(/\\/g, '/')).toMatch(
      /\/\.git\/read-receipt\/receipts\.json$/,
    );

    const store2 = await ReceiptStore.open(repo);
    expect(store2.get('abc123')?.eyesOnSec).toBe(1);
  });

  it('renames corrupt store to .bak and starts fresh', async () => {
    const repo = await initRepo();
    const store = await ReceiptStore.open(repo);
    await writeFile(store.path, '{not-valid-json!!!', 'utf8');

    const fresh = await ReceiptStore.open(repo);
    expect(fresh.get('anything')).toBeUndefined();
    await access(`${store.path}.bak`);
    const bak = await readFile(`${store.path}.bak`, 'utf8');
    expect(bak).toContain('not-valid-json');
  });

  it('GCs receipts absent for more than 14 days', async () => {
    const repo = await initRepo();
    const t0 = 1_700_000_000;
    const store = await ReceiptStore.open(repo, { now: () => t0 });
    store.put(receipt('old'));
    store.put(receipt('fresh'));
    await store.flush();

    const t1 = t0 + 15 * 24 * 60 * 60;
    const disk = JSON.parse(await readFile(store.path, 'utf8')) as {
      version: 1;
      updatedAt: string;
      receipts: Record<string, HunkReceipt>;
      lastSeen: Record<string, number>;
    };
    disk.lastSeen['old'] = t0;
    disk.lastSeen['fresh'] = t1;
    await writeFile(store.path, JSON.stringify(disk), 'utf8');

    // Re-open at t1 without touching `old` (get would refresh lastSeen)
    const again = await ReceiptStore.open(repo, { now: () => t1 });
    again.put(receipt('fresh'));
    await again.flush();

    const after = JSON.parse(await readFile(store.path, 'utf8')) as {
      receipts: Record<string, HunkReceipt>;
    };
    expect(after.receipts['fresh']).toBeDefined();
    expect(after.receipts['old']).toBeUndefined();
  });
});
