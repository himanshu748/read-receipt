import { createServer, type Server as HttpServer, type IncomingMessage } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import {
  PROTOCOL_VERSION,
  isClientToHelper,
  type ClientToHelper,
  type HelperToClient,
  type RecordedSample,
  type SourceKind,
} from '@rr/protocol';
import { HelperSession } from './session.js';
import type { ReplaySource } from './sources/replay.js';
import type { LiveSource } from './sources/live.js';
import type { Recorder } from './recorder.js';
import type { EyesOnConfig } from './eyesOn.js';

export const HELPER_VERSION = '0.1.0';

export interface HelperServerOptions {
  host?: string;
  port: number;
  token: string;
  source: SourceKind;
  sdkVersion?: string | null;
  replay?: ReplaySource;
  live?: LiveSource;
  recorder?: Recorder;
  cfg?: EyesOnConfig;
  /** State emit rate in Hz (default 10). */
  stateHz?: number;
}

export interface HelperServer {
  readonly port: number;
  readonly host: string;
  close(): Promise<void>;
}

function send(ws: WebSocket, msg: HelperToClient): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function tokenFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url, 'http://127.0.0.1');
    return u.searchParams.get('token');
  } catch {
    return null;
  }
}

/**
 * Localhost-only WebSocket helper server.
 * Rejects wrong tokens and any request that carries an Origin header.
 */
