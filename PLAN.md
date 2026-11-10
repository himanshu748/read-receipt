# Read Receipt — Plan

WhatsApp-style blue ticks for AI-written code. Every changed block (git diff hunk) gets ✓✓ only when a
live person, eyes open and facing the screen, had those lines on screen long enough to read them.
A pre-commit hook blocks commits with unread hunks and the commit gets a trailer:

```
Read-Receipt: 6/6 hunks, 2m41s eyes-on, live viewer
```

Entry for the DEV "Presage SmartSpectra SDK Challenge". Deadline: **Nov 22 2026, 11:59 PM PST**
(Nov 23, 1:29 PM IST). Solo build, free tiers only.

---

## 0. What the SDK actually gives us (verified against `@smartspectra/node-sdk` 3.5.0)

Sources: <https://smartspectra.presagetech.com/docs/nodejs>, `/docs/nodejs/api-reference`,
`/docs/nodejs/metrics`, `/docs/telemetry-and-privacy`, and the package's own `js/index.d.ts` and
`js/messages/generated.d.ts`. Subagents must use these names verbatim and never invent APIs.

| Need | Real API |
| --- | --- |
| Package | `npm i @smartspectra/node-sdk` (Node ≥ 20). Native runtime per platform: `darwin-arm64`, `win32-x64`, `linux-x64`, `linux-arm64`. **No Intel Mac, no Windows ARM.** Install pulls all platforms (a few hundred MB). |
| Construct | `new SmartSpectraSDK({ apiKey, requestedMetrics: [...cardioMetrics, ...faceMetrics], enableTelemetry: false, logLevel })` |
| Camera in a headless Node process | `sdk.useCamera(CameraSelection.default, { width: 1280, height: 720, fps: 30 })` then `sdk.start()`. List cameras with `SmartSpectraSDK.availableCameras()`. On Windows `.front`/`.back` fail with `kInputUnavailable`, so select by ID. |
| Frames pushed in by us (fallback) | `sdk.useCustomInput(FrameTransform.kNone)`, `sdk.start()`, `sdk.sendFrame(buf, w, h, stride, PixelFormat.kRGBA, tsUs)`. Timestamps must be monotonic (`process.hrtime.bigint() / 1000n`). |
| Shutdown | `await sdk.stopAsync(); await sdk.destroy();` |
| Events | `on('metrics', (buf, tsUs))`, `on('validationStatus', (code, tsUs, hint))`, `on('error', (code, message, retryable))`, `on('processingStatus', status)`, `on('videoOutput', (buf, w, h, stride, pixelFormat, tsUs))` |
| Decode | `decodeMetrics(buf)` returns `{ cardio?, face?, breathing?, ... }` |
| Pulse | `metrics.cardio.pulseRate[]` of `{ value, confidence, stable, timestamp }`; waveform `metrics.cardio.arterialPressureTrace[]`, same shape |
| Face | `metrics.face.landmarks[]` of `{ value: {x,y}[] (478 points), stable, reset, timestamp }`; `face.blinking[]` / `face.talking[]` of `{ detected, stable, timestamp }` |
| Validation codes (`ValidationCode`) | `kOk 0, kNoFaceFound 1, kMultipleFacesFound 2, kFaceNotCentered 3, kFaceSizeOutOfRange 4, kTooDark 5, kTooBright 6, kCameraTuning 10, kFrameRateTooLow 11, kExcessiveMotion 12, kFaceTooClose 13, kFaceTooFar 14, kFaceTooHigh 15, kFaceTooLow 16, kFaceNotForward 17` |
| Error codes (`SmartSpectraErrorCode`) | `kAuthenticationFailed 2, kCreditExhausted 4, kNetworkError 5, kInputUnavailable 7, kSustainedLowFrameRate 14`, and others. **`kCreditExhausted` is an error, not a validation code.** |
| Readiness | `await sdk.checkDeviceReadiness()` returns `{ verdict: 'ready'\|'limited'\|'blocked'\|'inconclusive', reason }`. Compare the verdict explicitly. |
| Privacy | `enableTelemetry: false` means "the SDK starts no telemetry session and transmits nothing". The backend is contacted only to authenticate the key. **We never call `requestInsight()`** (LLM Insights sends data off-device). |

Two facts force the architecture:

