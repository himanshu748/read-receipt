export interface Recording {
  format: 'read-receipt-recording';
  version: 1;
  createdAt: string;
  source: 'live' | 'synthetic';
  sdkVersion: string | null;
  note?: string;
  samples: RecordedSample[];
}

export type RecordedSample =
  | {
      t: number;
      kind: 'features';
      faceFound: boolean;
      pitch: number | null;
      yaw: number | null;
      eyeOpenness: number | null;
      blinking: boolean | null;
      talking: boolean | null;
    }
  | {
      t: number;
      kind: 'pulse';
      bpm: number;
      confidence: number;
      stable: boolean;
    }
  | { t: number; kind: 'pressure'; value: number }
  | { t: number; kind: 'validation'; code: number }
  | {
      t: number;
      kind: 'error';
      code: number;
      message: string;
      retryable: boolean;
    };

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

export function isRecording(x: unknown): x is Recording {
  if (!isRecord(x)) return false;
  return (
    x.format === 'read-receipt-recording' &&
    x.version === 1 &&
    typeof x.createdAt === 'string' &&
    (x.source === 'live' || x.source === 'synthetic') &&
    (x.sdkVersion === null || typeof x.sdkVersion === 'string') &&
    Array.isArray(x.samples)
  );
}
