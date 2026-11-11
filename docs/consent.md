# Consent and data handling

Read Receipt is a local self-review aid. The current version uses **synthetic
replay input**. Its timings describe the fixture and editor visibility state,
not observations of a person's eyes, pulse or review decisions.

## Current camera/provider behavior

- Replay never opens a camera or acquires video frames.
- It does not install/construct the SmartSpectra SDK, authenticate a Presage key,
  consume SDK credits or call provider analysis services.
- Pulse numbers, waveforms and face-related pause reasons come from replay data.
  `replay viewer` trailers must not be presented as live evidence.
- Selecting live mode produces an explicit unsupported-mode error.

## Stored data

| Data | Location | Contents |
| --- | --- | --- |
| Receipts | Git directory, `read-receipt/receipts.json` | Hunk/file IDs, per-line/hunk seconds, timestamps, source and retention bookkeeping. |
| Hook metadata | Git directory, `read-receipt/` | Staged-diff fingerprints, short-lived pre-commit markers and optional override metadata/reason. |
| Optional recording | Explicit `--record` path | Replay-derived feature, pulse, validation and error samples; no video or raw landmark arrays. |
| Helper token | Editor SecretStorage | Token supplied with Set Helper Token. |
| Future Presage key | Editor SecretStorage | Stored by Set Presage API Key, unused in replay. |

Worktrees can place their Git directory elsewhere; storage resolves that directory
rather than assuming a directory-shaped `.git`. Receipt entries are eligible for
cleanup after they are no longer observed for 14 days. Corrupt-store recovery can
leave a local `.bak` copy.

Trailers become part of Git commit messages/history. They publish counts, elapsed
time, source and override/bypass labels when those commits are published. Removed
code is shown in read-only documents sourced from the Git baseline, locally.

## Local transport/processes

The extension spawns system Node.js and uses an authenticated loopback WebSocket.
The normal helper binds `127.0.0.1`, uses a random token and rejects browser
`Origin` headers. Attachment requires an explicit loopback port/token. Tokens do
not go to the webview; provider API keys are never command-line arguments.

State older than 750 ms is unavailable. Dirty documents, an inactive editor
window, a hidden panel or paused helper state also prevent counting. Use
Start/Stop, Recalibrate, Reconnect Helper or Reset Receipts for local control.
Closing the panel stops replay; hiding it stops counting immediately and schedules
helper stop after about two seconds. Disconnecting does not terminate an externally
started helper server.

## Limitations and future live work

Receipts/metadata are locally editable; hooks can be bypassed, removed or disabled.
This is not tamper-proof attestation or a server-side policy. The product does
not establish attention, focus, comprehension, fatigue, stress, code correctness,
medical status or resistance to photographs/replay attacks. Synthetic pulse data
is not evidence of a live person. There are no manager or remote-monitoring features.

The plan's future live adapter, visible preview, telemetry choices and network
boundaries still require implementation and hardware validation. The standalone
spike is separate from normal replay use and must not be run or cited as successful
live integration without authorization and actual observed results.
