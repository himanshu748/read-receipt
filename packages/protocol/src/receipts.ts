import type { SourceKind } from './messages.js';

/** First 20 hex chars of sha256("rr1\\0" + file + "\\0" + removed + "\\0" + added). */
export type HunkId = string;

export interface Hunk {
  id: HunkId;
  /** Repo-relative path with POSIX separators. */
  file: string;
  kind: 'add' | 'modify' | 'delete';
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  /** CR stripped, no leading '+'. */
  added: string[];
  /** CR stripped, no leading '-'. */
  removed: string[];
  /**
   * 1-based inclusive new-side lines used for visibility.
   * A delete hunk is the single anchor line (newStart..newStart, or 1 if at SOF).
   */
  range: { start: number; end: number };
  /** kind === 'delete' ? removed.length : added.length */
  lineCount: number;
}

export type ReceiptStatus = 'unseen' | 'partial' | 'read';

export interface HunkReceipt {
  id: HunkId;
  file: string;
  lineCount: number;
  /** Seconds with ≥1 hunk line visible AND eyesOn. */
  eyesOnSec: number;
  /** Per-line eyes-on seconds; deleted hunks cover every removed line, not the gutter anchor. */
  lineSec: number[];
  /** Sorted unique unix seconds that accrued eyes-on time (for union totals). */
  buckets: number[];
  /** 'replay' if ANY accrued time came from a replay source. */
  source: SourceKind;
  firstSeenAt?: string;
  readAt?: string;
}

export interface ReceiptStoreFile {
  version: 1;
  updatedAt: string;
  receipts: Record<HunkId, HunkReceipt>;
}

/** Optional repo file `.readreceipt.json`. All fields optional at parse time. */
export interface ReadReceiptConfig {
  minSeconds: number;
  secondsPerLine: number;
  minLineSeconds: number;
  closureMs: number;
  calibrationSec: number;
  lookDownThreshold: number;
}

export const DEFAULT_CONFIG: ReadReceiptConfig = {
  minSeconds: 3,
  secondsPerLine: 0.4,
  minLineSeconds: 0.4,
  closureMs: 1000,
  calibrationSec: 20,
  /** Tuned by spike S0; start conservative. */
  lookDownThreshold: 1.8,
};
