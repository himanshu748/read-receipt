import { performance } from 'node:perf_hooks';
import type { SmartSpectraSDK } from '@smartspectra/node-sdk';
import type * as Sdk from '@smartspectra/node-sdk';
import type { decodeMetrics } from '@smartspectra/node-sdk/messages';
import type { RecordedSample } from '@rr/protocol';
import { featuresFromLandmarks } from '../features.js';
import { previewJpeg } from './preview.js';

export type LiveEvent =
  | { type: 'sample'; sample: RecordedSample }
  | { type: 'preview'; jpeg: Uint8Array }
  | { type: 'ended' };

type SdkModule = typeof Sdk;
type Metrics = ReturnType<typeof decodeMetrics>;
type Stamp = number | { toNumber(): number } | null | undefined;
function timestamp(value: Stamp): number {
  return typeof value === 'number' ? value : value?.toNumber() ?? NaN;
}

/** Native SDK is loaded only after an explicitly consented Start. No recording. */
export class LiveSource {
  private sdk: SmartSpectraSDK | undefined;
  private listeners = new Set<(event: LiveEvent) => void>();
  private startedAt = 0;
  private lastFace = -Infinity;
  private lastPreview = -Infinity;
  private validation = 1;
  private seen = new Map<string, number>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private budget: ReturnType<typeof setTimeout> | undefined;
  private running = false;
  private used = false;
  private ended = false;
  private previewFps = 0;
  private startup: Promise<void> | undefined;
  private stopping: Promise<void> | undefined;
  private sdkVersion: string | null = null;
  private sdkWasRunning = false;

