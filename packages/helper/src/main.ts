#!/usr/bin/env node
import { resolve } from 'node:path';
import { startHelperServer } from './server.js';
import { ReplaySource } from './sources/replay.js';
import { Recorder } from './recorder.js';

export interface CliArgs {
  mode: 'live' | 'replay';
  replay?: string;
  loop: boolean;
  record?: string;
  port: number;
  token: string;
  speed: number;
  camera?: string;
}

export function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {
    mode: 'replay',
    loop: false,
    port: 0,
    token: '',
    speed: 1,
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
  if (out.mode === 'live') {
    throw new Error(
      'live mode is not available yet (Task A2). Use --mode replay.',
    );
  }
  if (!Number.isFinite(out.port) || out.port < 0) {
    throw new Error('--port must be a non-negative number');
  }
  if (!Number.isFinite(out.speed) || out.speed <= 0) {
    throw new Error('--speed must be > 0');
  }

  return out;
}

function printHelp(): void {
  process.stdout.write(`Usage: rr-helper --mode replay --replay <file> [--loop] [--record <file>] [--speed N] --port 0 --token <hex>

Options:
  --mode replay|live   Source mode (only replay is implemented in A1)
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
  const replayPath = resolve(args.replay!);
  const replay = await ReplaySource.fromFile(replayPath, {
    speed: args.speed,
    loop: args.loop,
  });

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
    source: 'replay',
    sdkVersion: replay.recording.sdkVersion,
    replay,
    ...(recorder ? { recorder } : {}),
  });

  // Single stdout line for the extension to parse.
  process.stdout.write(
    `${JSON.stringify({ type: 'listening', port: server.port })}\n`,
  );

  const shutdown = async () => {
    await server.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
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
