import { describe, expect, it } from 'vitest';
import { featuresFromLandmarks, type Landmark } from './features.js';

function blank(): Landmark[] {
  return Array.from({ length: 478 }, () => ({ x: 0, y: 0 }));
}

/** Place the MediaPipe indices used by features.ts into a coherent face. */
function face(opts: {
  eyeOpen?: number;
  noseDrop?: number;
  noseShift?: number;
}): Landmark[] {
  const lm = blank();
  const eyeY = 100;
  const d = 100; // interocular
  // left outer 33, left inner 133, right inner 362, right outer 263
  lm[33] = { x: 0, y: eyeY };
  lm[133] = { x: 30, y: eyeY };
  lm[362] = { x: 70, y: eyeY };
  lm[263] = { x: d, y: eyeY };
  // forehead 10, chin 152 → faceHeight 200
  lm[10] = { x: 50, y: 0 };
  lm[152] = { x: 50, y: 200 };
  // nose tip 1
  const eyeMidX = (0 + 30 + 70 + d) / 4;
  const eyeMidY = eyeY;
  lm[1] = {
    x: eyeMidX + (opts.noseShift ?? 0) * d,
    y: eyeMidY + (opts.noseDrop ?? 0.1) * 200,
  };
  // lids: 159/145 left, 386/374 right
  const gap = (opts.eyeOpen ?? 0.08) * d;
  lm[159] = { x: 15, y: eyeY - gap / 2 };
  lm[145] = { x: 15, y: eyeY + gap / 2 };
  lm[386] = { x: 85, y: eyeY - gap / 2 };
  lm[374] = { x: 85, y: eyeY + gap / 2 };
  return lm;
}

describe('featuresFromLandmarks', () => {
  it('returns pitch/yaw/eyeOpenness ratios', () => {
    const f = featuresFromLandmarks(face({ noseDrop: 0.12, eyeOpen: 0.08 }));
    expect(f).not.toBeNull();
    expect(f!.pitch).toBeCloseTo(0.12, 5);
    expect(f!.yaw).toBeCloseTo(0, 5);
    expect(f!.eyeOpenness).toBeCloseTo(0.08, 5);
  });

  it('yaw follows nose shift / interocular', () => {
    const f = featuresFromLandmarks(face({ noseShift: 0.2 }));
    expect(f!.yaw).toBeCloseTo(0.2, 5);
  });

  it('returns null when landmarks are incomplete', () => {
    expect(featuresFromLandmarks([])).toBeNull();
    expect(featuresFromLandmarks(blank().slice(0, 10))).toBeNull();
  });

  it('never exposes raw landmarks on the result', () => {
    const f = featuresFromLandmarks(face({}));
    expect(Object.keys(f!).sort()).toEqual(['eyeOpenness', 'pitch', 'yaw']);
  });
});