1. **VS Code and Cursor webviews cannot open the camera.** `getUserMedia` is denied in webview iframes
   (microsoft/vscode #113916, #250568). So the **helper process owns the camera** through native
   `useCamera()`, and the review panel shows a preview built from the helper's `videoOutput` frames.
2. Landmark coordinate space (pixels or normalized) and the exact `videoOutput` behaviour with
   `useCamera()` are not documented. Spike S0 (below) confirms both on real hardware before Task A2.

---

## 1. Architecture

```
┌──────────────────────── VS Code / Cursor extension host ────────────────────────┐
│                                                                                 │
│  diff watcher ──► @rr/core.parseDiff ──► Hunk[] ──► Tracker (4 Hz tick) ─┐      │
│  (git diff HEAD -U0                        ▲          │  visibleRanges   │      │
│   + untracked files)                       │          │  window.focused  │      │
│                                            │          ▼                  ▼      │
│  gutter ✓ / ✓ / ✓✓  ◄── decorations ◄── ReceiptStore (.git/read-receipt/) │      │
│  status bar "4/6 read"                                                    │      │
│                                                     ViewerState (eyesOn) ─┘      │
│  Review panel webview ◄─ postMessage ─ HelperClient ◄── ws://127.0.0.1 + token   │
│  (preview, pulse badge, eyes-on light, unread list)          ▲                   │
└──────────────────────────────────────────────────────────────┼───────────────────┘
                                                               │ spawn (system node)
┌────────────────────────── Presage helper (Node ≥ 20) ────────┴───────────────────┐
│  Source: LiveSource (SmartSpectra SDK, useCamera) | ReplaySource (JSON)          │
│      │ metrics / validationStatus / error / videoOutput                          │
│      ▼                                                                           │
│  features.ts: landmarks → { pitch, yaw, ear } (no raw landmarks leave this file) │
│      ▼                                                                           │
│  eyesOn.ts state machine (calibration, blink filter, pulse liveness, pauses)     │
│      ▼                                                                           │
│  server.ts: JSON state at 10 Hz + JPEG preview (320×180, ≤10 fps, memory only)   │
│  recorder.ts: optional, writes FEATURES (never frames/landmarks) to JSON         │
└──────────────────────────────────────────────────────────────────────────────────┘

git commit ──► pre-commit (rr-hook) ──► @rr/core (same diff + store) ──► exit 0 / 1
           └─► prepare-commit-msg ──► git interpret-trailers "Read-Receipt: …"
```

### Key decisions (and why)

| Decision | Reason |
| --- | --- |
| Helper owns the camera via `useCamera`. The preview is relayed helper → extension → webview. | Webviews can't use the camera. Relaying keeps the WS token out of the webview. |
| The SDK runs **only while the review panel is visible**. Panel hidden for more than 2 s means `stop`; visible again means `start`. | Saves credits, and guarantees the preview is always on screen while the camera runs (no hidden mode). The panel opens `ViewColumn.Beside`. |
| `eyesOn` is computed in the helper. The extension treats state older than 750 ms as `eyesOn=false`. | One testable state machine. If the helper crashes or stalls, counting stops and never keeps going silently. |
| Canonical diff: `git diff HEAD -U0` (extension) and `git diff --cached -U0` (hook), both run through `@rr/core.readDiff()` with identical flags. Untracked files become whole-file add hunks. | `-U0` gives deterministic hunk boundaries. Once everything is staged the two diffs match, so the hashes match. |
| Hunk hash = content of the hunk (file, removed lines, added lines). Line numbers are excluded. | Edits elsewhere in the file don't reset a receipt; editing the hunk itself does. |
| Per-line coverage + per-hunk eyes-on seconds. | Scrolling past a long hunk can't earn ✓✓. Every line has to have been on screen. |
| Thresholds live in an optional repo file `.readreceipt.json`, read by both extension and hook. | The hook and the UI can never disagree. |
| Recording stores **derived features** (pitch, yaw, eye-openness, blink, pulse), never frames or landmarks. | Matches "store only counts and timings". Replay still drives the same state machine. |
| The helper runs on the system `node`, not VS Code's Electron (`readReceipt.nodePath` setting). | koffi under Electron-as-node is an unneeded risk, and the SDK requires Node ≥ 20. |
| npm workspaces monorepo, TypeScript strict, Vitest, ESLint (typescript-eslint), esbuild bundles. | Small, fast, one toolchain. |

### Repo layout and ownership

```
package.json                 npm workspaces, root scripts (build, test, lint, typecheck)   [architect]
tsconfig.base.json, eslint.config.mjs, .readreceipt.example.json                           [architect]
packages/protocol/           shared types + runtime guards (the contract)                   [architect]
packages/core/               diff parse, hashing, thresholds, accumulator, receipt store    [Task B]
packages/helper/             Presage helper, eyesOn, replay/record, WS server               [Task A]
packages/extension/src/      extension.ts, tracker, decorations, status bar, helper client  [Task C]
packages/extension/src/panel/ + packages/extension/webview/   review panel                  [Task D]
packages/extension/src/contracts.ts   interfaces between C and D                            [architect]
packages/hooks/              rr-hook CLI: pre-commit, prepare-commit-msg, override, install [Task E]
fixtures/replay/*.json       synthetic replay sessions + generator                          [Task A]
fixtures/demo/ + scripts/make-demo-repo.mjs   6-hunk demo repo (planted key in auth.js)     [Task E]
README.md, docs/consent.md, docs/demo-script.md, docs/camera-permissions.md                 [Task F]
CHANGELOG.md                 per-task delivery log                                          [architect]
scripts/check-wording.mjs    blocks banned claims in user-facing text                       [architect]
```

---

## 2. Interfaces (the contract, in `packages/protocol`)

### 2.1 Helper ⇄ extension (WebSocket)

Transport: `ws://127.0.0.1:<port>/?token=<token>`. The helper binds **127.0.0.1 only**. The extension
spawns it with `--port 0 --token <32 random bytes hex>`. The helper prints a single stdout line,
`{"type":"listening","port":N}`, and rejects any connection that has a wrong token or any `Origin`
header (browsers always send one; Node `ws` clients don't), so a web page can't open the camera feed.

```ts
// packages/protocol/src/messages.ts
export const PROTOCOL_VERSION = 1 as const;

export type SourceKind = 'live' | 'replay';
export type Quality = 'good' | 'degraded' | 'unusable';

export type PauseReason =
  | 'not-started' | 'calibrating' | 'no-face' | 'multiple-faces' | 'face-not-forward'
  | 'looking-down' | 'eyes-closed' | 'no-pulse-yet' | 'pulse-lost'
  | 'too-dark' | 'too-bright' | 'excessive-motion' | 'low-frame-rate' | 'camera-tuning'
  | 'face-position'      // kFaceNotCentered / SizeOutOfRange / TooClose / TooFar / TooHigh / TooLow
  | 'credits-exhausted' | 'auth-failed' | 'network' | 'camera-unavailable' | 'sdk-error'
  | 'panel-hidden';

/** Exactly the user's spec plus derived fields. Emitted at 10 Hz while running. */
export interface ViewerState {
  seq: number;
  t: number;                    // ms since helper session start (monotonic)
  source: SourceKind;
  live: boolean;                // pulse present within liveness window (blocks a photo)
  eyesOpen: boolean;            // false only for a closure > closureMs (blinks ignored)
  facingScreen: boolean;        // face found, forward, and not looking down vs. calibration
  pulseBpm: number | null;      // latest cardio.pulseRate value (12 s average from SDK)
  quality: Quality;
  eyesOn: boolean;              // calibrated && live && eyesOpen && facingScreen && quality !== 'unusable'
  pauseReasons: PauseReason[];  // empty iff eyesOn
}

export type HelperPhase = 'idle' | 'starting' | 'calibrating' | 'running' | 'stopped' | 'error';

export type HelperToClient =
  | { type: 'hello'; protocol: typeof PROTOCOL_VERSION; helperVersion: string;
      sdkVersion: string | null; source: SourceKind }
  | { type: 'state'; state: ViewerState }
  | { type: 'phase'; phase: HelperPhase; calibrationProgress?: number /* 0..1 */; message?: string }
  | { type: 'pulseTrace'; t: number; values: number[] }   // arterialPressureTrace batch, for the waveform
  | { type: 'error'; reason: PauseReason; message: string; retryable: boolean };
// Binary WS frames = preview JPEG bytes (no header). Never written to disk.

export type ClientToHelper =
  | { type: 'start' }                 // panel became visible
  | { type: 'stop' }                  // panel hidden/closed: SDK stopAsync, camera released
  | { type: 'recalibrate' }
  | { type: 'preview'; enabled: boolean; maxFps: number };

export function isHelperToClient(x: unknown): x is HelperToClient;  // runtime guard
export function isClientToHelper(x: unknown): x is ClientToHelper;
```

Helper CLI: `rr-helper --mode live|replay [--replay <file>] [--loop] [--record <file>] --port 0 --token <hex> [--camera <id>]`.
API key comes from env `SMARTSPECTRA_API_KEY` only, never argv. The extension stores it in
`SecretStorage` via the command **Read Receipt: Set Presage API Key**.

### 2.2 Recording format (replay input)

```ts
export interface Recording {
  format: 'read-receipt-recording'; version: 1;
  createdAt: string; source: 'live' | 'synthetic'; sdkVersion: string | null; note?: string;
  samples: RecordedSample[];          // sorted by t
}
export type RecordedSample =
  | { t: number; kind: 'features'; faceFound: boolean; pitch: number | null; yaw: number | null;
      eyeOpenness: number | null; blinking: boolean | null; talking: boolean | null }
  | { t: number; kind: 'pulse'; bpm: number; confidence: number; stable: boolean }
  | { t: number; kind: 'pressure'; value: number }
  | { t: number; kind: 'validation'; code: number }           // ValidationCode integer
  | { t: number; kind: 'error'; code: number; message: string; retryable: boolean };
```

### 2.3 Diff, hunks, receipts (shared by core, extension and hooks)

```ts
// packages/protocol/src/receipts.ts
export type HunkId = string;  // first 20 hex chars of sha256("rr1\0" + file + "\0" + removed.join("\n") + "\0" + added.join("\n"))

export interface Hunk {
  id: HunkId;
  file: string;               // repo-relative, POSIX separators
  kind: 'add' | 'modify' | 'delete';
  oldStart: number; oldLines: number; newStart: number; newLines: number;
  added: string[];            // CR stripped, no leading '+'
  removed: string[];
  /** 1-based inclusive new-side lines used for visibility. A delete hunk is the single anchor line. */
  range: { start: number; end: number };
  lineCount: number;          // kind === 'delete' ? removed.length : added.length
}

export type ReceiptStatus = 'unseen' | 'partial' | 'read';

export interface HunkReceipt {
  id: HunkId; file: string; lineCount: number;
  eyesOnSec: number;          // seconds with ≥1 hunk line visible AND eyesOn
  lineSec: number[];          // per-line eyes-on seconds, length = range length
  buckets: number[];          // sorted unique unix seconds with eyes-on time (for union totals)
  source: SourceKind;         // 'replay' if ANY time came from replay
  firstSeenAt?: string; readAt?: string;
}

export interface ReceiptStoreFile {
  version: 1;
  updatedAt: string;
  receipts: Record<HunkId, HunkReceipt>;   // GC'd: ids absent from the current diff for > 14 days
}

export interface ReadReceiptConfig {        // .readreceipt.json (all optional)
  minSeconds: number;         // default 3
  secondsPerLine: number;     // default 0.4
  minLineSeconds: number;     // default 0.4 — every line must reach this
  closureMs: number;          // default 1000
  calibrationSec: number;     // default 20
  lookDownThreshold: number;  // default from spike S0 (z-score vs calibration)
}
```

### 2.4 `@rr/core` public API (Task B)

```ts
export function readDiff(repoRoot: string, mode: 'worktree' | 'staged'): Promise<Hunk[]>;
//   worktree: git -c core.quotepath=false diff HEAD -U0 --no-color --no-ext-diff --no-renames
//             --src-prefix=a/ --dst-prefix=b/  + untracked (git ls-files --others --exclude-standard)
//   staged:   same flags with --cached. Binary files skipped (reported separately).
//   Empty repo (no HEAD): diff against the empty tree 4b825dc642cb6eb9a060e54bf8d69288fbee4904.
export function parseUnifiedDiff(text: string): Hunk[];               // pure, heavily unit-tested
export function hunkId(file: string, removed: string[], added: string[]): HunkId;
export function thresholdSec(lineCount: number, cfg: ReadReceiptConfig): number; // max(minSeconds, n × secondsPerLine)
export function statusOf(r: HunkReceipt | undefined, h: Hunk, cfg: ReadReceiptConfig): ReceiptStatus;
//   read    ⇔ eyesOnSec ≥ threshold AND every lineSec[i] ≥ minLineSeconds
//   partial ⇔ eyesOnSec > 0 and not read;   unseen otherwise
export function accumulate(r: HunkReceipt | undefined, h: Hunk, visibleLines: number[], dtSec: number,
                           nowUnixSec: number, source: SourceKind): HunkReceipt;   // pure
export function unionEyesOnSec(receipts: HunkReceipt[]): number;     // |∪ buckets|, for the trailer
export function loadConfig(repoRoot: string): ReadReceiptConfig;
export class ReceiptStore {                                           // .git/read-receipt/receipts.json
  static open(repoRoot: string): Promise<ReceiptStore>;               // uses `git rev-parse --git-dir`
  get(id: HunkId): HunkReceipt | undefined;
  put(r: HunkReceipt): void;
  flush(): Promise<void>;                                             // atomic write (tmp + rename)
}
```

### 2.5 Extension-internal contracts (`packages/extension/src/contracts.ts`, between C and D)

```ts
export interface HelperConnection {
  readonly state: ViewerState | null;           // null when stale (> 750 ms) or disconnected
  readonly phase: HelperPhase;
  onState: vscode.Event<ViewerState>; onPhase: vscode.Event<{ phase: HelperPhase; calibrationProgress?: number; message?: string }>;
  onPreviewFrame: vscode.Event<Uint8Array>;     // JPEG
  onPulseTrace: vscode.Event<{ t: number; values: number[] }>;
  onError: vscode.Event<{ reason: PauseReason; message: string; retryable: boolean }>;
  send(msg: ClientToHelper): void;
}
export interface ReceiptsView {
  readonly summary: { read: number; partial: number; unseen: number; total: number };
  readonly unread: Array<{ id: HunkId; file: string; line: number; status: ReceiptStatus; progress: number }>;
  onDidChange: vscode.Event<void>;
  reveal(id: HunkId): Promise<void>;
}
// Task D implements:
export interface ReviewPanelApi { show(): void; dispose(): void; readonly visible: boolean; onDidChangeVisibility: vscode.Event<boolean>; }
export function createReviewPanel(ctx: vscode.ExtensionContext, helper: HelperConnection, receipts: ReceiptsView): ReviewPanelApi;
```

Webview messages (D-internal, but typed in `panel/messages.ts`). Extension → webview:
`state`, `phase`, `frame` (base64 JPEG), `pulseTrace`, `receipts`, `error`. Webview → extension:
`start`, `stop`, `recalibrate`, `reveal {id}`.

---

## 3. Eyes-on logic (helper, Task A)

All in `eyesOn.ts`. It is a pure state machine, `step(prev, input, cfg) -> next`, fed by `features.ts`
outputs and SDK events at sample time.

- **Features from landmarks** (MediaPipe 478 indices). Eye midpoint = mean(33, 133, 263, 362).
  Interocular distance d = |33 − 263|. Face height = |10 − 152|.
  - `pitch = (y[1] − eyeMid.y) / faceHeight` (nose-tip drop relative to the eyes), and
    `yaw = (x[1] − eyeMid.x) / d`.
  - `eyeOpenness = mean(|159−145|, |386−374|) / d` (eye-aspect proxy, a backup to the SDK blink flag).
  - Ratios only, so pixel vs. normalized coordinates doesn't matter. Raw landmarks never leave
    `features.ts`.
- **Calibration**: the first `calibrationSec` (20 s) of samples with `kOk` validation and a face
  present. The panel shows "Look at the middle of your editor". Store the mean and SD of `pitch`,
  `yaw` and `eyeOpenness`. Nothing counts until calibration completes. `recalibrate` restarts it.
- **facingScreen** = face found AND no `kNoFaceFound`, `kFaceNotForward` or `kMultipleFacesFound`
  within the last 500 ms AND |pitch z-score| < `lookDownThreshold`, with 300 ms hysteresis.
  Multiple faces pause counting, because we can't attribute reading.
- **eyesOpen**: blinking runs ≤ `closureMs` are ignored (eyesOpen stays true through a blink). A run of
  `blinking.detected` OR `eyeOpenness < 0.55 × baseline` lasting more than `closureMs` sets
  eyesOpen=false until the eyes reopen.
- **live (pulse liveness)**: a `cardio.pulseRate` sample within the last 5 s with 40 ≤ bpm ≤ 180 and
  confidence ≥ the spike-measured floor, AND a non-flat `arterialPressureTrace` (SD > ε) over the
  last 5 s. Before the first pulse arrives (SDK 12 s window) the reason is `no-pulse-yet`, shown as
  "Checking for a live viewer…". A dropout shorter than 3 s is held; a longer one gives `pulse-lost`.
- **quality**: `unusable` on kTooDark, kTooBright, kExcessiveMotion, kFrameRateTooLow, kCameraTuning
  or any error. `degraded` on face-position codes. Otherwise `good`.
- **Errors**: `kCreditExhausted` → `credits-exhausted` (stop SDK, panel shows "Presage credits used
  up — receipts paused. Replay mode still works."). `kAuthenticationFailed` → `auth-failed`.
  `kNetworkError` → `network`. `kInputUnavailable` → `camera-unavailable`. Every error forces
  eyesOn=false. Errors never auto-restart (per SDK guidance for `kSustainedLowFrameRate`); the user
  clicks Retry.

---

## 4. Milestones

Ordering follows the brief: the replay integration works end to end before any live SDK wiring.

| # | Milestone | Owner | Exit criteria |
| --- | --- | --- | --- |
| M0 | Scaffold: workspaces, tsconfig strict, ESLint, Vitest, esbuild, `@rr/protocol` types + guards, `contracts.ts`, wording check, CHANGELOG | architect | `npm run build && npm test && npm run lint` green on an empty skeleton |
| S0 | **Live spike** (runs on your laptop, about 3 min of credits): `packages/helper/spike/probe.mjs` logs whether `videoOutput` fires with `useCamera`, the landmark coordinate range, blink behaviour during a 2 s eye closure, pulse latency/confidence, and `pitch` while looking at the screen vs. the keyboard | architect writes it, you run it | A JSON summary pasted back; it sets `lookDownThreshold`, the confidence floor, and the preview path |
| M1 | Wave 1, in parallel: **A1** helper (replay source, eyesOn, WS server, recorder, synthetic fixtures), **B** core, **D** panel UI against a fake `HelperConnection`, **F** README draft | subagents | Each task's acceptance tests pass, reviewed and merged |
| M2 | Wave 2, in parallel: **C** extension tracking/decorations/status bar/helper process, **E** hooks + demo repo | subagents | Acceptance tests pass |
| M3 | **Integration**: replay JSON → helper → extension → ticks turn blue → hook blocks, then passes | architect | Scripted e2e test plus a manual run in VS Code with the demo repo |
| M4 | **A2 live SDK**: `LiveSource` with `useCamera`, preview from `videoOutput`, error mapping, `--record` | subagent, then you test on hardware | Pulse badge shows a live bpm, all pause reasons are reachable, credits-exhausted handled |
| M5 | Polish: optional "Ask me why" (Ollama), Windows + macOS passes, demo video, DEV post | subagent + you | Submission checklist done |

### Tasks (summaries; full specs go to each subagent after you approve)

- **A1 Helper (replay)**: owns `packages/helper/**` and `fixtures/replay/**`. Delivers `features.ts`,
  `eyesOn.ts`, `sources/replay.ts`, `server.ts`, `recorder.ts`, `main.ts` (CLI), and
  `scripts/gen-replay.ts`, which produces `demo-session.json` with segments for calibration, reading,
  a blink, a 2 s eye closure, looking down, no face, two faces, too dark, and credits exhausted.
  *Acceptance*: unit tests for every pause reason and the blink/closure boundary (0.9 s vs 1.1 s);
  token and Origin rejection tests; replay of the fixture yields the expected eyesOn timeline within
  ±100 ms.
- **A2 Helper (live)**: `sources/live.ts` and `preview.ts` (downscale + `jpeg-js`). If S0 shows
  `videoOutput` doesn't fire under `useCamera`, it falls back to a loopback capture page opened in
  the system browser (`getUserMedia` → WS → `useCustomInput`/`sendFrame`). The browser shows its own
  camera indicator, and the panel still shows the preview.
- **B Core**: owns `packages/core/**`. *Acceptance*: parser fixtures (modify, add, delete-only, new
  file, deleted file, CRLF, `\ No newline at end of file`, unicode path, binary skipped, multiple files,
  empty repo); hash stable across line shifts and changed on edit; threshold math; per-line coverage
  (scrolling past ≠ read); union of buckets; atomic store write; corrupt store → backup + fresh.
- **C Extension**: owns `packages/extension/src/**` except `panel/` and `contracts.ts`, plus
  `packages/extension/package.json` and `media/*.svg`. Tracker: a 250 ms tick; for each visible
  non-dirty file editor of a tracked file, take `visibleRanges` ∩ hunk ranges, and only count when
  `window.state.focused` and `helper.state?.eyesOn` hold. Dirty documents pause (hover text: "save to
  track"). Gutter grey ✓ / ✓ / blue ✓✓ with hover "4.2 s of 7.6 s eyes-on · 80% of lines on screen
  while you were looking". Status bar `$(check-all) 4/6 read` opens the panel. Commands: Open Review
  Panel, Next Unread Hunk, Recalibrate, Set Presage API Key, Install Git Hooks, Reset Receipts.
  *Acceptance*: tracker logic is a vscode-free pure module with unit tests; an `@vscode/test-electron`
  smoke test (activation, status bar text, decoration types).
- **D Review panel**: owns `packages/extension/src/panel/**` and `packages/extension/webview/**`.
  Shows the live preview (always visible while running; in replay it shows a clear "REPLAY — camera
  off" card), a pulse badge with bpm and waveform, an eyes-on light with a plain-language reason, a
  calibration progress ring, an unread list with jump-to, Start/Stop/Recalibrate, and the privacy
  line "Video stays on this computer. Nothing is recorded." Strict CSP with a nonce. Light, dark and
  high-contrast themes via VS Code CSS variables. *Acceptance*: renders every phase and pause reason
  from a fake connection; vitest + jsdom for the message → DOM mapping.
- **E Hooks + demo**: owns `packages/hooks/**`, `fixtures/demo/**`, `scripts/make-demo-repo.mjs`.
  - `rr-hook pre-commit` lists unread hunks as `path:line  (2.1 s of 7.6 s, 60% lines)` and exits 1.
  - `rr-hook override [--reason ...]` writes a one-shot token bound to the staged-diff hash; the
    env var `READ_RECEIPT_OVERRIDE=1` also works. The commit then passes and is honestly labelled
    "overridden".
  - `rr-hook prepare-commit-msg` recomputes the trailer itself, so it still runs under `--no-verify`
    and writes `unverified`.
  - `rr-hook install` respects `core.hooksPath` and writes `/bin/sh` shims that work on Git for
    Windows.
  - Trailer formats:
    - `Read-Receipt: 6/6 hunks, 2m41s eyes-on, live viewer`
    - `Read-Receipt: 5/6 hunks, 1m10s eyes-on, live viewer, overridden (1 unread)`
    - `… replay viewer` (any replay time)
    - `… unverified (hook bypassed)`
  - The demo repo has 6 hunks across 4 files; `auth.js` lines 40–58 hold a planted fake key,
    `const API_KEY = "sk_live_DEMO_…"`.
  - *Acceptance*: e2e tests on temp git repos cover block → read → pass, override, `--no-verify`,
    amend, merge commits (skipped), and an empty diff.
- **F Docs**: owns `README.md` and `docs/**`. Setup (Node 20+, key, supported platforms), Consent &
  Data Handling, camera permissions (macOS: System Settings › Privacy & Security › Camera › enable
  "Code"/"Cursor"; Windows: Settings › Privacy & security › Camera › "Let desktop apps access your
  camera"), troubleshooting per pause reason, a 2-minute demo script, and the allowed-wording rule.

Every subagent brief will include its goal, owned files, the exact interfaces above, acceptance tests,
"don't edit files outside your scope", and "use only the SDK names listed in PLAN.md §0".

---

## 5. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| `videoOutput` may not fire with `useCamera` in headless Node | Spike S0 first. Fallback: loopback browser capture page + `useCustomInput`/`sendFrame`. |
| macOS attributes camera permission to the parent app (VS Code/Cursor), and the prompt may not show for a spawned child | Document granting Camera to Code/Cursor. Fallback: run `npx rr-helper` from Terminal; the extension can attach to a running helper (`readReceipt.helper.attach`). |
| Head pitch from 2-D landmarks is noisy | Per-user calibration, z-scores, hysteresis, configurable threshold tuned in S0. The wording stays "facing the screen", never a gaze claim. |
| Limited free credits | All development against replay. Live work only in S0, A2 and final testing. SDK runs only while the panel is visible. Credits-exhausted path is covered by a replay fixture. |
| Pulse takes about 12 s to appear | Explicit "Checking for a live viewer…" warm-up that overlaps the 20 s calibration. |
| Unsupported hardware (Intel Mac, Windows ARM) | Clear message at helper start. Replay mode still demos everything except the live pulse. |
| Extension and hook disagree on hunks | Same `@rr/core.readDiff` and config. CRLF normalized. Partial staging is documented and reported as unread (fails safe). |
| A local web page connects to the localhost WS | 127.0.0.1 bind, random token, reject any `Origin` header. |
| Receipts file is user-editable | Stated plainly: this is a self-review aid, not tamper-proof attestation. The trailer reports what the local tool saw. |
| Overclaiming (attention, comprehension, ...) | `scripts/check-wording.mjs` in CI scans README, docs, `package.json` contributes and webview strings for banned terms. |
| SDK install is a few hundred MB | Only the helper depends on it; the extension bundle doesn't. Noted in README. |

## 6. Privacy and consent (product rules, enforced in review)

- No video is saved or sent. Preview JPEGs live only in memory and are dropped after display.
- Stored data is limited to per-hunk seconds and timestamps (`.git/read-receipt/`). Recordings are
  opt-in, written to an explicit path, and hold derived features and pulse values only. The README
  says so.
- `enableTelemetry: false`, no `requestInsight()`. The network is used only for Presage key
  authentication.
- The camera preview is visible whenever the SDK runs; the panel hidden means the camera is off.
  There is no background mode, no team or manager view, and nothing leaves the machine.
- Allowed claims: "eyes-on time", "on screen while you were looking". Banned: attention, focus (as a
  claim), comprehension, fatigue, stress, correctness, any medical wording. Pulse is shown only as a
  liveness signal, with the SDK's wellness disclaimer.

## 7. Test plan

- **Unit (Vitest, CI on ubuntu/macos/windows)**: diff parser and hashing (B); thresholds, accumulator
  and union (B); eyesOn state machine with synthetic timelines (A); features from hand-built landmark
  sets (A); protocol guards (M0); trailer formatting and override token binding (E); tracker logic
  with fake visibility snapshots (C); panel message → DOM (D).
- **Integration**: helper in replay mode plus a Node WS client, asserting the state timeline (A);
  hooks on temp git repos (E); **M3 e2e script**: build the demo repo, replay `demo-session.json`
  through the helper, drive the core tracker with simulated visibility of each hunk, then assert the
  hook exits 1 before `auth.js:40` is read and 0 after, with the exact trailer.
- **Extension smoke**: `@vscode/test-electron` activation test (headless via xvfb in CI).
- **Manual, live (your laptop)**: an S0 probe, then the checklist: pulse badge appears; blink keeps
  counting; a 2 s eye closure pauses; looking at the keyboard pauses; walking away gives "No face";
  a second person gives "Only one person in view"; lights off gives "Too dark"; hiding the panel
  turns the camera off (OS indicator goes off); a photo held to the camera never gets `live`.
- **Wording check** and `tsc --noEmit` (strict) in CI.

## 8. Open questions for you

1. **Subagent model**: "Auto" isn't one of the models I can assign to subagents. I can use `inherit`
   (the same model I'm running), or a named option such as Claude Opus 5.5, Claude Sonnet 5.5,
   GPT-5.6 Sol, Composer 2.5, or Gemini 4 Argon. Which do you want?
2. **Your laptop**: Apple Silicon Mac or Windows x64? (Intel Macs aren't supported by the SDK.) Do you
   already have a Presage API key for spike S0?
3. **Override UX**: OK with `rr-hook override` plus the `READ_RECEIPT_OVERRIDE=1 git commit` env var?
   (`git commit` can't take custom flags.)
4. **Repo**: this is a new project without a repository yet. Create one with the Create repo pill
   when you're ready (it needs to be public for the challenge). I won't push until you say so.
