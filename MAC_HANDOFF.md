# Mac handoff — Read Receipt

Wave 1 is integrated on branch `cursor/read-receipt-6a59`. Continue on your Apple Silicon Mac.

## Repo

This Cloud Agent session uses a temporary Origin remote. **For the DEV challenge you need a fresh public GitHub repo** — use the **Create repo** pill in Cursor (public). This agent cannot create a public GitHub repo (`gh` is logged out; Origin create is only private/internal).

```bash
git clone <your-public-github-url>
cd <repo>
git fetch && git checkout cursor/read-receipt-6a59
npm install
npm run build
npm test   # expect 106 passing
```

## Done (wave 1)

| Piece | Status |
| --- | --- |
| PLAN.md + `@rr/protocol` | Done |
| Docs / README / consent | Done (Task F) |
| `@rr/core` diff + receipts | Done (Task B) — 34 tests |
| Review panel webview | Done (Task D) — 36 tests |
| Helper replay + eyesOn + WS | Done (Task A1) — 32 tests |

## Not done (your Mac / next agents)

| Piece | Brief |
| --- | --- |
| C extension host (tracker, gutter, status bar, helper spawn) | `tasks/C-extension.md` |
| E git hooks + demo repo | `tasks/E-hooks-demo.md` |
| M3 integration (replay → ticks → hook) | after C+E |
| S0 live spike → A2 live SDK | `scripts/spike/probe.mjs` |

## S0 spike (~2–3 min credits)

```bash
npm install @smartspectra/node-sdk -w @rr/helper
export SMARTSPECTRA_API_KEY=…
node scripts/spike/probe.mjs
# → scripts/spike/s0-summary.json
```

Grant Camera to Terminal or Cursor: System Settings › Privacy & Security › Camera.

## Quick helper smoke (no camera)

```bash
npm run build -w @rr/helper
node packages/helper/dist/main.js --mode replay \
  --replay fixtures/replay/demo-session.json \
  --port 0 --token "$(openssl rand -hex 16)"
# should print {"type":"listening","port":N}
```

## Deadline

DEV Presage challenge: **Nov 22 2026, 11:59 PM PST**.
