# Read Receipt — developer handoff

Repository: <https://github.com/himanshu748/read-receipt>.

The repository contains replay extension wiring and Git hooks alongside the
core, helper and panel. The steps below run and verify the replay workflow.

## Run it

```sh
npm ci
npm run build
npm run demo:repo
```

Open the source checkout in VS Code or Cursor and press F5 with **Read Receipt:
Replay Extension** selected. The launch configuration opens `fixtures/demo/_repo`
in an Extension Development Host. Trust that disposable folder, then run **Read
Receipt: Open Review Panel** and **Read Receipt: Install Git Hooks**.

The generator refuses existing targets. For a new disposable repo elsewhere:

```sh
npm run demo:repo -- /absolute/path/to/a/new-demo-directory
```

The bundled input is five minutes of synthetic replay with roughly 20 seconds of
calibration. No camera, Presage SDK installation, API key or credits are used.
All receipts from this input must say `replay viewer`.

## Implemented

| Piece | Current behavior |
| --- | --- |
| Core/protocol | Diff parsing, content identities, thresholds, per-line coverage, persistence and runtime message guards. |
| Replay helper | Recording playback, state machine, pause reasons and authenticated loopback WebSocket. |
| Extension | Activation, helper spawn/attach, fresh-state checks, editor visibility/dirty/window gating, gutter/status UI, commands and removed-text review documents. |
| Panel | Replay indicator, calibration, pulse waveform, unread navigation, Start/Stop and recalibration. |
| Hooks | Staged-diff blocking, one-shot overrides, bypass detection and trailers; foreign hooks are preserved. |
| Demo/integration | Six-hunk generator, helper/real-Git replay test, F5 configuration and editor-host test runner. |

## Validation

```sh
npm run ci
npm run test:replay
npm run test:editor
```

The replay integration passed using the real helper CLI, authenticated WebSocket,
shared tracker, persisted receipts and actual Git hooks/commits in a temporary
repository. It verified unread commits block, five read hunks leave the offscreen
`auth.js:40` hunk blocking, six completed receipts allow a `replay viewer` commit,
edited content becomes unread, and inactive/hidden editor states earn no receipts.

This terminal integration supplies simulated editor visibility and is not
human-review evidence. `npm run ci` passed with **153 tests**, strict typechecking,
lint and the wording check. The full build passed.

The separate **Cursor 3.29.15 editor-host test passed** in an isolated profile:
activation and commands, real review webview, actual visible editor ranges,
offscreen blocking, the six-hunk replay-labelled Git commit, and a full-file
deletion reviewed through the read-only removed-text viewer. Receipt thresholds
are shortened only in the disposable test repository; replay calibration remains
the full 20 seconds. No camera or human observation is established by this test.

The editor runner uses installed macOS Cursor in classic mode when available;
otherwise it downloads the official VS Code test runtime. `RR_EDITOR_EXECUTABLE`
selects another existing installation. Test profile/workspace directories are
disposable; keep the test editor foreground for real window-state gating. Other
platform/editor combinations and an installable VSIX remain unverified.

## Remaining work

1. **Live feasibility/adapter:** live mode is deliberately rejected. The spike
   script exists, but no live SDK/hardware result is established here. Run a
   separately authorized feasibility check before claiming live integration; do
   not install the SDK, open a camera or consume credits during replay validation.
2. **Release checks:** validate an installable VSIX, choose a license and test the
   required editor/platform combinations. This is not a Marketplace release.
3. **Demo/submission:** record the real journey and label synthetic segments.
   A planned live narrative is not evidence of a delivered live feature.

Attach mode requires its port and **Read Receipt: Set Helper Token** in
SecretStorage. Keep credentials out of settings/source/logs and API keys out of
argv. See [troubleshooting](docs/troubleshooting.md) for recovery steps.
