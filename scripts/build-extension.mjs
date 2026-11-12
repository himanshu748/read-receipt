import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reviewRecording } from './replay-fixture.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const extension = resolve(root, 'packages/extension');
const bundle = (input, outfile, external = [], format = 'cjs') => build({ absWorkingDir: root,
  entryPoints: [input], outfile, bundle: true, platform: 'node', format,
  target: 'node20', external, sourcemap: true });
await bundle('packages/extension/src/extension.ts', resolve(extension, 'out/extension.js'), ['vscode']);
await bundle('packages/extension/src/tracker.ts', resolve(extension, 'out/tracker.cjs'));
await bundle('packages/extension/src/helperClient.ts', resolve(extension, 'out/helperClient.cjs'));
// The helper and hooks run on system Node, independently of the editor's module loader.
await bundle('packages/helper/src/main.ts', resolve(extension, 'runtime/helper/main.js'), ['@smartspectra/node-sdk']);
await bundle('packages/hooks/src/cli.ts', resolve(extension, 'runtime/hooks/cli.js'), [], 'esm');
await writeFile(resolve(extension, 'runtime/hooks/package.json'), '{"type":"module"}\n');
await mkdir(resolve(extension, 'runtime/replay'), { recursive: true });
await writeFile(resolve(extension, 'runtime/replay/review-session.json'), JSON.stringify(reviewRecording()));
console.log('Bundled extension, replay helper, hooks and synthetic recording.');
