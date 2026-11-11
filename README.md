# Read Receipt

Review changed code before committing it. Read Receipt marks each Git diff hunk
with progress ticks in VS Code or Cursor, saves per-line viewing time, and blocks
commits whose staged text changes have no completed receipt.

**The current implementation uses synthetic replay signals.** Replay exercises
the editor, helper, receipt store and Git hooks without a camera, Presage API key
or SDK credits. Its trailers say `replay viewer`; they do not establish that a
person looked at, understood or approved the code.

```text
Read-Receipt: 6/6 hunks, 23s eyes-on, replay viewer
```

The timing above is illustrative; actual timing depends on visibility and
thresholds. Live Presage integration is planned and explicitly rejected by the
current helper and extension.

## Run the replay prototype

Requires **Node.js 20 or newer**, Git, and a local VS Code or Cursor installation.
No provider credentials or camera permissions are needed.
Review uses the first workspace folder's Git root; use separate editor windows
for different repositories.

```sh
npm ci
npm run build
npm run demo:repo
```

The demo command creates `fixtures/demo/_repo` with a synthetic baseline commit
and six unstaged hunks across four files. Its fake key contains
`DEMO_NOT_A_REAL_CREDENTIAL`. Existing targets are refused; use
`npm run demo:repo -- /absolute/path/to/a/new-directory` for another copy.

Open this source checkout in the editor and press **F5**, choosing **Read Receipt:
Replay Extension**. The launch configuration builds the extension and opens the
demo in an Extension Development Host. Trust that local demo folder when asked;
untrusted and virtual workspaces are not supported.

1. Run **Read Receipt: Open Review Panel**. It opens beside the source editor and
   starts a bundled five-minute synthetic recording, beginning with approximately
   20 seconds of calibration.
2. Keep a changed block visible while the panel reports replay eyes-on. Grey ticks
   become partial, then blue double ticks when elapsed-time and per-line thresholds
   are met. Unsaved files, an inactive editor window, hidden panel, paused replay
   or stale helper data stop counting.
3. Run **Read Receipt: Install Git Hooks** in the demo repository.
4. Stage the changes and try a commit. Unread staged hunks block it. Review the
   remaining hunks, allow roughly a second for persistence, and retry.

The [demo walkthrough](docs/demo-script.md) includes deliberately leaving the
fake-key block unread, a blocked commit, and a passing replay-labelled commit.

## What is implemented

- Worktree/staged diff parsing, content-based hunk identities, configurable
  thresholds, per-line coverage and atomic local receipt persistence.
- Extension activation, helper spawn/attach, visibility tracking, gutter ticks,
  status bar, unread navigation, reset and recalibration. Removed code opens in
  read-only review documents.
- Replay calibration and pause logic, authenticated localhost WebSocket state,
  pulse waveform events and optional derived-data recording. The bundled sustained
  input supports review; `fixtures/replay/demo-session.json` exercises interruptions.
- Pre-commit/message hooks, honest replay/override/bypass trailers, safe hook
  installation and a disposable six-hunk demo repository.

The native SmartSpectra SDK, live adapter and real camera preview are **not
implemented or validated**. `scripts/spike/probe.mjs` is a separate future
feasibility experiment; normal install/replay does not install or call that SDK.

## Commands and settings

The Command Palette provides **Open Review Panel**, **Next Unread Hunk**,
**Recalibrate**, **Install Git Hooks**, **Reset Receipts**, **Reconnect Helper**,
**Set Helper Token** and **Set Presage API Key**. The API-key command only stores
a key for future live work; it does not enable live mode.

| Setting | Default | Purpose |
| --- | --- | --- |
| `readReceipt.nodePath` | `node` | System Node.js executable. Use an absolute path if the editor cannot find Node. |
| `readReceipt.helper.mode` | `replay` | Keep replay selected; live currently returns an error. |
| `readReceipt.helper.replayFile` | empty | Bundled sustained recording, or a custom path relative to the reviewed Git root/absolute path. |
| `readReceipt.helper.attach` | `false` | Connect to an already-running local helper. |
| `readReceipt.helper.attachPort` | `0` | Existing helper's port; required when attachment is enabled. |

