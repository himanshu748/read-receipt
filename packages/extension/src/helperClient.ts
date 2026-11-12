import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { WebSocket, type RawData } from 'ws';
import {
  isClientToHelper,
  isHelperToClient,
  type ClientToHelper,
  type HelperPhase,
  type HelperToClient,
  type PauseReason,
  type SourceKind,
  type ViewerState,
} from '@rr/protocol';
import type { HelperConnection } from './contracts.js';
import { Signal } from './events.js';

export interface HelperClientOptions {
  /** System Node.js executable, never Electron-as-node. */
  nodePath?: string;
  /** Built helper CLI. Required when this client owns its helper process. */
  helperPath?: string;
  mode: SourceKind;
  replayFile?: string;
  loop?: boolean;
  /** Development/replay speed; elapsed receipt time remains wall-clock time. */
  speed?: number;
  /** Passed to the child environment only. Never included in argv or errors. */
  apiKey?: string;
  /** Explicit disclosure accepted for this live helper connection. */
  liveConsent?: boolean;
  /** Native camera index; omitted uses the SDK default. */
  camera?: number;
  attach?: { host?: string; port: number; token: string };
  startupTimeoutMs?: number;
  /** Monotonic clock, injectable for freshness tests. */
  now?: () => number;
}

type PhaseEvent = Extract<HelperToClient, { type: 'phase' }>;
type ErrorEvent = Omit<Extract<HelperToClient, { type: 'error' }>, 'type'>;

const STALE_MS = 750;
const MAX_STDOUT = 64 * 1024;
const MAX_STDERR = 2048;

/** One authenticated, local helper connection; it never imports VS Code. */
export class HelperClient implements HelperConnection {
  private readonly stateSignal = new Signal<ViewerState>();
  private readonly phaseSignal = new Signal<PhaseEvent>();
  private readonly previewSignal = new Signal<Uint8Array>();
  private readonly pulseSignal = new Signal<{ t: number; values: number[] }>();
  private readonly errorSignal = new Signal<ErrorEvent>();
  readonly onState = this.stateSignal.event;
  readonly onPhase = this.phaseSignal.event;
  readonly onPreviewFrame = this.previewSignal.event;
  readonly onPulseTrace = this.pulseSignal.event;
  readonly onError = this.errorSignal.event;

  private readonly now: () => number;
  private readonly timeoutMs: number;
  private child: ChildProcessWithoutNullStreams | undefined;
  private socket: WebSocket | undefined;
  private latestState: ViewerState | null = null;
  private stateReceivedAt = 0;
  private currentPhase: HelperPhase = 'idle';
  private ready = false;
  private sessionRequested = false;
  private disposed = false;
  private failure: Error | undefined;
  private token = '';
  private pending: ClientToHelper[] = [];
  private connection: Promise<void> | undefined;
  private resolveConnection: (() => void) | undefined;
  private rejectConnection: ((error: Error) => void) | undefined;
  private startupTimer: ReturnType<typeof setTimeout> | undefined;
  private staleTimer: ReturnType<typeof setTimeout> | undefined;
  private liveDeadlineTimer: ReturnType<typeof setTimeout> | undefined;
  private liveStopTimer: ReturnType<typeof setTimeout> | undefined;
  private liveStarted = false;
  private shutdownPromise: Promise<void> | undefined;

