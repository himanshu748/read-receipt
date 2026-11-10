import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, type Hunk } from '@rr/protocol';
import {
  accumulate,
  statusOf,
  thresholdSec,
  unionEyesOnSec,
} from './accumulate.js';
import { hunkId } from './hash.js';

function makeHunk(overrides: Partial<Hunk> & { added?: string[]; removed?: string[] } = {}): Hunk {
  const added = overrides.added ?? ['l1', 'l2', 'l3', 'l4', 'l5'];
  const removed = overrides.removed ?? [];
  const kind =
    overrides.kind ??
    (removed.length === 0 ? 'add' : added.length === 0 ? 'delete' : 'modify');
  const newStart = overrides.newStart ?? 10;
  const range =
    overrides.range ??
    (kind === 'delete'
      ? { start: newStart || 1, end: newStart || 1 }
      : { start: newStart, end: newStart + added.length - 1 });
  return {
    id: overrides.id ?? hunkId('f.ts', removed, added),
    file: overrides.file ?? 'f.ts',
    kind,
    oldStart: overrides.oldStart ?? 0,
    oldLines: overrides.oldLines ?? 0,
    newStart,
    newLines: overrides.newLines ?? added.length,
    added,
    removed,
    range,
    lineCount:
      overrides.lineCount ?? (kind === 'delete' ? removed.length : added.length),
  };
}

describe('thresholdSec', () => {
  it('is max(minSeconds, n * secondsPerLine)', () => {
    const cfg = { ...DEFAULT_CONFIG, minSeconds: 3, secondsPerLine: 0.4 };
    expect(thresholdSec(1, cfg)).toBe(3); // 0.4 < 3
    expect(thresholdSec(10, cfg)).toBe(4); // 4.0
    expect(thresholdSec(20, cfg)).toBe(8);
  });
});

describe('statusOf + accumulate per-line coverage', () => {
  const cfg = {
    ...DEFAULT_CONFIG,
    minSeconds: 2,
    secondsPerLine: 0.4,
    minLineSeconds: 0.5,
  };

  it('is unseen with no receipt', () => {
    expect(statusOf(undefined, makeHunk(), cfg)).toBe('unseen');
  });

  it('scrolling past does not mark read (partial or unseen)', () => {
    const hunk = makeHunk(); // 5 lines, threshold = max(2, 2.0) = 2
    // Only glance at line 10 for 0.25s — under minLineSeconds
    let r = accumulate(undefined, hunk, [10], 0.25, 1_000, 'live');
    expect(statusOf(r, hunk, cfg)).toBe('partial');

    // Accrue lots of eyes-on on a single line only
    r = accumulate(r, hunk, [10], 5, 1_001, 'live');
    expect(r.eyesOnSec).toBeGreaterThanOrEqual(thresholdSec(hunk.lineCount, cfg));
    expect(statusOf(r, hunk, cfg)).toBe('partial'); // other lines uncovered
  });

  it('becomes read when threshold and every lineSec met', () => {
    const hunk = makeHunk({ added: ['a', 'b'] }); // threshold max(2, 0.8)=2
    const lines = [10, 11];
    let r = accumulate(undefined, hunk, lines, 1.0, 2_000, 'live');
    expect(statusOf(r, hunk, cfg)).toBe('partial');
    r = accumulate(r, hunk, lines, 1.0, 2_001, 'live');
    expect(r.eyesOnSec).toBe(2);
    expect(r.lineSec.every((s) => s >= cfg.minLineSeconds)).toBe(true);
    expect(statusOf(r, hunk, cfg)).toBe('read');
  });

  it('taints source to replay if any time is replay', () => {
    const hunk = makeHunk({ added: ['a'] });
    let r = accumulate(undefined, hunk, [10], 0.5, 3_000, 'live');
    expect(r.source).toBe('live');
    r = accumulate(r, hunk, [10], 0.5, 3_001, 'replay');
    expect(r.source).toBe('replay');
  });
});

describe('unionEyesOnSec', () => {
  it('counts unique unix-second buckets across receipts', () => {
    const hunk = makeHunk({ added: ['a'] });
    const a = accumulate(undefined, hunk, [10], 1, 100, 'live');
    const b = accumulate(undefined, hunk, [10], 1, 100, 'live'); // same bucket
    const c = accumulate(undefined, hunk, [10], 1, 101, 'live');
    expect(unionEyesOnSec([a, b, c])).toBe(2);
    expect(unionEyesOnSec([])).toBe(0);
  });
});
