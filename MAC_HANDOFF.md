# Mac handoff — Read Receipt

Wave 1 is integrated on branch `cursor/read-receipt-6a59`. Continue on your Apple Silicon Mac.

## Repo

**Public GitHub:** https://github.com/himanshu748/read-receipt  
(empty on create — this Cloud Agent cannot authenticate to GitHub; push from your Mac.)

```bash
# if you already have the Cloud Agent clone / worktree with our commits:
git remote add github https://github.com/himanshu748/read-receipt.git   # once
git push -u github cursor/read-receipt-6a59
git push github cursor/read-receipt-6a59:main   # optional: put wave 1 on main

# or fresh clone after you've pushed:
git clone https://github.com/himanshu748/read-receipt.git
cd read-receipt
git checkout cursor/read-receipt-6a59
npm install && npm run build && npm test   # expect 106 passing
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
