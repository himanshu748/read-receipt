#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);

/** Make a new, disposable repository. Existing targets are never overwritten. */
export async function generateDemoRepo(target) {
  const root = resolve(target);
  await mkdir(dirname(root), { recursive: true });
  await mkdir(root); // EEXIST is deliberate: do not replace a user's repository.
  const git = async (...args) => exec('git', args, { cwd: root });
  await git('init', '--quiet');
  await git('config', 'user.name', 'Read Receipt Demo Fixture');
  await git('config', 'user.email', 'read-receipt-fixture@example.invalid');
  await git('config', 'commit.gpgsign', 'false');
  await git('config', 'core.hooksPath', '.git/hooks');
  const files = {
    'auth.js': Array.from({ length: 80 }, (_, i) => `// Authentication fixture line ${i + 1}`),
    'app.js': Array.from({ length: 60 }, (_, i) => `// Application fixture line ${i + 1}`),
    'storage.js': Array.from({ length: 60 }, (_, i) => `// Storage fixture line ${i + 1}`),
    'README.md': Array.from({ length: 30 }, (_, i) => `Demo documentation line ${i + 1}.`),
  };
  for (const [file, lines] of Object.entries(files)) await writeFile(join(root, file), `${lines.join('\n')}\n`);
  await git('add', '.');
  await git('commit', '--quiet', '-m', 'Synthetic baseline for Read Receipt demo');
  files['auth.js'].splice(39, 19,
    '// Synthetic code-review exercise: this key is deliberately fake.',
    '// Review this whole block before marking it read.',
    'const API_KEY = "sk_live_DEMO_NOT_A_REAL_CREDENTIAL";',
    'export function authHeaders() {',
    '  return { "x-demo-key": API_KEY };',
    '}',
    '// A real application should load a key from its environment.',
    '// The fixture intentionally leaves the key inline for review.',
    'export function isDemoRequest(request) {',
    '  return request.headers["x-demo"] === "true";',
    '}',
    '// Receipts count visible lines, not whether the code is safe.',
    '// A reviewer still decides what should be changed.',
    '// No request is sent by this fixture.',
    '// No provider account or real secret is used.',
    '// Keep the DEMO marker if you copy this example.',
    '// This block occupies lines 40 through 58.',
    '// The helper input is synthetic replay data.',
    '// End of the planted-key review block.');
  files['app.js'][9] = 'export const retryCount = 3;';
  files['app.js'][39] = 'export const requestTimeoutMs = 5000;';
  files['storage.js'][9] = 'export const cacheTtlSeconds = 60;';
  files['storage.js'][39] = 'export const maxCacheEntries = 100;';
  files['README.md'][9] = 'Review all six changed blocks before the demo commit.';
  for (const [file, lines] of Object.entries(files)) await writeFile(join(root, file), `${lines.join('\n')}\n`);
  return root;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const target = process.argv[2] ?? resolve(dirname(fileURLToPath(import.meta.url)), '../fixtures/demo/_repo');
  generateDemoRepo(target).then(root => process.stdout.write(`Demo repository: ${root}\nSix unstaged hunks across four files; auth.js:40-58 contains a fake DEMO key.\n`)).catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
