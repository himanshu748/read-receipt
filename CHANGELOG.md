# Changelog

Delivery log per task. Newest first.

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
