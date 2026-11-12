export const PROTOCOL_VERSION = 1 as const;

export type SourceKind = 'live' | 'replay';
export type Quality = 'good' | 'degraded' | 'unusable';

export type PauseReason =
  | 'not-started'
  | 'calibrating'
  | 'no-face'
  | 'multiple-faces'
  | 'face-not-forward'
  | 'looking-down'
  | 'eyes-closed'
  | 'no-pulse-yet'
  | 'pulse-lost'
  | 'too-dark'
  | 'too-bright'
  | 'excessive-motion'
  | 'low-frame-rate'
  | 'camera-tuning'
  | 'face-position'
  | 'credits-exhausted'
  | 'auth-failed'
  | 'network'
  | 'camera-unavailable'
  | 'sdk-error'
  | 'panel-hidden';

/** Emitted at ~10 Hz while the helper is running. */
export interface ViewerState {
  seq: number;
  /** Milliseconds since helper session start (monotonic). */
  t: number;
  source: SourceKind;
  /** Pulse present within the liveness window; no anti-spoofing guarantee. */
  live: boolean;
  /** False only for a closure longer than closureMs; blinks are ignored. */
  eyesOpen: boolean;
  /** Face found, forward, and not looking down vs. calibration. */
  facingScreen: boolean;
  /** Latest cardio.pulseRate bpm (SDK ~12 s average), or null. */
  pulseBpm: number | null;
  quality: Quality;
  /**
   * calibrated && live && eyesOpen && facingScreen && quality !== 'unusable'.
   * Extension treats state older than 750 ms as eyesOn=false.
   */
  eyesOn: boolean;
  /** Empty iff eyesOn. */
  pauseReasons: PauseReason[];
}

export type HelperPhase =
  | 'idle'
  | 'starting'
  | 'calibrating'
  | 'running'
  | 'stopped'
  | 'error';

export type HelperToClient =
  | {
      type: 'hello';
      protocol: typeof PROTOCOL_VERSION;
      helperVersion: string;
      sdkVersion: string | null;
      source: SourceKind;
    }
  | { type: 'state'; state: ViewerState }
  | {
      type: 'phase';
      phase: HelperPhase;
      calibrationProgress?: number;
      message?: string;
    }
  | { type: 'pulseTrace'; t: number; values: number[] }
  | { type: 'error'; reason: PauseReason; message: string; retryable: boolean };

/** Binary WebSocket frames = preview JPEG bytes (no header). Never written to disk. */
export type ClientToHelper =
  | { type: 'start' }
  | { type: 'stop' }
  | { type: 'recalibrate' }
  | { type: 'preview'; enabled: boolean; maxFps: number };

const PAUSE_REASONS = new Set<PauseReason>([
  'not-started',
  'calibrating',
  'no-face',
  'multiple-faces',
  'face-not-forward',
  'looking-down',
  'eyes-closed',
  'no-pulse-yet',
  'pulse-lost',
  'too-dark',
  'too-bright',
  'excessive-motion',
  'low-frame-rate',
  'camera-tuning',
  'face-position',
  'credits-exhausted',
  'auth-failed',
  'network',
  'camera-unavailable',
  'sdk-error',
  'panel-hidden',
]);

const HELPER_PHASES = new Set<HelperPhase>([
  'idle',
  'starting',
  'calibrating',
  'running',
  'stopped',
  'error',
]);

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function isPauseReason(x: unknown): x is PauseReason {
  return typeof x === 'string' && PAUSE_REASONS.has(x as PauseReason);
}

function isViewerState(x: unknown): x is ViewerState {
  if (!isRecord(x)) return false;
  return (
    typeof x.seq === 'number' &&
    typeof x.t === 'number' &&
    (x.source === 'live' || x.source === 'replay') &&
    typeof x.live === 'boolean' &&
    typeof x.eyesOpen === 'boolean' &&
    typeof x.facingScreen === 'boolean' &&
    (x.pulseBpm === null || typeof x.pulseBpm === 'number') &&
    (x.quality === 'good' || x.quality === 'degraded' || x.quality === 'unusable') &&
    typeof x.eyesOn === 'boolean' &&
    Array.isArray(x.pauseReasons) &&
    x.pauseReasons.every(isPauseReason)
  );
}

export function isHelperToClient(x: unknown): x is HelperToClient {
  if (!isRecord(x) || typeof x.type !== 'string') return false;
  switch (x.type) {
    case 'hello':
      return (
        x.protocol === PROTOCOL_VERSION &&
        typeof x.helperVersion === 'string' &&
        (x.sdkVersion === null || typeof x.sdkVersion === 'string') &&
        (x.source === 'live' || x.source === 'replay')
      );
    case 'state':
      return isViewerState(x.state);
    case 'phase':
      return (
        typeof x.phase === 'string' &&
        HELPER_PHASES.has(x.phase as HelperPhase) &&
        (x.calibrationProgress === undefined ||
          typeof x.calibrationProgress === 'number') &&
        (x.message === undefined || typeof x.message === 'string')
      );
    case 'pulseTrace':
      return (
        typeof x.t === 'number' &&
        Array.isArray(x.values) &&
        x.values.every((v) => typeof v === 'number')
      );
    case 'error':
      return (
        isPauseReason(x.reason) &&
        typeof x.message === 'string' &&
        typeof x.retryable === 'boolean'
      );
    default:
      return false;
  }
}

export function isClientToHelper(x: unknown): x is ClientToHelper {
  if (!isRecord(x) || typeof x.type !== 'string') return false;
  switch (x.type) {
    case 'start':
    case 'stop':
    case 'recalibrate':
      return true;
    case 'preview':
      return typeof x.enabled === 'boolean' && typeof x.maxFps === 'number';
    default:
      return false;
  }
}
