#!/usr/bin/env node
import { resolve } from 'node:path';
import { startHelperServer } from './server.js';
import { ReplaySource } from './sources/replay.js';
import { Recorder } from './recorder.js';
import { LiveSource } from './sources/live.js';

export interface CliArgs {
  mode: 'live' | 'replay';
  replay?: string;
  loop: boolean;
  record?: string;
  port: number;
  token: string;
  speed: number;
  camera?: string;
  parentPid?: number;
  liveConsent: boolean;
  maxLiveSeconds: number;
}

export function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {
    mode: 'replay',
    loop: false,
    port: 0,
    token: '',
    speed: 1,
    liveConsent: false,
    maxLiveSeconds: 90,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`Missing value after ${a}`);
      return v;
    };
    switch (a) {
      case '--mode':
        out.mode = next() as CliArgs['mode'];
        break;
      case '--replay':
        out.replay = next();
        break;
      case '--loop':
        out.loop = true;
        break;
      case '--record':
        out.record = next();
        break;
      case '--port':
        out.port = Number(next());
        break;
      case '--token':
        out.token = next();
        break;
      case '--speed':
        out.speed = Number(next());
        break;
      case '--camera':
        out.camera = next();
        break;
      case '--live-consent':
        out.liveConsent = true;
        break;
      case '--max-live-seconds':
        out.maxLiveSeconds = Number(next());
        break;
      case '--parent-pid':
        out.parentPid = Number(next());
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;
      default:
        if (a.startsWith('-')) {
          throw new Error(`Unknown flag: ${a}`);
        }
    }
  }

  if (!out.token || !/^[0-9a-fA-F]+$/.test(out.token)) {
    throw new Error('--token <hex> is required');
  }
  if (out.mode === 'replay' && !out.replay) {
    throw new Error('--replay <file> is required in replay mode');
  }
  if (out.mode !== 'live' && out.mode !== 'replay') throw new Error('--mode must be live or replay');
  if (out.mode === 'live' && !out.liveConsent) throw new Error('--live-consent is required: camera frames stay local, derived vitals may be sent to Presage/LLM services and SDK credits are used.');
  if (out.mode === 'live' && (out.record || out.replay || out.loop || out.speed !== 1)) throw new Error('Live mode cannot record, replay, loop or accelerate.');
  if (!Number.isFinite(out.maxLiveSeconds) || out.maxLiveSeconds <= 0 || out.maxLiveSeconds > 300) throw new Error('--max-live-seconds must be > 0 and <= 300');
  if (out.camera !== undefined && (!/^\d+$/.test(out.camera) || !Number.isSafeInteger(Number(out.camera)))) throw new Error('--camera must be a non-negative integer');
  if (!Number.isInteger(out.port) || out.port < 0 || out.port > 65535) {
    throw new Error('--port must be an integer between 0 and 65535');
  }
  if (!Number.isFinite(out.speed) || out.speed <= 0) {
    throw new Error('--speed must be > 0');
  }
  if (out.parentPid !== undefined && (!Number.isInteger(out.parentPid) || out.parentPid < 1)) {
    throw new Error('--parent-pid must be a positive integer');
  }

  return out;
}

function printHelp(): void {
  process.stdout.write(`Usage: rr-helper --mode replay --replay <file> [--loop] [--record <file>] [--speed N] --port 0 --token <hex>

Options:
  --mode replay|live   Source mode (default replay)
  --live-consent       Accept live camera, derived-vitals transmission and SDK-credit use
  --max-live-seconds N Hard live-session duration (default 90; maximum 300)
  --camera N          Camera discovery index (default 0, no fallback)
  --replay <file>      Recording JSON path
  --loop               Loop the replay
  --record <file>      Append derived samples to a recording file
  --speed <n>          Playback speed (default 1)
  --port <n>           Listen port (0 = ephemeral)
  --token <hex>        Required shared secret (query ?token=)
`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const replayPath = args.replay ? resolve(args.replay) : undefined;
  const replay = replayPath ? await ReplaySource.fromFile(replayPath, {
    speed: args.speed,
    loop: args.loop,
  }) : undefined;
  const live = args.mode === 'live' ? new LiveSource({ apiKey: process.env.SMARTSPECTRA_API_KEY ?? '',
    consent: args.liveConsent, cameraIndex: Number(args.camera ?? 0), maxSeconds: args.maxLiveSeconds }) : undefined;

  const recorder = args.record
    ? new Recorder(resolve(args.record), {
        source: 'synthetic',
        sdkVersion: null,
        note: `replay of ${replayPath}`,
      })
    : undefined;

  const server = await startHelperServer({
    port: args.port,
    token: args.token,
    source: args.mode,
    sdkVersion: live ? '3.5.0' : replay?.recording.sdkVersion ?? null,
    ...(replay ? { replay } : {}),
    ...(live ? { live } : {}),
    ...(recorder ? { recorder } : {}),
  });

  // Single stdout line for the extension to parse.
  process.stdout.write(
    `${JSON.stringify({ type: 'listening', port: server.port })}\n`,
  );

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    // Native shutdown must not keep an owned camera process alive indefinitely.
    const killDeadline = setTimeout(() => process.exit(1), 3000);
    try { await server.close(); }
    finally { clearTimeout(killDeadline); process.exit(0); }
  };
  // Every native stop/error/expiry closes this one-session process with a kill deadline.
  live?.onEvent((event) => { if (event.type === 'ended') setImmediate(() => { void shutdown(); }); });
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
  // An editor crash must not leave its owned helper running after its parent dies.
  if (args.parentPid !== undefined) {
    const timer = setInterval(() => {
      try { process.kill(args.parentPid!, 0); }
      catch { clearInterval(timer); void shutdown(); }
    }, 1000);
    timer.unref();
  }
}

const isDirect =
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith('main.js') ||
    process.argv[1].endsWith('main.ts') ||
    process.argv[1].includes('rr-helper'));

if (isDirect) {
  main().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`${message}\n`);
    process.exit(1);
  });
}
