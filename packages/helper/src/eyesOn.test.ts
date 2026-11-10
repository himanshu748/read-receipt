import { describe, expect, it } from 'vitest';
import type { PauseReason } from '@rr/protocol';
import {
  defaultEyesOnConfig,
  initialEyesOnState,
  step,
  type EyesOnConfig,
  type EyesOnState,
} from './eyesOn.js';
import { ErrorCode, ValidationCode } from './codes.js';

const cfg = defaultEyesOnConfig({
  calibrationSec: 1,
  closureMs: 1000,
  lookDownThreshold: 1.8,
});

function drive(
  inputs: Parameters<typeof step>[1][],
  startCfg: EyesOnConfig = cfg,
): EyesOnState {
  let s = initialEyesOnState();
  for (const input of inputs) s = step(s, input, startCfg);
  return s;
}

/** Calibrate quickly with variance + establish live pulse + facing. */
function calibratedLive(at = 2000): EyesOnState {
  const inputs: Parameters<typeof step>[1][] = [
    { t: 0, started: true, panelHidden: false },
  ];
  for (let t = 0; t <= 1000; t += 100) {
    const n = t / 100;
    inputs.push({
      t,
      faceFound: true,
      pitch: 0.12 + (n % 2 === 0 ? 0.001 : -0.001),
      yaw: 0.0 + (n % 2 === 0 ? 0.0005 : -0.0005),
      eyeOpenness: 0.08 + (n % 2 === 0 ? 0.0004 : -0.0004),
      blinking: false,
      validationCode: ValidationCode.kOk,
      pressure: 1 + 0.3 * Math.sin(t / 100),
      ...(t % 500 === 0
        ? { pulse: { bpm: 72, confidence: 0.9, stable: true } }
        : {}),
    });
  }
  // Finish hysteresis (300 ms) so facingScreen becomes true.
  for (let t = 1100; t <= at; t += 100) {
    inputs.push({
      t,
      faceFound: true,
      pitch: 0.12,
      yaw: 0,
      eyeOpenness: 0.08,
      blinking: false,
      validationCode: ValidationCode.kOk,
      pressure: 1 + 0.3 * Math.sin(t / 100),
      ...(t % 500 === 0
        ? { pulse: { bpm: 72, confidence: 0.9, stable: true } }
        : {}),
    });
  }
  return drive(inputs);
}

