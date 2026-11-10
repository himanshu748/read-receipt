#!/usr/bin/env node
/**
 * Generates fixtures/replay/demo-session.json
 * Segments: calibrate → read → blink → 2s closure → look down →
 * no face → two faces → too dark → credits exhausted.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ValidationCode = {
  kOk: 0,
  kNoFaceFound: 1,
  kMultipleFacesFound: 2,
  kTooDark: 5,
};

const ErrorCode = {
  kCreditExhausted: 4,
};

const DT = 100; // 10 Hz feature/validation ticks
const BASE_PITCH = 0.12;
const BASE_YAW = 0.0;
const BASE_EYE = 0.08;

/** @type {import('@rr/protocol').RecordedSample[]} */
const samples = [];

function push(sample) {
  samples.push(sample);
}

function features(t, overrides = {}) {
  const faceFound = overrides.faceFound ?? true;
  push({
    t,
    kind: 'features',
    faceFound,
    pitch: Object.hasOwn(overrides, 'pitch')
      ? overrides.pitch
      : faceFound
        ? BASE_PITCH + Math.sin(t / 1000) * 0.002
        : null,
    yaw: Object.hasOwn(overrides, 'yaw')
      ? overrides.yaw
      : faceFound
        ? BASE_YAW + Math.cos(t / 1100) * 0.001
        : null,
    eyeOpenness: Object.hasOwn(overrides, 'eyeOpenness')
      ? overrides.eyeOpenness
      : faceFound
        ? BASE_EYE + Math.sin(t / 900) * 0.001
        : null,
    blinking: Object.hasOwn(overrides, 'blinking') ? overrides.blinking : false,
    talking: Object.hasOwn(overrides, 'talking') ? overrides.talking : false,
  });
}

function validation(t, code) {
  push({ t, kind: 'validation', code });
}

function pulse(t, bpm = 72) {
  push({ t, kind: 'pulse', bpm, confidence: 0.95, stable: true });
}

function pressure(t, phase = 0) {
  // Non-flat arterial pressure proxy.
  push({
    t,
    kind: 'pressure',
    value: 1.0 + 0.35 * Math.sin((t / 1000) * Math.PI * 2.4 + phase),
  });
}

function emitTick(t, featOverrides = {}, valCode = ValidationCode.kOk) {
  validation(t, valCode);
  features(t, featOverrides);
  pressure(t);
  // Pulse ~1 Hz once past the SDK's ~12 s warm-up.
  if (t >= 12000 && t % 1000 < DT) {
    pulse(t);
  }
}

/** Segment helper: inclusive start, exclusive end. */
function segment(t0, t1, tick) {
  for (let t = t0; t < t1; t += DT) tick(t);
}

// --- Timeline (ms) ---
// 0–20000     calibrate (kOk + face + features; pulse from 12s)
// 20000–25000 reading
// 25000–25800 blink (~800 ms) — should stay eyesOpen
// 25800–28000 reading
// 28000–30000 2 s eye closure — eyes-closed after 1 s
// 30000–32000 reading
// 32000–35000 looking down
// 35000–37000 no face
// 37000–39000 two faces
// 39000–41000 too dark
// 41000–43000 credits exhausted

segment(0, 20000, (t) => emitTick(t));
segment(20000, 25000, (t) => emitTick(t));
segment(25000, 25800, (t) =>
  emitTick(t, { blinking: true, eyeOpenness: BASE_EYE * 0.2 }),
);
segment(25800, 28000, (t) => emitTick(t));
segment(28000, 30000, (t) =>
  emitTick(t, { blinking: true, eyeOpenness: BASE_EYE * 0.15 }),
);
segment(30000, 32000, (t) => emitTick(t));
segment(32000, 35000, (t) =>
  emitTick(t, { pitch: BASE_PITCH + 0.08 }), // large z vs calib sd ~0.0014
);
segment(35000, 37000, (t) =>
  emitTick(t, { faceFound: false, pitch: null, yaw: null, eyeOpenness: null }, ValidationCode.kNoFaceFound),
);
segment(37000, 39000, (t) =>
  emitTick(t, {}, ValidationCode.kMultipleFacesFound),
);
segment(39000, 41000, (t) => emitTick(t, {}, ValidationCode.kTooDark));

// Credits exhausted: keep features briefly then sticky error.
segment(41000, 42000, (t) => emitTick(t));
push({
  t: 42000,
  kind: 'error',
  code: ErrorCode.kCreditExhausted,
  message: 'Presage credits exhausted',
  retryable: false,
});
segment(42000, 43000, (t) => emitTick(t));

samples.sort((a, b) => a.t - b.t || kindOrder(a.kind) - kindOrder(b.kind));

function kindOrder(k) {
  const order = {
    validation: 0,
    features: 1,
    pulse: 2,
    pressure: 3,
    error: 4,
  };
  return order[k] ?? 9;
}

const recording = {
  format: 'read-receipt-recording',
  version: 1,
  createdAt: new Date().toISOString(),
  source: 'synthetic',
  sdkVersion: null,
  note: 'A1 demo: calibrate→read→blink→closure→look-down→no-face→two-faces→too-dark→credits',
  samples,
};

const here = dirname(fileURLToPath(import.meta.url));
const outPath = join(here, '../../../fixtures/replay/demo-session.json');
await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, JSON.stringify(recording, null, 2) + '\n');
process.stdout.write(
  `Wrote ${samples.length} samples → ${outPath}\n`,
);
