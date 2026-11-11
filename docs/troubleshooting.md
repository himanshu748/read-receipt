# Troubleshooting replay

The current input is synthetic. Camera labels and pulse values describe the
recording; changing lighting, buying credits or granting camera permission will
not alter those samples. Live mode is not implemented.

## Extension startup

- Run `npm ci` and `npm run build` before F5. Build creates the extension bundle,
  standalone helper/hooks, recording and webview assets.
- Open a trusted **local Git folder**. Untrusted/virtual workspaces are unsupported;
  the extension uses the first workspace folder's repository.
- F5 expects `fixtures/demo/_repo`; run `npm run demo:repo` first. Existing targets
  are refused, so choose a new directory instead of overwriting an earlier demo.
- Set `readReceipt.nodePath` to system Node.js 20 or newer, using an absolute path
  if the editor cannot find `node`. The helper does not use Electron-as-node.
- Read the **Read Receipt** output channel and command error for details.

## Receipts do not progress

Keep the editor window active, saved changed lines visible and Review Panel
visible. Every line needs its configured minimum, plus the hunk's overall time.
Briefly opening a file or scrolling past a long block is insufficient.

The default sustained replay has about 20 seconds of calibration and lasts five
minutes. Stop/Start restart it and calibration. State older than 750 ms becomes
unavailable. A failed connection requires **Read Receipt: Reconnect Helper** or
opening the panel again through the Command Palette/status bar; Start alone
does not replace a disconnected client.

Deleted text opens in a read-only review document through Next Unread Hunk or
the unread list. Looking at the surviving line beside a deletion does not review
the removed text.

## Pause-scenario fixture

Use `fixtures/replay/demo-session.json` to exercise the short interruption fixture.
Relative `readReceipt.helper.replayFile` paths resolve from the repository being
reviewed. Use an absolute path when reviewing a different demo repository.

This fixture has calibration, a short blink, longer closure, looking down, no
face, multiple faces, darkness and a terminal simulated credits error. That error
does not mean an account was billed or exhausted.

| Reason | Replay meaning/response |
| --- | --- |
| `not-started` | Helper is idle. Open the panel and Start. |
| `calibrating` | Wait for the fixture's calibration segment. |
| `no-pulse-yet`, `pulse-lost` | Recording pulse/waveform data is not yet suitable. Wait for later samples or restart. |
| `no-face`, `multiple-faces`, `face-not-forward`, `looking-down`, `eyes-closed` | Simulated face/eye interruption. Later fixture samples determine when counting resumes. |
| `too-dark`, `too-bright`, `excessive-motion`, `low-frame-rate`, `camera-tuning`, `face-position` | A simulated validation condition; no physical camera adjustment is needed. |
| `credits-exhausted`, `auth-failed`, `camera-unavailable`, `sdk-error` | Fixture error or helper failure. Read the message, restart or reconnect. No live SDK is operating. |
| `network` | Local helper disconnected or stopped delivering fresh state. Reconnect and check its process/port. |
| `panel-hidden` | Show the panel again. Hidden panels earn no time. |

## Attach to a terminal helper

From the built source checkout:

```sh
RR_TOKEN="$(node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))")"
node packages/helper/dist/main.js --mode replay \
  --replay packages/extension/runtime/replay/review-session.json \
  --port 0 --token "$RR_TOKEN"
```

The helper prints a JSON `listening` message with its port. Set
`readReceipt.helper.attach` to `true` and `readReceipt.helper.attachPort` to that
port. Run **Read Receipt: Set Helper Token**, enter the terminal token, then open
the Review Panel. Display the token privately if needed; do not share it in logs
or workspace settings. Tokens need at least 32 hexadecimal characters.

Attachment is loopback-only. Closing the extension stops its session but leaves
the terminal server alive; stop that process yourself afterward. To return to
normal spawning, disable attachment and use Reconnect Helper.

## Commit still blocked

- Hooks check the staged diff while the editor tracks the saved worktree. Partial
  staging can change boundaries; review/stage the exact intended content.
- Allow about one second for automatic receipt persistence, then retry.
- Changed reviewed content gets a new identity and needs another receipt.
- Installation respects `core.hooksPath`, refusing foreign hooks. Integrate an
  existing hook deliberately rather than replacing it silently.
- Reinstall hooks if the Node executable or source checkout moved; generated
  shims use absolute paths.

For an intentional exception, use the built `rr-hook override --reason ...` CLI
or `READ_RECEIPT_OVERRIDE=1 git commit ...`; the trailer says `overridden`.
`--no-verify` skips pre-commit and is labelled `unverified (hook bypassed)` by the
message hook. Merge commits/empty text diffs are skipped. Binary files are outside
the text-hunk check.

## Automated checks

`npm run ci` covers TypeScript, lint, wording and unit/component tests.
`npm run test:replay` uses the real helper/hooks with simulated editor visibility.
`npm run test:editor` separately launches an editor-host test in a disposable
profile, defaulting to installed macOS Cursor. To select another installation:

```sh
RR_EDITOR_EXECUTABLE=/absolute/path/to/editor npm run test:editor
```

A missing editor executable is a local prerequisite, not an SDK error.
