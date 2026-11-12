import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import type { HelperToClient } from '@rr/protocol';
import { startHelperServer, type HelperServer } from './server.js';
import type { LiveEvent, LiveSource } from './sources/live.js';

describe('live helper transport lifecycle (injected source, no camera)', () => {
  let server: HelperServer | undefined;
  const sockets: WebSocket[] = [];
  afterEach(async () => { for (const ws of sockets) ws.terminate(); sockets.length = 0; await server?.close(); server = undefined; });
  it('starts only on control, sends preview in memory, invalidates immediately and stops on disconnect', async () => {
    let listener: ((event: LiveEvent) => void) | undefined;
    const source = {
      onEvent: vi.fn((fn: (event: LiveEvent) => void) => { listener = fn; return () => { listener = undefined; }; }),
      start: vi.fn(async () => {}), stop: vi.fn(async () => {}), setPreview: vi.fn(),
    };
    server = await startHelperServer({ port: 0, token: 'fixture', source: 'live', sdkVersion: '3.5.0', live: source as unknown as LiveSource });
    expect(source.start).not.toHaveBeenCalled();
    const messages: HelperToClient[] = [], frames: Buffer[] = [];
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}?token=fixture`); sockets.push(ws);
    ws.on('message', (data, binary) => { if (binary) frames.push(Buffer.from(data as Buffer)); else messages.push(JSON.parse(String(data)) as HelperToClient); });
    const until = async (condition: () => boolean) => {
      const deadline = Date.now() + 2000;
      while (!condition()) { if (Date.now() > deadline) throw new Error('transport timeout'); await new Promise(done => setTimeout(done, 10)); }
    };
    await until(() => messages.some(msg => msg.type === 'hello'));
    expect(source.start).not.toHaveBeenCalled();
    ws.send(JSON.stringify({ type: 'start' })); await until(() => source.start.mock.calls.length === 1);
    ws.send(JSON.stringify({ type: 'start' })); ws.send(JSON.stringify({ type: 'preview', enabled: true, maxFps: 8 }));
    await until(() => source.setPreview.mock.calls.length > 0);
    expect(source.start).toHaveBeenCalledTimes(1); expect(source.setPreview).toHaveBeenCalledWith(true, 8);
    listener?.({ type: 'preview', jpeg: new Uint8Array([255, 216, 255, 217]) });
    await until(() => frames.length === 1); expect(frames[0]).toEqual(Buffer.from([255, 216, 255, 217]));
    ws.send(JSON.stringify({ type: 'stop' })); await until(() => source.stop.mock.calls.length > 0);
    await until(() => messages.some(msg => msg.type === 'phase' && msg.phase === 'stopped'));
    const state = messages.filter(msg => msg.type === 'state').at(-1);
    expect(state?.type === 'state' && state.state.eyesOn).toBe(false);
    ws.close(); await until(() => source.stop.mock.calls.length >= 2);
  });
  it('refuses recording or a non-loopback listener in live mode', async () => {
    await expect(startHelperServer({ port: 0, token: 'fixture', source: 'live' })).rejects.toThrow('live source');
    await expect(startHelperServer({ host: '0.0.0.0', port: 0, token: 'fixture', source: 'replay' })).rejects.toThrow('loopback');
  });
});
