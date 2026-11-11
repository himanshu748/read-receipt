/** Synthetic, sustained review input. No camera data or SDK calls. */
export function reviewRecording(durationMs = 300_000) {
  const samples = [];
  for (let t = 0; t <= durationMs; t += 100) {
    samples.push({ t, kind: 'validation', code: 0 });
    samples.push({ t, kind: 'features', faceFound: true,
      pitch: 0.02 * Math.sin(t / 1300), yaw: 0.01 * Math.sin(t / 1700),
      eyeOpenness: 0.3, blinking: false, talking: false });
    samples.push({ t, kind: 'pressure', value: Math.sin(t / 130) });
    if (t % 1000 === 0) samples.push({ t, kind: 'pulse', bpm: 72, confidence: 0.9, stable: true });
  }
  return { format: 'read-receipt-recording', version: 1, createdAt: '2026-11-11T00:00:00.000Z',
    source: 'synthetic', sdkVersion: null,
    note: 'Synthetic five-minute review session. Receipts must be labelled replay, never a live viewer.', samples };
}
