import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as Sdk from '@smartspectra/node-sdk';
import { LiveSource, type LiveEvent } from './live.js';
import { parseArgs } from '../main.js';

type SdkModule = typeof Sdk;
const sources: LiveSource[] = [];

function rig(options: { cameraIndex?: number; maxSeconds?: number } = {}) {
  let now = 0;
  const callbacks = new Map<string, (...args: unknown[]) => void>();
  const constructed = vi.fn();
  const useCamera = vi.fn();
  const start = vi.fn();
  const stopAsync = vi.fn(async () => {});
  const destroy = vi.fn(async () => {});
  class FakeSdk {
    static version = '3.5.0';
    static availableCameras = vi.fn(() => [{ id: 'camera-a' }, { id: 'camera-b' }]);
    constructor(config: unknown) { constructed(config); }
    on(event: string, callback: (...args: unknown[]) => void) { callbacks.set(event, callback); return this; }
    useCamera = useCamera;
    start = start;
    stopAsync = stopAsync;
    destroy = destroy;
  }
  const decodeMetrics = vi.fn((value: unknown) => value);
  const load = vi.fn(async () => ({ SmartSpectraSDK: FakeSdk,
    MetricType: { FACE_LANDMARKS: 11, BLINKING: 12, PULSE_RATE: 15, ARTERIAL_PRESSURE_TRACE: 16 },
    ProcessingStatus: { kIdle: 1, kRunning: 3 }, CameraSelection: { byId: (id: string) => ({ kind: 'byId', id }) },
    decodeMetrics }) as unknown as SdkModule);
  const source = new LiveSource({ apiKey: 'fixture-key', consent: true, load,
    now: () => now, wallNow: () => now, ...options });
  sources.push(source);
  const events: LiveEvent[] = [];
  source.onEvent(event => events.push(event));
  return { source, events, load, constructed, start, stopAsync, destroy, useCamera, FakeSdk,
    setTime: (value: number) => { now = value; },
    send: (event: string, ...args: unknown[]) => { callbacks.get(event)?.(...args); },
    samples: () => events.flatMap(event => event.type === 'sample' ? [event.sample] : []) };
}

function face() {
  const points = Array.from({ length: 478 }, () => ({ x: 0, y: 0 }));
  for (const [index, x, y] of [[33, 0, 100], [133, 30, 100], [362, 70, 100], [263, 100, 100],
    [10, 50, 0], [152, 50, 200], [1, 50, 120], [159, 15, 96], [145, 15, 104],
    [386, 85, 96], [374, 85, 104]] as const) points[index] = { x, y };
  return points;
}

function landmarks(timestamp = 100) {
  return { face: { landmarks: [{ value: face(), stable: true, timestamp }],
    blinking: [{ detected: false, stable: true, timestamp }] } };
}

afterEach(async () => {
  for (const source of sources.splice(0)) await source.stop();
  vi.useRealTimers();
});

