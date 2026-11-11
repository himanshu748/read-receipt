import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { isHelperToClient, type HelperToClient, type RecordedSample, type Recording } from '@rr/protocol';
import { startHelperServer, type HelperServer } from './server.js';
import { ReplaySource } from './sources/replay.js';
import { defaultEyesOnConfig } from './eyesOn.js';
import { ErrorCode } from './codes.js';

class Clock {
  time = 0;
  next = 0;
  jobs = new Map<number, { at: number; run: () => void }>();
  now = () => this.time;
  schedule = (run: () => void, delay: number) => {
    const id = ++this.next;
    this.jobs.set(id, { at: this.time + delay, run });
    return id as unknown as ReturnType<typeof setTimeout>;
  };
  cancel = (id: ReturnType<typeof setTimeout>) => { this.jobs.delete(id as unknown as number); };
  advance(milliseconds: number) {
    const end = this.time + milliseconds;
    let count = 0;
    for (;;) {
      const next = [...this.jobs.entries()].sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!next || next[1].at > end) break;
      if (++count > 10000) throw new Error('Replay scheduler did not yield');
      this.time = next[1].at;
      this.jobs.delete(next[0]);
      next[1].run();
    }
    this.time = end;
  }
}

function recording(withError = false): Recording {
  const samples: RecordedSample[] = [];
  for (let t = 0; t <= 1000; t += 100) {
    samples.push({ t, kind: 'validation', code: 0 });
    samples.push({ t, kind: 'features', faceFound: true, pitch: 0.12 + Math.sin(t) * 0.001, yaw: 0,
      eyeOpenness: 0.08, blinking: false, talking: false });
    samples.push({ t, kind: 'pressure', value: 1 + Math.sin(t / 100) * 0.3 });
    if (t % 500 === 0) samples.push({ t, kind: 'pulse', bpm: 72, confidence: 0.95, stable: true });
  }
  if (withError) samples.push({ t: 1000, kind: 'error', code: ErrorCode.kCreditExhausted,
    message: 'Synthetic exhausted-credit fixture', retryable: false });
  return { format: 'read-receipt-recording', version: 1, createdAt: '2026-01-01T00:00:00Z',
    source: 'synthetic', sdkVersion: null, samples };
}

const wait = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));

async function until(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return;
    await wait(5);
  }
  throw new Error('Timed out waiting for helper lifecycle message');
}

