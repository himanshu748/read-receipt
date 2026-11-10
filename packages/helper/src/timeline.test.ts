import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isRecording, type PauseReason } from '@rr/protocol';
import { HelperSession } from './session.js';
import { defaultEyesOnConfig } from './eyesOn.js';

const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../fixtures/replay/demo-session.json',
);

interface TimelineExpect {
  /** Earliest time the reason (or eyesOn) should be observed. */
  t: number;
  kind: 'eyesOn' | 'pause';
  reason?: PauseReason;
}

describe('demo-session timeline', () => {
  it('produces expected eyesOn / pause timeline within ±100 ms', async () => {
    const raw = JSON.parse(await readFile(FIXTURE, 'utf8')) as unknown;
    expect(isRecording(raw)).toBe(true);
    if (!isRecording(raw)) return;

    const session = new HelperSession({
      source: 'replay',
      cfg: defaultEyesOnConfig(), // full 20 s calibration matching the fixture
    });
    session.start(0);

    const firstSeen = new Map<string, number>();
    const mark = (key: string, t: number) => {
      if (!firstSeen.has(key)) firstSeen.set(key, t);
    };

    for (const sample of raw.samples) {
      session.applySample(sample);
      const eyes = session.getEyes();
      if (eyes.eyesOn) mark('eyesOn', sample.t);
      for (const r of eyes.pauseReasons) mark(`pause:${r}`, sample.t);
    }

    // Expected first-seen times from the fixture generator segments.
    const expected: TimelineExpect[] = [
      { t: 0, kind: 'pause', reason: 'calibrating' },
      // Calibration completes at 20 s; facing engages immediately on-threshold.
      { t: 20000, kind: 'eyesOn' },
      // 2 s closure starts at 28000; eyes-closed after closureMs (1000).
      { t: 29000, kind: 'pause', reason: 'eyes-closed' },
      // Looking down segment from 32000; hysteresis 300 ms.
      { t: 32300, kind: 'pause', reason: 'looking-down' },
      { t: 35000, kind: 'pause', reason: 'no-face' },
      { t: 37000, kind: 'pause', reason: 'multiple-faces' },
      { t: 39000, kind: 'pause', reason: 'too-dark' },
      { t: 42000, kind: 'pause', reason: 'credits-exhausted' },
    ];

    for (const exp of expected) {
      const key =
        exp.kind === 'eyesOn' ? 'eyesOn' : `pause:${exp.reason}`;
      const got = firstSeen.get(key);
      expect(got, `missing ${key}`).toBeTypeOf('number');
      expect(
        Math.abs((got as number) - exp.t),
        `${key}: got ${got}, expected ${exp.t} ±100`,
      ).toBeLessThanOrEqual(100);
    }

    // Short blink at 25000–25800 must NOT introduce eyes-closed before the 2 s closure.
    const eyesClosedAt = firstSeen.get('pause:eyes-closed');
    expect(eyesClosedAt).toBeGreaterThanOrEqual(28900);
  });
});
