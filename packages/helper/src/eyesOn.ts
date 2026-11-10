import { DEFAULT_CONFIG, type PauseReason, type Quality } from '@rr/protocol';
import {
  ErrorCode,
  FACE_POSITION_CODES,
  UNUSABLE_VALIDATION_CODES,
  ValidationCode,
} from './codes.js';

/** Tunables beyond ReadReceiptConfig (spike S0 will refine floors). */
export interface EyesOnTunables {
  /** Minimum pulse confidence to count as live. Pre-S0 default. */
  pulseConfidenceFloor: number;
  /** Min SD of recent pressure values to count as non-flat. */
  pressureSdEpsilon: number;
  /** eyeOpenness below this × calibration baseline counts as closed. */
  eyeClosedRatio: number;
  /** Validation codes within this window affect facingScreen. */
  faceWindowMs: number;
  /** Look-down enter/exit debounce. */
  lookDownHysteresisMs: number;
  /** Pulse + pressure must be fresh within this window. */
  pulseWindowMs: number;
  /** Hold live through short dropouts shorter than this. */
  pulseHoldMs: number;
}

export interface EyesOnConfig {
  closureMs: number;
  calibrationSec: number;
  lookDownThreshold: number;
  tunables: EyesOnTunables;
}

export const DEFAULT_TUNABLES: EyesOnTunables = {
  pulseConfidenceFloor: 0.3,
  pressureSdEpsilon: 0.05,
  eyeClosedRatio: 0.55,
  faceWindowMs: 500,
  lookDownHysteresisMs: 300,
  pulseWindowMs: 5000,
  pulseHoldMs: 3000,
};

export function defaultEyesOnConfig(
  overrides: Partial<Omit<EyesOnConfig, 'tunables'>> & {
    tunables?: Partial<EyesOnTunables>;
  } = {},
): EyesOnConfig {
  return {
    closureMs: overrides.closureMs ?? DEFAULT_CONFIG.closureMs,
    calibrationSec: overrides.calibrationSec ?? DEFAULT_CONFIG.calibrationSec,
    lookDownThreshold:
      overrides.lookDownThreshold ?? DEFAULT_CONFIG.lookDownThreshold,
    tunables: { ...DEFAULT_TUNABLES, ...overrides.tunables },
  };
}

export interface EyesOnInput {
  /** Monotonic session time in ms. */
  t: number;
  faceFound?: boolean;
  pitch?: number | null;
  yaw?: number | null;
  eyeOpenness?: number | null;
  blinking?: boolean | null;
  talking?: boolean | null;
  /** Latest validation code observed at/near this sample. */
  validationCode?: number | null;
  pulse?: { bpm: number; confidence: number; stable: boolean } | null;
  /** Single arterial-pressure sample to append. */
  pressure?: number | null;
  error?: { code: number; message: string; retryable: boolean } | null;
  /** Panel stopped / hidden. */
  panelHidden?: boolean;
  /** Restart calibration. */
  recalibrate?: boolean;
  /** Session has been started by the client. */
  started?: boolean;
}

interface CalibStats {
  meanPitch: number;
  meanYaw: number;
  meanEye: number;
  sdPitch: number;
  sdYaw: number;
  sdEye: number;
  n: number;
}

export interface EyesOnState {
  started: boolean;
  calibrated: boolean;
  calibrationProgress: number;
  calibPitch: number[];
  calibYaw: number[];
  calibEye: number[];
  calibOkMs: number;
  stats: CalibStats | null;

  eyesOpen: boolean;
  closureStartT: number | null;

  facingScreen: boolean;
  /** True once look-down was confirmed after having faced the screen. */
  lookingDown: boolean;
  lookDownCandidateSince: number | null;
  lookUpCandidateSince: number | null;

  live: boolean;
  pulseBpm: number | null;
  lastGoodPulseT: number | null;
  everHadPulse: boolean;
  /** When live conditions last failed; used for the 3 s hold. */
  liveLostSince: number | null;
  pressureSamples: { t: number; value: number }[];

  recentValidations: { t: number; code: number }[];
  lastValidation: number | null;

  faceFound: boolean;
  pitch: number | null;
  yaw: number | null;
  eyeOpenness: number | null;
  blinking: boolean | null;

  quality: Quality;
  eyesOn: boolean;
  pauseReasons: PauseReason[];

  fatalReason: PauseReason | null;
  fatalMessage: string | null;
  fatalRetryable: boolean;
  panelHidden: boolean;

