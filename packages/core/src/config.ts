import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_CONFIG, type ReadReceiptConfig } from '@rr/protocol';

/**
 * Load `.readreceipt.json` from `repoRoot`, merging over `DEFAULT_CONFIG`.
 * Missing or invalid files yield the defaults.
 */
export function loadConfig(repoRoot: string): ReadReceiptConfig {
  const path = join(repoRoot, '.readreceipt.json');
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch {
    return { ...DEFAULT_CONFIG };
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ...DEFAULT_CONFIG };
  }
  const o = raw as Record<string, unknown>;
  return {
    minSeconds: num(o.minSeconds, DEFAULT_CONFIG.minSeconds),
    secondsPerLine: num(o.secondsPerLine, DEFAULT_CONFIG.secondsPerLine),
    minLineSeconds: num(o.minLineSeconds, DEFAULT_CONFIG.minLineSeconds),
    closureMs: num(o.closureMs, DEFAULT_CONFIG.closureMs),
    calibrationSec: num(o.calibrationSec, DEFAULT_CONFIG.calibrationSec),
    lookDownThreshold: num(
      o.lookDownThreshold,
      DEFAULT_CONFIG.lookDownThreshold,
    ),
  };
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
