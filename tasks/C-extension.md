# Task C — Extension visibility tracking + decorations + status bar

## Goal
Wire the VS Code/Cursor extension host: watch the git diff, track which hunks are
on screen while eyesOn, paint gutter ticks, update the status bar, spawn/attach
the helper, and call `createReviewPanel` from Task D.

## Owns (only these paths)
- `packages/extension/src/**` EXCEPT `src/panel/**` and `contracts.ts`
- `packages/extension/media/**` (gutter icons if needed)
- You may edit `packages/extension/package.json` / `tsconfig.json` for activation,
  bundling, and dependencies (`ws`, etc.)

## Depends on (already on branch after wave 1)
- `@rr/core` — readDiff, accumulate, ReceiptStore, statusOf, loadConfig
- `@rr/protocol` — ViewerState, …
- `createReviewPanel` from `./panel` (Task D)
- Helper CLI from `@rr/helper` (replay mode for integration)

## Deliver
1. **HelperClient** implementing `HelperConnection`: spawn `readReceipt.nodePath`
   with `rr-helper` (resolve from workspace `node_modules/@rr/helper` or PATH),
   parse `{"type":"listening","port":N}`, connect with token, treat state older
   than 750 ms as `state === null` (eyesOn false). Support
   `readReceipt.helper.mode` replay|live, `replayFile`, `attach`.
2. **Tracker** (pure module + thin vscode wrapper): 250 ms tick; for each visible
   non-dirty text editor of a tracked file, intersect `visibleRanges` with hunk
   ranges; only accumulate when `window.state.focused` AND helper eyesOn.
   Dirty docs pause (hover: "save to track"). Flush ReceiptStore periodically.
3. **Decorations**: grey ✓ unseen, single ✓ partial, blue ✓✓ read. Hover:
   "4.2 s of 7.6 s eyes-on · 80% of lines on screen while you were looking".
4. **Status bar**: `$(check-all) 4/6 read` — click opens panel.
5. **Commands** already declared in package.json: openPanel, nextUnread,
   recalibrate, setApiKey (SecretStorage key `smartspectra.apiKey` → env for
   child), installHooks (shell out to rr-hook install), resetReceipts.
6. **activate()**: wire everything; export ReceiptsView for the panel.
7. Unit tests for pure tracker logic (no vscode). Optional smoke later.

## Do not
- Edit `src/panel/**`, `webview/**`, or `contracts.ts`
- Implement git hooks (Task E)
- Add live SDK code to the extension process

## Git
Commit on `cursor/read-receipt-6a59`. DO NOT PUSH.
