import type {
  Hunk,
  HunkReceipt,
  ReadReceiptConfig,
  ReceiptStatus,
  SourceKind,
} from '@rr/protocol';

export function thresholdSec(
  lineCount: number,
  cfg: ReadReceiptConfig,
): number {
  return Math.max(cfg.minSeconds, lineCount * cfg.secondsPerLine);
}

export function statusOf(
  receipt: HunkReceipt | undefined,
  hunk: Hunk,
  cfg: ReadReceiptConfig,
): ReceiptStatus {
  if (!receipt || receipt.eyesOnSec <= 0) return 'unseen';
  const threshold = thresholdSec(hunk.lineCount, cfg);
  const rangeLen = hunk.range.end - hunk.range.start + 1;
  const linesReady =
    receipt.lineSec.length >= rangeLen &&
    receipt.lineSec
      .slice(0, rangeLen)
      .every((s) => (s ?? 0) >= cfg.minLineSeconds);
  if (receipt.eyesOnSec >= threshold && linesReady) return 'read';
  return 'partial';
}

/**
 * Pure receipt update: accrue `dtSec` of eyes-on time for `visibleLines`
 * (1-based new-side line numbers intersecting the hunk range).
 */
export function accumulate(
  receipt: HunkReceipt | undefined,
  hunk: Hunk,
  visibleLines: number[],
  dtSec: number,
  nowUnixSec: number,
  source: SourceKind,
): HunkReceipt {
  const rangeLen = Math.max(1, hunk.range.end - hunk.range.start + 1);
  const nowIso = new Date(nowUnixSec * 1000).toISOString();

  const lineSec = receipt
    ? receipt.lineSec.slice(0, rangeLen)
    : Array.from({ length: rangeLen }, () => 0);
  while (lineSec.length < rangeLen) lineSec.push(0);

  const base: HunkReceipt = {
    id: receipt?.id ?? hunk.id,
    file: receipt?.file ?? hunk.file,
    lineCount: hunk.lineCount,
    eyesOnSec: receipt?.eyesOnSec ?? 0,
    lineSec,
    buckets: receipt?.buckets.slice() ?? [],
    source:
      source === 'replay' || receipt?.source === 'replay' ? 'replay' : 'live',
  };

  if (receipt?.firstSeenAt !== undefined) {
    base.firstSeenAt = receipt.firstSeenAt;
  } else {
    base.firstSeenAt = nowIso;
  }
  if (receipt?.readAt !== undefined) {
    base.readAt = receipt.readAt;
  }

  if (dtSec <= 0) return base;

  const { start, end } = hunk.range;
  let anyVisible = false;
  for (const ln of visibleLines) {
    if (ln < start || ln > end) continue;
    anyVisible = true;
    const idx = ln - start;
    lineSec[idx] = (lineSec[idx] ?? 0) + dtSec;
  }
  if (!anyVisible) return base;

  base.eyesOnSec += dtSec;

  const bucket = Math.floor(nowUnixSec);
  if (!base.buckets.includes(bucket)) {
    base.buckets.push(bucket);
    base.buckets.sort((a, b) => a - b);
  }

  return base;
}

/** Cardinality of the union of all receipt buckets (unique eyes-on seconds). */
export function unionEyesOnSec(receipts: HunkReceipt[]): number {
  const set = new Set<number>();
  for (const r of receipts) {
    for (const b of r.buckets) set.add(b);
  }
  return set.size;
}
