import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '@rr/protocol';
import { loadConfig } from './config.js';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe('loadConfig', () => {
  it('returns defaults when file is missing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rr-cfg-'));
    dirs.push(dir);
    expect(loadConfig(dir)).toEqual(DEFAULT_CONFIG);
  });

  it('merges partial .readreceipt.json over defaults', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rr-cfg-'));
    dirs.push(dir);
    await writeFile(
      join(dir, '.readreceipt.json'),
      JSON.stringify({ minSeconds: 9, secondsPerLine: 1 }),
      'utf8',
    );
    const cfg = loadConfig(dir);
    expect(cfg.minSeconds).toBe(9);
    expect(cfg.secondsPerLine).toBe(1);
    expect(cfg.minLineSeconds).toBe(DEFAULT_CONFIG.minLineSeconds);
    expect(cfg.closureMs).toBe(DEFAULT_CONFIG.closureMs);
  });

  it('ignores corrupt JSON', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rr-cfg-'));
    dirs.push(dir);
    await writeFile(join(dir, '.readreceipt.json'), '{not json', 'utf8');
    expect(loadConfig(dir)).toEqual(DEFAULT_CONFIG);
  });
});
