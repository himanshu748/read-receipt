# Changelog

Delivery log per task. Newest first.

## A2 — Live camera integration

- Added a native SmartSpectra 3.5.0 adapter and kept native dependencies external
  to the helper bundle. Replay does not initialize the SDK.
- Wired live-mode SecretStorage credentials, machine-level camera selection and
  explicit per-session data/credit disclosure before helper creation.
- Added local landmark reduction, live pulse/waveform input and in-memory preview
  over the authenticated loopback connection; no video recording.
- Bounded editor live sessions to 90 seconds; standalone CLI defaults to 90 with
  a maximum of 300. Stop/close and panel hiding govern camera lifetime.
- Added an independent parent-process deadline and a three-second Stop kill
  fallback for hung native code; rejected live attachment and reuse of a stopped
  live connection.
- Disabled aggregate SDK telemetry and documented automatic derived-vitals
  transmission to Presage/LLM services separately from raw-frame processing.
- Live hardware success requires its own observed end-to-end result; historical
  replay checks below are not live evidence.
- The first native attempt exposed premature shutdown on the SDK's initial Idle
  event. Fixed startup lifecycle handling and added a regression test; a repeat
  physical run and the new editor-host test remain pending. See
  [live validation](docs/live-validation.md).

## C + E + M3 — Replay extension and Git enforcement

- Implemented extension activation, helper spawn/attach and protocol checks,
  750 ms state freshness, editor visibility tracking, gutter/status UI and commands.
- Added read-only removed-text review documents and fail-closed pause handling.
- Implemented staged-diff pre-commit checks, replay/override/bypass trailers,
  diff-bound one-shot overrides and installation that preserves foreign hooks.
- Added the six-hunk generator, F5 configuration, bundled runtime assets,
  sustained synthetic input, helper/real-Git replay integration and an editor-host
  test runner.
- Replay integration passed blocked → five read/offscreen sixth blocked → six
  read/actual commit allowed, with a replay trailer. Edited content blocks again;
  inactive/hidden editor states do not earn receipts.
- Updated setup, demonstration, privacy and troubleshooting docs. At this
  checkpoint live was unimplemented; no SDK installation, camera or provider credits were part of this
  historical validation. Build, strict types, lint, wording and all 153 tests passed.
- The real Cursor 3.29.15 editor-host test passed activation, panel, viewport,
  blocked/passing replay commit and removed-file review checks in a disposable
  profile. Editor test thresholds are shortened; normal thresholds are unchanged.

## A1 — Helper replay (subagent)

- `@rr/helper`: features, eyesOn state machine, replay source, WS server (token + Origin reject),
  recorder, CLI `rr-helper`, `fixtures/replay/demo-session.json`
- 32 helper tests; full suite 106/106 green
- Pre-S0 tunables: pulse confidence floor 0.3, pressure SD ε 0.05; optional `--speed`

## D — Review panel (subagent)

- `createReviewPanel`: ViewColumn.Beside, start on show, stop after 2s hide
- Webview: preview / REPLAY card, pulse badge + waveform, eyes-on light, calibration,
  unread list, privacy line; nonce CSP
- Extra bridge messages: webview `ready`, host `clearFrame` (accepted)
- 36 jsdom tests (all phases + pause reasons)

## B — Core (subagent)

- `@rr/core`: `parseUnifiedDiff`, `readDiff`, `hunkId`, thresholds, `accumulate`,
  `statusOf`, `unionEyesOnSec`, `loadConfig`, `ReceiptStore` (atomic write + corrupt bak)
- 34 unit tests (parser/hash/accumulate/diff/config/store)
- Accepted drift: `ReceiptStore.open(repoRoot, { now? })` for GC tests; on-disk `lastSeen`
  map for 14-day GC; `accumulate` preserves `readAt` but does not set it (callers use `statusOf`)

## F — Docs (subagent)

- `README.md`: product pitch, architecture, platforms, install, extension/helper/hooks
- `docs/consent.md`: Consent & Data Handling with explicit banned-claim list
- `docs/camera-permissions.md`, `docs/demo-script.md`, `docs/troubleshooting.md`
- Wording checker allowlists `docs/consent.md` so the ban list can name banned terms

## M0 — Scaffold (architect)

- Monorepo workspaces: `@rr/protocol`, `@rr/core`, `@rr/helper`, `@rr/hooks`, `@rr/extension`
- TypeScript strict base config, ESLint, Vitest
- `@rr/protocol`: WebSocket message types + runtime guards, recording format, receipt types, `DEFAULT_CONFIG`
- `packages/extension/src/contracts.ts`: HelperConnection / ReceiptsView / ReviewPanelApi
- `scripts/check-wording.mjs` bans attention/comprehension/fatigue/stress/medical/covert claims
- `.readreceipt.example.json`
- PLAN.md (prior commit)

## Pending

- Live hardware/privacy validation, installable release validation, license choice,
  actual demo and submission preparation.
