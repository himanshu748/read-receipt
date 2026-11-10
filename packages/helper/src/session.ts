import type {
  HelperPhase,
  PauseReason,
  RecordedSample,
  SourceKind,
  ViewerState,
} from '@rr/protocol';
import {
  defaultEyesOnConfig,
  initialEyesOnState,
  step,
  type EyesOnConfig,
  type EyesOnState,
} from './eyesOn.js';
import { ErrorCode } from './codes.js';

export interface SessionOptions {
  source: SourceKind;
  cfg?: EyesOnConfig;
}

/**
 * Owns eyesOn state + phase; accepts RecordedSample-shaped events
 * (from replay or, later, live SDK adapters).
 */
export class HelperSession {
  readonly source: SourceKind;
  readonly cfg: EyesOnConfig;
  private eyes: EyesOnState;
  private seq = 0;
  private phase: HelperPhase = 'idle';

  constructor(opts: SessionOptions) {
    this.source = opts.source;
    this.cfg = opts.cfg ?? defaultEyesOnConfig();
    this.eyes = initialEyesOnState();
  }

  getPhase(): HelperPhase {
    return this.phase;
  }

  getEyes(): EyesOnState {
    return this.eyes;
  }

  /** Mark session started (ClientToHelper start). */
  start(t = 0): void {
    this.phase = 'starting';
    this.eyes = step(
      this.eyes,
      { t, started: true, panelHidden: false },
      this.cfg,
    );
    this.phase = this.eyes.calibrated ? 'running' : 'calibrating';
  }

  stop(t?: number): void {
    const now = t ?? this.eyes.lastT;
    this.eyes = step(
      this.eyes,
      { t: now, panelHidden: true },
      this.cfg,
    );
    this.phase = 'stopped';
  }

  recalibrate(t?: number): void {
    const now = t ?? this.eyes.lastT;
    this.eyes = step(this.eyes, { t: now, recalibrate: true }, this.cfg);
    if (this.eyes.started && !this.eyes.panelHidden) {
      this.phase = 'calibrating';
    }
  }

  applySample(sample: RecordedSample): void {
    const t = sample.t;
    switch (sample.kind) {
      case 'features':
        this.eyes = step(
          this.eyes,
          {
            t,
            faceFound: sample.faceFound,
            pitch: sample.pitch,
            yaw: sample.yaw,
            eyeOpenness: sample.eyeOpenness,
            blinking: sample.blinking,
            talking: sample.talking,
          },
          this.cfg,
        );
        break;
      case 'pulse':
        this.eyes = step(
          this.eyes,
          {
            t,
            pulse: {
              bpm: sample.bpm,
              confidence: sample.confidence,
              stable: sample.stable,
            },
          },
          this.cfg,
        );
        break;
      case 'pressure':
        this.eyes = step(this.eyes, { t, pressure: sample.value }, this.cfg);
        break;
      case 'validation':
        this.eyes = step(
          this.eyes,
          { t, validationCode: sample.code },
          this.cfg,
        );
        break;
      case 'error':
        this.eyes = step(
          this.eyes,
          {
            t,
            error: {
              code: sample.code,
              message: sample.message,
              retryable: sample.retryable,
            },
          },
          this.cfg,
        );
        if (
          sample.code === ErrorCode.kCreditExhausted ||
          sample.code === ErrorCode.kAuthenticationFailed ||
          sample.code === ErrorCode.kInputUnavailable
        ) {
          this.phase = 'error';
        }
        break;
      default: {
        const _exhaustive: never = sample;
        void _exhaustive;
      }
    }

    if (this.phase === 'starting' || this.phase === 'calibrating') {
      this.phase = this.eyes.calibrated ? 'running' : 'calibrating';
    }
    if (this.eyes.fatalReason && this.phase !== 'stopped') {
      this.phase = 'error';
    }
  }

  viewerState(t?: number): ViewerState {
    this.seq += 1;
    const now = t ?? this.eyes.lastT;
    return {
      seq: this.seq,
      t: now,
      source: this.source,
      live: this.eyes.live,
      eyesOpen: this.eyes.eyesOpen,
      facingScreen: this.eyes.facingScreen,
      pulseBpm: this.eyes.pulseBpm,
      quality: this.eyes.quality,
      eyesOn: this.eyes.eyesOn,
      pauseReasons: this.eyes.pauseReasons.slice() as PauseReason[],
    };
  }

  phasePayload(): {
    phase: HelperPhase;
    calibrationProgress?: number;
    message?: string;
  } {
    if (this.phase === 'calibrating') {
      return {
        phase: this.phase,
        calibrationProgress: this.eyes.calibrationProgress,
        message: 'Look at the middle of your editor',
      };
    }
    if (this.eyes.fatalReason === 'credits-exhausted') {
      return {
        phase: this.phase,
        message:
          'Presage credits used up — receipts paused. Replay mode still works.',
      };
    }
    if (!this.eyes.everHadPulse && this.phase === 'running') {
      return {
        phase: this.phase,
        message: 'Checking for a live viewer…',
      };
    }
    return { phase: this.phase };
  }
}
