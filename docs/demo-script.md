# Replay demo walkthrough

Allow roughly two to three minutes after setup. Say that the input is **synthetic
replay**, keeping **REPLAY — camera off** visible. This shows a working code-review
workflow, not measured human viewing or a live Presage SDK.

## Prepare

From the source checkout:

```sh
npm ci
npm run build
npm run demo:repo
```

The generator creates `fixtures/demo/_repo` with a synthetic baseline and six
unstaged hunks: two in `app.js`, two in `storage.js`, one in `README.md`, and a
19-line fake-key block at `auth.js:40–58`. Existing targets are refused; use
`npm run demo:repo -- /absolute/path/to/a/new-directory` for another copy.

Open the source checkout in VS Code or Cursor. Press F5, selecting **Read Receipt:
Replay Extension**. Trust the disposable folder in the new Extension Development
Host, then run **Read Receipt: Install Git Hooks**. This generated demo has no
foreign hooks for installation to replace.

## 1. Block an unread commit

In the demo repository's terminal:

```sh
git add -A
git commit -m "Synthetic replay review"
```

It fails with `Read Receipt: unread staged changes` and lists the six unread
hunks. No review commit is created yet.

## 2. Start replay

Run **Read Receipt: Open Review Panel**. It opens beside the editor and starts
the bundled recording. Nothing counts during approximately 20 seconds of
calibration. The waveform/pulse number come from the fixture, not a real person.

The default recording lasts five minutes, leaving time to review without the
interruptions in the separate scenario fixture. If it finishes, use Stop and
Start or **Read Receipt: Reconnect Helper** to restart.

## 3. Complete five receipts

Open `app.js`, `storage.js` and `README.md` manually, keeping both changed blocks
in each code file visible until their ticks turn blue. Leave `auth.js` closed.
The editor window must be active, the document saved and the panel visible.

The default hunk threshold is the larger of three seconds or 0.4 seconds per
changed line; every line independently needs 0.4 seconds. The status bar should
reach `5/6 read`. Allow roughly a second for persistence, then retry the commit:
it should still fail and list `auth.js:40`.

To show pausing, switch applications or hide the panel. The remaining receipt
does not progress. Show the editor/panel again to continue; restarting replay
also restarts calibration.

## 4. Review the last block and commit

Use the unread list or **Next Unread Hunk** to open `auth.js:40–58`. Show the
deliberately fake value:

```js
const API_KEY = "sk_live_DEMO_NOT_A_REAL_CREDENTIAL";
```

Keep all 19 lines visible until the hunk turns blue, at least 7.6 seconds under
the defaults. Wait for persistence, then retry:

```sh
git commit -m "Synthetic replay review"
git log -1 --format=%B
```

The commit succeeds with a trailer such as:

```text
Read-Receipt: 6/6 hunks, ... eyes-on, replay viewer
```

Show the actual timing. An override/bypass is not a completed replay review.

## 5. Invalidate a receipt

Change/save the fake-key block, stage it and attempt another commit. New content
has a new hunk identity and blocks until reviewed again. Moving identical content
to another line does not by itself erase its receipt.

## Automated checks

```sh
npm run test:replay
npm run test:editor
```

The first uses the real helper and Git hooks with **simulated editor visibility**
in a temporary repo. The second launches a separate editor-host test and disposable
profile. Both use synthetic input; neither proves live SDK behavior or human review.
