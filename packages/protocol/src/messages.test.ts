import { describe, expect, it } from 'vitest';
import {
  PROTOCOL_VERSION,
  isClientToHelper,
  isHelperToClient,
  type ViewerState,
} from './messages.js';

const goodState: ViewerState = {
  seq: 1,
  t: 100,
  source: 'replay',
  live: true,
  eyesOpen: true,
  facingScreen: true,
  pulseBpm: 72,
  quality: 'good',
  eyesOn: true,
  pauseReasons: [],
};

describe('isHelperToClient', () => {
  it('accepts hello / state / phase / pulseTrace / error', () => {
    expect(
      isHelperToClient({
        type: 'hello',
        protocol: PROTOCOL_VERSION,
        helperVersion: '0.1.0',
        sdkVersion: null,
        source: 'replay',
      }),
    ).toBe(true);
    expect(isHelperToClient({ type: 'state', state: goodState })).toBe(true);
    expect(
      isHelperToClient({
        type: 'phase',
        phase: 'calibrating',
        calibrationProgress: 0.5,
      }),
    ).toBe(true);
    expect(
      isHelperToClient({ type: 'pulseTrace', t: 1, values: [0.1, 0.2] }),
    ).toBe(true);
    expect(
      isHelperToClient({
        type: 'error',
        reason: 'credits-exhausted',
        message: 'done',
        retryable: false,
      }),
    ).toBe(true);
  });

  it('rejects bad protocol and unknown pause reasons', () => {
    expect(
      isHelperToClient({
        type: 'hello',
        protocol: 99,
        helperVersion: '0.1.0',
        sdkVersion: null,
        source: 'replay',
      }),
    ).toBe(false);
    expect(
      isHelperToClient({
        type: 'error',
        reason: 'unknown-pause-reason',
        message: 'no',
        retryable: true,
      }),
    ).toBe(false);
  });
});

describe('isClientToHelper', () => {
  it('accepts start/stop/recalibrate/preview', () => {
    expect(isClientToHelper({ type: 'start' })).toBe(true);
    expect(isClientToHelper({ type: 'stop' })).toBe(true);
    expect(isClientToHelper({ type: 'recalibrate' })).toBe(true);
    expect(isClientToHelper({ type: 'preview', enabled: true, maxFps: 10 })).toBe(
      true,
    );
  });

  it('rejects unknown types', () => {
    expect(isClientToHelper({ type: 'hack' })).toBe(false);
  });
});
