import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import type { ClientToHelper, HelperToClient, ViewerState } from '@rr/protocol';
import { startHelperServer, type HelperServer } from '../../helper/src/server.js';
import { ReplaySource } from '../../helper/src/sources/replay.js';
import { HelperClient } from './helperClient.js';
import { Signal } from './events.js';

const TOKEN = 'aabbccddeeff00112233445566778899';
const HELPER = resolve('packages/helper/dist/main.js');
const FIXTURE = resolve('fixtures/replay/demo-session.json');
const clients: HelperClient[] = [];
const servers: Array<{ close(): Promise<void> }> = [];
const tempDirs: string[] = [];

async function waitFor(predicate: () => boolean, timeout = 3000): Promise<void> {
  const until = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() >= until) throw new Error('Timed out waiting for helper state.');
    await new Promise((done) => setTimeout(done, 10));
  }
}

function track(client: HelperClient): HelperClient {
  clients.push(client);
  return client;
}

function state(): ViewerState {
  return { seq: 1, t: 20000, source: 'replay', live: true, eyesOpen: true,
    facingScreen: true, pulseBpm: 72, quality: 'good', eyesOn: true, pauseReasons: [] };
}

async function fakeServer(
  onControl: (socket: WebSocket, message: ClientToHelper) => void = () => {},
  hello: unknown = { type: 'hello', protocol: 1, helperVersion: 'test', sdkVersion: null, source: 'replay' },
): Promise<{ port: number; socket(): WebSocket | undefined }> {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise<void>((done, reject) => { server.once('listening', done); server.once('error', reject); });
  let connection: WebSocket | undefined;
  server.on('connection', (socket) => {
    connection = socket;
    socket.send(JSON.stringify(hello));
    socket.on('message', (raw) => onControl(socket, JSON.parse(String(raw)) as ClientToHelper));
  });
  servers.push({ close: async () => {
    for (const socket of server.clients) socket.terminate();
    await new Promise<void>((done) => server.close(() => done()));
  } });
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('Fake helper did not bind a port.');
  return { port: addr.port, socket: () => connection };
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.shutdown()));
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('HelperClient', () => {
  it('runs the compiled replay helper and receives real eyes-on/pause messages', async () => {
    const client = track(new HelperClient({ nodePath: process.execPath, helperPath: HELPER,
      mode: 'replay', replayFile: FIXTURE, speed: 20 }));
    const phases = new Set<string>();
    const pauses = new Set<string>();
    let sawEyesOn = false;
    client.onPhase((message) => phases.add(message.phase));
    client.onState((message) => {
      sawEyesOn ||= message.eyesOn;
      for (const reason of message.pauseReasons) pauses.add(reason);
    });
    await client.connect();
    expect(client.connected).toBe(true);
    client.send({ type: 'start' });
    await waitFor(() => sawEyesOn);
    expect(client.state?.source).toBe('replay');
    await waitFor(() => pauses.has('looking-down'));
    expect(phases.has('calibrating')).toBe(true);
    expect(phases.has('running')).toBe(true);
    client.send({ type: 'stop' });
    expect(client.state).toBeNull();
    await waitFor(() => client.phase === 'stopped');
    await client.shutdown();
    expect(client.connected).toBe(false);
  });

  it('fails closed when state gets stale and immediately on stop, even with a queued state', async () => {
    let now = 1000;
    const remote = await fakeServer((socket, control) => {
      if (control.type === 'start') socket.send(JSON.stringify({ type: 'state', state: state() }));
    });
    const client = track(new HelperClient({ mode: 'replay', now: () => now,
      attach: { port: remote.port, token: TOKEN } }));
    await client.connect();
    client.send({ type: 'start' });
    await waitFor(() => client.state !== null);
    now = 1750;
    expect(client.state?.eyesOn).toBe(true);
    now = 1751;
    expect(client.state).toBeNull();
    now = 1001;
    client.send({ type: 'stop' });
    expect(client.state).toBeNull();
    remote.socket()!.send(JSON.stringify({ type: 'state', state: state() }));
    await new Promise((done) => setTimeout(done, 20));
    expect(client.state).toBeNull();
  });

  it.each(['stopped', 'error'] as const)('invalidates cached state when helper phase becomes %s', async (phase) => {
    const remote = await fakeServer((socket, control) => {
      if (control.type === 'start') socket.send(JSON.stringify({ type: 'state', state: state() }));
    });
    const client = track(new HelperClient({ mode: 'replay', attach: { port: remote.port, token: TOKEN } }));
    await client.connect(); client.send({ type: 'start' });
    await waitFor(() => client.state !== null);
    remote.socket()!.send(JSON.stringify({ type: 'phase', phase }));
    await waitFor(() => client.phase === phase);
    expect(client.state).toBeNull();
  });

  it('invalidates state and reports transport closure', async () => {
    const remote = await fakeServer((socket, control) => {
      if (control.type === 'start') socket.send(JSON.stringify({ type: 'state', state: state() }));
    });
    const client = track(new HelperClient({ mode: 'replay', attach: { port: remote.port, token: TOKEN } }));
    const errors: string[] = [];
    client.onError((error) => errors.push(error.reason));
    await client.connect(); client.send({ type: 'start' });
    await waitFor(() => client.state !== null);
    remote.socket()!.terminate();
    await waitFor(() => errors.length > 0);
    expect(client.state).toBeNull();
    expect(client.phase).toBe('error');
    expect(errors).toContain('network');
  });

  it('rejects unsupported protocol versions and a source mismatch', async () => {
    for (const hello of [
      { type: 'hello', protocol: 99, helperVersion: 'test', sdkVersion: null, source: 'replay' },
      { type: 'hello', protocol: 1, helperVersion: 'test', sdkVersion: null, source: 'live' },
    ]) {
      const remote = await fakeServer(undefined, hello);
      const client = track(new HelperClient({ mode: 'replay', attach: { port: remote.port, token: TOKEN } }));
      await expect(client.connect()).rejects.toThrow(/protocol|source/i);
      expect(client.state).toBeNull();
    }
  });

  it('rejects a state whose source differs from the validated hello', async () => {
    const remote = await fakeServer((socket, control) => {
      if (control.type === 'start') socket.send(JSON.stringify({ type: 'state', state: { ...state(), source: 'live' } }));
    });
    const client = track(new HelperClient({ mode: 'replay', attach: { port: remote.port, token: TOKEN } }));
    await client.connect(); client.send({ type: 'start' });
    await waitFor(() => client.phase === 'error');
    expect(client.state).toBeNull();
  });

  it('attaches to a real helper and leaves its server alive after shutdown', async () => {
    const replay = await ReplaySource.fromFile(FIXTURE, { speed: 100 });
    const server: HelperServer = await startHelperServer({ port: 0, token: TOKEN, source: 'replay', replay });
    servers.push(server);
    const client = track(new HelperClient({ mode: 'replay', attach: { port: server.port, token: TOKEN } }));
    await client.connect(); client.send({ type: 'start' });
    await waitFor(() => client.state !== null);
    await client.shutdown();
    const next = track(new HelperClient({ mode: 'replay', attach: { port: server.port, token: TOKEN } }));
    await next.connect();
    expect(next.connected).toBe(true);
  });

  it('reports rejected attachment without leaking its token', async () => {
    const server = await startHelperServer({ port: 0, token: TOKEN, source: 'replay' });
    servers.push(server);
    const wrongToken = '11'.repeat(32);
    const client = track(new HelperClient({ mode: 'replay', attach: { port: server.port, token: wrongToken } }));
    const errors: string[] = [];
    client.onError((error) => errors.push(error.message));
    await expect(client.connect()).rejects.toThrow(/rejected/);
    expect(errors.join(' ')).not.toContain(wrongToken);
    expect(client.state).toBeNull();
  });

  it('rejects unsafe attachment settings before connecting', () => {
    expect(() => new HelperClient({ mode: 'replay', attach: { host: 'example.com', port: 1234, token: TOKEN } })).toThrow(/loopback/);
    expect(() => new HelperClient({ mode: 'replay', attach: { port: 0, token: TOKEN } })).toThrow(/port/);
    expect(() => new HelperClient({ mode: 'replay', attach: { port: 1234, token: 'abcd' } })).toThrow(/token/);
  });

  it('reports a missing system Node executable without hanging', async () => {
    const client = track(new HelperClient({ mode: 'replay', helperPath: HELPER, replayFile: FIXTURE,
      nodePath: resolve('missing-read-receipt-node'), startupTimeoutMs: 1000 }));
    await expect(client.connect()).rejects.toThrow(/launch/);
    expect(client.phase).toBe('error');
  });

  it('passes the API key only by environment and redacts child errors', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rr-helper-client-')); tempDirs.push(dir);
    const report = join(dir, 'argv.json');
    const helper = join(dir, 'fake-helper.cjs');
    const key = 'fixture-client-api-key';
    await writeFile(helper, `const fs=require('node:fs'); fs.writeFileSync(${JSON.stringify(report)},JSON.stringify({argv:process.argv,key:process.env.SMARTSPECTRA_API_KEY})); process.stderr.write(process.env.SMARTSPECTRA_API_KEY+' '+process.argv[process.argv.indexOf('--token')+1]); process.exit(1);`);
    const client = track(new HelperClient({ nodePath: process.execPath, helperPath: helper, mode: 'live', apiKey: key }));
    const errors: string[] = []; client.onError((error) => errors.push(error.message));
    await expect(client.connect()).rejects.toThrow(/exited/);
    const recorded = JSON.parse(await readFile(report, 'utf8')) as { argv: string[]; key: string };
    expect(recorded.key).toBe(key);
    expect(recorded.argv).not.toContain(key);
    const token = recorded.argv[recorded.argv.indexOf('--token') + 1]!;
    expect(errors.join(' ')).not.toContain(key);
    expect(errors.join(' ')).not.toContain(token);
  });

  it('emits preview and pulse data only after the protocol hello', async () => {
    const remote = await fakeServer((socket, control) => {
      if (control.type !== 'start') return;
      socket.send(Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
      const pulse: HelperToClient = { type: 'pulseTrace', t: 20, values: [0, 1, 0] };
      socket.send(JSON.stringify(pulse));
    });
    const client = track(new HelperClient({ mode: 'replay', attach: { port: remote.port, token: TOKEN } }));
    let preview: Uint8Array | undefined; let pulse: number[] | undefined;
    client.onPreviewFrame((data) => { preview = data; });
    client.onPulseTrace((message) => { pulse = message.values; });
    await client.connect(); client.send({ type: 'start' });
    await waitFor(() => preview !== undefined && pulse !== undefined);
    expect([...preview!]).toEqual([0xff, 0xd8, 0xff, 0xd9]);
    expect(pulse).toEqual([0, 1, 0]);
  });
});

describe('Signal', () => {
  it('supports unsubscribe and disposing subscriptions', () => {
    const signal = new Signal<number>(); const values: number[] = [];
    const subscription = signal.event((value) => values.push(value));
    signal.fire(1); subscription.dispose(); signal.fire(2);
    signal.event((value) => values.push(value)); signal.dispose(); signal.fire(3);
    expect(values).toEqual([1]);
  });
});