describe('eyesOn step', () => {
  it('starts with not-started', () => {
    const s = initialEyesOnState();
    expect(s.eyesOn).toBe(false);
    expect(s.pauseReasons).toContain('not-started');
  });

  it('reports calibrating until calibrationSec of kOk face samples', () => {
    let s = initialEyesOnState();
    s = step(s, { t: 0, started: true }, cfg);
    expect(s.pauseReasons).toContain('calibrating');
    for (let t = 0; t <= 900; t += 100) {
      s = step(
        s,
        {
          t,
          faceFound: true,
          pitch: 0.12,
          yaw: 0,
          eyeOpenness: 0.08,
          validationCode: ValidationCode.kOk,
        },
        cfg,
      );
    }
    expect(s.calibrated).toBe(false);
    expect(s.pauseReasons).toContain('calibrating');
  });

  it('blink ≤ closureMs keeps eyesOpen; > closureMs sets eyes-closed', () => {
    const base = calibratedLive(2000);
    expect(base.eyesOn).toBe(true);

    // 0.9 s blink — still open
    let s = base;
    for (let t = 2100; t <= 3000; t += 100) {
      s = step(
        s,
        {
          t,
          faceFound: true,
          pitch: 0.12,
          yaw: 0,
          eyeOpenness: 0.02,
          blinking: true,
          validationCode: ValidationCode.kOk,
          pressure: 1.2,
          pulse: { bpm: 70, confidence: 0.9, stable: true },
        },
        cfg,
      );
    }
    expect(s.eyesOpen).toBe(true);
    expect(s.pauseReasons).not.toContain('eyes-closed');

    // continue closure through 1.1 s from start (2100 → 3200)
    for (let t = 3100; t <= 3200; t += 100) {
      s = step(
        s,
        {
          t,
          faceFound: true,
          pitch: 0.12,
          yaw: 0,
          eyeOpenness: 0.02,
          blinking: true,
          validationCode: ValidationCode.kOk,
          pressure: 1.3,
          pulse: { bpm: 70, confidence: 0.9, stable: true },
        },
        cfg,
      );
    }
    // closed since 2100; at 3200 → 1100 ms > 1000
    expect(s.eyesOpen).toBe(false);
    expect(s.pauseReasons).toContain('eyes-closed');
    expect(s.eyesOn).toBe(false);
  });

  it('0.9s vs 1.1s blink boundary at closureMs=1000', () => {
    const base = calibratedLive(2000);

    const runClosed = (durationMs: number) => {
      let s = base;
      const t0 = 2100;
      for (let t = t0; t <= t0 + durationMs; t += 100) {
        s = step(
          s,
          {
            t,
            faceFound: true,
            pitch: 0.12,
            eyeOpenness: 0.01,
            blinking: true,
            validationCode: ValidationCode.kOk,
            pressure: 1.2 + (t % 7) * 0.01,
            pulse: { bpm: 72, confidence: 0.95, stable: true },
          },
          cfg,
        );
      }
      return s;
    };

    const short = runClosed(900);
    expect(short.eyesOpen).toBe(true);

    const long = runClosed(1100);
    expect(long.eyesOpen).toBe(false);
    expect(long.pauseReasons).toContain('eyes-closed');
  });

  const reasonCases: Array<{
    reason: PauseReason;
    apply: (s: EyesOnState) => EyesOnState;
  }> = [
    {
      reason: 'no-face',
      apply: (s) =>
        step(
          s,
          {
            t: s.lastT + 100,
            faceFound: false,
            validationCode: ValidationCode.kNoFaceFound,
            pressure: 1.2,
            pulse: { bpm: 72, confidence: 0.9, stable: true },
          },
          cfg,
        ),
    },
    {
      reason: 'multiple-faces',
      apply: (s) =>
        step(
          s,
          {
            t: s.lastT + 100,
            faceFound: true,
            pitch: 0.12,
            eyeOpenness: 0.08,
            validationCode: ValidationCode.kMultipleFacesFound,
            pressure: 1.2,
            pulse: { bpm: 72, confidence: 0.9, stable: true },
          },
          cfg,
        ),
    },
    {
      reason: 'face-not-forward',
      apply: (s) =>
        step(
          s,
          {
            t: s.lastT + 100,
            faceFound: true,
            pitch: 0.12,
            eyeOpenness: 0.08,
            validationCode: ValidationCode.kFaceNotForward,
            pressure: 1.2,
            pulse: { bpm: 72, confidence: 0.9, stable: true },
          },
          cfg,
        ),
    },
    {
      reason: 'looking-down',
      apply: (s) => {
        let cur = s;
        for (let i = 1; i <= 5; i++) {
          cur = step(
            cur,
            {
              t: s.lastT + i * 100,
              faceFound: true,
              pitch: 0.12 + 0.05,
              eyeOpenness: 0.08,
              blinking: false,
              validationCode: ValidationCode.kOk,
              pressure: 1.2 + i * 0.05,
              pulse: { bpm: 72, confidence: 0.9, stable: true },
            },
            cfg,
          );
        }
        return cur;
      },
    },
    {
      reason: 'eyes-closed',
      apply: (s) => {
        let cur = s;
        for (let i = 1; i <= 12; i++) {
          cur = step(
            cur,
            {
              t: s.lastT + i * 100,
              faceFound: true,
              pitch: 0.12,
              eyeOpenness: 0.01,
              blinking: true,
              validationCode: ValidationCode.kOk,
              pressure: 1.2,
              pulse: { bpm: 72, confidence: 0.9, stable: true },
            },
            cfg,
          );
        }
        return cur;
      },
    },
    {
      reason: 'too-dark',
      apply: (s) =>
        step(
          s,
          {
            t: s.lastT + 100,
            faceFound: true,
            pitch: 0.12,
            eyeOpenness: 0.08,
            validationCode: ValidationCode.kTooDark,
            pressure: 1.2,
            pulse: { bpm: 72, confidence: 0.9, stable: true },
          },
          cfg,
        ),
    },
    {
      reason: 'too-bright',
      apply: (s) =>
        step(
          s,
          {
            t: s.lastT + 100,
            validationCode: ValidationCode.kTooBright,
            faceFound: true,
            pitch: 0.12,
            eyeOpenness: 0.08,
            pressure: 1.2,
            pulse: { bpm: 72, confidence: 0.9, stable: true },
          },
          cfg,
        ),
    },
    {
      reason: 'excessive-motion',
      apply: (s) =>
        step(
          s,
          {
            t: s.lastT + 100,
            validationCode: ValidationCode.kExcessiveMotion,
            faceFound: true,
            pitch: 0.12,
            eyeOpenness: 0.08,
            pressure: 1.2,
            pulse: { bpm: 72, confidence: 0.9, stable: true },
          },
          cfg,
        ),
    },
    {
      reason: 'low-frame-rate',
      apply: (s) =>
        step(
          s,
          {
            t: s.lastT + 100,
            validationCode: ValidationCode.kFrameRateTooLow,
            faceFound: true,
            pitch: 0.12,
            eyeOpenness: 0.08,
            pressure: 1.2,
            pulse: { bpm: 72, confidence: 0.9, stable: true },
          },
          cfg,
        ),
    },
    {
      reason: 'camera-tuning',
      apply: (s) =>
        step(
          s,
          {
            t: s.lastT + 100,
            validationCode: ValidationCode.kCameraTuning,
            faceFound: true,
            pitch: 0.12,
            eyeOpenness: 0.08,
            pressure: 1.2,
            pulse: { bpm: 72, confidence: 0.9, stable: true },
          },
          cfg,
        ),
    },
    {
      // face-position is degraded (not unusable), so pair with eyes-closed so
      // eyesOn is false and the reason is visible (pauseReasons empty iff eyesOn).
      reason: 'face-position',
      apply: (s) => {
        let cur = s;
        for (let i = 1; i <= 12; i++) {
          cur = step(
            cur,
            {
              t: s.lastT + i * 100,
              validationCode: ValidationCode.kFaceTooFar,
              faceFound: true,
              pitch: 0.12,
              eyeOpenness: 0.01,
              blinking: true,
              pressure: 1.2,
              pulse: { bpm: 72, confidence: 0.9, stable: true },
            },
            cfg,
          );
        }
        return cur;
      },
    },
    {
      reason: 'credits-exhausted',
      apply: (s) =>
        step(
          s,
          {
            t: s.lastT + 100,
            error: {
              code: ErrorCode.kCreditExhausted,
              message: 'credits',
              retryable: false,
            },
          },
          cfg,
        ),
    },
    {
      reason: 'auth-failed',
      apply: (s) =>
        step(
          s,
          {
            t: s.lastT + 100,
            error: {
              code: ErrorCode.kAuthenticationFailed,
              message: 'auth',
              retryable: false,
            },
          },
          cfg,
        ),
    },
    {
      reason: 'network',
      apply: (s) =>
        step(
          s,
          {
            t: s.lastT + 100,
            error: {
              code: ErrorCode.kNetworkError,
              message: 'net',
              retryable: true,
            },
          },
          cfg,
        ),
    },
    {
      reason: 'camera-unavailable',
      apply: (s) =>
        step(
          s,
          {
            t: s.lastT + 100,
            error: {
              code: ErrorCode.kInputUnavailable,
              message: 'cam',
              retryable: false,
            },
          },
          cfg,
        ),
    },
    {
      reason: 'sdk-error',
      apply: (s) =>
        step(
          s,
          {
            t: s.lastT + 100,
            error: {
              code: ErrorCode.kSustainedLowFrameRate,
              message: 'fps',
              retryable: false,
            },
          },
          cfg,
        ),
    },
    {
      reason: 'panel-hidden',
      apply: (s) =>
        step(s, { t: s.lastT + 100, panelHidden: true }, cfg),
    },
    {
      reason: 'no-pulse-yet',
      apply: () => {
        let s = initialEyesOnState();
        s = step(s, { t: 0, started: true }, cfg);
        for (let t = 0; t <= 1500; t += 100) {
          s = step(
            s,
            {
              t,
              faceFound: true,
              pitch: 0.12 + (t % 200 === 0 ? 0.001 : -0.001),
              yaw: 0,
              eyeOpenness: 0.08,
              validationCode: ValidationCode.kOk,
              // pressure only — no pulse
              pressure: 1 + 0.2 * Math.sin(t),
            },
            cfg,
          );
        }
        return s;
      },
    },
    {
      reason: 'pulse-lost',
      apply: (s) => {
        let cur = s;
        // Advance past the 5 s freshness window + 3 s hold with flat pressure.
        for (let i = 1; i <= 60; i++) {
          cur = step(
            cur,
            {
              t: s.lastT + i * 200,
              faceFound: true,
              pitch: 0.12,
              eyeOpenness: 0.08,
              validationCode: ValidationCode.kOk,
              pressure: 1.0,
            },
            cfg,
          );
        }
        return cur;
      },
    },
  ];

  for (const { reason, apply } of reasonCases) {
    it(`pause reason: ${reason}`, () => {
      const base =
        reason === 'no-pulse-yet' ? initialEyesOnState() : calibratedLive(2000);
      const s = apply(base);
      expect(s.pauseReasons).toContain(reason);
      expect(s.eyesOn).toBe(false);
    });
  }

  it('eyesOn implies empty pauseReasons', () => {
    const s = calibratedLive(2000);
    expect(s.eyesOn).toBe(true);
    expect(s.pauseReasons).toEqual([]);
  });
});
