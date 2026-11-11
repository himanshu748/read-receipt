import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, type Hunk, type HunkReceipt, type ViewerState } from '@rr/protocol';
import { ReceiptTracker, type TrackingSnapshot } from './tracker.js';

const hunk: Hunk = { id: 'hunk-1', file: 'auth.js', kind: 'add', oldStart: 0,
  oldLines: 0, newStart: 40, newLines: 2, added: ['a', 'b'], removed: [],
  range: { start: 40, end: 41 }, lineCount: 2 };
const viewer: ViewerState = { seq: 1, t: 0, source: 'replay', live: true,
  eyesOpen: true, facingScreen: true, pulseBpm: 72, quality: 'good',
  eyesOn: true, pauseReasons: [] };

function setup() {
  const data = new Map<string, HunkReceipt>();
  let writes = 0;
  const tracker = new ReceiptTracker({ get: (id) => data.get(id),
    put: (receipt) => { data.set(receipt.id, receipt); },
    flush: async () => { writes++; } },
  { ...DEFAULT_CONFIG, minSeconds: 1, secondsPerLine: 0.2, minLineSeconds: 0.4 });
  tracker.setHunks([hunk]);
  const snapshot = (nowMs: number, overrides: Partial<TrackingSnapshot> = {}): TrackingSnapshot => ({
    nowMs, focused: true, panelVisible: true, viewer,
    editors: [{ file: hunk.file, dirty: false, ranges: [{ start: 40, end: 41 }] }],
    ...overrides,
  });
  return { tracker, data, snapshot, writes: () => writes };
}

describe('receipt tracker', () => {
  it('earns replay receipts only after elapsed time and coverage, and can flush them', async () => {
    const { tracker, snapshot, data, writes } = setup();
    expect(tracker.summary).toEqual({ total: 1, read: 0, unseen: 1, partial: 0 });
    tracker.tick(snapshot(0));
    tracker.tick(snapshot(250));
    expect(tracker.summary.partial).toBe(1);
    for (const t of [500, 750, 1000]) tracker.tick(snapshot(t));
    expect(tracker.summary.read).toBe(1);
    expect(tracker.unread).toEqual([]);
    expect(data.get(hunk.id)?.source).toBe('replay');
    expect(data.get(hunk.id)?.readAt).toBeDefined();
    await tracker.flush();
    expect(writes()).toBe(1);
  });

  it.each([
    { focused: false }, { panelVisible: false }, { viewer: null },
    { viewer: { ...viewer, eyesOn: false } },
    { editors: [{ file: hunk.file, dirty: true, ranges: [{ start: 40, end: 41 }] }] },
    { editors: [{ file: 'other.js', dirty: false, ranges: [{ start: 40, end: 41 }] }] },
  ])('pauses for an ineligible observation: %j', (override) => {
    const { tracker, snapshot, data } = setup();
    tracker.tick(snapshot(0));
    tracker.tick(snapshot(250, override));
    tracker.tick(snapshot(500));
    expect(data.size).toBe(0);
  });

  it('requires each line to be visible; duplicate editors cannot double count', () => {
    const { tracker, snapshot } = setup();
    const editor = { file: hunk.file, dirty: false, ranges: [{ start: 40, end: 40 }] };
    for (const nowMs of [0, 250, 500, 750, 1000, 1250]) {
      tracker.tick(snapshot(nowMs, { editors: [editor, editor] }));
    }
    expect(tracker.receipt(hunk.id)?.eyesOnSec).toBe(1.25);
    expect(tracker.receipt(hunk.id)?.lineSec).toEqual([1.25, 0]);
    expect(tracker.summary.partial).toBe(1);
    expect(tracker.items[0]?.coverage).toBe(0.5);
  });

  it('does not credit newly revealed lines or an event-loop suspension', () => {
    const { tracker, snapshot, data } = setup();
    tracker.tick(snapshot(0, { editors: [] }));
    tracker.tick(snapshot(250));
    tracker.tick(snapshot(5000));
    expect(data.size).toBe(0);
    tracker.tick(snapshot(5250));
    expect(tracker.receipt(hunk.id)?.eyesOnSec).toBe(0.25);
  });

  it('retains a content receipt after a line shift but new edits start unseen', () => {
    const { tracker, snapshot } = setup();
    for (const nowMs of [0, 250, 500, 750, 1000]) tracker.tick(snapshot(nowMs));
    tracker.setHunks([{ ...hunk, newStart: 50, range: { start: 50, end: 51 } }]);
    expect(tracker.summary.read).toBe(1);
    tracker.setHunks([{ ...hunk, id: 'edited-hunk', added: ['changed', 'b'] }]);
    expect(tracker.summary.unseen).toBe(1);
  });

  it('requires removed-text visibility for every deleted line, not the new-side anchor', () => {
    const { tracker, snapshot } = setup();
    const deleted: Hunk = { ...hunk, kind: 'delete', added: [], removed: ['a', 'b'],
      newLines: 0, range: { start: 40, end: 40 } };
    tracker.setHunks([deleted]);
    for (const t of [0, 250, 500, 750, 1000]) tracker.tick(snapshot(t));
    expect(tracker.summary.unseen).toBe(1);
    const editor = { file: hunk.file, hunkId: hunk.id, dirty: false, ranges: [{ start: 1, end: 1 }] };
    for (const t of [1250, 1500, 1750, 2000, 2250]) tracker.tick(snapshot(t, { editors: [editor] }));
    expect(tracker.summary.partial).toBe(1);
    const both = { ...editor, ranges: [{ start: 1, end: 2 }] };
    for (const t of [2500, 2750, 3000]) tracker.tick(snapshot(t, { editors: [both] }));
    expect(tracker.summary.read).toBe(1);
    expect(tracker.receipt(hunk.id)?.lineSec.length).toBe(2);
  });
});