describe('live SDK boundary with an injected SDK, never a physical camera', () => {
  it('does not load native SDK or construct a camera session before Start', async () => {
    const r = rig();
    expect(r.load).not.toHaveBeenCalled();
    expect(r.constructed).not.toHaveBeenCalled();
    expect(r.source.version).toBeNull();
    await r.source.start();
    expect(r.load).toHaveBeenCalledTimes(1);
    expect(r.source.version).toBe('3.5.0');
  });

  it.each([
    { consent: false }, { apiKey: '   ' }, { cameraIndex: -1 }, { cameraIndex: 0.5 },
    { cameraIndex: NaN }, { maxSeconds: 0 }, { maxSeconds: 301 }, { maxSeconds: Infinity },
  ])('rejects unsafe configuration before loading the SDK: %j', overrides => {
    const load = vi.fn();
    expect(() => new LiveSource({ apiKey: 'fixture-key', consent: true, load, ...overrides })).toThrow();
    expect(load).not.toHaveBeenCalled();
  });

  it('requests only required metrics, disables optional uploads, and selects the exact camera', async () => {
    const r = rig({ cameraIndex: 1 });
    await r.source.start();
    expect(r.constructed).toHaveBeenCalledWith({ apiKey: 'fixture-key', requestedMetrics: [11, 12, 15, 16],
      enableTelemetry: false, enableAccumulatedOutput: false });
    expect(r.useCamera).toHaveBeenCalledWith({ kind: 'byId', id: 'camera-b' }, { width: 1280, height: 720, fps: 30 });
    expect(r.start).toHaveBeenCalledTimes(1);
  });

  it('ignores initial SDK Idle but stops when a running pipeline later becomes Idle', async () => {
    const r = rig();
    await r.source.start();
    r.send('processingStatus', 1);
    expect(r.events.some(event => event.type === 'ended')).toBe(false);
    expect(r.stopAsync).not.toHaveBeenCalled();
    r.send('processingStatus', 2);
    r.send('processingStatus', 3);
    r.send('processingStatus', 1);
    expect(r.events.filter(event => event.type === 'ended')).toHaveLength(1);
    await r.source.stop();
    expect(r.stopAsync).toHaveBeenCalledTimes(1);
    expect(r.destroy).toHaveBeenCalledTimes(1);
  });

  it('fails closed when the selected camera is missing, without falling back', async () => {
    const r = rig({ cameraIndex: 2 });
    await r.source.start();
    await r.source.stop();
    expect(r.start).not.toHaveBeenCalled();
    expect(r.samples()).toContainEqual(expect.objectContaining({ kind: 'error', code: 7 }));
    expect(r.destroy).toHaveBeenCalledTimes(1);
  });

  it('rejects a mismatched JS SDK version before native construction', async () => {
    const r = rig();
    r.FakeSdk.version = '3.4.0';
    await r.source.start();
    await r.source.stop();
    expect(r.constructed).not.toHaveBeenCalled();
    expect(r.samples()).toContainEqual(expect.objectContaining({ kind: 'error', code: 8 }));
  });

  it('reduces finite landmarks locally to ratios without leaking raw landmark arrays', async () => {
    const r = rig();
    await r.source.start();
    r.send('validationStatus', 0, 100, 'ok');
    r.send('metrics', landmarks());
    const feature = r.samples().find(sample => sample.kind === 'features');
    expect(feature).toEqual({ kind: 'features', t: 0, faceFound: true, pitch: 0.1,
      yaw: 0, eyeOpenness: 0.08, blinking: false, talking: null });
    expect(JSON.stringify(r.events)).not.toContain('landmarks');
  });

  it.each(['short', 'nonfinite', 'unstable'] as const)('invalid %s landmarks clear face visibility', async invalid => {
    const r = rig();
    await r.source.start();
    const payload = landmarks();
    if (invalid === 'short') payload.face.landmarks[0]!.value.pop();
    if (invalid === 'nonfinite') payload.face.landmarks[0]!.value[33]!.x = Infinity;
    if (invalid === 'unstable') payload.face.landmarks[0]!.stable = false;
    r.send('metrics', payload);
    expect(r.samples()).toContainEqual(expect.objectContaining({ kind: 'features', faceFound: false,
      pitch: null, yaw: null, eyeOpenness: null }));
  });

  it('normalizes confidence and never grants confidence to unstable pulse samples', async () => {
    const r = rig();
    await r.source.start();
    for (const [timestamp, confidence, stable] of [[100, 75, true], [200, 95, false], [300, 140, true]] as const) {
      r.send('metrics', { cardio: { pulseRate: [{ timestamp, confidence, stable, value: 72 }] } });
    }
    const samples = r.samples().filter(sample => sample.kind === 'pulse');
    expect(samples.map(sample => sample.confidence)).toEqual([0.75, 0, 1]);
  });

  it('forwards only stable pressure samples meeting the confidence floor', async () => {
    const r = rig();
    await r.source.start();
    r.send('metrics', { cardio: { arterialPressureTrace: [
      { timestamp: 1, confidence: 80, stable: false, value: 1 },
      { timestamp: 2, confidence: 20, stable: true, value: 2 },
      { timestamp: 3, confidence: 80, stable: true, value: NaN },
      { timestamp: 4, confidence: 80, stable: true, value: 4 },
    ] } });
    expect(r.samples()).toEqual([{ kind: 'pressure', t: 0, value: 4 }]);
  });

  it('does not refresh face or pulse freshness from duplicate or backwards SDK timestamps', async () => {
    vi.useFakeTimers();
    const r = rig();
    await r.source.start();
    const packet = { ...landmarks(), cardio: { pulseRate: [{ timestamp: { toNumber: () => 100 },
      value: 72, confidence: 80, stable: true }] } };
    r.send('metrics', packet);
    r.setTime(400);
    r.send('metrics', packet);
    r.send('metrics', { ...landmarks(99), cardio: { pulseRate: [{ timestamp: 99, value: 72, confidence: 80, stable: true }] } });
    expect(r.samples().filter(sample => sample.kind === 'pulse')).toHaveLength(1);
    expect(r.samples().filter(sample => sample.kind === 'features')).toHaveLength(1);
    r.setTime(601);
    await vi.advanceTimersByTimeAsync(100);
    expect(r.samples()).toContainEqual(expect.objectContaining({ kind: 'features', t: 601, faceFound: false }));
    expect(r.samples()).toContainEqual({ kind: 'validation', t: 601, code: 1 });
  });

  it('rejects increasing but delayed samples without refreshing face, pulse or pressure evidence', async () => {
    vi.useFakeTimers();
    const r = rig();
    await r.source.start();
    const packet = (timestamp: number) => ({ ...landmarks(timestamp), cardio: {
      pulseRate: [{ timestamp, value: 72, confidence: 80, stable: true }],
      arterialPressureTrace: [{ timestamp, value: 1, confidence: 80, stable: true }],
    } });
    r.send('metrics', packet(20_000));
    const accepted = [...r.samples()];
    r.setTime(1000);
    r.send('metrics', packet(30_000));
    r.send('metrics', packet(40_000));
    expect(r.samples()).toEqual(accepted);
    await vi.advanceTimersByTimeAsync(100);
    expect(r.samples()).toContainEqual(expect.objectContaining({ kind: 'features', t: 1000, faceFound: false }));
    expect(r.samples().filter(sample => sample.kind === 'pulse')).toHaveLength(1);
    expect(r.samples().filter(sample => sample.kind === 'pressure')).toHaveLength(1);
    r.send('metrics', packet(1_000_000));
    expect(r.samples().filter(sample => sample.kind === 'features' && sample.faceFound)).toHaveLength(2);
    expect(r.samples().filter(sample => sample.kind === 'pulse')).toHaveLength(2);
    expect(r.samples().filter(sample => sample.kind === 'pressure')).toHaveLength(2);
  });

  it('rejects future timestamps without preventing a subsequent current sample', async () => {
    const r = rig();
    await r.source.start();
    const packet = (timestamp: number) => ({ ...landmarks(timestamp), cardio: {
      pulseRate: [{ timestamp, value: 72, confidence: 80, stable: true }],
      arterialPressureTrace: [{ timestamp, value: 1, confidence: 80, stable: true }],
    } });
    r.send('metrics', packet(251_000));
    expect(r.samples()).toEqual([]);
    r.send('metrics', packet(100));
    expect(r.samples()).toContainEqual(expect.objectContaining({ kind: 'features', faceFound: true }));
    expect(r.samples()).toContainEqual(expect.objectContaining({ kind: 'pulse', bpm: 72 }));
    expect(r.samples()).toContainEqual(expect.objectContaining({ kind: 'pressure', value: 1 }));
  });

  it('redacts native error details, stops once, and ignores late callbacks', async () => {
    const r = rig();
    await r.source.start();
    r.send('error', 5, 'private machine path and credential', true);
    await r.source.stop();
    const before = r.events.length;
    r.send('metrics', landmarks());
    r.send('validationStatus', 0);
    expect(r.events).toHaveLength(before);
    expect(r.samples()).toEqual([expect.objectContaining({ kind: 'error', code: 5, retryable: true })]);
    expect(JSON.stringify(r.events)).not.toContain('private machine');
    await r.source.stop();
    expect(r.stopAsync).toHaveBeenCalledTimes(1);
    expect(r.destroy).toHaveBeenCalledTimes(1);
    expect(r.events.filter(event => event.type === 'ended')).toHaveLength(1);
  });

  it('stops and destroys exactly once on explicit Stop or SDK idle', async () => {
    const r = rig();
    await r.source.start();
    r.send('processingStatus', 1);
    await Promise.all([r.source.stop(), r.source.stop()]);
    expect(r.stopAsync).toHaveBeenCalledTimes(1);
    expect(r.destroy).toHaveBeenCalledTimes(1);
  });

  it('rejects Start after a completed session instead of reusing its startup promise', async () => {
    const r = rig();
    await r.source.start();
    await r.source.stop();
    await expect(r.source.start()).rejects.toThrow('Reconnect');
    expect(r.load).toHaveBeenCalledTimes(1);
    expect(r.start).toHaveBeenCalledTimes(1);
    expect(r.destroy).toHaveBeenCalledTimes(1);
  });

  it('keeps the camera off when Stop occurs before the first Start', async () => {
    const r = rig();
    await r.source.stop();
    await expect(r.source.start()).rejects.toThrow('Reconnect');
    expect(r.load).not.toHaveBeenCalled();
    expect(r.start).not.toHaveBeenCalled();
    expect(r.destroy).not.toHaveBeenCalled();
    expect(r.events.filter(event => event.type === 'ended')).toHaveLength(1);
  });

  it('enforces the live duration budget without a retry', async () => {
    vi.useFakeTimers();
    const r = rig({ maxSeconds: 2 });
    await r.source.start();
    await vi.advanceTimersByTimeAsync(2000);
    await r.source.stop();
    expect(r.start).toHaveBeenCalledTimes(1);
    expect(r.stopAsync).toHaveBeenCalledTimes(1);
    expect(r.destroy).toHaveBeenCalledTimes(1);
  });

  it.each(['explicit Stop', 'duration budget'] as const)('invalidates immediately on %s even if native stop hangs', async trigger => {
    vi.useFakeTimers();
    const r = rig({ maxSeconds: 1 });
    let release = () => {};
    r.stopAsync.mockReturnValueOnce(new Promise<void>(resolve => { release = resolve; }));
    await r.source.start();
    try {
      if (trigger === 'explicit Stop') void r.source.stop();
      else await vi.advanceTimersByTimeAsync(1000);
      expect(r.events.filter(event => event.type === 'ended')).toHaveLength(1);
      const before = r.events.length;
      r.send('metrics', landmarks());
      r.send('validationStatus', 0);
      expect(r.events).toHaveLength(before);
      const drained = vi.fn();
      void r.source.stop().then(drained);
      await Promise.resolve();
      await Promise.resolve();
      expect(drained).not.toHaveBeenCalled();
      expect(r.destroy).not.toHaveBeenCalled();
    } finally {
      release();
      await r.source.stop();
    }
    expect(r.stopAsync).toHaveBeenCalledTimes(1);
    expect(r.destroy).toHaveBeenCalledTimes(1);
    expect(r.events.filter(event => event.type === 'ended')).toHaveLength(1);
  });

  it('requires enabled preview and caps JPEG delivery at ten frames per second', async () => {
    const r = rig();
    await r.source.start();
    const frame = Buffer.from([255, 0, 0, 255]);
    r.send('videoOutput', frame, 1, 1, 4, 2);
    expect(r.events.filter(event => event.type === 'preview')).toHaveLength(0);
    r.source.setPreview(true, 1000);
    r.send('videoOutput', frame, 1, 1, 4, 2);
    r.setTime(99); r.send('videoOutput', frame, 1, 1, 4, 2);
    r.setTime(100); r.send('videoOutput', frame, 1, 1, 4, 2);
    expect(r.events.filter(event => event.type === 'preview')).toHaveLength(2);
    r.source.setPreview(false, 10);
    r.setTime(500); r.send('videoOutput', frame, 1, 1, 4, 2);
    expect(r.events.filter(event => event.type === 'preview')).toHaveLength(2);
  });

  it('fails closed for malformed SDK metrics', async () => {
    const r = rig();
    await r.source.start();
    r.send('metrics', Buffer.from('not a decoded protobuf'));
    await r.source.stop();
    expect(r.samples()).toContainEqual(expect.objectContaining({ kind: 'error', code: 8 }));
    expect(r.destroy).toHaveBeenCalledTimes(1);
  });
});

describe('live helper CLI validation without loading a native SDK', () => {
  const args = ['--mode', 'live', '--token', 'aabb', '--live-consent'];
  it('requires explicit consent and defaults to a bounded ninety-second run', () => {
    expect(() => parseArgs(['--mode', 'live', '--token', 'aabb'])).toThrow('consent');
    expect(parseArgs(args)).toMatchObject({ mode: 'live', liveConsent: true, maxLiveSeconds: 90 });
  });
  it.each([
    ['--record', '/tmp/not-written.json'], ['--replay', 'fixture.json'], ['--loop'], ['--speed', '2'],
    ['--camera', '-1'], ['--camera', '0.5'], ['--max-live-seconds', '301'],
    ['--max-live-seconds', '0'], ['--port', '65536'], ['--port', '0.5'], ['--mode', 'typo'],
  ])('rejects conflicting or unbounded live options %j', (...extra) => {
    expect(() => parseArgs([...args, ...extra])).toThrow();
  });
});