Attachment tokens use **Read Receipt: Set Helper Token** and editor SecretStorage,
not workspace settings. Connections are limited to loopback. See
[troubleshooting](docs/troubleshooting.md) for attachment setup.

Optional thresholds live in `.readreceipt.json`; copy `.readreceipt.example.json`
as a starting point. The extension and hooks use the same configuration.

## Git hooks

Install through the editor command, or from a terminal after building:

```sh
# Start in the Read Receipt source checkout.
RR_CLI="$(pwd)/packages/hooks/dist/cli.js"
cd /absolute/path/to/the/repository/to/review
node "$RR_CLI" install
```

Installation respects `core.hooksPath` and refuses foreign hooks. The generated
shims refer to the current Node/CLI paths; reinstall if those paths move. This is
local enforcement, not a server-side repository policy.

The hook evaluates staged changes; the extension evaluates the saved worktree.
Partial staging can produce different hunks and require another review. Deliberate
bypasses are labelled:

```sh
node "$RR_CLI" override --reason "Deliberate exception for this staged diff"
git commit -m "Commit with a one-shot override"

# Or use an explicit environment override:
READ_RECEIPT_OVERRIDE=1 git commit -m "Commit with an explicit override"
```

A saved override is bound to the staged diff and consumed once. Standard
`git commit --no-verify` skips pre-commit, but the message hook still labels the
trailer `unverified (hook bypassed)`. Merge commits and empty text diffs are
skipped. Binary changes are outside the text-hunk receipt check.

## Verification

```sh
npm run build
npm run ci
npm run test:replay
```

`test:replay` uses the real helper CLI, authenticated client, shared tracker,
persistence and installed hooks in a temporary Git repository. It checks an actual
blocked commit, five read hunks with an offscreen sixth still blocking, a passing
six-hunk replay trailer, content invalidation and paused counting for an inactive
window/hidden panel. **Editor visibility in this test is simulated explicitly.**

```sh
npm run test:editor
```

The separate editor-host test uses installed macOS Cursor when available, in
classic editor mode with a disposable profile. Otherwise it downloads VS Code's
official test runtime using `@vscode/test-electron` (the first run needs internet
and disk space). Set `RR_EDITOR_EXECUTABLE` to an absolute executable path to use
another existing installation. It never calls the Presage SDK. Keep the isolated
test window in the foreground: the test preserves the real window-state gate.
Its disposable repository uses shorter receipt thresholds; normal demo thresholds
are unchanged. The helper still goes through the full replay calibration.
Passing Node/DOM tests alone does not establish rendered editor behavior. See
[MAC_HANDOFF.md](MAC_HANDOFF.md) for current validation and remaining work.

The build bundles the editor and standalone helper as CommonJS, hooks as ESM,
and includes the recording/webview assets. Marketplace publication and installable
VSIX validation remain separate release work.

## Data and limits

Receipts, timings and hook metadata stay under the repository's Git directory at
`read-receipt/`; helper tokens and future API keys use editor SecretStorage. Replay
acquires no camera frames and makes no SDK calls. The normal helper binds to
`127.0.0.1`, authenticates its WebSocket and rejects browser `Origin` headers.
See [Consent & Data Handling](docs/consent.md).

Receipts are locally editable and bypassable. They do not establish code safety,
actual human review or resistance to tampering. Live hardware behavior, other
editor/platform combinations and provider integration remain unverified.

## Further reading

- [Demo walkthrough](docs/demo-script.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Consent and data handling](docs/consent.md)
- [Camera status](docs/camera-permissions.md)
- [Implementation plan](PLAN.md)

## License

A license has not been selected; no `LICENSE` file is included.
