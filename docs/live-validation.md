# Live integration validation — 2026-11-11

The live adapter is implemented. **A successful physical camera → editor →
receipts → Git commit has not yet been verified.** Replay success and injected
SDK tests are separate evidence.

## What was exercised

- Final `npm run build` and `npm run ci` passed: strict types, lint, wording and
  **221 tests across 20 files**. Injected-SDK tests cover startup Idle, stale
  timestamps, confidence conversion, preview encoding and hung native teardown.
  Real child-process tests cover the independent 90-second and Stop deadlines.
- The terminal replay integration also passed, including actual blocked/passing
  Git commits. It uses synthetic signals and simulated viewport input.

- SmartSpectra 3.5.0 loaded on macOS arm64 with system Node 26.12.0, without
  constructing a capture session during the import check.
- The account portal showed the Free tier. No plan, payment or permission
  settings were changed and no credits were purchased. Exact SDK credit usage
  was not available from the observed portal page.
- One approved native test attempted the real bundled helper and camera source.
  Its disposable Git repository rejected the unread commit. The SDK's initial
  Idle event then caused premature shutdown before any preview frames or usable
  viewer signals arrived. No live receipts or successful live commit resulted.
- The adapter now ignores initial Idle and ends on Idle only after Running.
  A regression test covers that lifecycle sequence. The physical test has not
  been repeated after this fix.
- An independent process inspection after the attempt found no task-owned native
  helper running. The test runner now allows time for process reaping before its
  own absence assertion.
- No video, preview JPEGs, raw landmarks or physiological recordings were saved.
  Local evidence contains outcome flags, frame counts and pause/error labels.

The attempted native harness supplies **simulated viewport visibility**. It is
not the real editor-host test, and it must not be described as one.

## Deferred editor test

Cursor was no longer installed at the previously used path. Downloading the
official VS Code test host exhausted available disk space during extraction.
Only this task's failed download and partial extraction were removed. The user
deferred freeing disk space and the editor-host test until later. Earlier Cursor
replay results are historical; they do not verify the new live feature.

## Reproduce after preparing the machine

First run `npm run build` and `npm run ci`. Neither command opens a camera.
Camera tests require a separately approved session, provider allowance and a
key supplied outside the repository as `SMARTSPECTRA_API_KEY`.

```sh
# Real camera/helper + Git, with simulated viewport input:
node scripts/live-e2e.mjs --live-consent

# Actual macOS editor host, normal receipt thresholds and normal consent UI:
node scripts/live-editor-e2e.mjs --live-consent
```

Run only the test specifically approved for that session. Each runner has a
90-second camera budget and never retries provider capture automatically.
The editor runner requires `RR_EDITOR_EXECUTABLE` when Cursor is unavailable.
For VS Code, use its `Contents/MacOS/Electron` executable. It prepares an isolated
profile and disposable two-file repository. Paste the key at the normal password
input and accept the normal live-camera disclosure. On macOS the runner places
the supplied key on the clipboard for that input and restores the previous text
afterward; it never prints the key or saves raw editor/native logs.

Both runners save outcome JSON under ignored `work/`. A future successful run
must establish usable live signals, preview delivery, blocked unread/offscreen
commits, a passing `live viewer` trailer and helper termination. The real editor
test must also use actual editor visibility. Physical eye-closure, looking-away,
lighting and camera-indicator checks remain additional hardware validation.

## Provider boundaries

The native SDK stays external to the JavaScript bundle and resolves from the
source checkout's dependencies. This is not a validated VSIX distribution.
The editor enforces an independent process deadline; a standalone CLI's own
timer cannot interrupt a native call that blocks its entire event loop.

Presage documents [Node SDK lifecycle and platforms](https://smartspectra.presagetech.com/docs/nodejs/)
and [automatic derived-vitals transmission for Insights](https://smartspectra.presagetech.com/docs/llm-insights/).
Telemetry opt-out does not make the SDK network-free. See [consent](consent.md).
