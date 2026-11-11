import { accumulate, statusOf, thresholdSec, type ReceiptStore } from '@rr/core';
import type { Hunk, HunkId, HunkReceipt, ReadReceiptConfig, ViewerState } from '@rr/protocol';

export interface VisibleEditor {
  file: string;
  /** Present only for a read-only removed-text document for this hunk. */
  hunkId?: string;
  dirty: boolean;
  /** One-based, inclusive ranges. */
  ranges: Array<{ start: number; end: number }>;
}

export interface TrackingSnapshot {
  nowMs: number;
  focused: boolean;
  panelVisible: boolean;
  viewer: ViewerState | null;
  editors: VisibleEditor[];
}

type Store = Pick<ReceiptStore, 'get' | 'put' | 'flush'>;

/** Shared by the real editor wrapper and the replay integration test. No VS Code dependency. */
export class ReceiptTracker {
  private previous: TrackingSnapshot | null = null;
  private current: Hunk[] = [];
  private flushQueue: Promise<void> = Promise.resolve();

  constructor(private readonly store: Store, private config: ReadReceiptConfig) {}

  get hunks(): readonly Hunk[] { return this.current; }

  setHunks(hunks: Hunk[], config: ReadReceiptConfig = this.config): void {
    this.current = hunks;
    this.config = config;
    // A refreshed diff may have shifted line ranges. Start a new observation interval.
    this.previous = null;
  }

  receipt(id: HunkId): HunkReceipt | undefined { return this.store.get(id); }

  get items() {
    return this.current.map((hunk) => {
      const receipt = this.store.get(hunk.id);
      const status = statusOf(receipt, hunk, this.config);
      const rangeLength = hunk.kind === 'delete' ? hunk.removed.length : hunk.range.end - hunk.range.start + 1;
      const covered = receipt?.lineSec.slice(0, rangeLength)
        .filter((seconds) => seconds >= this.config.minLineSeconds).length ?? 0;
      const coverage = covered / Math.max(1, rangeLength);
      const requiredSeconds = thresholdSec(hunk.lineCount, this.config);
      const elapsedSeconds = receipt?.eyesOnSec ?? 0;
      const progress = Math.max(0, Math.min(1, coverage,
        elapsedSeconds / Math.max(Number.EPSILON, requiredSeconds)));
      return { id: hunk.id, file: hunk.file, line: hunk.range.start,
        status, progress, coverage, elapsedSeconds, requiredSeconds, hunk };
    });
  }

  get summary() {
    const summary = { read: 0, partial: 0, unseen: 0, total: this.current.length };
    for (const item of this.items) summary[item.status]++;
    return summary;
  }

  get unread() {
    return this.items.filter((item) => item.status !== 'read').map(
      ({ id, file, line, status, progress }) => ({ id, file, line, status, progress }),
    );
  }

  /** Count only lines observed at both ends of a short, eligible interval. */
  tick(snapshot: TrackingSnapshot): boolean {
    const previous = this.previous;
    // Copy visibility: callers may reuse/mutate arrays between editor events.
    this.previous = { ...snapshot, editors: snapshot.editors.map((editor) => ({
      ...editor, ranges: editor.ranges.map((range) => ({ ...range })),
    })) };
    if (!previous || !eligible(previous) || !eligible(snapshot)) return false;
    const elapsed = snapshot.nowMs - previous.nowMs;
    if (!Number.isFinite(elapsed) || elapsed <= 0 || elapsed > 750) return false;
    if (previous.viewer!.source !== snapshot.viewer!.source) return false;
    let changed = false;
    for (const hunk of this.current) {
      const reviewHunk = hunk.kind === 'delete' ? { ...hunk, range: { start: 1, end: hunk.removed.length } } : hunk;
      const select = (editors: VisibleEditor[]) => editors.filter((editor) => hunk.kind === 'delete'
        ? editor.hunkId === hunk.id : editor.hunkId === undefined);
      const before = visibleLines(reviewHunk, select(previous.editors));
      const after = visibleLines(reviewHunk, select(snapshot.editors));
      const lines = [...after].filter((line) => before.has(line));
      if (!lines.length) continue;
      const receipt = accumulate(this.store.get(hunk.id), reviewHunk, lines, elapsed / 1000,
        snapshot.nowMs / 1000, snapshot.viewer!.source);
      if (statusOf(receipt, hunk, this.config) === 'read' && !receipt.readAt) {
        receipt.readAt = new Date(snapshot.nowMs).toISOString();
      }
      this.store.put(receipt);
      changed = true;
    }
    return changed;
  }

  /** Flushes are serialized because the shared store uses atomic rename. */
  flush(): Promise<void> {
    const next = this.flushQueue.catch(() => {}).then(() => this.store.flush());
    this.flushQueue = next;
    return next;
  }

  resetClock(): void { this.previous = null; }
}

function eligible(snapshot: TrackingSnapshot): boolean {
  return snapshot.focused && snapshot.panelVisible && snapshot.viewer?.eyesOn === true;
}

function visibleLines(hunk: Hunk, editors: VisibleEditor[]): Set<number> {
  const result = new Set<number>();
  // A dirty editor for this file invalidates all views of it.
  if (editors.some((editor) => editor.file === hunk.file && editor.dirty)) return result;
  for (const editor of editors) {
    if (editor.file !== hunk.file) continue;
    for (const range of editor.ranges) {
      const start = Math.max(hunk.range.start, Math.ceil(range.start));
      const end = Math.min(hunk.range.end, Math.floor(range.end));
      for (let line = start; line <= end; line++) result.add(line);
    }
  }
  return result;
}
