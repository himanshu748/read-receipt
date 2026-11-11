#!/usr/bin/env node
import { createOverride, installHooks, prepareCommitMessage, runPreCommit } from './index.js';

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const args = [...argv];
  const command = args.shift();
  let gitPid: string | undefined;
  let reason: string | undefined;
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const value = args[i]!;
    if (value === '--git-pid' || value === '--reason') {
      const next = args[++i];
      if (next === undefined) throw new Error(`Missing value after ${value}`);
      if (value === '--git-pid') gitPid = next;
      else reason = next;
    } else positional.push(value);
  }
  const context = { repoRoot: process.cwd(), ...(gitPid ? { gitPid } : {}), output: (s: string) => process.stderr.write(s) };
  switch (command) {
    case 'pre-commit': return runPreCommit(context);
    case 'prepare-commit-msg':
      if (!positional[0]) throw new Error('prepare-commit-msg requires the commit message file.');
      await prepareCommitMessage(context, positional[0], positional[1]);
      return 0;
    case 'override': await createOverride(context, reason); return 0;
    case 'install': await installHooks(context); return 0;
    case '--help':
    case '-h':
    case undefined:
      process.stdout.write('Usage: rr-hook install | pre-commit | prepare-commit-msg <file> [source] | override [--reason text]\n');
      return 0;
    default: throw new Error(`Unknown rr-hook command: ${command}`);
  }
}

if (process.argv[1]?.endsWith('cli.js') || process.argv[1]?.endsWith('rr-hook')) {
  main().then(code => { process.exitCode = code; }).catch((error: unknown) => {
    process.stderr.write(`Read Receipt: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