describe('replay session lifecycle over a real WebSocket connection', () => {
  let server: HelperServer | undefined;
  let socket: WebSocket | undefined;
  let messages: HelperToClient[];

  afterEach(async () => {
    socket?.close();
    await server?.close();
    socket = undefined;
    server = undefined;
  });

  async function boot(options: { loop?: boolean; withError?: boolean } = {}) {
    const clock = new Clock();
    const replay = new ReplaySource(recording(options.withError), {
      loop: options.loop ?? false, now: clock.now, setTimeout: clock.schedule, clearTimeout: clock.cancel,
    });
    server = await startHelperServer({ port: 0, token: 'abcdef1234', source: 'replay', replay,
      stateHz: 100, cfg: defaultEyesOnConfig({ calibrationSec: 0.2, tunables: { lookDownHysteresisMs: 0 } }) });
    messages = [];
    socket = new WebSocket(`ws://127.0.0.1:${server.port}/?token=abcdef1234`);
    socket.on('message', data => {
      const message: unknown = JSON.parse(String(data));
      if (isHelperToClient(message)) messages.push(message);
    });
    await new Promise<void>((resolve, reject) => { socket!.once('open', resolve); socket!.once('error', reject); });
    await until(() => messages.some(m => m.type === 'hello'));
    return { clock, replay };
  }

  async function start() {
    const prior = messages.length;
    socket!.send(JSON.stringify({ type: 'start' }));
    await until(() => messages.slice(prior).some(m => m.type === 'phase' && m.phase === 'calibrating'));
    return prior;
  }

  const latestState = () => messages.filter(m => m.type === 'state').at(-1);

  it('invalidates a positive final state at EOF and stops heartbeats', async () => {
    const { clock, replay } = await boot();
    await start();
    clock.advance(500);
    await until(() => messages.some(m => m.type === 'state' && m.state.eyesOn));
    clock.advance(500);
    await until(() => messages.some(m => m.type === 'phase' && m.phase === 'stopped'));
    expect(replay.running).toBe(false);
    expect(latestState()?.state.eyesOn).toBe(false);
    expect(latestState()?.state.pauseReasons).toContain('panel-hidden');
    const stateCount = messages.filter(m => m.type === 'state').length;
    await wait(40);
    expect(messages.filter(m => m.type === 'state')).toHaveLength(stateCount);
  });

  it('starts fresh after a fatal error: calibration and liveness cannot carry over', async () => {
    const { clock } = await boot({ withError: true });
    await start();
    clock.advance(500);
    await until(() => messages.some(m => m.type === 'state' && m.state.eyesOn));
    clock.advance(500);
    await until(() => messages.some(m => m.type === 'phase' && m.phase === 'stopped'));
    expect(messages.some(m => m.type === 'error' && m.reason === 'credits-exhausted')).toBe(true);
    const restart = await start();
    const initial = messages.slice(restart).find(m => m.type === 'state');
    expect(initial?.type).toBe('state');
    if (initial?.type === 'state') {
      expect(initial.state.eyesOn).toBe(false);
      expect(initial.state.live).toBe(false);
      expect(initial.state.pauseReasons).toContain('calibrating');
      expect(initial.state.pauseReasons).not.toContain('credits-exhausted');
    }
    clock.advance(500);
    await until(() => messages.slice(restart).some(m => m.type === 'state' && m.state.eyesOn));
  });

  it('resets calibration, fatal state and liveness before looping timestamps rewind', async () => {
    const { clock } = await boot({ loop: true, withError: true });
    await start();
    clock.advance(500);
    await until(() => messages.some(m => m.type === 'state' && m.state.eyesOn));
    const beforeLoop = messages.length;
    clock.advance(500);
    await until(() => messages.slice(beforeLoop).some(m => m.type === 'phase' && m.phase === 'calibrating'));
    const reset = messages.slice(beforeLoop).find(m => m.type === 'state' && m.state.t === 0);
    expect(reset?.type).toBe('state');
    if (reset?.type === 'state') {
      expect(reset.state.live).toBe(false);
      expect(reset.state.eyesOn).toBe(false);
      expect(reset.state.pauseReasons).toContain('calibrating');
      expect(reset.state.pauseReasons).not.toContain('credits-exhausted');
    }
    const nextCycle = messages.length;
    clock.advance(500);
    await until(() => messages.slice(nextCycle).some(m => m.type === 'state' && m.state.eyesOn));
  });
});

describe('replay timing boundaries', () => {
  it('ends an empty looping recording without recursion', () => {
    const source = new ReplaySource({ ...recording(), samples: [] }, { loop: true });
    const events: string[] = [];
    source.onEvent(event => events.push(event.type));
    source.start();
    expect(source.running).toBe(false);
    expect(events).toEqual(['ended']);
  });

  it('resumes at the correct offset when playback speed is not one', () => {
    const clock = new Clock();
    const source = new ReplaySource({ ...recording(), samples: [
      { t: 0, kind: 'validation', code: 0 }, { t: 1000, kind: 'validation', code: 0 },
      { t: 2000, kind: 'validation', code: 0 },
    ] }, { speed: 2, now: clock.now, setTimeout: clock.schedule, clearTimeout: clock.cancel });
    const seen: number[] = [];
    source.onEvent(event => { if (event.type === 'sample') seen.push(event.sample.t); });
    source.start();
    clock.advance(250);
    source.stop();
    clock.advance(1000);
    source.start();
    clock.advance(249);
    expect(seen).toEqual([0]);
    clock.advance(1);
    expect(seen).toEqual([0, 1000]);
    source.stop();
  });
});
