# Consent and data handling

Read Receipt is a self-review aid with two distinct inputs: synthetic replay and
live camera signals. Receipts describe elapsed viewing conditions and visible
changed lines. They do not establish that a person understood or approved code.

## Choose the input deliberately

**Replay is the default.** It never opens a camera, initializes SmartSpectra,
authenticates a key or consumes SDK credits. Its pulse, waveform and face-related
states come from a fixture. Trailers must say `replay viewer`.

**Live camera mode** uses pinned SmartSpectra 3.5.0 in a separate system-Node
helper. Set the API key through the editor's SecretStorage command. Opening a
live session presents a modal disclosure before creating a helper; declining
cancels it. Starting a new session requires disclosure again. The extension
limits a session to 90 seconds. The standalone CLI requires `--live-consent`,
defaults to 90 seconds and rejects limits above 300 seconds. Read Receipt never
buys credits or enables billing; SDK usage can consume your account's allowance.

## What leaves the device in live mode

- Camera frames are processed by the SDK on-device. Read Receipt does not save
  video or raw landmark arrays. Landmarks are reduced locally to pose/openness
  features; JPEG previews remain in memory and use authenticated loopback.
- Authentication, model delivery and usage verification use Presage's network
  services. A camera-based session is not an offline operation.
- Presage documents automatic Insights snapshots containing derived pulse, HRV
  and breathing values, forwarded to its Analytics Gateway/LLM service. These
  automatic requests can occur without the app requesting an Insight.
- Aggregate SDK telemetry is disabled with `enableTelemetry: false`. That setting
  does not disable authentication, model/usage requests or automatic Insights.
- Read Receipt does not send source code, receipt files or helper tokens to
  Presage, and does not request or display LLM analysis.

See the organizer's [Node SDK reference](https://smartspectra.presagetech.com/docs/nodejs/api-reference),
[Insights privacy notice](https://smartspectra.presagetech.com/docs/llm-insights/)
and [telemetry/privacy documentation](https://smartspectra.presagetech.com/docs/telemetry-and-privacy/).
The provider's behavior and policies are separate from Read Receipt's local
storage. Review them before starting a session.

## Stored data

| Data | Location | Contents |
| --- | --- | --- |
| Receipts | Git directory, `read-receipt/receipts.json` | Hunk/file IDs, per-line/hunk seconds, timestamps, source and retention bookkeeping. |
| Hook metadata | Git directory, `read-receipt/` | Staged-diff fingerprints, short-lived pre-commit markers and optional override metadata/reason. |
| Optional replay recording | Explicit `--record` path | Derived feature, pulse, validation and error samples; no video or raw landmark arrays. |
| Helper token | Editor SecretStorage | Token supplied with Set Helper Token. |
| Presage key | Editor SecretStorage | Read for live mode only; passed through the child environment, never argv or the webview. |

Worktrees can place their Git directory elsewhere; storage resolves that directory
rather than assuming a directory-shaped `.git`. Receipt entries are eligible for
cleanup after they are no longer observed for 14 days. Corrupt-store recovery can
leave a local `.bak` copy.

Trailers become part of Git commit messages/history. They publish counts, elapsed
time, source and override/bypass labels when commits are published. Removed code
is shown locally in read-only documents sourced from the Git baseline.

## Local controls and lifetime

The extension spawns system Node.js and uses an authenticated loopback WebSocket.
The normal helper binds `127.0.0.1`, uses a random token and rejects browser
`Origin` headers. Attachment requires an explicit loopback port/token. Closing an
attached replay extension stops its session but does not terminate the external
server. Live attachment is rejected: the extension must own the process to
enforce its deadline and SDK configuration.

State older than 750 ms is unavailable. Dirty documents, an inactive editor
window, hidden panel or paused helper state prevent counting. Hiding the panel
also disables preview immediately and schedules capture/playback stop after about
two seconds. Stop or closing the panel ends the session. An owned helper is
terminated on extension shutdown; its parent watchdog handles an editor crash.
No automatic provider retry or credit purchase occurs. Recalibration clears the
viewing baseline without creating a new credit allowance.

The editor has an independent 90-second watchdog and kills the owned live helper
at that bound even if native processing hangs. Explicit Stop has a three-second
parent kill fallback. Repeated Stop/Start does not extend a connection's budget;
a new live session requires reconnecting through the disclosure.

## Limitations

Receipts/metadata are locally editable; hooks can be bypassed, removed or disabled.
This is not tamper-proof attestation or a server-side policy. The product does
not establish attention, focus, comprehension, fatigue, stress, code correctness,
medical status or resistance to photographs/replay attacks. Synthetic pulse data
is not evidence of a live person. There are no manager or remote-monitoring features.

Hardware/provider success requires observed live validation; replay, mock-SDK or
DOM tests do not establish it. Source-checkout native loading and an installable
VSIX are separate packaging boundaries. The old spike script is a standalone
experiment, not the extension's live entry point or proof of a successful run.
