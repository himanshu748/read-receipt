# Changelog

Delivery log per task. Newest first.

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

- A1 Helper (replay) — wave 1
- B Core — wave 1
- D Review panel — wave 1
- C Extension tracking — wave 2
- E Hooks + demo — wave 2
- A2 Live SDK — after S0
