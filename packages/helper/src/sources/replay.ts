import { readFile } from 'node:fs/promises';
import { isRecording, type RecordedSample, type Recording } from '@rr/protocol';

export type ReplayEvent =
  | { type: 'sample'; sample: RecordedSample }
  | { type: 'looped' }
  | { type: 'ended' };

export interface ReplaySourceOptions {
  /** Playback speed multiplier (1 = realtime). */
  speed?: number;
  loop?: boolean;
  /** Inject a clock for tests; defaults to real timers. */
  now?: () => number;
  setTimeout?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeout?: (id: ReturnType<typeof setTimeout>) => void;
}

/**
 * Plays a Recording on a wall-clock (or injected) timeline.
 * Call `start()` after subscribing to `onEvent`.
 */
export class ReplaySource {
  readonly recording: Recording;
  private readonly speed: number;
  private readonly loop: boolean;
  private readonly now: () => number;
  private readonly schedule: (
    fn: () => void,
    ms: number,
  ) => ReturnType<typeof setTimeout>;
  private readonly cancel: (id: ReturnType<typeof setTimeout>) => void;

  private listeners = new Set<(ev: ReplayEvent) => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private index = 0;
  private playing = false;
  private wallStart = 0;
  private pausedElapsed = 0;

  constructor(recording: Recording, opts: ReplaySourceOptions = {}) {
    this.recording = recording;
    this.speed = opts.speed ?? 1;
    this.loop = opts.loop ?? false;
    this.now = opts.now ?? Date.now;
    this.schedule = opts.setTimeout ?? setTimeout;
    this.cancel = opts.clearTimeout ?? clearTimeout;
  }

  static async fromFile(
    path: string,
    opts: ReplaySourceOptions = {},
  ): Promise<ReplaySource> {
    const raw = JSON.parse(await readFile(path, 'utf8')) as unknown;
    if (!isRecording(raw)) {
      throw new Error(`Invalid recording: ${path}`);
    }
    return new ReplaySource(raw, opts);
  }

  onEvent(fn: (ev: ReplayEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  get running(): boolean {
    return this.playing;
  }

  start(): void {
    if (this.playing) return;
    this.playing = true;
    this.wallStart = this.now() - this.pausedElapsed / this.speed;
    this.arm();
  }

  stop(): void {
    if (!this.playing) return;
    this.playing = false;
    this.pausedElapsed = (this.now() - this.wallStart) * this.speed;
    if (this.timer !== null) {
      this.cancel(this.timer);
      this.timer = null;
    }
  }

  reset(): void {
    this.stop();
    this.index = 0;
    this.pausedElapsed = 0;
  }

  /** Synchronously apply every sample via `fn` (no clock). Useful for tests. */
  forEachSample(fn: (sample: RecordedSample) => void): void {
    for (const s of this.recording.samples) fn(s);
  }

  private emit(ev: ReplayEvent): void {
    for (const fn of this.listeners) fn(ev);
  }

  private arm(): void {
    if (!this.playing) return;
    if (this.index >= this.recording.samples.length) {
      if (this.loop && this.recording.samples.length > 0) {
        this.index = 0;
        this.wallStart = this.now();
        this.pausedElapsed = 0;
        // Consumers must reset calibration and liveness before timestamps rewind.
        this.emit({ type: 'looped' });
        this.arm();
        return;
      }
      this.playing = false;
      this.emit({ type: 'ended' });
      return;
    }

    const sample = this.recording.samples[this.index]!;
    const elapsed = (this.now() - this.wallStart) * this.speed;
    const delay = Math.max(0, (sample.t - elapsed) / this.speed);

    this.timer = this.schedule(() => {
      this.timer = null;
      if (!this.playing) return;
      this.emit({ type: 'sample', sample });
      this.index += 1;
      this.arm();
    }, delay);
  }
}
