# Task E — Git hooks + demo fixture

## Goal
Ship `rr-hook` CLI (pre-commit, prepare-commit-msg, override, install) and a demo
repo generator with 6 AI-style hunks including a planted key in `auth.js` 40–58.

## Owns (only these paths)
- `packages/hooks/**`
- `fixtures/demo/**`
- `scripts/make-demo-repo.mjs`

## Depends on
- `@rr/core` (readDiff staged, statusOf, ReceiptStore, loadConfig, unionEyesOnSec)
- `@rr/protocol`

## Deliver
1. `rr-hook pre-commit` — list unread as `path:line  (2.1 s of 7.6 s, 60% lines)`; exit 1 if any.
2. `rr-hook override [--reason …]` — one-shot token bound to staged-diff hash under
   `.git/read-receipt/override.json`. Env `READ_RECEIPT_OVERRIDE=1` also works.
   Commit then passes; trailer says `overridden`.
3. `rr-hook prepare-commit-msg` — always rewrite/append trailer via
   `git interpret-trailers`. Formats:
   - `Read-Receipt: 6/6 hunks, 2m41s eyes-on, live viewer`
   - `…, overridden (1 unread)`
   - `… replay viewer` if any receipt.source === 'replay'
   - `… unverified (hook bypassed)` when pre-commit was skipped (`--no-verify`)
     but prepare-commit-msg still ran (detect missing receipt of pre-commit run).
4. `rr-hook install` — respect `core.hooksPath`; write `/bin/sh` shims (Git for Windows OK).
5. Skip merge commits / empty diffs (exit 0).
6. `scripts/make-demo-repo.mjs` → `fixtures/demo/_repo/` (gitignored working copy)
   or documented path: 6 hunks across ≥4 files; `auth.js` lines 40–58 contain
   `const API_KEY = "sk_live_DEMO_…"`.
7. Vitest e2e on temp git repos: block → mark read in store → pass; override;
   `--no-verify` trailer; amend; merge skip; empty diff.

## Do not
- Edit extension/helper/core beyond depending on their public API
- Soften the planted-key copy into something that looks real enough to scare scanners —
  keep the `DEMO` marker obvious

## Git
Commit on `cursor/read-receipt-6a59`. DO NOT PUSH.