  constructor(private readonly options: {
    apiKey: string;
    consent: boolean;
    cameraIndex?: number;
    maxSeconds?: number;
    /** Test dependency injection: never set by the CLI. */
    load?: () => Promise<SdkModule>;
    now?: () => number;
    /** SDK metric timestamps are epoch microseconds. */
    wallNow?: () => number;
  }) {
    if (!options.consent) throw new Error('Explicit live-camera consent is required.');
    if (!options.apiKey.trim()) throw new Error('SMARTSPECTRA_API_KEY is required for live mode.');
    if (!Number.isInteger(options.cameraIndex ?? 0) || (options.cameraIndex ?? 0) < 0) throw new Error('Invalid camera index.');
    const seconds = options.maxSeconds ?? 90;
    if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 300) throw new Error('Live duration must be between 0 and 300 seconds.');
  }

  get version(): string | null { return this.sdkVersion; }
  onEvent(fn: (event: LiveEvent) => void): () => void {
    this.listeners.add(fn); return () => this.listeners.delete(fn);
  }
  private emit(event: LiveEvent): void { for (const fn of this.listeners) fn(event); }
  private now(): number { return this.options.now?.() ?? performance.now(); }
  private elapsed(): number { return Math.max(0, this.now() - this.startedAt); }
  private sample(sample: RecordedSample): void {
    if (this.running) this.emit({ type: 'sample', sample });
  }
  private fresh(stream: string, value: Stamp): boolean {
    const ts = timestamp(value);
    if (!Number.isFinite(ts) || ts <= (this.seen.get(stream) ?? -Infinity)) return false;
    const age = (this.options.wallNow?.() ?? Date.now()) - ts / 1000;
    // Never turn delayed but increasing SDK data into fresh viewer evidence.
    if (age > 500 || age < -250) return false;
    this.seen.set(stream, ts); return true;
  }

  /** One native session per helper process; reconnect for another consented run. */
  start(): Promise<void> {
    if (this.startup && this.running) return this.startup;
    if (this.used) return Promise.reject(new Error('Reconnect the helper before another live session.'));
    this.used = true; this.running = true; this.startedAt = this.now();
    this.startup = this.open();
    return this.startup;
  }
  private async open(): Promise<void> {
    try {
      const mod = await (this.options.load?.() ?? import('@smartspectra/node-sdk'));
      if (!this.running) return;
      this.sdkVersion = mod.SmartSpectraSDK.version;
      if (this.sdkVersion !== '3.5.0') throw new Error('The live adapter requires SDK 3.5.0.');
      const sdk = new mod.SmartSpectraSDK({ apiKey: this.options.apiKey,
        requestedMetrics: [mod.MetricType.FACE_LANDMARKS, mod.MetricType.BLINKING,
          mod.MetricType.PULSE_RATE, mod.MetricType.ARTERIAL_PRESSURE_TRACE],
        enableTelemetry: false, enableAccumulatedOutput: false });
      this.sdk = sdk;
      sdk.on('validationStatus', (code) => {
        if (!this.running) return;
        this.validation = code;
        this.sample({ kind: 'validation', t: this.elapsed(), code });
      });
      sdk.on('metrics', (buffer) => {
        if (!this.running) return;
        try { this.metrics(mod.decodeMetrics(buffer)); }
        catch { this.fail(8, false); }
      });
      sdk.on('error', (code, _message, retryable) => this.fail(code, retryable));
      sdk.on('processingStatus', (status) => {
        // Native initialization reports Idle before Starting/Running. It is not EOF.
        if (status === mod.ProcessingStatus.kRunning) this.sdkWasRunning = true;
        if (this.running && this.sdkWasRunning && status === mod.ProcessingStatus.kIdle) void this.stop();
      });
      sdk.on('videoOutput', (buffer, width, height, stride, format) => {
        if (!this.running || !this.previewFps || this.now() - this.lastPreview < 1000 / this.previewFps) return;
        this.lastPreview = this.now();
        const jpeg = previewJpeg(buffer, width, height, stride, format);
        if (jpeg) this.emit({ type: 'preview', jpeg });
      });
      const cameras = mod.SmartSpectraSDK.availableCameras();
      const camera = cameras[this.options.cameraIndex ?? 0];
      if (!camera) { this.fail(7, false); return; }
      sdk.useCamera(mod.CameraSelection.byId(camera.id), { width: 1280, height: 720, fps: 30 });
      this.budget = setTimeout(() => { void this.stop(); }, (this.options.maxSeconds ?? 90) * 1000);
      this.timer = setInterval(() => {
        if (this.elapsed() - this.lastFace > 500) {
          this.sample({ kind: 'validation', t: this.elapsed(), code: 1 });
          this.sample({ kind: 'features', t: this.elapsed(), faceFound: false,
            pitch: null, yaw: null, eyeOpenness: null, blinking: null, talking: null });
        }
      }, 100);
      sdk.start();
    } catch (error) {
      const code = typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'number' ? error.code : 8;
      this.fail(code, code === 5);
    }
  }

  /** Reduce raw landmarks in-process; never send landmark arrays to the editor. */
  private metrics(value: unknown): void {
    if (!value || typeof value !== 'object' || Buffer.isBuffer(value)) throw new Error('Invalid SDK payload.');
    const m = value as Metrics;
    const t = this.elapsed();
    const lm = m.face?.landmarks?.at(-1);
    if (lm && this.fresh('face', lm.timestamp)) {
      const points = lm.value;
      const valid = lm.stable === true && Array.isArray(points) && points.length === 478 &&
        points.every(p => typeof p.x === 'number' && Number.isFinite(p.x) && typeof p.y === 'number' && Number.isFinite(p.y));
      const derived = valid ? featuresFromLandmarks(points as Array<{ x: number; y: number }>) : null;
      const features = derived && Object.values(derived).every(Number.isFinite) ? derived : null;
      this.lastFace = t;
      this.sample({ kind: 'validation', t, code: this.validation });
      const blink = m.face?.blinking?.at(-1);
      this.sample({ kind: 'features', t, faceFound: features !== null,
        pitch: features?.pitch ?? null, yaw: features?.yaw ?? null, eyeOpenness: features?.eyeOpenness ?? null,
        blinking: blink?.stable === true ? blink.detected ?? null : null, talking: null });
    }
    for (const pressure of m.cardio?.arterialPressureTrace ?? []) {
      if (!this.fresh('pressure', pressure.timestamp)) continue;
      if (pressure.stable === true && Number.isFinite(pressure.confidence) && (pressure.confidence ?? 0) >= 30 && Number.isFinite(pressure.value)) {
        this.sample({ kind: 'pressure', t, value: pressure.value! });
      }
    }
    const pulse = m.cardio?.pulseRate?.at(-1);
    if (pulse && this.fresh('pulse', pulse.timestamp) && Number.isFinite(pulse.value) && Number.isFinite(pulse.confidence)) {
      this.sample({ kind: 'pulse', t, bpm: pulse.value!, stable: pulse.stable === true,
        confidence: pulse.stable === true ? Math.max(0, Math.min(1, pulse.confidence! / 100)) : 0 });
    }
  }

  setPreview(enabled: boolean, maxFps: number): void {
    this.previewFps = enabled && Number.isFinite(maxFps) ? Math.max(0, Math.min(10, maxFps)) : 0;
  }
  private fail(code: number, retryable: boolean): void {
    if (!this.running) return;
    // Native free-text diagnostics may include account or machine details.
    this.sample({ kind: 'error', t: this.elapsed(), code,
      message: `SmartSpectra live session failed (code ${code}). No automatic retry.`, retryable });
    // Do not await stop inside the native callback; allow open() to finish first.
    queueMicrotask(() => { void this.stop(); });
  }
  stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.used = true;
    this.running = false; this.previewFps = 0;
    if (this.timer) clearInterval(this.timer);
    if (this.budget) clearTimeout(this.budget);
    this.stopping = Promise.resolve().then(async () => {
      await this.startup;
      try { await this.sdk?.stopAsync(); }
      finally {
        try { await this.sdk?.destroy(); }
        finally { this.sdk = undefined; }
      }
    });
    // Invalidate synchronously, even when native drain/destruction never resolves.
    if (!this.ended) { this.ended = true; this.emit({ type: 'ended' }); }
    this.stopping.catch(() => { /* receipt state is already invalidated */ });
    return this.stopping;
  }
}
