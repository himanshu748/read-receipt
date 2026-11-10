# Read Receipt

WhatsApp-style blue ticks for AI-written code. Every changed block (git diff hunk)
gets ✓✓ only when a live person, eyes open and facing the screen, had those lines
**on screen while you were looking** long enough to earn the receipt. A pre-commit
hook blocks commits with unread hunks and stamps a trailer with **eyes-on time**:

```
Read-Receipt: 6/6 hunks, 2m41s eyes-on, live viewer
```

Built for the DEV [Presage SmartSpectra SDK Challenge](https://dev.to).

## Architecture

```
┌──────────────────────── VS Code / Cursor extension host ────────────────────────┐
│  diff watcher ──► @rr/core ──► Hunk[] ──► Tracker ──► ReceiptStore               │
│  gutter ✓ / ✓ / ✓✓ · status bar · Review panel webview                           │
│                                         ▲                                        │
│                          HelperClient ──┘  ws://127.0.0.1 + token                │
└─────────────────────────────────────────┼────────────────────────────────────────┘
                                          │ spawn (system Node ≥ 20)
┌────────────────────────── Presage helper ───────────────────────────────────────┐
│  LiveSource (SmartSpectra camera)  |  ReplaySource (JSON fixtures)               │
│  → derived face/pulse features → eyesOn state machine → preview + state @ 10 Hz  │
└──────────────────────────────────────────────────────────────────────────────────┘

git commit ──► rr-hook pre-commit (block unread) ──► prepare-commit-msg (trailer)
```

The helper owns the camera (VS Code/Cursor webviews cannot). The review panel shows a
live preview relayed from the helper. Receipts live under `.git/read-receipt/` as local
counts and timings only — see [Consent & Data Handling](docs/consent.md).

## Requirements

| Need | Detail |
| --- | --- |
| Node.js | **≥ 20** (system `node`, not Electron-as-node) |
| Native SDK platforms | `darwin-arm64` (Apple Silicon), `win32-x64`, `linux-x64`, `linux-arm64` |
| Editor | VS Code or Cursor |
| Presage key | Free API key from [physiology.presagetech.com](https://physiology.presagetech.com) (live mode only) |

**Replay-only platforms:** Intel Mac and Windows ARM have no native SmartSpectra
runtime. Replay mode still demos the full eyes-on pipeline without a camera or key.

> **Install size:** `@smartspectra/node-sdk` pulls native binaries for every platform
> (a few hundred MB). Only the helper depends on it; the extension bundle does not.

## Install & build

```bash
npm install
npm run build
```

Optional repo thresholds: copy `.readreceipt.example.json` to `.readreceipt.json`.

## Extension

1. Open this repo in VS Code or Cursor.
2. Press **F5** to launch the Extension Development Host (once Task C lands), or
   package with `vsce` / `npx @vscode/vsce package` from `packages/extension`.
3. In the Extension Development Host, open a git repo (see [demo script](docs/demo-script.md)).
4. Command palette:
   - **Read Receipt: Open Review Panel**
   - **Read Receipt: Set Presage API Key** (stores the key in SecretStorage; never argv)
   - **Read Receipt: Install Git Hooks**
   - **Read Receipt: Recalibrate** / **Next Unread Hunk** / **Reset Receipts**

Settings of note:

| Setting | Default | Purpose |
| --- | --- | --- |
| `readReceipt.helper.mode` | `replay` | `replay` or `live` |
| `readReceipt.helper.replayFile` | _(empty)_ | Path to a recording JSON |
| `readReceipt.helper.attach` | `false` | Attach to a helper you started in Terminal |
| `readReceipt.nodePath` | `node` | System Node ≥ 20 binary |

## Helper (replay vs live)

Replay is the default. It drives the same eyes-on state machine from JSON fixtures —
no camera, no credits.

```bash
# From the repo root after build (replay fixture once Task A1 lands)
npx rr-helper --mode replay --replay fixtures/replay/demo-session.json --loop --port 0 --token <hex>
```

Live mode uses the SmartSpectra camera via `useCamera`. Set the key first:

1. Command **Read Receipt: Set Presage API Key**, or
2. Export `SMARTSPECTRA_API_KEY` in the environment that starts the helper (never pass
   the key on argv).

```bash
npx rr-helper --mode live --port 0 --token <hex>
# optional: --camera <id>   (list with SmartSpectraSDK.availableCameras)
# optional: --record <file>  writes derived features + pulse only
```

Camera permission steps: [docs/camera-permissions.md](docs/camera-permissions.md).

## Git hooks

```bash
npx rr-hook install
```

This installs `pre-commit` (blocks unread hunks) and `prepare-commit-msg` (writes the
`Read-Receipt:` trailer). One-shot override: `npx rr-hook override` or
`READ_RECEIPT_OVERRIDE=1 git commit`.

## Demo

Follow the 2-minute judge walkthrough: **[docs/demo-script.md](docs/demo-script.md)**.

## Docs

- [Consent & Data Handling](docs/consent.md)
- [Camera permissions](docs/camera-permissions.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Demo script](docs/demo-script.md)

## License

See repository license file when published.
