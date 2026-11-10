#!/usr/bin/env node
/**
 * Spike S0 — run on an Apple Silicon Mac with a Presage API key.
 * Uses ~2–3 minutes of free credits. Records NO video.
 *
 *   export SMARTSPECTRA_API_KEY=...
 *   node packages/helper/spike/probe.mjs
 *
 * Writes packages/helper/spike/s0-summary.json for the architect.
 *
 * Verifies against @smartspectra/node-sdk (see PLAN.md §0):
 * - Does videoOutput fire with useCamera?
 * - Landmark coordinate range (pixels vs 0–1)?
 * - Blink during a deliberate ~2 s eye closure?
 * - Pulse latency + confidence?
 * - Pitch while looking at screen vs keyboard?
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, 's0-summary.json');

const apiKey = process.env.SMARTSPECTRA_API_KEY;
if (!apiKey) {
  console.error('Set SMARTSPECTRA_API_KEY');
  process.exit(1);
}

let sdkMod;
try {
  sdkMod = await import('@smartspectra/node-sdk');
} catch (e) {
  console.error(
    'Install the SDK first: npm install @smartspectra/node-sdk -w @rr/helper',
  );
  console.error(e);
  process.exit(1);
}

const {
  SmartSpectraSDK,
  CameraSelection,
  cardioMetrics,
  faceMetrics,
  decodeMetrics,
  ValidationCode,
} = sdkMod;

const summary = {
  startedAt: new Date().toISOString(),
  sdkVersion: SmartSpectraSDK.version ?? null,
  videoOutputFrames: 0,
  videoOutputSample: null,
  landmarkSamples: 0,
  landmarkCoordRange: { minX: null, maxX: null, minY: null, maxY: null },
  blinkTrueMs: 0,
  blinkRuns: [],
  firstPulseAtMs: null,
  pulseSamples: [],
  validationCounts: {},
  pitchSamples: [],
  notes: [],
  errors: [],
};

const t0 = Date.now();
const elapsed = () => Date.now() - t0;

const sdk = new SmartSpectraSDK({
  apiKey,
  requestedMetrics: [...cardioMetrics, ...faceMetrics],
  enableTelemetry: false,
});

let blinkRunStart = null;

sdk.on('videoOutput', (buf, width, height, stride, pixelFormat, _ts) => {
  summary.videoOutputFrames++;
  if (!summary.videoOutputSample) {
    summary.videoOutputSample = {
      width,
      height,
      stride,
      pixelFormat,
      bytes: buf?.length ?? 0,
    };
  }
});

sdk.on('validationStatus', (code, _ts, hint) => {
  const key = String(code);
  summary.validationCounts[key] =
    (summary.validationCounts[key] ?? 0) + 1;
  if (code !== ValidationCode?.kOk && summary.notes.length < 20) {
    summary.notes.push(`validation ${code} ${hint} @${elapsed()}ms`);
  }
});

sdk.on('error', (code, message, retryable) => {
  summary.errors.push({ code, message, retryable, t: elapsed() });
});

sdk.on('metrics', (buf) => {
  const metrics = decodeMetrics(buf);
  if (!metrics || Buffer.isBuffer(metrics)) return;

  const lm = metrics.face?.landmarks?.at(-1)?.value;
  if (Array.isArray(lm) && lm.length > 0) {
    summary.landmarkSamples++;
    for (const p of lm) {
      if (typeof p?.x !== 'number' || typeof p?.y !== 'number') continue;
      const r = summary.landmarkCoordRange;
      r.minX = r.minX == null ? p.x : Math.min(r.minX, p.x);
      r.maxX = r.maxX == null ? p.x : Math.max(r.maxX, p.x);
      r.minY = r.minY == null ? p.y : Math.min(r.minY, p.y);
      r.maxY = r.maxY == null ? p.y : Math.max(r.maxY, p.y);
    }
    // Nose tip (1), eyes (33, 263), chin (152), forehead (10)
    const nose = lm[1];
    const eL = lm[33];
    const eR = lm[263];
    const chin = lm[152];
    const brow = lm[10];
    if (nose && eL && eR && chin && brow) {
      const eyeMidY = (eL.y + eR.y) / 2;
      const faceH = Math.abs(brow.y - chin.y) || 1;
      const pitch = (nose.y - eyeMidY) / faceH;
      if (summary.pitchSamples.length < 500) {
        summary.pitchSamples.push({ t: elapsed(), pitch });
      }
    }
  }

  const blink = metrics.face?.blinking?.at(-1)?.detected;
  if (blink === true) {
    if (blinkRunStart == null) blinkRunStart = elapsed();
  } else if (blink === false && blinkRunStart != null) {
    const dur = elapsed() - blinkRunStart;
    summary.blinkRuns.push({ startMs: blinkRunStart, durationMs: dur });
    summary.blinkTrueMs += dur;
    blinkRunStart = null;
  }

  const pulse = metrics.cardio?.pulseRate?.at(-1);
  if (pulse && typeof pulse.value === 'number') {
    if (summary.firstPulseAtMs == null) summary.firstPulseAtMs = elapsed();
    if (summary.pulseSamples.length < 100) {
      summary.pulseSamples.push({
        t: elapsed(),
        bpm: pulse.value,
        confidence: pulse.confidence ?? null,
        stable: pulse.stable ?? null,
      });
    }
  }
});

console.log('S0 probe: opening default camera for ~150s…');
console.log('Please: face camera 20s → look at keyboard 5s → face camera →');
console.log('close eyes ~2s → open → hold still for pulse.');

try {
  const cameras = SmartSpectraSDK.availableCameras?.() ?? [];
  summary.notes.push(`cameras: ${JSON.stringify(cameras)}`);
  sdk.useCamera(CameraSelection.default, { width: 1280, height: 720, fps: 30 });
  sdk.start();
} catch (e) {
  summary.errors.push({
    code: e?.code,
    message: String(e?.message ?? e),
    retryable: e?.retryable ?? false,
    t: elapsed(),
  });
  finish(1);
}

const timer = setTimeout(() => finish(0), 150_000);

async function finish(code) {
  clearTimeout(timer);
  try {
    await sdk.stopAsync?.();
  } catch {
    /* ignore */
  }
  try {
    await sdk.destroy?.();
  } catch {
    /* ignore */
  }
  summary.endedAt = new Date().toISOString();
  summary.durationMs = elapsed();
  summary.videoOutputFires = summary.videoOutputFrames > 0;
  summary.landmarkLooksNormalized =
    summary.landmarkCoordRange.maxX != null &&
    summary.landmarkCoordRange.maxX <= 1.5;
  mkdirSync(__dirname, { recursive: true });
  writeFileSync(OUT, JSON.stringify(summary, null, 2));
  console.log(`Wrote ${OUT}`);
  console.log(
    JSON.stringify(
      {
        videoOutputFires: summary.videoOutputFires,
        frames: summary.videoOutputFrames,
        landmarkLooksNormalized: summary.landmarkLooksNormalized,
        landmarkCoordRange: summary.landmarkCoordRange,
        firstPulseAtMs: summary.firstPulseAtMs,
        pulseCount: summary.pulseSamples.length,
        blinkRuns: summary.blinkRuns.length,
        errors: summary.errors.length,
      },
      null,
      2,
    ),
  );
  process.exit(code);
}

process.on('SIGINT', () => finish(0));