export async function startHelperServer(
  opts: HelperServerOptions,
): Promise<HelperServer> {
  const host = opts.host ?? '127.0.0.1';
  if (host !== '127.0.0.1' && host !== '::1') throw new Error('Helper must bind a loopback IP address.');
  if (opts.source === 'live' && (!opts.live || opts.replay || opts.recorder)) {
    throw new Error('Live mode requires a live source and does not support recording.');
  }
  const stateHz = opts.stateHz ?? 10;
  const newSession = () => new HelperSession({
    source: opts.source,
    ...(opts.cfg ? { cfg: opts.cfg } : {}),
  });
  let session = newSession();

  const httpServer: HttpServer = createServer((_req, res) => {
    res.writeHead(404);
    res.end();
  });

  const wss = new WebSocketServer({ noServer: true });

  const clients = new Set<WebSocket>();
  let stateTimer: ReturnType<typeof setInterval> | null = null;
  let pressureBatch: number[] = [];
  let pressureBatchT = 0;
  let unsubReplay: (() => void) | null = null;
  let unsubLive: (() => void) | null = null;
  let liveStarted = false;

  const broadcast = (msg: HelperToClient): void => {
    for (const ws of clients) send(ws, msg);
  };

  const emitPhase = (): void => {
    const p = session.phasePayload();
    const msg: HelperToClient = {
      type: 'phase',
      phase: p.phase,
      ...(p.calibrationProgress !== undefined
        ? { calibrationProgress: p.calibrationProgress }
        : {}),
      ...(p.message !== undefined ? { message: p.message } : {}),
    };
    broadcast(msg);
  };

  const flushPressure = (): void => {
    if (pressureBatch.length === 0) return;
    broadcast({
      type: 'pulseTrace',
      t: pressureBatchT,
      values: pressureBatch.slice(),
    });
    pressureBatch = [];
  };

  const onSample = (sample: RecordedSample): void => {
    session.applySample(sample);
    opts.recorder?.append(sample);

    if (sample.kind === 'pressure') {
      if (pressureBatch.length === 0) pressureBatchT = sample.t;
      pressureBatch.push(sample.value);
      if (pressureBatch.length >= 8) flushPressure();
    }

    if (sample.kind === 'error') {
      const eyes = session.getEyes();
      broadcast({
        type: 'error',
        reason: eyes.fatalReason ?? 'sdk-error',
        message: sample.message,
        retryable: sample.retryable,
      });
      emitPhase();
    }

    if (sample.kind === 'features' || sample.kind === 'validation') {
      // Phase may transition calibrating → running.
      emitPhase();
    }
  };

  const startStateLoop = (): void => {
    if (stateTimer) return;
    const interval = Math.max(10, Math.round(1000 / stateHz));
    stateTimer = setInterval(() => {
      if (session.getPhase() === 'idle' || session.getPhase() === 'stopped') {
        return;
      }
      flushPressure();
      broadcast({ type: 'state', state: session.viewerState() });
    }, interval);
  };

  const stopStateLoop = (): void => {
    if (stateTimer) {
      clearInterval(stateTimer);
      stateTimer = null;
    }
  };

  const beginSession = (): void => {
    stopStateLoop();
    pressureBatch = [];
    session = newSession();
    session.start(0);
    emitPhase();
    // Clear the previous run immediately, before the first replay sample arrives.
    broadcast({ type: 'state', state: session.viewerState() });
    startStateLoop();
  };

  const stopSession = (): void => {
    stopStateLoop();
    flushPressure();
    session.stop();
    // EOF is a stop boundary, never a fresh heartbeat for the final positive sample.
    broadcast({ type: 'state', state: session.viewerState() });
    emitPhase();
    void opts.recorder?.flush().catch(() => {
      broadcast({ type: 'error', reason: 'sdk-error', message: 'Could not save the recording.', retryable: false });
    });
  };

  const handleClientMessage = (msg: ClientToHelper): void => {
    switch (msg.type) {
      case 'start': {
        if (opts.live) {
          if (liveStarted) return;
          liveStarted = true;
          beginSession();
          unsubLive = opts.live.onEvent((ev) => {
            if (ev.type === 'sample') onSample(ev.sample);
            if (ev.type === 'preview') {
              for (const ws of clients) if (ws.readyState === WebSocket.OPEN && ws.bufferedAmount < 256 * 1024) ws.send(ev.jpeg);
            }
            if (ev.type === 'ended') stopSession();
          });
          void opts.live.start().catch(() => {
            onSample({ kind: 'error', t: 0, code: 8, message: 'Reconnect before starting another live session.', retryable: false });
          });
          break;
        }
        unsubReplay?.();
        unsubReplay = null;
        opts.replay?.reset();
        beginSession();
        if (opts.replay) {
          unsubReplay = opts.replay.onEvent((ev) => {
            if (ev.type === 'sample') onSample(ev.sample);
            if (ev.type === 'looped') beginSession();
            if (ev.type === 'ended') stopSession();
          });
          opts.replay.start();
        }
        break;
      }
      case 'stop': {
        opts.replay?.stop();
        stopSession();
        void opts.live?.stop().catch(() => { /* already invalidated; owner reaps native process */ });
        break;
      }
      case 'recalibrate': {
        session.recalibrate();
        emitPhase();
        break;
      }
      case 'preview': {
        opts.live?.setPreview(msg.enabled, msg.maxFps);
        break;
      }
      default: {
        const _e: never = msg;
        void _e;
      }
    }
  };

  httpServer.on('upgrade', (req: IncomingMessage, socket, head) => {
    const origin = req.headers.origin;
    if (origin !== undefined) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    const token = tokenFromUrl(req.url);
    if (token !== opts.token) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws) => {
    clients.add(ws);
    send(ws, {
      type: 'hello',
      protocol: PROTOCOL_VERSION,
      helperVersion: HELPER_VERSION,
      sdkVersion: opts.sdkVersion ?? null,
      source: opts.source,
    });
    emitPhase();

    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(data));
      } catch {
        return;
      }
      if (!isClientToHelper(parsed)) return;
      handleClientMessage(parsed);
    });

    ws.on('close', () => {
      clients.delete(ws);
      if (opts.live && clients.size === 0) {
        stopSession();
        void opts.live.stop().catch(() => { /* owner reaps native process */ });
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(opts.port, host, () => resolve());
  });

  const addr = httpServer.address();
  if (!addr || typeof addr === 'string') {
    throw new Error('Failed to bind helper server');
  }

  return {
    port: addr.port,
    host,
    async close() {
      opts.replay?.stop();
      unsubReplay?.();
      unsubLive?.();
      stopStateLoop();
      await opts.live?.stop();
      await opts.recorder?.flush();
      for (const ws of clients) ws.close();
      clients.clear();
      await new Promise<void>((resolve, reject) => {
        wss.close((err) => (err ? reject(err) : resolve()));
      });
      await new Promise<void>((resolve, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}