  constructor(private readonly options: HelperClientOptions) {
    this.now = options.now ?? (() => performance.now());
    this.timeoutMs = options.startupTimeoutMs ?? 8000;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new Error('Helper startup timeout must be positive.');
    }
    if (options.mode !== 'live' && options.mode !== 'replay') {
      throw new Error('Unsupported helper mode.');
    }
    if (options.mode === 'live' && options.attach) {
      throw new Error('Live attachment is unsupported: use an owned helper so camera lifetime and telemetry settings can be enforced.');
    }
    if (options.mode === 'live' && options.liveConsent !== true) {
      throw new Error('Live camera use requires explicit consent to camera capture and provider transmission.');
    }
    if (options.camera !== undefined && (!Number.isInteger(options.camera) || options.camera < 0)) {
      throw new Error('Camera index must be a non-negative integer.');
    }
    if (options.speed !== undefined && (!Number.isFinite(options.speed) || options.speed <= 0)) {
      throw new Error('Replay speed must be positive.');
    }
    if (options.attach) {
      const { host = '127.0.0.1', port, token } = options.attach;
      if (host !== '127.0.0.1' && host !== '::1') {
        throw new Error('Helper attachment is restricted to a loopback IP address.');
      }
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error('Helper attachment requires a valid port.');
      }
      if (!/^[a-fA-F0-9]{32,}$/.test(token)) {
        throw new Error('Helper attachment requires a hex token of at least 16 bytes.');
      }
    } else {
      if (!options.helperPath) throw new Error('A built helper executable path is required.');
      if (options.mode === 'replay' && !options.replayFile) {
        throw new Error('A replay recording file is required.');
      }
      if (options.mode === 'live' && !options.apiKey?.trim()) {
        throw new Error('Set the Presage API key before starting live camera mode.');
      }
      if (options.nodePath !== undefined && !options.nodePath.trim()) {
        throw new Error('A system Node.js executable is required.');
      }
    }
  }

  get state(): ViewerState | null {
    if (!this.connected || !this.latestState || this.now() - this.stateReceivedAt > STALE_MS) return null;
    return this.latestState;
  }

  get phase(): HelperPhase {
    return this.currentPhase;
  }

  get connected(): boolean {
    return !this.disposed && this.ready && this.socket?.readyState === WebSocket.OPEN;
  }

  /** Resolves only after an authenticated connection and a valid protocol hello. */
  connect(): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('Helper client is disposed.'));
    if (this.failure) return Promise.reject(this.failure);
    if (this.connection) return this.connection;
    this.setPhase('starting');
    this.connection = new Promise<void>((resolvePromise, rejectPromise) => {
      this.resolveConnection = resolvePromise;
      this.rejectConnection = rejectPromise;
    });
    this.startupTimer = setTimeout(() => this.fail('network', 'Helper startup timed out.'), this.timeoutMs);
    if (this.options.attach) {
      this.token = this.options.attach.token;
      this.openSocket(this.options.attach.port, this.options.attach.host ?? '127.0.0.1');
    } else {
      this.spawnHelper();
    }
    return this.connection;
  }

  send(message: ClientToHelper): void {
    if (!isClientToHelper(message) || (message.type === 'preview' &&
      (!Number.isFinite(message.maxFps) || message.maxFps < 0 || message.maxFps > 30))) {
      throw new Error('Invalid helper control message.');
    }
    if (this.options.mode === 'live' && this.connected && message.type === 'start' && this.liveStarted) {
      this.fail('sdk-error', 'A live helper can start only once. Reconnect for a new consented session.');
      return;
    }
    if (this.options.mode === 'live' && message.type === 'recalibrate' && !this.sessionRequested) return;
    if (message.type === 'start' || message.type === 'recalibrate') this.sessionRequested = true;
    if (message.type === 'stop') this.sessionRequested = false;
    if (message.type === 'stop' || message.type === 'recalibrate') this.invalidateState();
    if (this.disposed || this.failure) return;
    if (!this.connected) {
      if (this.connection) {
        if (this.pending.length >= 32) {
          this.fail('sdk-error', 'Too many helper controls queued during startup.');
        } else {
          this.pending.push(message);
        }
      }
      return;
    }
    if (this.options.mode === 'live' && message.type === 'start') {
      this.liveStarted = true;
      // Independent of the native process: a blocked SDK cannot extend capture.
      this.liveDeadlineTimer = setTimeout(() => this.finishLive(
        'The 90-second live camera limit was reached. Reconnect for a new consented session.'), 90_000);
      this.liveDeadlineTimer.unref();
    }
    if (this.options.mode === 'live' && message.type === 'stop' && this.liveStarted && !this.liveStopTimer) {
      // Never let native draining hold the camera after an explicit Stop.
      this.liveStopTimer = setTimeout(() => this.finishLive(
        'Live camera stopped; the helper was terminated because Stop did not finish within three seconds.'), 3000);
      this.liveStopTimer.unref();
    }
    this.socket!.send(JSON.stringify(message), (error) => {
      if (error) this.fail('network', 'Could not send a helper control message.');
    });
  }

  dispose(): void {
    void this.shutdown();
  }

  /** Stops this session and reaps owned children; attached servers are never killed. */
  shutdown(): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;
    if (this.connected) this.send({ type: 'stop' });
    this.disposed = true;
    this.ready = false;
    this.invalidateState();
    this.clearStartupTimer();
    this.clearLiveTimers();
    this.rejectConnection?.(new Error('Helper client was closed during startup.'));
    this.rejectConnection = undefined;
    this.resolveConnection = undefined;
    this.pending = [];
    this.setPhase('stopped');
    const socket = this.socket;
    const child = this.child;
    this.shutdownPromise = Promise.all([
      new Promise<void>((done) => {
        if (!socket || socket.readyState === WebSocket.CLOSED) return done();
        const timer = setTimeout(() => { socket.terminate(); done(); }, 500);
        socket.once('close', () => { clearTimeout(timer); done(); });
        if (socket.readyState === WebSocket.CONNECTING) socket.terminate();
        else socket.close();
      }),
      new Promise<void>((done) => {
        if (!child || child.exitCode !== null || child.signalCode !== null || !child.pid) return done();
        const timer = setTimeout(() => { child.kill('SIGKILL'); done(); }, 1000);
        child.once('exit', () => { clearTimeout(timer); done(); });
        child.kill('SIGTERM');
      }),
    ]).then(() => {
      this.stateSignal.dispose();
      this.phaseSignal.dispose();
      this.previewSignal.dispose();
      this.pulseSignal.dispose();
      this.errorSignal.dispose();
    });
    return this.shutdownPromise;
  }

  private spawnHelper(): void {
    this.token = randomBytes(32).toString('hex');
    const args = [resolve(this.options.helperPath!), '--mode', this.options.mode, '--port', '0', '--token', this.token,
      '--parent-pid', String(process.pid)];
    if (this.options.mode === 'replay') {
      if (this.options.replayFile) args.push('--replay', resolve(this.options.replayFile));
      if (this.options.loop) args.push('--loop');
      if (this.options.speed !== undefined) args.push('--speed', String(this.options.speed));
    }
    if (this.options.mode === 'live' && this.options.liveConsent) {
      args.push('--live-consent', '--max-live-seconds', '90');
      if (this.options.camera !== undefined) args.push('--camera', String(this.options.camera));
    }
    const env = { ...process.env };
    // Never propagate Electron's node switch to the independent system runtime.
    delete env.ELECTRON_RUN_AS_NODE;
    if (this.options.apiKey) env.SMARTSPECTRA_API_KEY = this.options.apiKey;
    // Replay needs no SDK credential, even if one exists in the editor environment.
    if (this.options.mode === 'replay') delete env.SMARTSPECTRA_API_KEY;
    const child = spawn(this.options.nodePath ?? 'node', args, { env, stdio: 'pipe', windowsHide: true });
    this.child = child;
    child.stdin.end();
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      if (this.socket || this.disposed || this.failure) return;
      stdout += chunk.toString('utf8');
      if (stdout.length > MAX_STDOUT) return this.fail('sdk-error', 'Helper startup output exceeded its limit.');
      const newline = stdout.indexOf('\n');
      if (newline === -1) return;
      let message: unknown;
      try { message = JSON.parse(stdout.slice(0, newline)); }
      catch { return this.fail('sdk-error', 'Helper sent an invalid startup response.'); }
      if (typeof message !== 'object' || message === null ||
        !('type' in message) || message.type !== 'listening' ||
        !('port' in message) || typeof message.port !== 'number' ||
        !Number.isInteger(message.port) || message.port < 1 || message.port > 65535) {
        return this.fail('sdk-error', 'Helper sent an invalid listening port.');
      }
      this.openSocket(message.port, '127.0.0.1');
    });
    child.stderr.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString('utf8')).slice(-MAX_STDERR); });
    child.on('error', () => this.fail('sdk-error', 'Could not launch the helper with the configured system Node.js.'));
    child.on('exit', (code, signal) => {
      this.clearLiveTimers();
      if (this.disposed || this.failure) return;
      if (this.options.mode === 'live' &&
        ((!this.sessionRequested && this.liveStarted) || this.currentPhase === 'error')) {
        // The source exits after Stop or a previously reported SDK error. Preserve
        // that reason instead of replacing it with an unrelated transport error.
        this.failure = new Error('The live helper session has ended. Reconnect to start again.');
        this.ready = false;
        this.invalidateState();
        if (this.currentPhase !== 'error') this.setPhase('stopped');
        this.socket?.terminate();
        return;
      }
      const detail = stderr.trim() ? ` ${this.redact(stderr.trim())}` : '';
      this.fail('sdk-error', `Helper exited unexpectedly (${signal ?? code ?? 'unknown'}).${detail}`);
    });
  }

  private openSocket(port: number, host: string): void {
    const address = host === '::1' ? '[::1]' : host;
    const socket = new WebSocket(`ws://${address}:${port}/?token=${this.token}`, {
      handshakeTimeout: this.timeoutMs,
      maxPayload: 4 * 1024 * 1024,
      perMessageDeflate: false,
    });
    this.socket = socket;
    socket.on('message', (data, binary) => this.receive(data, binary));
    socket.on('unexpected-response', (_request, response) => {
      response.resume();
      this.fail(response.statusCode === 401 || response.statusCode === 403 ? 'auth-failed' : 'network',
        `Helper connection was rejected (HTTP ${response.statusCode ?? 'unknown'}).`);
    });
    socket.on('error', () => this.fail('network', 'The local helper connection failed.'));
    socket.on('close', () => {
      if (this.options.mode === 'live' && this.liveStarted && !this.sessionRequested && !this.disposed && !this.failure) {
        this.ready = false;
        this.invalidateState();
        this.setPhase('stopped');
        return;
      }
      if (!this.disposed && !this.failure) this.fail('network', 'The helper disconnected; receipts are paused.');
    });
  }

  private receive(data: RawData, binary: boolean): void {
    if (this.disposed || this.failure) return;
    if (binary) {
      if (!this.ready) return this.fail('sdk-error', 'Helper sent a preview before its protocol hello.');
      if (!this.sessionRequested) return;
      const bytes = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer);
      this.previewSignal.fire(new Uint8Array(bytes));
      return;
    }
    let message: unknown;
    try { message = JSON.parse(String(data)); }
    catch { return this.fail('sdk-error', 'Helper sent invalid JSON.'); }
    if (!isHelperToClient(message)) return this.fail('sdk-error', 'Helper protocol message or version is incompatible.');
    if (!this.ready) {
      if (message.type !== 'hello' || message.source !== this.options.mode) {
        return this.fail('sdk-error', 'Helper protocol hello or source does not match the configured mode.');
      }
      this.ready = true;
      this.clearStartupTimer();
      this.resolveConnection?.();
      this.resolveConnection = undefined;
      this.rejectConnection = undefined;
      const queued = this.pending;
      this.pending = [];
      for (const control of queued) this.send(control);
      return;
    }
    switch (message.type) {
      case 'hello':
        this.fail('sdk-error', 'Helper sent a duplicate protocol hello.');
        break;
      case 'state':
        if (message.state.source !== this.options.mode) {
          this.fail('sdk-error', 'Helper viewer state source does not match the configured mode.');
          break;
        }
        // An already queued frame must not resume counting after a local stop.
        if (!this.sessionRequested) break;
        this.latestState = message.state;
        this.stateReceivedAt = this.now();
        if (this.staleTimer) clearTimeout(this.staleTimer);
        this.staleTimer = setTimeout(() => {
          const stale = this.latestState;
          this.latestState = null;
          if (stale && !this.disposed) this.stateSignal.fire({ ...stale, eyesOn: false, live: false, pauseReasons: ['network'] });
        }, STALE_MS + 1);
        this.staleTimer.unref();
        this.stateSignal.fire(message.state);
        break;
      case 'phase':
        this.setPhase(message.phase, message.message === undefined ? message : {
          ...message, message: this.redact(message.message),
        });
        break;
      case 'pulseTrace':
        if (this.sessionRequested) this.pulseSignal.fire({ t: message.t, values: message.values });
        break;
      case 'error':
        if (this.options.mode === 'live') {
          this.fail(message.reason, message.message, message.retryable);
          break;
        }
        this.invalidateState();
        this.setPhase('error');
        this.errorSignal.fire({ reason: message.reason, message: this.redact(message.message), retryable: message.retryable });
        break;
    }
  }

  private setPhase(phase: HelperPhase, payload?: PhaseEvent): void {
    this.currentPhase = phase;
    if (phase !== 'running') this.invalidateState();
    this.phaseSignal.fire(payload ?? { type: 'phase', phase });
  }

  private invalidateState(): void {
    if (this.staleTimer) clearTimeout(this.staleTimer);
    this.staleTimer = undefined;
    this.latestState = null;
  }

  private clearStartupTimer(): void {
    if (this.startupTimer) clearTimeout(this.startupTimer);
    this.startupTimer = undefined;
  }

  private clearLiveTimers(): void {
    if (this.liveDeadlineTimer) clearTimeout(this.liveDeadlineTimer);
    if (this.liveStopTimer) clearTimeout(this.liveStopTimer);
    this.liveDeadlineTimer = undefined;
    this.liveStopTimer = undefined;
  }

  private finishLive(message: string): void {
    if (this.disposed || this.failure) return;
    this.sessionRequested = false;
    this.invalidateState();
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ type: 'stop' }));
    this.failure = new Error(message);
    this.ready = false;
    this.clearLiveTimers();
    this.setPhase('stopped', { type: 'phase', phase: 'stopped', message });
    // The parent owns this child and can stop it even if native teardown hangs.
    if (this.child?.exitCode === null && this.child.signalCode === null) this.child.kill('SIGKILL');
    this.socket?.terminate();
  }

  private redact(text: string): string {
    let safe = text;
    for (const secret of [this.token, this.options.apiKey, process.env.SMARTSPECTRA_API_KEY]) {
      if (secret) safe = safe.split(secret).join('[redacted]');
    }
    return safe;
  }

  private fail(reason: PauseReason, message: string, retryable = true): void {
    if (this.disposed || this.failure) return;
    const safe = this.redact(message);
    this.failure = new Error(safe);
    this.ready = false;
    this.invalidateState();
    this.clearStartupTimer();
    this.clearLiveTimers();
    this.pending = [];
    this.setPhase('error');
    this.rejectConnection?.(this.failure);
    this.rejectConnection = undefined;
    this.resolveConnection = undefined;
    this.errorSignal.fire({ reason, message: safe, retryable });
    this.socket?.terminate();
    const child = this.child;
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      const timer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      }, 1000);
      timer.unref();
      child.once('exit', () => clearTimeout(timer));
    }
  }
}
