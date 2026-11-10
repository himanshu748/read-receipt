import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { RecordedSample, Recording } from '@rr/protocol';

/**
 * Appends RecordedSample entries and flushes a Recording JSON file.
 * Never stores frames or raw landmarks.
 */
export class Recorder {
  private readonly samples: RecordedSample[] = [];
  private readonly path: string;
  private readonly createdAt: string;
  private readonly source: Recording['source'];
  private readonly sdkVersion: string | null;
  private readonly note: string | undefined;
  private dirty = false;

  constructor(
    path: string,
    opts: {
      source?: Recording['source'];
      sdkVersion?: string | null;
      note?: string;
      createdAt?: string;
    } = {},
  ) {
    this.path = path;
    this.source = opts.source ?? 'live';
    this.sdkVersion = opts.sdkVersion ?? null;
    this.note = opts.note;
    this.createdAt = opts.createdAt ?? new Date().toISOString();
  }

  append(sample: RecordedSample): void {
    this.samples.push(sample);
    this.dirty = true;
  }

  get size(): number {
    return this.samples.length;
  }

  toRecording(): Recording {
    const base: Recording = {
      format: 'read-receipt-recording',
      version: 1,
      createdAt: this.createdAt,
      source: this.source,
      sdkVersion: this.sdkVersion,
      samples: this.samples.slice().sort((a, b) => a.t - b.t),
    };
    if (this.note !== undefined) {
      return { ...base, note: this.note };
    }
    return base;
  }

  async flush(): Promise<void> {
    if (!this.dirty && this.samples.length === 0) {
      // Still write an empty recording so the path exists.
    }
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, JSON.stringify(this.toRecording(), null, 2));
    this.dirty = false;
  }
}
