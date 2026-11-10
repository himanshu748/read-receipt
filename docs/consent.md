# Consent & Data Handling

Read Receipt is a **personal self-review aid**. It reports what the local tool saw —
eyes-on time per hunk — and stamps that into a commit trailer. It is not
tamper-proof attestation.

## Camera & preview

- The camera runs **only while the Review Panel is visible**. Hide or close the panel
  for more than ~2 seconds and the helper stops the SDK and releases the camera.
- The **camera preview is always on screen while the camera is running**. There is no
  background camera operation.
- The OS camera indicator stays honest: when the panel is hidden, the camera is off.

## What is stored

| Data | Where | Notes |
| --- | --- | --- |
| Per-hunk eyes-on seconds, per-line timings, timestamps | `.git/read-receipt/` | Local only; GC'd when hunks leave the diff for > 14 days |
| Optional recordings | Path you pass to `--record` | **Derived features** (pitch, yaw, eye-openness, blink) and **pulse values** only — never frames, never raw landmarks |
| Preview JPEGs | Memory only | Relayed helper → extension → panel, then dropped |

**No video is saved or sent** off this machine.

## Network & telemetry

- The SmartSpectra SDK is constructed with `enableTelemetry: false`.
- The backend is contacted **only to authenticate your Presage API key**.
- We never call `requestInsight()` (no LLM Insights / off-device analysis).
- The helper WebSocket binds `127.0.0.1` only, with a random token; browser `Origin`
  headers are rejected.

## Pulse

Pulse (bpm + waveform) is a **liveness signal** — it helps distinguish a live viewer
from a still photo. It is **not** a medical measurement. Use of the Presage SDK is
subject to Presage's wellness disclaimer.

## Claims we make — and do not make

**Allowed**

- "eyes-on time"
- "on screen while you were looking"

**Banned claims** (we never say or imply these)

- Attention, focus, comprehension, fatigue, or stress
- Code correctness
- Any diagnostic or clinical meaning for pulse or face signals
- Team / manager views, remote monitoring, or a hidden / covert mode

Receipts are editable under `.git/read-receipt/`. The trailer honestly reports what
this tool recorded locally, including `overridden` or `unverified` when you bypass
the check.
