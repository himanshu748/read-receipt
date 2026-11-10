# Mac handoff — Read Receipt

Continue on your Apple Silicon Mac. This agent pass stops after wave 1 is integrated and the branch is pushed.

## Repo

- Agent branch: `cursor/read-receipt-6a59`
- Temporary Origin remote (Cloud Agent): `origin.cursor.com/git/himanshu748/tmp-…`
- **For the DEV challenge you need a fresh public GitHub repo.** In Cursor, use the **Create repo** pill on this project, choose public, then push `cursor/read-receipt-6a59` (or merge to `main`).

```bash
git clone <your-public-github-url>
cd <repo>
git checkout cursor/read-receipt-6a59   # or pull after you publish
npm install
npm run build
npm test
```

## What’s done vs not

| Piece | Status |
| --- | --- |
| PLAN.md + architecture | Done |
| `@rr/protocol` contracts | Done |
| Docs / README / consent | Done |
| A1 helper (replay) | Wave 1 — landing |
| B `@rr/core` | Wave 1 — landing |
| D review panel | Wave 1 — landing |
| C extension host | Not started (brief in `tasks/C-extension.md`) |
| E hooks + demo repo | Not started (`tasks/E-hooks-demo.md`) |
| A2 live SDK | After S0 spike |

## S0 spike (your Mac, ~2–3 min credits)

```bash
npm install @smartspectra/node-sdk -w @rr/helper
export SMARTSPECTRA_API_KEY=…
node scripts/spike/probe.mjs
# → scripts/spike/s0-summary.json — keep that file; it unblocks A2
```

Grant **Camera** to Terminal (or Cursor) in System Settings › Privacy & Security › Camera.

## Suggested next steps on Mac

1. Create public GitHub repo (Create repo pill / GitHub UI).
2. Finish or pull wave-1 packages; run `npm test`.
3. Implement C + E from `tasks/`.
4. Integration: replay JSON → helper → ticks → hook.
5. Run S0, then A2 live SDK.
6. Demo video + DEV post before **Nov 22 2026, 11:59 PM PST**.

## Rules to keep

- Allowed: “eyes-on time”, “on screen while you were looking”
- Camera only while Review Panel is visible; preview always on when running
- `enableTelemetry: false`; no video saved/sent
- Free tiers only