  lastT: number;
}

export function initialEyesOnState(): EyesOnState {
  return {
    started: false,
    calibrated: false,
    calibrationProgress: 0,
    calibPitch: [],
    calibYaw: [],
    calibEye: [],
    calibOkMs: 0,
    stats: null,

    eyesOpen: true,
    closureStartT: null,

    facingScreen: false,
    lookingDown: false,
    lookDownCandidateSince: null,
    lookUpCandidateSince: null,

    live: false,
    pulseBpm: null,
    lastGoodPulseT: null,
    everHadPulse: false,
    liveLostSince: null,
    pressureSamples: [],

    recentValidations: [],
    lastValidation: null,

    faceFound: false,
    pitch: null,
    yaw: null,
    eyeOpenness: null,
    blinking: null,

    quality: 'unusable',
    eyesOn: false,
    pauseReasons: ['not-started'],

    fatalReason: null,
    fatalMessage: null,
    fatalRetryable: false,
    panelHidden: false,

    lastT: 0,
  };
}

function mean(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

function sampleSd(xs: readonly number[], m: number): number {
  if (xs.length < 2) return 0;
  let s = 0;
  for (const x of xs) {
    const d = x - m;
    s += d * d;
  }
  return Math.sqrt(s / (xs.length - 1));
}

function zScore(value: number, m: number, sd: number): number {
  if (sd < 1e-9) return value === m ? 0 : Number.POSITIVE_INFINITY;
  return (value - m) / sd;
}

function mapError(code: number): {
  reason: PauseReason;
  retryable: boolean;
} {
  switch (code) {
    case ErrorCode.kCreditExhausted:
      return { reason: 'credits-exhausted', retryable: false };
    case ErrorCode.kAuthenticationFailed:
      return { reason: 'auth-failed', retryable: false };
    case ErrorCode.kNetworkError:
      return { reason: 'network', retryable: true };
    case ErrorCode.kInputUnavailable:
      return { reason: 'camera-unavailable', retryable: false };
    default:
      return { reason: 'sdk-error', retryable: false };
  }
}

function qualityFromValidation(
  code: number | null,
  hasFatal: boolean,
): Quality {
  if (hasFatal) return 'unusable';
  if (code === null) return 'unusable';
  if (UNUSABLE_VALIDATION_CODES.has(code)) return 'unusable';
  if (FACE_POSITION_CODES.has(code)) return 'degraded';
  return 'good';
}

function pauseForValidation(code: number): PauseReason | null {
  switch (code) {
    case ValidationCode.kNoFaceFound:
      return 'no-face';
    case ValidationCode.kMultipleFacesFound:
      return 'multiple-faces';
    case ValidationCode.kFaceNotForward:
      return 'face-not-forward';
    case ValidationCode.kTooDark:
      return 'too-dark';
    case ValidationCode.kTooBright:
      return 'too-bright';
    case ValidationCode.kExcessiveMotion:
      return 'excessive-motion';
    case ValidationCode.kFrameRateTooLow:
      return 'low-frame-rate';
    case ValidationCode.kCameraTuning:
      return 'camera-tuning';
    default:
      if (FACE_POSITION_CODES.has(code)) return 'face-position';
      return null;
  }
}

/**
 * Pure eyes-on state machine. Feed samples (features / pulse / validation / error)
 * in time order; returns the next state.
 */
export function step(
  prev: EyesOnState,
  input: EyesOnInput,
  cfg: EyesOnConfig,
): EyesOnState {
  const next: EyesOnState = {
    ...prev,
    calibPitch: prev.calibPitch.slice(),
    calibYaw: prev.calibYaw.slice(),
    calibEye: prev.calibEye.slice(),
    pressureSamples: prev.pressureSamples.slice(),
    recentValidations: prev.recentValidations.slice(),
    pauseReasons: [],
    lastT: input.t,
  };

  if (input.started === true) next.started = true;
  if (input.panelHidden === true) next.panelHidden = true;
  if (input.panelHidden === false) next.panelHidden = false;

  if (input.recalibrate) {
    next.calibrated = false;
    next.calibrationProgress = 0;
    next.calibPitch = [];
    next.calibYaw = [];
    next.calibEye = [];
    next.calibOkMs = 0;
    next.stats = null;
    next.lookDownCandidateSince = null;
    next.lookUpCandidateSince = null;
    next.facingScreen = false;
    next.lookingDown = false;
  }

  if (input.faceFound !== undefined) next.faceFound = input.faceFound;
  if (input.pitch !== undefined) next.pitch = input.pitch;
  if (input.yaw !== undefined) next.yaw = input.yaw;
  if (input.eyeOpenness !== undefined) next.eyeOpenness = input.eyeOpenness;
  if (input.blinking !== undefined) next.blinking = input.blinking;

  if (input.validationCode !== undefined && input.validationCode !== null) {
    next.lastValidation = input.validationCode;
    next.recentValidations.push({ t: input.t, code: input.validationCode });
  }
  const faceWindow = cfg.tunables.faceWindowMs;
  next.recentValidations = next.recentValidations.filter(
    (v) => input.t - v.t <= faceWindow,
  );

  if (input.pressure !== undefined && input.pressure !== null) {
    next.pressureSamples.push({ t: input.t, value: input.pressure });
  }
  const pulseWindow = cfg.tunables.pulseWindowMs;
  next.pressureSamples = next.pressureSamples.filter(
    (p) => input.t - p.t <= pulseWindow,
  );

  if (input.pulse) {
    next.pulseBpm = input.pulse.bpm;
    const okBpm = input.pulse.bpm >= 40 && input.pulse.bpm <= 180;
    const okConf =
      input.pulse.confidence >= cfg.tunables.pulseConfidenceFloor;
    if (okBpm && okConf) {
      next.lastGoodPulseT = input.t;
      next.everHadPulse = true;
    }
  }

  if (input.error) {
    const mapped = mapError(input.error.code);
    next.fatalReason = mapped.reason;
    next.fatalMessage = input.error.message;
    next.fatalRetryable = mapped.retryable;
  }

  // --- Calibration (only accumulates on kOk + face) ---
  const dt =
    prev.lastT > 0 && input.t > prev.lastT ? input.t - prev.lastT : 0;
  const validationOk = next.lastValidation === ValidationCode.kOk;
  if (
    next.started &&
    !next.calibrated &&
    !next.fatalReason &&
    validationOk &&
    next.faceFound &&
    next.pitch !== null &&
    next.yaw !== null &&
    next.eyeOpenness !== null
  ) {
    next.calibPitch.push(next.pitch);
    next.calibYaw.push(next.yaw);
    next.calibEye.push(next.eyeOpenness);
    next.calibOkMs += dt > 0 ? dt : 0;
    const needMs = cfg.calibrationSec * 1000;
    next.calibrationProgress = Math.min(1, next.calibOkMs / needMs);
    if (next.calibOkMs >= needMs && next.calibPitch.length >= 2) {
      const meanPitch = mean(next.calibPitch);
      const meanYaw = mean(next.calibYaw);
      const meanEye = mean(next.calibEye);
      next.stats = {
        meanPitch,
        meanYaw,
        meanEye,
        sdPitch: sampleSd(next.calibPitch, meanPitch),
        sdYaw: sampleSd(next.calibYaw, meanYaw),
        sdEye: sampleSd(next.calibEye, meanEye),
        n: next.calibPitch.length,
      };
      next.calibrated = true;
      next.calibrationProgress = 1;
      // Enter facing immediately when calibration ends on-threshold (hysteresis
      // applies only to later look-down / look-up transitions).
      next.facingScreen = true;
      next.lookingDown = false;
      next.lookDownCandidateSince = null;
      next.lookUpCandidateSince = null;
    }
  }

  // --- eyesOpen (blink filter) ---
  const baselineEye = next.stats?.meanEye ?? next.eyeOpenness ?? 0.1;
  const closedByBlink = next.blinking === true;
  const closedByOpenness =
    next.eyeOpenness !== null &&
    next.eyeOpenness < cfg.tunables.eyeClosedRatio * baselineEye;
  const eyesClosedNow =
    next.faceFound && (closedByBlink || closedByOpenness);

  if (eyesClosedNow) {
    if (next.closureStartT === null) next.closureStartT = input.t;
    const closedFor = input.t - next.closureStartT;
    // Blinks ≤ closureMs keep eyesOpen true; longer → false until reopen.
    next.eyesOpen = closedFor <= cfg.closureMs;
  } else {
    next.closureStartT = null;
    next.eyesOpen = true;
  }

  // --- facingScreen ---
  // face found AND no blocking validation in last 500 ms AND not looking down
  // (|pitch z| ≥ threshold) with 300 ms hysteresis.
  const recentCodes = new Set(next.recentValidations.map((v) => v.code));
  const faceBlocked =
    !next.faceFound ||
    recentCodes.has(ValidationCode.kNoFaceFound) ||
    recentCodes.has(ValidationCode.kFaceNotForward) ||
    recentCodes.has(ValidationCode.kMultipleFacesFound);

  if (faceBlocked || !next.calibrated || !next.stats || next.pitch === null) {
    next.lookDownCandidateSince = null;
    next.lookUpCandidateSince = null;
    // Face lost / not calibrated: clear facing; keep lookingDown sticky only
    // if we had already confirmed a look-down this session.
    next.facingScreen = false;
  } else {
    const z = Math.abs(
      zScore(next.pitch, next.stats.meanPitch, next.stats.sdPitch),
    );
    const over = z >= cfg.lookDownThreshold;
    const hyst = cfg.tunables.lookDownHysteresisMs;

    if (over) {
      next.lookUpCandidateSince = null;
      if (next.lookDownCandidateSince === null) {
        next.lookDownCandidateSince = input.t;
      }
      if (input.t - next.lookDownCandidateSince >= hyst) {
        next.lookingDown = true;
        next.facingScreen = false;
      }
    } else {
      next.lookDownCandidateSince = null;
      if (next.lookUpCandidateSince === null) {
        next.lookUpCandidateSince = input.t;
      }
      if (input.t - next.lookUpCandidateSince >= hyst) {
        next.lookingDown = false;
        next.facingScreen = true;
      }
    }
  }

  // --- pulse liveness ---
  // live = good pulse within pulseWindowMs (5s) AND non-flat pressure.
  // Dropouts shorter than pulseHoldMs (3s) keep live=true; longer → pulse-lost.
  const pressureVals = next.pressureSamples.map((p) => p.value);
  const pMean = mean(pressureVals);
  const pSd = sampleSd(pressureVals, pMean);
  const pressureOk =
    pressureVals.length >= 2 && pSd > cfg.tunables.pressureSdEpsilon;

  if (next.lastGoodPulseT !== null) {
    const age = input.t - next.lastGoodPulseT;
    const conditionsMet = age <= cfg.tunables.pulseWindowMs && pressureOk;
    if (conditionsMet) {
      next.live = true;
      next.liveLostSince = null;
    } else if (prev.live || next.liveLostSince !== null) {
      if (next.liveLostSince === null) next.liveLostSince = input.t;
      next.live =
        input.t - next.liveLostSince < cfg.tunables.pulseHoldMs;
      if (!next.live) next.liveLostSince = null;
    } else {
      next.live = false;
    }
  } else {
    next.live = false;
    next.liveLostSince = null;
  }

  // --- quality ---
  next.quality = qualityFromValidation(
    next.lastValidation,
    next.fatalReason !== null,
  );

  // --- pause reasons & eyesOn ---
  const reasons: PauseReason[] = [];

  if (!next.started) {
    reasons.push('not-started');
  }
  if (next.panelHidden) {
    reasons.push('panel-hidden');
  }
  if (next.fatalReason) {
    reasons.push(next.fatalReason);
  }
  if (next.started && !next.calibrated && !next.fatalReason) {
    reasons.push('calibrating');
  }

  if (next.lastValidation !== null) {
    const vr = pauseForValidation(next.lastValidation);
    if (vr) reasons.push(vr);
  }

  if (next.lookingDown && !reasons.includes('looking-down')) {
    reasons.push('looking-down');
  }

  if (!next.eyesOpen) {
    reasons.push('eyes-closed');
  }

  if (next.started && !next.fatalReason) {
    if (!next.everHadPulse) {
      reasons.push('no-pulse-yet');
    } else if (!next.live) {
      reasons.push('pulse-lost');
    }
  }

  // Deduplicate while preserving order
  const seen = new Set<PauseReason>();
  next.pauseReasons = reasons.filter((r) => {
    if (seen.has(r)) return false;
    seen.add(r);
    return true;
  });

  next.eyesOn =
    next.calibrated &&
    next.live &&
    next.eyesOpen &&
    next.facingScreen &&
    next.quality !== 'unusable' &&
    !next.panelHidden &&
    next.fatalReason === null;

  if (next.eyesOn) {
    next.pauseReasons = [];
  }

  return next;
}
