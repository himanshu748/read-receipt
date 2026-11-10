#!/usr/bin/env node
/**
 * Fail CI if user-facing copy uses banned claims.
 * Allowed: "eyes-on time", "on screen while you were looking".
 * Banned: attention, focus (as a claim), comprehension, fatigue, stress,
 * medical diagnosis language, covert monitoring.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SCAN_ROOTS = ['README.md', 'docs', 'packages/extension'];
const EXTENSIONS = new Set(['.md', '.ts', '.tsx', '.js', '.html', '.json']);

const BANNED = [
  { re: /\battention\b/i, why: 'Do not claim to measure attention. Use eyes-on time.' },
  { re: /\bcomprehension\b/i, why: 'Do not claim to measure comprehension.' },
  { re: /\bfatigue\b/i, why: 'Do not claim to measure fatigue.' },
  { re: /\bstress\b/i, why: 'Do not claim to measure stress.' },
  {
    re: /\b(diagnos|medical condition|blood pressure|heart disease)\b/i,
    why: 'No medical claims.',
  },
  {
    re: /\b(covert|hidden mode|manager view|team dashboard)\b/i,
    why: 'Covert / manager monitoring is banned.',
  },
];

// Allow-list: files that discuss the ban itself (PLAN, this script, tests).
const ALLOW_PATH_RE =
  /(PLAN\.md|CHANGELOG\.md|check-wording\.mjs|messages\.test\.ts|contracts\.ts)$/;

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name === 'node_modules' || name === 'dist' || name === 'out') continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (EXTENSIONS.has(extname(name)) || name === 'README.md') out.push(p);
  }
  return out;
}

const files = [];
for (const root of SCAN_ROOTS) {
  const p = join(ROOT, root);
  try {
    const st = statSync(p);
    if (st.isDirectory()) walk(p, files);
    else files.push(p);
  } catch {
    // optional path
  }
}

let failed = 0;
for (const file of files) {
  if (ALLOW_PATH_RE.test(file)) continue;
  const text = readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip import paths and type names that aren't user-facing claims.
    if (/^\s*(\/\/|#|\*|import |export )/.test(line)) continue;
    for (const ban of BANNED) {
      if (ban.re.test(line)) {
        console.error(`${file}:${i + 1}: ${ban.why}`);
        console.error(`  ${line.trim()}`);
        failed++;
      }
    }
  }
}

if (failed > 0) {
  console.error(`\ncheck-wording: ${failed} violation(s)`);
  process.exit(1);
}
console.log('check-wording: ok');
