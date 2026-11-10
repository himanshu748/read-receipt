# Task B — Diff / hunk parser + receipt store

## Goal
Implement `@rr/core`: parse git diffs into hunks, hash them, accumulate eyes-on
seconds with per-line coverage, and persist receipts under `.git/read-receipt/`.

## Owns (only these paths)
- `packages/core/**` (replace the stub)

## Must match
`PLAN.md` §2.3–2.4 and `@rr/protocol` (`Hunk`, `HunkReceipt`, `ReadReceiptConfig`, `DEFAULT_CONFIG`).

## Public API (export from `src/index.ts`)
```ts
readDiff(repoRoot, mode: 'worktree' | 'staged'): Promise<Hunk[]>
parseUnifiedDiff(text: string): Hunk[]
hunkId(file, removed, added): HunkId
thresholdSec(lineCount, cfg): number  // max(minSeconds, n * secondsPerLine)
statusOf(receipt | undefined, hunk, cfg): ReceiptStatus
accumulate(receipt | undefined, hunk, visibleLines, dtSec, nowUnixSec, source): HunkReceipt
unionEyesOnSec(receipts): number
loadConfig(repoRoot): ReadReceiptConfig
class ReceiptStore { static open; get; put; flush }
```

## Rules
- Hash: first 20 hex of `sha256("rr1\0" + file + "\0" + removed.join("\n") + "\0" + added.join("\n"))`
- `git -c core.quotepath=false diff … -U0 --no-color --no-ext-diff --no-renames --src-prefix=a/ --dst-prefix=b/`
- worktree: diff `HEAD` + untracked as whole-file adds; staged: `--cached`
- Empty repo: empty tree `4b825dc642cb6eb9a060e54bf8d69288fbee4904`
- Binary files skipped; CRLF → LF; strip `\ No newline at end of file`
- Delete hunk `range` = single anchor line on the new side
- `statusOf`: read ⇔ eyesOnSec ≥ threshold AND every `lineSec[i] ≥ minLineSeconds`
- Store path: `<git-dir>/read-receipt/receipts.json`, atomic write (tmp + rename)
- Corrupt store → rename to `.bak` and start fresh
- GC: drop receipts whose ids have been absent from the current diff for > 14 days (track lastSeen)

## Acceptance tests (Vitest)
Parser fixtures: modify, add, delete-only, new file, deleted file, CRLF, no-newline marker,
unicode path, binary skipped, multiple files, empty repo.
Hash stable across line shifts; changes when hunk content edits.
Threshold math; per-line coverage (scroll-past ≠ read); union of buckets;
atomic store write; corrupt → backup + fresh.

## Do not
- Edit files outside `packages/core/**`
- Depend on vscode or the helper
- Talk to the network
